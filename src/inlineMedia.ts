/**
 * Replaces inline media payloads with a marker, in collection responses only.
 *
 * Measured against a live deployment: `GET /api/alerts` over one week returned
 * **227,600 records**. Every face-recognition alert carries the *enrolled
 * reference portrait* of the matched person in `metadata.faceTargetFile`, as a
 * `data:image/jpeg;base64,…` string of roughly 2.7 KB — repeated on every alert
 * that matches that person, because it describes the watchlist entry rather
 * than the event.
 *
 * Against the 28 KB response cap that is five to eight alerts per call. The
 * portrait is also of no use to a model reading a list: it is pixels in a text
 * channel, costing a third of the budget per record to say something the
 * accompanying `faceTarget` name already says.
 *
 * ## What this does not touch
 *
 * **Image *endpoints* are a different path entirely.** An operation that
 * returns a real image — `GET /api/streaming/{cameraId}/live.jpg` and its kind —
 * goes through the binary branch in `request.ts`, which hands the picture to
 * the client as MCP image content under its own larger budget
 * (`IVEDAAI_MAX_IMAGE_BYTES`, separate from `IVEDAAI_MAX_RESPONSE_BYTES`
 * precisely so images are not truncated by a cap sized for JSON). Nothing here
 * runs on that path, and image retrieval is unaffected.
 *
 * The image **URLs** in a record — `snapshot`, `metadata.alertImage`,
 * `metadata.faceFile` — are ordinary strings and are left alone. A caller still
 * learns that an image exists and where it lives.
 *
 * ## Why only collections, and why a marker
 *
 * The cost is the multiplication. One record's portrait is affordable; a page
 * of twenty is not. So a single-record read — `GET /api/alerts/{alertId}` —
 * keeps the payload whole, and that doubles as the way to get it back: a caller
 * who has narrowed to one alert and wants the portrait fetches that alert.
 * There is no environment switch for this because there does not need to be.
 *
 * The value is replaced rather than deleted, and the marker states the type and
 * the size. This project has already been bitten once by the other choice: an
 * enum cut to eight values with no marker read as a complete list of eight, and
 * a model reported two different sets as identical. Content removed silently is
 * indistinguishable from content that was never there.
 */

/**
 * Below this, the marker would cost more than the payload it replaces.
 *
 * A small inline icon is cheaper to pass through than to explain the absence
 * of. The alert portraits that motivated this are ~2,700 characters, so they
 * clear it comfortably.
 */
const MIN_INLINE_MEDIA_CHARS = 1024;

/** `data:` URI, with the media type captured when one is declared. */
const DATA_URI = /^data:([a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*)?[^,]*,/i;

function describeOmission(value: string): string {
  const mediaType = DATA_URI.exec(value)?.[1] ?? "data";
  const kb = (value.length / 1024).toFixed(1);
  return `[${mediaType} omitted, ${kb} KB — read this record singly for the full value]`;
}

function isInlineMedia(value: string): boolean {
  return value.length >= MIN_INLINE_MEDIA_CHARS && DATA_URI.test(value);
}

/**
 * A page of records, in the two shapes this API returns them.
 *
 * Spring pages carry their rows under `content`; a few endpoints answer with a
 * bare array. Anything else — a single record, a scalar, an error envelope — is
 * left exactly as it arrived.
 */
function isCollection(body: unknown): boolean {
  if (Array.isArray(body)) return true;
  if (body !== null && typeof body === "object" && Array.isArray((body as { content?: unknown }).content)) {
    return true;
  }
  return false;
}

function strip(value: unknown): unknown {
  if (typeof value === "string") {
    return isInlineMedia(value) ? describeOmission(value) : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => strip(item));
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[key] = strip(val);
    }
    return result;
  }
  return value;
}

/** Strips inline media from a parsed response body, if that body is a collection. */
export function stripInlineMediaFromCollections(body: unknown): unknown {
  return isCollection(body) ? strip(body) : body;
}
