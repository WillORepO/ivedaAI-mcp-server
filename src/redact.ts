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
 * Only known secret-value field *names* are redacted (exact match,
 * case-insensitive) — not substrings — so "tokenType" or "passwordPolicy"
 * are left alone. Usernames/accounts are not redacted, only the paired
 * secret value.
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
        result[key] = tryRedactEmbeddedJson(val) ?? val;
      } else {
        result[key] = redactSecrets(val);
      }
    }
    return result;
  }
  return value;
}
