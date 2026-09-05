import { createServer, request, type Server } from "node:http";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT, type JWTPayload } from "jose";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createRemoteServer } from "../src/remoteServer.js";
import { createAuthenticator, remoteConfigSchema, type RemoteConfig } from "../src/remoteAuth.js";

let key: Awaited<ReturnType<typeof generateKeyPair>>;
let keys: ReturnType<typeof createLocalJWKSet>;
const config: RemoteConfig = {
  publicUrl: "https://customer-a.example/mcp", issuer: "https://identity.example/",
  jwksUrl: "https://identity.example/keys", upstreamOrigin: "https://iveda-a.example", port: 3000,
  subjects: [{ subject: "alice", username: "account-alice", password: "fixture-alice" },
    { subject: "bob", username: "account-bob", password: "fixture-bob" }],
};
async function token(overrides: JWTPayload = {}, signingKey = key.privateKey) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ iss: config.issuer, aud: config.publicUrl, sub: "alice", scope: "ivedaai:read",
    iat: now, exp: now + 300, ...overrides }).setProtectedHeader({ alg: "RS256", kid: "test" }).sign(signingKey);
}
async function listen(server: Server) {
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}
const seen: { customer: string; username?: string; path: string }[] = [];
let onHeld: (() => void) | undefined;
let onHeldClosed: (() => void) | undefined;
function upstream(customer: string) {
  return createServer(async (req, res) => {
    const path = new URL(req.url!, "http://fixture").pathname;
    res.setHeader("content-type", "application/json");
    if (path.endsWith("/oauth2/token")) {
      let body = ""; for await (const chunk of req) body += chunk.toString();
      const username = new URLSearchParams(body).get("username")!;
      seen.push({ customer, username, path });
      res.end(JSON.stringify({ access_token: `token-${username}`, token_type: "Bearer", expires_in: 3600 }));
    } else {
      const username = req.headers.authorization?.replace("Bearer token-", "");
      seen.push({ customer, username, path });
      if (path.endsWith("/cameras/44")) {
        res.once("close", () => onHeldClosed?.()); onHeld?.(); return;
      }
      if (path.endsWith("/cameras/42") && username === "account-bob") {
        res.writeHead(403); res.end(JSON.stringify({ error: "No camera grant" }));
      } else res.end(JSON.stringify({ cameraId: 1, customer, owner: username }));
    }
  });
}
let upstreamA: Server, upstreamB: Server;
let serviceA: ReturnType<typeof createRemoteServer>, serviceB: ReturnType<typeof createRemoteServer>;
let endpointA: string, endpointB: string;
beforeAll(async () => {
  key = await generateKeyPair("RS256");
  keys = createLocalJWKSet({ keys: [{ ...await exportJWK(key.publicKey), kid: "test", alg: "RS256" }] });
  upstreamA = upstream("A"); upstreamB = upstream("B");
  const originA = await listen(upstreamA), originB = await listen(upstreamB);
  // Only fixture injection uses HTTP. Production CLI rejects non-HTTPS upstream configuration.
  serviceA = createRemoteServer({ ...config, upstreamOrigin: originA }, { keys });
  serviceB = createRemoteServer({ ...config, publicUrl: "https://customer-b.example/mcp", upstreamOrigin: originB }, { keys });
  endpointA = `${await listen(serviceA.http)}/mcp`; endpointB = `${await listen(serviceB.http)}/mcp`;
});
afterAll(async () => {
  await Promise.all([serviceA.close(), serviceB.close()]);
  await Promise.all([upstreamA, upstreamB].map(server => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); })));
});

describe("remote authorization", () => {
  it("requires strict HTTPS installation settings and unique subjects", () => {
    expect(remoteConfigSchema.safeParse(config).success).toBe(true);
    for (const changed of [ { upstreamOrigin: "http://private.example" }, { publicUrl: "https://mcp.example/other" },
      { jwksUrl: "https://user:password@identity.example/keys" }, { readOnly: false },
      { subjects: [config.subjects[0], config.subjects[0]] } ]) {
      expect(remoteConfigSchema.safeParse({ ...config, ...changed }).success).toBe(false);
    }
  });
  it("maps a verified subject to its configured account", async () => {
    expect((await createAuthenticator(config, keys)(`Bearer ${await token({ sub: "bob" })}`)).username).toBe("account-bob");
  });
  it.each([
    ["wrong issuer", { iss: "https://other.example" }, 401],
    ["wrong customer audience", { aud: "https://customer-b.example/mcp" }, 401],
    ["multiple audiences", { aud: [config.publicUrl, "https://customer-b.example/mcp"] }, 401],
    ["expired token", { exp: 1 }, 401],
    ["future token", { nbf: 9999999999 }, 401],
    ["missing expiry", { exp: undefined }, 401],
    ["excessive lifetime", { exp: 9999999999 }, 401],
    ["unknown user", { sub: "mallory" }, 403],
    ["missing scope", { scope: "different:read" }, 403],
  ] as [string, JWTPayload, number][])("rejects %s", async (_, claims, status) => {
    await expect(createAuthenticator(config, keys)(`Bearer ${await token(claims)}`)).rejects.toMatchObject({ status });
  });
  it("rejects an untrusted signing key", async () => {
    const other = await generateKeyPair("RS256");
    await expect(createAuthenticator(config, keys)(`Bearer ${await token({}, other.privateKey)}`)).rejects.toMatchObject({ status: 401 });
  });
});

async function post(url: string, bearer?: string, body: unknown = { jsonrpc: "2.0", id: 1, method: "tools/list" }, headers: Record<string, string> = {}) {
  return fetch(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream",
    ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), ...headers }, body: JSON.stringify(body) });
}
async function withClient(url: string, bearer: string, run: (client: Client) => Promise<void>) {
  const client = new Client({ name: "remote-test", version: "1.0" });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${bearer}` } } }));
    await run(client);
  } finally { await client.close(); }
}

async function rawStatus(url: string, headers: Record<string, string | string[]>, body = "{}") {
  return new Promise<number>((resolve, reject) => {
    const req = request(url, { method: "POST", headers: { "content-type": "application/json", ...headers } }, res => {
      res.resume(); res.on("end", () => resolve(res.statusCode!));
    });
    req.on("error", reject); req.end(body);
  });
}

describe("HTTP MCP boundary", () => {
  it("publishes discovery and challenges unauthenticated discovery without upstream calls", async () => {
    const before = seen.length;
    const response = await post(endpointA);
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("resource_metadata=");
    const metadata = await fetch(endpointA.replace("/mcp", "/.well-known/oauth-protected-resource"));
    expect(await metadata.json()).toMatchObject({ resource: config.publicUrl, authorization_servers: [config.issuer] });
    expect(seen.length).toBe(before);
  });
  it("rejects cross-customer tokens before calling either upstream", async () => {
    const before = seen.length;
    expect((await post(endpointB, await token())).status).toBe(401);
    expect(seen.length).toBe(before);
  });
  it("rejects invalid origins, hosts, query credentials and session headers", async () => {
    const bearer = await token(); const before = seen.length;
    for (const headers of [{ origin: "https://evil.example" }] as Record<string, string>[]) {
      expect((await post(endpointA, bearer, undefined, headers)).status).toBe(403);
    }
    expect(await rawStatus(endpointA, { host: "evil.example", authorization: `Bearer ${bearer}` })).toBe(403);
    expect(await rawStatus(endpointA, { authorization: [`Bearer ${bearer}`, "Bearer forged"] })).toBe(400);
    expect((await post(endpointA, bearer, undefined, { "mcp-session-id": "another-users-session" })).status).toBe(400);
    expect((await post(`${endpointA}?access_token=${bearer}`)).status).toBe(404);
    expect(seen.length).toBe(before);
  });
  it("rejects oversized and compressed bodies before upstream traffic", async () => {
    const bearer = await token(); const before = seen.length;
    expect((await post(endpointA, bearer, { padding: "x".repeat(262145) })).status).toBe(413);
    expect((await post(endpointA, bearer, {}, { "content-encoding": "gzip" })).status).toBe(415);
    expect(seen.length).toBe(before);
  });
  it("supports actual SDK discovery with only read tools, OAuth metadata and no session ID", async () => {
    await withClient(endpointA, await token(), async client => {
      const list = await client.listTools();
      expect(list.tools).toHaveLength(55);
      expect(list.tools.some(t => t.name === "ivedaai_add_camera")).toBe(false);
      expect(list.tools[0]._meta?.securitySchemes).toEqual([{ type: "oauth2", scopes: ["ivedaai:read"] }]);
    });
    const response = await post(endpointA, await token());
    expect(response.headers.get("mcp-session-id")).toBeNull();
    expect((await response.json()).result.tools[0].securitySchemes).toEqual([{ type: "oauth2", scopes: ["ivedaai:read"] }]);
  });
  it("keeps concurrent users and overlapping customer camera IDs isolated", async () => {
    await Promise.all([
      [endpointA, "alice", "A", config.publicUrl], [endpointA, "bob", "A", config.publicUrl],
      [endpointB, "alice", "B", "https://customer-b.example/mcp"],
    ].map(async ([endpoint, subject, customer, audience]) => withClient(endpoint, await token({ sub: subject, aud: audience }), async client => {
      const result = await client.callTool({ name: "ivedaai_camera", arguments: { operation: "GET /api/cameras/{cameraId}", path: { cameraId: 1 } } });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({ body: { cameraId: 1, customer, owner: `account-${subject}` } });
    })));
  });
  it("retains application camera grants and denies writes", async () => {
    await withClient(endpointA, await token({ sub: "bob" }), async client => {
      const denied = await client.callTool({ name: "ivedaai_camera", arguments: { operation: "GET /api/cameras/{cameraId}", path: { cameraId: 42 } } });
      expect(denied.isError).toBe(true);
      expect(denied.structuredContent).toMatchObject({ status: 403 });
      const before = seen.length;
      const write = await client.callTool({ name: "ivedaai_camera", arguments: { operation: "DELETE /api/cameras/{cameraId}", path: { cameraId: 1 } } });
      expect(write.isError).toBe(true); expect(seen.length).toBe(before);
    });
  });
  it("revalidates credentials on every request without treating IDs as authorization", async () => {
    const bearer = await token();
    expect((await post(endpointA, bearer)).status).toBe(200);
    expect((await post(endpointA)).status).toBe(401);
    expect((await post(endpointA, await token({ sub: "unknown-user" }))).status).toBe(403);
  });
  it("rejects a previously allowed token when the subject mapping is removed on restart", async () => {
    const bearer = await token();
    await expect(createAuthenticator(config, keys)(`Bearer ${bearer}`)).resolves.toMatchObject({ subject: "alice" });
    const updated = { ...config, subjects: [config.subjects[1]] };
    await expect(createAuthenticator(updated, keys)(`Bearer ${bearer}`)).rejects.toMatchObject({ status: 403 });
  });
  it("rejects malformed and oversized chunked JSON and unsupported HTTP methods", async () => {
    const authorization = `Bearer ${await token()}`;
    expect(await rawStatus(endpointA, { authorization }, "{")).toBe(400);
    expect(await rawStatus(endpointA, { authorization, "transfer-encoding": "chunked" }, JSON.stringify({ x: "x".repeat(262145) }))).toBe(413);
    const response = await fetch(endpointA, { headers: { authorization } });
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });
  it("bounds concurrent requests per user and aborts upstream work when clients close", async () => {
    let held = 0, closed = 0;
    let ready!: () => void, drained!: () => void;
    const reached = new Promise<void>(resolve => { ready = resolve; });
    const finished = new Promise<void>(resolve => { drained = resolve; });
    onHeld = () => { if (++held === 4) ready(); };
    onHeldClosed = () => { if (++closed === 4) drained(); };
    const bearer = await token();
    const controllers = Array.from({ length: 4 }, () => new AbortController());
    const pending = controllers.map(controller => fetch(endpointA, {
      method: "POST", signal: controller.signal,
      headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "ivedaai_camera",
        arguments: { operation: "GET /api/cameras/{cameraId}", path: { cameraId: 44 } } } }),
    }).catch(() => undefined));
    try {
      await Promise.race([reached, new Promise((_, reject) => setTimeout(() => reject(new Error("requests not started")), 3000).unref())]);
      expect((await post(endpointA, bearer)).status).toBe(429);
      expect((await post(endpointA, await token({ sub: "bob" }))).status).toBe(200);
    } finally {
      controllers.forEach(controller => controller.abort());
      await Promise.all(pending);
    }
    await Promise.race([finished, new Promise((_, reject) => setTimeout(() => reject(new Error("upstream work not aborted")), 3000).unref())]);
    expect(closed).toBe(4);
    onHeld = undefined; onHeldClosed = undefined;
  });
});
