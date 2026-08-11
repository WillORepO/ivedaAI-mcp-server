import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { fetch, FormData, type Response } from "undici";
import type { Operation, ParamDef } from "./swagger.js";
import type { TokenManager } from "./auth.js";
import { redactSecrets } from "./redact.js";

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
  /** True when reading the body hit the timeout (typical for SSE/MJPEG streams); body holds what was read. */
  timedOut?: boolean;
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
    if (p.required && (args.path?.[p.name] === undefined || args.path?.[p.name] === null)) {
      problems.push(`Missing required path parameter "${p.name}".`);
    }
  }
  for (const p of queryParams) {
    if (p.required && (args.query?.[p.name] === undefined || args.query?.[p.name] === null)) {
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
        chunks.push(value);
        total += value.byteLength;
        if (total >= maxBytes) {
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
  args: OperationArgs
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
      const buffer = readFileSync(args.file.path);
      const filename = args.file.filename ?? basename(args.file.path);
      const blob = new Blob([buffer], { type: args.file.contentType ?? "application/octet-stream" });
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
  overrideTimeoutMs?: number
): Promise<OperationResult> {
  const problems = validateArgs(operation, args);
  if (problems.length > 0) {
    throw new Error(`Invalid arguments for ${operation.id}:\n- ${problems.join("\n- ")}`);
  }

  const timeoutMs = overrideTimeoutMs ?? tokenManager.timeoutMs;
  const url = buildUrl(tokenManager.apiOrigin, tokenManager.basePath, operation, args);

  const attempt = async (accessToken: string): Promise<Response> => {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      Accept: acceptHeaderFor(operation),
    };
    // Rebuild the body per attempt: FormData streams can't be reused after a send.
    const { body, contentType } = buildRequestBody(operation, args);
    if (contentType) headers["Content-Type"] = contentType;

    try {
      return await fetch(url, {
        method: operation.method,
        headers,
        body,
        dispatcher: tokenManager.dispatcher,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
        throw new Error(
          `Request to ${operation.id} timed out after ${timeoutMs}ms with no response. ` +
            `The server may be unreachable, or this may be a continuous-streaming endpoint not suited to tool calls.`
        );
      }
      throw err;
    }
  };

  let response = await attempt(await tokenManager.getAccessToken());

  // One forced re-login on 401: the cached token may have been revoked server-side
  // (e.g. restart or session limit) before its scheduled expiry.
  if (response.status === 401) {
    await response.body?.cancel().catch(() => {});
    tokenManager.invalidateToken();
    response = await attempt(await tokenManager.getAccessToken());
  }

  const contentType = response.headers.get("content-type") ?? "";
  const contentDisposition = response.headers.get("content-disposition") ?? "";
  const isBinary = isBinaryResponse(contentType, contentDisposition);
  const { bytes, truncated, timedOut } = await readBodyCapped(response, tokenManager.maxResponseBytes);

  let parsedBody: unknown;
  if (isBinary) {
    // Surface the download filename when the server offers one: for an export
    // endpoint that is the difference between "some bytes" and "the face-target
    // watchlist as a zip", and it costs nothing.
    const filename = /filename\s*=\s*"?([^";]+)"?/i.exec(contentDisposition)?.[1];
    parsedBody = {
      contentType,
      byteLength: bytes.byteLength,
      ...(filename ? { filename } : {}),
      note: truncated
        ? `Binary response exceeded the ${tokenManager.maxResponseBytes}-byte cap and was not returned inline.`
        : "Binary response body was not returned inline.",
    };
  } else {
    const text = new TextDecoder().decode(bytes);
    if (truncated || timedOut) {
      parsedBody = text;
    } else {
      try {
        parsedBody = text.length > 0 ? JSON.parse(text) : null;
      } catch {
        parsedBody = text;
      }
    }
    if (tokenManager.redactSecrets) {
      parsedBody = redactSecrets(parsedBody);
    }
  }

  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    if (RESPONSE_HEADER_ALLOWLIST.has(key.toLowerCase())) {
      responseHeaders[key.toLowerCase()] = value;
    }
  });

  return {
    url: url.toString(),
    method: operation.method,
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
    body: parsedBody,
    isBinary,
    ...(truncated ? { truncated } : {}),
    ...(timedOut ? { timedOut } : {}),
  };
}
