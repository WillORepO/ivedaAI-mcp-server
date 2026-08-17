# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Every tool now declares an `outputSchema` and returns `structuredContent` alongside the text
  block, serialised from the same object so the two representations cannot disagree.
- Paged responses carry a `pagination` summary with the current count, total, page, whether more
  data exists, and an operation-specific continuation note. The original response body is unchanged.
- `evaluations/tool-navigation.xml` tests whether a model can find the right call among 316
  operations. `npm run verify:evals` recomputes its answers from the bundled spec, and CI runs it.

### Security

- Local-file uploads are disabled until `IVEDAAI_UPLOAD_ROOT` confines them to an approved
  directory. The explicit `IVEDAAI_ALLOW_UNCONFINED_UPLOADS=true` compatibility escape hatch still
  refuses credential paths, Linux virtual kernel filesystems, non-regular files, and oversized
  files. Approved files are read through a stable descriptor with a hard byte cap.

### Changed

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

## [1.0.0] — unreleased

First packaged release. The server itself predates this entry; what changed is that it is now
installable rather than only buildable from a clone.

### Added

- Published to npm, so an MCP client can launch it with `npx -y ivedaai-mcp-server`.
- `--help` and `--version`, which exit rather than waiting on stdin.
- `.env.example`, a configuration table in the README, and client config snippets.
- `SECURITY.md`, `CONTRIBUTING.md`, and this changelog.

### Changed

- The repository now contains the server and its user documentation only. The engineering log, the
  API findings, the write-coverage inventory, the Tier 4 triage and the live-deployment probes moved
  to Iveda's internal repository — they wrote to real systems and were never part of the product.
- The README leads with installation. Architecture and API behaviour moved to
  [docs/DESIGN.md](docs/DESIGN.md); test documentation moved to
  [CONTRIBUTING.md](CONTRIBUTING.md).
- The published package contains 21 files rather than the 65 that a
  default `npm pack` would have shipped.

### Security

- Collection-emptying DELETEs are withheld unless `IVEDAAI_ALLOW_COLLECTION_DELETE=true`.
- `IVEDAAI_READ_ONLY=true` withholds every non-GET from the tool list rather than refusing at call
  time.
- Credential-shaped response fields are redacted by default.
- The server warns on stderr about plain-HTTP transport to a non-loopback host and about disabled
  TLS verification.
