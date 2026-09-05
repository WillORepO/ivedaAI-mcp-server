# Browser connection readiness

Status reviewed 2026-09-04 (America/Phoenix): an **authenticated HTTP preview is implemented and
locally tested, but not deployed or verified with a customer browser client**. See [REMOTE.md](REMOTE.md).
Intended customers use ChatGPT or another AI app in a browser.
Each customer has their own IvedaAI server; there is no shared upstream installation.
Network access varies by customer: some installations are internet-accessible and others require
a private network or VPN. Both deployment paths must be supported in the product design.

## What exists

`src/index.ts` retains the stdio connection. Reusable tool registration in `src/server.ts` receives
an explicit account/policy context. `src/http.ts` adds a loopback HTTP listener with JWT validation,
OAuth resource metadata and operator-configured subject/account mappings. It uses a fixed customer
origin and fresh request contexts, with read-only access and uploads disabled. No identity provider,
HTTPS proxy, tenant relay or production endpoint has been provisioned. `IVEDAAI_BASE_URL` addresses
IvedaAI; it cannot be pasted into ChatGPT as this package's MCP endpoint.

## Connection options

OpenAI documents a public HTTPS endpoint using Streamable HTTP, or Secure MCP Tunnel reaching a
private stdio/HTTP server for developer-mode testing. Public plugin submission still requires a
public HTTPS endpoint. Account/workspace policy determines developer-mode access.
See [OpenAI connection and testing documentation](https://developers.openai.com/plugins/deploy/connect-chatgpt).

| Route | Proposed use here | Remaining work |
| --- | --- | --- |
| Private ChatGPT tunnel | An isolated pilot can reuse the current stdio executable. | Provision a tunnel and supervised runtime, restrict workspace access, use a dedicated restricted application account, and test actual ChatGPT calls. |
| HTTPS MCP service | Customer launch across compatible AI clients. | Local HTTP/JWT/account-isolation preview exists. Configure identity-provider/proxy integration, verify revocation/load, and validate each target client. |

A tunnel requires a tunnel ID, runtime key and a machine that can reach the MCP process. It uses
outbound HTTPS, and the target workspace must be associated with it. It is an OpenAI connection
option; compatibility with other AI vendors is not established by that test.
See [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels).

The tunnel does not add per-user IvedaAI identity to this stdio process. Every user allowed to
invoke a process receives that process's application authority. Scope a pilot accordingly.

## Separate customer installations

The proposed baseline is one isolated connector runtime for each customer installation, placed
on the IvedaAI host or another managed host that can reach it. This is a design choice based on
the confirmed separate-server topology, not evidence that a connector has been installed.

```text
Customer A's authorized AI users -> A's connection -> A's MCP runtime -> A's IvedaAI server
Customer B's authorized AI users -> B's connection -> B's MCP runtime -> B's IvedaAI server
```

Each runtime has a fixed upstream origin and separate credentials, token cache, service identity
and configuration. Provision connection access only for the intended customer. Different URLs
or tunnel names alone are not authorization boundaries. Select the network path per installation:
an internet-accessible IvedaAI web interface does not itself provide a remote MCP endpoint.

| Customer network | Connection design | Status |
| --- | --- | --- |
| Inbound HTTPS to MCP is permitted | Authenticated Streamable HTTP endpoint on a customer-approved host; its upstream origin is fixed to that customer's IvedaAI server. | HTTP/JWT boundary tested locally; real identity-provider, proxy and browser validation remain. |
| Private network/VPN, ChatGPT pilot | Customer-local stdio process reached through its dedicated outbound OpenAI tunnel. | Existing MCP code can be reused; tunnel provisioning and browser checks remain. |
| Private network/VPN, other browser clients | Customer-approved remote access or an authenticated outbound relay connecting to a compatible HTTPS MCP endpoint. | Relay/access product and client support are not selected or validated. Do not advertise this path as ready. |

An internet-accessible IvedaAI installation does not automatically authorize exposing MCP.
Where inbound access is prohibited, keep that boundary and use the approved outbound route.
For a future relay, bind its installation credential to one provisioned customer and upstream,
authenticate both ends, and reject route/session substitution before forwarding any tool call.

For a private ChatGPT pilot, use a dedicated tunnel restricted to the pilot customer's workspace
and one restricted IvedaAI account. All pilot users must be authorized for that account's complete
read surface. This avoids claiming per-user application permissions that stdio does not implement.
See the [customer pilot runbook](CUSTOMER-PILOT.md) for inputs, checks and teardown.

For browser clients requiring HTTPS, use an authenticated customer-specific MCP service with the
same fixed upstream boundary. If a shared Iveda-operated gateway is introduced later, it must
authenticate users before resolving a provisioned customer route and bind the route to a verified
connector identity. A customer ID, server URL or camera ID supplied by the model cannot select a
different customer's connection. Any relay for private networks needs separate implementation
and review; OpenAI's tunnel is not assumed to work with other AI vendors.

Separate customer processes do not solve differing permissions among users of one customer.
Those users still need individual application-account mapping, or an explicitly shared restricted
role accepted for the pilot. Revoking a user must invalidate that user's connection/session access.

## Proposed hosted service

The following are project design requirements. The initial implementation covers explicit contexts,
stateless HTTP, JWT validation and fixed subject/account mappings in read-only mode. It does not
complete the deployment, operational or identity-provider integration requirements below.

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

- Confirmed: every customer has a separate IvedaAI installation.
- Confirmed: internet versus private-network/VPN access varies by customer.
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
| Isolation | Two customers with overlapping camera IDs and two differently privileged users; forged customer routes, session reuse, concurrent calls and token refresh cannot cross boundaries. |
| Authority | Allowed camera read succeeds; denied camera and administrative/write calls fail at the server/application boundary. |
| Network | Trusted TLS on the selected path; approved reachability to IvedaAI; no client-controlled origin selection. |
| Reliability | Reconnect, cancellation, process restart and bounded load; no continuing privileged session after access is revoked. |
| Media, if enabled | Only owned staged files are usable; expired or another customer's files are rejected. |

The existing application integration checks establish useful API behavior. They do not establish
any of these remote connection or multi-customer guarantees.
