# Contributing

## Getting set up

```bash
npm install
npm run build
npm test
```

Node 20.18.1 is the floor — `undici` 7 declares it, so the package cannot run below it whatever
`engines` says. CI runs the suite on 20.18.1 and 24.x.

## Before opening a pull request

```bash
npm run typecheck   # covers src/, test/ and scripts/, which `build` does not
npm test
npm run docs        # regenerate docs/TOOLS.md if you changed tool descriptions
```

`npm run build` only compiles `src/` — that is the shipped artefact and its scope should stay that
way. `typecheck` is what covers everything else.

## Regenerating the tool reference

`docs/TOOLS.md` is generated. Run `npm run docs` and commit the result; CI does not do it for you.

## Tests

```bash
npm test
```

Runs a vitest suite: unit tests for URL building, query encoding, and argument validation, plus
integration tests against a local mock server covering the token flow, 401 re-auth retry,
timeouts, streaming-response truncation, optional-file multipart operations, and response-header
filtering. The CRUD-probe tests (below) also run here against a mock, including fault-injected
cases — a `DELETE` that reports success without deleting, an update that fails mid-lifecycle — so
the probe is verified to actually catch failures, not just to pass.

The suite needs no credentials and no deployment: the integration and MCP tests bring up their own
mock HTTP server, and `test/mcp.test.ts` spawns the real server over stdio against it, so a
mis-wired tool surface fails here rather than in front of a user.

### Live-deployment probes

A separate suite of probes exercises this server against a real IvedaAI deployment — read-only
smoke tests, full create/read/update/delete lifecycles, and the workflows the usage guide
documents. Those are **not in this repository**: they write to a live system, they are gated behind
`IVEDAAI_ALLOW_WRITE_PROBE=true`, and the findings they produced are internal engineering material.

They live with the rest of that material in Iveda's internal repository. Ask there if you need to
re-run them against a deployment.

## Releasing

Releases are tag-driven. Bump the version, update [CHANGELOG.md](CHANGELOG.md), then:

```bash
git tag v1.2.3 && git push origin v1.2.3
```

The release workflow rebuilds, typechecks, runs the tests, verifies the tag matches
`package.json`, confirms `dist/index.js` and `resources/openapi.json` are actually in the tarball,
and publishes to npm. It needs an `NPM_TOKEN` secret with publish rights.
