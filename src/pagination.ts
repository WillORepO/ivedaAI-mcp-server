import { resolveRef, resolveSchema, type Operation } from "./swagger.js";

/**
 * Pagination, normalised into the one shape a caller can rely on.
 *
 * This API paginates the Spring way: a response carries `content` alongside
 * `totalElements`, `totalPages`, `number`, `size`, `numberOfElements`, `first`,
 * `last` and `empty`, and a nested `pageable` restating most of it again. All of
 * it is *there*, and none of it answers the only two questions a caller actually
 * has after a list call — is there more, and what do I send to get it. Working
 * that out means knowing that `number` is the zero-based page index rather than
 * a count, that `numberOfElements` is this page's length while `totalElements`
 * is the collection's, and that `last` is the field to trust rather than
 * comparing the other two. A model gets this wrong in a way that looks right:
 * it reads `totalElements: 400`, sees twenty records, and reports twenty.
 *
 * So the page fields are summarised into `pagination` on the response envelope.
 * `body` is not touched — the original stays exactly as the deployment sent it,
 * because this summary is derived from a schema and a schema can be wrong about
 * a live server.
 */

/** What a caller needs after a list call, and nothing else. */
export interface PageSummary {
  /** Records in the whole collection, per `totalElements`. */
  total?: number;
  /** Records in this response, per `numberOfElements` or the length of `content`. */
  count: number;
  /** Zero-based index of this page, per `number`. */
  page?: number;
  /** Records per page, per `size`. */
  size?: number;
  /** Whether another page exists. */
  hasMore: boolean;
  /** The `page` value that fetches the next one, absent when there is none. */
  nextPage?: number;
}

/** The actual MCP argument names and container an operation accepts for paging. */
export interface PaginationRequest {
  container: "query" | "body";
  pageParameter: string;
  sizeParameter?: string;
}

const PAGE_PARAMETER_PAIRS = [
  ["page", "size"],
  ["pageNumber", "pageSize"],
] as const;

/** Derives continuation arguments from the operation instead of assuming one Spring convention. */
export function paginationRequest(spec: any, operation: Operation): PaginationRequest | undefined {
  const direct = operation.parameters.filter((p) => p.in === "query" || p.in === "formData");
  for (const [pageParameter, sizeParameter] of PAGE_PARAMETER_PAIRS) {
    const page = direct.find((p) => p.name === pageParameter);
    if (!page) continue;
    const container = page.in === "formData" ? "body" : "query";
    const size = direct.find((p) => p.in === page.in && p.name === sizeParameter);
    return { container, pageParameter, ...(size ? { sizeParameter } : {}) };
  }

  const bodyParameter = operation.parameters.find((p) => p.in === "body");
  const properties = resolveSchema(spec, bodyParameter?.schema)?.properties ?? {};
  for (const [pageParameter, sizeParameter] of PAGE_PARAMETER_PAIRS) {
    if (!(pageParameter in properties)) continue;
    return {
      container: "body",
      pageParameter,
      ...(sizeParameter in properties ? { sizeParameter } : {}),
    };
  }
  return undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * True when a schema is one of this spec's `PageOf*` envelopes.
 *
 * Matched on shape rather than on the name, even though every one of the 31 is
 * in fact called `PageOf<Thing>`. A name is a convention springdoc happens to
 * follow and could stop following on the next upgrade; `content` next to
 * `totalElements` is what the code here actually reads. `PageSearchResult`
 * already breaks the naming pattern while keeping the shape.
 */
function isPageSchema(spec: unknown, schema: unknown): boolean {
  if (!schema || typeof schema !== "object") return false;
  const s = schema as { $ref?: string; properties?: Record<string, unknown> };
  if (s.$ref) return isPageSchema(spec, resolveRef(spec, s.$ref));
  const props = s.properties;
  if (!props) return false;
  return "content" in props && "totalElements" in props;
}

function successSchema(operation: any): unknown {
  const responses = operation?.responses ?? {};
  for (const status of Object.keys(responses)) {
    if (!/^2\d\d$/.test(status)) continue;
    const content = responses[status]?.content ?? {};
    for (const mediaType of Object.keys(content)) {
      const schema = content[mediaType]?.schema;
      if (schema) return schema;
    }
  }
  return undefined;
}

/**
 * Operation ids whose success response is a page, derived once at startup.
 *
 * Read from the spec rather than sniffed off each response, so an endpoint that
 * happens to return an object with a `content` array is not mistaken for a
 * paginated one. The cost of being wrong here is a fabricated `hasMore`, which
 * is worse than no summary at all.
 */
export function paginatedOperations(spec: any): Set<string> {
  const ids = new Set<string>();
  for (const [path, pathItem] of Object.entries<any>(spec?.paths ?? {})) {
    for (const method of ["get", "post"]) {
      const operation = pathItem?.[method];
      if (!operation) continue;
      if (isPageSchema(spec, successSchema(operation))) ids.add(`${method.toUpperCase()} ${path}`);
    }
  }
  return ids;
}

/**
 * Summarises a page body, or returns nothing if it does not look like one.
 *
 * The schema said this operation paginates; this checks the response agrees
 * before reporting on it. A 4xx body, a truncated fragment parsed as a string,
 * or an endpoint the deployment answers differently from its own spec would all
 * arrive here, and none of them should produce a confident `hasMore: false`.
 */
export function summarisePage(body: unknown): PageSummary | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  const page = body as Record<string, unknown>;
  if (!Array.isArray(page.content)) return undefined;

  const total = num(page.totalElements);
  const totalPages = num(page.totalPages);
  const rawNumber = num(page.number);
  const number = rawNumber !== undefined && Number.isInteger(rawNumber) && rawNumber >= 0 ? rawNumber : undefined;
  const size = num(page.size);
  const count = num(page.numberOfElements) ?? page.content.length;

  // `last` first, because it is the server's own answer. The fallbacks are for
  // a deployment that omits it: a page index against a page count, and failing
  // that, how far the records seen reach into the reported total. An unknown
  // stays `false` — claiming more pages that do not exist sends a caller into a
  // loop, while missing one leaves them where they already were.
  let hasMore: boolean;
  if (typeof page.last === "boolean") hasMore = !page.last;
  else if (number !== undefined && totalPages !== undefined) hasMore = number + 1 < totalPages;
  else if (total !== undefined && number !== undefined && size !== undefined) hasMore = (number + 1) * size < total;
  else hasMore = false;

  return {
    ...(total !== undefined ? { total } : {}),
    count,
    ...(number !== undefined ? { page: number } : {}),
    ...(size !== undefined ? { size } : {}),
    hasMore,
    ...(hasMore && number !== undefined ? { nextPage: number + 1 } : {}),
  };
}

/**
 * The sentence attached to a summary, which exists for one specific failure.
 *
 * A model that has just been handed twenty records and `total: 400` will
 * frequently answer the user's question from the twenty and never mention the
 * other 380. Naming the parameter to send is what turns the number into a next
 * step; `size` is named alongside it because raising the page is often the
 * better move than walking it, and because a page large enough to breach the
 * response cap is the other way this goes wrong.
 */
export function pageNote(summary: PageSummary, request?: PaginationRequest): string | undefined {
  if (!summary.hasMore) return undefined;
  const seen = summary.total !== undefined ? `${summary.count} of ${summary.total} records` : `${summary.count} records`;
  if (!request) {
    return (
      `This is a partial result: ${seen}. The operation does not declare a trustworthy continuation argument; ` +
      `inspect its schema before requesting another page. Do not answer from this page alone as if it were the whole collection.`
    );
  }
  if (summary.nextPage === undefined) {
    return (
      `This is a partial result: ${seen}. The response does not identify the next page, so do not invent a ` +
      `value for "${request.pageParameter}". Inspect the response and operation schema before requesting another ` +
      `page. Do not answer from this page alone as if it were the whole collection.`
    );
  }
  const next = `{${JSON.stringify(request.pageParameter)}: ${summary.nextPage}}`;
  const size = request.sizeParameter
    ? `, or a larger "${request.sizeParameter}" in the same ${request.container} to take more per call`
    : "";
  return (
    `This is a partial result: ${seen}. Repeat this operation with ${request.container} ${next} for the next page, ` +
    `preserving the other arguments${size} — ` +
    `but a page big enough to exceed the response cap comes ` +
    `back truncated, so raise it deliberately. Do not answer from this page alone as if it were the ` +
    `whole collection.`
  );
}
