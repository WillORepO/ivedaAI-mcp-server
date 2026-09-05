import { createServer, type Server } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { createIvedaLoginServer, ivedaLoginConfigSchema, type IvedaLoginConfig } from "../src/ivedaLogin.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const config: IvedaLoginConfig = {
  auth: "ivedaai", publicUrl: "https://mcp.customer.example/mcp", upstreamOrigin: "https://iveda.customer.example", port: 3000,
  clients: [{ clientId: "approved-ai", name: "Approved AI", redirectUris: ["https://ai.example/callback"] },
    { clientId: "other-ai", name: "Other AI", redirectUris: ["https://other.example/callback"] }],
};
let upstream: Server;
let service: ReturnType<typeof createIvedaLoginServer>;
let base: string;
let logins: string[];
let disabled = false;
async function listen(server: Server) {
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}
beforeEach(async () => {
  logins = []; disabled = false;
  upstream = createServer(async (req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url?.endsWith("/oauth2/token")) {
      let body = ""; for await (const chunk of req) body += chunk;
      const fields = new URLSearchParams(body), username = fields.get("username")!;
      logins.push(username);
      if (disabled || !["alice", "bob"].includes(username) || fields.get("password") !== "fixture-password") {
        res.writeHead(400); res.end(JSON.stringify({ error: "private upstream diagnostic must not be exposed" }));
      } else res.end(JSON.stringify({ access_token: `upstream-${username}`, expires_in: 3600, token_type: "Bearer" }));
    } else res.end(JSON.stringify({ cameraId: 1, owner: req.headers.authorization?.replace("Bearer upstream-", "") }));
  });
  const origin = await listen(upstream);
  service = createIvedaLoginServer({ ...config, upstreamOrigin: origin });
  base = await listen(service.http);
});
afterEach(async () => {
  vi.restoreAllMocks(); await service.close();
  await new Promise<void>(resolve => { upstream.close(() => resolve()); upstream.closeAllConnections(); });
});
async function form(path: string, fields: Record<string, string>, headers: Record<string, string> = {}) {
  return fetch(base + path, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", ...headers }, body: new URLSearchParams(fields) });
}
async function start(extra: Record<string, string> = {}) {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const response = await fetch(base + "/authorize?" + new URLSearchParams({ client_id: "approved-ai", redirect_uri: config.clients[0].redirectUris[0],
    response_type: "code", code_challenge_method: "S256", code_challenge: challenge, resource: config.publicUrl,
    scope: "ivedaai:read", state: "client-state", ...extra }), { redirect: "manual" });
  const html = await response.text();
  return { response, html, verifier, cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "",
    flow: /name="flow" value="([^"]+)"/.exec(html)?.[1] ?? "", csrf: /name="csrf" value="([^"]+)"/.exec(html)?.[1] ?? "" };
}
type Flow = Awaited<ReturnType<typeof start>>;
async function login(flow: Flow, fields: Record<string, string> = {}, headers: Record<string, string> = {}) {
  return form("/login", { flow: flow.flow, csrf: flow.csrf, username: "alice", password: "fixture-password", consent: "yes", ...fields },
    { cookie: flow.cookie, origin: new URL(config.publicUrl).origin, ...headers });
}
async function exchange(flow: Flow, code: string, extra: Record<string, string> = {}) {
  return form("/token", { client_id: "approved-ai", grant_type: "authorization_code", code, code_verifier: flow.verifier,
    redirect_uri: config.clients[0].redirectUris[0], resource: config.publicUrl, ...extra });
}
async function linked(username = "alice") {
  const flow = await start(); expect(flow.response.status).toBe(200);
  const response = await login(flow, { username }); expect(response.status).toBe(303);
  const redirect = new URL(response.headers.get("location")!);
  const tokenResponse = await exchange(flow, redirect.searchParams.get("code")!);
  expect(tokenResponse.status).toBe(200);
  return { flow, redirect, tokens: await tokenResponse.json() };
}
async function discover(token: string) {
  return fetch(base + "/mcp", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
}

describe("existing IvedaAI login", () => {
  it("requires HTTPS installation and callback configuration without stored user passwords", () => {
    expect(ivedaLoginConfigSchema.safeParse(config).success).toBe(true);
    expect(ivedaLoginConfigSchema.safeParse({ ...config, subjects: [] }).success).toBe(false);
    expect(ivedaLoginConfigSchema.safeParse({ ...config, upstreamOrigin: "http://example.com" }).success).toBe(false);
    expect(ivedaLoginConfigSchema.safeParse({ ...config, clients: [{ ...config.clients[0], redirectUris: ["https://ai.example/callback#fragment"] }] }).success).toBe(false);
  });
  it("publishes PKCE, resource and revocation metadata and hardens the login form", async () => {
    const metadata = await (await fetch(base + "/.well-known/oauth-authorization-server")).json();
    expect(metadata).toMatchObject({ code_challenge_methods_supported: ["S256"], scopes_supported: ["ivedaai:read"], revocation_endpoint: "https://mcp.customer.example/revoke" });
    expect(metadata.registration_endpoint).toBeUndefined();
    const flow = await start();
    expect(flow.response.headers.get("set-cookie")).toMatch(/HttpOnly; Secure; SameSite=Lax/);
    expect(flow.response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(flow.response.headers.get("cache-control")).toBe("no-store");
    expect(flow.html).toContain('autocomplete="current-password"');
    expect(logins).toHaveLength(0);
  });
  it("rejects unknown clients and unregistered redirects before IvedaAI login", async () => {
    expect((await start({ client_id: "unregistered" })).response.status).toBe(400);
    expect((await start({ redirect_uri: "https://attacker.example/receive" })).response.status).toBe(400);
    expect(logins).toHaveLength(0);
  });
  it.each(["cookie", "csrf", "origin", "consent"])("requires %s before validating credentials", async field => {
    const flow = await start();
    const response = await login(flow, field === "csrf" ? { csrf: "forged" } : field === "consent" ? { consent: "no" } : {},
      field === "cookie" ? { cookie: "" } : field === "origin" ? { origin: "https://attacker.example" } : {});
    expect(response.status).toBeGreaterThanOrEqual(400); expect(logins).toHaveLength(0);
  });
  it("rejects an invalid password without returning upstream diagnostics or codes", async () => {
    const response = await login(await start(), { password: "wrong" });
    expect(response.status).toBe(400); expect(response.headers.get("location")).toBeNull();
    expect(await response.text()).not.toContain("private upstream diagnostic");
  });
  it("binds code to PKCE, resource, client and exact callback and consumes it once", async () => {
    const flow = await start(), response = await login(flow);
    const redirect = new URL(response.headers.get("location")!); const code = redirect.searchParams.get("code")!;
    expect(redirect.origin + redirect.pathname).toBe(config.clients[0].redirectUris[0]);
    expect(redirect.searchParams.get("state")).toBe("client-state");
    for (const extra of [{ code_verifier: "wrong" }, { resource: "https://other.example/mcp" }, { client_id: "other-ai" }, { redirect_uri: "https://ai.example/different" }] as Record<string, string>[]) {
      expect((await exchange(flow, code, extra)).status).toBe(400);
    }
    expect((await exchange(flow, code)).status).toBe(200);
    expect((await exchange(flow, code)).status).toBe(400);
    expect((await login(flow)).status).toBe(400);
  });
  it("connects a real SDK client using the logged-in account and a separate opaque token", async () => {
    const { tokens } = await linked("bob");
    expect(tokens.access_token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(tokens)).not.toContain("fixture-password");
    const client = new Client({ name: "login-test", version: "1" });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(base + "/mcp"), { requestInit: { headers: { Authorization: `Bearer ${tokens.access_token}` } } }));
      const result = await client.callTool({ name: "ivedaai_camera", arguments: { operation: "GET /api/cameras/{cameraId}", path: { cameraId: 1 } } });
      expect(result.structuredContent).toMatchObject({ body: { owner: "bob" } });
      expect(logins.every(username => username === "bob")).toBe(true);
    } finally { await client.close(); }
  });
  it("rotates refresh tokens and revokes the grant on old-token reuse", async () => {
    const { tokens } = await linked();
    const fields = { client_id: "approved-ai", grant_type: "refresh_token", refresh_token: tokens.refresh_token, resource: config.publicUrl };
    const response = await form("/token", fields); expect(response.status).toBe(200);
    const next = await response.json(); expect(next.refresh_token).not.toBe(tokens.refresh_token);
    expect((await discover(next.access_token)).status).toBe(200);
    expect((await form("/token", fields)).status).toBe(400);
    expect((await discover(next.access_token)).status).toBe(401);
  });
  it("revoking one user's grant aborts its identity signal without affecting another user", async () => {
    const alice = await linked("alice"), bob = await linked("bob");
    const identity = await service.provider.authenticate(`Bearer ${alice.tokens.access_token}`);
    expect(identity.signal?.aborted).toBe(false);
    await form("/revoke", { client_id: "approved-ai", token: alice.tokens.access_token });
    expect(identity.signal?.aborted).toBe(true);
    expect((await discover(alice.tokens.access_token)).status).toBe(401);
    expect((await discover(bob.tokens.access_token)).status).toBe(200);
  });
  it("revokes access immediately and rejects refresh after the upstream login stops working", async () => {
    const first = await linked();
    expect((await form("/revoke", { client_id: "other-ai", token: first.tokens.access_token })).status).toBe(200);
    expect((await discover(first.tokens.access_token)).status).toBe(200);
    expect((await form("/revoke", { client_id: "approved-ai", token: first.tokens.access_token })).status).toBe(200);
    expect((await discover(first.tokens.access_token)).status).toBe(401);
    const second = await linked(); disabled = true;
    expect((await form("/token", { client_id: "approved-ai", grant_type: "refresh_token", refresh_token: second.tokens.refresh_token, resource: config.publicUrl })).status).toBe(400);
    expect((await discover(second.tokens.access_token)).status).toBe(401);
  });
  it("expires unused codes and issued access tokens", async () => {
    const grant = await linked();
    const flow = await start(), response = await login(flow);
    const code = new URL(response.headers.get("location")!).searchParams.get("code")!;
    const now = Date.now(); vi.spyOn(Date, "now").mockReturnValue(now + 301000);
    expect((await exchange(flow, code)).status).toBe(400);
    expect((await discover(grant.tokens.access_token)).status).toBe(401);
  });
  it("limits repeated password attempts", async () => {
    for (let i = 0; i < 5; i++) expect((await login(await start(), { password: "wrong" })).status).toBe(400);
    expect((await login(await start(), { password: "wrong" })).status).toBe(429);
    expect(logins).toHaveLength(5);
  });
});
