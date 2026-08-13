# ivedaai-mcp-server

[![CI](https://github.com/WillORepO/ivedaAI-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/WillORepO/ivedaAI-mcp-server/actions/workflows/ci.yml)

An MCP server for the **IvedaAI** video analytics API. Point an MCP client — Claude Desktop, Claude
Code, or anything else that speaks the protocol — at your IvedaAI deployment and drive it in natural
language: search footage, manage cameras and alert rules, run analysis jobs, work with face and
licence-plate watchlists.

316 API operations are exposed as 63 tools, one per resource type. See [why](docs/DESIGN.md#design).

## Quickstart

Add this to your MCP client's configuration. Nothing to install first — `npx` fetches it.

```json
{
  "mcpServers": {
    "ivedaai": {
      "command": "npx",
      "args": ["-y", "ivedaai-mcp-server"],
      "env": {
        "IVEDAAI_BASE_URL": "https://ivedaai.example.com",
        "IVEDAAI_USERNAME": "your-username",
        "IVEDAAI_PASSWORD": "your-password"
      }
    }
  }
}
```

**Where that file lives:**

| client | path |
| --- | --- |
| Claude Desktop (macOS) | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Claude Desktop (Windows) | `%APPDATA%\Claude\claude_desktop_config.json` |
| Claude Code | `claude mcp add ivedaai --env IVEDAAI_BASE_URL=… --env IVEDAAI_USERNAME=… --env IVEDAAI_PASSWORD=… -- npx -y ivedaai-mcp-server` |

Restart the client, and ask it something like *"list the cameras that are currently offline"*.

**Try it without a client:**

```bash
IVEDAAI_BASE_URL=https://ivedaai.example.com \
IVEDAAI_USERNAME=you IVEDAAI_PASSWORD=secret \
npx -y ivedaai-mcp-server
```

It speaks JSON-RPC over stdin/stdout and logs a startup line to stderr. `--help` prints the
configuration reference; `--version` prints the version.

## Read-only first

If you are evaluating this, or connecting it to anything you would not want to write to, start here:

```json
"env": { "IVEDAAI_READ_ONLY": "true", "IVEDAAI_BASE_URL": "…", "IVEDAAI_USERNAME": "…", "IVEDAAI_PASSWORD": "…" }
```

Every non-GET is withheld from the tool list entirely rather than merely refused, and it roughly
halves what the tool descriptions cost on connect.

## Configuration

Only the first three are required.

| Variable | Default | Description |
| --- | --- | --- |
| `IVEDAAI_BASE_URL` | — | Origin of your IvedaAI server, e.g. `https://ivedaai.example.com`. No path. |
| `IVEDAAI_USERNAME` | — | IvedaAI account username. |
| `IVEDAAI_PASSWORD` | — | IvedaAI account password. |
| `IVEDAAI_READ_ONLY` | `false` | `true` serves reads only: non-GET operations are withheld from every tool, and the two write-oriented convenience tools are not registered. |
| `IVEDAAI_ALLOW_COLLECTION_DELETE` | `false` | `true` permits the 20 DELETEs that name no record — see [Destructive operations](#destructive-operations). |
| `IVEDAAI_REDACT_SECRETS` | `true` | Masks credential-shaped fields (keys, secrets, passphrases) in responses. `false` disables it. |
| `IVEDAAI_ALLOW_INSECURE_TLS` | `false` | `true` skips TLS certificate verification, for on-prem deployments with self-signed certificates. Traffic stays encrypted; the certificate is not checked. Scoped to this server's requests, not process-wide. |
| `IVEDAAI_TIMEOUT_MS` | `30000` | Per-request timeout, including reading the response body. Several IvedaAI endpoints block rather than failing fast when a camera is unreachable, so this matters. |
| `IVEDAAI_MAX_RESPONSE_BYTES` | `28672` | Response body bytes read before truncating. Sized for what a model client can receive, not for what the API can send — bisected against a real client, 38 KB reached the model and 57 KB did not. Larger responses come back flagged `truncated` with a note saying to narrow the request. |
| `IVEDAAI_CLIENT_ID` / `IVEDAAI_CLIENT_SECRET` | — | Sent as HTTP Basic auth on the token request, if your deployment requires client credentials. |
| `IVEDAAI_ALLOW_LOSSY_UPDATE` | `false` | `true` disables the [lossy-update guard](docs/DESIGN.md#the-lossy-update-guard). Intended for the maintainers' CRUD probe; leave it unset. |
| `IVEDAAI_SWAGGER_PATH` | bundled | Path to an alternate OpenAPI 3 document, if your deployment's API differs from the bundled one. |

Copy [`.env.example`](.env.example) if you prefer a file.

### Authentication

OAuth2 password grant against `POST {base}/ainvr/api/oauth2/token`. The server logs in on first use,
caches the access token, and refreshes it as it nears expiry. Note that the token endpoint is rate
limited: a client that starts a fresh process per request will hit it.

### Destructive operations

Twenty of this API's DELETEs take no id in the path — `DELETE /api/cameras` versus
`DELETE /api/cameras/{cameraId}`. The only subject would come from an optional request body, and what
the API does when that body is omitted is not specified anywhere. One character of difference, and
the mistake cannot be undone.

**They are withheld by default**: absent from the tool descriptions and the `operation` enum, and
refused with an explanation naming the single-record alternative if a client sends one anyway. Set
`IVEDAAI_ALLOW_COLLECTION_DELETE=true` to permit them. `IVEDAAI_READ_ONLY=true` overrides that.

See [SECURITY.md](SECURITY.md) for the rest of the defaults, and for what leaves your deployment.

## Using it

Every tool takes an `operation` and the arguments that operation needs:

```json
{ "operation": "GET /api/cameras", "query": { "size": 20, "nameContains": "lobby" } }
```

- **[Usage guide](docs/USAGE.md)** — calling conventions and worked workflows: onboarding cameras,
  alert rules, analysis jobs, face and licence-plate watchlists.
- **[Tool reference](docs/TOOLS.md)** — every tool, operation and parameter.
- **[Design and behaviour](docs/DESIGN.md)** — why one tool per resource type, what the server does
  about partial updates the API silently discards, and the response format.

If a model needs the exact shape of a request body, `ivedaai_get_schema` returns it on demand rather
than every tool description carrying it.

## Requirements

Node 20.18.1 or newer, and an IvedaAI 10.0 deployment. The bundled API document is 10.0; point
`IVEDAAI_SWAGGER_PATH` at your own if you run something else.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Upgrading the API document?
`npm run diff:spec -- --against <new-spec.json>` reports what changed and, more usefully, whether
anything this repo records now points at an operation that no longer exists.

## License

MIT — see [LICENSE](LICENSE).
