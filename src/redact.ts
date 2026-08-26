/**
 * Redacts credential-shaped values from parsed JSON response bodies before
 * they reach model context.
 *
 * Motivated by a live finding: GET /api/alertRules/{id} returned a real
 * plaintext password in trigger.request.requests[].authorization.password
 * for an existing webhook integration. The response-header allowlist
 * (request.ts) doesn't help here — this is response *body* content, which
 * can appear on any endpoint whose schema embeds downstream credentials
 * (alert rule triggers, camera RTSP account/password, etc.), not just one.
 *
 * Two rules, and only two.
 *
 * Known secret-value field *names* are redacted (exact match,
 * case-insensitive) — not substrings — so "tokenType" or "passwordPolicy"
 * are left alone. Usernames/accounts are not redacted, only the paired
 * secret value.
 *
 * A password carried in a URL's userinfo is redacted by *shape*, because no
 * key name can describe it: the credential is inside the value of a field
 * that is not itself a credential field. See URL_USERINFO and the live camera
 * read that found it.
 *
 * One non-obvious wrinkle, also found live: AlertRule's "trigger" field
 * comes back as a JSON-encoded *string*, not a nested object — e.g.
 * `"trigger": "{\"request\":{...,\"password\":\"real-value\"}}"`. A plain
 * recursive object walk would never see inside that string. So any string
 * value that parses as JSON is itself recursed into and re-encoded.
 */

const REDACTED = "***REDACTED***";

const SENSITIVE_KEYS = new Set([
  "password",
  "passwd",
  "pwd",
  "secret",
  "clientsecret",
  "client_secret",
  "accesstoken",
  "access_token",
  "refreshtoken",
  "refresh_token",
  "apikey",
  "api_key",
  "privatekey",
  "private_key",

  // Field names this API actually uses for credentials, added after auditing
  // every property in the spec rather than guessing at conventions. Eight of
  // these were passing through in plaintext, including the one that matters
  // most: `ApiKey.key` is the API key itself, so `GET /api/accounts/api-keys`
  // was echoing every key on the account into the model's context.
  //
  // Exact names, not suffixes, deliberately. A rule like "anything ending in
  // key" would also swallow `faceKey` and `faceTargetKey`, which are face
  // records rather than secrets — over-redaction breaks legitimate reads, and
  // this file's whole design is exact matching for exactly that reason.
  // `ApiKey.key` is the only property in the spec named exactly `key`, checked
  // before adding it.
  "key",
  "accesskey",
  "access_key",
  "secretkey",
  "secret_key",
  "googlemapapikey",
  "sslprivatekeypassphrase",
  "uploadedprivatekey",
  "uploadedchainkey",
  "uploadedpublickey",
  "serialkey",
]);

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key.toLowerCase());
}

function tryRedactEmbeddedJson(text: string): string | undefined {
  const trimmed = text.trim();
  if (!(trimmed.startsWith("{") && trimmed.endsWith("}")) && !(trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(text);
    return JSON.stringify(redactSecrets(parsed));
  } catch {
    return undefined;
  }
}

/**
 * A password carried in a URL's userinfo, as `scheme://user:password@host`.
 *
 * Key-name matching cannot see this one, and a live read is what showed it.
 * `GET /api/cameras` returned a camera whose credential-shaped fields were
 * dutifully empty while the same credentials sat in plaintext one field over:
 *
 *     "account": null, "password": null,
 *     "streamUrl": "rtsp://user:hunter2@10.0.0.5:60000/Streaming/Channels/2001"
 *
 * Nothing was wrong with the key list — `streamUrl` is not a credential field
 * and should not be treated as one. The gap is that userinfo is a credential
 * wherever it appears, so this matches the *shape* rather than the field, and
 * is the only rule here that does.
 *
 * The username is kept, matching the policy stated at the top of this file:
 * usernames and accounts are not redacted, only the paired secret. It also
 * leaves the URL identifiable, which is usually the reason someone is reading
 * the field at all.
 *
 * The scheme is required, so an ordinary string containing an `@` — an email
 * address, a Java array dump, a `user:role@domain` label — is not touched.
 */
const URL_USERINFO = /([a-z][a-z0-9+.-]*:\/\/)([^\s/?#@:]+):([^\s/?#@]*)@/gi;

function redactUrlCredentials(text: string): string {
  return text.replace(URL_USERINFO, (whole, scheme: string, user: string, password: string) =>
    // An empty password is not a secret, and replacing it would invent one.
    password.length > 0 ? `${scheme}${user}:${REDACTED}@` : whole
  );
}

/**
 * Every string value gets both treatments, wherever it sits.
 *
 * Previously only strings found as object *values* were examined, so a URL
 * inside an array — or a bare string body — went through untouched.
 */
function redactString(text: string): string {
  const embedded = tryRedactEmbeddedJson(text);
  if (embedded !== undefined) return embedded;
  return redactUrlCredentials(text);
}

/** Recursively redacts sensitive-keyed string values in an already-parsed JSON value. */
export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item));
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveKey(key) && typeof val === "string" && val.length > 0) {
        result[key] = REDACTED;
      } else if (typeof val === "string") {
        result[key] = redactString(val);
      } else {
        result[key] = redactSecrets(val);
      }
    }
    return result;
  }
  if (typeof value === "string") {
    return redactString(value);
  }
  return value;
}
