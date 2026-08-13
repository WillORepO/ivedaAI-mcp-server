import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { loadSwagger, type Operation } from "../src/swagger.js";
import { TokenManager, type IvedaAIConfig } from "../src/auth.js";
import { executeOperation } from "../src/request.js";

const ctx = loadSwagger();

function findOp(id: string): Operation {
  for (const group of ctx.tags) {
    const op = group.operations.find((o) => o.id === id);
    if (op) return op;
  }
  throw new Error(`operation ${id} not found in spec`);
}

interface Seen {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
}

let server: Server;
let port: number;
const seen: Seen[] = [];
let tokenRequests = 0;
let apiCallCount = 0;
let rejectNextApiCallWith401 = false;

function makeConfig(overrides: Partial<IvedaAIConfig> = {}): IvedaAIConfig {
  return {
    origin: `http://127.0.0.1:${port}`,
    basePath: "/ainvr",
    tokenUrl: "/ainvr/api/oauth2/token",
    username: "testuser",
    password: "testpass",
    timeoutMs: 700,
    maxResponseBytes: 64 * 1024,
    // Off by default in fixtures: these exercise JSON paths, and an
    // attached image would change what the assertions are reading.
    inlineImages: false,
    maxImageBytes: 4 * 1024 * 1024,
    redactSecrets: true,
    ...overrides,
  };
}

beforeAll(async () => {
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    seen.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers });

    if (url.pathname === "/ainvr/api/oauth2/token") {
      // Mirrors the real deployment's behavior found during live testing: it
      // rejects the vendor spec's documented query-string style with 415 and
      // requires a standard application/x-www-form-urlencoded body instead.
      // This guards against ever regressing back to query params.
      const contentType = req.headers["content-type"] ?? "";
      if (!contentType.includes("application/x-www-form-urlencoded")) {
        res.writeHead(415);
        res.end();
        return;
      }
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const form = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
        if (url.searchParams.has("grant_type") || url.searchParams.has("username")) {
          res.writeHead(400);
          res.end("credentials must not be sent as query parameters");
          return;
        }
        if (!form.get("grant_type") || (form.get("grant_type") === "password" && !form.get("username"))) {
          res.writeHead(400);
          res.end("missing required form field(s)");
          return;
        }
        tokenRequests += 1;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            access_token: `token-${tokenRequests}`,
            token_type: "Bearer",
            expires_in: 600,
          })
        );
      });
      return;
    }

    if (url.pathname === "/ainvr/api/cameras" && req.method === "GET") {
      apiCallCount += 1;
      if (rejectNextApiCallWith401) {
        rejectNextApiCallWith401 = false;
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: "token revoked" }));
        return;
      }
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Set-Cookie": "SESSION=secret-session-value; HttpOnly",
        "X-Total-Count": "1",
      });
      res.end(
        JSON.stringify({
          receivedAuth: req.headers.authorization,
          content: [{ id: 1, name: "Front Door" }],
        })
      );
      return;
    }

    if (url.pathname === "/ainvr/api/detection/colors" && req.method === "POST") {
      // Echoes back what actually arrived so the test can assert the multipart
      // payload carries BOTH the file part and the `body`-declared JSON param.
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            contentType: req.headers["content-type"] ?? null,
            hasFilePart: /name="file"/.test(raw),
            hasRequestPart: /name="request"/.test(raw),
            requestPartValue: /name="request"[\s\S]*?\r\n\r\n([\s\S]*?)\r\n--/.exec(raw)?.[1] ?? null,
          })
        );
      });
      return;
    }

    if (url.pathname === "/ainvr/api/face/search" && req.method === "POST") {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            contentType: req.headers["content-type"] ?? null,
            rawBody: Buffer.concat(chunks).toString("utf8"),
            queryString: url.search,
          })
        );
      });
      return;
    }

    if (url.pathname === "/ainvr/api/jobs" && req.method === "POST") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          jobId: 42,
          receivedContentType: req.headers["content-type"] ?? null,
        })
      );
      return;
    }

    if (url.pathname === "/ainvr/api/alertRules/mock-id" && req.method === "GET") {
      // Mimics a live finding: AlertRule.trigger is a JSON-encoded string field,
      // not a nested object, and can carry real downstream credentials.
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          alertRuleId: "mock-id",
          trigger: JSON.stringify({
            request: { authorization: { auth: "BASIC", account: "admin", password: "super-secret-value" } },
          }),
        })
      );
      return;
    }

    if (url.pathname === "/ainvr/api/slow") {
      // Never responds within the test timeout window.
      setTimeout(() => {
        res.writeHead(200);
        res.end("late");
      }, 10_000);
      return;
    }

    if (url.pathname === "/ainvr/api/system/events" && req.method === "GET") {
      // Simulates a server-sent-event stream that never ends.
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write("data: event-1\n\n");
      const interval = setInterval(() => res.write("data: tick\n\n"), 100);
      res.on("close", () => clearInterval(interval));
      return;
    }

    if (url.pathname === "/ainvr/api/big" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("x".repeat(500 * 1024));
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "not found" }));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  port = address.port;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
});

// Synthetic operations for routes that exist on the mock but not in the spec.
const slowOp: Operation = {
  id: "GET /api/slow",
  method: "GET",
  path: "/api/slow",
  tag: "Test",
  parameters: [],
};
const mockAlertRuleOp: Operation = {
  id: "GET /api/alertRules/mock-id",
  method: "GET",
  path: "/api/alertRules/mock-id",
  tag: "Test",
  parameters: [],
};
const bigOp: Operation = {
  id: "GET /api/big",
  method: "GET",
  path: "/api/big",
  tag: "Test",
  parameters: [],
};

describe("executeOperation against a mock server", () => {
  it("fetches a token once and attaches it as a Bearer header", async () => {
    const tm = new TokenManager(makeConfig());
    const result = await executeOperation(tm, findOp("GET /api/cameras"), {
      query: { nameContains: "front", size: 5 },
    });
    expect(result.status).toBe(200);
    const body = result.body as { receivedAuth: string };
    expect(body.receivedAuth).toMatch(/^Bearer token-\d+$/);
    expect(result.url).toContain("nameContains=front");
    expect(result.url).toContain("size=5");
  });

  it("sends token-request credentials as a form-urlencoded body, not query params", async () => {
    // Regression test for a live-deployment finding: the vendor spec documents
    // the token endpoint's parameters as query-string ("in": "query"), but the
    // real server returns 415 for that and requires a standard OAuth2
    // application/x-www-form-urlencoded body. If this ever silently reverts to
    // query params, this test (and the mock's strict 415 check above) will fail.
    const tm = new TokenManager(makeConfig());
    const result = await executeOperation(tm, findOp("GET /api/cameras"), {});
    expect(result.status).toBe(200);
  });

  it("filters response headers to the allowlist (no Set-Cookie)", async () => {
    const tm = new TokenManager(makeConfig());
    const result = await executeOperation(tm, findOp("GET /api/cameras"), {});
    expect(result.headers["x-total-count"]).toBe("1");
    expect(result.headers["set-cookie"]).toBeUndefined();
    expect(Object.keys(result.headers)).not.toContain("connection");
  });

  it("re-authenticates and retries once on a 401", async () => {
    const tm = new TokenManager(makeConfig());
    await executeOperation(tm, findOp("GET /api/cameras"), {});
    const tokensBefore = tokenRequests;

    rejectNextApiCallWith401 = true;
    const result = await executeOperation(tm, findOp("GET /api/cameras"), {});
    expect(result.status).toBe(200);
    expect(tokenRequests).toBe(tokensBefore + 1);
  });

  it("creates a StreamJob (optional-file multipart op) without a file", async () => {
    const tm = new TokenManager(makeConfig());
    const result = await executeOperation(tm, findOp("POST /api/jobs"), {
      query: { type: "StreamJob", cameraId: 1 },
    });
    expect(result.status).toBe(200);
    const body = result.body as { jobId: number; receivedContentType: string | null };
    expect(body.jobId).toBe(42);
    expect(body.receivedContentType ?? "").not.toContain("multipart");
  });

  it("times out cleanly when the server never responds", async () => {
    const tm = new TokenManager(makeConfig({ timeoutMs: 400 }));
    await expect(executeOperation(tm, slowOp, {})).rejects.toThrow(/timed out after 400ms/);
  });

  it("returns partial data with timedOut for a never-ending SSE stream", async () => {
    const tm = new TokenManager(makeConfig({ timeoutMs: 500 }));
    const result = await executeOperation(tm, findOp("GET /api/system/events"), {
      query: { filter: "alert" },
    });
    expect(result.status).toBe(200);
    expect(result.timedOut).toBe(true);
    expect(String(result.body)).toContain("data: event-1");
  });

  it("truncates oversized bodies at the byte cap", async () => {
    const tm = new TokenManager(makeConfig({ maxResponseBytes: 1024 }));
    const result = await executeOperation(tm, bigOp, {});
    expect(result.status).toBe(200);
    expect(result.truncated).toBe(true);
    expect((result.body as string).length).toBeLessThanOrEqual(1024);
    // Truncated JSON is unparseable, so the flag alone leaves a caller stuck.
    // The note is what makes a smaller cap an improvement rather than a
    // different failure.
    expect(result.note).toContain("Narrow the request");
    expect(result.note).toContain("reduce \"size\"");
  });

  it("rejects unknown query parameters before sending anything", async () => {
    const tm = new TokenManager(makeConfig());
    const callsBefore = apiCallCount;
    await expect(
      executeOperation(tm, findOp("GET /api/cameras"), { query: { nameContians: "typo" } })
    ).rejects.toThrow(/Unknown query parameter "nameContians"/);
    expect(apiCallCount).toBe(callsBefore);
  });

  it("redacts a credential embedded in a JSON-string trigger field by default", async () => {
    // End-to-end regression test for the live finding: a real deployment
    // returned a plaintext webhook password inside AlertRule.trigger, which
    // is itself a JSON-encoded string, not a nested object.
    const tm = new TokenManager(makeConfig());
    const result = await executeOperation(tm, mockAlertRuleOp, {});
    expect(result.status).toBe(200);
    const body = result.body as { trigger: string };
    expect(body.trigger).not.toContain("super-secret-value");
    const trigger = JSON.parse(body.trigger);
    expect(trigger.request.authorization.password).toBe("***REDACTED***");
    expect(trigger.request.authorization.account).toBe("admin");
  });

  it("leaves credentials intact when redaction is explicitly disabled", async () => {
    const tm = new TokenManager(makeConfig({ redactSecrets: false }));
    const result = await executeOperation(tm, mockAlertRuleOp, {});
    const body = result.body as { trigger: string };
    expect(body.trigger).toContain("super-secret-value");
  });

  it("sends both the file part and the body-declared JSON param for multipart+body ops", async () => {
    // Regression test for a live finding: POST /api/detection/colors takes a
    // file AND a `body`-located "request" param. Sending only the file returned
    // "Required request parameter 'request' ... is not present" (400), and
    // sending it as an application/json part returned 500 — it has to be a
    // plain multipart text field holding the JSON.
    const tmpFile = join(tmpdir(), `ivedaai-multipart-test-${process.pid}.jpg`);
    writeFileSync(tmpFile, Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x01]));
    try {
      const tm = new TokenManager(makeConfig());
      const roi = [{ type: "object", roi: { x: 0, y: 0, w: 640, h: 480 } }];
      const result = await executeOperation(tm, findOp("POST /api/detection/colors"), {
        file: { path: tmpFile, contentType: "image/jpeg" },
        body: roi,
      });
      expect(result.status).toBe(200);
      const body = result.body as {
        contentType: string;
        hasFilePart: boolean;
        hasRequestPart: boolean;
        requestPartValue: string | null;
      };
      expect(body.contentType).toContain("multipart/form-data");
      expect(body.hasFilePart).toBe(true);
      expect(body.hasRequestPart).toBe(true);
      expect(JSON.parse(body.requestPartValue!)).toEqual(roi);
    } finally {
      rmSync(tmpFile, { force: true });
    }
  });

  it("sends urlencoded-body ops as a form body with an empty query string", async () => {
    const tm = new TokenManager(makeConfig());
    const result = await executeOperation(tm, findOp("POST /api/face/search"), {
      query: { start: "2026-07-01 00:00:00", end: "2026-07-02 00:00:00", descriptor: "abc123" },
    });
    expect(result.status).toBe(200);
    const body = result.body as { contentType: string; rawBody: string; queryString: string };
    expect(body.contentType).toContain("application/x-www-form-urlencoded");
    expect(body.queryString).toBe("");
    expect(body.rawBody).toContain("descriptor=abc123");
  });
});
