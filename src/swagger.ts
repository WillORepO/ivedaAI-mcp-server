import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export type ParamLocation = "path" | "query" | "header" | "body" | "formData";

export interface ParamDef {
  name: string;
  in: ParamLocation;
  required: boolean;
  type?: string;
  format?: string;
  description?: string;
  enum?: string[];
  items?: any;
  collectionFormat?: string;
  schema?: any;
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
  spec: any;
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

function loadRawSpec(): any {
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
function flattenV3Parameter(p: any): ParamDef {
  const schema = p.schema ?? {};
  return {
    name: p.name,
    in: p.in,
    required: !!p.required,
    type: schema.type,
    format: schema.format,
    description: p.description,
    enum: schema.enum ?? schema.items?.enum,
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
function v3RequestBodyParams(requestBody: any): { params: ParamDef[]; consumes: string[] } {
  const content = requestBody?.content ?? {};
  const mediaTypes = Object.keys(content);
  if (!mediaTypes.length) return { params: [], consumes: [] };

  const required = !!requestBody.required;
  const json = mediaTypes.find((t) => t.includes("json"));
  if (json) {
    return {
      params: [{ name: "body", in: "body", required, schema: content[json].schema, description: requestBody.description }],
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
      params: [{ name: "body", in: "body", required, schema: content[mediaTypes[0]].schema }],
      consumes: mediaTypes,
    };
  }

  const schema = content[form].schema ?? {};
  const requiredFields = new Set<string>(schema.required ?? []);
  const location: ParamLocation = multipart ? "formData" : "query";
  const params: ParamDef[] = Object.entries<any>(schema.properties ?? {}).map(([name, prop]) => ({
    name,
    in: location,
    required: requiredFields.has(name),
    // `format: "binary"` is 3.0's spelling of 2.0's `type: "file"`, and the
    // difference matters: `request.ts` selects the multipart path on `type`.
    type: prop.format === "binary" ? "file" : prop.type,
    format: prop.format === "binary" ? undefined : prop.format,
    description: prop.description,
    enum: prop.enum,
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
function v3Produces(op: any): string[] {
  const out = new Set<string>();
  for (const [code, response] of Object.entries<any>(op.responses ?? {})) {
    if (!/^2/.test(code)) continue;
    for (const type of Object.keys(response?.content ?? {})) {
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
export function schemaDefinitions(spec: any): Record<string, any> {
  return spec?.components?.schemas ?? {};
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
export function requestBodySchema(rawOp: any): any {
  const content = rawOp?.requestBody?.content ?? {};
  const json = Object.keys(content).find((t) => t.includes("json"));
  return json ? content[json].schema : undefined;
}

/**
 * The schema of a raw operation's success response.
 *
 * 2.0 put it at `responses.200.schema`; 3.0 nests it under a media type, and
 * this spec commonly uses the wildcard type rather than `application/json` — so
 * keying on the media type by name would find nothing for most operations. Takes
 * the first 2xx with a schema.
 */
export function successResponseSchema(rawOp: any): any {
  for (const [code, response] of Object.entries<any>(rawOp?.responses ?? {})) {
    if (!/^2/.test(code)) continue;
    for (const media of Object.values<any>(response?.content ?? {})) {
      if (media?.schema) return media.schema;
    }
  }
  return undefined;
}

export function resolveRef(spec: any, ref: string): any {
  if (!ref.startsWith("#/")) return undefined;
  const parts = ref.slice(2).split("/");
  let node = spec;
  for (const part of parts) {
    if (node == null) return undefined;
    node = node[part];
  }
  return node;
}

/** Resolves a schema node one level of $ref (does not recurse into nested $refs beyond `depth`). */
export function resolveSchema(spec: any, schema: any, depth = 2): any {
  if (!schema) return schema;
  if (schema.$ref) {
    const resolved = resolveRef(spec, schema.$ref);
    if (!resolved) return schema;
    return depth > 0 ? resolveSchema(spec, resolved, depth - 1) : resolved;
  }
  return schema;
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
  const spec = {
    ...raw,
    paths: Object.fromEntries(Object.entries<any>(raw.paths ?? {}).map(([p, item]) => [stripBasePath(p), item])),
  };

  const basePath = V3_BASE_PATH;
  // `servers` describes wherever the spec happened to be generated, which is not
  // this deployment — IVEDAAI_BASE_URL is the authority. Parsed only so the
  // context keeps its shape for callers that report it.
  let host = "";
  let schemes: string[] = ["http"];
  const serverUrl: string | undefined = spec.servers?.[0]?.url;
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
  for (const [path, methods] of Object.entries<any>(spec.paths ?? {})) {
    for (const [method, op] of Object.entries<any>(methods)) {
      if (!HTTP_METHODS.includes(method)) continue;
      const tag: string = (op.tags && op.tags[0]) || "Untagged";
      const id = buildOperationId(method, path);
      const { params: bodyParams, consumes } = v3RequestBodyParams(op.requestBody);
      const parameters = [...(op.parameters ?? []).map(flattenV3Parameter), ...bodyParams];
      const operation: Operation = {
        id,
        method: method.toUpperCase(),
        path,
        operationId: op.operationId,
        summary: op.summary,
        description: op.description,
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
