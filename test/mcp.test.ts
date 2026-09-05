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
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { loadSwagger, tagToToolName } from "../src/swagger.js";
import { policyFromEnv, allowedOperations } from "../src/accessPolicy.js";
import { MULTIPART_BODY_FIELD, MULTIPART_FILE_FIELD } from "../src/request.js";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  GET_SCHEMA_DESCRIPTION,
  ALERT_INTEGRATION_DESCRIPTION,
  ADD_CAMERA_DESCRIPTION,
} from "../src/toolDocs.js";

/**
 * tsx's CLI and this server's entry point, both as absolute paths.
 *
 * These tests used to spawn `npx tsx src/index.ts` with `shell: true` on
 * Windows, and that cost more than it looked like. `npx` re-resolves the binary
 * on every call: 2.5s per spawn against 0.25s for running the same CLI through
 * node directly. This file spawns a server per test, so the suite was paying
 * roughly 45 seconds to do nothing, and on a contended machine one of those
 * spawns would push past the 30s call timeout and fail with "timed out waiting
 * for initialize" — measured at one run in ten, on whichever test happened to
 * draw the slow spawn.
 *
 * Resolving through `createRequire` rather than a relative path so this keeps
 * working under a hoisted or pnpm-style node_modules layout. Dropping `npx`
 * also drops the `shell: true` it needed on Windows, and with it Node's
 * DEP0190 warning about passing arguments to a shell.
 */
const testRequire = createRequire(import.meta.url);
const TSX_CLI = join(dirname(testRequire.resolve("tsx/package.json")), "dist", "cli.mjs");
const SERVER_ENTRY = fileURLToPath(new URL("../src/index.ts", import.meta.url));
const BUNDLED_SPEC = fileURLToPath(new URL("../resources/openapi.json", import.meta.url));

let mock: Server;
let port: number;

/**
 * What the mock was asked to do, so a test can assert on what it was *not*
 * asked to do. A refused upload must reach neither counter.
 */
let tokenRequests = 0;
let uploadsReceived: { hasFilePart: boolean; bytes: number }[] = [];
/** Requests to the guarded update, so a refusal can be shown not to have travelled. */
let userGroupPatches = 0;

/** Fixture tree for the upload tests; removed in afterAll. */
let uploadBase: string;
let uploadRoot: string;

/** Size of the mock JPEG. Larger than the small cap the truncation test sets. */
const JPEG_BYTES = 9000;

beforeAll(async () => {
  mock = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/ainvr/api/oauth2/token") {
      tokenRequests += 1;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ access_token: "test-token", token_type: "Bearer", expires_in: 600 }));
      return;
    }
    if (url.pathname === "/ainvr/api/cameras" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      // A page out of a larger collection when asked for one, so the pagination
      // summary has something real to summarise. `size=1` is what the existing
      // dispatch test sends, and it keeps its single "Front Door" either way.
      const paged = url.searchParams.get("page") !== null || url.searchParams.get("size") === "1";
      res.end(
        JSON.stringify(
          paged
            ? {
                content: [{ cameraId: 1, name: "Front Door" }],
                numberOfElements: 1,
                totalElements: 400,
                totalPages: 400,
                number: Number(url.searchParams.get("page") ?? 0),
                size: 1,
                first: true,
                last: false,
              }
            : { content: [{ cameraId: 1, name: "Front Door" }], totalElements: 1 }
        )
      );
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
    // Same operation, a type no client can display. Keeps the descriptor tests
    // testing the descriptor: images now take a different path through the
    // handler, and reusing the JPEG for both would let one feature's change
    // silently rewrite the other's expectations.
    if (url.pathname === "/ainvr/api/streaming/2/live.jpg") {
      const blob = Buffer.alloc(JPEG_BYTES, 0xcd);
      res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": String(blob.length) });
      res.end(blob);
      return;
    }
    // A record carrying a credential-shaped field, so redaction has something
    // real to mask. The deployment returns NVR passwords in plain text.
    if (url.pathname === "/ainvr/api/nvrs" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          content: [{ nvrId: 1, name: "Back Office NVR", account: "admin", password: "hunter2-in-the-clear" }],
          totalElements: 1,
        })
      );
      return;
    }
    // The lossy-update guard's one operation. Counted rather than answered:
    // a refusal that reaches here has not refused.
    if (/^\/ainvr\/api\/user-groups\/\S+$/.test(url.pathname) && req.method === "PATCH") {
      userGroupPatches += 1;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ userGroupId: "g1", name: "patched" }));
      return;
    }
    // A camera update, so the round-trip diagnostic has a 2xx to ride on. It
    // must be a success: the SDK skips outputSchema validation when isError is
    // set, so a 4xx would prove nothing about the declared shape.
    if (/^\/ainvr\/api\/cameras\/\d+$/.test(url.pathname) && req.method === "PATCH") {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ cameraId: 1, name: "Patched", nvr: null }));
      });
      return;
    }
    // A multipart sink, so an upload that is *allowed* can be shown to arrive
    // rather than merely not being refused.
    if (url.pathname === "/ainvr/api/detection/objects" && req.method === "POST") {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const raw = Buffer.concat(chunks);
        uploadsReceived.push({ hasFilePart: /name="file"/.test(raw.toString("latin1")), bytes: raw.length });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "not found" }));
  });
  await new Promise<void>((resolve) => mock.listen(0, "127.0.0.1", resolve));
  port = (mock.address() as { port: number }).port;

  uploadBase = mkdtempSync(join(tmpdir(), "mcp-upload-"));
  uploadRoot = join(uploadBase, "root");
  mkdirSync(uploadRoot);
  writeFileSync(join(uploadRoot, "face.jpg"), Buffer.alloc(1024, 0xab));
  mkdirSync(join(uploadBase, "elsewhere", ".ssh"), { recursive: true });
  writeFileSync(join(uploadBase, "elsewhere", ".ssh", "id_rsa"), "PRIVATE KEY");
  // Deliberately in an innocuous directory: this one has to be caught by its
  // name, not by the directory it sits in, which is the rule the .ssh fixture
  // does not exercise.
  writeFileSync(join(uploadBase, "elsewhere", "claude_desktop_config.json"), '{"IVEDAAI_PASSWORD":"hunter2"}');
});

afterAll(async () => {
  await new Promise<void>((resolve) => mock.close(() => resolve()));
  rmSync(uploadBase, { recursive: true, force: true });
});

/**
 * The developer's environment with every `IVEDAAI_*` variable removed.
 *
 * These tests spawn a server per case and used to hand it `...process.env`, so
 * each one ran against whatever the developer happened to have exported. That
 * is fine until someone follows the README's own advice and sets
 * `IVEDAAI_READ_ONLY=true` while working against a real deployment: six of
 * these then fail, because the cases that assert on the *default* policy never
 * said they wanted it and silently inherited read-only instead.
 *
 * Those failures reproduce nowhere else. CI runners have no such variable, so
 * the suite is green there and red on one laptop, which is the worst shape a
 * test failure can take.
 *
 * Stripping the whole prefix rather than a list of known names, so a variable
 * added to the server later is neutralised here without anyone remembering to
 * come back. Everything else — PATH, the vitest plumbing, the temp dirs — is
 * passed through untouched, because the child is a real node process and needs
 * it. What each test wants is then stated below, in the test.
 *
 * Read at spawn time rather than snapshotted at module load, so
 * "ignores the developer's own IVEDAAI_ settings" tests the stripping. A
 * snapshot would pass that test by accident, simply for predating the variable
 * the test sets.
 */
function ambientEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("IVEDAAI_"))
  ) as Record<string, string>;
}

/** A live MCP server on stdio, with a `call` that resolves JSON-RPC by id. */
class Client {
  private child: ChildProcessWithoutNullStreams;
  private buffer = "";
  private pending = new Map<number, (msg: any) => void>();
  private nextId = 1;
  readonly stderr: string[] = [];

  constructor(env: Record<string, string>) {
    this.child = spawn(process.execPath, [TSX_CLI, SERVER_ENTRY], {
      env: {
        ...ambientEnv(),
        IVEDAAI_BASE_URL: `http://127.0.0.1:${port}`,
        IVEDAAI_USERNAME: "u",
        IVEDAAI_PASSWORD: "p",
        ...env,
      },
      stdio: ["pipe", "pipe", "pipe"],
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

  /**
   * The isolation itself, asserted rather than assumed.
   *
   * Every case below that does not name a policy is relying on this: that the
   * server it spawns is configured by the test and not by the shell the suite
   * was launched from. Pinning it here means a regression shows up as one
   * honest failure with a name that explains it, instead of as six unrelated
   * ones on whichever machine has the variable set.
   */
  it("ignores the developer's own IVEDAAI_ settings", async () => {
    const previous = process.env.IVEDAAI_READ_ONLY;
    process.env.IVEDAAI_READ_ONLY = "true";
    try {
      await withClient({}, async (c) => {
        await c.start();
        const tools = (await c.call("tools/list")).result.tools;
        // A read-only server registers neither of these and offers no writes.
        expect(tools.map((t: any) => t.name)).toContain("ivedaai_add_camera");
        expect(operationsOf(tools, "ivedaai_camera")).toContain("POST /api/cameras");
      });
    } finally {
      if (previous === undefined) delete process.env.IVEDAAI_READ_ONLY;
      else process.env.IVEDAAI_READ_ONLY = previous;
    }
  }, 60_000);

  it("publishes no JSON Schema dialect on any tool schema", async () => {
    // The SDK stamps draft-07 onto every schema it generates, and a client
    // whose validator implements 2020-12 only then refuses to invoke the tool
    // at all — not a failed call, an uninvokable tool. This was live: every
    // one of the 66 tools was rejected by a real client before any request
    // was built. Asserted over the wire rather than against the strip
    // function, because what matters is what a client receives.
    await withClient({}, async (c) => {
      await c.start();
      const tools = (await c.call("tools/list")).result.tools;
      expect(tools.length).toBeGreaterThan(0);

      const offenders: string[] = [];
      for (const tool of tools as Array<Record<string, any>>) {
        for (const which of ["inputSchema", "outputSchema"]) {
          const schema = tool[which];
          if (schema && typeof schema === "object" && "$schema" in schema) {
            offenders.push(`${tool.name}.${which} declares ${schema.$schema}`);
          }
        }
      }
      expect(offenders).toEqual([]);

      // The strip must not have taken the schema with it: these are a
      // contract the SDK validates every non-error result against.
      const generated = (tools as Array<Record<string, any>>).find((t) => t.name === "ivedaai_camera");
      expect(generated?.outputSchema?.type).toBe("object");
      expect(generated?.outputSchema?.required).toContain("status");
      expect(generated?.inputSchema?.properties?.operation).toBeTruthy();
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
      // Not "every operation is a GET" any more: a few POSTs carry a query in
      // their body and only read, and read-only offers those. Anything else
      // that is not a GET is a bug in READ_SAFE_WRITES.
      const readSafe = new Set([
        "POST /api/alerts/_search",
        "POST /api/alerts/latest",
        "POST /api/alerts/statistics",
      ]);
      for (const tool of tools) {
        for (const op of operationsOf(tools, tool.name)) {
          expect(op.startsWith("GET ") || readSafe.has(op), `${tool.name} offers ${op}`).toBe(true);
        }
      }
      // And the aggregation is actually reachable, which is the point of the
      // change: without it, counting by camera costs one call per camera.
      expect(operationsOf(tools, "ivedaai_alert")).toContain("POST /api/alerts/statistics");
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

  it("does not publish bundled deployment findings for an operator-supplied spec", async () => {
    await withClient({ IVEDAAI_SWAGGER_PATH: BUNDLED_SPEC }, async (c) => {
      await c.start();
      const tools = (await c.call("tools/list")).result.tools;
      const counting = tools.find((tool: any) => tool.name === "ivedaai_counting");
      expect(counting).toBeDefined();
      expect(counting.description).not.toContain("top-level object-type keys");
      for (const tool of tools) expect(tool.description, tool.name).not.toContain("CAUTION:");
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
  /** Camera 2 on the mock answers with an undisplayable type, so these stay on the descriptor path. */
  const blobCall = {
    name: "ivedaai_streaming",
    arguments: { operation: "GET /api/streaming/{cameraId}/{type}.jpg", path: { cameraId: 2, type: "live" } },
  };

  it("reports a binary body's real size when it fits under the cap", async () => {
    await withClient({}, async (c) => {
      await c.start();
      const res = await c.call("tools/call", { name: blobCall.name, arguments: blobCall.arguments });
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
      const res = await c.call("tools/call", { name: blobCall.name, arguments: blobCall.arguments });
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
      const res = await c.call("tools/call", { name: blobCall.name, arguments: blobCall.arguments });
      const p = JSON.parse(res.result.content[0].text);
      expect(p.truncated).toBeFalsy();
      expect(p.body.byteLength).toBe(JPEG_BYTES);
      expect(p.body.note).toContain("not returned inline");
      expect(p.body.note).not.toContain("exceeded");
    });
  }, 60_000);

  /**
   * Images used to arrive as a size and a MIME type. The bytes were read,
   * described, and dropped — so a model asked what a camera could see had no
   * way to look, on an API with 18 image endpoints.
   */
  it("hands a JPEG to the client as a viewable image", async () => {
    await withClient({}, async (c) => {
      await c.start();
      const res = await c.call("tools/call", { name: jpegCall.name, arguments: jpegCall.arguments });
      const content = res.result.content;
      expect(content).toHaveLength(2);
      expect(content[0].type).toBe("text");
      expect(content[1].type).toBe("image");
      expect(content[1].mimeType).toBe("image/jpeg");
      expect(Buffer.from(content[1].data, "base64").length).toBe(JPEG_BYTES);
    });
  }, 60_000);

  it("does not also bury the base64 in the text half of the result", async () => {
    await withClient({}, async (c) => {
      await c.start();
      const res = await c.call("tools/call", { name: jpegCall.name, arguments: jpegCall.arguments });
      const text = res.result.content[0].text as string;
      const p = JSON.parse(text);
      // Sending it twice would cost the whole image again as unreadable text.
      expect(p.image).toBeUndefined();
      expect(text).not.toContain(res.result.content[1].data.slice(0, 64));
      expect(p.body.byteLength).toBe(JPEG_BYTES);
      expect(p.body.note).toContain("attached to this result");
    });
  }, 60_000);

  it("refuses to attach an image it only partly read", async () => {
    // A truncated image is a corrupt file, not a smaller one. Setting the image
    // budget below the file forces the descriptor-only path.
    await withClient({ IVEDAAI_MAX_IMAGE_BYTES: "1024", IVEDAAI_MAX_RESPONSE_BYTES: "1024" }, async (c) => {
      await c.start();
      const res = await c.call("tools/call", { name: jpegCall.name, arguments: jpegCall.arguments });
      expect(res.result.content).toHaveLength(1);
      const p = JSON.parse(res.result.content[0].text);
      expect(p.truncated).toBe(true);
      expect(p.body.byteLength).toBe(JPEG_BYTES);
      expect(p.body.note).toContain("IVEDAAI_MAX_IMAGE_BYTES");
    });
  }, 60_000);

  it("can be switched off entirely", async () => {
    await withClient({ IVEDAAI_INLINE_IMAGES: "false" }, async (c) => {
      await c.start();
      const res = await c.call("tools/call", { name: jpegCall.name, arguments: jpegCall.arguments });
      expect(res.result.content).toHaveLength(1);
      const p = JSON.parse(res.result.content[0].text);
      expect(p.body.byteLength).toBe(JPEG_BYTES);
      expect(p.body.note).toContain("not returned inline");
    });
  }, 60_000);

  /**
   * The upload guard, exercised where a client reaches it.
   *
   * `uploadPath.ts` is unit-tested and `executeOperation` is integration-tested,
   * including that a refused upload leaves the token and API counters alone. But
   * neither touches `index.ts`, and this file exists because that is the gap
   * that matters: the guard could be correct in both places and still be
   * mis-wired in the tool handler — a swallowed error, or a `file` argument that
   * never reaches `executeOperation` — and every other test would pass while a
   * private key went to the deployment.
   *
   * The mock counts what it was asked to do, so these assert on what it was
   * *not* asked to do rather than only on the text of a refusal.
   */
  const uploadCall = (path: string) => ({
    name: "ivedaai_detection",
    arguments: { operation: "POST /api/detection/objects", file: { path } },
  });

  it("refuses a local file when no upload root is configured", async () => {
    uploadsReceived = [];
    await withClient({}, async (c) => {
      await c.start();
      const res = await c.call("tools/call", uploadCall(join(uploadRoot, "face.jpg")));
      expect(res.result.isError).toBe(true);
      expect(res.result.content[0].text).toContain("IVEDAAI_UPLOAD_ROOT");
      expect(uploadsReceived).toHaveLength(0);
    });
  }, 60_000);

  it("uploads a file inside the configured root, and the bytes arrive", async () => {
    uploadsReceived = [];
    await withClient({ IVEDAAI_UPLOAD_ROOT: uploadRoot }, async (c) => {
      await c.start();
      const res = await c.call("tools/call", uploadCall(join(uploadRoot, "face.jpg")));
      expect(res.result.isError).toBeFalsy();
      // Not merely "was not refused": the multipart body reached the mock.
      expect(uploadsReceived).toHaveLength(1);
      expect(uploadsReceived[0].hasFilePart).toBe(true);
      expect(uploadsReceived[0].bytes).toBeGreaterThan(1024);
    });
  }, 60_000);

  it("refuses a path outside the root, without contacting the deployment", async () => {
    uploadsReceived = [];
    const before = tokenRequests;
    await withClient({ IVEDAAI_UPLOAD_ROOT: uploadRoot }, async (c) => {
      await c.start();
      const res = await c.call("tools/call", uploadCall(join(uploadBase, "elsewhere", ".ssh", "id_rsa")));
      expect(res.result.isError).toBe(true);
      expect(res.result.content[0].text).toMatch(/Refusing to upload/);
      expect(uploadsReceived).toHaveLength(0);
      // Validation runs before authentication, so a rejected upload cannot even
      // put the account password on the wire.
      expect(tokenRequests).toBe(before);
    });
  }, 60_000);

  it("still refuses a credential path under the unconfined escape hatch", async () => {
    uploadsReceived = [];
    const before = tokenRequests;
    await withClient({ IVEDAAI_ALLOW_UNCONFINED_UPLOADS: "true" }, async (c) => {
      await c.start();
      const res = await c.call("tools/call", uploadCall(join(uploadBase, "elsewhere", ".ssh", "id_rsa")));
      expect(res.result.isError).toBe(true);
      expect(uploadsReceived).toHaveLength(0);
      expect(tokenRequests).toBe(before);
    });
  }, 60_000);

  it("refuses the MCP client's own config by name, wherever it lives", async () => {
    // The .ssh fixture above is refused by its directory, so the filename rule
    // was untested until a mutation showed the other test still passed with
    // "id_rsa" removed. This one sits in an ordinary directory and can only be
    // caught by its name — and it is the file that, on a normal install, holds
    // IVEDAAI_PASSWORD in clear text.
    uploadsReceived = [];
    const before = tokenRequests;
    await withClient({ IVEDAAI_ALLOW_UNCONFINED_UPLOADS: "true" }, async (c) => {
      await c.start();
      const res = await c.call("tools/call", uploadCall(join(uploadBase, "elsewhere", "claude_desktop_config.json")));
      expect(res.result.isError).toBe(true);
      expect(uploadsReceived).toHaveLength(0);
      expect(tokenRequests).toBe(before);
    });
  }, 60_000);

  /**
   * The round-trip diagnostic, where a client receives it.
   *
   * `roundTrip.ts` is well covered — `fieldsAtRisk`, `roundTripWarning` and the
   * rest all have unit tests. What had none, anywhere in the suite, is the
   * `omittedFields` block those produce: it appeared in zero assertions across
   * all four test files. The logic could be right and the wiring in `index.ts`
   * wrong — attached to the text block but not `structuredContent`, or dropped
   * altogether — and every existing test would pass.
   *
   * Confirmed against a deployment first (PATCH /api/cameras/147, 200, all three
   * categories populated, no schema rejection), then pinned here so it holds
   * without one.
   */
  const patchCamera = (body: Record<string, unknown>) => ({
    name: "ivedaai_camera",
    arguments: { operation: "PATCH /api/cameras/{cameraId}", path: { cameraId: 1 }, body },
  });

  it("reports the fields an update omits that no read returns", async () => {
    await withClient({}, async (c) => {
      await c.start();
      const res = await c.call("tools/call", patchCamera({ name: "Patched", cameraType: "General" }));
      expect(res.result.isError).toBeFalsy();
      const payload = JSON.parse(res.result.content[0].text);
      const omitted = payload.omittedFields;
      expect(omitted, "omittedFields should be attached").toBeDefined();
      // nvrId is readable, but under another key; these two are readable nowhere.
      expect(omitted.readableElsewhere).toContainEqual({ field: "nvrId", readAt: "nvr.nvrId" });
      expect(omitted.noKnownSource).toEqual(expect.arrayContaining(["doRecording", "engineConfig"]));
      expect(omitted.note).toContain("nvr.nvrId");
    });
  }, 60_000);

  it("puts the diagnostic in structuredContent too, not only the text", async () => {
    // The two halves of a result must not say different things — a client
    // reading structured output would otherwise never learn a field was at risk.
    await withClient({}, async (c) => {
      await c.start();
      const res = await c.call("tools/call", patchCamera({ name: "Patched", cameraType: "General" }));
      expect(res.result.structuredContent?.omittedFields).toBeDefined();
      expect(res.result.structuredContent.omittedFields).toEqual(
        JSON.parse(res.result.content[0].text).omittedFields
      );
    });
  }, 60_000);

  it("stays quiet when the body puts nothing at risk", async () => {
    // A caller who sends the at-risk fields is not at risk, and a diagnostic
    // that fires anyway trains people to ignore it.
    await withClient({}, async (c) => {
      await c.start();
      const res = await c.call(
        "tools/call",
        patchCamera({ name: "Patched", cameraType: "General", nvrId: 3, doRecording: false, engineConfig: {} })
      );
      expect(res.result.isError).toBeFalsy();
      expect(JSON.parse(res.result.content[0].text).omittedFields).toBeUndefined();
      expect(res.result.structuredContent?.omittedFields).toBeUndefined();
    });
  }, 60_000);

  /**
   * Two safety promises, asserted where a client collects them.
   *
   * Both are well covered in the library and neither had a client-facing
   * assertion. That is the same shape as the upload guard and the round-trip
   * diagnostic before them: correct in `redact.ts` and `partialUpdate.ts`, and
   * nothing checking that `index.ts` still calls them. Silent when it breaks —
   * a password reaching a model, or an update quietly discarding a field — which
   * is exactly the kind of failure a test has to catch instead of a person.
   */
  it("masks a credential-shaped field before the model can read it", async () => {
    await withClient({}, async (c) => {
      await c.start();
      const res = await c.call("tools/call", {
        name: "ivedaai_nvr",
        arguments: { operation: "GET /api/nvrs", query: { size: 1 } },
      });
      const text = res.result.content[0].text as string;
      // The value itself must not appear anywhere in what the client receives —
      // neither half of the result, not just the parsed body.
      expect(text).not.toContain("hunter2-in-the-clear");
      expect(JSON.stringify(res.result.structuredContent)).not.toContain("hunter2-in-the-clear");
      expect(JSON.parse(text).body.content[0].password).toMatch(/REDACTED/);
      // Everything else survives: redaction that ate the record would pass a
      // test that only checked the secret was gone.
      expect(JSON.parse(text).body.content[0].name).toBe("Back Office NVR");
    });
  }, 60_000);

  it("hands the secret over when the operator turns redaction off", async () => {
    // Otherwise the test above passes whenever redaction is broken *open* in the
    // other direction — masking everything, or the field never arriving at all.
    await withClient({ IVEDAAI_REDACT_SECRETS: "false" }, async (c) => {
      await c.start();
      const res = await c.call("tools/call", {
        name: "ivedaai_nvr",
        arguments: { operation: "GET /api/nvrs", query: { size: 1 } },
      });
      expect(JSON.parse(res.result.content[0].text).body.content[0].password).toBe("hunter2-in-the-clear");
    });
  }, 60_000);

  it("refuses a partial update that would silently discard a field", async () => {
    const before = userGroupPatches;
    await withClient({}, async (c) => {
      await c.start();
      const res = await c.call("tools/call", {
        name: "ivedaai_user_group",
        arguments: {
          operation: "PATCH /api/user-groups/{userGroupId}",
          path: { userGroupId: "g1" },
          body: { name: "renamed" },
        },
      });
      expect(res.result.isError).toBe(true);
      expect(res.result.content[0].text).toContain("externalId");
      // The refusal has to happen here, not at the deployment: this endpoint
      // answers 200 while nulling the omitted field, so a call that travels has
      // already done the damage.
      expect(userGroupPatches).toBe(before);
    });
  }, 60_000);

  it("lets the same update through once the field is stated explicitly", async () => {
    // The guard exists to stop an accident, not to make the operation
    // unreachable — clearing a field on purpose is a legitimate thing to do.
    const before = userGroupPatches;
    await withClient({}, async (c) => {
      await c.start();
      const res = await c.call("tools/call", {
        name: "ivedaai_user_group",
        arguments: {
          operation: "PATCH /api/user-groups/{userGroupId}",
          path: { userGroupId: "g1" },
          body: { name: "renamed", externalId: null },
        },
      });
      expect(res.result.isError).toBeFalsy();
      expect(userGroupPatches).toBe(before + 1);
    });
  }, 60_000);

  /**
   * The hand-written descriptions must stay where the budget script can see them.
   *
   * They were inline string literals in `index.ts` until today, out of reach of
   * `measure` — which therefore reported the 63 generated tools and disclaimed
   * the rest. `ivedaai_alert_integration` was the largest single tool of any kind
   * at the time, and trimming it by 6,207 characters moved the reported total by
   * exactly zero.
   *
   * Note what this does *not* do. Comparing the served description against the
   * exported constant proves nothing: `index.ts` references that same constant,
   * so both sides move together and the assertion cannot fail. Mutation testing
   * caught that — the first version of this test passed with the constant
   * deliberately corrupted.
   *
   * So it checks the registrations reference the constants, which is the property
   * that actually keeps the budget measurable, and would fail if someone pasted a
   * literal back into a registration.
   */
  it("registers the hand-written tools from the measured constants, not inline text", () => {
    const source = readFileSync(SERVER_ENTRY, "utf8");
    for (const constant of ["GET_SCHEMA_DESCRIPTION", "ALERT_INTEGRATION_DESCRIPTION", "ADD_CAMERA_DESCRIPTION"]) {
      expect(source, constant).toContain(`description: ${constant},`);
    }
    // And no registration carries a long literal of its own any more. 400 is well
    // above the longest remaining inline string and well below the 2,000-plus
    // characters each of these three used to occupy.
    const inlineLiterals = [...source.matchAll(/description:\s*"([^"]{400,})"/g)];
    expect(inlineLiterals.map((m) => m[1].slice(0, 60))).toEqual([]);
  });

  it("serves those exact descriptions to a client", async () => {
    // Weaker than it looks on its own — see above — but worth keeping as the end
    // of the chain: the constants really are what reaches a tool list.
    await withClient({}, async (c) => {
      await c.start();
      const tools = (await c.call("tools/list")).result.tools;
      const lengths = Object.fromEntries(
        ["ivedaai_get_schema", "ivedaai_alert_integration", "ivedaai_add_camera"].map((n) => [
          n,
          tools.find((t: any) => t.name === n)?.description?.length,
        ])
      );
      expect(lengths).toEqual({
        ivedaai_get_schema: GET_SCHEMA_DESCRIPTION.length,
        ivedaai_alert_integration: ALERT_INTEGRATION_DESCRIPTION.length,
        ivedaai_add_camera: ADD_CAMERA_DESCRIPTION.length,
      });
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

  /**
   * The declared result shape, and the thing that makes declaring it risky.
   *
   * `outputSchema` is not documentation the SDK ignores. It validates every
   * non-error result against it and answers a mismatch with a JSON-RPC error
   * instead of the result — so a schema that is wrong about a real response does
   * not degrade the call, it destroys it. Each of these therefore asserts on
   * `res.result` rather than only on its contents: if validation had failed
   * there would be no `result` at all, only `res.error`.
   */
  /**
   * The annotation drifted once and the drift was invisible: the generated
   * tools said `openWorldHint: false` while `ivedaai_alert_integration` and
   * `ivedaai_add_camera` said `true`, with nothing recording a reason for
   * either. It was not a distinction — those two wrap operations the generated
   * tools also offer (`POST /api/alertTriggers` on `ivedaai_alert_trigger`,
   * `POST /api/cameras` on `ivedaai_camera`), so the same call answered
   * differently depending on which tool a client reached it through.
   */
  it("agrees with itself about which tools reach an open world", async () => {
    await withClient({}, async (c) => {
      await c.start();
      const tools = (await c.call("tools/list")).result.tools;
      for (const tool of tools) {
        // ivedaai_get_schema answers out of the bundled spec and opens no
        // connection, so it is the sole closed-world tool.
        const expected = tool.name !== "ivedaai_get_schema";
        expect(tool.annotations?.openWorldHint, `${tool.name}`).toBe(expected);
      }
    });
  }, 60_000);

  /**
   * `idempotentHint` on a tool that dispatches to many operations is only true
   * if it holds for all of them, so this checks the claim against the operation
   * enum the same tool advertises rather than against a hand-kept list.
   */
  it("claims idempotence only where every operation it offers is idempotent", async () => {
    const idempotentMethods = new Set(["GET", "HEAD", "OPTIONS", "PUT", "DELETE"]);
    await withClient({}, async (c) => {
      await c.start();
      const tools = (await c.call("tools/list")).result.tools;
      let claimed = 0;
      for (const tool of tools) {
        expect(tool.annotations?.idempotentHint, `${tool.name} declares none`).toBeTypeOf("boolean");
        const ops = operationsOf(tools, tool.name);
        // The hand-written tools have no operation enum to check against.
        if (ops.length === 0) continue;
        const every = ops.every((op: string) => idempotentMethods.has(op.split(" ")[0]));
        expect(tool.annotations.idempotentHint, `${tool.name} offers ${ops.join(", ")}`).toBe(every);
        if (every) claimed++;
      }
      // A guard against the rule silently collapsing to "false everywhere",
      // which would pass the assertion above and say nothing.
      expect(claimed).toBeGreaterThan(10);
    });
  }, 60_000);

  /**
   * The failure this exists for: a model handed 1 record and `totalElements:
   * 400` answering from the 1. Spring says so in a response that also carries
   * `number`, `numberOfElements`, `totalPages`, `first`, `last`, `empty` and a
   * nested `pageable` restating most of them, and reading that correctly means
   * knowing which of the two counts is the collection's.
   */
  it("summarises a page into whether there is more and what to send for it", async () => {
    await withClient({}, async (c) => {
      await c.start();
      const res = await c.call("tools/call", {
        name: "ivedaai_camera",
        arguments: { operation: "GET /api/cameras", query: { size: 1 } },
      });
      const p = res.result.structuredContent;
      expect(p.pagination).toEqual({
        total: 400,
        count: 1,
        page: 0,
        size: 1,
        hasMore: true,
        nextPage: 1,
        note: expect.stringContaining('{"page": 1}'),
      });
      // The deployment's own response is left exactly as it arrived.
      expect(p.body.totalElements).toBe(400);
      expect(p.body.content).toHaveLength(1);
    });
  }, 60_000);

  it("says nothing about pagination on an operation that does not paginate", async () => {
    await withClient({}, async (c) => {
      await c.start();
      // GET /api/streaming/… answers with an image, not a page.
      const res = await c.call("tools/call", { name: jpegCall.name, arguments: jpegCall.arguments });
      expect(res.result.structuredContent.pagination).toBeUndefined();
    });
  }, 60_000);

  it("tells the client about the pagination block once, at initialize", async () => {
    await withClient({}, async (c) => {
      // Paid once here rather than on all 63 tool descriptions, which is why the
      // actionable half is repeated in the payload's own `note` — that one no
      // client can drop.
      const result = await c.start();
      expect(result.instructions).toContain("hasMore");
      expect(result.instructions).toContain("nextPage");
      expect(result.instructions).toContain("pagination.note");
      expect(result.instructions).not.toContain('send query {"page"');
    });
  }, 60_000);

  it("declares an output schema on every tool", async () => {
    await withClient({}, async (c) => {
      await c.start();
      const tools = (await c.call("tools/list")).result.tools;
      expect(tools.length).toBeGreaterThan(60);
      for (const tool of tools) {
        expect(tool.outputSchema?.type, `${tool.name} declares no output schema`).toBe("object");
        if (operationsOf(tools, tool.name).length > 0) {
          expect(tool.outputSchema?.required, `${tool.name} does not require its always-present body`).toContain("body");
        }
      }
      const addCamera = tools.find((tool: any) => tool.name === "ivedaai_add_camera");
      expect(addCamera?.outputSchema?.required).toEqual(expect.arrayContaining(["ainvrId", "results"]));
    });
  }, 60_000);

  it("returns structured content saying the same thing as the text half", async () => {
    await withClient({}, async (c) => {
      await c.start();
      const res = await c.call("tools/call", {
        name: "ivedaai_camera",
        arguments: { operation: "GET /api/cameras", query: { size: 1 } },
      });
      expect(res.error).toBeUndefined();
      expect(res.result.structuredContent).toBeDefined();
      // The two halves are serialised from one object, so a client reading
      // either cannot be told something the other does not say.
      expect(res.result.structuredContent).toEqual(JSON.parse(res.result.content[0].text));
      expect(res.result.structuredContent.status).toBe(200);
    });
  }, 60_000);

  it("keeps the image out of the structured half, as it does out of the text", async () => {
    await withClient({}, async (c) => {
      await c.start();
      const res = await c.call("tools/call", { name: jpegCall.name, arguments: jpegCall.arguments });
      expect(res.error).toBeUndefined();
      // Base64 belongs in the image content block only. Putting it here would
      // send the same picture twice and blow the declared shape's budget for
      // no gain — the same reason it is stripped from the text.
      expect(res.result.structuredContent).not.toHaveProperty("image");
      expect(res.result.structuredContent).toEqual(JSON.parse(res.result.content[0].text));
    });
  }, 60_000);

  /**
   * `ivedaai_get_schema` used to answer with a bare JSON array of names, and
   * with the definition itself for a lookup. Neither can be `structuredContent`,
   * which MCP requires to be an object, so both are wrapped now. Pinned because
   * the wrapping is a wire-format change: a caller written against the old bare
   * array would break on it.
   */
  it("wraps the definition listing under a key", async () => {
    await withClient({}, async (c) => {
      await c.start();
      const res = await c.call("tools/call", { name: "ivedaai_get_schema", arguments: {} });
      expect(res.error).toBeUndefined();
      expect(Array.isArray(res.result.structuredContent.names)).toBe(true);
      expect(res.result.structuredContent.names).toContain("CameraRequest");
      expect(res.result.structuredContent).toEqual(JSON.parse(res.result.content[0].text));
    });
  }, 60_000);

  it("wraps a definition lookup the same way", async () => {
    await withClient({}, async (c) => {
      await c.start();
      const res = await c.call("tools/call", {
        name: "ivedaai_get_schema",
        arguments: { name: "CameraRequest" },
      });
      expect(res.error).toBeUndefined();
      expect(res.result.structuredContent.name).toBe("CameraRequest");
      expect(res.result.structuredContent.schema).toBeTruthy();
      expect(res.result.structuredContent).toEqual(JSON.parse(res.result.content[0].text));
    });
  }, 60_000);

  it("answers list_types under a key, so one declared shape covers all three actions", async () => {
    await withClient({}, async (c) => {
      await c.start();
      const res = await c.call("tools/call", {
        name: "ivedaai_alert_integration",
        arguments: { action: "list_types" },
      });
      expect(res.error).toBeUndefined();
      expect(res.result.structuredContent.types.request.category).toBe("webhook");
      expect(res.result.structuredContent).toEqual(JSON.parse(res.result.content[0].text));
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

  it("declares only the argument fields its operations can use", async () => {
    // All four of path/query/body/file used to be declared on all 63 generated
    // tools. A field no operation accepts is paid on connect by every client and
    // invites a call that can only fail. Worst under read-only, where body and
    // file were on all 54 tools and usable by none.
    //
    // Derived from the spec here, not listed: a hardcoded expectation would
    // have to be edited whenever the spec changes, and would then be asserting
    // the edit rather than the behaviour.
    await withClient({}, async (c) => {
      await c.start();
      const tools = (await c.call("tools/list")).result.tools as Array<{
        name: string;
        inputSchema?: { properties?: Record<string, unknown> };
      }>;
      const byName = new Map(tools.map((t) => [t.name, t]));

      const ctx = loadSwagger();
      const policy = policyFromEnv();
      let checked = 0;
      let droppedSomething = 0;

      for (const group of ctx.tags) {
        const ops = allowedOperations(group.operations, policy);
        if (ops.length === 0) continue;
        const tool = byName.get(tagToToolName(group.tag));
        if (!tool) continue;
        const declared = tool.inputSchema?.properties ?? {};
        const expected = {
          path: ops.some((o) => o.parameters.some((p) => p.in === "path")),
          query: ops.some((o) => o.parameters.some((p) => p.in === "query")),
          body: ops.some((o) => o.parameters.some((p) => p.in === "body" || (p.in === "formData" && p.type !== "file")) || MULTIPART_BODY_FIELD[o.id]),
          file: ops.some((o) => o.parameters.some((p) => p.in === "formData" && p.type === "file") || MULTIPART_FILE_FIELD[o.id]),
        };
        for (const [field, reachable] of Object.entries(expected)) {
          expect(field in declared, `${tool.name}.${field} declared`).toBe(reachable);
          if (!reachable) droppedSomething++;
        }
        // The operation enum is never conditional.
        expect("operation" in declared, `${tool.name}.operation`).toBe(true);
        checked++;
      }

      // Both halves must actually be exercised, or this passes by asserting
      // nothing: some tools keep every field, and some drop at least one.
      expect(checked).toBeGreaterThan(50);
      expect(droppedSomething).toBeGreaterThan(0);
    });
  }, 60_000);

  it("offers no body or file at all in read-only mode", async () => {
    // The sharpest case: with every write withheld, nothing behind any tool can
    // accept a body or an upload, so declaring either is pure cost.
    await withClient({ IVEDAAI_READ_ONLY: "true" }, async (c) => {
      await c.start();
      const tools = (await c.call("tools/list")).result.tools as Array<{
        name: string;
        inputSchema?: { properties?: Record<string, unknown> };
      }>;
      // `file` still cannot be reached by anything read-only offers. `body`
      // now can: the read-safe POSTs carry their query in one, so a tool
      // exposing them declares it — and only those tools may.
      const withFile = tools.filter((t) => "file" in (t.inputSchema?.properties ?? {})).map((t) => t.name);
      expect(withFile).toEqual([]);
      const withBody = tools.filter((t) => "body" in (t.inputSchema?.properties ?? {})).map((t) => t.name);
      expect(withBody).toEqual(["ivedaai_alert"]);
      // Still a usable tool list, not an empty one.
      expect(tools.length).toBeGreaterThan(50);
    });
  }, 60_000);
  it("names the hand-written tools it actually registered", async () => {
    // These two lines used to contradict each other two lines apart: read-only
    // announced it was not registering the write tools, then the banner listed
    // them as registered. The behaviour was right and only the message was
    // wrong, which is the harder kind of wrong — an operator reading it has no
    // reason to doubt it.
    await withClient({ IVEDAAI_READ_ONLY: "true" }, async (c) => {
      await c.start();
      const tools = (await c.call("tools/list")).result.tools as Array<{ name: string }>;
      const served = new Set(tools.map((t) => t.name));
      const banner = c.stderr.join("").split("\n").find((l) => l.includes("running")) ?? "";

      expect(banner).toContain("ivedaai_get_schema");
      // Asserted against what tools/list actually offers, not against the
      // policy — restating the policy is what let these drift apart.
      for (const name of ["ivedaai_alert_integration", "ivedaai_add_camera"]) {
        expect(served.has(name), `${name} served`).toBe(false);
        expect(banner.includes(name), `${name} in banner`).toBe(false);
      }
    });
  }, 60_000);

  it("names all three when writes are allowed", async () => {
    await withClient({}, async (c) => {
      await c.start();
      const tools = (await c.call("tools/list")).result.tools as Array<{ name: string }>;
      const served = new Set(tools.map((t) => t.name));
      const banner = c.stderr.join("").split("\n").find((l) => l.includes("running")) ?? "";
      for (const name of ["ivedaai_get_schema", "ivedaai_alert_integration", "ivedaai_add_camera"]) {
        expect(served.has(name), `${name} served`).toBe(true);
        expect(banner.includes(name), `${name} in banner`).toBe(true);
      }
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
