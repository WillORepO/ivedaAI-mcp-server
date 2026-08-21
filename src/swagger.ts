import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * A parsed JSON document, and the narrowing that goes with it.
 *
 * The OpenAPI document really is untyped at the boundary — it is whatever was
 * in a file — and this module used to say so with `any`. That is honest about
 * the input and dishonest about everything after it: `spec.paths.foo.bar`
 * type-checks against `any` no matter how wrong it is, so a malformed document
 * produced an undefined at some unrelated call site rather than an error where
 * it was read.
 *
 * `JsonValue` says the same thing while keeping the compiler switched on, and
 * `asObject` is the one narrowing this file needs: everything here walks a tree
 * of maps, so "is this a map, or was the document not shaped the way I assumed"
 * is the only question being asked.
 */
export type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;
export interface JsonObject {
  [key: string]: JsonValue | undefined;
}

/**
 * The JSON Schema keywords this codebase actually reads.
 *
 * A named type rather than `unknown` plus a narrowing at every access, because
 * these fields are read constantly and the shape is genuinely known — it is
 * JSON Schema, not an open-world blob. The one honest cast is at the boundary
 * where a `JsonValue` from the document becomes a schema; everything downstream
 * is checked.
 *
 * Deliberately partial: adding a keyword here means something reads it.
 */
export interface SchemaNode {
  $ref?: string;
  type?: string;
  format?: string;
  description?: string;
  enum?: JsonValue[];
  items?: SchemaNode;
  properties?: Record<string, SchemaNode>;
  required?: string[];
  additionalProperties?: SchemaNode | boolean;
  default?: JsonValue;
}

/** A raw OpenAPI 3 parameter object, as far as this loader reads one. */
export interface RawParameter {
  name?: string;
  in?: string;
  required?: boolean;
  description?: string;
  style?: string;
  explode?: boolean;
  schema?: SchemaNode;
}

/** A document value read as a parameter. */
export function asParameter(value: unknown): RawParameter | undefined {
  return asObject(value) as RawParameter | undefined;
}

/** A document value read as a schema. The single cast, named so it is greppable. */
export function asSchema(value: unknown): SchemaNode | undefined {
  return asObject(value) as SchemaNode | undefined;
}

/** The value as a map, or undefined when it is anything else. */
export function asObject(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonObject) : undefined;
}

/** The map's entries, or none when the value is not a map. */
export function objectEntries(value: unknown): Array<[string, JsonValue]> {
  const o = asObject(value);
  return o ? (Object.entries(o).filter(([, v]) => v !== undefined) as Array<[string, JsonValue]>) : [];
}

export type ParamLocation = "path" | "query" | "header" | "body" | "formData";

export interface ParamDef {
  name: string;
  in: ParamLocation;
  required: boolean;
  type?: string;
  format?: string;
  description?: string;
  enum?: string[];
  items?: SchemaNode;
  collectionFormat?: string;
  schema?: SchemaNode;
  default?: unknown;
}

export interface Operation {
  /** Stable identifier used as the enum value clients select, e.g. "GET /api/cameras" */
  id: string;
  method: string;
  path: string;
  operationId?: string;
  summary?: string;
  description?: string;
  tag: string;
  parameters: ParamDef[];
  consumes?: string[];
  produces?: string[];
}

export interface TagGroup {
  tag: string;
  operations: Operation[];
}

export interface SwaggerContext {
  spec: JsonObject;
  /** Whether deployment findings measured against the bundled spec may be applied. */
  useBundledFindings: boolean;
  basePath: string;
  host: string;
  schemes: string[];
  tokenUrl: string;
  tags: TagGroup[];
}

const HTTP_METHODS = ["get", "post", "put", "delete", "patch", "options", "head"];

/**
 * Parameter names where the generated document disagrees with a live 10.0 server.
 *
 * Keep this evidence-backed: accepting a name the handler ignores is worse than
 * exposing no pagination control because it makes a repeated first page look
 * like a valid continuation. On 2026-08-16, GET /api/lineSets with the declared
 * pageNumber/pageSize pair returned the same default page (14 records, page 0,
 * size 20) for values 0 and 1. The undeclared page/size pair returned one record
 * at pages 0 and 1, with distinct record fingerprints and matching page metadata.
 */
const CONFIRMED_QUERY_PARAMETER_NAMES: Record<string, Record<string, string>> = {
  "GET /api/lineSets": { pageNumber: "page", pageSize: "size" },
  // Same shape, same measurement, 2026-08-17. Undeclared `size=1` produced
  // `size: 1`, and `page=1&size=1` produced `number: 1`; the *declared*
  // `pageSize=1` left the endpoint's own default of 100 in place. Measured with
  // a direct request because this server refuses query parameters an operation
  // does not declare, so the working names were unreachable through it.
  //
  // `POST /api/scene-objects/search` has the same flattening and is deliberately
  // absent: it requires a `descriptors` list this session had no way to supply,
  // so nothing about it was measured, and a rename is a claim that a name works.
  "GET /api/scene-objects/search": { pageNumber: "page", pageSize: "size" },
};

/**
 * Paging parameters springdoc publishes and Spring does not bind.
 *
 * Flattening a `Pageable` emits ten query parameters; Spring binds three.
 * Measured against a 10.0 deployment on 2026-08-17, sending each one alone to
 * `GET /api/engine-objects` (20 records, default page 20) and reading back the
 * page state the response reports:
 *
 *   | sent                | applied                                    |
 *   | page=2&size=3       | size 3, number 2, offset 6      — bound    |
 *   | size=3              | size 3                          — bound    |
 *   | sort=…,desc / ,asc  | first record 20 / 1             — bound    |
 *   | pageSize=3          | size 20, unchanged              — INERT    |
 *   | pageNumber=2        | number 0, unchanged             — INERT    |
 *   | offset=10           | offset 0, unchanged             — INERT    |
 *   | paged=false         | paged true, unchanged           — INERT    |
 *   | unpaged=true        | unpaged false, unchanged        — INERT    |
 *   | sort.sorted=false   | unchanged                       — INERT    |
 *   | sort.unsorted=true  | unchanged                       — INERT    |
 *
 * Confirmed on the other shape too: `GET /api/scene-objects/search`, which
 * declares no `page`/`size` at all, still ignored `pageSize`. And where the two
 * disagree the bound one wins — `size=3&pageSize=15` returned 3.
 *
 * Publishing them is worse than saying nothing, which is why they are removed
 * rather than merely documented. `request.ts` forwards any declared parameter,
 * so `pageSize: 10` reaches the deployment, is ignored, and returns the default
 * page — a wrong answer that looks like a right one. Dropped, the same call is
 * refused by `validateArgs` with the valid names listed, which is the failure a
 * caller can act on.
 *
 * Keyed on declaring both `paged` and `unpaged`, springdoc's unmistakable
 * signature, so a genuine `offset` on some future endpoint is untouched. Applied
 * after the renames above, so a name corrected into `page`/`size` survives.
 */
const INERT_PAGING_PARAMETERS = new Set([
  "offset",
  "pageNumber",
  "pageSize",
  "paged",
  "unpaged",
  "sort.sorted",
  "sort.unsorted",
]);

/**
 * Required request fields the generated document understates.
 *
 * Same bar as `CONFIRMED_QUERY_PARAMETER_NAMES`: measured against a live 10.0
 * server, never inferred. Understating `required` is worse than saying nothing,
 * because `required` is the one part of a request schema a caller trusts without
 * testing — it is what a code generator emits as mandatory arguments, and what
 * this server prints to tell a model the minimum viable body.
 *
 * `CameraRequest` declares `required: ["cameraType"]`. A body carrying exactly
 * that was refused on 2026-08-17:
 *
 *     400 MethodArgumentNotValidException
 *     [engineProfileId (null) must not be null, roiContour (null) must not be null,
 *      doRecording (null) must not be null, protocol (null) must not be null]
 *
 * Nothing was persisted — the camera count was 71 before and after — so the
 * failure is validation rather than a partial create.
 *
 * Corroborated by the archived 9.3 document, which marked all five of these
 * required. 9.3 additionally required `floorPlanAngle`, `floorPlanId`,
 * `floorPlanX`, `floorPlanY`, `latitude` and `longitude`; the measured body
 * omitted all six and the server did not complain, so they are genuinely
 * optional now and are deliberately absent here.
 *
 * `name` is the one 9.3 required that remains untested: the measured body
 * supplied it, so its omission was never exercised. A later attempt to close
 * that gap could not run — the deployment's licence went invalid and the whole
 * API began answering 403. Left out rather than guessed at; a required field
 * listed on suspicion would cost a caller a mandatory argument they do not need.
 *
 * Unioned with whatever the document declares rather than replacing it, so a
 * future spec that adds a requirement keeps it.
 */
export const CONFIRMED_REQUIRED_FIELDS: Record<string, string[]> = {
  CameraRequest: ["cameraType", "engineProfileId", "roiContour", "doRecording", "protocol"],
};

/**
 * Applied to the loaded document itself, so every consumer sees one answer:
 * the tool descriptions, `ivedaai_get_schema`, and the generated `docs/TOOLS.md`
 * would otherwise be free to disagree about the same schema.
 */
function correctSchemaRequirements(spec: JsonObject, useBundledFindings: boolean): void {
  if (!useBundledFindings) return;
  const schemas = asObject(asObject(spec.components)?.schemas);
  if (!schemas) return;
  for (const [name, confirmed] of Object.entries(CONFIRMED_REQUIRED_FIELDS)) {
    const schema = asSchema(schemas[name]);
    if (!schema) continue;
    const declared: string[] = Array.isArray(schema.required) ? schema.required : [];
    const properties = schema.properties ?? {};
    // Only fields the schema actually defines: naming a required field that does
    // not exist would be a worse error than the one being corrected.
    const merged = [...new Set([...declared, ...confirmed.filter((f) => f in properties)])];
    schema.required = merged.sort();
  }
}

function correctedParameters(id: string, parameters: ParamDef[], useBundledFindings: boolean): ParamDef[] {
  if (!useBundledFindings) return parameters;

  const names = CONFIRMED_QUERY_PARAMETER_NAMES[id];
  const renamed = names
    ? parameters.map((parameter) =>
        parameter.in === "query" && names[parameter.name]
          ? { ...parameter, name: names[parameter.name] }
          : parameter
      )
    : parameters;

  const queryNames = new Set(renamed.filter((p) => p.in === "query").map((p) => p.name));
  if (!(queryNames.has("paged") && queryNames.has("unpaged"))) return renamed;
  return renamed.filter((p) => !(p.in === "query" && INERT_PAGING_PARAMETERS.has(p.name)));
}

function loadRawSpec(): JsonObject {
  const path = process.env.IVEDAAI_SWAGGER_PATH ?? join(__dirname, "..", "resources", "openapi.json");
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw);
}

/**
 * The path prefix every operation sits under, and where it lives in each format.
 *
 * Swagger 2.0 kept `/ainvr` in a top-level `basePath` and left it off the paths.
 * OpenAPI 3 has no `basePath`, so 10.0 folds it into all 190 paths instead. The
 * effective URL never changed.
 *
 * This strips it back out so operation ids stay `METHOD /api/...`. That is not
 * cosmetic: those ids are the enum values clients select, and they key every
 * table of findings in this repo — `CONFIRMED_UPDATE_SEMANTICS`,
 * `LOSSY_UPDATE_OPS`, `CRUD_PLANS`. Leaving the prefix on would have silently
 * invalidated all of them at once, and the tables that suppress warnings would
 * have stopped matching without failing.
 */
const V3_BASE_PATH = "/ainvr";

/**
 * Flattens an OpenAPI 3 parameter into the flat shape `ParamDef` describes.
 *
 * 2.0 put `type`, `format`, `enum` and `items` directly on the parameter; 3.0
 * moves them under `schema`. Everything downstream — URL building, argument
 * validation, the generated tool descriptions — reads the flat shape, so this is
 * where the two formats are reconciled rather than at each of those call sites.
 */
function flattenV3Parameter(raw: JsonValue | undefined): ParamDef {
  const p = asParameter(raw) ?? {};
  const schema: SchemaNode = p.schema ?? {};
  return {
    name: p.name ?? "",
    in: (p.in ?? "query") as ParamLocation,
    required: !!p.required,
    type: schema.type,
    format: schema.format,
    description: p.description,
    enum: (schema.enum ?? schema.items?.enum)?.map(String),
    items: schema.items,
    // 3.0 replaced `collectionFormat` with `style`/`explode`. For `style: form`,
    // `explode: true` repeats the key — which is exactly what 2.0 called `multi`,
    // and what 9.3 declared for these same parameters. `explode: false` joins
    // with commas, 2.0's `csv`.
    //
    // Worth stating because 10.0 also stopped calling them arrays: `cameraIds`
    // is now `type: integer` with `explode: true` and a description reading
    // "seperated camera ids with comma". The declaration contradicts itself, so
    // the tie is broken by what was measured — repeated keys are what 107 of 119
    // live GETs were validated against on 9.3.
    collectionFormat: p.style === "form" ? (p.explode === false ? "csv" : "multi") : undefined,
    schema: p.schema,
    default: schema.default,
  };
}

/**
 * Turns a 3.0 `requestBody` into the body/formData parameters 2.0 declared inline.
 *
 * Three cases, and they are not interchangeable downstream: a JSON body becomes
 * one `in: "body"` parameter carrying the schema; a multipart body becomes one
 * `in: "formData"` parameter per property, with `format: "binary"` marking the
 * file; a urlencoded body becomes formData parameters too, and is distinguished
 * only by `consumes`, which `request.ts` uses to decide the encoding.
 */
function v3RequestBodyParams(raw: JsonValue | undefined): { params: ParamDef[]; consumes: string[] } {
  const requestBody = asObject(raw);
  const content = asObject(requestBody?.content) ?? {};
  const mediaTypes = Object.keys(content);
  if (!mediaTypes.length) return { params: [], consumes: [] };

  const required = !!requestBody?.required;
  const mediaSchema = (t: string): SchemaNode | undefined => asSchema(asObject(content[t])?.schema);
  const bodyDescription = typeof requestBody?.description === "string" ? requestBody.description : undefined;
  const json = mediaTypes.find((t) => t.includes("json"));
  if (json) {
    return {
      params: [{ name: "body", in: "body", required, schema: mediaSchema(json), description: bodyDescription }],
      consumes: mediaTypes,
    };
  }

  /**
   * urlencoded and multipart are both "form fields", and they are deliberately
   * NOT modelled the same way.
   *
   * 2.0 described the urlencoded operations — `POST /api/face/search`,
   * `/api/scene-objects/search`, `/api/jobs/stream` — as `in: query` parameters
   * that happened to carry `consumes: x-www-form-urlencoded`, and this repo
   * confirmed live that the server rejects them in the URL with a bare 415 and
   * accepts them as a form body. `usesUrlencodedBody` and `buildUrlencodedBody`
   * in request.ts implement exactly that, keyed on `in: "query"`.
   *
   * 10.0 moves those same fields into a `requestBody`. Nothing about the wire
   * changed. Emitting them as `query` therefore preserves both the internal
   * contract and the caller-facing one — a client that passed `{query: {...}}`
   * to these operations on 9.3 keeps working — where emitting `formData` would
   * silently break every such call with "Unknown query parameter".
   *
   * Multipart stays `formData`, because that is what actually distinguishes the
   * file-upload path in request.ts.
   */
  const urlencoded = mediaTypes.find((t) => t.includes("urlencoded"));
  const multipart = mediaTypes.find((t) => t.includes("multipart"));
  const form = multipart ?? urlencoded;
  if (!form) {
    // Some other media type — an image upload, say. Model it as a body so the
    // operation stays callable rather than silently losing its payload.
    return {
      params: [{ name: "body", in: "body", required, schema: mediaSchema(mediaTypes[0]!) }],
      consumes: mediaTypes,
    };
  }

  const schema: SchemaNode = mediaSchema(form) ?? {};
  const requiredFields = new Set<string>(schema.required ?? []);
  const location: ParamLocation = multipart ? "formData" : "query";
  const params: ParamDef[] = Object.entries(schema.properties ?? {}).map(([name, prop]) => ({
    name,
    in: location,
    required: requiredFields.has(name),
    // `format: "binary"` is 3.0's spelling of 2.0's `type: "file"`, and the
    // difference matters: `request.ts` selects the multipart path on `type`.
    type: prop.format === "binary" ? "file" : prop.type,
    format: prop.format === "binary" ? undefined : prop.format,
    description: prop.description,
    enum: prop.enum?.map(String),
    items: prop.items,
  }));
  return { params, consumes: mediaTypes };
}

/**
 * Media types a 3.0 operation can return, from its success responses.
 *
 * The wildcard media type is dropped. This spec uses it as the "unspecified"
 * marker — 236 of the 285 declared response media types are the wildcard,
 * against 6 `image/jpeg` and 3 `image/png` — so treating it as a declaration
 * would say "this endpoint produces anything", which is not information.
 *
 * It also has to be dropped rather than passed through, because `acceptHeaderFor`
 * sends the declared types as the Accept header and falls back to a
 * JSON-preferring wildcard when nothing is declared. That fallback is
 * live-confirmed load-bearing: this API returns JSON error bodies from image
 * endpoints and collapses to an opaque empty 500 when it cannot satisfy Accept.
 * Passing the wildcard through would replace a JSON-preferring header with one
 * that expresses no preference at all, on 236 operations.
 */
function v3Produces(op: JsonObject): string[] {
  const out = new Set<string>();
  for (const [code, response] of objectEntries(op.responses ?? {})) {
    if (!/^2/.test(code)) continue;
    for (const type of Object.keys(asObject(response)?.content ?? {})) {
      if (type !== "*/*") out.add(type);
    }
  }
  return [...out];
}

/**
 * Every named schema in the spec, keyed by name.
 *
 * One accessor rather than four readers of `spec.components.schemas`, because
 * the last upgrade moved this exact node — 2.0 called it `definitions` — and the
 * cost of that move was spread across four files. If 3.1 or a vendor variant
 * moves it again, this is the only line that has to know.
 */
export function schemaDefinitions(spec: JsonObject): Record<string, SchemaNode> {
  return (asObject(asObject(spec.components)?.schemas) ?? {}) as Record<string, SchemaNode>;
}

/** The `$ref` string that addresses a named schema. */
export function schemaRef(name: string): string {
  return `#/components/schemas/${name}`;
}

/**
 * Strips the `/ainvr` prefix from a raw spec path.
 *
 * For code that walks `spec.paths` itself rather than using the parsed model —
 * `computeRoundTripGaps` does, because it needs request and response schemas
 * side by side. Such code builds operation ids by hand, and an id carrying the
 * prefix matches nothing in any table here.
 */
export function stripBasePath(path: string): string {
  return path.startsWith(V3_BASE_PATH) ? path.slice(V3_BASE_PATH.length) : path;
}

/** The JSON request-body schema of a raw OpenAPI 3 operation, if it has one. */
export function requestBodySchema(rawOp: JsonValue | undefined): SchemaNode | undefined {
  const content = asObject(asObject(asObject(rawOp)?.requestBody)?.content) ?? {};
  const json = Object.keys(content).find((t) => t.includes("json"));
  return json ? asSchema(asObject(content[json])?.schema) : undefined;
}

/**
 * The schema of a raw operation's success response.
 *
 * 2.0 put it at `responses.200.schema`; 3.0 nests it under a media type, and
 * this spec commonly uses the wildcard type rather than `application/json` — so
 * keying on the media type by name would find nothing for most operations. Takes
 * the first 2xx with a schema.
 */
export function successResponseSchema(rawOp: JsonValue | undefined): SchemaNode | undefined {
  for (const [code, response] of objectEntries(asObject(rawOp)?.responses)) {
    if (!/^2/.test(code)) continue;
    for (const [, media] of objectEntries(asObject(response)?.content)) {
      const schema = asObject(media)?.schema;
      if (schema) return asSchema(schema);
    }
  }
  return undefined;
}

export function resolveRef(spec: JsonObject, ref: string): SchemaNode | undefined {
  if (!ref.startsWith("#/")) return undefined;
  let node: JsonObject | undefined = spec;
  for (const part of ref.slice(2).split("/")) {
    if (!node) return undefined;
    node = asObject(node[part]);
  }
  return asSchema(node);
}

/** Resolves a schema node one level of $ref (does not recurse into nested $refs beyond `depth`). */
export function resolveSchema(
  spec: JsonObject,
  schema: JsonValue | SchemaNode | undefined,
  depth = 2
): SchemaNode | undefined {
  const node = asSchema(schema);
  if (!node) return undefined;
  if (typeof node.$ref === "string") {
    const resolved = resolveRef(spec, node.$ref);
    if (!resolved) return node;
    return depth > 0 ? resolveSchema(spec, resolved, depth - 1) : resolved;
  }
  return node;
}

function buildOperationId(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

/**
 * Reads the bundled OpenAPI 3 spec into the model the rest of the server uses.
 *
 * Only 3.0 is parsed. IvedaAI 9.3 and its Swagger 2.0 document are being retired,
 * and carrying a second parser for a format no reachable server serves would mean
 * maintaining a path nothing exercises — the failure this repo keeps finding.
 * `scripts/diff-spec.ts` still reads both, because comparing against the archived
 * `resources/swagger-9.3.json` is exactly what it is for.
 */
export function loadSwagger(): SwaggerContext {
  // Live corrections describe the server that produced the bundled document.
  // An operator-supplied spec is authoritative for its own deployment.
  const useBundledFindings = process.env.IVEDAAI_SWAGGER_PATH === undefined;
  const raw = loadRawSpec();
  correctSchemaRequirements(raw, useBundledFindings);
  if (typeof raw.openapi !== "string") {
    throw new Error(
      `expected an OpenAPI 3 document, got ${raw.swagger ? `Swagger ${raw.swagger}` : "an unrecognised format"}. ` +
        `Swagger 2.0 support was removed with the 10.0 upgrade; use scripts/diff-spec.ts to compare specs.`
    );
  }

  /**
   * The spec with `/ainvr` stripped from every path key.
   *
   * `ctx.spec` is not only read through the parsed model — `computeRoundTripGaps`
   * walks `spec.paths` itself to see request and response schemas together, and
   * the tests index it by path. Normalising once here means none of them has to
   * know where the prefix went, and an operation id built by hand matches the
   * ids in every table. The alternative, which this replaced, was each consumer
   * remembering to strip it: `roundTrip.ts` needed three separate fixes before
   * its ids lined up again, and each one failed silently rather than loudly.
   */
  const spec: JsonObject = {
    ...raw,
    paths: Object.fromEntries(objectEntries(raw.paths).map(([p, item]) => [stripBasePath(p), item])),
  };

  const basePath = V3_BASE_PATH;
  // `servers` describes wherever the spec happened to be generated, which is not
  // this deployment — IVEDAAI_BASE_URL is the authority. Parsed only so the
  // context keeps its shape for callers that report it.
  let host = "";
  let schemes: string[] = ["http"];
  const servers = spec.servers;
  const firstServer = Array.isArray(servers) ? asObject(servers[0]) : undefined;
  const serverUrl = typeof firstServer?.url === "string" ? firstServer.url : undefined;
  if (serverUrl) {
    try {
      const parsed = new URL(serverUrl);
      host = parsed.host;
      schemes = [parsed.protocol.replace(":", "")];
    } catch {
      // A relative or malformed server URL tells us nothing; the defaults stand.
    }
  }
  const tokenUrl = `${V3_BASE_PATH}/api/oauth2/token`;

  const byTag = new Map<string, Operation[]>();

  // Already stripped above, so ids come out as `METHOD /api/...` — see V3_BASE_PATH.
  for (const [path, methods] of objectEntries(spec.paths ?? {})) {
    for (const [method, rawOp] of objectEntries(methods)) {
      if (!HTTP_METHODS.includes(method)) continue;
      const op = asObject(rawOp);
      if (!op) continue;
      const tags = op.tags;
      const tag: string = (Array.isArray(tags) && typeof tags[0] === "string" ? tags[0] : undefined) ?? "Untagged";
      const id = buildOperationId(method, path);
      const { params: bodyParams, consumes } = v3RequestBodyParams(op.requestBody);
      const declared = Array.isArray(op.parameters) ? op.parameters : [];
      const parameters = [...declared.map(flattenV3Parameter), ...bodyParams];
      const operation: Operation = {
        id,
        method: method.toUpperCase(),
        path,
        operationId: typeof op.operationId === "string" ? op.operationId : undefined,
        summary: typeof op.summary === "string" ? op.summary : undefined,
        description: typeof op.description === "string" ? op.description : undefined,
        tag,
        parameters: correctedParameters(id, parameters, useBundledFindings),
        consumes: consumes.length ? consumes : undefined,
        // undefined rather than [] when nothing meaningful is declared, so
        // `acceptHeaderFor`'s "undeclared" branch fires — see v3Produces.
        produces: v3Produces(op).length ? v3Produces(op) : undefined,
      };
      if (!byTag.has(tag)) byTag.set(tag, []);
      byTag.get(tag)!.push(operation);
    }
  }

  const tags: TagGroup[] = [...byTag.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([tag, operations]) => ({
      tag,
      operations: operations.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method)),
    }));

  return { spec, useBundledFindings, basePath, host, schemes, tokenUrl, tags };
}

/** Slugifies a tag name into a valid MCP tool name segment. */
export function tagToToolName(tag: string): string {
  return (
    "ivedaai_" +
    tag
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .replace(/[^a-zA-Z0-9]+/g, "_")
      .toLowerCase()
      .replace(/^_+|_+$/g, "")
  );
}
