/**
 * Removing the JSON Schema dialect declaration from published tool schemas.
 *
 * The SDK converts Zod schemas with a vendored converter that stamps
 * `"$schema": "http://json-schema.org/draft-07/schema#"` onto every result. It
 * does so on both the Zod v3 and v4 branches, and `McpServer` exposes no way to
 * change the target. SDK 1.30 is byte-identical on this path, so there is
 * nothing to upgrade to.
 *
 * That declaration makes every tool in this server uncallable from a client
 * whose validator implements 2020-12 only:
 *
 *     Tool 'ivedaai_license' has an invalid outputSchema: JSON Schema declares
 *     an unsupported dialect ("$schema": "http://json-schema.org/draft-07/
 *     schema#"). The default validator supports JSON Schema 2020-12 only
 *
 * The refusal happens before the request is built, so it is not a failed call —
 * the tool cannot be invoked at all. Found live, against a real client, with all
 * 66 tools rejected through both `inputSchema` and `outputSchema`.
 *
 * Dropping the declaration is safe because these schemas are dialect-neutral.
 * They use `type`, `properties`, `required`, `additionalProperties`, `items`
 * and `description`, which mean the same thing in draft-07 and in 2020-12. A
 * schema carrying no `$schema` is read as the validator's own dialect, which is
 * the behaviour we want from every client rather than from one.
 *
 * It is also 6,864 characters off the connect payload — the largest thing in
 * the published schemas that said nothing about this API.
 *
 * Lives in its own module so that `scripts/measure-tool-size.ts` can apply the
 * same removal. That script measures the real transmitted size by running the
 * SDK's own converter; without this it would keep counting bytes the server no
 * longer sends, and the budget instrument would quietly stop matching the wire.
 */

/** Strips the dialect declaration from one schema object, in place. */
export function stripSchemaDialect(schema: unknown): void {
  if (schema && typeof schema === "object" && "$schema" in schema) {
    delete (schema as Record<string, unknown>).$schema;
  }
}

/**
 * Strips the declaration from every schema in a `tools/list` result, in place.
 *
 * Applied at the transport rather than at registration because the conversion
 * happens inside the SDK when the response is built — there is no earlier point
 * at which the generated schema exists to edit. Anything that is not a
 * `tools/list` result passes through untouched.
 */
export function stripDialectsFromToolList(message: unknown): void {
  if (!message || typeof message !== "object") return;
  const result = (message as { result?: unknown }).result;
  if (!result || typeof result !== "object") return;
  const tools = (result as { tools?: unknown }).tools;
  if (!Array.isArray(tools)) return;
  for (const tool of tools) {
    if (!tool || typeof tool !== "object") continue;
    stripSchemaDialect((tool as { inputSchema?: unknown }).inputSchema);
    stripSchemaDialect((tool as { outputSchema?: unknown }).outputSchema);
  }
}
