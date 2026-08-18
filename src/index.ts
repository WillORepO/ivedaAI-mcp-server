#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadSwagger, tagToToolName, resolveRef, schemaDefinitions, schemaRef, type Operation } from "./swagger.js";
import { loadConfig, TokenManager, insecureTransportWarning } from "./auth.js";
import { executeOperation } from "./request.js";
import {
  describeTag,
  SERVER_INSTRUCTIONS,
  READ_ONLY_NOTE,
  READ_ONLY_TOOL_NOTE,
  GET_SCHEMA_DESCRIPTION,
  ALERT_INTEGRATION_DESCRIPTION,
  ADD_CAMERA_DESCRIPTION,
} from "./toolDocs.js";
import {
  TRIGGER_TYPES,
  buildTriggerBody,
  interpretTestResult,
  describeTriggerTypesCompact,
  mergeTriggerIntoRule,
} from "./alertTrigger.js";
import { lossyUpdateError } from "./partialUpdate.js";
import { policyFromEnv, refusalReason, allowedOperations } from "./accessPolicy.js";
import { computeRoundTripGaps, fieldsAtRisk, hasRisk, roundTripNote } from "./roundTrip.js";
import { buildCameraBody, type CameraSpec } from "./cameraOnboarding.js";
import { apiResponseOutput, schemaLookupOutput, alertIntegrationOutput, addCameraOutput } from "./outputSchema.js";
import { paginatedOperations, paginationRequest, summarisePage, pageNote } from "./pagination.js";

// --help and --version, handled before anything else runs.
//
// A stdio MCP server that answers a flag by starting up and waiting for
// JSON-RPC looks like a hang, which is a poor first impression for someone
// checking they installed the right thing. These exit before the spec is
// parsed or a transport is opened.
/**
 * This server's own version, from its package.json.
 *
 * Read once at module scope because two things need it and they used to
 * disagree: `--version` printed this, while the MCP handshake reported
 * `ctx.spec.info.version` — the IvedaAI *API* version baked into the bundled
 * spec. The same binary answered "1.0.0" on the command line and "10.0.0" over
 * MCP, and the second one is what a client displays and what a bug report
 * quotes, so the version people cited matched no release that exists.
 *
 * Resolved relative to this module rather than the working directory, so it
 * survives being launched from anywhere — which is how MCP clients launch it.
 */
const { createRequire } = await import("node:module");
const SERVER_VERSION = (createRequire(import.meta.url)("../package.json") as { version: string }).version;

const argv = process.argv.slice(2);
if (argv.includes("--version") || argv.includes("-v")) {
  console.log(SERVER_VERSION);
  process.exit(0);
}
if (argv.includes("--help") || argv.includes("-h")) {
  console.log(`ivedaai-mcp-server — an MCP server for the IvedaAI video analytics API

This is a stdio MCP server. It is normally launched by an MCP client rather than
by hand; running it in a terminal will simply wait for JSON-RPC on stdin.

  Add to your client's config:
    "command": "npx", "args": ["-y", "ivedaai-mcp-server"]

Required environment:
  IVEDAAI_BASE_URL                  Origin of your IvedaAI server, no path
  IVEDAAI_USERNAME                  Account username
  IVEDAAI_PASSWORD                  Account password

Optional:
  IVEDAAI_READ_ONLY=true            Serve reads only; withholds every non-GET
  IVEDAAI_ALLOW_COLLECTION_DELETE=true
                                    Permit DELETEs that name no record
  IVEDAAI_REDACT_SECRETS=false      Stop masking credential-shaped fields
  IVEDAAI_ALLOW_INSECURE_TLS=true   Skip TLS verification (self-signed certs)
  IVEDAAI_UPLOAD_ROOT=<dir>         Enable uploads confined to this directory
  IVEDAAI_ALLOW_UNCONFINED_UPLOADS=true
                                     Compatibility escape hatch; prefer a root
  IVEDAAI_MAX_UPLOAD_BYTES=67108864 Largest file this server will upload
  IVEDAAI_TIMEOUT_MS=30000          Per-request timeout
  IVEDAAI_MAX_RESPONSE_BYTES=28672  Response bytes read before truncating
  IVEDAAI_CLIENT_ID / IVEDAAI_CLIENT_SECRET
                                    Client credentials on the token request
  IVEDAAI_SWAGGER_PATH=<path>       Use a different OpenAPI 3 document

  --help, -h                        This message
  --version, -v                     Print the version

Docs: https://github.com/WillORepO/ivedaAI-mcp-server#readme`);
  process.exit(0);
}

const ctx = loadSwagger();

let tokenManager: TokenManager;
try {
  const config = loadConfig(ctx);
  // Said once at startup, on stderr, where an operator setting the server up
  // will see it. Not a refusal — see insecureTransportWarning.
  const transport = insecureTransportWarning(config.origin, process.env.IVEDAAI_ALLOW_INSECURE_TLS === "true");
  if (transport) console.error(`[ivedaai-mcp-server] WARNING: ${transport}`);
  tokenManager = new TokenManager(config);
} catch (err) {
  console.error(`[ivedaai-mcp-server] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

/**
 * What this server will let a caller do. See src/accessPolicy.ts.
 *
 * Applied in two places, though not equally. Filtering the operation enum is
 * what actually protects a generated tool: with the operation absent from the
 * enum, the SDK's schema validation rejects the call before the handler runs,
 * which `test/mcp.test.ts` pins. The `refusalReason` check below is therefore
 * unreachable for generated tools unless the filter and the policy ever
 * disagree — it earns its place on the hand-written tools, which bypass the
 * enum, and as the thing that fails safe if that invariant breaks.
 *
 * Read before the server is constructed, because read-only changes what the
 * server says about itself at initialize as well as what it offers.
 */
const ACCESS_POLICY = policyFromEnv();

const server = new McpServer(
  {
    name: "ivedaai-mcp-server",
    // This server's version, not the API's. See SERVER_VERSION.
    version: SERVER_VERSION,
  },
  // Said once at initialize instead of on all 63 generated tool descriptions. Clients are
  // not required to surface this, which is why nothing depends on it alone —
  // hence the shorter note on each tool description too.
  {
    instructions: ACCESS_POLICY.readOnly
      ? `${SERVER_INSTRUCTIONS}\n\n${READ_ONLY_NOTE}`
      : SERVER_INSTRUCTIONS,
  }
);

/**
 * The lossy-update guard is on unless explicitly disabled.
 *
 * `scripts/validate-crud.ts` is the one caller that legitimately needs to make
 * a lossy call: it omits a field on purpose to detect whether the server clears
 * it, which is how the guarded behaviour was found and how a future server-side
 * fix would be noticed. Nothing else should set this.
 */
const ENFORCE_LOSSY_UPDATE_GUARD = process.env.IVEDAAI_ALLOW_LOSSY_UPDATE !== "true";

/** Derived once at startup: update ops whose fields no read endpoint returns. */
const roundTripGaps = computeRoundTripGaps(ctx.spec);

/** Likewise: the operations whose success response is a Spring page. */
const paginated = paginatedOperations(ctx.spec);

/**
 * The methods RFC 9110 defines as idempotent — repeating the request has the
 * same effect on the server as making it once.
 *
 * PATCH is deliberately absent. RFC 5789 declines to guarantee it, and while
 * every PATCH this project has live-tested does behave idempotently, the
 * annotation is a promise to a client about calls nobody has run yet. As it
 * happens the caution is free: no tag here consists of PATCH and idempotent
 * methods alone, so admitting PATCH would not currently move a single tool.
 */
const IDEMPOTENT_METHODS = new Set(["GET", "HEAD", "OPTIONS", "PUT", "DELETE"]);

const seenNames = new Set<string>();

for (const group of ctx.tags) {
  const toolName = tagToToolName(group.tag);
  if (seenNames.has(toolName)) {
    console.error(`[ivedaai-mcp-server] duplicate tool name "${toolName}" for tag "${group.tag}", skipping`);
    continue;
  }
  seenNames.add(toolName);

  const operations = allowedOperations(group.operations, ACCESS_POLICY);
  // A tag whose every operation is forbidden becomes no tool at all, rather than
  // a tool that can only refuse.
  if (operations.length === 0) continue;

  const operationIds = operations.map((o) => o.id) as [string, ...string[]];
  const isReadOnly = operations.every((o) => o.method === "GET");
  const hasDestructive = operations.some((o) => o.method === "DELETE");
  // `every`, for the same reason `hasDestructive` is `some`: these tools
  // dispatch to many operations behind one annotation, so a per-tool claim is
  // only true if it holds for every operation the tool will accept. One POST in
  // a tag is enough to make "repeating this changes nothing" a lie.
  const isIdempotent = operations.every((o) => IDEMPOTENT_METHODS.has(o.method));

  server.registerTool(
    toolName,
    {
      title: `IvedaAI: ${group.tag}`,
      // Describe the allowed operations, not the whole tag: in read-only mode
      // the write operations are gone from the enum, and listing them here
      // would spend context advertising calls that can only be refused.
      //
      // But say that they were withheld. Absence on its own reads as "the API
      // cannot do this", and the SDK's enum rejection does not correct that
      // impression — see READ_ONLY_NOTE.
      description: ACCESS_POLICY.readOnly
        ? `${READ_ONLY_TOOL_NOTE}\n${describeTag(ctx.spec, { ...group, operations }, undefined, ctx.useBundledFindings)}`
        : describeTag(ctx.spec, { ...group, operations }, undefined, ctx.useBundledFindings),
      annotations: {
        readOnlyHint: isReadOnly,
        destructiveHint: hasDestructive,
        idempotentHint: isIdempotent,
        // These reach a remote deployment whose contents change without this
        // server's involvement. The spec's closed-world example is a memory
        // tool, whose entire universe the client already knows; a video
        // analytics install is the opposite of that.
        //
        // This used to say `false` while the two hand-written tools said
        // `true`, which was drift rather than a distinction — nothing recorded a
        // reason for either, and the same operations are reachable both ways.
        // `ivedaai_alert_integration` wraps POST /api/alertTriggers, which
        // `ivedaai_alert_trigger` also offers; `ivedaai_add_camera` wraps
        // POST /api/cameras and the activation job, both of which
        // `ivedaai_camera` also offers. A client could not act on an annotation
        // that answers differently depending on which door the same call goes
        // through.
        openWorldHint: true,
      },
      inputSchema: {
        operation: z.enum(operationIds).describe("Which API operation to call, from the list in this tool's description."),
        path: z
          .record(z.union([z.string(), z.number(), z.boolean()]))
          .optional()
          .describe("Path parameters, e.g. { \"cameraId\": 12 }"),
        query: z.record(z.any()).optional().describe("Query string parameters for this operation."),
        body: z.any().optional().describe("JSON request body, or form field values when uploading a file."),
        file: z
          .object({
            path: z.string().describe("Local filesystem path to the file to upload."),
            filename: z.string().optional(),
            contentType: z.string().optional(),
          })
          .optional()
          .describe("Local file to upload, for operations that accept a file."),
      },
      // Every operation on every tag answers with the same envelope, so one
      // declared shape covers all 316 of them. See src/outputSchema.ts for why
      // it carries no field documentation.
      outputSchema: apiResponseOutput,
    },
    async ({ operation, path, query, body, file }) => {
      const op = operations.find((o) => o.id === operation);
      if (!op) {
        return {
          content: [{ type: "text", text: `Unknown operation "${operation}" for tool "${toolName}".` }],
          isError: true,
        };
      }
      // Second line of the access policy: the enum above should already have
      // excluded this, but a client is free to send whatever it likes.
      const refused = refusalReason(op, ACCESS_POLICY);
      if (refused) {
        return { content: [{ type: "text", text: refused }], isError: true };
      }
      // Refuse partial updates this API would silently discard fields on,
      // before the call is made — the response would not reveal the loss.
      const lossy = ENFORCE_LOSSY_UPDATE_GUARD ? lossyUpdateError(op.id, body) : undefined;
      if (lossy) {
        return { content: [{ type: "text", text: lossy }], isError: true };
      }
      try {
        const result = await executeOperation(tokenManager, op, { path, query, body, file });

        // Spring's page fields, reduced to whether there is more and what to
        // send for it. Added beside `body` rather than into it, so what a caller
        // inspects is still the response the deployment actually sent.
        const summary = paginated.has(op.id) ? summarisePage(result.body) : undefined;
        const note = summary ? pageNote(summary, paginationRequest(ctx.spec, op)) : undefined;
        const paged = summary
          ? { ...result, pagination: { ...summary, ...(note ? { note } : {}) } }
          : result;

        // Fields this update omits that it could not simply read back — either
        // recoverable from another key in the response, or with no known source
        // at all. Reported only when the body actually left some out; a call
        // that sets them all is not at risk and stays quiet.
        const gap = roundTripGaps[op.id];
        const risk = fieldsAtRisk(gap, body);
        const payload =
          gap && hasRisk(risk)
            ? {
                ...paged,
                omittedFields: {
                  readableElsewhere: risk.recoverable,
                  // Without this a caller reading the structured payload sees two
                  // empty arrays for the very case the sub-resource category was
                  // added to describe — PATCH /api/user-groups omitting accountIds
                  // has nothing in the other two — and the pointer survives only
                  // as prose in `note`.
                  readableFromSubresource: risk.viaSubresource,
                  noKnownSource: risk.unrecoverable,
                  note: roundTripNote(gap, risk, op.id),
                },
              }
            : paged;

        // The base64 is stripped from the JSON before it is stringified, and
        // sent once as viewable image content instead. Leaving it on the
        // payload would deliver the same picture twice — once the model can
        // look at, once it can only read as tens of kilobytes of gibberish.
        const { image, ...textPayload } = payload as typeof payload & { image?: { mimeType: string; base64: string } };

        return {
          content: [
            { type: "text", text: JSON.stringify(textPayload, null, 2) },
            ...(image ? [{ type: "image" as const, data: image.base64, mimeType: image.mimeType }] : []),
          ],
          // The same object the text block serialises, so a client reading one
          // and a client reading the other cannot be told different things.
          structuredContent: textPayload,
          isError: result.status >= 400,
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error calling ${op.id}: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    }
  );
}

server.registerTool(
  "ivedaai_get_schema",
  {
    title: "IvedaAI: look up a request/response schema definition",
    description: GET_SCHEMA_DESCRIPTION,
    inputSchema: {
      name: z.string().optional().describe("Definition name, e.g. \"CameraRequest\". Omit to list all names."),
    },
    outputSchema: schemaLookupOutput,
    // The one genuinely closed-world tool here: it answers out of the bundled
    // `resources/openapi.json` and opens no connection at all, so its universe
    // really is fixed and shipped alongside it.
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ name }) => {
    if (!name) {
      // Wrapped rather than returned as a bare array: structuredContent has to
      // be an object. See src/outputSchema.ts.
      const payload = { names: Object.keys(schemaDefinitions(ctx.spec)).sort() };
      return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], structuredContent: payload };
    }
    const resolved = resolveRef(ctx.spec, schemaRef(name));
    if (!resolved) {
      return {
        content: [{ type: "text", text: `No definition named "${name}". Call with no arguments to list all names.` }],
        isError: true,
      };
    }
    const payload = { name, schema: resolved };
    return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], structuredContent: payload };
  }
);

function findOperation(id: string): Operation | undefined {
  for (const group of ctx.tags) {
    const op = group.operations.find((o) => o.id === id);
    if (op) return op;
  }
  return undefined;
}

const testAlertTriggerOp = findOperation("POST /api/alertTriggers");
const patchAlertRuleOp = findOperation("PATCH /api/alertRules/{alertRuleId}");
const getAlertRuleOp = findOperation("GET /api/alertRules/{alertRuleId}");
// Both hand-written tools below drive writes — one POSTs an alert trigger, the
// other creates and activates a camera — so a read-only server must not offer
// them. They are not generated from the spec, so the enum filter above does not
// reach them.
if (ACCESS_POLICY.readOnly) {
  console.error("[ivedaai-mcp-server] read-only: not registering ivedaai_alert_integration or ivedaai_add_camera");
} else if (!testAlertTriggerOp || !patchAlertRuleOp || !getAlertRuleOp) {
  console.error(
    "[ivedaai-mcp-server] expected operations for ivedaai_alert_integration not found in spec " +
      "(POST /api/alertTriggers, GET + PATCH /api/alertRules/{alertRuleId}) — skipping that tool."
  );
} else {
  const DEFAULT_TRIGGER_TEST_TIMEOUT_MS = 60_000;
  const triggerTypeNames = Object.keys(TRIGGER_TYPES) as [string, ...string[]];

  server.registerTool(
    "ivedaai_alert_integration",
    {
      title: "IvedaAI: configure and test alert-routing integrations",
      description: ALERT_INTEGRATION_DESCRIPTION,
      // Not idempotent, on account of "test": each call asks the deployment to
      // open a real connection to the configured webhook or VMS, so calling it
      // twice delivers two requests to whatever is on the other end. "apply"
      // and "list_types" would both qualify on their own; the annotation covers
      // the tool, so the action that does not is the one that decides it.
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      inputSchema: {
        action: z.enum(["list_types", "test", "apply"]).describe("Which action to perform."),
        type: z
          .enum(triggerTypeNames)
          .optional()
          .describe("Trigger type name. Required for 'test'/'apply'. Use 'list_types' to see all options."),
        config: z.any().optional().describe("Type-specific config fields — see this tool's description for the shape per category."),
        alertRuleId: z.string().optional().describe("Existing alert rule UUID to attach the trigger to. Required for 'apply'."),
        timeoutMs: z
          .number()
          .optional()
          .describe("Override the connection-test timeout in ms (default 60000). Raise this for slow VMS integrations."),
      },
      outputSchema: alertIntegrationOutput,
    },
    async ({ action, type, config, alertRuleId, timeoutMs }) => {
      if (action === "list_types") {
        // Under a "types" key rather than bare, for the same reason as
        // ivedaai_get_schema: structuredContent must be an object, and one
        // declared shape has to cover all three actions.
        const payload = { types: TRIGGER_TYPES };
        return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], structuredContent: payload };
      }

      if (!type) {
        return {
          content: [{ type: "text", text: `"type" is required for action "${action}". Call with action "list_types" to see valid values.` }],
          isError: true,
        };
      }

      let body: { trigger: Record<string, unknown> };
      try {
        body = buildTriggerBody(type, config);
      } catch (err) {
        return {
          content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        };
      }

      if (action === "test") {
        try {
          const result = await executeOperation(
            tokenManager,
            testAlertTriggerOp,
            { body },
            timeoutMs ?? DEFAULT_TRIGGER_TEST_TIMEOUT_MS
          );
          const interpretation = interpretTestResult(result.status, result.body);
          const payload = { ...interpretation, httpStatus: result.status, raw: result.body };
          return {
            content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
            structuredContent: payload,
            isError: result.status >= 400,
          };
        } catch (err) {
          return {
            content: [{ type: "text", text: `Error testing trigger: ${err instanceof Error ? err.message : String(err)}` }],
            isError: true,
          };
        }
      }

      // action === "apply"
      if (!alertRuleId) {
        return {
          content: [{ type: "text", text: `"alertRuleId" is required for action "apply".` }],
          isError: true,
        };
      }
      try {
        // Read the rule first so the update carries forward every field the read
        // exposes, rather than sending a bare {trigger} and trusting this server
        // to leave omissions alone — which its other PATCH provably does not.
        const current = await executeOperation(tokenManager, getAlertRuleOp, { path: { alertRuleId } });
        if (current.status >= 400) {
          return {
            content: [
              {
                type: "text",
                text:
                  `Could not read alert rule ${alertRuleId} before updating it (HTTP ${current.status}), so the ` +
                  `update was not attempted.\n\nThe read is not optional: this API's update endpoints have been ` +
                  `observed to null fields a request body omits, so applying a trigger without first seeing the ` +
                  `rule risks discarding the rest of it. Check the id and try again.\n\n` +
                  JSON.stringify(current, null, 2),
              },
            ],
            isError: true,
          };
        }

        // Every field the read could conceivably have supplied — whatever the
        // merge does not manage to carry forward is what remains at risk.
        const alertGap = roundTripGaps[patchAlertRuleOp.id];
        const merged = mergeTriggerIntoRule(current.body, body, [
          ...(alertGap?.unreadable ?? []),
          ...(alertGap?.renamed.map((r) => r.field) ?? []),
        ]);
        if (merged.missingRequired.length > 0) {
          return {
            content: [
              {
                type: "text",
                text:
                  `Refusing to apply the trigger: reading alert rule ${alertRuleId} did not yield ` +
                  `${merged.missingRequired.map((f) => `"${f}"`).join(", ")}, which AlertRuleRequest marks required.\n\n` +
                  `Sending the update anyway would mean a partial body on an endpoint that may null what it does ` +
                  `not receive. If you know the rule's full definition, send it yourself via the ivedaai_alert ` +
                  `tool ("PATCH /api/alertRules/{alertRuleId}") with a complete body.\n\n` +
                  `What the read returned:\n${JSON.stringify(current.body, null, 2)}`,
              },
            ],
            isError: true,
          };
        }

        const result = await executeOperation(tokenManager, patchAlertRuleOp, { path: { alertRuleId }, body: merged.body });
        const payload = {
          ...result,
          preservation: {
            carriedForward: merged.carriedForward,
            unrecoverable: merged.unrecoverable,
            note:
              `Fields under "carriedForward" were read from the rule and re-sent. Fields under ` +
              `"unrecoverable" are accepted by PATCH /api/alertRules/{alertRuleId} but have no known ` +
              `location in any read, so no client can carry them through an update. That is not a loss ` +
              `here: this endpoint has been live-tested and merges, leaving omitted fields alone, so the ` +
              `rest of the rule survives this call. Re-sending what could be read is precaution against a ` +
              `future change in that behaviour, not repair of a known one.`,
          },
        };
        return {
          content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
          structuredContent: payload,
          isError: result.status >= 400,
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error applying trigger: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    }
  );
}

const createCameraOp = findOperation("POST /api/cameras");
const activateCameraOp = findOperation("POST /api/cameras/{cameraId}/jobs");
const listCamerasOp = findOperation("GET /api/cameras");
const listEngineProfilesOp = findOperation("GET /api/engineProfiles");
const listAinvrsOp = findOperation("GET /api/ainvrs");

if (ACCESS_POLICY.readOnly) {
  // Already reported above; stay silent rather than log the same thing twice.
} else if (!createCameraOp || !activateCameraOp || !listCamerasOp || !listEngineProfilesOp || !listAinvrsOp) {
  console.error("[ivedaai-mcp-server] expected operations for ivedaai_add_camera not found in spec — skipping that tool.");
} else {
  server.registerTool(
    "ivedaai_add_camera",
    {
      title: "IvedaAI: add cameras from an IP or RTSP URL",
      description: ADD_CAMERA_DESCRIPTION,
      // Creating a camera is the definition of not idempotent: a second call
      // with the same arguments either makes a second record or fails on the
      // duplicate name, and the partial-creation quirk this tool exists to
      // detect makes "just call it again" actively unsafe.
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      inputSchema: {
        cameras: z
          .array(
            z.object({
              name: z.string().describe("Camera name (must be unique)."),
              streamUrl: z.string().optional().describe("Full RTSP URL, e.g. rtsp://user:pass@192.168.1.50:554/stream1. Preferred over ip."),
              ip: z.string().optional().describe("Camera IP, used only if streamUrl is omitted (a generic RTSP URL will be guessed)."),
              port: z.number().optional().describe("RTSP port, used with ip (default 554)."),
              account: z.string().optional().describe("Camera login username, used with ip, or stored alongside an explicit streamUrl."),
              password: z.string().optional().describe("Camera login password, used with ip, or stored alongside an explicit streamUrl."),
              engineProfileId: z.number().optional().describe("Engine profile to assign. Defaults to the first one found if omitted."),
              resolution: z.string().optional().describe('Resolution as "WIDTHxHEIGHT", e.g. "1920x1080". Default 1920x1080.'),
              roiContour: z.any().optional().describe("Custom ROI polygon. Defaults to a full-frame rectangle matching resolution."),
              latitude: z.number().optional(),
              longitude: z.number().optional().describe("latitude+longitude together set locationType to GPS_MAP; omit both for NONE."),
              protocol: z.enum(["Both", "TCP", "UDP"]).optional().describe("Default Both."),
              doRecording: z.boolean().optional().describe("Default false."),
              cameraGroupIds: z.array(z.string()).optional(),
              description: z.string().optional(),
            })
          )
          .min(1)
          .describe("Cameras to add."),
        ainvrId: z.number().optional().describe("Which ainvr/site to add cameras under. Defaults to the first ainvr found if omitted."),
        activate: z.boolean().optional().describe("Whether to start each camera's connection after creation (default true)."),
      },
      outputSchema: addCameraOutput,
    },
    async ({ cameras, ainvrId, activate }) => {
      try {
        let resolvedAinvrId = ainvrId;
        if (resolvedAinvrId === undefined) {
          const ainvrs = await executeOperation(tokenManager, listAinvrsOp, { query: { size: 1 } });
          const first = (ainvrs.body as any)?.content?.[0];
          if (!first) {
            return { content: [{ type: "text", text: "Could not find any ainvr/site to add cameras under, and none was specified." }], isError: true };
          }
          resolvedAinvrId = first.ainvrId;
        }

        let defaultEngineProfileId: number | undefined;
        if (cameras.some((c) => c.engineProfileId === undefined)) {
          const profiles = await executeOperation(tokenManager, listEngineProfilesOp, { query: { size: 1 } });
          const first = (profiles.body as any)?.content?.[0];
          if (!first) {
            return { content: [{ type: "text", text: "Could not find any engine profile to default to, and some cameras didn't specify one." }], isError: true };
          }
          defaultEngineProfileId = first.engineProfileId;
        }

        const results: Record<string, unknown>[] = [];
        let anyFailed = false;

        for (const spec of cameras as CameraSpec[]) {
          let built;
          try {
            built = buildCameraBody(spec, defaultEngineProfileId);
          } catch (err) {
            anyFailed = true;
            results.push({ name: spec.name, outcome: "invalid_spec", error: err instanceof Error ? err.message : String(err) });
            continue;
          }

          const createResult = await executeOperation(tokenManager, createCameraOp, {
            query: { ainvrId: resolvedAinvrId },
            body: built.body,
          });

          let cameraId: number | undefined;
          let outcome: string;
          let note: string | undefined;

          if (createResult.status < 400) {
            cameraId = (createResult.body as any)?.cameraId;
            outcome = "created";
          } else {
            const check = await executeOperation(tokenManager, listCamerasOp, { query: { name: spec.name } });
            const found = (check.body as any)?.content?.[0];
            if (found) {
              cameraId = found.cameraId;
              outcome = "created_despite_error";
              note = `The create call returned an error (status ${createResult.status}), but a camera record was found anyway — a known server quirk. Treating it as created.`;
            } else {
              anyFailed = true;
              results.push({ name: spec.name, outcome: "failed", status: createResult.status, error: createResult.body, warnings: built.warnings });
              continue;
            }
          }

          const result: Record<string, unknown> = { name: spec.name, outcome, cameraId, warnings: built.warnings };
          if (note) result.note = note;

          if (activate !== false && cameraId !== undefined) {
            const activateResult = await executeOperation(tokenManager, activateCameraOp, {
              path: { cameraId },
              query: { activate: true },
            });
            if (activateResult.status < 400) {
              const job = activateResult.body as any;
              result.activation = { jobId: job?.jobId, resourceId: job?.resourceId, status: job?.status };
            } else {
              result.activation = { error: `Activation failed (status ${activateResult.status}): ${JSON.stringify(activateResult.body)}` };
            }
          }

          results.push(result);
        }

        const payload = { ainvrId: resolvedAinvrId, results };
        return {
          content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
          structuredContent: payload,
          isError: anyFailed,
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error adding cameras: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    }
  );
}

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(
  `[ivedaai-mcp-server] running, ${seenNames.size} resource tools + ivedaai_get_schema + ivedaai_alert_integration + ivedaai_add_camera registered`
);
