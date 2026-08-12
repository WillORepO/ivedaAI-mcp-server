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
// 2 MB was chosen to avoid truncating anything the API might legitimately
// return. That is the wrong axis: the constraint is not what the API can send,
// it is what a model client can receive. Measured against a real client,
// `GET /api/cameras?size=500` on a 47-camera deployment returned 413 KB and
// exceeded the client's per-result limit — it never reached the model at all.
//
// 128 KB is roughly 30-40k tokens of dense JSON: large enough for a generous
// page, small enough that a client can actually take it. Anything bigger comes
// back flagged `truncated` with a note telling the caller to narrow the request,
// which is a far better outcome than silently handing over something the client
// must discard.
//
// Raise it with IVEDAAI_MAX_RESPONSE_BYTES if a specific call needs more.
const DEFAULT_MAX_RESPONSE_BYTES = 131_072;

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
