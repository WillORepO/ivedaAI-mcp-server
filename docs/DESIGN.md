# Design and behaviour

Why this server is shaped the way it is, and what it does about the parts of the IvedaAI API that
are surprising. None of this is needed to *use* the server — start with the
[README](../README.md) and the [usage guide](USAGE.md) for that.

## Design

Wrapping all 316 operations as 316 separate MCP tools would overwhelm most MCP clients. Instead,
this server registers **one tool per API resource/tag** (e.g. `ivedaai_camera`, `ivedaai_alert`,
`ivedaai_face_target`, 63 generated tools total). Each tool takes:

- `operation` — an enum of `"METHOD /path"` strings for every endpoint in that resource, listed in
  the tool's description along with its parameters.
- `path` / `query` / `body` — parameters for whichever operation you pick.
- `file` — for the handful of endpoints that accept a file upload (`{ path, filename?, contentType? }`,
  where `path` is a local filesystem path readable by the server process).

There's also a `ivedaai_get_schema` tool that returns the full JSON schema for any named definition
(e.g. `CameraRequest`) from the spec — useful when a body schema summary in a tool description gets
truncated for very large objects.

The tool set and all parameter/schema info are generated at startup directly from the bundled
`resources/openapi.json`, so nothing is hand-maintained per endpoint.

### What this costs a client on connect

```bash
npm run measure   # no deployment or credentials needed
```

An MCP client loads every tool definition up front, so their combined size comes out of the context
budget whether or not a tool is ever called. The one-tool-per-resource decision above was made to
keep the tool *count* manageable; the token cost was never measured. Measured, it started at
~82,000 characters on the 9.3 spec. On 10.0, with the default access policy, the descriptions are
**66,570 characters, ~16,600 tokens** across 63 tools — or **29,769 characters, ~7,400 tokens**
across 54 tools when `IVEDAAI_READ_ONLY=true`.

Descriptions are no longer the whole bill. Each tool also declares an `outputSchema`, and because
every generated tool answers with the same envelope, the same 601-character schema is transmitted 63
times: **37,863 characters, ~9,500 tokens**. Adding the two together is what a client actually pays
for the generated tools.

| Context window | Default | Read-only | Before the trims |
| --- | --- | --- | --- |
| 32,000 | **81%** | **48%** | 64% |
| 128,000 | 20% | 12% | 16% |
| 200,000 | 13% | 8% | 10% |
| 1,000,000 | 3% | 2% | 2% |

Read-only remains the cheapest way to shrink this — 54 tools and 129 operations instead of 63 and
295 — but it no longer more than halves the bill. Withholding the writes takes 36,000 characters off
the descriptions and only 5,300 off the schemas, because a read-only server still declares the same
envelope on every tool it does offer. In read-only the schema is now the *larger* of the two: 29,769
characters of description against 32,454 of schema.

Two things came out, neither of which a caller loses access to. Request bodies name their schema
definition instead of listing every field — the full list is a `ivedaai_get_schema` call away, and
the *required* field names stay inline because guessing those wrong is a failed call. And the
paragraph explaining how to call a tool, which used to head all 63 descriptions, is now sent once as
MCP `instructions`; the part of it a client could not reconstruct from the input schema stays in
every header, so nothing breaks on a client that ignores `instructions`. The engineering log carries
the full attribution and the reasoning for where this stopped. The figures above rose again with the
10.0 upgrade, which added operations and the measured date-format patterns.

At 200k this was always a reasonable price for covering 316 operations. At 32k the server was close
to unusable before the conversation started; it is now merely expensive.

Of the description total, the capability and live-testing cautions this project added account for
**13.1%** (~2,200 tokens across 21 of the 295 default-exposed operations) — a minority of the
budget, but not free.

The obvious lever is moving detail out of the descriptions and leaning on `ivedaai_get_schema`,
which exists for exactly that. That trades startup context for extra round-trips mid-conversation,
and which way that trade goes depends on the client and the workload, so nothing has been trimmed on
a guess. The other lever is the output schema, where the multiplier is unforgiving: every character
is paid 63 times, so the nested detail of `omittedFields` alone was worth 38,000 characters and was
dropped for that reason (see `src/outputSchema.ts`). `npm run measure` exists so both numbers can be
re-checked rather than trusted — run it before and after anything that touches tool descriptions or
the declared result shape.

### ivedaai_alert_integration — a guided, hand-built exception

`AlertRule.trigger` — the mechanism for routing alerts to external systems (generic HTTP webhooks,
13 named VMS/PSIM platforms, email, Immix, mobile push) — has enough undocumented, only-discoverable-
by-testing behavior that the generic per-tag dispatch isn't a good fit for it. Confirmed by testing
against a real deployment:

- The webhook type's `authorization`/`httpBody` fields are marked optional in the spec, but the
  server fails before attempting any connection if they're omitted rather than explicitly set to
  `{auth:"NONE"}`/`{type:"NONE"}`.
- `mail`/`immix` triggers can't be live-tested via `POST /api/alertTriggers` at all — it returns
  `"Unsupported check connection alert trigger type"`.
- VMS-type connection-failure timing is unpredictable — repeated tests against the same unreachable
  address ranged from under a second to ~24 seconds, not tied to any particular vendor.

`ivedaai_alert_integration` encodes all of this: it builds the correct payload per trigger type
(auto-filling the hidden-required fields), tests it via `POST /api/alertTriggers` with a generous
default timeout, translates the three distinct error shapes into a plain-language verdict
(`success` / `unsupported` / `invalid_config` / `connection_failed`), and can apply a working config
to a real alert rule via `PATCH /api/alertRules/{alertRuleId}` — reading the rule first and
re-sending what it can, for reasons covered in
[Alert rules: the suspicion, settled](#alert-rules-the-suspicion-settled).
See [TOOLS.md](TOOLS.md#ivedaai_alert_integration) for the full type reference.

### ivedaai_add_camera — another guided exception, same reasons

Adding a camera from just an IP or RTSP URL — a common real-world request — hits the same kind of
gap. Confirmed by live testing:

- The spec's `CameraRequest.required` list is misleading: floor-plan fields it lists as always
  required are actually waived by `locationType: "NONE"` (good news — less is truly required than
  the spec claims).
- But a schema-valid *minimal* body (`name`, `streamUrl`, `engineProfileId`, `roiContour`) still
  throws a bare, message-less server error. Filling in the rest of the optional-looking fields
  (`resolution`, `frameRate`, `schedule`, `plugins`, `fpsType`, `flipState`, `codec`,
  `cameraGroupIds`, etc.) avoids it.
- That error is not a clean failure — it can still partially create the camera record before
  crashing, so a naive retry produces a confusing "Duplicate" error instead of the real one.
- Creating the record is not enough for the camera to actually connect, or to be fully provisioned
  in the product: a separate step, `POST /api/cameras/{id}/jobs?activate=true`, allocates a
  processing resource and starts the stream — without it, the camera's `status`/`resource`/
  `engineModels` fields stay null indefinitely.

`ivedaai_add_camera` encodes all of this: it fills in every field found to be silently required,
detects and reports partial creation-despite-error instead of a false failure, and automatically
performs the activation step. What it deliberately does **not** claim: that activation succeeding
means the stream is connected. In testing, a confirmed-correct RTSP URL still sat at
`Running`/0% progress with no error at all for 90+ seconds — most likely a network-reachability
issue between the IvedaAI server and the camera, not something this tool (or the API) can detect
or fix. The tool's output always points to checking back via `ivedaai_job` or `ivedaai_camera` for
real confirmation. See [TOOLS.md](TOOLS.md#ivedaai_add_camera) for details.

## Response format

Every tool call returns a JSON envelope:

```json
{
  "url": "…", "method": "GET", "status": 200, "statusText": "OK",
  "headers": { "content-type": "application/json" },
  "body": { }
}
```

`isError` is set on the MCP result for HTTP status >= 400. Two extra flags may appear:
`truncated: true` when the body exceeded `IVEDAAI_MAX_RESPONSE_BYTES`, and `timedOut: true` when
reading the body hit the timeout — typical for continuous streams (see below), in which case
`body` contains whatever was read before the cutoff.

That envelope is returned twice: serialised into the result's text block, and as
`structuredContent` for clients that would rather not parse JSON out of prose. Both are serialised
from one object, so they cannot disagree. Every tool declares the shape as an `outputSchema`, which
the SDK enforces — a result that does not match the declaration is answered as a protocol error
rather than delivered, so `src/outputSchema.ts` is written to describe what the code actually emits
and leaves genuinely variable fields (`body` above all) untyped rather than guessing.

The image is the one thing that appears in neither: it is stripped from the envelope and sent as an
image content block, because base64 in the JSON would deliver the same picture a second time as
unreadable text.

Two tools wrap their answers to make this possible. `ivedaai_get_schema` returns `{names}` for a
listing and `{name, schema}` for a lookup, and `ivedaai_alert_integration` returns its type
reference under `{types}` — MCP requires `structuredContent` to be an object, and all three used to
answer with a bare array or a bare definition.

### Pagination

36 operations answer with a Spring page rather than a collection — `content` alongside
`totalElements`, `totalPages`, `number`, `numberOfElements`, `size`, `first`, `last`, `empty`, and a
nested `pageable` restating most of it. Everything a caller needs is in there, and none of it
answers the two questions they actually have: is there more, and what do I send to get it. Reading
it correctly means knowing that `number` is a zero-based page index rather than a count, that
`numberOfElements` is this page's length while `totalElements` is the collection's, and that `last`
is the field to trust. The failure mode is quiet and plausible — twenty records arrive next to
`totalElements: 400`, and the answer is given from the twenty.

So a `pagination` object is added beside `body`:

```json
{ "total": 400, "count": 20, "page": 0, "size": 20, "hasMore": true, "nextPage": 1,
  "note": "This is a partial result: 20 of 400 records. Send query {\"page\": 1} …" }
```

`body` is left exactly as the deployment sent it. Which operations paginate is derived from the
spec at startup — from the response *shape*, `content` next to `totalElements`, rather than from
the `PageOf*` naming convention that springdoc happens to follow today — and the summary is only
produced if the response itself agrees. A 4xx body, a truncated fragment or an endpoint answering
differently from its own spec yields no summary rather than a confident wrong one.

`hasMore` prefers the server's `last`, falls back to the page index against `totalPages`, then to
how far the records seen reach into `totalElements`, and answers `false` when it cannot tell:
inventing a page that does not exist sends a caller into a retry loop, while missing one leaves
them where they already were.

**What this deliberately does not do is choose a page size.** No default `size` is injected into
requests. What the deployment's own default is has not been established by testing, and a guess
either way is wrong for somebody — too large breaches the response cap and wastes the whole
round-trip, too small doubles the number of calls. The `pagination` block reports the `size` that
was actually applied, so a caller learns it from the first response instead of from an assumption
baked in here.

## The lossy-update guard

Of the twelve update endpoints whose behaviour has been
[established by testing](#what-each-update-endpoint-does-with-omitted-fields), exactly one is
dangerous enough to refuse outright, and this is it.

`PATCH /api/user-groups/{userGroupId}` nulls `externalId` when the body omits it, and answers `200`
— the loss is invisible in the response. That is a bad failure mode for a hand-written client and a
worse one here, because these tools are driven by a model that will quite reasonably send the
minimal body a partial update appears to call for. The `PUT` endpoints that discard omitted fields
are not guarded: replacement is what that verb advertises, and refusing it would break legitimate
calls. What makes this one worth blocking is that `PATCH` promises the opposite.

So the server refuses it. A call to a guarded operation whose body omits a guarded field returns an
error explaining what would have been lost and how to avoid it, **without making the request**:

```
Refusing to call PATCH /api/user-groups/{userGroupId}: the body omits "externalId".

Despite being a PATCH, this endpoint does not leave omitted fields alone — it sets "externalId" to
null and still answers 200, so the data loss is invisible in the response. …

To fix: read the record first and include the current value of "externalId" in your body, so the
update preserves it. If you genuinely mean to clear it, send "externalId": null explicitly and this
call will go through.
```

Passing the field as an explicit `null` is allowed: clearing it is then a stated intention rather
than a side effect. The same caution is emitted into the generated tool description, so a caller
that reads the docs first never hits the refusal.

The guarded operations live in [`src/partialUpdate.ts`](../src/partialUpdate.ts). **Only add an entry
that live testing has confirmed** — each one blocks calls that would otherwise succeed.

`IVEDAAI_ALLOW_LOSSY_UPDATE=true` disables the guard. It exists for the maintainers' CRUD probe, which omits
fields deliberately in order to detect this behaviour and would otherwise be blocked from observing
the very thing the guard protects against — including, one day, a server-side fix. Nothing else
should set it.

## What each update endpoint does with omitted fields

Whether an update loses the fields you didn't send is **per-endpoint on this API, and cannot be
inferred from the verb**. `PATCH /api/user-groups` nulls them; `PATCH /api/alertRules` merges; `PUT
/api/rois` merges where every other `PUT` here replaces or refuses. So it is recorded per operation
in [`src/partialUpdate.ts`](../src/partialUpdate.ts), each entry with the evidence that established it,
and the round-trip warnings are phrased from it.

| Operation | Behaviour | What happens to omitted fields |
| --- | --- | --- |
| `PATCH /api/user-groups/{id}` | **clears** | `externalId` → `null`, but `privileges` survives |
| `PUT /api/user-groups/{id}` | **replaces** | `externalId` → `null` *and* `privileges` → `[]` |
| `PATCH /api/alertRules/{id}` | merges | everything survives |
| `PUT /api/alertRules/{id}` | refuses | `500 NullPointerException` |
| `PATCH /api/cameras/{id}` | merges | everything survives |
| `PUT /api/cameras/{id}` | refuses | `400` — `cameraType`, `doRecording`, `protocol` must not be null |
| `PATCH`/`PUT /api/rois/{id}` | merges | everything survives, both verbs |
| `PUT /api/camera-groups/{id}` | **replaces** | omitting `cameraIds` unbinds every camera |
| `PUT /api/engineProfiles/{id}` | merges | everything survives |
| `PUT /api/filters/{filterId}` | refuses | `500` without `query`/`cameraIds` |
| `PUT /api/face/categories/{id}` | **replaces** | `colorCode` reverts to the `#3E80B5` default |
| `PUT /api/lpr/categories/{id}` | **replaces** | `colorCode` reverts to the default |
| `PATCH /api/accounts/{id}` | merges | everything survives |
| `PUT /api/accounts/{id}` | refuses | `400` — enforces `password`, which `PATCH` does not |
| `PUT /api/nvrs/{nvrId}` | refuses | `500 NullPointerException` |

**Every update operation the round-trip check flags is now accounted for — nothing left at
`unknown`.** Two pairs are worth reading twice.

The `user-groups` pair: on the same path, `PATCH` preserves `privileges` while `PUT` empties it.
Neither verb's behaviour predicts the other's, and `PUT` silently stripping a group's privileges while
answering `200` is the more dangerous of the two.

The `accounts` pair is a different kind of asymmetry: **`PUT` enforces `password` and `PATCH` does
not.** So an account cannot be updated through `PUT` at all without setting the account holder's
password, while `PATCH` updates it freely and merges. That asymmetry is also what made the row
testable without touching a credential — `PATCH`'s tolerance provided a restore path, and `PUT`'s
refusal of a partial body *is* the answer for `PUT`.

### Establishing it

These findings came from controlled maintainer probes against disposable records. The write-capable
probe suite and its deployment evidence remain in the private engineering repository rather than
this public product repository. Each run set observable fields, sent a body carrying only what the
schema marks required, read the result back, and deleted its records in reverse dependency order.

**Why cameras can be probed at all.** The CRUD probe deliberately never touches them, on the
grounds that creating a camera allocates a processing resource. That is true only of *activation*
(`POST /api/cameras/{id}/jobs?activate=true`), a separate call this probe never makes. An unactivated
camera is an inert config row. That unlocked two other resources as a side effect: the deployment has
exactly **one** ROI, attached to a real camera, so probing ROI updates in place was out of the
question — a throwaway camera can carry a throwaway ROI. And a camera group's only interesting field
is `cameraIds`, which proves nothing when the list is empty; it can now be bound to the probe camera
instead of a real one.

> **A false positive worth recording.** The camera probe first reported `PATCH /api/cameras` as
> clearing `latitude`/`longitude` — which would have marked the most-used resource in the API as
> lossy. It was wrong: the partial body included `locationType: "NONE"`, and switching the location
> mode discards the coordinates, which is defensible behaviour rather than a partial-update bug. With
> `locationType` omitted entirely, the coordinates survive and the endpoint merges. **A field the body
> sets is not evidence about fields the body omits** — the probe now leaves it out and says why.

### Accounts, and what it took to probe them safely

Accounts were the one resource held back longest, on the reasoning that
`AccountRequest.required` includes `password`, so any update would reset a real person's password.
That reasoning was half wrong: `password` is enforced on `PUT` only. `PATCH` accepts a body without
one.

The maintainer account probe exploits that asymmetry and is ordered so it can never take a step it
cannot undo. A partial update might clear fields, and putting them back needs a full-object update —
which is the very call that might be blocked. So it proves the repair
path *first*: send the complete object, with every value read straight back off the record, so success
changes nothing. Only once that is accepted does it try a partial body. Then it restores from the
snapshot and verifies the account matches its original state field by field.

It never sends a password. If the capability check had failed, it stops there and reports the row as
unresolved rather than resetting a credential to satisfy a table. It also requires
`--account-id` explicitly — no default — and refuses to run against an `admin`-role account or the
account the server authenticates as, since a botched write there could revoke the access needed to
repair it.

NVRs got a throwaway record rather than the deployment's real one for a related reason:
`NvrRequest` carries the device's own username and password, the read does not echo them back, so a
`PUT` that dropped them could not be repaired from any readable value. Its address is in TEST-NET-1
(`192.0.2.0/24`), so if the server acts on its `get_channel`/`retrieve` capabilities the traffic goes
nowhere real.

### A spec gap found on the way

`EngineProfileRequest` marks only `name` required, but a create carrying just `name`, `description`
and `engineModelIds` fails with `500 JpaSystemException / ConstraintViolationException` —
`engineConfig` is silently required. The probe sidesteps guessing at `JobEngineConfig`'s shape by
cloning `engineConfig` off an existing profile, which is by definition something the server already
accepted.

## Fields you cannot simply read back

The lossy-update guard's advice — read the record first, send the complete object — quietly assumes
the read hands back what the write accepts, keyed the same way. On this API it very often does not,
and the reason turns out to be more interesting than plain data loss.

That an endpoint might lose omitted fields is [covered above](#what-each-update-endpoint-does-with-omitted-fields).
This section is the separate, compounding problem: even where you *want* to send the complete
object, the read often will not give it to you under the keys the write expects.

**This API's read and write models are deliberately different shapes.** Confirmed by reading real
records off a live deployment:

- **ids expand into objects** — `nvrId` → `nvr.nvrId`, `userGroupId` → `userGroup.userGroupId`,
  `brandId` → `brand.brandId`, `cameraGroupIds` → `cameraGroups[].cameraGroupId`
- **fields are renamed** — an alert rule's `name` → `alertName`, an ROI's `isEnabled` → `enabled`,
  `roiContour` → `region[].contour`, `excludeRoiContour` → `excludedRegion`
- **several request fields collapse into one composite** — a filter's `query`, `cameraIds` and `type`
  all live inside `expression`; an alert rule's `roiIds`, `cameraIds` (as `cameras`), `hashtags`,
  `typeLogic` and `cooldownInterval` inside `condition`,
  which is itself a **JSON-encoded string** rather than a nested object; `enableForever` is stored as
  `schedule.forever`

So a field missing from a response by name is usually still readable, just somewhere else. The
practical problem is that nothing documents where.

[`src/roundTrip.ts`](../src/roundTrip.ts) derives the candidates from the spec at startup, then resolves
them against a hand-maintained table of live-verified locations. What comes out is two distinct
categories, and only the second is alarming:

| Operation | Readable, under another key | No known source |
| --- | --- | --- |
| `PUT`/`PATCH /api/rois/{roiId}` | all 9 — incl. `roiContour` → `region[].contour` | — |
| `PUT /api/filters/{filterId}` | `query`, `cameraIds`, `type` → inside `expression` | — |
| `PUT`/`PATCH /api/alertRules/{id}` | 8 — `name`, `cameraIds`→`condition.cameras`, `roiIds`, `hashtags`, `typeLogic`, `cooldownInterval`, `weekdays`, `enableForever` | 9 type-specific lists — `roiTypes`, `lineIds`, `lprCategoryIds`, `countingRule`, … |
| `PUT`/`PATCH /api/cameras/{id}` | `nvrId`, `cameraGroupIds` | `doRecording` |
| `PUT`/`PATCH /api/accounts/{id}` | `userGroupId` → `userGroup.userGroupId` | — |
| `PUT /api/nvrs/{nvrId}` | `brandId` → `brand.brandId` | — |
| `PUT /api/camera-groups/{id}` | `cameraIds` → `cameras[].cameraId` | `cameraGroupIds` |
| `PUT`/`PATCH /api/user-groups/{id}` | — | `accountIds` |
| `PUT /api/engineProfiles/{id}` | `engineModelIds` → `engineModelId` | — |

> **A correction worth recording.** The first version of this check compared field *names* only and
> concluded 16 operations had unpreservable fields — including that `PATCH /api/rois/{roiId}` could
> not preserve `roiContour`, a region's own geometry, and that this was unfixable by any client. That
> was wrong. Every one of those nine ROI fields is readable; the response just calls the contour
> `region[].contour`. Live verification is what caught it, and it is why the mapping table exists
> rather than a longer list of warnings.

### Verifying it

The mapping table was checked by a read-only maintainer validator kept with the private deployment
test suite. It issues `GET`s and nothing else. For each flagged operation it reads a real record and
resolves every claimed mapping against it, reporting `MAPPING HOLDS`, `MAPPING BROKEN`, or
`unverified`. That third outcome matters: a single record cannot disprove a mapping just by having
nothing at that location, so a field that is declared-but-unset, null, or an empty list is reported
as untested rather than refuted. Conflating those made an earlier run cry wolf three times on a
deployment where no mapping was actually wrong. It exits nonzero on a broken mapping or on a field
the server returns under its own name despite the schema omitting it.

It samples up to 8 records per resource, not one, because some mappings are record-dependent: an
alert rule's `condition` carries `roiIds` on an INTRUSION rule and `cameras`/`hashtags` on a
VIDEO_SEARCH one. A mapping counts as holding if it resolves on any record read. With a single
sample those three came back as "broken" — a false alarm of exactly the kind this script exists to
avoid producing.

Last run against a live deployment: 9 operations, **24 mappings held, 0 broken**, 2 unverifiable on
that data (a camera with no NVR attached, an ROI with no exclusion zone), 11 fields with no known
source.

### How it surfaces

Unlike the lossy-update guard this **cannot be a refusal**, because for the renamed fields there is
a correct call to make and for the rest there is no value to fetch. So it informs instead:

- Affected operations carry a line in their tool description and in
  [TOOLS.md](TOOLS.md) — `NOTE:` naming where to read a renamed field, `CAUTION:` for
  fields with no known source.
- A write that omits any of them gets an `omittedFields` block in its result, splitting
  `readableElsewhere` (with the location to read from) from `noKnownSource`. A call that sets them
  all stays quiet.

The wording is deliberately hedged on the second category: `condition` proved to be a JSON string
holding two request fields, so a value with "no known source" may simply be somewhere not yet found.

### Alert rules: the suspicion, settled

Three commits carried a suspicion that `PATCH /api/alertRules/{alertRuleId}` nulls the fields a body
omits, the way `PATCH /api/user-groups/{userGroupId}` provably does — which would have meant that
attaching a trigger silently wiped the rest of the rule. It was recorded as unconfirmed each time,
because settling it needs a write.

**It was wrong. `PATCH /api/alertRules/{alertRuleId}` merges.**

The private maintainer probe created its own disabled `VIDEO_SEARCH` rule, recorded what stuck, sent
a partial body carrying only the three required fields, and read it back. Every omitted field
survived, reproduced across three runs:

| Omitted field | Before | After partial `PATCH` |
| --- | --- | --- |
| `description` | `"probe-description-should-survive"` | unchanged |
| `condition.cameras` (`cameraIds`) | `[245]` | unchanged |
| `condition.hashtags` | `["zzprobehashtag"]` | unchanged |
| `condition.typeLogic` | `"and"` | unchanged |
| `condition.cooldownInterval` | `7` | unchanged |
| `schedule.forever` (`enableForever`) | `true` | unchanged |

`description` is the one that settles it: a plain top-level scalar, exactly the shape of the
`externalId` that user-groups *does* clear. So **omission behaviour is per-endpoint, and cannot be
inferred from the verb** — which is why [`src/partialUpdate.ts`](../src/partialUpdate.ts) now records
confirmed semantics per operation (`clears-omitted`, `merges`, `rejects-partial`) and the warnings
are phrased from it. An endpoint known to merge is no longer told it might lose data.

The same run tested `PUT` on the same path with the same body: **HTTP 500 `NullPointerException`**.
It refuses partial bodies rather than replacing, matching `PUT /api/filters/{filterId}`. So the two
verbs on this path behave completely differently, and neither the way REST would suggest.

> A reporting bug worth noting, since it nearly produced a false all-clear: the probe first scored
> `PUT` as "merged" because nothing changed. Nothing changed because the call *failed*. A failed
> update that alters nothing has demonstrated only that the body was rejected, so the script now
> reports non-2xx separately and says explicitly that it learned nothing about merge semantics.

What remains genuinely unreadable on an alert rule is nine type-specific binding lists —
`roiTypes`, `lprTypes`, `personTypes`, `lineIds`, `faceCategoryIds`, `lprCategoryIds`,
`abnormalTypes`, `idrAccess`, `countingRule`. Since `PATCH` merges, leaving them out of an update is
safe; they matter only for `PUT`, which needs the full object anyway.

`ivedaai_alert_integration`'s `apply` still reads the rule first and re-sends up to twelve fields — `name`
(from `alertName`), `alertType`, `description`, `isEnabled`, `weekdays`/`enableForever` from
`schedule`, and `roiIds`/`cameraIds`/`hashtags`/`typeLogic`/`cooldownInterval` parsed out of the
`condition` string (which of those it finds depends on the rule's type). That is now
precaution rather than repair: it keeps the call schema-valid (the original bare `{trigger}` body
omitted two required fields) and stays correct if the endpoint ever changes. It refuses to write if
the pre-read fails or comes back without the required fields.

## Notes / limitations

- **Streaming endpoints** (`GET /api/system/events` server-sent events, `*.mjpeg` motion-JPEG
  streams) never terminate on their own. Calls to them return after `IVEDAAI_TIMEOUT_MS` with
  `timedOut: true` and whatever data arrived — they can't be consumed continuously through a tool
  call.
- **Supported image responses are attached as MCP image content** — JPEG, PNG, GIF and WebP can be
  viewed by the model. Other binary responses return `{ contentType, byteLength, filename? }`
  metadata instead, to avoid dumping raw bytes into the model's context. What counts as binary is an
  allowlist of *textual* types (`text/*`, `application/json`/`xml`/`+json`/`+xml`, and friends)
  rather than a blocklist of binary ones. `content-disposition: attachment` decides only the case
  where no content type is declared — it deliberately does not override a known-textual type, since
  binary responses have their bytes dropped with no escape hatch, so classifying a CSV export as
  binary would make its contents unreachable rather than merely inconvenient.

  It was the other way round until a live read probe reached `GET /api/face/targets/export`, which
  answers `application/zip` — a type the spec declares nowhere — and watched 17KB of archive get
  decoded as UTF-8 into the response body: context flooded, and the archive corrupted past recovery
  by the lossy decode. Erring toward binary costs a caller some metadata; erring the other way
  destroys the payload, so anything not known to be text is now kept as bytes.
- Tools whose resource includes DELETE operations are annotated with `destructiveHint`; tools with
  only GET operations are annotated `readOnlyHint`.
- Unknown `path`/`query` parameter names are rejected with the list of valid names rather than
  silently dropped, so typos surface immediately.
- Body schema summaries in tool descriptions are one level deep and capped at 40 properties per
  object to keep tool descriptions manageable; use `ivedaai_get_schema` for the full definition.
- Query array parameters are encoded per the spec's `collectionFormat` (`multi`, `csv`, `ssv`,
  `tsv`, `pipes`).
- Regenerating tools from an updated spec just means replacing `resources/openapi.json` and
  rebuilding — no code changes needed unless the spec's shape (e.g. new param locations) changes.
