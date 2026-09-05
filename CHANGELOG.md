# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Production-readiness audit fixes

- Reject empty and dot-segment path identifiers and empty required query targets before authentication,
  preventing record DELETEs from becoming collection requests after URL normalization.
- Withhold incomplete or malformed JSON that cannot be safely redacted; redact complete SSE events,
  returned credential query fields and headers, and keep authentication response bodies out of errors.
- Refuse API and OAuth redirects, bound OAuth response reads, validate token fields, and prevent a late
  401 from invalidating a newer token obtained by another request.
- Propagate MCP cancellation and shutdown to outbound work. Preserve completed camera-batch results
  after uncertain network outcomes, and stop the remaining batch.
- Expose recovered multipart file and body fields in MCP schemas and generated documentation.
- Never activate a name-matched camera after a failed create; report activation failures and missing
  create identifiers as errors. Keep guessed RTSP credentials out of warning text.
- Reject ambiguous safety switches and malformed origin/limit settings; ignore local environment files.
- Update vulnerable transitive dependencies within existing constraints. Require Node 22.12+ and
  validate releases on Node 24; pin workflow actions and gate on high dependency vulnerabilities.
- Replace the stale package file-count gate with an explicit allowlist. Correct publication instructions,
  read-only documentation, and measured tool-list context cost.

Publication status: the public npm registry returned 404 for this package on 2026-09-04. The historical
1.0.0 entry below describes the intended release; it is not evidence that publication completed.


### Changed

- `IVEDAAI_READ_ONLY` judges an operation by what it does rather than by its HTTP method. This API
  uses POST wherever a query needs a request body, so three alert operations that only read —
  `statistics`, `_search` and `latest` — were being withheld. Without the aggregation endpoint,
  counting alerts by camera cost one call per camera; with it, one call. Every entry in the
  allowlist was verified against a live deployment with the audit trail as witness.
- A generated tool declares only the argument fields its operations can actually use. All of
  `path`, `query`, `body` and `file` were declared on every tool; under `IVEDAAI_READ_ONLY` that
  meant `body` and `file` on all 54 tools and usable by none, since no write is offered. Measured:
  190,727 to 168,277 characters on connect by default, 127,934 to 101,838 read-only.

### Added

- `GET /api/alerts` says how to count a collection too large to read: filter, set `size=1`, and
  read `pagination.total`. A live deployment held 227,600 alerts for one week, so paging the
  collection to answer a question about it never finishes. It also points at
  `GET /api/alerts/latest` for what is happening now.
- A 403 that is the deployment licence rather than the caller's credentials now says so. Every
  operation answers errorCode 1312, "License is invalid", while the licence is lapsed, which reads
  as an authentication failure — so re-authenticating and retrying both look reasonable and neither
  can work. The note points at `GET /api/licenses/ainvr`, which keeps working and reports
  `licenseState` and `expiry_date`.

## [1.0.0] — 2026-08-27

First packaged release. The server itself predates this entry; what changed is that it is now
installable rather than only buildable from a clone.

### Added

- Published to npm, so an MCP client can launch it with `npx -y ivedaai-mcp-server`.
- `--help` and `--version`, which exit rather than waiting on stdin.
- `.env.example`, a configuration table in the README, and client config snippets.
- `SECURITY.md`, `CONTRIBUTING.md`, and this changelog.
- Every tool now declares an `outputSchema` and returns `structuredContent` alongside the text
  block, serialised from the same object so the two representations cannot disagree.
- Paged responses carry a `pagination` summary with the current count, total, page, whether more
  data exists, and an operation-specific continuation note. The original response body is unchanged.
- `evaluations/tool-navigation.xml` tests whether a model can find the right call among 316
  operations. `npm run verify:evals` recomputes its answers from the bundled spec, and CI runs it.

### Changed

- The repository now contains the server and its user documentation only. The engineering log, the
  API findings, the write-coverage inventory, the Tier 4 triage and the live-deployment probes moved
  to Iveda's internal repository — they wrote to real systems and were never part of the product.
- The README leads with installation. Architecture and API behaviour moved to
  [docs/DESIGN.md](docs/DESIGN.md); test documentation moved to
  [CONTRIBUTING.md](CONTRIBUTING.md).
- The published package contains 22 files rather than the 65 that a
  default `npm pack` would have shipped.
- `IVEDAAI_MAX_RESPONSE_BYTES` now defaults to 28 KB rather than 2 MB. The old value was chosen to
  avoid truncating what the API might send; the binding constraint is what a model client can
  receive. A truncated response now carries a `note` telling the caller to narrow the request.
- `ivedaai_get_schema` now wraps listings as `{names}` and lookups as `{name, schema}`;
  `ivedaai_alert_integration` wraps `list_types` as `{types}`. MCP requires structured tool results
  to be objects.
- Tool annotations now derive `idempotentHint` from all operations a tool exposes and consistently
  mark deployment-facing tools as open-world.
- Deleting an active camera now carries the measured safe workflow: deactivate, poll the camera to
  `Idle`, issue one DELETE, then poll until `404 Not Found` rather than trusting `202 Accepted`.
- Counting dashboard and history now explain that `types` must be a top-level object-type key from
  `GET /api/types/{category}`, not a nested synonym, line-set type, or IN/OUT direction.
- An enum list that has been shortened now says so, as `|+16 more`. It previously showed exactly
  eight values and gave no sign that more existed, so a truncated list was indistinguishable from a
  complete one — and two enums of different lengths could appear identical.
- `POST /api/cameras` states the four further fields the API requires beyond the one the published
  spec marks. A body carrying only `cameraType` is refused with a 400 naming them, and no record is
  created.
- Tool schemas no longer declare a JSON Schema dialect. The SDK stamped draft-07 onto all 132
  published schemas, which made every tool uncallable from a client whose validator implements
  2020-12 only — the refusal happens before the request is built, so the tool cannot be invoked at
  all. The schemas themselves are unchanged and dialect-neutral; only the declaration is gone. It
  also takes 6,864 characters off what a client loads on connect.
- The text block that accompanies `structuredContent` is serialised compactly rather than
  pretty-printed. Every result carries the payload twice by design — the spec asks for it, for
  clients that read only `content` — but the indentation was 24% of the wire, taxed twice because
  the block is escaped into the JSON-RPC envelope. Measured across eight real reads: 187.2 KB down
  to 137.9 KB, a 2.88x multiplier down to 2.13x. The data is byte-identical.
- Collection reads replace an inline media payload with a marker naming its type and size, rather
  than carrying it. A face-recognition alert embeds the matched person's enrolled portrait as a
  ~2.7 KB data URI, repeated on every alert matching that person; a page of ten measured 63.3 KB
  before and 54.3 KB after. A single-record read keeps the payload whole, which is how the full
  value is retrieved. Image endpoints and the image URLs inside a record are unaffected.

### Security

- Local-file uploads are disabled until `IVEDAAI_UPLOAD_ROOT` confines them to an approved
  directory. The explicit `IVEDAAI_ALLOW_UNCONFINED_UPLOADS=true` compatibility escape hatch still
  refuses credential paths, Linux virtual kernel filesystems, non-regular files, and oversized
  files. Approved files are read through a stable descriptor with a hard byte cap.
- A password carried inside a URL is redacted, as `rtsp://user:***REDACTED***@host`. Credential
  redaction matched field names only, so a camera whose `account` and `password` fields were empty
  still sent its stream credentials into model context through `streamUrl`. Strings are now
  examined wherever they appear, including inside arrays and JSON-encoded fields.
- Collection-emptying DELETEs are withheld unless `IVEDAAI_ALLOW_COLLECTION_DELETE=true`.
- `IVEDAAI_READ_ONLY=true` withholds every non-GET from the tool list rather than refusing at call
  time.
- Credential-shaped response fields are redacted by default.
- The server warns on stderr about plain-HTTP transport to a non-loopback host and about disabled
  TLS verification.
