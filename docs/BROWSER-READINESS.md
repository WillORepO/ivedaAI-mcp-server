# Browser connection readiness

Status reviewed 2026-09-04 (America/Phoenix): **design requirements, not an implemented or deployed
remote service**. Intended customers use ChatGPT or another AI app in a browser.

## What exists

`src/index.ts` connects an MCP server to `StdioServerTransport`. Each process has one configured
IvedaAI origin, application account, token manager, access policy and upload root. There is no
inbound HTTP listener, remote-user authentication or tenant/session registry. `IVEDAAI_BASE_URL`
addresses IvedaAI; it cannot be pasted into ChatGPT as this package's MCP endpoint.

## Connection options

OpenAI documents a public HTTPS endpoint using Streamable HTTP, or Secure MCP Tunnel reaching a
private stdio/HTTP server for developer-mode testing. Public plugin submission still requires a
public HTTPS endpoint. Account/workspace policy determines developer-mode access.
See [OpenAI connection and testing documentation](https://developers.openai.com/plugins/deploy/connect-chatgpt).

| Route | Proposed use here | Remaining work |
| --- | --- | --- |
| Private ChatGPT tunnel | An isolated pilot can reuse the current stdio executable. | Provision a tunnel and supervised runtime, restrict workspace access, use a dedicated restricted application account, and test actual ChatGPT calls. |
| HTTPS MCP service | Customer launch across compatible AI clients. | Implement Streamable HTTP, user authentication, application-account mapping, isolation, operations controls and deployment. Validate each target client. |

A tunnel requires a tunnel ID, runtime key and a machine that can reach the MCP process. It uses
outbound HTTPS, and the target workspace must be associated with it. It is an OpenAI connection
option; compatibility with other AI vendors is not established by that test.
See [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels).

The tunnel does not add per-user IvedaAI identity to this stdio process. Every user allowed to
invoke a process receives that process's application authority. Scope a pilot accordingly.

## Proposed hosted service

The following are project design requirements, not features already provided by the package.

1. Separate reusable tool registration from CLI startup. Construct the server with an explicit
   request/account context; keep the existing stdio entry point working.
2. Add a Streamable HTTP entry point behind verified HTTPS. Enforce request size, concurrency,
   timeouts, origin/host policy, session ownership and cancellation. A session identifier must
   never substitute for authorization. Return useful protocol errors without exposing secrets.
3. Authenticate each incoming request, resolve the authorized customer and user, then obtain
   that identity's permitted IvedaAI connection. Do not select the upstream origin or account from
   model-controlled tool arguments. Do not reuse the current global token manager across users.
4. Keep incoming MCP authorization separate from outgoing IvedaAI login. Scope cached upstream
   tokens, refreshes, upload storage and cancellation to their owning account. Use an approved
   secret store for any required credentials. Revoke access when a customer disconnects.
5. Offer a limited initial tool surface for the chosen customer workflows. Application record
   permissions and server-enforced operation policy must hold even when client confirmation is
   bypassed. Existing read-only mode is useful but does not supply customer isolation.
6. Define browser uploads separately. A Windows `file.path` refers to the machine running MCP;
   it does not read a customer's computer from ChatGPT. Until an authenticated upload workflow
   with ownership, size limits and expiry is implemented, omit uploads from the remote pilot.
7. Record redacted audit events with customer/user, operation, outcome and correlation ID.
   Establish service health, rate limits, restart behavior and rollback before enabling customers.

For authenticated OpenAI MCP connections, use an established OAuth 2.1 identity provider with
discovery and an authorization-code/PKCE flow supported by the target client. The MCP resource
server must verify tokens, issuer, audience, expiry and scopes on requests. Publish protected
resource metadata and appropriate authentication challenges. The existing upstream password
grant does not implement this incoming authorization flow.
See [OpenAI authentication documentation](https://developers.openai.com/plugins/build/auth).

## Deployment decisions still needed

- Whether customers share a company-hosted IvedaAI service, use separate installations, or both.
- Where the MCP runtime can reach those installations and who operates it.
- Which customer sign-in system and upstream account mapping the service will use.
- Whether the first release is a private pilot or a publicly distributed integration.

These decisions determine routing and account isolation. No host, domain, identity provider,
tunnel, customer credential store or production endpoint has been created by this audit.

## Acceptance checks before browser launch

| Check | Required evidence |
| --- | --- |
| Actual browser client | Discovery and representative read calls from the chosen ChatGPT workspace; repeat in each additionally advertised client. |
| Sign-in | Successful linking plus rejection of missing, expired, wrong-issuer and wrong-audience credentials; disconnect/revocation works. |
| Isolation | Two customers and two differently privileged users; IDs, session reuse, concurrent calls and token refresh cannot cross boundaries. |
| Authority | Allowed camera read succeeds; denied camera and administrative/write calls fail at the server/application boundary. |
| Network | Trusted TLS on the selected path; approved reachability to IvedaAI; no client-controlled origin selection. |
| Reliability | Reconnect, cancellation, process restart and bounded load; no continuing privileged session after access is revoked. |
| Media, if enabled | Only owned staged files are usable; expired or another customer's files are rejected. |

The existing application integration checks establish useful API behavior. They do not establish
any of these remote connection or multi-customer guarantees.
