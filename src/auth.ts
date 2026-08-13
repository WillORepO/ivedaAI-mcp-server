import { fetch, Agent, type Dispatcher } from "undici";
import type { SwaggerContext } from "./swagger.js";

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
  /** Custom undici dispatcher; used to scope TLS-verification bypass to this server's requests only. */
  dispatcher?: Dispatcher;
  /** Whether to redact credential-shaped fields (password, secret, token, ...) from response bodies. */
  redactSecrets: boolean;
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
// The cap counts raw response bytes, but the client is handed the result
// pretty-printed (`JSON.stringify(payload, null, 2)`), which is 15-20% larger.
// So the budget has to account for that amplification: 28 KB raw lands around
// 34 KB rendered, inside the proven range, where 32 KB raw would land at ~38 KB
// — exactly the largest size confirmed to pass, with no margin at all.
//
// Raise it with IVEDAAI_MAX_RESPONSE_BYTES where a specific call needs more and
// the client can take it.
const DEFAULT_MAX_RESPONSE_BYTES = 28_672;

function positiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
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
    dispatcher,
    redactSecrets: process.env.IVEDAAI_REDACT_SECRETS !== "false",
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

  /** Drops the cached tokens so the next getAccessToken() performs a fresh login. */
  invalidateToken(): void {
    this.accessToken = undefined;
    this.refreshToken = undefined;
    this.expiresAtMs = 0;
  }

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
        dispatcher: this.config.dispatcher,
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (err) {
      if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
        throw new Error(`IvedaAI OAuth token request timed out after ${this.config.timeoutMs}ms.`);
      }
      throw err;
    }
    const bodyText = await response.text();
    if (!response.ok) {
      throw new Error(
        `IvedaAI OAuth token request failed (${response.status} ${response.statusText}): ${bodyText.slice(0, 500)}`
      );
    }

    let parsed: TokenResponse;
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      throw new Error(`IvedaAI OAuth token response was not valid JSON: ${bodyText.slice(0, 500)}`);
    }

    this.accessToken = parsed.access_token;
    this.refreshToken = parsed.refresh_token ?? this.refreshToken;
    this.expiresAtMs = Date.now() + (parsed.expires_in ?? 600) * 1000;
    return this.accessToken;
  }
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
