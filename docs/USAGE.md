# Usage guide

How to connect this MCP server to a client, call the tools, and run common workflows.
For the complete list of every tool and operation, see [TOOLS.md](TOOLS.md).

## What this server does

It connects an AI assistant through a client that launches local MCP processes to an IvedaAI
video-analytics deployment, so you can ask things in plain language and have the assistant drive
the API for you:

- *"List all cameras that aren't recording"*
- *"Create an alert rule for intrusion detection on camera 7"*
- *"Find license-plate detections for ABC123 in the last week"*
- *"Add this photo as a face target in the Watchlist category"*
- *"Analyze this video file for objects"* (uploads a file and creates a job)

## Connecting

These instructions use the package's default stdio transport. For the separate authenticated,
read-only HTTP entry point, see [REMOTE.md](REMOTE.md); it supports existing IvedaAI login and
requires HTTPS proxy/client-callback setup. Browser deployment options are described in
[browser connection requirements](BROWSER-READINESS.md).

### Prepare the application account

Create a dedicated account with the privileges and record grants needed for the intended workflows.
On the tested IvedaAI 10 deployment, account creation requires an explicit
`activeUserSelfManagementMfa` boolean even though the OpenAPI schema marks it optional; omitting it
returns HTTP 500. Supply the value intended by your account policy. An inactive account cannot log in.

Complete any required first-login password change in the application's web interface before
configuring MCP. The deployment rejected ordinary API requests and account PATCH requests with
error 112 until this step was completed. Store the resulting password in your client's secret
configuration. MCP's read-only mode limits exposed operations; application privileges and record
grants still determine which cameras or other records the account may access.

### 1. Build

```bash
npm install
npm run build
```

### 2. Register with your MCP client

**Claude Desktop** — add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "ivedaai": {
      "command": "node",
      "args": ["C:\\path\\to\\ivedaai-mcp-server\\dist\\index.js"],
      "env": {
        "IVEDAAI_BASE_URL": "https://your-server.example.com",
        "IVEDAAI_USERNAME": "your-username",
        "IVEDAAI_PASSWORD": "your-password",
        "IVEDAAI_UPLOAD_ROOT": "C:\\approved-uploads"
      }
    }
  }
}
```

**Claude Code** —

```bash
claude mcp add ivedaai -e IVEDAAI_BASE_URL=https://your-server.example.com -e IVEDAAI_USERNAME=your-username -e IVEDAAI_PASSWORD=your-password -e IVEDAAI_UPLOAD_ROOT=C:\approved-uploads -- node C:\path\to\ivedaai-mcp-server\dist\index.js
```

On-prem server with a self-signed certificate? Add `"IVEDAAI_ALLOW_INSECURE_TLS": "true"`.
The full environment-variable reference is in the [README](../README.md#configuration).

Authentication is automatic: the server logs in with your credentials on the first call, attaches
a Bearer token to every request, refreshes it before expiry, and retries once if the server
revokes it early. You never handle tokens yourself.

## How the tools work

Instead of 316 separate tools, the server groups the complete API into **one tool per resource** —
`ivedaai_camera`, `ivedaai_alert`, `ivedaai_face_target`, and so on. Every call has the same shape:

```jsonc
{
  "operation": "GET /api/cameras",   // which endpoint — pick from the tool's description
  "path":  { "cameraId": 12 },       // path parameters, if the operation has any
  "query": { "nameContains": "dock" }, // query parameters
  "body":  { "name": "Dock 3" },     // JSON request body (POST/PUT/PATCH)
  "file":  { "path": "C:\\clips\\a.mp4" } // local file, for upload operations only
}
```

Every response is a JSON envelope:

```jsonc
{
  "url": "…", "method": "GET",
  "status": 200, "statusText": "OK",
  "headers": { "content-type": "application/json" },
  "body": { /* the API's actual response */ }
  // plus "truncated": true or "timedOut": true if a large/streaming body was cut off
}
```

Three things worth knowing:

- **Parameter names are strict.** A typo'd query or path parameter is rejected with the list of
  valid names — it will never be silently ignored.
- **`ivedaai_get_schema`** returns the exact JSON schema for any named type (`CameraRequest`,
  `Schedule`, `Contour`, …). Use it when a request body has nested objects whose shape isn't
  obvious from the tool description.
- **HTTP errors retain their response data:** a 404 or 400 is marked as a tool execution error but
  still returns the envelope with that status and the server's body, so the assistant can read the
  message and correct itself.

## Common workflows

The assistant chains these calls itself when you ask in plain language — the sequences below show
what actually happens so you can follow along or debug.

### Find and inspect cameras

1. `ivedaai_camera` → `GET /api/cameras` with `query: { nameContains: "entrance" }` — paginated
   list (`size`/`page`/`sort` control paging).
2. `ivedaai_camera` → `GET /api/cameras/{cameraId}` — full detail for one camera.
3. `ivedaai_camera_state` → `GET /api/camerastatehistorys` — state-change history, filterable by camera.

### Add cameras from a list of IPs or RTSP URLs

Use `ivedaai_add_camera` rather than the generic `ivedaai_camera` tool — it handles several
undocumented requirements confirmed by live testing (see the README's
[ivedaai_add_camera](../README.md) section for details).

```jsonc
{
  "cameras": [
    { "name": "Front Door", "streamUrl": "rtsp://admin:pass@192.168.1.50:554/stream1" },
    { "name": "Loading Dock", "streamUrl": "rtsp://admin:pass@192.168.1.51:554/stream1" }
  ]
}
```

That's the minimum needed per camera — `engineProfileId` and `roiContour` (region of interest)
default automatically (first engine profile found; full-frame rectangle), with the defaults used
reported back in each result's `warnings`. The tool creates the camera record and starts its
connection (`activate`) in one call; check the response's `results[].activation.jobId` afterward
via `ivedaai_job` (`GET /api/jobs/{jobId}`) to confirm it actually connected — a `Running` status
alone doesn't guarantee that, only that IvedaAI is still trying.

Prefer a real `streamUrl` over `ip` alone: without one, the tool can only guess a generic RTSP root
path, which often doesn't match a camera's actual manufacturer-specific stream path.

### Review alerts

1. `ivedaai_alert_rule` → `GET /api/alertRules` — see what rules exist.
2. `ivedaai_alert` → `GET /api/alerts` with time-range/camera filters — triggered alerts.
3. `ivedaai_false_report` — mark false positives.

### Connect alerts to an external system (webhook, VMS, etc.)

This is one of the most common real-world uses of the API — routing IvedaAI alerts into another
platform's dashboard or alarm system. Use `ivedaai_alert_integration` rather than the generic
`ivedaai_alert_rule`/`ivedaai_alert_trigger` tools — it knows about several undocumented
requirements discovered by testing against a real deployment (see the "ivedaai_alert_integration"
section in the [README](../README.md) or [TOOLS.md](TOOLS.md#ivedaai_alert_integration) for details).

1. `ivedaai_alert_integration` → `{action: "list_types"}` — see all 17 trigger types, which are
   live-testable, and the config shape for each.
2. `ivedaai_alert_integration` → `{action: "test", type: "request", config: {method: "POST", url: "https://your-system.example.com/webhook"}}`
   — test-fires a generic webhook. For a named VMS instead: `type: "milestone"` (or genetec, axis,
   avigilon, …) with `config: {ip, port, username, password, protocol}`.
3. Read the `outcome` in the response: `success` (it connected), `connection_failed` (reachable
   target but the connection itself failed — check IP/port/credentials), `unsupported` (this trigger
   type — only `mail`/`immix` — can't be live-tested; the config can still be saved, just verify
   delivery another way), or `invalid_config` (something about the payload itself was rejected).
4. Once a `test` call returns `success`, apply it for real: `ivedaai_alert_integration` →
   `{action: "apply", type: "request", config: {…same as above…}, alertRuleId: "<uuid>"}` — this
   PATCHes the trigger onto an existing alert rule found via `ivedaai_alert_rule` → `GET /api/alertRules`.
5. Check the `preservation` block in the result. `apply` reads the rule first and re-sends
   everything it can reach — including `roiIds`, `cameraIds`, `hashtags`, `typeLogic` and
   `cooldownInterval` and `abnormalTypes`, which it digs out of the `condition` JSON string (which of
   those a given rule stores there depends on its `alertType`), and `enableForever`, stored as
   `schedule.forever`. Camera targets can also be recovered from `alertRulePermissions[].cameraId`
   when every entry contains a valid ID. `CAMERA_ABNORMAL` updates require a recoverable `cameraIds`
   array; the helper refuses to guess missing targets. Eight other
   type-specific binding lists (`roiTypes`, `lprTypes`, `lineIds`, `lprCategoryIds`, `countingRule`, …)
   have no known source in any read, so nothing can carry them through — but `PATCH
   /api/alertRules` has been live-tested and **merges**, so leaving them out does not reset them. See
   [the design notes](DESIGN.md#fields-you-cannot-simply-read-back) for why this API's reads and writes
   disagree about field names in the first place.
6. Verify an actual event after applying the trigger: use an authorized isolated rule/camera,
   enable the rule, cause its intended event, and correlate the application's alert with the
   receiver's request log. The connection-test action alone does not prove event delivery.
   An isolated camera-connection-failure event passed this sequence on the tested deployment.
   Disable and remove owned fixtures afterward. RAW request bodies use
   `{content: "<payload text>", contentType: "application/json"}`, not a bare string.

### Analyze a video file (upload job)

Use the current `POST /api/jobs/upload` endpoint with an explicit ISO timestamp and UTC offset.
A 12-second synthetic upload completed with the correct persisted timestamp and duration on the
tested deployment. Choose a profile and enabled plugins appropriate for the intended analytics.

1. `ivedaai_camera` → `POST /api/cameras/pseudo` with `body: { name: "incident-upload" }` — creates
   the pseudo camera the job attaches to. Only `name` is required; keep the returned `cameraId`.
2. `ivedaai_engine_profile` → `GET /api/engineProfiles` — find an engine profile id.
3. `ivedaai_job` → `POST /api/jobs/upload` with
   `body: { cameraId: <pseudo camera id>, engineProfileId: <chosen profile id>,
   startTime: "2026-09-04T12:34:56+08:00", usrFileName: "incident.mp4",
   plugins: ["VideoSearch"], doTranscode: false }` and
   `file: { path: "C:\\clips\\incident.mp4" }`.

   The current endpoint returns structured `jobId` and `footageId` fields in the response body.
4. `ivedaai_job` → `GET /api/jobs/{jobId}` — poll the returned ID until processing completes
   (`status: "Completed"`, `progress: 100`) or reaches a failure/cancellation state.
5. `ivedaai_footage` → `GET /api/footages/{footageId}` — verify persisted start/end times and duration.
6. `ivedaai_event` / `ivedaai_scene` — query detected output with footage/camera and time filters.
   Check each endpoint's parameter format; upload timestamp syntax is not universal.

The deprecated `POST /api/jobs` endpoint uses `yyyyMMddHHmmss` in deployment-local time for
`startTime`/`endTime` (for example, `20260904130000`). Spaced timestamps were accepted but silently
misdated by the application during live validation; the MCP now rejects them. Do not use the old
spaced-format upload example from earlier versions of this guide.

For a live camera instead of a file: `POST /api/jobs` with `query: { type: "StreamJob", cameraId: … }`
and no file.

### Face watchlist

1. `ivedaai_face_category` → `GET /api/face/categories` — list watchlist categories.
2. `ivedaai_face_target` → `POST /api/face/targets` — create the person. **Pass the category's
   `name` in `category`, not its `faceCategoryId`** — the id fails with
   `404 ObjectNotFoundException`. `FaceTargetRequest` types the field only as a string and does not
   say which; live testing settled it.
3. `ivedaai_face_target_key` → `POST /api/face/targets/{targetId}/keys` with
   `file: { path: "C:\\photos\\person.jpg" }` — attach a reference photo. The image must contain a
   detectable face; otherwise this returns `400 'No face detected'`.
4. `ivedaai_face_match` — query match history. `start`/`end` are **required**, and must be formatted
   `yyyy-MM-dd HH:mm:ss` — an ISO 8601 value returns `400` despite the spec declaring these as
   `format: date-time`.

### License plates

- `ivedaai_detection` → `POST /api/detection/plates` with `query: { profileId: <validated profile id> }`
  and an image `file` — select a profile verified for that deployment's plate format. Default
  selection and one tested profile missed a positive fixture that another explicit profile read
  correctly. Profile IDs are deployment-specific; validate both a known plate and a no-plate control.
- `ivedaai_license_plate` → `GET /api/lpr/plates` — detection history with plate filters.
  A partial-character filter can include OCR variants; verify exact normalized values before
  reporting an exact-match count. Detection history and the target watchlist are separate records.
- `ivedaai_license_plate_target` / `ivedaai_license_plate_category` — manage plate watchlists;
  bulk import supports a CSV upload via `file`.

### One-off image analysis

`ivedaai_detection` → `POST /api/detection/objects` (or `/plates`, `/colors`) with
`file: { path: "C:\\snapshots\\frame.jpg" }` — run detection on a single image without creating
a camera or job.

## Limits and gotchas

- **Streaming endpoints don't stream.** `GET /api/system/events` (SSE) and the `*.mjpeg` endpoints
  never terminate; a call to them returns after the timeout (default 30 s) with `timedOut: true`
  and whatever data arrived. Use polling (`GET /api/alerts`, `GET /api/jobs`) instead of the event
  stream.
- **Big responses are capped** at 28,672 bytes by default (`truncated: true` past that). For large result
  sets, filter server-side (`size`, time ranges) rather than fetching everything.
- **Supported images are attached for viewing** — JPEG, PNG, GIF and WebP responses become MCP image
  content. Other binary downloads return `{ contentType, byteLength, filename? }` metadata only.
- **Destructive operations are real.** DELETE operations (and tools carrying them are annotated
  `destructiveHint`) permanently remove cameras, targets, footage, etc. on your deployment. There
  is no dry-run mode.
- **Deletes are asynchronous, and a `2xx` does not mean it happened.** `DELETE` here typically
  answers `202 Accepted`; the record can take from a few seconds (a camera) to well over a minute
  (a face target) to disappear. Worse, **deleting a camera whose stream resource is still held is
  dropped silently** — you get `202` and the camera stays. Deactivate it first
  (`POST /api/cameras/{id}/jobs?activate=false`), poll `GET /api/cameras/{id}` until its `status` is
  `Idle`, issue one DELETE, then poll that item GET until it answers `404 Not Found`. Do not replace
  either poll with a fixed delay or trust the `202`.
- **Activating a camera consumes an engine slot, not just a `CameraResource`.** How many cameras you
  can activate is set by **your licence**, not by a fixed product limit. Read
  `GET /api/resources/usage` before adding cameras: each entry's `total` is licensed capacity, and
  activation is refused with `"Number of active cameras has reached the maximum allowed"` as soon as
  any required pool is full — which is often an engine pool (`VideoSearch`,
  `FaceRecognitionEngine`, …) rather than `CameraResource`. The underlying licence, including its
  expiry, is readable via `ivedaai_license` → `GET /api/licenses/ainvr?ainvrIds=…`, whose
  `resources` and `pluginMap` fields are exactly where those totals come from. A pool showing `0` is
  a feature your licence does not include.
- **File uploads read from the server process's filesystem** — the `file.path` must be readable by
  whatever machine runs this MCP server, which matters if you run it remotely. Uploads are disabled
  unless `IVEDAAI_UPLOAD_ROOT` confines them to an approved directory.
- **API version**: the bundled spec is IvedaAI API 10.0.0. If your deployment differs, point
  `IVEDAAI_SWAGGER_PATH` at your server's own OpenAPI document and rebuild — the tools regenerate
  automatically.

## Extending / regenerating

- New spec: replace `resources/openapi.json` (or set `IVEDAAI_SWAGGER_PATH`), rebuild, and rerun
  `npm run docs` to refresh [TOOLS.md](TOOLS.md). Tools, validation, and docs are all generated
  from the spec — there is no per-endpoint code to maintain.
- Tests: `npm test` runs the vitest suite (unit + mock-server integration).
