/**
 * Measures what this server costs a client before it does anything.
 *
 * Every MCP client loads all tool descriptions up front, so their combined size
 * is spent out of the context budget on connect, whether or not a single tool is
 * called. The design note in the README explains why 316 operations were folded
 * into one tool per resource — 316 tools would overwhelm most clients — but that
 * argument is about tool *count*. Nobody had measured the tokens, which is the
 * thing that actually gets consumed.
 *
 * A number in a README rots the moment the spec changes or another caution is
 * added, so this is a script rather than a claim. Run it before and after
 * anything that touches `describeTag`, `toolDocs`, or the warning tables.
 *
 * The token figures are chars/4, the usual rough English approximation. Good
 * enough to decide whether a budget is a problem; not a substitute for a real
 * tokeniser if you are close to a limit.
 *
 * Usage: npm run measure  (no deployment or credentials needed)
 */
import { z } from "zod";
import { toJsonSchemaCompat } from "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js";
import { loadSwagger, tagToToolName } from "../src/swagger.js";
import {
  describeTag,
  GET_SCHEMA_DESCRIPTION,
  ALERT_INTEGRATION_DESCRIPTION,
  ADD_CAMERA_DESCRIPTION,
} from "../src/toolDocs.js";
import { computeRoundTripGaps, roundTripWarning } from "../src/roundTrip.js";
import { policyFromEnv, allowedOperations } from "../src/accessPolicy.js";
import { lossyUpdateWarning } from "../src/partialUpdate.js";
import {
  apiResponseOutput,
  schemaLookupOutput,
  alertIntegrationOutput,
  addCameraOutput,
} from "../src/outputSchema.js";
import { capabilityNote } from "../src/capabilityNotes.js";

const ctx = loadSwagger();
const gaps = computeRoundTripGaps(ctx.spec);

const approxTokens = (chars: number) => Math.round(chars / 4);
const fmt = (n: number) => n.toLocaleString("en-US");

const perTool: Array<{ tool: string; tag: string; chars: number; ops: number }> = [];
let total = 0;

// Measured through the access policy, because that is what a client actually
// receives. The default policy withholds the collection-level DELETEs, so the
// raw spec total would overstate the budget by describing operations the server
// will not offer. Set IVEDAAI_READ_ONLY=true to measure a read-only deployment.
const policy = policyFromEnv();
for (const group of ctx.tags) {
  const operations = allowedOperations(group.operations, policy);
  if (operations.length === 0) continue;
  const chars = describeTag(ctx.spec, { ...group, operations }, gaps, ctx.useBundledFindings).length;
  total += chars;
  perTool.push({ tool: tagToToolName(group.tag), tag: group.tag, chars, ops: operations.length });
}

// What the live-testing cautions cost, kept separate because they are the part
// this project added on top of the generated baseline and so the part worth
// justifying.
let warningChars = 0;
let warnedOps = 0;
let totalOps = 0;
for (const group of ctx.tags) {
  for (const op of allowedOperations(group.operations, policy)) {
    totalOps++;
    if (!ctx.useBundledFindings) continue;
    const w = [capabilityNote(op.id), lossyUpdateWarning(op.id), roundTripWarning(gaps[op.id], op.id)]
      .filter(Boolean)
      .join(" ");
    if (w) {
      warningChars += w.length;
      warnedOps++;
    }
  }
}

/**
 * What the declared result shape costs, which descriptions alone no longer say.
 *
 * `outputSchema` is sent with every tool definition, so it is spent on connect
 * exactly like a description is — and because all 63 generated tools share one
 * envelope, the same JSON Schema is transmitted 63 times. That made it the
 * single easiest thing in this server to overspend on without noticing: the
 * first version of `apiResponseOutput` spelled out the innards of
 * `omittedFields` and cost 1,143 characters a tool, 72,009 in total, which is
 * more than every tool description put together.
 *
 * Converted here through the same call `McpServer` makes, with the same options,
 * so this is the real transmitted size rather than an estimate of it. An SDK
 * upgrade that moves this module should fail the build loudly — that is
 * preferable to this quietly reporting a number that is no longer what a client
 * receives.
 */
const outputSchemaChars = JSON.stringify(
  toJsonSchemaCompat(z.object(apiResponseOutput), { strictUnions: true, pipeStrategy: "output" })
).length;
const outputSchemaTotal = outputSchemaChars * perTool.length;

/**
 * The three hand-written tools, which this script used to leave out.
 *
 * It builds descriptions from the spec, so it saw the 63 generated tools and
 * nothing else — and admitted as much in a caveat that was easy to read past.
 * That mattered more than it sounds: `ivedaai_alert_integration` was for a while
 * the largest single tool of any kind, and trimming it by 6,207 characters moved
 * the number printed here by exactly zero. A budget the measuring tool cannot
 * see is not a budget, so these are counted now rather than disclaimed.
 *
 * Their descriptions live in `toolDocs.ts` for this reason; the registrations in
 * `index.ts` reference them. Each is paid once rather than 63 times, which is why
 * they are allowed prose the generated tools are not.
 */
const handWritten = [
  { tool: "ivedaai_get_schema", description: GET_SCHEMA_DESCRIPTION, output: schemaLookupOutput },
  { tool: "ivedaai_alert_integration", description: ALERT_INTEGRATION_DESCRIPTION, output: alertIntegrationOutput },
  { tool: "ivedaai_add_camera", description: ADD_CAMERA_DESCRIPTION, output: addCameraOutput },
].map((t) => ({
  ...t,
  chars: t.description.length,
  schemaChars: JSON.stringify(
    toJsonSchemaCompat(z.object(t.output), { strictUnions: true, pipeStrategy: "output" })
  ).length,
}));

const handWrittenChars = handWritten.reduce((n, t) => n + t.chars, 0);
const handWrittenSchemaChars = handWritten.reduce((n, t) => n + t.schemaChars, 0);
const connectTotal = total + outputSchemaTotal + handWrittenChars + handWrittenSchemaChars;

perTool.sort((a, b) => b.chars - a.chars);
const median = perTool[Math.floor(perTool.length / 2)].chars;

console.log(`\nTool-description budget — what a client loads on connect\n`);
console.log(`  tools:            ${perTool.length}`);
console.log(`  operations:       ${totalOps}`);
console.log(`  total:            ${fmt(total)} chars  (~${fmt(approxTokens(total))} tokens)`);
console.log(`                    (the 63 generated tools; the 3 hand-written ones are listed below)`);
console.log(`  mean per tool:    ${fmt(Math.round(total / perTool.length))} chars`);
console.log(`  median per tool:  ${fmt(median)} chars`);
console.log(
  `\n  output schemas:   ${fmt(outputSchemaTotal)} chars  (~${fmt(approxTokens(outputSchemaTotal))} tokens)` +
    `  — ${fmt(outputSchemaChars)} chars x ${perTool.length} tools, the same envelope each time`
);
console.log(`  descriptions + schemas: ${fmt(total + outputSchemaTotal)} chars  ` +
  `(~${fmt(approxTokens(total + outputSchemaTotal))} tokens)`);
console.log(
  `  hand-written:     ${fmt(handWrittenChars)} chars  (~${fmt(approxTokens(handWrittenChars))} tokens)  — 3 tools, ` +
    `plus ${fmt(handWrittenSchemaChars)} chars of their own output schemas`
);
for (const t of handWritten) {
  console.log(`                      ${t.tool.padEnd(28)} ${fmt(t.chars)} chars + ${fmt(t.schemaChars)} schema`);
}
console.log(
  `\n  EVERYTHING a client loads on connect: ${fmt(connectTotal)} chars  (~${fmt(approxTokens(connectTotal))} tokens)`
);
console.log(`\n  live-testing cautions: ${fmt(warningChars)} chars (~${fmt(approxTokens(warningChars))} tokens), ` +
  `${((warningChars / total) * 100).toFixed(1)}% of the total, across ${warnedOps} of ${totalOps} operations`);

console.log(`\n  largest tools:`);
for (const t of perTool.slice(0, 10)) {
  console.log(
    `    ${t.tool.padEnd(30)} ${fmt(t.chars).padStart(7)} chars  ~${fmt(approxTokens(t.chars)).padStart(6)} tok  ` +
      `(${t.ops} ops)`
  );
}

// A rough sense of what fraction of a session's budget this claims, since that is
// the decision the number actually informs.
console.log(`\n  as a share of a client's context window (descriptions + output schemas):`);
for (const window of [32_000, 128_000, 200_000, 1_000_000]) {
  const pct = (approxTokens(total + outputSchemaTotal) / window) * 100;
  console.log(`    ${fmt(window).padStart(9)} tokens: ${pct.toFixed(1)}%`);
}
console.log(
  `\n  Trimming this means moving detail out of the descriptions and leaning on\n` +
    `  ivedaai_get_schema instead, which trades startup context for extra round-trips\n` +
    `  mid-conversation. Whether that is a good trade depends on the client, so this\n` +
    `  script reports the number rather than assuming an answer.\n`
);
