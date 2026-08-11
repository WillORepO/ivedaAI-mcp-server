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
import { describe, it, expect, beforeAll, afterAll } from "vitest";

let mock: Server;
let port: number;

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
