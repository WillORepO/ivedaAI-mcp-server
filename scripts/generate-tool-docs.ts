/**
 * Generates docs/TOOLS.md — a complete reference of every MCP tool and the API
 * operations it dispatches — from the bundled swagger spec.
 *
 * Run with: npm run docs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadSwagger, tagToToolName, type Operation, type ParamDef } from "../src/swagger.js";
import { describeBodySchema } from "../src/toolDocs.js";
import { describeTriggerTypes } from "../src/alertTrigger.js";
import { lossyUpdateWarning } from "../src/partialUpdate.js";
import { computeRoundTripGaps, roundTripWarning } from "../src/roundTrip.js";
import { capabilityNote } from "../src/capabilityNotes.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ctx = loadSwagger();
const roundTripGaps = computeRoundTripGaps(ctx.spec);

function paramRow(p: ParamDef): string {
  let type = p.type ?? "object";
  if (p.type === "array") type = `${p.items?.type ?? "string"}[]`;
  const enumVals = p.enum ? ` — one of: ${p.enum.join(", ")}` : "";
  const desc = p.description ? ` ${p.description}.` : "";
  return `| \`${p.name}\` | ${p.in} | ${p.required ? "**yes**" : "no"} | ${type} |${desc}${enumVals} |`;
}

function operationSection(op: Operation): string {
  const lines: string[] = [];
  lines.push(`#### \`${op.id}\`${op.summary ? ` — ${op.summary}` : ""}`);
  lines.push("");

  const tableParams = op.parameters.filter((p) => p.in === "path" || p.in === "query");
  const bodyParam = op.parameters.find((p) => p.in === "body");
  const fileParam = op.parameters.find((p) => p.in === "formData" && p.type === "file");

  if (tableParams.length > 0) {
    lines.push("| Parameter | In | Required | Type | Notes |");
    lines.push("|---|---|---|---|---|");
    for (const p of tableParams) lines.push(paramRow(p));
    lines.push("");
  }
  if (bodyParam) {
    lines.push(`**Body:** \`${describeBodySchema(ctx.spec, bodyParam.schema)}\``);
    lines.push("");
  }
  if (fileParam) {
    lines.push(
      `**File upload:** pass \`file: { path, filename?, contentType? }\`` +
        (fileParam.required ? " (required)." : " (optional).")
    );
    lines.push("");
  }
  if (tableParams.length === 0 && !bodyParam && !fileParam) {
    lines.push("_No parameters._");
    lines.push("");
  }

  // The same cautions the live tool descriptions carry. This reference is what
  // a person reads before wiring anything up, so omitting them here left the
  // human-facing docs quieter about data loss than the model-facing ones.
  const warnings = ctx.useBundledFindings
    ? [capabilityNote(op.id), lossyUpdateWarning(op.id), roundTripWarning(roundTripGaps[op.id], op.id)]
    : [];
  for (const warning of warnings) {
    if (warning) {
      lines.push(`> ⚠️ ${warning}`);
      lines.push("");
    }
  }
  return lines.join("\n");
}

const out: string[] = [];
out.push("# Tool reference");
out.push("");
out.push(
  "> Auto-generated from `resources/openapi.json` by `npm run docs` — do not edit by hand. " +
    "See [USAGE.md](USAGE.md) for how to call these tools."
);
out.push("");
out.push(`This server exposes **${ctx.tags.length} resource tools** plus \`ivedaai_get_schema\`, ` +
  "`ivedaai_alert_integration`, and `ivedaai_add_camera`. Each resource tool dispatches to one of its listed " +
  "operations via the `operation` argument.");
out.push("");

// Index table
out.push("## Index");
out.push("");
out.push("| Tool | Operations | Read-only |");
out.push("|---|---|---|");
for (const group of ctx.tags) {
  const readOnly = group.operations.every((o) => o.method === "GET") ? "yes" : "no";
  out.push(`| [\`${tagToToolName(group.tag)}\`](#${tagToToolName(group.tag)}) | ${group.operations.length} | ${readOnly} |`);
}
out.push("");

for (const group of ctx.tags) {
  const toolName = tagToToolName(group.tag);
  out.push(`## ${toolName}`);
  out.push("");
  for (const op of group.operations) {
    out.push(operationSection(op));
  }
}

out.push("## ivedaai_get_schema");
out.push("");
out.push(
  "Looks up the full JSON schema for any named definition from the spec (e.g. `CameraRequest`). " +
    "Call with no arguments to list all definition names. Use it when a body summary above is " +
    "truncated or references a nested type like `Contour` or `Schedule`.\n\n" +
    "Answers `{name, schema}` for a lookup and `{names}` for the listing — both wrapped rather " +
    "than bare, because MCP requires `structuredContent` to be an object."
);
out.push("");

out.push("## ivedaai_alert_integration");
out.push("");
out.push(
  "A guided tool for configuring and testing `AlertRule.trigger` — the mechanism that routes alerts to external " +
    "systems (generic HTTP webhooks, 13 named VMS/PSIM platforms, email, Immix, mobile push). Built from live " +
    "testing findings, not the spec alone: several fields the spec marks optional turn out to be required in " +
    "practice, `mail`/`immix` can't be live-tested, and VMS connection-failure timing is unpredictable (under a " +
    "second to ~24s observed against the same unreachable address)."
);
out.push("");
out.push("Actions: `list_types` (no API call), `test` (calls `POST /api/alertTriggers`), `apply` (attaches the " +
  "trigger to an existing alert rule via `PATCH /api/alertRules/{alertRuleId}`).");
out.push("");
out.push("`apply` reads the rule first and re-sends everything the read exposes alongside the new trigger — " +
  "`name` (returned as `alertName`), `alertType`, `description`, `isEnabled`, plus `weekdays`/`enableForever` " +
  "from `schedule` and `roiIds`/`cameraIds`/`hashtags`/`typeLogic`/`cooldownInterval` parsed out of the " +
  "`condition` JSON string, whichever of those the rule's type stores there. It refuses to " +
  "write if that read fails or comes back without the fields `AlertRuleRequest` marks required. This is " +
  "belt-and-braces rather than damage control: `PATCH /api/alertRules/{alertRuleId}` was live-tested against a " +
  "throwaway rule and **merges** — a partial body left every omitted field intact — so applying a trigger does " +
  "not wipe the rest of the rule. Note that `PUT` on the same path rejects a partial body outright with a 500, " +
  "so the full object is required there.");
out.push("");
out.push("```");
out.push(describeTriggerTypes());
out.push("```");
out.push("");

out.push("## ivedaai_add_camera");
out.push("");
out.push(
  "Adds one or more cameras (e.g. from a list of IPs or RTSP URLs) and starts their connection. Built from live " +
    "testing findings: the raw `CameraRequest` schema's `required` list is misleading (floor-plan fields it lists " +
    "as required are actually waived by `locationType: \"NONE\"`), a schema-valid minimal body still throws a bare " +
    "server-side error unless several other optional-looking fields are also filled (this tool fills them " +
    "automatically), creating the record is not enough for the camera to connect or appear fully provisioned — a " +
    "separate `POST /api/cameras/{id}/jobs?activate=true` step is required and performed automatically — and a " +
    "creation error can still partially create the camera server-side (detected by an exact-name lookup and " +
    "reported as `created_despite_error` rather than a false `failed`)."
);
out.push("");
out.push(
  "Only `name` plus `streamUrl` or `ip` are required per camera; `engineProfileId` and `roiContour` default " +
    "automatically. Activation succeeding is not proof the stream actually connected — check back via " +
    "`ivedaai_job` (`GET /api/jobs/{jobId}`) or `ivedaai_camera` (`GET /api/cameras/{cameraId}`, look for a " +
    "populated `status` field)."
);
out.push("");

const docsDir = join(__dirname, "..", "docs");
mkdirSync(docsDir, { recursive: true });
const target = join(docsDir, "TOOLS.md");
writeFileSync(target, out.join("\n"));
console.log(`wrote ${target} (${out.length} sections)`);
