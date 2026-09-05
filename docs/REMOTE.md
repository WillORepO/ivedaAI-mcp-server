# Authenticated HTTP preview

The repository now includes a read-only Streamable HTTP entry point, `dist/http.js`, alongside
the unchanged stdio command. It is tested against local mock services and signed test tokens.
Existing IvedaAI login, token exchange, a camera read, refresh and revocation also passed through
a temporary loopback connector against the authorized test deployment. It has **not** been deployed
or tested from a customer's ChatGPT workspace or through production TLS. Private-network relay
support for other AI vendors is not implemented.

## One installation, explicit user accounts

Run one instance per customer installation. Its configuration fixes the IvedaAI origin and maps
users to their individual IvedaAI accounts. In the primary `auth: "ivedaai"` mode, users enter
their existing IvedaAI username/password in the connector's HTTPS login page and consent to read
access. The connector validates the login against that installation and issues a separate opaque
MCP token. IvedaAI's application permissions remain authoritative. The MCP token is never
forwarded to IvedaAI, and the AI client never receives the user's IvedaAI password.

Each HTTP request gets a fresh MCP server and upstream token manager. There are no shared MCP
sessions or persistent upstream token caches across requests. This trades additional upstream
logins for simple isolation in the preview; measure authentication load before production use.

Remote access is always read-only, collection deletion is disabled, secret redaction is enabled,
and local-file uploads are disabled. Stdio's environment switches cannot enable remote writes
or uploads. The bundled read-only surface is 55 tools / 132 operations; review its full read
surface against the intended users' application grants.

## Use existing IvedaAI login

No separate identity provider or duplicate user account is required. The connector supplies the
OAuth compatibility layer using the MCP SDK's authorization-code/PKCE routes. It accepts only
pre-registered public clients with exact HTTPS callback URLs and the `ivedaai:read` scope.
Copy the exact redirect URI shown by the AI app into the configuration; do not guess a callback
or allow wildcard destinations. Enter the matching client ID in the AI app's connection setup.
See [OpenAI callback and OAuth requirements](https://developers.openai.com/plugins/build/auth).

Create a protected installation configuration outside the repository:

```json
{
  "auth": "ivedaai",
  "publicUrl": "https://mcp.customer.example/mcp",
  "upstreamOrigin": "https://ivedaai.customer.example",
  "port": 3000,
  "clients": [
    {
      "clientId": "customer-approved-ai",
      "name": "Approved AI app",
      "redirectUris": ["https://ai-app.example/exact-callback-from-app-settings"]
    }
  ]
}
```

This configuration contains no IvedaAI passwords. Login passwords are retained in the connector's
process memory for at most one hour to make upstream calls and revalidate refreshes. They are not
written to a credential database or configuration file. Run under a protected service identity;
process dumps or access to its memory can expose credentials. Dropping references is not a claim
of secure memory erasure.

Login attempts are protected by an expiring, single-use form transaction, secure HttpOnly cookie,
same-origin check, CSRF token, explicit consent and attempt limits. Authorization codes last one
minute and require the matching PKCE verifier, client, callback and resource. Access tokens last
up to five minutes. Refresh tokens rotate; reusing an old refresh token revokes that grant.
`/revoke` invalidates the entire grant and aborts its active MCP requests. The maximum grant
lifetime is one hour, after which the user signs in again. Restart invalidates all grants.

The preview keeps bounded grants and token hashes in memory. It does not provide durable login
state, high-availability replication or dynamic client registration. It cannot perform an IvedaAI
MFA challenge or federated SSO flow; accounts requiring unsupported authentication remain blocked.
Do not disable their protections to make the connector work. Application account setup and required
first-login password changes must be completed in IvedaAI. Upstream password/account changes are
checked on refresh and on subsequent upstream logins; discovery may remain available until local
revocation or expiry. Each customer's operator must establish its production access-revocation policy.

## Optional external identity provider

The alternative JWT mode can use an existing OAuth/OIDC authorization server. In that mode the
package acts only as the MCP resource server and does not issue tokens. Configure
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

Build with `npm ci` and `npm run build`. Use the native IvedaAI configuration above, or this
alternative JWT configuration with values supplied by the identity-provider operator. Keep either
file **outside the repository**:

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
forwarding `/mcp` and `/.well-known/oauth-protected-resource` to the configured port. For native
IvedaAI login also forward `/authorize`, `/login`, `/token`, `/revoke`,
`/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource/mcp`. Preserve the
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

Native-login tests additionally cover form binding/consent, failed passwords, PKCE, client/resource/
callback binding, code replay/expiry, token rotation/reuse, revocation and login-attempt limits.
Existing IvedaAI credentials also passed a controlled live login/read/refresh/revoke sequence.

Before a customer pilot, configure the approved AI client and callback, verify the chosen account
login flow and TLS through the actual proxy, and test linking and representative reads in the
target browser AI app; confirm revocation and user permissions; and measure upstream login and
concurrency behavior. No production-readiness or browser-client compatibility claim follows from
local mock tests or the loopback live test. For a private ChatGPT stdio tunnel pilot, see [CUSTOMER-PILOT.md](CUSTOMER-PILOT.md).
