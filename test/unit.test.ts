import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { loadSwagger, tagToToolName, schemaDefinitions, type Operation } from "../src/swagger.js";
import {
  buildUrl,
  validateArgs,
  acceptHeaderFor,
  usesUrlencodedBody,
  buildUrlencodedBody,
  isBinaryResponse,
  MULTIPART_BODY_FIELD,
  MULTIPART_FILE_FIELD,
  PLAIN_TEXT_BODY_OPS,
} from "../src/request.js";
import { buildTriggerBody, interpretTestResult, TRIGGER_TYPES, mergeTriggerIntoRule } from "../src/alertTrigger.js";
import {
  computeRoundTripGaps,
  fieldsAtRisk,
  hasRisk,
  roundTripNote,
  roundTripWarning,
  classifySubresource,
} from "../src/roundTrip.js";
import { redactSecrets } from "../src/redact.js";
import { buildCameraBody, defaultRoiContour } from "../src/cameraOnboarding.js";
import {
  findLossyOmissions,
  lossyUpdateError,
  lossyUpdateWarning,
  LOSSY_UPDATE_OPS,
  updateSemantics,
  CONFIRMED_UPDATE_SEMANTICS,
} from "../src/partialUpdate.js";
import { describeTag, describeBodySchema, SERVER_INSTRUCTIONS } from "../src/toolDocs.js";
import { policyFromEnv, refusalReason, allowedOperations, isCollectionDelete } from "../src/accessPolicy.js";
import { insecureTransportWarning, loadConfig } from "../src/auth.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const ctx = loadSwagger();

function findOp(id: string): Operation {
  for (const group of ctx.tags) {
    const op = group.operations.find((o) => o.id === id);
    if (op) return op;
  }
  throw new Error(`operation ${id} not found in spec`);
}

/** The `body:` line for an operation, as it appears in the generated tool description. */
function bodyLine(opId: string): string {
  const group = ctx.tags.find((g) => g.operations.some((o) => o.id === opId));
  if (!group) throw new Error(`no tag exposes ${opId}`);
  const text = describeTag(ctx.spec, group);
  const start = text.indexOf(`${opId} —`) >= 0 ? text.indexOf(`${opId} —`) : text.indexOf(opId);
  const line = text
    .slice(start)
    .split("\n")
    .find((l) => l.startsWith("  body: "));
  if (!line) throw new Error(`${opId} has no body line`);
  return line.slice("  body: ".length);
}

describe("tool description headers", () => {
  // The header used to restate, on all 62 tools, both how to call the tool and
  // what it returns. The calling half duplicated the inputSchema in index.ts;
  // the returning half did not, and is the part that has to survive here
  // because `instructions` is something a client may legitimately ignore.
  it("keeps the two response facts a caller cannot infer, on every tool", () => {
    for (const group of ctx.tags) {
      const header = describeTag(ctx.spec, group).split("\n\n")[0];
      expect(header, group.tag).toContain("status");
      expect(header, group.tag).toContain("truncated");
      expect(header, group.tag).toContain("timedOut");
    }
  });

  it("no longer repeats what the input schema already declares", () => {
    // `operation`, `path`, `query`, `body` and `file` are declared as tool
    // parameters with their own descriptions, which a client cannot drop.
    const header = describeTag(ctx.spec, ctx.tags[0]).split("\n\n")[0];
    expect(header).not.toContain("Choose an");
    expect(header).not.toContain('"path"/"query"/"body"/"file"');
  });

  it("says the long version once, in the server instructions", () => {
    expect(SERVER_INSTRUCTIONS).toContain("operation");
    expect(SERVER_INSTRUCTIONS).toContain("ivedaai_get_schema");
    // The response contract belongs here in full, since the per-tool header
    // carries only the compressed form.
    expect(SERVER_INSTRUCTIONS).toContain("statusText");
  });
});

describe("what the spec declares vs what the server accepts", () => {
  /** The rendered `query:` line for an operation. */
  function queryLine(opId: string): string {
    const group = ctx.tags.find((g) => g.operations.some((o) => o.id === opId))!;
    const text = describeTag(ctx.spec, group);
    return text.slice(text.indexOf(opId)).split("\n").find((l) => l.startsWith("  query: ")) ?? "";
  }

  it("shows the date pattern the server actually enforces", () => {
    // format: date-time means RFC 3339, and this API accepts it on none of the
    // 32 parameters that declare it. Both of these were measured live: an ISO
    // 8601 value returns 400, the spaced form returns 200.
    expect(queryLine("GET /api/face/matches")).toContain("start*:string(yyyy-MM-dd HH:mm:ss)");
    expect(queryLine("GET /api/identity-recognition")).toContain("start*:string(yyyy-MM-dd HH:mm:ss)");
    // Not all of them are the same pattern, so the rendering has to carry the
    // parameter's own rather than a single hardcoded one.
    expect(queryLine("GET /api/alerts")).toContain("start*:string(yyyy-MM-dd[ HH:mm:ss[Z]])");
  });

  it("derives the pattern for every date-time parameter the spec describes", () => {
    // The point of deriving rather than tabling: no parameter that declares a
    // pattern should be left rendering a bare `string`.
    let checked = 0;
    for (const group of ctx.tags) {
      for (const op of group.operations) {
        for (const p of op.parameters) {
          if (p.format !== "date-time") continue;
          const pattern = /yyyy[-/][^,;.]*/i.exec(p.description ?? "")?.[0]?.trim();
          if (!pattern) continue;
          checked++;
          const line = op.parameters.some((x) => x.in === "query") ? queryLine(op.id) : "";
          if (line) expect(line, `${op.id} ${p.name}`).toContain(`${p.name}${p.required ? "*" : "?"}:string(${pattern})`);
        }
      }
    }
    expect(checked, "no date-time parameters found — the spec shape changed").toBeGreaterThan(20);
  });

  it("renders the unresolvable LocalDate refs as a usable type", () => {
    // 10.0 ships two $refs that resolve to nothing — springdoc placeholders for
    // java.time.LocalDate. Published raw they offered the caller 56 characters
    // of `Error-ModelName{...}` as if it were a type.
    for (const [def, field] of [
      ["AccountRequest", "expirationDate"],
      ["FaceTargetRequest", "expiredDate"],
    ] as const) {
      const rendered = describeBodySchema(ctx.spec, { $ref: `#/components/schemas/${def}` });
      expect(rendered, def).toContain(`${field}?:string(yyyy-MM-dd)`);
      expect(rendered, def).not.toContain("Error-ModelName");
    }
  });

  it("leaves no Error-ModelName placeholder anywhere in the generated descriptions", () => {
    for (const group of ctx.tags) {
      expect(describeTag(ctx.spec, group), group.tag).not.toContain("Error-ModelName");
    }
  });
});

describe("body schemas in tool descriptions", () => {
  // These descriptions are loaded by every client on connect, so the body
  // schemas were the largest thing being paid for up front. What a caller
  // cannot look up later is which fields are mandatory; everything else is a
  // `ivedaai_get_schema` call away.
  it("trades a large schema for its name plus the required fields", () => {
    const line = bodyLine("POST /api/accounts");
    expect(line).toContain("AccountRequest");
    expect(line).toContain("required:");
    expect(line).toContain("password");
    expect(line).toContain("ivedaai_get_schema");
    // The optional fields are the part that moved out.
    expect(line).not.toContain("note?");
  });

  it("keeps a small schema whole rather than pointing at it", () => {
    // ApiKeyRequest is 35 characters in full — shorter than a pointer to
    // itself. Substituting here would have cost context, not saved it.
    const line = bodyLine("POST /api/accounts/api-keys");
    expect(line).toContain("isActive");
    expect(line).not.toContain("ivedaai_get_schema");
  });

  it("never renders a body longer than the full schema summary would be", () => {
    // The rule is "whichever is shorter", and it should hold for every body in
    // the spec, not just the two sampled above.
    for (const group of ctx.tags) {
      for (const op of group.operations) {
        const bodyParam = op.parameters.find((p) => p.in === "body");
        if (!bodyParam) continue;
        const full = describeBodySchema(ctx.spec, bodyParam.schema);
        expect(bodyLine(op.id).length, op.id).toBeLessThanOrEqual(full.length);
      }
    }
  });
});

describe("tagToToolName", () => {
  it("slugifies tags into prefixed snake_case", () => {
    expect(tagToToolName("Camera")).toBe("ivedaai_camera");
    expect(tagToToolName("AlertRule")).toBe("ivedaai_alert_rule");
    expect(tagToToolName("Camera State")).toBe("ivedaai_camera_state");
    expect(tagToToolName("False-report")).toBe("ivedaai_false_report");
  });

  it("produces unique names across every tag in the spec", () => {
    const names = ctx.tags.map((g) => tagToToolName(g.tag));
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("buildUrl", () => {
  it("encodes multi collectionFormat arrays as repeated params", () => {
    const op = findOp("GET /api/cameras");
    const url = buildUrl("http://x", "/ainvr", op, { query: { cameraIds: [1, 2, 3] } });
    expect(url.toString()).toBe("http://x/ainvr/api/cameras?cameraIds=1&cameraIds=2&cameraIds=3");
  });

  it("substitutes and URI-encodes path parameters", () => {
    const op = findOp("GET /api/cameras/{cameraId}");
    const url = buildUrl("http://x", "/ainvr", op, { path: { cameraId: 12 } });
    expect(url.pathname).toBe("/ainvr/api/cameras/12");
  });

  it("drops null/undefined query values", () => {
    const op = findOp("GET /api/cameras");
    const url = buildUrl("http://x", "/ainvr", op, { query: { name: undefined } });
    expect(url.search).toBe("");
  });
});

describe("acceptHeaderFor", () => {
  it("uses the operation's declared produces for image endpoints", () => {
    // Regression test for a live-confirmed bug: a blanket
    // "Accept: application/json" made the server reject every non-JSON
    // endpoint with 406 Not Acceptable and a zero-byte body. The same
    // request returns a real 181KB JPEG once Accept matches produces.
    const op = findOp("GET /api/streaming/{cameraId}/{type}.jpg");
    expect(op.produces).toContain("image/jpeg");
    expect(acceptHeaderFor(op).startsWith("image/jpeg")).toBe(true);
  });

  it("still accepts JSON on image endpoints so error bodies survive", () => {
    // Accepting only the declared type made the server collapse to an opaque
    // 500 with an empty body instead of its real JSON error. Confirmed live on
    // GET /api/scenes/{sceneId}/{type}.
    const accept = acceptHeaderFor(findOp("GET /api/scenes/{sceneId}/{type}"));
    expect(accept).toContain("image/jpeg");
    expect(accept).toContain("application/json");
  });

  it("falls back to JSON-preferred wildcard when produces is undeclared", () => {
    const op = findOp("GET /api/cameras");
    expect(op.produces).toBeUndefined();
    expect(acceptHeaderFor(op)).toBe("application/json, */*");
  });

  it("keeps JSON available for operations that declare it", () => {
    const op = findOp("POST /api/oauth2/token");
    expect(acceptHeaderFor(op)).toContain("application/json");
  });
});

describe("isBinaryResponse", () => {
  it("keeps JSON and text decodable", () => {
    for (const ct of [
      "application/json",
      "application/json;charset=UTF-8",
      "application/hal+json",
      "application/xml",
      "text/plain",
      "text/html; charset=utf-8",
      "text/event-stream",
      "text/csv",
    ]) {
      expect(isBinaryResponse(ct, ""), ct).toBe(false);
    }
  });

  it("treats an absent content-type as text, as this API's JSON endpoints rely on", () => {
    expect(isBinaryResponse("", "")).toBe(false);
  });

  it("still catches the media types the old blocklist covered", () => {
    for (const ct of ["image/jpeg", "image/png", "video/mp4", "audio/mpeg", "application/octet-stream"]) {
      expect(isBinaryResponse(ct, ""), ct).toBe(true);
    }
  });

  it("catches application/zip, which the old blocklist decoded as text", () => {
    // Regression test for a live-confirmed bug: GET /api/face/targets/export
    // answers `application/zip` with a content-disposition, and the previous
    // blocklist (image|video|audio + octet-stream) let it through as UTF-8 —
    // 17KB of mojibake into the model's context and the archive corrupted by the
    // lossy decode. The spec declares no application/zip anywhere.
    expect(isBinaryResponse("application/zip", 'attachment; filename="fr_list.zip"')).toBe(true);
    expect(isBinaryResponse("application/zip", "")).toBe(true);
  });

  it("does not let an attachment disposition hide readable text", () => {
    // Binary responses have their bytes dropped and no escape hatch, so calling
    // something binary makes its content unreachable. An earlier version let
    // `attachment` override everything; that earned nothing — the zip that
    // motivated the rewrite is caught by the allowlist anyway — and would have
    // made a CSV export impossible to read through the tool.
    expect(isBinaryResponse("text/csv", 'attachment; filename="export.csv"')).toBe(false);
    expect(isBinaryResponse("application/json", "attachment")).toBe(false);
    expect(isBinaryResponse("application/zip", 'attachment; filename="x.zip"')).toBe(true);
  });

  it("lets an attachment disposition decide when the type is absent", () => {
    // The one case where the header is the only signal available.
    expect(isBinaryResponse("", 'attachment; filename="x.bin"')).toBe(true);
    expect(isBinaryResponse("", "")).toBe(false);
    expect(isBinaryResponse("", "inline")).toBe(false);
  });

  it("defaults an unknown type to binary rather than decoding it", () => {
    // Erring toward binary costs metadata; erring the other way destroys payload.
    for (const ct of ["application/pdf", "application/gzip", "application/x-tar", "font/woff2"]) {
      expect(isBinaryResponse(ct, ""), ct).toBe(true);
    }
  });
});

describe("bodies the spec describes wrongly", () => {
  it("keys every plain-text override to an operation in the spec", () => {
    for (const opId of PLAIN_TEXT_BODY_OPS) expect(() => findOp(opId), opId).not.toThrow();
  });

  it("only overrides operations the spec claims take JSON", () => {
    // The override exists because the declared content type is wrong. If a spec
    // ever declares text/plain properly, the entry should go rather than sit
    // there shadowing it.
    for (const opId of PLAIN_TEXT_BODY_OPS) {
      const op = findOp(opId);
      expect(op.consumes?.some((c) => c.includes("json")), `${opId} no longer declares JSON`).toBe(true);
    }
  });
});

describe("multipart parts the 10.0 spec omits", () => {
  // Both tables recover something the server requires and the document does not
  // declare. An entry keyed to an operation that does not exist would be dead
  // weight that never fires and never fails.
  it("keys every entry to an operation in the spec", () => {
    for (const table of [MULTIPART_BODY_FIELD, MULTIPART_FILE_FIELD]) {
      for (const opId of Object.keys(table)) {
        expect(() => findOp(opId), opId).not.toThrow();
      }
    }
  });

  it("only recovers a file part where the spec declares none", () => {
    // If a future spec declares the file properly, the entry should be removed
    // rather than left to shadow it.
    for (const opId of Object.keys(MULTIPART_FILE_FIELD)) {
      const declared = findOp(opId).parameters.filter((p) => p.in === "formData" && p.type === "file");
      expect(declared, `${opId} now declares its file part — drop the override`).toHaveLength(0);
    }
  });

  it("recovers the file part measurement established for image/rotate", () => {
    // Measured: of file, image, img, multipartFile and uploadFile, only "file"
    // is accepted — the rest answer 400 with an empty body.
    expect(MULTIPART_FILE_FIELD["POST /api/image/rotate"]).toBe("file");
  });

  it("recovers the file part face-target enrolment needs", () => {
    // Without this the documented face-watchlist workflow is unreachable through
    // this server: the 10.0 spec declares the operation multipart with
    // descriptor/faceKeyId/url and no file, so nothing appends the image and the
    // server answers 415. Measured both ways against a live 10.0 deployment — a
    // raw multipart POST carrying a "file" part returns 201; the same call
    // through the generated tool returned 415 until this entry existed.
    expect(MULTIPART_FILE_FIELD["POST /api/face/targets/{targetId}/keys"]).toBe("file");

    // The sibling update *does* declare its file part, which is what makes the
    // omission above a spec bug rather than a convention of the API: the two
    // halves of one feature disagree. If that ever changes, the assertion above
    // is caught by "only recovers a file part where the spec declares none".
    const sibling = findOp("POST /api/face/keys/{targetKeyId}").parameters.filter(
      (p) => p.in === "formData" && p.type === "file"
    );
    expect(sibling).toHaveLength(1);
  });
});

describe("usesUrlencodedBody", () => {
  it("detects operations whose query params must be sent as a urlencoded body", () => {
    // Regression test for a live-confirmed bug: these declare params as
    // `in: query` but `consumes: x-www-form-urlencoded`. Sending them in the
    // URL returns 415 with an empty body; sending them as a form body reaches
    // the real handler.
    expect(usesUrlencodedBody(findOp("POST /api/face/search"))).toBe(true);
    expect(usesUrlencodedBody(findOp("POST /api/scene-objects/search"))).toBe(true);
    expect(usesUrlencodedBody(findOp("POST /api/jobs/stream"))).toBe(true);
  });

  it("excludes ordinary JSON and multipart operations", () => {
    expect(usesUrlencodedBody(findOp("GET /api/cameras"))).toBe(false);
    expect(usesUrlencodedBody(findOp("POST /api/cameras"))).toBe(false);
    // Multipart only — handled by the file-upload path instead. This assertion
    // named POST /api/face/keys until 10.0, which stopped declaring that
    // operation as multipart at all; it is now urlencoded-only, so it belongs
    // with the cases above rather than the exclusions.
    expect(usesUrlencodedBody(findOp("POST /api/face/targets/{targetId}/keys"))).toBe(false);
  });

  it("keeps urlencoded params out of the URL and puts them in the body", () => {
    const op = findOp("POST /api/face/search");
    const args = { query: { start: "2026-07-01 00:00:00", end: "2026-07-02 00:00:00", descriptor: "abc" } };
    expect(buildUrl("http://x", "/ainvr", op, args).search).toBe("");
    const body = buildUrlencodedBody(op, args);
    expect(body).toContain("descriptor=abc");
    expect(body).toContain("start=2026-07-01");
  });
});

describe("validateArgs", () => {
  it("flags missing required path params", () => {
    const op = findOp("GET /api/cameras/{cameraId}");
    const problems = validateArgs(op, {});
    expect(problems.some((p) => p.includes('path parameter "cameraId"'))).toBe(true);
  });

  it("flags missing required query params", () => {
    const op = findOp("POST /api/jobs");
    const problems = validateArgs(op, { query: {} });
    expect(problems.some((p) => p.includes('query parameter "type"'))).toBe(true);
  });

  it("rejects unknown query keys and lists valid names", () => {
    const op = findOp("GET /api/cameras");
    const problems = validateArgs(op, { query: { nameContians: "typo" } });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('Unknown query parameter "nameContians"');
    expect(problems[0]).toContain("nameContains");
  });

  it("rejects object-valued query params", () => {
    const op = findOp("GET /api/cameras");
    const problems = validateArgs(op, { query: { name: { nested: true } } });
    expect(problems[0]).toContain("must be a string, number, boolean, or array");
  });

  it("does not require a file when the spec marks it optional", () => {
    const op = findOp("POST /api/jobs");
    const problems = validateArgs(op, { query: { type: "StreamJob", cameraId: 1 } });
    expect(problems).toEqual([]);
  });

  it("requires a file when the spec marks it required", () => {
    const op = findOp("POST /api/scenes");
    const problems = validateArgs(op, {});
    expect(problems.some((p) => p.includes("required file upload"))).toBe(true);
  });
});

describe("buildTriggerBody", () => {
  it("fills in authorization/httpBody defaults for the webhook type", () => {
    // Regression test for a live-deployment finding: the server rejects a
    // 'request' trigger before attempting any connection if these fields are
    // absent, despite the spec marking them optional.
    const body = buildTriggerBody("request", { method: "POST", url: "https://example.com/hook" });
    const req = (body.trigger.request as any).requests[0];
    expect(req.authorization).toEqual({ auth: "NONE" });
    expect(req.httpBody).toEqual({ type: "NONE" });
    expect(req.method).toBe("POST");
    expect(req.url).toBe("https://example.com/hook");
  });

  it("respects explicitly-provided authorization/httpBody instead of overwriting them", () => {
    const body = buildTriggerBody("request", {
      method: "GET",
      url: "https://example.com",
      authorization: { auth: "BASIC", account: "u", password: "p" },
    });
    const req = (body.trigger.request as any).requests[0];
    expect(req.authorization).toEqual({ auth: "BASIC", account: "u", password: "p" });
  });

  it("throws a clear error for an unknown trigger type", () => {
    expect(() => buildTriggerBody("not_a_real_type", {})).toThrow(/Unknown trigger type/);
  });

  it("requires method+url for the webhook type", () => {
    expect(() => buildTriggerBody("request", {})).toThrow(/requires "method" and "url"/);
  });

  it("requires ip+port for VMS types", () => {
    expect(() => buildTriggerBody("milestone", {})).toThrow(/requires "ip" and "port"/);
    const body = buildTriggerBody("milestone", { ip: "10.0.0.1", port: "80", protocol: "HTTP" });
    expect(body.trigger.milestone).toMatchObject({ enable: true, ip: "10.0.0.1", port: "80", protocol: "HTTP" });
  });

  it("builds a mobile trigger with defaults when config is omitted", () => {
    const body = buildTriggerBody("mobile", undefined);
    expect(body.trigger.mobile).toEqual({ enable: true, enableCriticalAlertNotice: false });
  });

  it("covers every trigger type without throwing on its minimal valid config", () => {
    for (const name of Object.keys(TRIGGER_TYPES)) {
      const info = TRIGGER_TYPES[name];
      const config =
        info.category === "webhook"
          ? { method: "GET", url: "https://example.com" }
          : info.category === "vms"
            ? { ip: "10.0.0.1", port: "80" }
            : info.category === "mail"
              ? { emails: [{ mailIds: ["a@b.com"] }], smtpServer: "smtp.example.com", port: "587" }
              : {};
      expect(() => buildTriggerBody(name, config)).not.toThrow();
    }
  });
});

describe("interpretTestResult", () => {
  it("recognizes success", () => {
    expect(interpretTestResult(200, true).outcome).toBe("success");
  });

  it("recognizes the unsupported-type response", () => {
    const outcome = interpretTestResult(400, {
      type: "InvalidParameterException",
      message: "Trigger 'Parameter Error : 'Unsupported check connection alert trigger type: X'.' connected fail.",
    });
    expect(outcome.outcome).toBe("unsupported");
  });

  it("recognizes an invalid-config response (400 but not the unsupported-type message)", () => {
    const outcome = interpretTestResult(400, { type: "InvalidParameterException", message: "Trigger 'null' connected fail." });
    expect(outcome.outcome).toBe("invalid_config");
  });

  it("recognizes a real connection failure", () => {
    const outcome = interpretTestResult(500, { type: "ConnectionException", message: "Could not connect to NVR." });
    expect(outcome.outcome).toBe("connection_failed");
  });

  it("falls back to unknown for an unrecognized shape", () => {
    expect(interpretTestResult(503, { weird: true }).outcome).toBe("unknown");
  });
});

describe("mergeTriggerIntoRule", () => {
  const trigger = { trigger: { request: { enable: true } } };
  // Everything the read could have supplied, matching what index.ts passes.
  const gap = computeRoundTripGaps(ctx.spec)["PATCH /api/alertRules/{alertRuleId}"];
  const alertGap = [...gap.unreadable, ...gap.renamed.map((r) => r.field)];

  // A rule shaped as GET /api/alertRules/{alertRuleId} really returns it, values
  // copied from a live deployment: the name under `alertName`, the schedule
  // holding weekdays and a renamed `forever`, and `condition` as a JSON *string*
  // carrying roiIds and cooldownInterval.
  const rule = {
    alertRuleId: "abc-123",
    // `condition` is verbatim wire data: the server emits its own Java class name
    // inside the JSON string, and any client sees it in every alert-rule response.
    // Kept as the server sends it rather than sanitised, because a fixture that
    // does not match the wire stops testing the parser that has to read it. The
    // shipped code elides it to "…AlertCondition" where it appears in a comment.
    alertName: "Loading dock after hours",
    alertType: "INTRUSION",
    description: "watch the dock",
    isEnabled: true,
    condition: '{"type":"com.ironyun.ainvr.engine.vo.AlertCondition","roiIds":[6,7,8],"cooldownInterval":1}',
    schedule: { weekdays: [], forever: true },
    createDate: "2026-01-01T00:00:00Z",
    trigger: '{"mobile":{"enable":true}}',
  };

  it("carries forward every field the read exposes, mapping alertName to name", () => {
    const merged = mergeTriggerIntoRule(rule, trigger, alertGap);
    expect(merged.body).toEqual({
      trigger: trigger.trigger,
      name: "Loading dock after hours",
      alertType: "INTRUSION",
      description: "watch the dock",
      isEnabled: true,
      weekdays: [],
      enableForever: true,
      roiIds: [6, 7, 8],
      cooldownInterval: 1,
    });
    expect(merged.missingRequired).toEqual([]);
  });

  it("replaces the stored trigger rather than merging into it", () => {
    const merged = mergeTriggerIntoRule(rule, trigger, alertGap);
    expect(merged.body.trigger).toEqual(trigger.trigger);
  });

  it("does not send response-only fields the request schema would reject", () => {
    const merged = mergeTriggerIntoRule(rule, trigger, alertGap);
    for (const field of ["alertRuleId", "condition", "createDate", "updateDate", "alertName"]) {
      expect(merged.body).not.toHaveProperty(field);
    }
  });

  it("carries an explicit null forward — an already-stored null is not a loss", () => {
    const merged = mergeTriggerIntoRule({ ...rule, description: null }, trigger, alertGap);
    expect(merged.body.description).toBeNull();
    expect(merged.carriedForward).toContain("description");
  });

  it("flags required fields a sparse read did not yield", () => {
    // This deployment has been seen to answer some GETs with an empty body.
    const merged = mergeTriggerIntoRule({}, trigger, alertGap);
    expect(merged.missingRequired).toEqual(["alertType", "name"]);
    expect(merged.carriedForward).toEqual([]);
  });

  it("treats a non-object read as yielding nothing rather than throwing", () => {
    for (const body of [null, undefined, "", [], 42]) {
      const merged = mergeTriggerIntoRule(body, trigger, alertGap);
      expect(merged.missingRequired).toEqual(["alertType", "name"]);
      expect(merged.body.trigger).toEqual(trigger.trigger);
    }
  });

  it("recovers the request fields hidden inside condition and schedule", () => {
    // These four are readable, but only by knowing that `condition` is a JSON
    // string and that `enableForever` is stored as `schedule.forever`. Without
    // this they would be dropped from the update and, on an endpoint that nulls
    // omissions, silently reset.
    const merged = mergeTriggerIntoRule(rule, trigger, alertGap);
    expect(merged.body.roiIds).toEqual([6, 7, 8]);
    expect(merged.body.cooldownInterval).toBe(1);
    expect(merged.body.enableForever).toBe(true);
    expect(merged.body.weekdays).toEqual([]);
    for (const f of ["roiIds", "cooldownInterval", "enableForever", "weekdays"]) {
      expect(merged.unrecoverable).not.toContain(f);
    }
  });

  it("survives a condition that is absent, empty, or not JSON", () => {
    for (const condition of [undefined, null, "", "not json", "[1,2]", 42]) {
      const merged = mergeTriggerIntoRule({ ...rule, condition }, trigger, alertGap);
      expect(merged.body).not.toHaveProperty("roiIds");
      expect(merged.unrecoverable).toContain("roiIds");
      // The rest of the merge is unaffected by an unusable condition.
      expect(merged.body.name).toBe("Loading dock after hours");
    }
  });

  it("accepts a condition already parsed into an object", () => {
    const merged = mergeTriggerIntoRule({ ...rule, condition: { roiIds: [9] } }, trigger, alertGap);
    expect(merged.body.roiIds).toEqual([9]);
  });

  it("reports what it could not recover, minus everything it did", () => {
    const merged = mergeTriggerIntoRule(rule, trigger, alertGap);
    // Absent from *this* rule's condition because it is INTRUSION-shaped, not
    // absent from live responses in general — a VIDEO_SEARCH rule carries them,
    // which the next test covers.
    expect(merged.unrecoverable).toContain("cameraIds");
    expect(merged.unrecoverable).toContain("hashtags");
    // The gap counts `name` because it compares keys and the response spells it
    // `alertName`, but the merge does recover it.
    expect(alertGap).toContain("name");
    expect(merged.unrecoverable).not.toContain("name");
    expect(merged.unrecoverable).toEqual(alertGap.filter((f) => !merged.carriedForward.includes(f)));
  });

  it("recovers the fields a VIDEO_SEARCH rule keeps in condition", () => {
    // `condition`'s contents vary by alertType: a VIDEO_SEARCH rule carries
    // cameras/hashtags/typeLogic where an INTRUSION rule carries roiIds. All five
    // are declared readable in READ_LOCATIONS, so all five must be carried — the
    // merge previously pulled only two, and then reported the other three to the
    // caller as unpreservable while holding them in the object it had just parsed.
    const videoSearchRule = {
      ...rule,
      alertType: "VIDEO_SEARCH",
      condition:
        '{"type":"com.ironyun.ainvr.engine.vo.AlertCondition","cameras":[37,39],' +
        '"hashtagIds":[15],"hashtags":["shoplifting3"],"typeLogic":"and","cooldownInterval":0}',
    };
    const merged = mergeTriggerIntoRule(videoSearchRule, trigger, alertGap);
    expect(merged.body.cameraIds).toEqual([37, 39]);
    expect(merged.body.hashtags).toEqual(["shoplifting3"]);
    expect(merged.body.typeLogic).toBe("and");
    expect(merged.body.cooldownInterval).toBe(0);
    for (const f of ["cameraIds", "hashtags", "typeLogic", "cooldownInterval"]) {
      expect(merged.unrecoverable).not.toContain(f);
    }
    // roiIds is genuinely absent from a VIDEO_SEARCH condition, so it stays listed.
    expect(merged.unrecoverable).toContain("roiIds");
  });

  it("reports everything as unrecoverable when it recovered nothing", () => {
    const merged = mergeTriggerIntoRule({}, trigger, alertGap);
    expect(merged.unrecoverable).toEqual(alertGap);
  });
});

describe("computeRoundTripGaps", () => {
  const gaps = computeRoundTripGaps(ctx.spec);
  const fieldsOf = (r: { field: string }[]) => r.map((x) => x.field).sort();

  // The first version of this check compared field names only and concluded 16
  // operations had unpreservable fields. Live verification showed most of those
  // values are readable under another key, so the interesting assertions are now
  // about which side of that line each field falls on.
  it("resolves the filter fields to the composite that actually holds them", () => {
    // The CRUD probe found PUT /api/filters/{filterId} 500s without `query` or
    // `cameraIds` and silently resets `type`. All three are readable — nested
    // inside `expression`, which is why the probe saw `expression.query` echoed
    // back rather than a top-level `query`.
    const gap = gaps["PUT /api/filters/{filterId}"];
    expect(gap.unreadable).toEqual([]);
    expect(fieldsOf(gap.renamed)).toEqual(["cameraIds", "query", "type"]);
    expect(gap.renamed.find((r) => r.field === "query")!.readAt).toBe("expression.query");
  });

  it("keeps the ROI geometry out of the unreadable set", () => {
    // Live reads confirmed every one of these is returned, renamed: roiContour
    // as region[].contour, name as eventName, isEnabled as enabled. The earlier
    // claim that an ROI update could not preserve its own contour was wrong, and
    // this is the regression test for that.
    const gap = gaps["PATCH /api/rois/{roiId}"];
    expect(gap.unreadable).toEqual([]);
    expect(gap.renamed.find((r) => r.field === "roiContour")!.readAt).toBe("region[].contour");
    expect(fieldsOf(gap.renamed)).toContain("excludeRoiContour");
  });

  it("routes accountIds to the sub-resource that actually returns it", () => {
    // externalId is readable via the collection GET, which is why the lossy-update
    // guard can tell callers to fetch and resend it. accountIds is on no record at
    // all — but GET /api/user-groups/{userGroupId}/accounts returns it, so calling
    // it unreadable was wrong, and wrong in the direction that leaves a caller with
    // a warning they cannot act on.
    const gap = gaps["PATCH /api/user-groups/{userGroupId}"];
    expect(gap.unreadable).toEqual([]);
    expect(fieldsOf(gap.renamed)).toEqual([]);
    expect(gap.viaSubresource.map((r) => r.field)).toEqual(["accountIds"]);
    expect(gap.viaSubresource[0].readOp).toBe("GET /api/user-groups/{userGroupId}/accounts");
  });

  it("never lists a field as both sub-resource-readable and unreadable", () => {
    for (const [opId, gap] of Object.entries(gaps)) {
      for (const { field } of gap.viaSubresource) {
        expect(gap.unreadable, `${opId} double-counts "${field}"`).not.toContain(field);
        expect(fieldsOf(gap.renamed), `${opId} double-counts "${field}"`).not.toContain(field);
      }
    }
  });

  it("falls back to the collection GET when a path has no item GET", () => {
    // /api/user-groups/{userGroupId} has no GET at all. Without the fallback
    // every field would be reported unreadable, including externalId.
    expect(ctx.spec.paths["/api/user-groups/{userGroupId}"].get).toBeUndefined();
    expect(gaps["PATCH /api/user-groups/{userGroupId}"].readOp).toBe("GET /api/user-groups");
  });

  it("splits the alert rule into what the read reaches and what it does not", () => {
    const gap = gaps["PATCH /api/alertRules/{alertRuleId}"];
    // Verified live: `condition` is a JSON string carrying far more than its name
    // suggests, and which keys depends on alertType — an INTRUSION rule's holds
    // roiIds, a VIDEO_SEARCH rule's holds cameras/hashtags/typeLogic. `schedule`
    // carries weekdays and, renamed, enableForever.
    expect(fieldsOf(gap.renamed)).toEqual([
      "cameraIds",
      "cooldownInterval",
      "enableForever",
      "hashtags",
      "name",
      "roiIds",
      "typeLogic",
      "weekdays",
    ]);
    expect(gap.renamed.find((r) => r.field === "roiIds")!.readAt).toContain("condition");
    // cameraIds reads back under a different key again: `cameras`, not `cameraIds`.
    expect(gap.renamed.find((r) => r.field === "cameraIds")!.readAt).toContain("cameras");
    // What is left is the type-specific binding lists, absent from a live response.
    expect(gap.unreadable).toContain("lprCategoryIds");
    expect(gap.unreadable).toContain("countingRule");
    expect(gap.unreadable).not.toContain("roiIds");
    expect(gap.unreadable).not.toContain("cameraIds");
  });

  it("absorbs fields the response schema understates", () => {
    // The server returns objectTypes/inCountingEnabled/outCountingEnabled under
    // their own names, and 10.0's LineSet schema now declares them too — so none
    // of the three is ever flagged, whether the spec mentions them or not.
    const gap = gaps["PATCH /api/lineSets/{lineSetId}"]!;
    for (const field of ["objectTypes", "inCountingEnabled", "outCountingEnabled"]) {
      expect(gap.unreadable, field).not.toContain(field);
      expect(fieldsOf(gap.renamed), field).not.toContain(field);
    }
  });

  it("routes the lineSet's cameraId to the nested camera object", () => {
    // 10.0 declares a LineSet response carrying `camera` as an object while the
    // request takes a flat cameraId — the same id-expands-into-an-object shape
    // as RoiRequest. 9.3's response schema was vague enough that no gap was
    // computed here at all, so this only became visible on the upgrade.
    const gap = gaps["PATCH /api/lineSets/{lineSetId}"]!;
    expect(gap.unreadable).toEqual([]);
    expect(gap.renamed.find((r) => r.field === "cameraId")?.readAt).toBe("camera.cameraId");
  });

  it("suppresses credentials an API is right not to echo back", () => {
    expect(gaps["PATCH /api/accounts/{accountId}"]?.unreadable ?? []).not.toContain("password");
    expect(gaps["PUT /api/ainvrs/{ainvrId}"]).toBeUndefined();
  });

  it("skips bulk-action endpoints whose body is a command, not a record", () => {
    expect(gaps["PUT /api/alerts"]).toBeUndefined();
  });

  it("never reports a field the read schema returns under its own name", () => {
    for (const [opId, gap] of Object.entries(gaps)) {
      const readable = Object.keys(schemaDefinitions(ctx.spec)[gap.responseDef].properties ?? {});
      for (const field of [...gap.unreadable, ...fieldsOf(gap.renamed)]) {
        expect(readable, `${opId} flagged "${field}" despite the schema declaring it`).not.toContain(field);
      }
    }
  });

  it("never lists a field as both renamed and unreadable", () => {
    for (const [opId, gap] of Object.entries(gaps)) {
      for (const { field } of gap.renamed) {
        expect(gap.unreadable, `${opId} double-counts "${field}"`).not.toContain(field);
      }
    }
  });
});

describe("CONFIRMED_UPDATE_SEMANTICS", () => {
  it("only describes operations that exist in the spec", () => {
    for (const opId of Object.keys(CONFIRMED_UPDATE_SEMANTICS)) {
      expect(() => findOp(opId), `${opId} is not an operation in the spec`).not.toThrow();
    }
  });

  it("records evidence for every claim, since a wrong one suppresses a warning", () => {
    for (const [opId, entry] of Object.entries(CONFIRMED_UPDATE_SEMANTICS)) {
      expect(entry.evidence.length, `${opId} has no evidence recorded`).toBeGreaterThan(40);
    }
  });

  it("does not claim an operation both clears and merges", () => {
    // LOSSY_UPDATE_OPS refuses calls; claiming the same operation merges would
    // make the guard and the warning contradict each other.
    for (const opId of Object.keys(LOSSY_UPDATE_OPS)) {
      expect(updateSemantics(opId)).toBe("clears-omitted");
    }
  });

  it("distinguishes advertised PUT replacement from a surprising PATCH", () => {
    // Both lose omitted fields, but only one is a surprise. Keeping them as
    // separate categories is what lets the warnings say something useful about
    // each instead of one generic alarm.
    expect(updateSemantics("PUT /api/face/categories/{faceCategoryId}")).toBe("replaces");
    expect(updateSemantics("PATCH /api/user-groups/{userGroupId}")).toBe("clears-omitted");
  });

  it("records the accounts asymmetry that made the row testable", () => {
    // AccountRequest marks password required, which looked like it made any test
    // a password reset. It is enforced on PUT only: PATCH accepts a body without
    // one, which supplied the restore path, and PUT refusing a partial body is
    // itself the answer for PUT. No credential was ever sent.
    expect(updateSemantics("PATCH /api/accounts/{accountId}")).toBe("merges");
    expect(updateSemantics("PUT /api/accounts/{accountId}")).toBe("rejects-partial");
    expect(CONFIRMED_UPDATE_SEMANTICS["PUT /api/accounts/{accountId}"].evidence).toContain("password");
  });

  it("keeps the alert-rule finding that overturned the suspicion", () => {
    // Three commits assumed this endpoint nulled omitted fields by analogy with
    // user-groups. A partial PATCH against a throwaway rule left description,
    // condition.cameras/hashtags/typeLogic/cooldownInterval and schedule.forever
    // all intact, reproduced three times.
    expect(updateSemantics("PATCH /api/alertRules/{alertRuleId}")).toBe("merges");
    // Same path, other verb, completely different behaviour: 500 on a partial body.
    expect(updateSemantics("PUT /api/alertRules/{alertRuleId}")).toBe("rejects-partial");
  });
});

describe("fieldsAtRisk / roundTripWarning", () => {
  const gaps = computeRoundTripGaps(ctx.spec);
  const filters = gaps["PUT /api/filters/{filterId}"];
  const userGroups = gaps["PATCH /api/user-groups/{userGroupId}"];
  const cameraGroups = gaps["PUT /api/camera-groups/{cameraGroupId}"];

  it("reports nothing when the body sets every field", () => {
    expect(hasRisk(fieldsAtRisk(filters, { query: "x", cameraIds: [1], type: "basic" }))).toBe(false);
  });

  it("lists omitted fields as recoverable when a read location is known", () => {
    const risk = fieldsAtRisk(filters, { query: "x" });
    expect(risk.recoverable.map((r) => r.field).sort()).toEqual(["cameraIds", "type"]);
    expect(risk.unrecoverable).toEqual([]);
    expect(hasRisk(risk)).toBe(true);
  });

  it("lists omitted fields as unrecoverable when no source is known", () => {
    const risk = fieldsAtRisk(cameraGroups, { name: "x" });
    expect(risk.unrecoverable).toEqual(["cameraGroupIds"]);
  });

  it("lists a sub-resource field separately from one with no source at all", () => {
    const risk = fieldsAtRisk(userGroups, { name: "x" });
    expect(risk.unrecoverable).toEqual([]);
    expect(risk.viaSubresource.map((r) => r.field)).toEqual(["accountIds"]);
    expect(hasRisk(risk)).toBe(true);
  });

  it("treats an explicit null as sent — clearing it is a stated intention", () => {
    expect(hasRisk(fieldsAtRisk(filters, { query: null, cameraIds: null, type: null }))).toBe(false);
  });

  it("treats a missing or non-object body as omitting everything", () => {
    for (const body of [undefined, null, "x", []]) {
      const risk = fieldsAtRisk(filters, body);
      expect(risk.recoverable.map((r) => r.field).sort()).toEqual(["cameraIds", "query", "type"]);
    }
  });

  it("returns nothing for an operation with no gap", () => {
    expect(hasRisk(fieldsAtRisk(undefined, {}))).toBe(false);
    expect(roundTripWarning(undefined)).toBeUndefined();
  });

  it("tells the caller where to read a renamed field, not just that it is missing", () => {
    const warning = roundTripWarning(filters)!;
    expect(warning).toContain("expression.query");
    expect(warning).toContain("GET /api/filters/{filterId}");
    // Nothing is unrecoverable here, so it must not raise a CAUTION.
    expect(warning).not.toContain("CAUTION");
  });

  it("raises a caution only for fields with no known source", () => {
    const opId = "PUT /api/camera-groups/{cameraGroupId}";
    const warning = roundTripWarning(gaps[opId], opId)!;
    expect(warning).toContain("CAUTION");
    expect(warning).toContain("cameraGroupIds");
  });

  it("points at the sub-resource instead of cautioning, where one exists", () => {
    // The difference between a warning a caller can act on and one they can only
    // worry about.
    const opId = "PATCH /api/user-groups/{userGroupId}";
    const warning = roundTripWarning(userGroups, opId)!;
    expect(warning).not.toContain("CAUTION");
    expect(warning).toContain("GET /api/user-groups/{userGroupId}/accounts");
  });

  it("does not tell a caller a surviving collection will be nulled", () => {
    // The operation-level verdict for this endpoint is `clears-omitted`, earned by
    // the scalar externalId. Appending that to the accountIds note contradicted
    // this repo's own recorded evidence — collections provably survive here — and
    // sent callers to do a GET and a larger PATCH for nothing.
    const opId = "PATCH /api/user-groups/{userGroupId}";
    expect(updateSemantics(opId)).toBe("clears-omitted");
    const warning = roundTripWarning(userGroups, opId)!;
    expect(warning).not.toContain("nulls fields the body omits");
    expect(warning).toContain("Read it there if you need the current value");
  });

  it("names both categories when an operation has each", () => {
    // camera-groups is the operation with a renamed field (cameraIds) *and* an
    // unreadable one (cameraGroupIds), on replace semantics — so the caution is
    // warranted and both leads appear.
    const opId = "PUT /api/camera-groups/{cameraGroupId}";
    const warning = roundTripWarning(gaps[opId], opId)!;
    expect(warning).toContain("NOTE:");
    expect(warning).toContain("CAUTION:");
    expect(warning).toContain("cameras[].cameraId");
  });

  it("does not threaten a reset on an endpoint that refuses partial bodies", () => {
    // "may be reset" is false where nothing applies. Pairing it with "refuses
    // partial bodies" in one blockquote asserted both at once.
    const opId = "PUT /api/alertRules/{alertRuleId}";
    expect(updateSemantics(opId)).toBe("rejects-partial");
    const warning = roundTripWarning(gaps[opId], opId)!;
    expect(warning).not.toContain("CAUTION");
    expect(warning).not.toContain("may be reset");
    expect(warning).toContain("fails rather than resetting anything");
  });

  it("does not contradict the tool description in the runtime note", () => {
    // The note and the warning ship on the same call. Before roundTripNote took
    // an opId it told callers on a confirmed-merging endpoint that their values
    // "cannot be read back to preserve them" while the description said omitted
    // fields are left alone.
    const opId = "PATCH /api/alertRules/{alertRuleId}";
    const gap = gaps[opId];
    const note = roundTripNote(gap, fieldsAtRisk(gap, { name: "x" }), opId);
    expect(note).toContain("keeps omitted fields");
    expect(note).not.toContain("cannot be read back to preserve");
    expect(note).not.toContain("verify the record afterwards");
  });

  it("opens the note with a clause that reads as an opener", () => {
    // The three clauses are conditional, so "also" cannot be baked into any of
    // them: a note whose only clause began "It also omits" referred back to
    // nothing. Each of these bodies exercises a different clause going first.
    const cases: Array<[string, unknown]> = [
      ["PATCH /api/user-groups/{userGroupId}", { name: "x", externalId: null }], // sub-resource first
      ["PUT /api/camera-groups/{cameraGroupId}", { name: "x" }], // renamed first
      ["PATCH /api/alertRules/{alertRuleId}", { name: "x" }], // renamed first, many fields
    ];
    for (const [opId, body] of cases) {
      const gap = gaps[opId];
      const note = roundTripNote(gap, fieldsAtRisk(gap, body), opId);
      expect(note.startsWith("This body omits"), `${opId}: ${note.slice(0, 40)}`).toBe(true);
      expect(note.startsWith("It also"), opId).toBe(false);
    }
  });

  it("still says \"also\" for the second clause onwards", () => {
    // A body that leaves out both a renamed field and one with no known source.
    const opId = "PUT /api/camera-groups/{cameraGroupId}";
    const note = roundTripNote(gaps[opId], fieldsAtRisk(gaps[opId], {}), opId);
    expect(note.startsWith("This body omits")).toBe(true);
    expect(note).toContain("It also omits");
  });

  it("does not name a status code it cannot know", () => {
    // Two of the five rejects-partial endpoints answer 400, not 500, so the
    // wording stays status-agnostic.
    for (const opId of ["PUT /api/cameras/{cameraId}", "PUT /api/filters/{filterId}"]) {
      expect(roundTripWarning(gaps[opId], opId)!).not.toContain("500");
    }
  });

  it("agrees in number with the singular/plural wording it chooses", () => {
    const cgId = "PUT /api/camera-groups/{cameraGroupId}";
    expect(roundTripWarning(gaps[cgId], cgId)!).toContain("has no known equivalent");
    const opId = "PUT /api/alertRules/{alertRuleId}";
    expect(roundTripWarning(gaps[opId], opId)!).toContain("have no known equivalent");
  });

  // The phrasing follows what live testing established per operation. Telling a
  // caller that a confirmed-merging endpoint might reset their data would train
  // them to ignore these lines.
  it("does not warn about losing data on an endpoint confirmed to merge", () => {
    const opId = "PATCH /api/alertRules/{alertRuleId}";
    const warning = roundTripWarning(gaps[opId], opId)!;
    expect(updateSemantics(opId)).toBe("merges");
    expect(warning).not.toContain("CAUTION");
    expect(warning).toContain("confirmed to leave omitted fields alone");
  });

  it("says the full object is required where partial bodies are refused", () => {
    const opId = "PUT /api/filters/{filterId}";
    expect(updateSemantics(opId)).toBe("rejects-partial");
    expect(roundTripWarning(gaps[opId], opId)!).toContain("refuses partial bodies");
  });

  it("hedges for an operation whose behaviour is not recorded", () => {
    // Every flagged operation is now recorded, so the hedge is exercised with a
    // synthetic gap rather than a real endpoint. The branch still matters: it is
    // what a newly-added or newly-flagged operation gets before anyone tests it.
    // Uses a gap with renamed fields, since that is the branch carrying the
    // consequence clause. A gap of only-unreadable fields already says "may be
    // reset", which is the cautious reading either way.
    const untested = { ...gaps["PUT /api/filters/{filterId}"] };
    expect(updateSemantics("PATCH /api/not-a-real-endpoint")).toBe("unknown");
    expect(roundTripWarning(untested, "PATCH /api/not-a-real-endpoint")!).toContain("untested");
  });

  it("leaves no flagged operation without recorded semantics", () => {
    // The point of the write probes: every operation the round-trip check warns
    // about has had its omission behaviour established, so no warning has to
    // hedge. A newly flagged operation failing this is a prompt to probe it, not
    // to relax the assertion.
    const unrecorded = Object.keys(gaps).filter((opId) => updateSemantics(opId) === "unknown");
    expect(unrecorded).toEqual([]);
  });

  it("keeps the same warning cautious when no opId is supplied", () => {
    // Callers that do not pass an opId cannot get the reassuring phrasing.
    expect(roundTripWarning(gaps["PATCH /api/alertRules/{alertRuleId}"])!).toContain("untested");
  });
});

describe("classifySubresource", () => {
  // This reduction has been wrong twice: first by concluding "broken" from the
  // first record without trying the others, then by reconstructing the verdict
  // from the detail *string* instead of the status, which reclassified an
  // ordinary unset-field message as a broken mapping. Both produced the exact
  // false alarm the surrounding retry logic exists to prevent.
  it("takes a single held record as proof, whatever else failed", () => {
    expect(
      classifySubresource([
        { status: "unverified", detail: "HTTP 403" },
        { status: "broken", detail: 'no "content" key in the response' },
        { status: "held" },
      ]).status
    ).toBe("held");
  });

  it("does not call a 4xx broken", () => {
    // A forbidden or missing sub-resource on one record says nothing about where
    // the field lives.
    const v = classifySubresource([
      { status: "unverified", detail: "HTTP 403" },
      { status: "unverified", detail: "HTTP 404" },
    ]);
    expect(v.status).toBe("unverified");
  });

  it("does not call an unset or empty field broken", () => {
    // The regression: this detail contains no "HTTP" and none of the words the
    // old string-matching looked for, so it was reported as a broken mapping.
    const v = classifySubresource([
      { status: "unverified", detail: 'no "accountId" inside "content" on this record' },
    ]);
    expect(v.status).toBe("unverified");
    expect(v.detail).toContain("accountId");
  });

  it("reports broken when a record shows the path is structurally wrong", () => {
    const v = classifySubresource([
      { status: "unverified", detail: '"content" is empty on this record' },
      { status: "broken", detail: '"content" is not an array' },
    ]);
    expect(v.status).toBe("broken");
    expect(v.detail).toBe('"content" is not an array');
  });

  it("handles having nothing to go on", () => {
    expect(classifySubresource([]).status).toBe("unverified");
  });
});

describe("redactSecrets", () => {
  it("redacts every credential field this API actually uses", () => {
    // Audited against the spec rather than guessed. `ApiKey.key` is the one
    // that mattered: GET /api/accounts/api-keys returns the key itself, so
    // without this the tool echoed every key on the account to the model.
    for (const field of [
      "key",
      "accessKey",
      "secretKey",
      "googleMapApiKey",
      "sslPrivateKeyPassPhrase",
      "uploadedPrivateKey",
      "uploadedChainKey",
      "uploadedPublicKey",
      "serialKey",
    ]) {
      const out = redactSecrets({ [field]: "SECRET" }) as Record<string, unknown>;
      expect(out[field], `${field} leaked`).not.toBe("SECRET");
    }
  });

  it("does not redact the look-alike fields that carry real data", () => {
    // Over-redaction breaks legitimate reads, which is why the rule is exact
    // names rather than "anything ending in key" — that would swallow these.
    for (const field of ["faceKey", "faceTargetKey", "faceKeyId", "faceTargetKeyId", "keys", "keyword", "keyId"]) {
      const out = redactSecrets({ [field]: "DATA" }) as Record<string, unknown>;
      expect(out[field], `${field} over-redacted`).toBe("DATA");
    }
  });

  it("redacts known sensitive keys", () => {
    const result = redactSecrets({ username: "admin", password: "hunter2" }) as any;
    expect(result.password).toBe("***REDACTED***");
    expect(result.username).toBe("admin");
  });

  it("does not redact keys that merely contain a sensitive substring", () => {
    // Regression guard: exact-match only, so "tokenType"/"passwordPolicy" survive intact.
    const result = redactSecrets({ tokenType: "Bearer", passwordPolicy: "min8chars" }) as any;
    expect(result.tokenType).toBe("Bearer");
    expect(result.passwordPolicy).toBe("min8chars");
  });

  it("recurses into nested objects and arrays", () => {
    const result = redactSecrets({
      trigger: { request: { authorization: { auth: "BASIC", account: "admin", password: "secret123" } } },
      list: [{ apiKey: "abc" }, { apiKey: "def" }],
    }) as any;
    expect(result.trigger.request.authorization.password).toBe("***REDACTED***");
    expect(result.trigger.request.authorization.account).toBe("admin");
    expect(result.list[0].apiKey).toBe("***REDACTED***");
    expect(result.list[1].apiKey).toBe("***REDACTED***");
  });

  it("redacts secrets embedded in a JSON-encoded string field", () => {
    // Regression test for a live finding: AlertRule.trigger comes back as a
    // JSON string, not a nested object — e.g. "trigger": "{\"request\":{...,
    // \"password\":\"real-value\"}}". A plain object walk would miss this.
    const embedded = JSON.stringify({ request: { authorization: { password: "leaked-value" } } });
    const result = redactSecrets({ trigger: embedded }) as any;
    expect(result.trigger).not.toContain("leaked-value");
    const reparsed = JSON.parse(result.trigger);
    expect(reparsed.request.authorization.password).toBe("***REDACTED***");
  });

  it("leaves ordinary strings and non-JSON-looking strings untouched", () => {
    const result = redactSecrets({ description: "just a normal note", empty: "" }) as any;
    expect(result.description).toBe("just a normal note");
    expect(result.empty).toBe("");
  });

  it("passes through primitives and null unchanged", () => {
    expect(redactSecrets(null)).toBeNull();
    expect(redactSecrets(42)).toBe(42);
    expect(redactSecrets(true)).toBe(true);
  });
});

describe("defaultRoiContour", () => {
  it("builds a full-frame rectangle matching the given resolution", () => {
    const roi = defaultRoiContour("1280x720") as any;
    expect(roi).toEqual([{ contour: [{ x: 0, y: 0 }, { x: 1280, y: 0 }, { x: 1280, y: 720 }, { x: 0, y: 720 }] }]);
  });

  it("falls back to 1920x1080 for an unparseable resolution string", () => {
    const roi = defaultRoiContour("not-a-resolution") as any;
    expect(roi[0].contour[2]).toEqual({ x: 1920, y: 1080 });
  });
});

describe("buildCameraBody", () => {
  it("fills in every field found to be silently required in practice", () => {
    // Regression test for a live-deployment finding: a minimal-but-schema-
    // valid body (name, streamUrl, engineProfileId, roiContour) still threw
    // a bare NullPointerException. These fields avoided it.
    const { body } = buildCameraBody({ name: "Test Cam", streamUrl: "rtsp://user:pass@10.0.0.5:554/stream1" }, 1);
    expect(body.resolution).toBe("1920x1080");
    expect(body.frameRate).toBe(25);
    expect(body.plugins).toEqual([]);
    expect(body.schedule).toEqual({ weekdays: [], forever: true });
    expect(body.fpsType).toBe("Camera");
    expect(body.flipState).toBe("None");
    expect(body.codec).toBe("H264");
    expect(body.cameraGroupIds).toEqual([]);
    expect(body.roiContour).toBeDefined();
    expect(body.engineProfileId).toBe(1);
  });

  it("defaults cameraType to the type that actually provisions", () => {
    // Not cosmetic. A VideoSource camera is accepted with a 2xx and then never
    // provisions: measured against a live stream, three stayed status=null past
    // 300s while the same stream as General reached "Processing" in ~5s.
    const { body } = buildCameraBody({ name: "Test Cam", streamUrl: "rtsp://10.0.0.5:554/s" }, 1);
    expect(body.cameraType).toBe("General");
  });

  it("lets a caller override cameraType, since one deployment is not every deployment", () => {
    const { body } = buildCameraBody(
      { name: "Test Cam", streamUrl: "rtsp://10.0.0.5:554/s", cameraType: "VideoSource" },
      1
    );
    expect(body.cameraType).toBe("VideoSource");
  });

  it("uses the exact streamUrl when given, without guessing", () => {
    const { body, warnings } = buildCameraBody(
      { name: "Test Cam", streamUrl: "rtsp://exact-url:554/stream1" },
      1
    );
    expect(body.streamUrl).toBe("rtsp://exact-url:554/stream1");
    expect(warnings.some((w) => w.includes("guessed"))).toBe(false);
  });

  it("guesses a generic streamUrl from ip/account/password and warns about it", () => {
    const { body, warnings } = buildCameraBody(
      { name: "Test Cam", ip: "10.0.0.5", port: 8554, account: "admin", password: "pw" },
      1
    );
    expect(body.streamUrl).toBe("rtsp://admin:pw@10.0.0.5:8554");
    expect(warnings.some((w) => w.includes("guessed"))).toBe(true);
  });

  it("throws when neither streamUrl nor ip is given", () => {
    expect(() => buildCameraBody({ name: "Test Cam" }, 1)).toThrow(/needs either "streamUrl" or "ip"/);
  });

  it("defaults engineProfileId and warns when not explicitly given", () => {
    const { body, warnings } = buildCameraBody({ name: "Test Cam", streamUrl: "rtsp://x:554/s" }, 42);
    expect(body.engineProfileId).toBe(42);
    expect(warnings.some((w) => w.includes("defaulted to 42"))).toBe(true);
  });

  it("respects an explicitly given engineProfileId without warning", () => {
    const { body, warnings } = buildCameraBody(
      { name: "Test Cam", streamUrl: "rtsp://x:554/s", engineProfileId: 7 },
      42
    );
    expect(body.engineProfileId).toBe(7);
    expect(warnings.some((w) => w.includes("engineProfileId"))).toBe(false);
  });

  it("uses locationType GPS_MAP only when both latitude and longitude are given", () => {
    const withLoc = buildCameraBody(
      { name: "Test Cam", streamUrl: "rtsp://x:554/s", latitude: 1, longitude: 2 },
      1
    ).body;
    expect(withLoc.locationType).toBe("GPS_MAP");

    const withoutLoc = buildCameraBody({ name: "Test Cam", streamUrl: "rtsp://x:554/s" }, 1).body;
    expect(withoutLoc.locationType).toBe("NONE");
  });
});

describe("lossy partial-update guard", () => {
  const OP = "PATCH /api/user-groups/{userGroupId}";

  it("flags a body that omits a field the server would silently null", () => {
    // Confirmed live: this exact call returns 200 and clears externalId.
    expect(findLossyOmissions(OP, { name: "Renamed" })).toEqual(["externalId"]);
    expect(lossyUpdateError(OP, { name: "Renamed" })).toContain("externalId");
    expect(lossyUpdateError(OP, { name: "Renamed" })).toContain("Refusing to call");
  });

  it("allows a body that carries the field through", () => {
    expect(findLossyOmissions(OP, { name: "Renamed", externalId: "sso-group-1" })).toEqual([]);
    expect(lossyUpdateError(OP, { name: "Renamed", externalId: "sso-group-1" })).toBeUndefined();
  });

  it("allows an explicit null, because clearing is then the caller's intent", () => {
    expect(findLossyOmissions(OP, { name: "Renamed", externalId: null })).toEqual([]);
    expect(lossyUpdateError(OP, { name: "Renamed", externalId: null })).toBeUndefined();
  });

  it("treats an explicit undefined as the omission it becomes on the wire", () => {
    // JSON.stringify drops undefined, so this reaches the server as an omission.
    expect(findLossyOmissions(OP, { name: "Renamed", externalId: undefined })).toEqual(["externalId"]);
  });

  it("treats a missing or non-object body as omitting everything", () => {
    for (const body of [undefined, null, "not an object", [], 42]) {
      expect(findLossyOmissions(OP, body), JSON.stringify(body) ?? "undefined").toEqual(["externalId"]);
    }
  });

  it("leaves every unguarded operation alone", () => {
    expect(findLossyOmissions("PUT /api/camera-groups/{cameraGroupId}", { name: "x" })).toEqual([]);
    expect(lossyUpdateError("GET /api/cameras", undefined)).toBeUndefined();
    expect(lossyUpdateWarning("GET /api/cameras")).toBeUndefined();
  });

  it("tells the caller how to both preserve and deliberately clear the field", () => {
    const msg = lossyUpdateError(OP, {})!;
    expect(msg).toContain("read the record first");
    expect(msg).toContain('"externalId": null');
    expect(msg).toContain("SSO");
  });

  it("guards only operations that exist in the spec", () => {
    // A typo'd key would silently guard nothing at all.
    for (const opId of Object.keys(LOSSY_UPDATE_OPS)) {
      expect(() => findOp(opId), opId).not.toThrow();
    }
  });

  it("surfaces the caution in the generated tool description", () => {
    // The guard refuses at call time, but a caller that reads the docs first
    // can send the right body and never hit the refusal.
    const group = ctx.tags.find((g) => g.operations.some((o) => o.id === OP));
    expect(group, "no tag exposes the guarded operation").toBeDefined();
    const text = describeTag(ctx.spec, group!);
    expect(text).toContain("CAUTION");
    expect(text).toContain("externalId");
  });
});

describe("access policy", () => {
  const find = (id: string) => findOp(id);
  const open = { readOnly: false, allowCollectionDelete: false };
  const readOnly = { readOnly: true, allowCollectionDelete: false };
  const permissive = { readOnly: false, allowCollectionDelete: true };

  it("refuses collection-level deletes by default", () => {
    // DELETE /api/cameras removes the camera estate; DELETE /api/cameras/{id}
    // removes one camera. One character of difference, and the destructive one
    // is unrecoverable, so it is off unless an operator turns it on.
    const reason = refusalReason(find("DELETE /api/cameras"), open);
    expect(reason).toBeDefined();
    expect(reason).toContain("names no record to delete");
    expect(reason).toContain("may empty the collection");
    expect(refusalReason(find("DELETE /api/cameras/{cameraId}"), open)).toBeUndefined();
  });

  it("names the safe alternative and the switch in the refusal", () => {
    // The refusal is read by a model deciding what to do next. "Refused" alone
    // invites a retry.
    const reason = refusalReason(find("DELETE /api/accounts"), open)!;
    expect(reason).toContain("DELETE /api/accounts/{id}");
    expect(reason).toContain("IVEDAAI_ALLOW_COLLECTION_DELETE");
  });

  it("permits collection deletes only when explicitly enabled", () => {
    expect(refusalReason(find("DELETE /api/cameras"), permissive)).toBeUndefined();
  });

  it("refuses every non-GET in read-only mode", () => {
    for (const id of ["POST /api/cameras", "PUT /api/lpr/targets/{targetId}", "DELETE /api/cameras/{cameraId}"]) {
      expect(refusalReason(find(id), readOnly), id).toContain("read-only");
    }
    expect(refusalReason(find("GET /api/cameras"), readOnly)).toBeUndefined();
  });

  it("read-only is not softened by the collection-delete switch", () => {
    const both = { readOnly: true, allowCollectionDelete: true };
    expect(refusalReason(find("DELETE /api/cameras"), both)).toContain("read-only");
  });

  it("leaves every collection delete out of the advertised operations by default", () => {
    // The filter and the call-time check have to agree, or a tool advertises
    // something that can only be refused.
    for (const group of ctx.tags) {
      for (const op of allowedOperations(group.operations, open)) {
        expect(refusalReason(op, open), op.id).toBeUndefined();
      }
    }
    const all = ctx.tags.flatMap((g) => g.operations);
    const allowed = ctx.tags.flatMap((g) => allowedOperations(g.operations, open));
    expect(all.length - allowed.length, "expected the collection deletes to be filtered").toBeGreaterThan(20);
  });

  it("leaves only GETs when read-only", () => {
    const allowed = ctx.tags.flatMap((g) => allowedOperations(g.operations, readOnly));
    expect(allowed.every((o) => o.method === "GET")).toBe(true);
    expect(allowed.length).toBeGreaterThan(100);
  });

  it("reads both switches from the environment", () => {
    expect(policyFromEnv({} as NodeJS.ProcessEnv)).toEqual({ readOnly: false, allowCollectionDelete: false });
    expect(policyFromEnv({ IVEDAAI_READ_ONLY: "true" } as NodeJS.ProcessEnv).readOnly).toBe(true);
    // Anything other than the exact string is off — a stray "1" or "yes" must
    // not silently unlock destructive calls.
    expect(policyFromEnv({ IVEDAAI_ALLOW_COLLECTION_DELETE: "1" } as NodeJS.ProcessEnv).allowCollectionDelete).toBe(false);
  });
});

describe("the bundled API document ships nothing deployment-specific", () => {
  // resources/openapi.json is vendored from a generated document, and generators
  // put the machine they ran against into it. The version shipped here carried a
  // `servers` block naming an internal deployment — published to every user who
  // installed the package — plus a previous product name in its `info` block.
  // Neither is quoted here: a guard that repeats the string it exists to keep out
  // puts it back in the repository.
  //
  // Nothing read `servers`: the loader parses it into `host`/`schemes`, which no
  // caller consumes, because `IVEDAAI_BASE_URL` is the authority. So removing it
  // is free, and this test is here to keep it removed the next time the document
  // is refreshed from a generator.
  const raw = readFileSync(join(__dirname, "..", "resources", "openapi.json"), "utf8");
  const spec = JSON.parse(raw) as { servers?: unknown; info?: Record<string, unknown> };

  it("names no server", () => {
    expect(spec.servers).toBeUndefined();
  });

  it("carries no host that looks like a real deployment", () => {
    // Any dotted quad outside the documentation ranges reserved by RFC 5737.
    const addresses = raw.match(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g) ?? [];
    const real = addresses.filter(
      (a) => !a.startsWith("192.0.2.") && !a.startsWith("198.51.100.") && !a.startsWith("203.0.113.")
    );
    expect(real, `bundled spec names ${real.join(", ")}`).toEqual([]);
  });

  it("carries no legacy product or vendor branding outside property names", () => {
    // `vaidioMode` is a property the server actually sends and accepts, so it
    // stays; anything else — titles, descriptions, licence blocks — should not
    // reach a user.
    const branded = raw.match(/[Vv]aidio\w*|[Ii]ron[Yy]un/g) ?? [];
    expect(branded.filter((m) => m !== "vaidioMode")).toEqual([]);
  });
});

describe("response size cap", () => {
  // The default exists to fit a *client*, not the API. Measured: 47 cameras at
  // size=500 is 413 KB, which a real MCP client refused as too large — each
  // camera embeds its full engineProfile, ~3.8 KB of the ~5.2 KB record.
  const withEnv = <T>(vars: Record<string, string | undefined>, fn: () => T): T => {
    const prev: Record<string, string | undefined> = {};
    for (const [k, val] of Object.entries(vars)) {
      prev[k] = process.env[k];
      if (val === undefined) delete process.env[k];
      else process.env[k] = val;
    }
    try {
      return fn();
    } finally {
      for (const [k, val] of Object.entries(prev)) {
        if (val === undefined) delete process.env[k];
        else process.env[k] = val;
      }
    }
  };
  const credentials = {
    IVEDAAI_BASE_URL: "https://ivedaai.example.com",
    IVEDAAI_USERNAME: "u",
    IVEDAAI_PASSWORD: "p",
  };

  it("defaults to something a model client can actually receive", () => {
    const cfg = withEnv({ ...credentials, IVEDAAI_MAX_RESPONSE_BYTES: undefined }, () =>
      loadConfig(loadSwagger())
    );
    expect(cfg.maxResponseBytes).toBe(131_072);
    // The measurement that set it.
    expect(cfg.maxResponseBytes).toBeLessThan(413_206);
  });

  it("still honours an explicit override", () => {
    const cfg = withEnv({ ...credentials, IVEDAAI_MAX_RESPONSE_BYTES: "500000" }, () =>
      loadConfig(loadSwagger())
    );
    expect(cfg.maxResponseBytes).toBe(500_000);
  });
});

describe("insecureTransportWarning", () => {
  it("warns about plain HTTP to a remote host", () => {
    const w = insecureTransportWarning("http://192.0.2.10");
    expect(w).toBeDefined();
    expect(w).toContain("plain HTTP");
    // Names the remedy, and the weaker fallback for on-prem self-signed certs.
    expect(w).toContain("https://");
    expect(w).toContain("IVEDAAI_ALLOW_INSECURE_TLS");
  });

  it("stays silent on loopback", () => {
    // Traffic that never leaves the machine has no path to listen on, and a
    // warning here would be noise that trains people past the real one.
    for (const origin of ["http://localhost:8080", "http://127.0.0.1:88", "http://[::1]:88"]) {
      expect(insecureTransportWarning(origin), origin).toBeUndefined();
    }
  });

  it("stays silent on ordinary HTTPS", () => {
    expect(insecureTransportWarning("https://ivedaai.example.com")).toBeUndefined();
  });

  it("warns when certificate verification is disabled", () => {
    const w = insecureTransportWarning("https://ivedaai.example.com", true);
    expect(w).toContain("certificate is not verified");
  });

  it("says nothing about an unparseable origin", () => {
    // loadConfig already rejects these; this must not throw on the way past.
    expect(insecureTransportWarning("not a url")).toBeUndefined();
  });
});
