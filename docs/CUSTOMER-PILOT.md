# One-customer browser pilot

Prepared for customers who each operate their own IvedaAI server. This is an operator runbook;
no customer runtime, tunnel or public endpoint has been provisioned. Start with an authorized
test installation. The existing stdio executable can support a private ChatGPT tunnel pilot,
subject to actual workspace access and end-to-end verification.
Customers have mixed network access. This runbook covers the outbound ChatGPT pilot route for
either network type; it does not configure a public MCP listener or a relay for another AI vendor.

## Record the installation boundary

Keep an operator record of the customer, fixed IvedaAI origin, runtime host, responsible operator,
permitted ChatGPT workspace/users and restricted IvedaAI account. Store credentials separately in
the customer's protected service configuration. Do not put credentials or camera media in the
repository, chat, tunnel name or command-line arguments.

Confirm whether the host reaches IvedaAI locally, over a private network/VPN, or over verified
HTTPS. Do not assume a VPN connection on a user's laptop also provides access to a cloud AI app.
Check the runtime host's path to IvedaAI directly. The test deployment's earlier HTTP results are
not production TLS validation.

## Prepare the local MCP process

1. Build the reviewed commit using the supported Node runtime and lockfile. Use the built
   executable at an absolute path; the initial npm publication has not been completed.
2. Create a dedicated IvedaAI account with only the required camera/record grants. Complete the
   application's required first-login password change before configuring MCP.
3. Set the service's `IVEDAAI_BASE_URL`, `IVEDAAI_USERNAME` and `IVEDAAI_PASSWORD`. Use
   `IVEDAAI_READ_ONLY=true`, `IVEDAAI_REDACT_SECRETS=true`,
   `IVEDAAI_ALLOW_COLLECTION_DELETE=false`, `IVEDAAI_ALLOW_UNCONFINED_UPLOADS=false` and
   `IVEDAAI_ALLOW_INSECURE_TLS=false`. Leave `IVEDAAI_UPLOAD_ROOT` unset for this pilot.
   Isolate the service environment so inherited settings cannot enable unwanted capabilities.
4. Supply any approved private CA trust through the runtime's supported trust configuration and
   validate it on that host. Keep certificate verification enabled. Run the service under an
   unprivileged OS identity with access only to its installation and protected configuration.
5. Verify MCP discovery, one granted camera read and one denied camera read locally. The current
   default specification exposes 55 tools / 132 operations in read-only mode; confirm the actual
   list rather than assuming every read is appropriate for the pilot audience.

`.env` files are not loaded automatically by this package. Configure environment injection through
the service manager or explicit Node environment-file loading. Protect the file and ensure the
service manager does not print its contents. Do not reuse another customer's configuration.

## Connect the private ChatGPT pilot

Use [OpenAI's Secure MCP Tunnel setup](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)
to provision a dedicated tunnel, associate only the intended workspace/organizations, and configure
the local stdio command. A runtime key and tunnel access are separate from IvedaAI credentials.
Run the tunnel under supervision on the host that can reach MCP, check its diagnostic/readiness
output, and connect it from the authorized ChatGPT workspace. This setup has not been executed
by this audit. It does not establish another vendor's browser compatibility.

The current process uses one IvedaAI account. Only include pilot users who may exercise that
account's entire permitted surface. Do not grant a whole customer workspace broader application
access merely because its users belong to the same company. If their grants differ, implement
per-user account mapping before including them in this connection.

## Capture acceptance evidence

Record the commit, application build, runtime version, customer connection identity, permitted
tools and outcomes without saving credentials. Verify:

- Browser discovery and a granted camera read succeed.
- Ungranted camera access and writes fail at the application/MCP boundary.
- Another customer's connection cannot access this runtime, even when camera IDs overlap.
- An unauthorized workspace/user cannot invoke the connection; removing access blocks new calls.
- Restart/reconnect works, and requests fail clearly when the runtime or upstream is unavailable.
- Production certificates validate and no upload path is accessible through this pilot.

Do not record a check as passed based on a different customer's installation or local-only tests.
The sample-image and event-delivery tests in the audit establish upstream behavior, not these
browser and customer-isolation checks.

## End or revoke the pilot

Remove the AI connection's access, stop the tunnel/runtime, and revoke the dedicated tunnel key
and IvedaAI account when they are no longer needed. Remove tunnel workspace associations or the
owned tunnel resource as appropriate; stopping its process does not remove the remote resource.
Verify that previously authorized clients can no longer discover or call the service. Retain
redacted acceptance evidence according to the customer's retention policy.
