# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
- The published package contains `dist/` and `resources/` only — 19 files rather than the 65 that a
  default `npm pack` would have shipped.

### Security

- Collection-emptying DELETEs are withheld unless `IVEDAAI_ALLOW_COLLECTION_DELETE=true`.
- `IVEDAAI_READ_ONLY=true` withholds every non-GET from the tool list rather than refusing at call
  time.
- Credential-shaped response fields are redacted by default.
- The server warns on stderr about plain-HTTP transport to a non-loopback host and about disabled
  TLS verification.
