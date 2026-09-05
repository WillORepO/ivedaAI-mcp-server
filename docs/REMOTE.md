# Authenticated HTTP preview

The repository now includes a read-only Streamable HTTP entry point, `dist/http.js`, alongside
the unchanged stdio command. It is tested against local mock services and signed test tokens.
It has **not** been deployed, linked to a real identity provider, or tested from a customer's
ChatGPT workspace. Private-network relay support for other AI vendors is not implemented.

## One installation, explicit user accounts

Run one instance per customer installation. Its configuration fixes the IvedaAI origin and maps
verified OAuth subjects to individual IvedaAI accounts. Those accounts' application permissions
remain authoritative. The incoming OAuth token is never forwarded to IvedaAI.

Each HTTP request gets a fresh MCP server and upstream token manager. There are no shared MCP
sessions or persistent upstream token caches across requests. This trades additional upstream
logins for simple isolation in the preview; measure authentication load before production use.

Remote access is always read-only, collection deletion is disabled, secret redaction is enabled,
and local-file uploads are disabled. Stdio's environment switches cannot enable remote writes
or uploads. The bundled read-only surface is 55 tools / 132 operations; review its full read
surface against the intended users' application grants.

## Identity provider requirements

Use an existing OAuth/OIDC authorization server. This package implements the MCP resource server;
it does not provide login pages, register OAuth clients, or issue access/refresh tokens. Configure
the identity provider's authorization-code flow with PKCE and discovery for the selected client.
See [OpenAI authentication requirements](https://developers.openai.com/plugins/build/auth).

This implementation accepts signed JWT access tokens with:

- RS256 or ES256 signatures from the operator-configured HTTPS JWKS URL.
- An exact configured `iss` and a single `aud` equal to the public MCP URL, including `/mcp`.
- A configured nonempty `sub`, `iat`, `exp`, and the space-delimited `ivedaai:read` scope.
- Valid time claims, token age at most one hour, and lifetime at most one hour.

Opaque tokens and tokens for other resources are rejected. JWKS requests do not follow redirects,
are limited to 64 KiB and three seconds, and use the library's rotation/cache behavior. JWT
validation does not perform online revocation/introspection. An otherwise valid token may remain
usable until expiry. To revoke a mapped user immediately at this service, remove its subject
mapping and restart the instance; restart closes active requests. Disconnecting a client alone
does not invalidate its JWT. Production rollout must establish the required revocation policy.

## Configuration and startup

Build with `npm ci` and `npm run build`. Create a protected JSON file **outside the repository**,
using this shape and actual values supplied by the installation and identity-provider operators:

```json
{
  "publicUrl": "https://mcp.customer.example/mcp",
  "issuer": "https://identity.customer.example/",
  "jwksUrl": "https://identity.customer.example/keys",
  "upstreamOrigin": "https://ivedaai.customer.example",
  "port": 3000,
  "subjects": [
    {
      "subject": "stable-subject-from-the-identity-provider",
      "username": "dedicated-ivedaai-user",
      "password": "replace-in-protected-configuration"
    }
  ]
}
```

The subject is the identity provider's stable `sub` claim, not a model-provided username or an
assumed email address. Exact issuer spelling, including a trailing slash, matters. Duplicate
subjects and unknown configuration fields are rejected. All configured URLs require HTTPS;
the upstream is an origin without a path. The public MCP path must be `/mcp`.

Start the built entry point with one configuration-file argument:

```text
node /absolute/path/to/dist/http.js /protected/path/customer.json
```

The listener binds **only to 127.0.0.1**. Place a trusted HTTPS reverse proxy on the same host,
forwarding `/mcp` and `/.well-known/oauth-protected-resource` to the configured port. Preserve the
canonical public Host header or use the loopback host/port. Forward Authorization without logging
it. The service does not trust forwarded identity, customer-route or upstream-URL headers.
Configure the proxy's own connection/rate limits and trusted certificates; no proxy, DNS record
or certificate is provisioned by this package. Internal HTTP is confined to loopback.

MCP Origin headers, when present, must match the public endpoint's origin. This endpoint is for
server-to-server MCP clients, including the backend of a browser AI app; it does not expose a
cross-origin browser JavaScript API or permissive CORS. JWKS and IvedaAI certificate verification
stay enabled. Configure approved private-CA trust on the runtime host where necessary.

Use an unprivileged dedicated OS account and protect the configuration from other users.
Complete any IvedaAI first-login password change before starting. Restart to apply configuration
changes. Do not set a custom `IVEDAAI_SWAGGER_PATH` for the HTTP entry point.

## Protocol and limits

- `GET /.well-known/oauth-protected-resource` publishes the public resource, issuer and read scope.
- MCP requests require an Authorization bearer token on every call, including discovery.
  Invalid tokens receive 401 and a discovery challenge; unmapped subjects or missing scope receive 403.
- `POST /mcp` accepts JSON and returns JSON MCP responses. GET/DELETE at `/mcp` return 405 after
  authentication. No resumable SSE stream, legacy SSE endpoint or session identifier is offered.
  Supplied session identifiers are rejected; they never grant access.
- Bodies are capped at 256 KiB; compressed bodies are rejected. At most 16 requests run concurrently,
  with at most four per mapped subject. The request deadline is 30 seconds, upstream timeout 25 seconds.
- Request closure and service shutdown abort that request's upstream work. Cross-request MCP
  cancellation notifications do not cancel another stateless request; no resumable operation state
  is retained. Writes are disabled, limiting uncertain write outcomes in this preview.

## Validation and remaining release gates

Tests use generated signing keys, two isolated mock customer servers with overlapping camera IDs,
two application accounts and a real SDK HTTP client. They check discovery, issuer/audience/time/
signature/scope validation, account mapping, camera denials, write refusal, invalid host/origin,
duplicate authorization headers, body limits and absence of session authority.

Before a customer pilot, configure and verify the real identity provider's metadata, consent and
token claims; verify TLS through the actual proxy; test linking and representative reads in the
target browser AI app; confirm revocation and user permissions; and measure upstream login and
concurrency behavior. No production-readiness or browser-client compatibility claim follows from
the local mock tests. For a private ChatGPT stdio tunnel pilot, see [CUSTOMER-PILOT.md](CUSTOMER-PILOT.md).
