# Security

## Reporting a vulnerability

Please report security issues privately rather than opening a public issue — use GitHub's
**Report a vulnerability** button on the Security tab of this repository. Include the version, the
deployment shape (on-prem, TLS or plain HTTP), and enough detail to reproduce.

## What this server does by default

## Security notes

- **Token-endpoint credentials are sent as a form-urlencoded POST body**, not query parameters.
  The bundled spec documents the password grant's inputs (`username`/`password`) as query
  parameters, but live testing against a real deployment showed the actual server rejects that
  with `415 Unsupported Media Type` and expects a standard OAuth2
  `application/x-www-form-urlencoded` body instead — which is also the more secure choice, since
  it keeps credentials out of URLs and the access-logs that tend to record them. Always use HTTPS
  in production regardless: plain HTTP still exposes the request body (and everything else) to
  anyone positioned to observe the connection.
- Response headers returned to the model are filtered to a small allowlist (`content-type`,
  `content-length`, pagination headers, etc.); `Set-Cookie` and other sensitive headers are never
  echoed into model context.
- **Response *bodies* are redacted for credential-shaped fields** (`password`, `secret`, `apiKey`,
  `accessToken`, `refreshToken`, etc. — exact key match, not substring, so `tokenType` is left
  alone) before being returned to the model. This was added after live testing turned up a real
  plaintext webhook password inside an existing `AlertRule`'s `trigger` config — several endpoints
  in this API embed downstream integration credentials directly in their response bodies. Redaction
  recurses into JSON-encoded string fields too (`AlertRule.trigger` is itself a JSON string, not a
  nested object). It only affects data read back from the server, not what you send — configuring
  a new integration with real credentials via `ivedaai_alert_integration` works exactly the same.
  Set `IVEDAAI_REDACT_SECRETS=false` to disable if you specifically need raw values back.
- `IVEDAAI_ALLOW_INSECURE_TLS` uses a dedicated undici Agent so certificate verification is only
  relaxed for calls to your configured server — TLS for anything else in the process is unaffected.
- Credentials are only ever read from environment variables and are never logged.

## Defaults worth knowing before you deploy

| default | why |
| --- | --- |
| Writes are **enabled** | Set `IVEDAAI_READ_ONLY=true` for monitoring. It offers GETs and three verified query-only alert POSTs, withholding mutating operations. |
| Collection-emptying deletes are **withheld** | Twenty-one DELETEs take no id in the path, so the only subject would come from an optional request body — and what the API does with that body omitted is unspecified. `IVEDAAI_ALLOW_COLLECTION_DELETE=true` permits them. |
| Credential-shaped response fields are **redacted** | Keys, secrets and passphrases are masked in tool output. `IVEDAAI_REDACT_SECRETS=false` disables it. |
| Insecure transport **warns** | The server writes a warning to stderr when `IVEDAAI_BASE_URL` is plain HTTP to a non-loopback host, or when TLS verification is disabled. |
| Local-file uploads are **disabled** | Set `IVEDAAI_UPLOAD_ROOT` to approve one directory. `IVEDAAI_ALLOW_UNCONFINED_UPLOADS=true` is an explicit compatibility escape hatch, not the default. |

## File uploads

25 operations accept a file, and the path for one arrives as a tool argument — which means it is
chosen by a model, from whatever is in its context. That context includes text this server itself
returned: camera names, alert rule descriptions, watchlist entries, all of it typed by anyone who
can write to your deployment. So "upload the file at this path" is reachable from data, and what it
does is read a local file and POST it to the IvedaAI server.

The file that matters most here is your MCP client's configuration, because on a normal install of
this server it holds `IVEDAAI_PASSWORD` in clear text.

**`IVEDAAI_UPLOAD_ROOT` is the control.** Local-file uploads are disabled until it names the directory
your uploads live in. Nothing outside that directory can be read, whatever path is requested —
symlinks out of the root included. A root configured through a symlink is supported; both the
configured spelling and its canonical target are checked.

`IVEDAAI_ALLOW_UNCONFINED_UPLOADS=true` exists only as an explicit compatibility escape hatch. In
that mode the server still refuses:

- paths inside `.ssh`, `.aws`, `.gnupg`, `.kube`, `.docker`, `.azure` or `gcloud`
- files named `.env`, `.npmrc`, `.netrc`, `.pgpass`, `credentials`, `id_rsa` and similar, or
  `claude_desktop_config.json`
- anything ending `.pem`, `.key`, `.pfx`, `.p12`, `.jks`, `.keystore`, `.ppk`
- anything that is not a regular file or lives on a virtual kernel filesystem such as `/proc`
- anything larger than `IVEDAAI_MAX_UPLOAD_BYTES` (64 MB default)

That list covers where credentials are kept by convention. It is a backstop, not a boundary, and it
is not offered as one — a secret stored anywhere else passes it. File contents are read through the
vetted descriptor and stop at the byte cap, so a final-component symlink swap or growing file cannot
bypass the check.
Prefer a root; do not enable the escape hatch unless compatibility requires it.

## Credentials

`.env` and `.env.*` are ignored by Git, except for the placeholder `.env.example`. Authentication
response bodies are bounded and never echoed in errors. HTTP redirects are refused for both login
and API requests. Redaction covers credential query parameters and URL passwords as well as JSON
fields. Incomplete JSON is withheld; complete SSE events are redacted individually.

Use a dedicated account with minimal IvedaAI privileges. Tool annotations describe risk to a client;
they are not authorization checks. Write-enabled tools include administrative configuration and
server-side network diagnostics, and integrations can contact destinations from IvedaAI's network.
Authorize those capabilities through the application account and the MCP client's approval controls.

`IVEDAAI_USERNAME` and `IVEDAAI_PASSWORD` are read from the environment and never written to disk by
this server. They are, however, visible to anything that can read the MCP client's configuration
file — treat that file as a secret.

## Data handling

Tool responses carry whatever the API returns, which for a video analytics deployment includes
personal data: face-match records, licence plates, and images of people. That content flows to
whichever model the MCP client is talking to. Consider `IVEDAAI_READ_ONLY` and the scope of the
account you configure accordingly.
