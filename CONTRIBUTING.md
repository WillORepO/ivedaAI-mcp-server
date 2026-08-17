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
npm run verify:evals
```

`npm run build` only compiles `src/` — that is the shipped artefact and its scope should stay that
way. `typecheck` is what covers everything else.

## Regenerating the tool reference

`docs/TOOLS.md` is generated. Run `npm run docs` and commit the result; CI regenerates it and fails
with the diff if it is stale.

## Tests

```bash
npm test
```

Runs a vitest suite: unit tests for URL building, pagination, output contracts, upload confinement,
query encoding, and argument validation, plus integration tests against a local mock server covering
the token flow, retries, timeouts, streaming-response truncation, multipart operations, and
response-header filtering. MCP tests spawn the real server over stdio and verify its transmitted
tool definitions and structured results.

The suite needs no credentials and no deployment: the integration and MCP tests bring up their own
mock HTTP server, and `test/mcp.test.ts` spawns the real server over stdio against it, so a
mis-wired tool surface fails here rather than in front of a user.

### Evaluations

`evaluations/tool-navigation.xml` asks whether a model can navigate the 63 tools and 316 operations
using only their descriptions. Its ten answers are fixed by the bundled spec, so
`npm run verify:evals` checks them without credentials or a deployment. CI runs that check. See
[`evaluations/README.md`](evaluations/README.md) for model-facing execution and extension guidance.

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

Before pushing the tag, confirm `NPM_TOKEN` exists in the repository's Actions secrets and has
publish rights for the package. The release workflow rebuilds, typechecks, runs tests, measurements
and static evaluations, verifies generated docs, verifies the tag matches `package.json`, asserts the
21-file package boundary, installs the actual tarball, smoke-tests its CLI, and only then publishes
to npm with provenance and creates the GitHub Release.

For the first `1.0.0` publication, the npm package does not exist yet: the token's account or
organisation must be allowed to create the unscoped `ivedaai-mcp-server` package. Do not push
`v1.0.0` merely to test credentials—a published version number cannot be reused.
