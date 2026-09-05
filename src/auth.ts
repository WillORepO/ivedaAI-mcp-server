import { fetch, Agent, type Dispatcher } from "undici";
import { connectionFailureMessage } from "./netError.js";
import type { SwaggerContext } from "./swagger.js";
import { uploadPolicyFromEnv, type UploadPolicy } from "./uploadPath.js";
import { setTimeout as delay } from "node:timers/promises";

export interface IvedaAIConfig {
  origin: string;
  basePath: string;
  tokenUrl: string;
  username: string;
  password: string;
  clientId?: string;
  clientSecret?: string;
  /** Per-request timeout in milliseconds for every HTTP call this server makes. */
  timeoutMs: number;
  /** Maximum number of response-body bytes read before truncating. */
  maxResponseBytes: number;
  /** Whether image responses are handed to the client as viewable images. */
  inlineImages: boolean;
  /** Separate, larger budget for image responses. See DEFAULT_MAX_IMAGE_BYTES. */
  maxImageBytes: number;
  /** Custom undici dispatcher; used to scope TLS-verification bypass to this server's requests only. */
  dispatcher?: Dispatcher;
  /** Whether to redact credential-shaped fields (password, secret, token, ...) from response bodies. */
  redactSecrets: boolean;
  /** What this server may read off local disk and upload. See src/uploadPath.ts. */
  uploadPolicy: UploadPolicy;
}

const DEFAULT_TIMEOUT_MS = 30_000;
// Sized from what a client can receive, not from what the API can send.
//
// 2 MB was the original value, chosen so the API could never be truncated. That
// is the wrong axis, and the gap showed up the first time a real MCP client was
// connected: `GET /api/cameras?size=500` returned 413 KB and never reached the
// model at all.
//
// Bisected against that client, one page of cameras at a time:
//
//     1 record    ~8 KB   reached the model
//     4 records  ~38 KB   reached the model
//     6 records   57 KB   persisted to a file, 2 KB preview only
//     8 records   74 KB   rejected outright
//
// So the ceiling is between 38 and 57 KB there. 32 KB sits below the largest
// confirmed pass with room to spare, which matters because the real limit is a
// *token* budget: the same byte count costs more or fewer tokens depending on
// how dense the JSON is, and camera records are unusually repetitive.
//
// Deliberately not bisected finer. The extra precision would not change this
// number, and a value derived to the byte from one endpoint on one client would
// be false precision.
//
// This number was originally derived with an amplification factor built in: the
// result used to be handed over pretty-printed, 15-20% larger than the raw
// bytes counted here, so 28 KB raw landed around 34 KB rendered and 32 KB raw
// would have landed at ~38 KB — the largest size confirmed to pass, with no
// margin at all.
//
// The text block is serialised compactly now (see `resultText` in index.ts), so
// that amplification is gone and 28 KB raw lands at roughly 28 KB rendered.
// The cap is left where it is rather than raised to spend the headroom:
// the figures above were bisected against one real client, and changing the
// serialisation and the budget in the same breath would leave neither
// measured. Raising it is a separate decision, with its own evidence.
//
// Raise it with IVEDAAI_MAX_RESPONSE_BYTES where a specific call needs more and
// the client can take it.
const DEFAULT_MAX_RESPONSE_BYTES = 28_672;

// Images are budgeted separately, and far more generously, because the two
// costs are not the same cost.
//
// The response cap above is a proxy for tokens: JSON reaches the model as text,
// so bytes and tokens rise together. An image does not — a client charges for
// it by its dimensions, on the order of a thousand-odd tokens for a large one,
// regardless of whether the JPEG is 40 KB or 400 KB. Holding images to the JSON
// budget would truncate essentially all of them (a camera snapshot from the
// deployment is ~45 KB against a 28 KB cap) to save a cost not being paid.
//
// 4 MB is chosen against what clients accept rather than what this API sends:
// it is comfortably above every image this deployment produces while staying
// under the limits MCP clients impose on a single result. A truncated image is
// a corrupt file rather than a smaller one, so the failure this avoids is
// total, not gradual.
const DEFAULT_MAX_IMAGE_BYTES = 4 * 1024 * 1024;

function positiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(parsed) || parsed > 2_147_483_647) {
    throw new Error(`${name} must be a positive integer, got "${raw}".`);
  }
  return parsed;
}

export function loadConfig(ctx: SwaggerContext): IvedaAIConfig {
  const origin = process.env.IVEDAAI_BASE_URL?.replace(/\/+$/, "");
  const username = process.env.IVEDAAI_USERNAME;
  const password = process.env.IVEDAAI_PASSWORD;

  if (!origin) {
    throw new Error(
      "IVEDAAI_BASE_URL is not set. Set it to the origin of your IvedaAI server, e.g. https://ivedaai.example.com"
    );
  }
  if (!username || !password) {
    throw new Error("IVEDAAI_USERNAME and IVEDAAI_PASSWORD must be set to authenticate with the IvedaAI API.");
  }

  try {
    const url = new URL(origin);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
        url.pathname !== "/" || url.search || url.hash) throw new Error();
  } catch {
    throw new Error("IVEDAAI_BASE_URL must be an http:// or https:// origin with no credentials, path, query, or fragment.");
  }

  let dispatcher: Dispatcher | undefined;
  if (process.env.IVEDAAI_ALLOW_INSECURE_TLS === "true") {
    // Many on-prem deployments use self-signed certificates. Scope the bypass to
    // requests made through this dispatcher instead of disabling TLS process-wide.
    dispatcher = new Agent({ connect: { rejectUnauthorized: false } });
  }

  return {
    origin,
    basePath: ctx.basePath,
    tokenUrl: ctx.tokenUrl,
    username,
    password,
    clientId: process.env.IVEDAAI_CLIENT_ID,
    clientSecret: process.env.IVEDAAI_CLIENT_SECRET,
    timeoutMs: positiveIntEnv("IVEDAAI_TIMEOUT_MS", DEFAULT_TIMEOUT_MS),
    maxResponseBytes: positiveIntEnv("IVEDAAI_MAX_RESPONSE_BYTES", DEFAULT_MAX_RESPONSE_BYTES),
    inlineImages: process.env.IVEDAAI_INLINE_IMAGES !== "false",
    maxImageBytes: positiveIntEnv("IVEDAAI_MAX_IMAGE_BYTES", DEFAULT_MAX_IMAGE_BYTES),
    dispatcher,
    redactSecrets: process.env.IVEDAAI_REDACT_SECRETS !== "false",
    // Read at startup so a misconfigured IVEDAAI_UPLOAD_ROOT fails here, with
    // the other configuration errors, rather than on the first upload.
    uploadPolicy: uploadPolicyFromEnv(),
  };
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
}

const EXPIRY_SAFETY_MARGIN_MS = 30_000;

export class TokenManager {
  private accessToken?: string;
  private refreshToken?: string;
  private expiresAtMs = 0;
  private inFlight?: Promise<string>;
  private readonly lifetime = new AbortController();

  constructor(private readonly config: IvedaAIConfig) {}

  get apiOrigin(): string {
    return this.config.origin;
  }

  get basePath(): string {
    return this.config.basePath;
  }

  get timeoutMs(): number {
    return this.config.timeoutMs;
  }

  get maxResponseBytes(): number {
    return this.config.maxResponseBytes;
  }

  get dispatcher(): Dispatcher | undefined {
    return this.config.dispatcher;
  }

  get redactSecrets(): boolean {
    return this.config.redactSecrets;
  }

  get inlineImages(): boolean {
    return this.config.inlineImages;
  }

  get maxImageBytes(): number {
    return this.config.maxImageBytes;
  }

  get uploadPolicy(): UploadPolicy {
    return this.config.uploadPolicy;
  }

  /** Drops the cached tokens so the next getAccessToken() performs a fresh login. */
  invalidateToken(rejectedToken?: string): void {
    // A late 401 for an older request must not discard a newer login.
    if (rejectedToken !== undefined && this.accessToken !== rejectedToken) return;
    this.accessToken = undefined;
    this.refreshToken = undefined;
    this.expiresAtMs = 0;
  }

  async close(): Promise<void> {
    this.lifetime.abort();
    await this.config.dispatcher?.destroy();
  }

  get shutdownSignal(): AbortSignal { return this.lifetime.signal; }

  async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.expiresAtMs - EXPIRY_SAFETY_MARGIN_MS) {
      return this.accessToken;
    }
    if (this.inFlight) return this.inFlight;

    this.inFlight = this.refreshOrLogin().finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  private async refreshOrLogin(): Promise<string> {
    if (this.refreshToken) {
      try {
        return await this.requestToken({ grant_type: "refresh_token", refresh_token: this.refreshToken });
      } catch {
        // fall through to a full password login if the refresh token is no longer valid
      }
    }
    return this.requestToken({
      grant_type: "password",
      username: this.config.username,
      password: this.config.password,
    });
  }

  private async requestToken(params: Record<string, string>): Promise<string> {
    let lastRetryable: { status: number; body: string } | undefined;
    for (let attempt = 0; ; attempt++) {
      const outcome = await this.attemptToken(params);
      if ("token" in outcome) return outcome.token;
      lastRetryable = outcome.retryable;
      if (attempt >= TOKEN_RETRY_DELAYS_MS.length) break;
      await delay(retryDelayMs(attempt, outcome.retryAfterMs), undefined, { signal: this.lifetime.signal });
    }
    throw new Error(
      `IvedaAI OAuth token request failed (${lastRetryable!.status}) after ${TOKEN_RETRY_DELAYS_MS.length + 1} attempts ` +
        `over ~${Math.round(TOKEN_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0) / 100) / 10}s. The token endpoint rate-limits ` +
        `repeated logins, so this usually means another client started at the same moment — two MCP clients, or a restart ` +
        `racing an instance that is still running. It clears on its own within a few seconds; starting one client at a ` +
        `time avoids it. The authentication response body is withheld to protect credentials.`
    );
  }

  /** One token request. Separates "got a token" from "worth trying again". */
  private async attemptToken(
    params: Record<string, string>
  ): Promise<{ token: string } | { retryable: { status: number; body: string }; retryAfterMs?: number }> {
    // The vendor spec's parameters list the token endpoint's inputs as query
    // params, but live testing showed the real server rejects that (415) and
    // expects the standard OAuth2 application/x-www-form-urlencoded body
    // instead. See the README's security notes about this endpoint.
    const url = new URL(this.config.tokenUrl, this.config.origin + "/");
    const form = new URLSearchParams(params);

    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    };
    if (this.config.clientId && this.config.clientSecret) {
      const basic = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString("base64");
      headers.Authorization = `Basic ${basic}`;
    }

    let response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers,
        body: form.toString(),
        redirect: "error",
        dispatcher: this.config.dispatcher,
        signal: AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(this.config.timeoutMs)]),
      });
    } catch (err) {
      if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
        throw new Error(`IvedaAI OAuth token request timed out after ${this.config.timeoutMs}ms.`);
      }
      // The token request is the first call this server makes, so a
      // misconfigured base URL surfaces here before anything else.
      const connection = connectionFailureMessage(err, "the OAuth token request", url.toString());
      if (connection) throw new Error(connection);
      throw err;
    }
    // Token responses are small. Bound the read independently of API result
    // budgets and never echo an authentication response, including errors.
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      if (reader) while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 65_536) {
          await reader.cancel();
          throw new Error("IvedaAI OAuth token response exceeded the 65536-byte limit.");
        }
        chunks.push(value);
      }
    } catch (err) {
      if (err instanceof Error && ["TimeoutError", "AbortError"].includes(err.name)) {
        throw new Error(`IvedaAI OAuth token response timed out after ${this.config.timeoutMs}ms.`);
      }
      throw err;
    } finally { reader?.releaseLock(); }
    const bodyText = Buffer.concat(chunks).toString("utf8");
    if (!response.ok) {
      if (RETRYABLE_TOKEN_STATUSES.has(response.status)) {
        return {
          retryable: { status: response.status, body: "[withheld]" },
          retryAfterMs: parseRetryAfter(response.headers.get("retry-after")),
        };
      }
      throw new Error(
        `IvedaAI OAuth token request failed (${response.status} ${response.statusText}). Check the account credentials and deployment authentication configuration. Response body withheld to protect credentials.`
      );
    }

    let parsed: TokenResponse;
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      throw new Error("IvedaAI OAuth token response was not valid JSON. Response body withheld to protect credentials.");
    }

    if (!parsed || typeof parsed.access_token !== "string" || !parsed.access_token.trim() ||
        /[\r\n]/.test(parsed.access_token) ||
        (parsed.expires_in !== undefined && (typeof parsed.expires_in !== "number" || !Number.isFinite(parsed.expires_in) || parsed.expires_in <= 0)) ||
        (parsed.refresh_token !== undefined && typeof parsed.refresh_token !== "string")) {
      throw new Error("IvedaAI OAuth token response has invalid token fields. Response body withheld to protect credentials.");
    }

    this.accessToken = parsed.access_token;
    this.refreshToken = parsed.refresh_token ?? this.refreshToken;
    this.expiresAtMs = Date.now() + (parsed.expires_in ?? 600) * 1000;
    return { token: this.accessToken };
  }
}

/**
 * Statuses where trying the token request again is the right move.
 *
 * 429 is the one that actually bites: the endpoint rate-limits repeated logins,
 * and six servers starting together produced five failures and one success.
 * 503 is here because the same endpoint has been seen returning Apache's HTML
 * 503 under sustained login load while the rest of the API stayed healthy.
 *
 * Nothing else retries. A 401 is a wrong password and will be wrong next time;
 * retrying it just delays the message and adds failed logins to an audit trail.
 */
const RETRYABLE_TOKEN_STATUSES = new Set([429, 503]);

/**
 * Backoff schedule, measured rather than guessed.
 *
 * The lockout was timed against the deployment by triggering it and polling
 * until a login succeeded: it clears in about 2 seconds, and the endpoint then
 * admits roughly one login per 2 seconds — so the budget needed is set by how
 * many clients start together, not by the lockout alone.
 *
 * Measured end to end, with servers started at the same instant:
 *
 *     clients   at ~3.1s      at ~6.1s
 *        2       2/2           2/2
 *        3       3/3           3/3
 *        4       3/4           4/4
 *        6       3/6           5/6
 *
 * Hence the fourth delay. Two or three at once is the ordinary case — two MCP
 * clients, or a restart overlapping an instance still shutting down — and the
 * shorter schedule already covered it; the extra step buys the fourth and fifth
 * for a few seconds spent only on a path that is already failing. Beyond that
 * the endpoint's own rate is the limit and no client-side schedule fixes it.
 */
const TOKEN_RETRY_DELAYS_MS = [400, 900, 1800, 3000];

/**
 * Jitter is the point, not a detail.
 *
 * The failure this exists for is several instances starting at the same moment.
 * If they all back off on the same schedule they collide again on every retry,
 * and a fixed schedule would faithfully reproduce the stampede it is meant to
 * break up. Each delay is spread across ±50%.
 */
function retryDelayMs(attempt: number, retryAfterMs?: number): number {
  const base = retryAfterMs ?? TOKEN_RETRY_DELAYS_MS[attempt] ?? TOKEN_RETRY_DELAYS_MS.at(-1)!;
  return Math.round(base * (0.5 + Math.random()));
}

/** `Retry-After`, in seconds or as an HTTP date. Absent on this deployment, but free to honour. */
function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 10_000);
  const when = Date.parse(header);
  if (Number.isFinite(when)) return Math.min(Math.max(when - Date.now(), 0), 10_000);
  return undefined;
}

/**
 * A warning about the transport, or undefined when there is nothing to say.
 *
 * Every credential this server holds — the account password on the token
 * request, the bearer token on every call afterwards — crosses the wire in
 * whatever `IVEDAAI_BASE_URL` specifies. Over plain HTTP to a remote host, that
 * is readable by anything on the path.
 *
 * A warning rather than a refusal, deliberately. On-prem video appliances
 * routinely sit on a LAN with no certificate worth having, and refusing to start
 * would mostly teach operators to set a bypass flag permanently — which is worse
 * than a warning they read once, because the flag then stays set on the
 * deployment that could have used TLS.
 *
 * Loopback is exempt: traffic that never leaves the machine has no path to
 * listen on, and warning about it would be noise that trains people to ignore
 * the message that matters.
 */
export function insecureTransportWarning(origin: string, allowInsecureTls = false): string | undefined {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return undefined;
  }

  const isLoopback = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname);
  if (url.protocol === "http:" && !isLoopback) {
    return (
      `IVEDAAI_BASE_URL is plain HTTP (${url.origin}). The account password and every bearer token ` +
      `afterwards cross the network unencrypted and are readable in transit. Use https:// in ` +
      `production; if the deployment has a self-signed certificate, IVEDAAI_ALLOW_INSECURE_TLS=true ` +
      `keeps the encryption while skipping certificate verification, which is weaker than proper TLS ` +
      `but stronger than this.`
    );
  }

  if (url.protocol === "https:" && allowInsecureTls) {
    return (
      `IVEDAAI_ALLOW_INSECURE_TLS is set, so the server's certificate is not verified. Traffic is ` +
      `encrypted but an interceptor presenting any certificate would be accepted. Intended for ` +
      `on-prem deployments with self-signed certificates.`
    );
  }

  return undefined;
}
