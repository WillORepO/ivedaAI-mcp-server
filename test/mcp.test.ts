/**
 * The MCP layer itself, driven over stdio the way a client drives it.
 *
 * Everything else in this suite tests the libraries — spec parsing, request
 * building, redaction, the CRUD probe, the access policy. None of it touched
 * `src/index.ts`, which is the file a customer's client actually talks to: the
 * tool registration, the operation enum, the dispatch, and the refusals.
 *
 * That gap mattered most for the access policy. Its logic is unit-tested, but
 * whether the wiring in `index.ts` actually withholds a forbidden operation was
 * only ever checked by a throwaway script that was deleted afterwards. A
 * mis-wired filter would have passed every existing test while serving
 * `DELETE /api/cameras` to a model.
 *
 * The server is spawned through `tsx` rather than `dist/`, so the tests do not
 * silently pass against a stale build, and pointed at a local mock so no
 * deployment or credentials are needed.
 */
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

let mock: Server;
let port: number;

/** Size of the mock JPEG. Larger than the small cap the truncation test sets. */
const JPEG_BYTES = 9000;

beforeAll(async () => {
  mock = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/ainvr/api/oauth2/token") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ access_token: "test-token", token_type: "Bearer", expires_in: 600 }));
      return;
    }
    if (url.pathname === "/ainvr/api/cameras" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ content: [{ cameraId: 1, name: "Front Door" }], totalElements: 1 }));
      return;
    }
    // A binary endpoint, big enough to exceed a deliberately small cap. The
    // descriptor this produces had no coverage at all, which is how it came to
    // report the cap as the image's size.
    if (url.pathname === "/ainvr/api/streaming/1/live.jpg") {
      const jpeg = Buffer.alloc(JPEG_BYTES, 0xab);
      res.writeHead(200, { "Content-Type": "image/jpeg", "Content-Length": String(jpeg.length) });
      res.end(jpeg);
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "not found" }));
  });
  await new Promise<void>((resolve) => mock.listen(0, "127.0.0.1", resolve));
  port = (mock.address() as { port: number }).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => mock.close(() => resolve()));
});

/** A live MCP server on stdio, with a `call` that resolves JSON-RPC by id. */
class Client {
  private child: ChildProcessWithoutNullStreams;
  private buffer = "";
  private pending = new Map<number, (msg: any) => void>();
  private nextId = 1;
  readonly stderr: string[] = [];

  constructor(env: Record<string, string>) {
    this.child = spawn("npx", ["tsx", "src/index.ts"], {
      env: {
        ...process.env,
        IVEDAAI_BASE_URL: `http://127.0.0.1:${port}`,
        IVEDAAI_USERNAME: "u",
        IVEDAAI_PASSWORD: "p",
        ...env,
      },
      stdio: ["pipe", "pipe", "pipe"],
      shell: process.platform === "win32",
    }) as ChildProcessWithoutNullStreams;

    this.child.stdout.on("data", (d) => {
      this.buffer += d.toString();
      const lines = this.buffer.split("\n");
      this.buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let msg: any;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        const resolve = this.pending.get(msg.id);
        if (resolve) {
          this.pending.delete(msg.id);
          resolve(msg);
        }
      }
    });
    this.child.stderr.on("data", (d) => this.stderr.push(d.toString()));
  }

  call(method: string, params: unknown = {}): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${method}`)), 30_000);
      this.pending.set(id, (msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
      this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }

  async start(): Promise<any> {
    const res = await this.call("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "mcp-test", version: "0" },
    });
    return res.result;
  }

  stop(): void {
    this.child.kill();
  }
}

async function withClient<T>(env: Record<string, string>, fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client(env);
  try {
    return await fn(client);
  } finally {
    client.stop();
  }
}

const operationsOf = (tools: any[], name: string): string[] =>
  tools.find((t) => t.name === name)?.inputSchema?.properties?.operation?.enum ?? [];

describe("MCP server over stdio", () => {
  /**
   * The handshake used to report `ctx.spec.info.version` — the IvedaAI API
   * version from the bundled spec, not this server's. `--version` printed the
   * package version, so the same binary said "1.0.0" on the command line and
   * "10.0.0" over MCP. The MCP one is what a client displays, so bug reports
   * cited a version that was never released.
   */
  it("reports its own version at initialize, not the API's", async () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    const specVersion = JSON.parse(
      readFileSync(new URL("../resources/openapi.json", import.meta.url), "utf8")
    ).info?.version;
    await withClient({}, async (c) => {
      const result = await c.start();
      expect(result.serverInfo.version).toBe(pkg.version);
      // Guard the actual confusion, not just the happy path: the spec really
      // does carry a different version, so this would have caught the bug.
      expect(specVersion).toBeTruthy();
      expect(result.serverInfo.version).not.toBe(specVersion);
    });
  }, 60_000);

  it("hands the client its instructions at initialize", async () => {
    await withClient({}, async (c) => {
      const result = await c.start();
      // Not load-bearing on its own — the per-tool headers carry the response
      // contract for clients that ignore this — but it should be there.
      expect(result.instructions).toContain("ivedaai_get_schema");
      expect(result.serverInfo?.name).toBe("ivedaai-mcp-server");
    });
  }, 60_000);

  it("withholds collection-emptying deletes by default, and keeps the single-record one", async () => {
    await withClient({}, async (c) => {
      await c.start();
      const tools = (await c.call("tools/list")).result.tools;
      const ops = operationsOf(tools, "ivedaai_camera");
      expect(ops).not.toContain("DELETE /api/cameras");
      expect(ops).toContain("DELETE /api/cameras/{cameraId}");
    });
  }, 60_000);

  it("offers the collection delete only when the operator enables it", async () => {
    await withClient({ IVEDAAI_ALLOW_COLLECTION_DELETE: "true" }, async (c) => {
      await c.start();
      const tools = (await c.call("tools/list")).result.tools;
      expect(operationsOf(tools, "ivedaai_camera")).toContain("DELETE /api/cameras");
    });
  }, 60_000);

  it("advertises no writes at all in read-only mode", async () => {
    await withClient({ IVEDAAI_READ_ONLY: "true" }, async (c) => {
      await c.start();
      const tools = (await c.call("tools/list")).result.tools;
      for (const tool of tools) {
        for (const op of operationsOf(tools, tool.name)) {
          expect(op.startsWith("GET "), `${tool.name} offers ${op}`).toBe(true);
        }
      }
      // The hand-written write tools are not generated from the spec, so the
      // enum filter does not reach them — they must not be registered.
      expect(tools.map((t: any) => t.name)).not.toContain("ivedaai_add_camera");
      expect(tools.map((t: any) => t.name)).not.toContain("ivedaai_alert_integration");
    });
  }, 60_000);

  /**
   * The refusal a read-only server produces is the SDK's, not ours.
   *
   * `allowedOperations` strips the writes from the enum, so schema validation
   * rejects `POST /api/cameras` before any handler runs and `refusalReason`'s
   * explanation never executes. What the model receives is `invalid_value` and
   * a list of the surviving GETs — from which the only available inference is
   * that the API cannot create cameras.
   *
   * These three pin the correction rather than the bug: the rejection stays as
   * it is, and the reason is put where the model is already reading.
   */
  it("tells the client why writes are missing, at initialize", async () => {
    await withClient({ IVEDAAI_READ_ONLY: "true" }, async (c) => {
      const result = await c.start();
      expect(result.instructions).toContain("IVEDAAI_READ_ONLY=true");
      // The inference to head off, not just the fact of the mode.
      expect(result.instructions).toContain("not as evidence the API lacks the operation");
    });
  }, 60_000);

  it("repeats it on each tool, for clients that drop instructions", async () => {
    await withClient({ IVEDAAI_READ_ONLY: "true" }, async (c) => {
      await c.start();
      const tools = (await c.call("tools/list")).result.tools;
      // Only the generated tools: they are the ones with an operation enum, and
      // so the only ones anything was filtered out of. `ivedaai_get_schema`
      // looks up a definition rather than calling the API, so read-only takes
      // nothing from it and the note would be noise.
      const generated = tools.filter((t: any) => operationsOf(tools, t.name).length > 0);
      expect(generated.length).toBeGreaterThan(0);
      for (const tool of generated) {
        expect(tool.description, tool.name).toContain("Read-only mode");
      }
    });
  }, 60_000);

  it("says none of it when writes are actually available", async () => {
    await withClient({}, async (c) => {
      const result = await c.start();
      expect(result.instructions).not.toContain("Read-only mode");
      expect(result.instructions).not.toContain("IVEDAAI_READ_ONLY");
      const tools = (await c.call("tools/list")).result.tools;
      for (const tool of tools) {
        expect(tool.description, tool.name).not.toContain("Read-only mode");
      }
    });
  }, 60_000);

  /**
   * The mapper is unit-tested; this pins that it is actually reached.
   *
   * A closed port is the one transport failure that reproduces identically
   * everywhere, so the assertion is on the code rather than on prose. Before
   * this, the model got `fetch failed` and nothing else.
   */
  it("explains a connection failure instead of saying 'fetch failed'", async () => {
    // Take a port, then give it back, so nothing is listening on it.
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
    const deadPort = (probe.address() as { port: number }).port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));

    await withClient({ IVEDAAI_BASE_URL: `http://127.0.0.1:${deadPort}` }, async (c) => {
      await c.start();
      const res = await c.call("tools/call", {
        name: "ivedaai_camera",
        arguments: { operation: "GET /api/cameras", query: { size: 1 } },
      });
      const text = res.result.content[0].text as string;
      expect(text).toContain("Could not reach the IvedaAI server");
      expect(text).toContain("ECONNREFUSED");
      expect(text).toContain(`127.0.0.1:${deadPort}`);
      // The bare message this replaced must not be all the caller gets.
      expect(text).not.toMatch(/:\s*fetch failed\s*$/);
    });
  }, 60_000);

  /**
   * The binary descriptor had no coverage, and carried two untruths.
   *
   * `byteLength` was `bytes.byteLength` — what was read before the cap — so a
   * truncated response reported the cap as the file's size while the real
   * figure sat in content-length one line above. And the note said the
   * response "exceeded the cap and was not returned inline", which reads as
   * cause and effect. Binary is never returned inline at any cap, so that
   * pointed at a fix that does not exist.
   */
  const jpegCall = {
    name: "ivedaai_streaming",
    arguments: { operation: "GET /api/streaming/{cameraId}/{type}.jpg", path: { cameraId: 1, type: "live" } },
  };

  it("reports a binary body's real size when it fits under the cap", async () => {
    await withClient({}, async (c) => {
      await c.start();
      const res = await c.call("tools/call", { name: jpegCall.name, arguments: jpegCall.arguments });
      const p = JSON.parse(res.result.content[0].text);
      expect(p.status).toBe(200);
      expect(p.isBinary).toBe(true);
      expect(p.truncated).toBeFalsy();
      expect(p.body.byteLength).toBe(JPEG_BYTES);
      expect(p.body.bytesRead).toBeUndefined();
      expect(p.body.note).not.toContain("cap");
    });
  }, 60_000);

  it("still reports the real size when the cap truncated the read", async () => {
    const cap = 4096;
    await withClient({ IVEDAAI_MAX_RESPONSE_BYTES: String(cap) }, async (c) => {
      await c.start();
      const res = await c.call("tools/call", { name: jpegCall.name, arguments: jpegCall.arguments });
      const p = JSON.parse(res.result.content[0].text);
      expect(p.truncated).toBe(true);
      // The bug: this used to be `cap`.
      expect(p.body.byteLength).toBe(JPEG_BYTES);
      expect(p.body.bytesRead).toBe(cap);
      expect(p.body.note).toContain(`${cap}-byte cap`);
    });
  }, 60_000);

  it("does not blame the cap for binary never being inlined", async () => {
    // Raising the cap above the file size still yields a descriptor, so a note
    // implying the cap is what withheld the bytes would be misleading.
    await withClient({ IVEDAAI_MAX_RESPONSE_BYTES: String(JPEG_BYTES * 10) }, async (c) => {
      await c.start();
      const res = await c.call("tools/call", { name: jpegCall.name, arguments: jpegCall.arguments });
      const p = JSON.parse(res.result.content[0].text);
      expect(p.truncated).toBeFalsy();
      expect(p.body.byteLength).toBe(JPEG_BYTES);
      expect(p.body.note).toContain("not returned inline");
      expect(p.body.note).not.toContain("exceeded");
    });
  }, 60_000);

  it("dispatches a real call and returns the response", async () => {
    await withClient({}, async (c) => {
      await c.start();
      const res = await c.call("tools/call", {
        name: "ivedaai_camera",
        arguments: { operation: "GET /api/cameras", query: { size: 1 } },
      });
      expect(res.result.isError).toBeFalsy();
      const payload = JSON.parse(res.result.content[0].text);
      expect(payload.status).toBe(200);
      expect(payload.body.content[0].name).toBe("Front Door");
    });
  }, 60_000);

  it("rejects a forbidden operation a client sends anyway, without calling the deployment", async () => {
    // Worth pinning what actually rejects it. Because `allowedOperations`
    // removes the operation from the enum, the SDK's schema validation refuses
    // the call before the handler runs, so the prose refusal in accessPolicy is
    // not what a client sees here — it is reached only if the enum and the
    // policy ever disagree, and for the hand-written tools that bypass the
    // enum entirely.
    //
    // The invariant that matters either way: rejected, and nothing reached the
    // deployment.
    await withClient({}, async (c) => {
      await c.start();
      const res = await c.call("tools/call", {
        name: "ivedaai_camera",
        arguments: { operation: "DELETE /api/cameras" },
      });
      expect(res.result?.isError ?? Boolean(res.error)).toBe(true);
      const text = JSON.stringify(res);
      expect(text).toContain("DELETE /api/cameras");
      // No response body from the API — the call never left the server.
      expect(text).not.toContain('\\"status\\": 200');
      // And the valid alternatives are still named, so a model can recover.
      expect(text).toContain("DELETE /api/cameras/{cameraId}");
    });
  }, 60_000);

  it("warns on stderr about plain HTTP to a non-loopback host", async () => {
    await withClient({ IVEDAAI_BASE_URL: "http://192.0.2.10" }, async (c) => {
      await c.start().catch(() => undefined);
      await new Promise((r) => setTimeout(r, 1500));
      expect(c.stderr.join("")).toContain("plain HTTP");
    });
  }, 60_000);
});
