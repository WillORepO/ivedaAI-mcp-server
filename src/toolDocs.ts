import { capabilityNote } from "./capabilityNotes.js";
import type { Operation, ParamDef, TagGroup } from "./swagger.js";
import { resolveSchema } from "./swagger.js";
import { lossyUpdateWarning } from "./partialUpdate.js";
import { computeRoundTripGaps, roundTripWarning, type RoundTripGap } from "./roundTrip.js";

const MAX_PROPS = 40;
const MAX_ENUM = 8;

/**
 * springdoc's placeholder for a schema it could not name.
 *
 * The 10.0 document ships two of these, both `java.time.LocalDate`:
 * `AccountRequest.expirationDate` and `FaceTargetRequest.expiredDate`. They are
 * `$ref`s that resolve to nothing, so without handling they were published into
 * the tool descriptions verbatim — 56 characters of
 * `Error-ModelName{namespace='java.time', name='LocalDate'}` offered to a caller
 * as if it were a type they could send.
 */
const UNRESOLVED_REF = /^Error-ModelName\{namespace='([^']*)',\s*name='([^']*)'\}$/;

/**
 * Wire shapes for Java types the spec names but does not define.
 *
 * Measured, not assumed: `GET /api/accounts` returns `expirationDate` as
 * `"2026-07-30"` on this deployment, so `LocalDate` is a plain `yyyy-MM-dd`
 * date. That is a *read* observation — the request side is untested, and this
 * API has form for accepting a different shape than it returns, so a caller who
 * gets a 400 here should suspect that first.
 */
const UNRESOLVED_TYPE_SHAPES: Record<string, string> = {
  LocalDate: "string(yyyy-MM-dd)",
};

function refName(ref: string): string {
  const unresolved = UNRESOLVED_REF.exec(ref);
  if (unresolved) {
    const name = unresolved[2];
    return UNRESOLVED_TYPE_SHAPES[name] ?? `${name}(undefined in spec)`;
  }
  return ref.split("/").pop() ?? ref;
}

function describePropType(spec: any, propSchema: any): string {
  if (!propSchema) return "any";
  if (propSchema.$ref) return refName(propSchema.$ref);
  if (propSchema.type === "array") {
    const items = propSchema.items;
    if (items?.$ref) return `${refName(items.$ref)}[]`;
    if (items?.enum) return `enum[](${items.enum.slice(0, MAX_ENUM).join("|")})`;
    return `${items?.type ?? "any"}[]`;
  }
  if (propSchema.enum) return `enum(${propSchema.enum.slice(0, MAX_ENUM).join("|")})`;
  return propSchema.type ?? "any";
}

function describeObjectProps(spec: any, schema: any): string {
  const required = new Set<string>(schema.required ?? []);
  const props: Record<string, any> = schema.properties ?? {};
  const entries = Object.entries(props);
  const parts = entries
    .slice(0, MAX_PROPS)
    .map(([name, propSchema]) => `${name}${required.has(name) ? "*" : "?"}:${describePropType(spec, propSchema)}`);
  if (entries.length > MAX_PROPS) parts.push(`...(+${entries.length - MAX_PROPS} more, use ivedaai_get_schema)`);
  return `{ ${parts.join(", ")} }`;
}

/** Renders a compact, one-level-deep description of a body schema for tool docs. */
export function describeBodySchema(spec: any, schemaRef: any): string {
  const resolved = resolveSchema(spec, schemaRef, 1);
  if (!resolved) return "(unknown schema)";
  if (resolved.$ref) return refName(resolved.$ref);
  if (resolved.type === "array") {
    const itemsResolved = resolveSchema(spec, resolved.items, 1);
    if (itemsResolved?.$ref) return `array of ${refName(itemsResolved.$ref)}`;
    const inner =
      itemsResolved?.type === "object" || itemsResolved?.properties
        ? describeObjectProps(spec, itemsResolved)
        : itemsResolved?.type ?? "any";
    return `array of ${inner}`;
  }
  if (resolved.type === "object" || resolved.properties) {
    return describeObjectProps(spec, resolved);
  }
  return resolved.type ?? "object";
}

/**
 * The body line as it appears in a *tool description*, where every character is
 * paid by every client on connect whether or not the tool is ever called.
 *
 * `describeBodySchema` enumerates a schema one level deep. That is right for the
 * generated markdown docs, but in the tool descriptions it is the single largest
 * line item: 92 body schemas cost 20,179 of the 81,844 characters, and because
 * several operations share a definition the same field list is printed more than
 * once — `AccountRequest` three times, `CameraRequest` five.
 *
 * Every one of those bodies is backed by a *named* definition, so the full field
 * list is already retrievable on demand through `ivedaai_get_schema`. What a
 * caller cannot postpone is knowing which fields are mandatory — guessing that
 * wrong is a failed call — so the required names stay inline and the optional
 * ones become a lookup.
 *
 * Returns whichever rendering is shorter. `ApiKeyRequest` is 35 characters in
 * full, less than a pointer to itself would be, so small schemas keep their
 * complete field list and only the expensive ones are traded away.
 */
function describeBodyForTool(spec: any, schema: any): string {
  const full = describeBodySchema(spec, schema);
  const isArray = Boolean(schema?.items?.$ref);
  const ref: string | undefined = schema?.$ref ?? schema?.items?.$ref;
  if (!ref) return full;

  const name = refName(ref);
  // Already rendered as nothing but the name — there is nothing left to trade.
  if (full === name || full === `array of ${name}`) return full;

  const resolved = resolveSchema(spec, isArray ? schema.items : schema, 1);
  const required: string[] = resolved?.required ?? [];
  const reqPart = required.length ? ` — required: ${required.join(", ")};` : " —";
  const compact = `${isArray ? "array of " : ""}${name}${reqPart} ivedaai_get_schema for all fields`;
  return compact.length < full.length ? compact : full;
}

/**
 * The date pattern a parameter's description names, when it names one.
 *
 * `format: date-time` means RFC 3339 — `2026-07-30T12:00:00Z`. This API declares
 * that on 32 query parameters and accepts it on none of them: `GET
 * /api/face/matches` and `GET /api/identity-recognition` both answer 400 to an
 * ISO 8601 value and 200 to `yyyy-MM-dd HH:mm:ss`, measured against a live
 * deployment on two unrelated endpoints, one of them added in 10.0.
 *
 * The spec is not silent about this — every one of those 32 parameters names the
 * real pattern in its `description`, and the tool descriptions were simply
 * dropping descriptions on the floor. So this is derived rather than tabled:
 * there is nothing to maintain and nothing to go stale, and a parameter that
 * stops declaring a pattern stops claiming one.
 */
function declaredDatePattern(p: ParamDef): string | undefined {
  if (p.format !== "date-time") return undefined;
  return /yyyy[-/][^,;.]*/i.exec(p.description ?? "")?.[0]?.trim();
}

function formatNonBodyParam(p: ParamDef): string {
  let typeStr = p.type ?? "any";
  if (p.type === "array") {
    const itemType = p.items?.type ?? "string";
    typeStr = `${itemType}[]`;
  }
  const enumVals = p.enum;
  const extra = enumVals && enumVals.length > 0 ? ` enum:${enumVals.slice(0, MAX_ENUM).join("|")}` : "";
  // Rendered in place of the type rather than beside it: `start*:string` told a
  // caller nothing they did not already assume, and the pattern is the only part
  // of this parameter that is hard to guess and easy to get wrong.
  const pattern = declaredDatePattern(p);
  const req = p.required ? "*" : "?";
  return `${p.name}${req}:${pattern ? `${typeStr}(${pattern})` : typeStr}${extra}`;
}

function describeOperation(spec: any, op: Operation, gaps: Record<string, RoundTripGap>): string {
  const lines: string[] = [];
  const title = op.summary ? `${op.id} — ${op.summary}` : op.id;
  lines.push(title);

  const pathParams = op.parameters.filter((p) => p.in === "path");
  const queryParams = op.parameters.filter((p) => p.in === "query");
  const bodyParam = op.parameters.find((p) => p.in === "body");
  const fileParams = op.parameters.filter((p) => p.in === "formData" && p.type === "file");
  const formDataParams = op.parameters.filter((p) => p.in === "formData" && p.type !== "file");

  if (pathParams.length) lines.push(`  path: ${pathParams.map(formatNonBodyParam).join(", ")}`);
  if (queryParams.length) lines.push(`  query: ${queryParams.map(formatNonBodyParam).join(", ")}`);
  if (bodyParam) lines.push(`  body: ${describeBodyForTool(spec, bodyParam.schema)}`);
  if (fileParams.length) {
    lines.push(`  file: provide as {path, filename?, contentType?} — local file to upload as "${fileParams[0].name}"`);
  }
  if (formDataParams.length) {
    lines.push(`  form fields (pass via body): ${formDataParams.map(formatNonBodyParam).join(", ")}`);
  }

  // What this operation is for, when its summary does not say. Placed above the
  // guards because it answers an earlier question: those two correct a call the
  // caller is already making, this one is why the caller would pick it at all.
  const capability = capabilityNote(op.id);
  if (capability) lines.push(`  ${capability}`);

  // Stated in the docs as well as enforced at call time: a caller that knows
  // beforehand can send the right body instead of learning from a refusal.
  const warning = lossyUpdateWarning(op.id);
  if (warning) lines.push(`  ${warning}`);

  // Fields this update accepts that no read returns. Unlike the lossy-update
  // guard this cannot be enforced at call time — there is no corrected call to
  // demand — so stating it up front is the only place it can be acted on.
  const roundTrip = roundTripWarning(gaps[op.id], op.id);
  if (roundTrip) lines.push(`  ${roundTrip}`);

  return lines.join("\n");
}

/**
 * How to drive this server, stated once.
 *
 * Passed as MCP `instructions` at initialize, so it costs one copy instead of
 * the 63 that saying it per generated tool costs. Nothing here is load-bearing on its own:
 * see the note on `describeTag`'s header for why a client that ignores
 * `instructions` still has what it needs.
 */
export const SERVER_INSTRUCTIONS =
  `This server exposes the IvedaAI REST API as one tool per resource. Each tool takes an "operation" id ` +
  `chosen from the list in that tool's description, plus "path", "query", "body" and "file" as the chosen ` +
  `operation requires.\n\n` +
  `Every call returns JSON {url, method, status, statusText, headers, body}. "status" is the HTTP status ` +
  `code — check it rather than assuming success. A 4xx or 5xx retains that envelope and is marked as a tool execution error, ` +
  `so its status and response body remain available. "truncated" or "timedOut" appear when a large or streaming response was cut off.\n\n` +
  `Request bodies are named by their schema definition rather than spelled out in full. Call ` +
  `ivedaai_get_schema with that name for the complete field list.\n\n` +
  `List operations return one page, not the whole collection. Where they do, a "pagination" object ` +
  `sits beside "body" giving {total, count, page, size, hasMore, nextPage} — "total" is the size of ` +
  `the collection and "count" is how much of it this response holds, so they routinely differ. When ` +
  `"hasMore" is true, follow "pagination.note". When the response identifies a next page, the note ` +
  `names its operation-specific query or body arguments; otherwise it warns not to invent one. Do not ` +
  `report the page you have as though it were the whole set.`;

/**
 * Why the write operations are missing, for a server running read-only.
 *
 * Appended to `SERVER_INSTRUCTIONS` and, in short form, to every tool
 * description. Both, because the two say different things to a model that has
 * just been refused.
 *
 * The refusal a read-only server actually produces is not
 * `refusalReason`'s — that text is unreachable for generated tools, because
 * `allowedOperations` strips the writes from the `operation` enum and the SDK
 * rejects the call during schema validation, before any handler runs. What
 * reaches the model is a bare `invalid_value` listing the GETs that remain.
 *
 * That error is accurate and useless. It says the value is not in the enum; it
 * does not say the enum was filtered, so the only available reading is that the
 * API has no such operation. A model told that `POST /api/cameras` is not a
 * valid operation for `ivedaai_camera` will report that IvedaAI cannot create
 * cameras — a confident, wrong, and entirely reasonable inference from what it
 * was shown.
 *
 * Restoring the good message by keeping writes in the enum and refusing in the
 * handler is the wrong trade: it re-advertises calls that can only fail, which
 * costs context on every tool and invites the retry loop the filter exists to
 * prevent. Naming the cause where the model is already looking is cheaper.
 */
export const READ_ONLY_NOTE =
  `This server is running read-only (IVEDAAI_READ_ONLY=true), so only GET operations are listed. The ` +
  `write operations exist in the IvedaAI API but are withheld here: a call naming one is rejected as an ` +
  `invalid "operation" value. Treat that rejection as this server's policy, not as evidence the API ` +
  `lacks the operation, and report it that way rather than concluding the capability is missing.`;

/**
 * The same point, compressed, for the per-tool header.
 *
 * Kept short because it is paid once per generated tool — though only in read-only mode, where
 * withholding the writes has already saved far more than this costs.
 */
export const READ_ONLY_TOOL_NOTE =
  `Read-only mode: only GET operations are listed. Writes are withheld by this server, not absent from ` +
  `the API.`;

/**
 * Builds the full tool description text for a tag, enumerating every operation
 * within it.
 *
 * The header is deliberately thin. It used to restate, on every generated tool, both how
 * to call the tool and what it returns — 326 characters each, 20,764 in total,
 * the largest line item in the budget `npm run measure` reports.
 *
 * Most of that was already being said elsewhere. The `inputSchema` registered in
 * `index.ts` declares `operation` (as an enum of this tag's ids), `path`,
 * `query`, `body` and `file`, each with its own `describe()` text, and a client
 * cannot drop that — it is how the tool gets called. So "choose an operation,
 * then supply path/query/body/file" was duplicating the schema.
 *
 * What no schema carries is the response contract, so the two parts of it a
 * caller cannot infer stay here: that `status` is an HTTP code returned as
 * content rather than as a tool error, and that `truncated`/`timedOut` mean a
 * cut-off response. The fuller version lives in `SERVER_INSTRUCTIONS`.
 *
 * That split is the point: `instructions` is a nice-to-have rather than a
 * dependency, so this does not quietly break on a client that ignores it.
 */
export function describeTag(spec: any, group: TagGroup, gaps = computeRoundTripGaps(spec)): string {
  const header =
    `IvedaAI API — ${group.tag} operations. Response JSON: "status" is the HTTP status code; ` +
    `"truncated"/"timedOut" flag a cut-off response.\n`;
  const body = group.operations.map((op) => describeOperation(spec, op, gaps)).join("\n\n");
  return header + "\n" + body;
}
