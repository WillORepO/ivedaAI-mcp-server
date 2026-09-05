import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import express, { type Response } from "express";
import { z } from "zod";
import { mcpAuthRouter, createOAuthMetadata } from "@modelcontextprotocol/sdk/server/auth/router.js";
import type { OAuthServerProvider, AuthorizationParams } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthClientInformationFull, OAuthTokenRevocationRequest, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { InvalidGrantError, InvalidRequestError, InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { TokenManager, type IvedaAIConfig } from "./auth.js";
import { loadSwagger } from "./swagger.js";
import { AuthenticationError, httpsUrl, READ_SCOPE, type RemoteSubject } from "./remoteAuth.js";
import { createRemoteServer } from "./remoteServer.js";

export const ivedaLoginConfigSchema = z.object({
  auth: z.literal("ivedaai"),
  publicUrl: httpsUrl.refine(value => new URL(value).pathname === "/mcp"),
  upstreamOrigin: httpsUrl.refine(value => new URL(value).pathname === "/"),
  port: z.number().int().min(1024).max(65535).default(3000),
  clients: z.array(z.object({
    clientId: z.string().min(1).max(200),
    name: z.string().min(1).max(100),
    redirectUris: z.array(httpsUrl).min(1).max(5),
  }).strict()).min(1).max(20),
}).strict().refine(c => new Set(c.clients.map(x => x.clientId)).size === c.clients.length, "Duplicate client ID");
export type IvedaLoginConfig = z.infer<typeof ivedaLoginConfigSchema>;
type Session = { username: string; password: string; clientId: string; expires: number; controller: AbortController };
type Flow = { clientId: string; params: AuthorizationParams; csrf: string; expires: number };
type Code = { sessionId: string; params: AuthorizationParams; expires: number };
type Token = { sessionId: string; expires: number; used?: boolean };
const random = () => randomBytes(32).toString("base64url");
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const equal = (a: unknown, b: string) => typeof a === "string" && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** IvedaAI login adapter using the SDK OAuth code/PKCE routes. All grants are process-local. */
export class IvedaLoginProvider implements OAuthServerProvider {
  readonly flows = new Map<string, Flow>();
  private readonly sessions = new Map<string, Session>();
  private readonly codes = new Map<string, Code>();
  private readonly access = new Map<string, Token>();
  private readonly refresh = new Map<string, Token>();
  private readonly clients = new Map<string, OAuthClientInformationFull>();
  private readonly sweepTimer: NodeJS.Timeout;
  private closed = false;
  readonly clientsStore = { getClient: (id: string) => this.clients.get(id) };
  constructor(readonly config: IvedaLoginConfig, readonly validateLogin: (username: string, password: string, signal?: AbortSignal) => Promise<void>) {
    for (const client of config.clients) this.clients.set(client.clientId, {
      client_id: client.clientId, client_name: client.name, redirect_uris: client.redirectUris,
      token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], scope: READ_SCOPE,
    });
    this.sweepTimer = setInterval(() => this.sweep(), 30000); this.sweepTimer.unref();
  }
  private sweep() {
    const now = Date.now();
    for (const [id, flow] of this.flows) if (flow.expires <= now) this.flows.delete(id);
    for (const [id, code] of this.codes) if (code.expires <= now) { this.codes.delete(id); this.dropSession(code.sessionId); }
    for (const [id, session] of this.sessions) if (session.expires <= now) this.dropSession(id);
    for (const [id, token] of this.access) if (token.expires <= now) this.access.delete(id);
  }
  private dropSession(id: string) {
    this.sessions.get(id)?.controller.abort(); this.sessions.delete(id);
    for (const map of [this.access, this.refresh, this.codes]) for (const [key, entry] of map) if (entry.sessionId === id) map.delete(key);
  }
  close() {
    this.closed = true; clearInterval(this.sweepTimer);
    for (const id of this.sessions.keys()) this.dropSession(id);
    this.flows.clear();
  }
  private resource(resource?: URL) {
    if (resource?.href !== this.config.publicUrl) throw new InvalidRequestError("Resource must match this MCP endpoint");
  }
  private scope(scopes?: string[]) {
    if (scopes && (scopes.length !== 1 || scopes[0] !== READ_SCOPE)) throw new InvalidRequestError("Only read access is available");
  }
  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response) {
    this.sweep(); this.resource(params.resource); this.scope(params.scopes);
    if (this.closed || this.flows.size >= 100 || this.sessions.size >= 200) throw new InvalidRequestError("Please try again later");
    if (!client.redirect_uris.includes(params.redirectUri) || !/^[A-Za-z0-9_-]{43}$/.test(params.codeChallenge)) throw new InvalidRequestError("Invalid authorization request");
    const id = random(), csrf = random();
    this.flows.set(id, { clientId: client.client_id, params, csrf, expires: Date.now() + 300000 });
    res.setHeader("Set-Cookie", `__Host-iveda-login=${id}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=300`);
    res.setHeader("Content-Security-Policy", "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.type("html").send(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Connect IvedaAI</title><main><h1>Connect IvedaAI</h1><p>Sign in to ${escapeHtml(new URL(this.config.upstreamOrigin).host)} with your existing IvedaAI account.</p><p>${escapeHtml(client.client_name ?? client.client_id)} will be able to read data your account can access. It cannot make changes through this connection.</p><form method="post" action="/login"><input type="hidden" name="flow" value="${id}"><input type="hidden" name="csrf" value="${csrf}"><p><label>Username <input name="username" autocomplete="username" maxlength="512" required></label></p><p><label>Password <input type="password" name="password" autocomplete="current-password" maxlength="4096" required></label></p><p><label><input type="checkbox" name="consent" value="yes" required> Allow this app to read my IvedaAI data</label></p><button type="submit">Sign in and connect</button></form><p>To cancel, close this page.</p></main></html>`);
  }
  async completeLogin(flowId: unknown, csrf: unknown, cookie: string | undefined, username: unknown, password: unknown, consent: unknown, signal?: AbortSignal) {
    this.sweep();
    const flow = typeof flowId === "string" ? this.flows.get(flowId) : undefined;
    const cookieValues = cookie?.split(";").map(x => x.trim()).filter(x => x.startsWith("__Host-iveda-login=")) ?? [];
    if (!flow || cookieValues.length !== 1 || !equal(cookieValues[0].slice("__Host-iveda-login=".length), flowId as string) || !equal(csrf, flow.csrf)) throw new InvalidGrantError("Restart the connection and try again");
    this.flows.delete(flowId as string); // Single-use login attempt, including failures.
    if (consent !== "yes" || typeof username !== "string" || !username || username.length > 512 || typeof password !== "string" || !password || password.length > 4096) throw new InvalidGrantError("Sign-in and consent are required");
    await this.validateLogin(username, password, signal);
    if (this.closed || signal?.aborted || this.sessions.size >= 200) throw new InvalidGrantError("Restart the connection and try again");
    const sessionId = random(), code = random();
    this.sessions.set(sessionId, { username, password, clientId: flow.clientId, expires: Date.now() + 3600000, controller: new AbortController() });
    this.codes.set(hash(code), { sessionId, params: flow.params, expires: Date.now() + 60000 });
    const redirect = new URL(flow.params.redirectUri);
    redirect.searchParams.set("code", code);
    if (flow.params.state !== undefined) redirect.searchParams.set("state", flow.params.state);
    redirect.searchParams.set("iss", new URL(this.config.publicUrl).origin + "/");
    return redirect.href;
  }
  private code(client: OAuthClientInformationFull, value: string) {
    this.sweep(); const code = this.codes.get(hash(value));
    const session = code && this.sessions.get(code.sessionId);
    if (!code || !session || session.clientId !== client.client_id) throw new InvalidGrantError("Invalid authorization code");
    return code;
  }
  async challengeForAuthorizationCode(client: OAuthClientInformationFull, code: string) { return this.code(client, code).params.codeChallenge; }
  private mint(sessionId: string): OAuthTokens {
    const session = this.sessions.get(sessionId)!;
    if (this.refresh.size >= 4000) throw new InvalidGrantError("Reconnect to continue");
    const access = random(), refresh = random();
    const expires = Math.min(Date.now() + 300000, session.expires);
    this.access.set(hash(access), { sessionId, expires });
    this.refresh.set(hash(refresh), { sessionId, expires: session.expires });
    return { access_token: access, refresh_token: refresh, token_type: "Bearer", expires_in: Math.max(1, Math.floor((expires - Date.now()) / 1000)), scope: READ_SCOPE };
  }
  async exchangeAuthorizationCode(client: OAuthClientInformationFull, codeValue: string, _verifier?: string, redirectUri?: string, resource?: URL) {
    this.resource(resource); const code = this.code(client, codeValue);
    if (redirectUri !== code.params.redirectUri) throw new InvalidGrantError("Redirect URI mismatch");
    this.codes.delete(hash(codeValue)); return this.mint(code.sessionId);
  }
  async exchangeRefreshToken(client: OAuthClientInformationFull, value: string, scopes?: string[], resource?: URL) {
    this.sweep(); this.resource(resource); this.scope(scopes);
    const token = this.refresh.get(hash(value)); const session = token && this.sessions.get(token.sessionId);
    if (!token || !session || session.clientId !== client.client_id) throw new InvalidGrantError("Invalid refresh token");
    if (token.used) { this.dropSession(token.sessionId); throw new InvalidGrantError("Refresh token reuse; reconnect"); }
    token.used = true;
    try { await this.validateLogin(session.username, session.password, session.controller.signal); }
    catch { this.dropSession(token.sessionId); throw new InvalidGrantError("Sign in again"); }
    if (!this.sessions.has(token.sessionId)) throw new InvalidGrantError("Authorization ended");
    return this.mint(token.sessionId);
  }
  private accessSession(value: string) {
    this.sweep(); const token = this.access.get(hash(value)); const session = token && this.sessions.get(token.sessionId);
    if (!token || !session) throw new InvalidTokenError("Invalid access token");
    return { token, session };
  }
  async verifyAccessToken(value: string) {
    const { token, session } = this.accessSession(value);
    return { token: value, clientId: session.clientId, scopes: [READ_SCOPE], expiresAt: Math.floor(token.expires / 1000), resource: new URL(this.config.publicUrl) };
  }
  async authenticate(header: string | undefined): Promise<RemoteSubject> {
    try {
      if (!header || !/^Bearer [A-Za-z0-9_-]{43}$/i.test(header)) throw new Error();
      const { session } = this.accessSession(header.slice(7));
      return { subject: session.username.toLowerCase(), username: session.username, password: session.password, signal: session.controller.signal };
    } catch { throw new AuthenticationError(401); }
  }
  async revokeToken(client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest) {
    const token = this.access.get(hash(request.token)) ?? this.refresh.get(hash(request.token));
    if (token && this.sessions.get(token.sessionId)?.clientId === client.client_id) this.dropSession(token.sessionId);
  }
}

export function createIvedaLoginServer(config: IvedaLoginConfig) {
  const ctx = loadSwagger();
  const publicOrigin = new URL(config.publicUrl).origin;
  const provider = new IvedaLoginProvider(config, async (username, password, signal) => {
    const upstream: IvedaAIConfig = { origin: config.upstreamOrigin, basePath: ctx.basePath, tokenUrl: ctx.tokenUrl,
      username, password, timeoutMs: 8000, maxResponseBytes: 28672, inlineImages: false, maxImageBytes: 1,
      redactSecrets: true, uploadPolicy: { maxBytes: 1, allowUnconfined: false } };
    const manager = new TokenManager(upstream);
    const abort = () => { void manager.close(); };
    signal?.addEventListener("abort", abort, { once: true });
    try {
      if (signal?.aborted) throw new Error();
      await manager.getAccessToken();
    } finally { signal?.removeEventListener("abort", abort); await manager.close(); }
  });
  const app = express(); app.disable("x-powered-by");
  app.use(express.urlencoded({ extended: false, limit: "16kb", parameterLimit: 20 }));
  // A per-installation limit, independent of proxy IP headers; bounded map of account attempts.
  let windowStart = Date.now(), attempts = 0;
  const accounts = new Map<string, number>();
  app.post("/login", async (req, res) => {
    if (Date.now() - windowStart >= 60000) { windowStart = Date.now(); attempts = 0; accounts.clear(); }
    const account = hash(typeof req.body?.username === "string" ? req.body.username.toLowerCase() : "");
    const count = (accounts.get(account) ?? 0) + 1;
    if (++attempts > 20 || count > 5) { res.status(429).send("Too many sign-in attempts. Try again later."); return; }
    accounts.set(account, count);
    const lifetime = new AbortController();
    const abort = () => lifetime.abort(); res.once("close", abort);
    try {
      if (req.headers.origin !== publicOrigin) throw new Error();
      const redirect = await provider.completeLogin(req.body?.flow, req.body?.csrf, req.headers.cookie, req.body?.username, req.body?.password, req.body?.consent, lifetime.signal);
      res.setHeader("Set-Cookie", "__Host-iveda-login=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0");
      res.redirect(303, redirect);
    } catch { if (!res.headersSent && !res.destroyed) res.status(400).send("Sign-in failed or expired. Check your IvedaAI credentials and account setup, then restart this connection from your AI app."); }
    finally { res.off("close", abort); }
  });
  const authOptions = { provider, issuerUrl: new URL(publicOrigin + "/"), resourceServerUrl: new URL(config.publicUrl), scopesSupported: [READ_SCOPE] };
  app.get("/.well-known/oauth-authorization-server", (_req, res) => res.json({
    ...createOAuthMetadata(authOptions), token_endpoint_auth_methods_supported: ["none"], revocation_endpoint_auth_methods_supported: ["none"],
  }));
  app.use(mcpAuthRouter(authOptions));
  app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => { res.status(400).json({ error: "invalid_request" }); });
  const paths = new Set(["/authorize", "/token", "/revoke", "/login", "/.well-known/oauth-authorization-server", "/.well-known/oauth-protected-resource/mcp"]);
  const service = createRemoteServer({ ...config, issuer: publicOrigin + "/", jwksUrl: publicOrigin + "/unused", subjects: [] }, {
    context: ctx, authenticate: header => provider.authenticate(header),
    routes: async (req, res) => {
      if (!paths.has((req.url ?? "").split("?")[0])) return false;
      await new Promise<void>((resolve, reject) => {
        const done = () => { res.off("finish", done); res.off("close", done); resolve(); };
        res.once("finish", done); res.once("close", done);
        app(req as express.Request, res as express.Response, (error?: unknown) => { if (error) reject(error); else { res.statusCode = 404; res.end(); } });
      });
      return true;
    },
  });
  return { ...service, provider, close: async () => { provider.close(); await service.close(); } };
}
