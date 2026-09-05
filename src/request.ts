import { basename } from "node:path";
import { fetch, FormData, type Response } from "undici";
import type { Operation, ParamDef } from "./swagger.js";
import type { TokenManager } from "./auth.js";
import { connectionFailureMessage, licenceFailureNote } from "./netError.js";
import { readUploadFile, type UploadPolicy } from "./uploadPath.js";
import { redactSecrets } from "./redact.js";
import { stripInlineMediaFromCollections } from "./inlineMedia.js";

export interface FileInput {
  path: string;
  filename?: string;
  contentType?: string;
}

export interface OperationArgs {
  path?: Record<string, string | number | boolean>;
  query?: Record<string, unknown>;
  body?: unknown;
  file?: FileInput;
}

export interface OperationResult {
  url: string;
  method: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: unknown;
  isBinary?: boolean;
  /** True when the body was cut off at the byte cap. */
  truncated?: boolean;
  /**
   * What the caller should do about a response that needs explaining.
   *
   * Set on a truncated body, and on a 403 that is the deployment licence
   * rather than the credentials. Never both: a licence refusal is small.
   */
  note?: string;
  /** True when reading the body hit the timeout (typical for SSE/MJPEG streams); body holds what was read. */
  timedOut?: boolean;
  /**
   * A complete image, ready to hand to the client as viewable content.
   *
   * Kept off `body` deliberately: it is base64, and putting it there would
   * also serialise it into the JSON text of the result, sending the same
   * picture twice — once as something the model can look at and once as tens
   * of kilobytes it can only read as gibberish.
   */
  image?: { mimeType: string; base64: string };
}

/** Response headers worth echoing to the model; everything else (incl. Set-Cookie) is dropped. */
const RESPONSE_HEADER_ALLOWLIST = new Set([
  "content-type",
  "content-length",
  "content-disposition",
  "content-range",
  "link",
  "x-total-count",
  "x-total-pages",
]);

function paramsIn(operation: Operation, loc: ParamDef["in"]): ParamDef[] {
  return operation.parameters.filter((p) => p.in === loc);
}

function isScalar(value: unknown): boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function isMissing(value: unknown): boolean {
  return value === undefined || value === null ||
    (typeof value === "string" && value.trim() === "") ||
    (Array.isArray(value) && (value.length === 0 || value.some(isMissing)));
}

function encodeQueryValue(param: ParamDef, value: unknown, search: URLSearchParams): void {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) {
    const format = param.collectionFormat ?? "csv";
    const strs = value.map((v) => String(v));
    switch (format) {
      case "multi":
        for (const s of strs) search.append(param.name, s);
        return;
      case "ssv":
        search.append(param.name, strs.join(" "));
        return;
      case "tsv":
        search.append(param.name, strs.join("\t"));
        return;
      case "pipes":
        search.append(param.name, strs.join("|"));
        return;
      case "csv":
      default:
        search.append(param.name, strs.join(","));
        return;
    }
  }
  search.append(param.name, String(value));
}

export function validateArgs(operation: Operation, args: OperationArgs): string[] {
  const problems: string[] = [];

  const pathParams = paramsIn(operation, "path");
  const queryParams = paramsIn(operation, "query");

  for (const p of pathParams) {
    if (p.required && isMissing(args.path?.[p.name])) {
      problems.push(`Missing required path parameter "${p.name}".`);
    }
  }
  for (const p of queryParams) {
    if (p.required && isMissing(args.query?.[p.name])) {
      problems.push(`Missing required query parameter "${p.name}".`);
    }
  }

  // Reject unknown keys instead of silently dropping them — a typo'd filter that is
  // ignored produces confusingly unfiltered results.
  const validPathNames = new Set(pathParams.map((p) => p.name));
  for (const key of Object.keys(args.path ?? {})) {
    if (!validPathNames.has(key)) {
      problems.push(
        `Unknown path parameter "${key}". Valid path parameters: ${pathParams.length ? pathParams.map((p) => p.name).join(", ") : "(none)"}.`
      );
    }
  }
  const validQueryNames = new Set(queryParams.map((p) => p.name));
  for (const [key, value] of Object.entries(args.query ?? {})) {
    if (!validQueryNames.has(key)) {
      problems.push(
        `Unknown query parameter "${key}". Valid query parameters: ${queryParams.length ? queryParams.map((p) => p.name).join(", ") : "(none)"}.`
      );
    } else if (value !== undefined && value !== null && !isScalar(value)) {
      if (Array.isArray(value)) {
        if (!value.every(isScalar)) {
          problems.push(`Query parameter "${key}" array items must be strings, numbers, or booleans.`);
        }
      } else {
        problems.push(`Query parameter "${key}" must be a string, number, boolean, or array — not an object.`);
      }
    }
  }

  if (paramsIn(operation, "body").some((p) => p.required) && args.body === undefined) {
    problems.push(`Missing required request body.`);
  }
  const fileParams = paramsIn(operation, "formData").filter((p) => p.type === "file");
  if (fileParams.some((p) => p.required) && !args.file) {
    problems.push(`Missing required file upload ("file" argument with a local "path").`);
  }

  return problems;
}

/**
 * True when an operation's query-declared parameters must actually be sent as
 * an application/x-www-form-urlencoded request body rather than in the URL.
 *
 * The spec declares these operations' inputs as `in: query` while also
 * declaring `consumes: application/x-www-form-urlencoded`. The real server
 * honours the latter: sending them as query params returns
 * `415 Unsupported Media Type` with an empty body. Confirmed live against
 * POST /api/oauth2/token, POST /api/face/search, and
 * POST /api/scene-objects/search.
 *
 * Operations that also accept multipart are excluded — those carry a file and
 * are handled by the multipart path instead.
 */
export function usesUrlencodedBody(operation: Operation): boolean {
  const consumes = operation.consumes ?? [];
  if (!consumes.includes("application/x-www-form-urlencoded")) return false;
  if (consumes.includes("multipart/form-data")) return false;
  return operation.parameters.some((p) => p.in === "query");
}

export function buildUrl(origin: string, basePath: string, operation: Operation, args: OperationArgs): URL {
  let path = operation.path;
  for (const p of paramsIn(operation, "path")) {
    const value = args.path?.[p.name];
    if (value !== undefined) {
      // URL normalisation removes dot segments; an empty id can turn a
      // record DELETE into a collection DELETE despite the access policy.
      if (String(value).trim() === "" || value === "." || value === "..") {
        throw new Error(`Invalid path parameter "${p.name}": provide a non-empty record identifier, not a dot segment.`);
      }
      path = path.replace(`{${p.name}}`, encodeURIComponent(String(value)));
    }
  }

  const url = new URL(origin + basePath + path);
  // When the server expects a urlencoded body, the query-declared params go
  // there instead — leaving them in the URL as well would duplicate them.
  if (usesUrlencodedBody(operation)) return url;

  for (const p of paramsIn(operation, "query")) {
    const value = args.query?.[p.name];
    encodeQueryValue(p, value, url.searchParams);
  }
  return url;
}

/** Encodes an operation's query-declared params as a form-urlencoded body string. */
export function buildUrlencodedBody(operation: Operation, args: OperationArgs): string {
  const search = new URLSearchParams();
  for (const p of paramsIn(operation, "query")) {
    encodeQueryValue(p, args.query?.[p.name], search);
  }
  return search.toString();
}

/**
 * Content types whose bodies are safe to decode as text.
 *
 * `text/*` covers html, plain, csv and event-stream; the rest are the structured
 * textual `application/*` types this API might plausibly answer with.
 */
const TEXTUAL_CONTENT_TYPE =
  /^text\/|^application\/(json|xml|javascript|ecmascript|graphql|x-ndjson|x-www-form-urlencoded)\b|^application\/[\w.-]+\+(json|xml)\b/;

/**
 * Whether a response body should be kept as bytes rather than decoded to text.
 *
 * Deliberately an allowlist of *textual* types rather than a blocklist of binary
 * ones. The blocklist version matched only `image|video|audio/*` and
 * `application/octet-stream`, so `GET /api/face/targets/export` — which answers
 * `application/zip` with `content-disposition: attachment` — was decoded as
 * UTF-8: 17KB of mojibake into the model's context, and the archive corrupted
 * past recovery by the lossy decode. The spec declares no `application/zip`
 * anywhere, so reading it would never have predicted this; only calling the
 * endpoint did.
 *
 * Erring toward binary costs a caller some metadata instead of content; erring
 * the other way silently destroys the payload. So anything not known to be text
 * is kept as bytes.
 *
 * `content-disposition: attachment` only decides the case where the type is
 * absent, and deliberately does not override a type known to be textual. The
 * first version let it override everything, on the reasoning that the header
 * exists to say "this is a file, not a page" — but that rule turned out to earn
 * nothing and cost something. It earns nothing because the zip that motivated all
 * this is caught by the allowlist regardless: `application/zip` is not textual.
 * It costs something because a `text/csv` export served as an attachment would be
 * replaced by metadata, and since the bytes are dropped for binary responses with
 * no base64 or raw escape hatch, that content becomes unreachable rather than
 * merely inconvenient. Readable text stays readable; only an undeclared type
 * needs the header's opinion.
 */
/**
 * Image types a client can actually render, and this API actually returns.
 *
 * An allowlist rather than `image/*` on purpose: an inlined image a client
 * cannot decode is worse than a descriptor, because it costs the bytes and
 * delivers nothing. These four are what MCP clients accept, and the spec
 * declares only jpeg and png across its 18 image endpoints.
 */
const INLINEABLE_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

/** The bare type, with any charset or boundary parameters removed. */
export function imageMimeType(contentType: string): string {
  return contentType.split(";")[0]!.trim().toLowerCase();
}

export function isInlineableImage(contentType: string): boolean {
  return INLINEABLE_IMAGE_TYPES.has(imageMimeType(contentType));
}

export function isBinaryResponse(contentType: string, contentDisposition: string): boolean {
  const type = contentType.trim().toLowerCase();
  if (type === "") return /^\s*attachment\b/i.test(contentDisposition);
  return !TEXTUAL_CONTENT_TYPE.test(type);
}

/**
 * Derives the Accept header from the operation's declared `produces`.
 *
 * Sending a blanket `Accept: application/json` makes the server reject every
 * non-JSON endpoint with `406 Not Acceptable` and a zero-byte body — confirmed
 * live against GET /api/streaming/{cameraId}/live.jpg, which returns a real
 * 181KB JPEG once the Accept header actually matches what it produces.
 */
export function acceptHeaderFor(operation: Operation): string {
  const produces = operation.produces?.filter((p) => typeof p === "string" && p.length > 0);
  if (!produces || produces.length === 0) return "application/json, */*";

  const declared = [...new Set(produces)];
  // Accepting ONLY the declared type breaks error paths: this API returns
  // JSON error bodies even from image endpoints, and when it can't satisfy
  // Accept it collapses to an opaque `500` with an empty body instead of the
  // real message. Confirmed live on GET /api/scenes/{sceneId}/{type}, which
  // returned 500/0 bytes under `Accept: image/jpeg` but a genuine
  // `400 Param 'eventType' must not be null` once JSON was also acceptable.
  // Declared types stay highest-priority so successful responses are unchanged.
  if (declared.some((t) => t.includes("json"))) return declared.join(", ");
  return [...declared, "application/json;q=0.9", "*/*;q=0.8"].join(", ");
}

interface CappedBody {
  bytes: Uint8Array;
  truncated: boolean;
  timedOut: boolean;
}

/** Only complete SSE frames can be safely interpreted after a bounded read. */
function redactCompleteEvents(text: string): string {
  const frames = text.split(/\r?\n\r?\n/);
  frames.pop(); // The final frame is incomplete unless followed by a separator.
  return frames.map(frame => {
    const lines = frame.split(/\r?\n/);
    const data = lines.filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
    let safe: string;
    try { safe = JSON.stringify(redactSecrets(JSON.parse(data))); }
    catch { safe = /^[\s]*[\[{]/.test(data) ? "[Malformed event data withheld]" : String(redactSecrets(data)); }
    const metadata = lines.filter(line => !line.startsWith("data:")).map(line => String(redactSecrets(line)));
    return [...metadata, ...safe.split("\n").map(line => `data: ${line}`)].join("\n");
  }).join("\n\n") || "[No complete events received before the response limit.]";
}

/**
 * Reads a response body incrementally, stopping at maxBytes or when the abort
 * signal fires. Endpoints like /api/system/events (SSE) and *.mjpeg never end
 * on their own, so an unbounded text()/arrayBuffer() would hang forever.
 */
async function readBodyCapped(response: Response, maxBytes: number): Promise<CappedBody> {
  if (!response.body) return { bytes: new Uint8Array(0), truncated: false, timedOut: false };

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  let timedOut = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        const remaining = maxBytes - total;
        chunks.push(value.subarray(0, remaining));
        total += Math.min(value.byteLength, remaining);
        if (value.byteLength > remaining) {
          truncated = true;
          await reader.cancel().catch(() => {});
          break;
        }
      }
    }
  } catch (err) {
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      timedOut = true;
    } else {
      throw err;
    }
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes: bytes.subarray(0, Math.min(total, maxBytes)), truncated, timedOut };
}

/**
 * Multipart operations that also take a JSON side-payload, and the field it goes in.
 *
 * This is knowledge the spec used to carry and stopped carrying. Swagger 2.0
 * declared these three with a `file` parameter *and* a `body` parameter, and the
 * body parameter's name is the multipart field the server reads. OpenAPI 3.0
 * describes the same operations with `file` alone — `POST /api/scenes` lost a
 * parameter its 9.3 document marked **required** — so a loader that believes the
 * new spec builds a request the server rejects.
 *
 * Recovered from `resources/swagger-9.3.json` rather than guessed, and it
 * matches what live testing already established: omitting the field returns
 * "Required request parameter 'request' ... is not present".
 *
 * If a future spec declares these again, `bodyParam` wins and this table stops
 * being consulted for them — it is a fallback, not an override.
 */
export const MULTIPART_BODY_FIELD: Record<string, string> = {
  "POST /api/detection/colors": "request",
  "POST /api/detection/colors.image": "request",
  "POST /api/scenes": "scene",
};

/**
 * Multipart operations whose *file* part the spec does not declare at all.
 *
 * Same class of omission as `MULTIPART_BODY_FIELD`, one step worse: there the
 * spec at least declared a file and dropped the JSON payload; here the whole
 * upload is missing, so the operation is uncallable from the document alone.
 *
 * `POST /api/image/rotate` is new in 10.0, so there is no archived 9.3 spec to
 * recover it from. Established by measurement instead — sending the same image
 * under five plausible part names, only `file` is accepted:
 *
 *     part "file"           -> 200 {"rotated":false,"imagePath":"…/<uuid>.jpg"}
 *     part "image"/"img"/…  -> 400, empty body
 *
 * `usrFileName`, the one property the spec *does* declare, names the uploaded
 * file rather than a server-side one: supplying it gives the temp file its
 * extension, and omitting it yields a path ending in a bare `.`. The endpoint
 * takes no rotation angle — `degree`, `angle`, `rotation` and `orientation` all
 * change nothing — so `rotated` reports whether it corrected the image from its
 * own EXIF orientation, and a synthetic image with none comes back `false`.
 */
export const MULTIPART_FILE_FIELD: Record<string, string> = {
  "POST /api/image/rotate": "file",

  // Enrolling a photo onto a face target. The 10.0 spec declares this operation
  // as multipart with `descriptor`, `faceKeyId` and `url` — and no file part at
  // all — so without this entry nothing appends the image, the request goes out
  // without a multipart body, and the server answers `415 Unsupported Media
  // Type`.
  //
  // That broke the documented face-watchlist workflow through this server:
  // "attach a reference photo" is step three of it in USAGE.md, and it was
  // unreachable. Measured both ways — a raw multipart POST with a `file` part is
  // accepted with `201`, and the same call through the generated tool returned
  // 415 until this line existed.
  //
  // The sibling update, `POST /api/face/keys/{targetKeyId}`, does declare `file`,
  // which is what makes this an omission in the spec rather than a convention:
  // the two halves of the same feature disagree.
  "POST /api/face/targets/{targetId}/keys": "file",
};

/**
 * Operations whose request body the spec calls JSON and the server wants as
 * plain text.
 *
 * `POST /api/hashtags` declares `application/json` with a schema carrying no
 * properties, which is a hint that nothing generated the schema rather than a
 * description of the body. The body is the bare keyword as `text/plain`:
 *
 *     text/plain "zzprobe123"        -> 201, and the hashtag appears in GET
 *     application/json "zzprobe123"  -> 400 ConstraintException 2101
 *     application/json {keyword: …}  -> 400 ConstraintException 2101
 *     ?keyword=… with no body        -> 400 HttpMessageNotReadableException
 *
 * The identical `ConstraintException` across every JSON shape is what gave it
 * away: the server was reaching the handler and finding no keyword at all, so
 * the complaint was about a keyword of length zero rather than about the shape.
 * The `HttpMessageNotReadableException` on the query-parameter attempts confirms
 * a body is mandatory.
 *
 * Keywords are constrained to alphanumerics, 2 to 32 characters — measured, not
 * inferred from the message: one character and thirty-three both answer 400, and
 * so does a hyphen. That is why `PROBE_NAME_PREFIX` cannot be used to mark a
 * throwaway hashtag, and so why hashtags are not a `CRUD_PLANS` entry.
 */
export const PLAIN_TEXT_BODY_OPS = new Set(["POST /api/hashtags"]);

function buildRequestBody(
  operation: Operation,
  args: OperationArgs,
  uploadPolicy: UploadPolicy,
  preparedUpload?: { data: Buffer }
): { body: FormData | string | undefined; contentType?: string } {
  const formDataParams = paramsIn(operation, "formData");
  // The declared file part, or the one MULTIPART_FILE_FIELD recovered for an
  // operation whose spec omits it entirely. Synthesised rather than looked up at
  // the append site so every later check — "is this multipart at all", "was a
  // file supplied" — sees the same parameter the spec should have declared.
  const recoveredFileField = MULTIPART_FILE_FIELD[operation.id];
  const fileParam =
    formDataParams.find((p) => p.type === "file") ??
    (recoveredFileField ? ({ name: recoveredFileField, in: "formData", required: true, type: "file" } as ParamDef) : undefined);
  if (fileParam && !formDataParams.includes(fileParam)) formDataParams.push(fileParam);
  const bodyParam = paramsIn(operation, "body")[0];

  // Query-declared params that the server actually wants as a urlencoded body.
  if (usesUrlencodedBody(operation)) {
    return {
      body: buildUrlencodedBody(operation, args),
      contentType: "application/x-www-form-urlencoded",
    };
  }

  if (formDataParams.length > 0) {
    if (fileParam?.required && !args.file) {
      throw new Error(`Operation ${operation.id} requires a file upload but none was provided.`);
    }
    const form = new FormData();
    let hasEntries = false;

    if (fileParam && args.file) {
      // Vetted before it is opened, and the vetted path is the one read — see
      // src/uploadPath.ts for what this is defending against. The name still
      // comes from what the caller asked for rather than from the resolved
      // path, so a symlink uploads under the name the caller used.
      const { data: buffer } = preparedUpload ?? readUploadFile(args.file.path, uploadPolicy);
      const filename = args.file.filename ?? basename(args.file.path);
      const blob = new Blob([Uint8Array.from(buffer)], { type: args.file.contentType ?? "application/octet-stream" });
      form.append(fileParam.name, blob, filename);
      hasEntries = true;
    }
    // A few operations take BOTH a file and a JSON side-payload. The payload has
    // to ride along as a plain multipart text field holding the JSON — confirmed
    // live: sent as a text field it returns 200, sent as an application/json
    // part it returns 500, and omitted entirely it returns
    // "Required request parameter 'request' ... is not present".
    //
    // The field name comes from the spec when the spec still declares it, and
    // from MULTIPART_BODY_FIELD when it does not — which, since 10.0, is all
    // three of them.
    const bodyFieldName = bodyParam?.name ?? MULTIPART_BODY_FIELD[operation.id];
    if (bodyFieldName && args.body !== undefined) {
      form.append(bodyFieldName, JSON.stringify(args.body));
      hasEntries = true;
    } else {
      for (const p of formDataParams) {
        if (p.type === "file") continue;
        const value = (args.body as Record<string, unknown> | undefined)?.[p.name];
        if (value !== undefined) {
          form.append(p.name, String(value));
          hasEntries = true;
        }
      }
    }
    // An operation with only an optional file (e.g. POST /api/jobs as a StreamJob)
    // must still be callable with no file — send no body in that case.
    return { body: hasEntries ? form : undefined };
  }

  if (bodyParam) {
    // Operations whose body the spec calls JSON and the server wants as plain
    // text. See PLAIN_TEXT_BODY_OPS — sending JSON here is a guaranteed 400.
    if (PLAIN_TEXT_BODY_OPS.has(operation.id)) {
      const value = typeof args.body === "string" ? args.body : String(args.body ?? "");
      return { body: value, contentType: "text/plain" };
    }
    return { body: JSON.stringify(args.body ?? {}), contentType: "application/json" };
  }

  return { body: undefined };
}

export async function executeOperation(
  tokenManager: TokenManager,
  operation: Operation,
  args: OperationArgs,
  overrideTimeoutMs?: number,
  cancellation?: AbortSignal
): Promise<OperationResult> {
  const requestSignal = AbortSignal.any([tokenManager.shutdownSignal, ...(cancellation ? [cancellation] : [])]);
  requestSignal.throwIfAborted();
  const problems = validateArgs(operation, args);
  if (problems.length > 0) {
    throw new Error(`Invalid arguments for ${operation.id}:\n- ${problems.join("\n- ")}`);
  }

  const timeoutMs = overrideTimeoutMs ?? tokenManager.timeoutMs;
  const url = buildUrl(tokenManager.apiOrigin, tokenManager.basePath, operation, args);

  // Read and validate local upload bytes before authentication or any other
  // outbound activity. The captured bytes are reused when a 401 requires a
  // second request, while each attempt still gets a fresh FormData wrapper.
  const acceptsFile =
    operation.parameters.some((parameter) => parameter.in === "formData" && parameter.type === "file") ||
    MULTIPART_FILE_FIELD[operation.id] !== undefined;
  const preparedUpload = args.file && acceptsFile ? readUploadFile(args.file.path, tokenManager.uploadPolicy) : undefined;
  // Validate body construction (including recovered required file parts) before
  // asking the deployment for a token.
  buildRequestBody(operation, args, tokenManager.uploadPolicy, preparedUpload);

  const attempt = async (accessToken: string): Promise<Response> => {
    requestSignal.throwIfAborted();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      Accept: acceptHeaderFor(operation),
    };
    // Rebuild the body per attempt: FormData streams can't be reused after a send.
    const { body, contentType } = buildRequestBody(operation, args, tokenManager.uploadPolicy, preparedUpload);
    if (contentType) headers["Content-Type"] = contentType;

    try {
      return await fetch(url, {
        method: operation.method,
        headers,
        body,
        // Do not forward uploads or credentials to a redirect destination.
        redirect: "error",
        dispatcher: tokenManager.dispatcher,
        signal: AbortSignal.any([requestSignal, AbortSignal.timeout(timeoutMs)]),
      });
    } catch (err) {
      if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
        throw new Error(
          `Request to ${operation.id} timed out after ${timeoutMs}ms with no response. ` +
            `The server may be unreachable, or this may be a continuous-streaming endpoint not suited to tool calls.`
        );
      }
      const connection = connectionFailureMessage(err, operation.id, url.toString());
      if (connection) throw new Error(connection);
      throw err;
    }
  };

  const accessToken = await tokenManager.getAccessToken();
  let response = await attempt(accessToken);

  // One forced re-login on 401: the cached token may have been revoked server-side
  // (e.g. restart or session limit) before its scheduled expiry.
  if (response.status === 401) {
    await response.body?.cancel().catch(() => {});
    requestSignal.throwIfAborted();
    tokenManager.invalidateToken(accessToken);
    response = await attempt(await tokenManager.getAccessToken());
  }

  const contentType = response.headers.get("content-type") ?? "";
  const contentDisposition = response.headers.get("content-disposition") ?? "";
  const isBinary = isBinaryResponse(contentType, contentDisposition);
  // An image gets its own, larger budget. The response cap is sized for JSON a
  // model has to read as text, where bytes and tokens track each other. An
  // image does not work that way — a client charges for it by dimensions, not
  // by the length of its base64 — so holding images to the JSON budget would
  // truncate every one of them (a camera JPEG is ~45 KB against a 28 KB cap)
  // to save a cost that is not being incurred.
  const wantsImage = tokenManager.inlineImages && isInlineableImage(contentType);
  const readCap = wantsImage ? tokenManager.maxImageBytes : tokenManager.maxResponseBytes;
  const { bytes, truncated, timedOut } = await readBodyCapped(response, readCap);
  requestSignal.throwIfAborted();

  let image: OperationResult["image"];
  let parsedBody: unknown;
  if (isBinary) {
    // Surface the download filename when the server offers one: for an export
    // endpoint that is the difference between "some bytes" and "the face-target
    // watchlist as a zip", and it costs nothing.
    const filename = /filename\s*=\s*"?([^";]+)"?/i.exec(contentDisposition)?.[1];
    // The real size, when the server declared one. `bytes.byteLength` is only
    // what was read before the cap, so on a truncated response it reports the
    // cap itself: a 44,574-byte JPEG came back claiming to be 28,672 bytes,
    // with the true figure sitting in the content-length header directly above
    // it. Prefer the header and fall back to the read length.
    const declared = Number(response.headers.get("content-length"));
    const byteLength = Number.isFinite(declared) && declared > 0 ? declared : bytes.byteLength;
    // Hand the picture over when it arrived whole and is a type a client can
    // display. A truncated image is a corrupt file, not a smaller one, so a
    // partial read is never inlined — the descriptor still describes it.
    if (wantsImage && !truncated && !timedOut && bytes.byteLength > 0) {
      image = { mimeType: imageMimeType(contentType), base64: Buffer.from(bytes).toString("base64") };
    }
    parsedBody = {
      contentType,
      byteLength,
      // Only meaningful when the two differ, and then it is the honest account
      // of what this server actually holds.
      ...(truncated && byteLength !== bytes.byteLength ? { bytesRead: bytes.byteLength } : {}),
      ...(filename ? { filename } : {}),
      // Binary is never returned inline, whatever the cap. The old truncated
      // wording — "exceeded the N-byte cap and was not returned inline" —
      // implied the cap was the reason and that raising it would produce the
      // image. Raising the cap to 200 KB still returns this descriptor, so the
      // note pointed at a fix that does not exist.
      note: image
        ? "The image itself is attached to this result and can be viewed directly; this describes it."
        : "Binary response bodies are not returned inline; this is a description of what the endpoint returned." +
          (truncated ? ` Only the first ${bytes.byteLength} bytes were read, because of the ${readCap}-byte cap.` : "") +
          (wantsImage && truncated
            ? ` The image was too large to attach — raise IVEDAAI_MAX_IMAGE_BYTES (currently ${tokenManager.maxImageBytes}) to view it.`
            : ""),
    };
  } else {
    const text = new TextDecoder().decode(bytes);
    if (truncated || timedOut) {
      // An incomplete JSON string cannot be traversed by field-name
      // redaction. Returning its prefix leaks any credentials before the cap.
      parsedBody = tokenManager.redactSecrets
        ? contentType.toLowerCase().includes("text/event-stream")
          ? redactCompleteEvents(text)
          : "[Incomplete response body withheld because it cannot be safely redacted. Narrow the request and retry.]"
        : text;
    } else {
      try {
        parsedBody = text.length > 0 ? JSON.parse(text) : null;
      } catch {
        parsedBody = tokenManager.redactSecrets && /^[\s]*[\[{]/.test(text)
          ? "[Malformed JSON body withheld because it cannot be safely redacted.]"
          : text;
      }
    }
    if (tokenManager.redactSecrets) {
      parsedBody = redactSecrets(parsedBody);
    }
    // After redaction, so a marker never replaces something that should have
    // been masked first, and only on collections — see src/inlineMedia.ts.
    parsedBody = stripInlineMediaFromCollections(parsedBody);
  }

  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    if (RESPONSE_HEADER_ALLOWLIST.has(key.toLowerCase())) {
      responseHeaders[key.toLowerCase()] = tokenManager.redactSecrets ? String(redactSecrets(value)) : value;
    }
  });

  const licenceNote = licenceFailureNote(response.status, parsedBody);

  return {
    url: tokenManager.redactSecrets ? String(redactSecrets(url.toString())) : url.toString(),
    method: operation.method,
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
    body: parsedBody,
    isBinary,
    ...(truncated ? { truncated } : {}),
    // A truncated JSON body is broken JSON, so the caller gets a string it
    // cannot parse. Saying only "truncated" leaves it to guess what to do; the
    // useful answer is almost always to ask for less.
    ...(truncated && !isBinary
      ? {
          note:
            `Response exceeded the ${tokenManager.maxResponseBytes}-byte cap and was cut off, so "body" is ` +
            `${tokenManager.redactSecrets ? 'withheld because incomplete content cannot be safely redacted' : 'partial text rather than parsed JSON'}. Narrow the request and try again — reduce "size", add a ` +
            `filter, or request a single record by id. Raising IVEDAAI_MAX_RESPONSE_BYTES is the last resort, ` +
            `because a larger response may exceed what this client can accept.`,
        }
      : {}),
    // A licence failure is not a truncation, so it cannot collide with the note
    // above: that one only appears on a body too large to parse, and this one
    // only on a 403. Ordered after it regardless, so a truncated body keeps the
    // note that explains why it will not parse.
    ...(!truncated && licenceNote ? { note: licenceNote } : {}),
    ...(timedOut ? { timedOut } : {}),
    ...(image ? { image } : {}),
  };
}
