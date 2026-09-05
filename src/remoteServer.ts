import { createServer, type IncomingMessage } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { type JWTVerifyGetKey } from "jose";
import { TokenManager, type IvedaAIConfig } from "./auth.js";
import { createIvedaServer } from "./server.js";
import { loadSwagger, type SwaggerContext } from "./swagger.js";
import { stripDialectsFromToolList } from "./schemaDialect.js";
import { AuthenticationError, createAuthenticator, READ_SCOPE, type RemoteConfig } from "./remoteAuth.js";

class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    const chunks: Buffer[] = [];
    const cleanup = () => { req.off("data", data); req.off("end", end); req.off("error", error); req.off("aborted", aborted); };
    const error = () => { cleanup(); reject(new HttpError(400, "Invalid request body")); };
    const aborted = () => error();
    const data = (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 262144) {
        cleanup(); req.pause(); reject(new HttpError(413, "Request body too large"));
      } else chunks.push(chunk);
    };
    const end = () => {
      cleanup();
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { reject(new HttpError(400, "Invalid JSON")); }
    };
    req.on("data", data); req.on("end", end); req.on("error", error); req.on("aborted", aborted);
  });
}

/** One configured customer origin; no shared sessions, credentials or upstream tokens across requests. */
export function createRemoteServer(config: RemoteConfig, dependencies: { keys?: JWTVerifyGetKey; context?: SwaggerContext } = {}) {
  const ctx = dependencies.context ?? loadSwagger();
  if (new URL(ctx.tokenUrl, config.upstreamOrigin).origin !== new URL(config.upstreamOrigin).origin) {
    throw new Error("OAuth token endpoint must belong to the configured upstream");
  }
  const authenticate = createAuthenticator(config, dependencies.keys);
  const publicUrl = new URL(config.publicUrl);
  const metadataUrl = `${publicUrl.origin}/.well-known/oauth-protected-resource`;
  const active = new Set<() => void>();
  const bySubject = new Map<string, number>();
  let stopping = false;
  const http = createServer((req, res) => {
    const reply = (status: number, message: string) => {
      if (res.headersSent || res.destroyed) return;
      res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", "connection": "close" });
      res.end(JSON.stringify({ error: message }));
    };
    if (stopping || active.size >= 16) { reply(503, "Service busy"); return; }
    let manager: TokenManager | undefined;
    let protocol: ReturnType<typeof createIvedaServer>["server"] | undefined;
    let subjectId: string | undefined;
    let ended = false;
    const finish = () => {
      if (ended) return;
      ended = true; clearTimeout(timer); active.delete(stop);
      if (subjectId) {
        const count = (bySubject.get(subjectId) ?? 1) - 1;
        if (count) bySubject.set(subjectId, count); else bySubject.delete(subjectId);
      }
      void manager?.close().catch(() => {});
      void protocol?.close().catch(() => {});
    };
    const stop = () => { reply(503, "Service stopping"); finish(); res.destroy(); };
    const timer = setTimeout(() => { reply(504, "Request deadline exceeded"); finish(); req.destroy(); }, 30000);
    timer.unref(); active.add(stop);
    res.once("close", finish);
    res.once("finish", finish);
    res.setHeader("Cache-Control", "no-store");
    void (async () => {
      // No trust in Forwarded/X-Forwarded-* or user-supplied upstream routing headers.
      for (const name of ["authorization", "host", "origin", "mcp-session-id"]) {
        if (req.rawHeaders.filter((_, i) => i % 2 === 0 && req.rawHeaders[i].toLowerCase() === name).length > 1) {
          throw new HttpError(400, "Duplicate security header");
        }
      }
      const host = req.headers.host;
      const localHost = `127.0.0.1:${(http.address() as { port: number } | null)?.port}`;
      if (host !== publicUrl.host && host !== localHost) throw new HttpError(403, "Invalid host");
      if (req.headers.origin !== undefined && req.headers.origin !== publicUrl.origin) throw new HttpError(403, "Invalid origin");
      if (req.url === "/.well-known/oauth-protected-resource" && req.method === "GET") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ resource: config.publicUrl, authorization_servers: [config.issuer], scopes_supported: [READ_SCOPE], bearer_methods_supported: ["header"] }));
        return;
      }
      if (req.url !== "/mcp") throw new HttpError(404, "Not found");
      const subject = await authenticate(req.headers.authorization);
      if (ended) return;
      if ((bySubject.get(subject.subject) ?? 0) >= 4) throw new HttpError(429, "Too many concurrent requests");
      subjectId = subject.subject; bySubject.set(subjectId, (bySubject.get(subjectId) ?? 0) + 1);
      if (req.method !== "POST") { res.setHeader("Allow", "POST"); throw new HttpError(405, "Method not allowed"); }
      if (req.headers["mcp-session-id"] !== undefined) throw new HttpError(400, "This endpoint does not use sessions");
      if (req.headers["content-encoding"] && req.headers["content-encoding"] !== "identity") throw new HttpError(415, "Unsupported encoding");
      if (req.headers["content-type"]?.split(";")[0].trim().toLowerCase() !== "application/json") throw new HttpError(415, "Expected application/json");
      if (Number(req.headers["content-length"]) > 262144) throw new HttpError(413, "Request body too large");
      const body = await readBody(req);
      if (ended) return;
      const upstream: IvedaAIConfig = {
        origin: config.upstreamOrigin.replace(/\/$/, ""), basePath: ctx.basePath, tokenUrl: ctx.tokenUrl,
        username: subject.username, password: subject.password,
        timeoutMs: 25000, maxResponseBytes: 28672, maxImageBytes: 4194304, inlineImages: true,
        redactSecrets: true, uploadPolicy: { maxBytes: 1, allowUnconfined: false },
      };
      manager = new TokenManager(upstream);
      ({ server: protocol } = createIvedaServer(ctx, manager, { readOnly: true, allowCollectionDelete: false }));
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      const send = transport.send.bind(transport);
      transport.send = async (message, options) => {
        stripDialectsFromToolList(message);
        if ("result" in message && message.result && Array.isArray(message.result.tools)) {
          for (const tool of message.result.tools) {
            tool.securitySchemes = [{ type: "oauth2", scopes: [READ_SCOPE] }];
            tool._meta = { ...tool._meta, securitySchemes: tool.securitySchemes };
          }
        }
        return send(message, options);
      };
      await protocol.connect(transport);
      await transport.handleRequest(req, res, body);
    })().catch(error => {
      if (ended) return;
      if (error instanceof AuthenticationError) {
        const detail = error.status === 401 ? "invalid_token" : "insufficient_scope";
        res.setHeader("WWW-Authenticate", `Bearer resource_metadata="${metadataUrl}", scope="${READ_SCOPE}", error="${detail}"`);
        reply(error.status, error.message);
      } else if (error instanceof HttpError) reply(error.status, error.message);
      else reply(500, "Internal server error");
    });
  });
  http.requestTimeout = 30000;
  http.headersTimeout = 10000;
  http.keepAliveTimeout = 5000;
  return {
    http,
    close: async () => {
      stopping = true;
      for (const stop of [...active]) stop();
      await new Promise<void>((resolve, reject) => {
        http.close(error => error ? reject(error) : resolve());
        http.closeAllConnections();
      });
    },
  };
}
