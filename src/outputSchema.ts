import { z } from "zod";

/**
 * Declared result shapes — the half of a tool's contract `inputSchema` does not
 * cover.
 *
 * A tool that declares `outputSchema` must return `structuredContent` matching
 * it. The SDK validates every non-error result and raises a protocol error on a
 * mismatch, so a schema that is wrong about a real response does not produce a
 * warning: it destroys a call that would otherwise have worked. Everything here
 * is therefore written from what the code actually emits, and any field whose
 * type could vary with the deployment is left `unknown` rather than guessed at.
 * `body` is the clearest case — it is whatever the IvedaAI endpoint returned,
 * and pinning it to `object` would fail on every endpoint that answers with an
 * array, a bare string, or a truncated fragment.
 *
 * Error results are exempt: the SDK skips validation when `isError` is set,
 * which is why the refusal and catch paths in index.ts still return text alone.
 *
 * ## Why the generated tools' schema is undocumented
 *
 * `apiResponseOutput` carries no `.describe()` text. Its fields are already
 * explained once in `SERVER_INSTRUCTIONS` and again in the header of every tool
 * description — and unlike those, a schema is paid 63 times over. This is the
 * same trade `describeTag` makes when it declines to restate the calling
 * convention on each tool: say it where it is already being read, not where it
 * is being duplicated. The three hand-written tools are paid once each, so
 * theirs describe themselves.
 */

type AllOptional<T extends z.ZodRawShape> = { [K in keyof T]: z.ZodOptional<T[K]> };

/**
 * The same shape with nothing required.
 *
 * `ivedaai_alert_integration` answers three unrelated actions from one tool, and
 * only `apply` returns the HTTP envelope. One object schema has to cover all
 * three, so the envelope's fields appear there as optional rather than being
 * spelled out a second time.
 */
function allOptional<T extends z.ZodRawShape>(shape: T): AllOptional<T> {
  return Object.fromEntries(Object.entries(shape).map(([key, value]) => [key, value.optional()])) as AllOptional<T>;
}

// `z.unknown()` accepts `undefined`, so Zod's JSON-schema converter marks an
// object property using it optional. The refinement excludes only `undefined`:
// the transmitted property schema stays `{}` while `body` becomes required.
const requiredUnknownOutput = z.unknown().refine((value) => value !== undefined);

/**
 * The envelope `executeOperation` returns, as index.ts passes it on.
 *
 * `image` is deliberately absent. It is stripped from the payload before
 * serialisation and sent as an image content block instead, so it never reaches
 * `structuredContent` — see the comment at its removal in index.ts.
 *
 * ## Why `omittedFields` is declared but not detailed
 *
 * The SDK publishes this schema with `additionalProperties: false`, so every key
 * that can appear has to be named here or a client validating strictly against
 * the published schema would reject a response the server considers valid. That
 * rules out simply leaving `omittedFields` out. What it does not require is
 * describing its insides, and the insides are what cost: spelling out the two
 * arrays of `{field, readAt}` / `{field, readOp, readAt}` objects took this
 * schema from 537 characters to 1,143 — and it is paid on every one of the 63
 * generated tools, so that detail alone was 38,000 characters of connect
 * payload, more than half of the entire tool-description budget.
 *
 * It buys little. `omittedFields` appears only on the minority of update
 * operations with a round-trip gap, it arrives carrying its own `note`
 * explaining itself in prose, and the same warning is already on the operation's
 * description. Measured against that, the nested detail was the most expensive
 * documentation in the server and the least load-bearing.
 *
 * The middle option — naming the four keys but leaving the arrays loose — is 823
 * characters, or about 18,000 more than this across the 63 tools. Re-measure
 * with `npm run measure` before changing which of the three this is.
 */
export const apiResponseOutput = {
  url: z.string(),
  method: z.string(),
  status: z.number(),
  statusText: z.string(),
  headers: z.record(z.string()),
  body: requiredUnknownOutput,
  isBinary: z.boolean().optional(),
  truncated: z.boolean().optional(),
  timedOut: z.boolean().optional(),
  note: z.string().optional(),
  omittedFields: z.record(z.unknown()).optional(),
  // Loose, for the reason `omittedFields` is, and it was worth re-deciding
  // rather than assuming: this block appears on ordinary list calls, so unlike
  // that one it is on the common path, and its whole point is to be acted on.
  // Spelling out its seven keys costs 234 characters a tool — 14,742 across the
  // 63 — and buys a caller nothing it does not already have. `total`, `count`,
  // `page`, `size`, `hasMore` and `nextPage` are self-describing at the point of
  // use, the `note` beside them says what to send next in prose, and neither
  // depends on having read a schema first. What a caller cannot infer from the
  // block is that it exists at all, and that is said once in
  // SERVER_INSTRUCTIONS instead of 63 times here.
  pagination: z.record(z.unknown()).optional(),
};

/**
 * `ivedaai_get_schema`, whose two answers are wrapped rather than returned bare.
 *
 * The listing used to be a JSON array and the lookup the definition itself.
 * Neither can be `structuredContent`, which MCP requires to be an object, and
 * the bare definition would additionally have collided with this schema's own
 * keys had one ever been named `names`. Wrapping both is what makes a single
 * declared shape possible, and the text half now serialises the same object, so
 * the two halves of the result cannot disagree.
 */
export const schemaLookupOutput = {
  names: z.array(z.string()).optional().describe("Every definition name — returned when called with no `name`."),
  name: z.string().optional().describe("The definition that was looked up."),
  schema: z.unknown().optional().describe("That definition's full JSON schema."),
};

const triggerTypeInfo = z.object({
  category: z.string(),
  testable: z.boolean(),
  description: z.string(),
});

/** `ivedaai_alert_integration` — one shape spanning `list_types`, `test` and `apply`. */
export const alertIntegrationOutput = {
  types: z.record(triggerTypeInfo).optional().describe('From "list_types": every trigger type, keyed by name.'),
  outcome: z
    .string()
    .optional()
    .describe('From "test": success | unsupported | invalid_config | connection_failed | unknown.'),
  message: z.string().optional().describe('From "test": that verdict in plain language.'),
  httpStatus: z.number().optional().describe('From "test": what POST /api/alertTriggers answered.'),
  raw: z.unknown().optional().describe('From "test": that response, unedited.'),
  // From "apply", which returns the PATCH's own envelope alongside `preservation`.
  ...allOptional(apiResponseOutput),
  preservation: z
    .object({
      carriedForward: z.array(z.string()),
      unrecoverable: z.array(z.string()),
      note: z.string(),
    })
    .optional()
    .describe('From "apply": which of the rule\'s existing fields the update managed to re-send.'),
};

/** `ivedaai_add_camera`, which reports per camera and never fails the batch as a whole. */
export const addCameraOutput = {
  ainvrId: requiredUnknownOutput.describe("The ainvr/site the cameras were added under."),
  results: z
    .array(
      z.object({
        name: z.string(),
        outcome: z.string().describe("created | created_despite_error | invalid_spec | failed."),
        cameraId: z.unknown().optional(),
        warnings: z.array(z.string()).optional().describe("Fields this tool defaulted rather than took from the request."),
        note: z.string().optional(),
        status: z.number().optional().describe('On "failed": the status the create returned.'),
        error: z.unknown().optional(),
        activation: z.unknown().optional().describe("The activation job that was started, or why it was not."),
      })
    )
    .describe("One entry per requested camera, in the order given."),
};
