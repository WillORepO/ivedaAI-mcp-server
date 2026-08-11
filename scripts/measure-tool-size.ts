/**
 * Measures what this server costs a client before it does anything.
 *
 * Every MCP client loads all tool descriptions up front, so their combined size
 * is spent out of the context budget on connect, whether or not a single tool is
 * called. The design note in the README explains why 315 operations were folded
 * into one tool per resource — 315 tools would overwhelm most clients — but that
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
import { loadSwagger, tagToToolName } from "../src/swagger.js";
import { describeTag } from "../src/toolDocs.js";
import { computeRoundTripGaps, roundTripWarning } from "../src/roundTrip.js";
import { policyFromEnv, allowedOperations } from "../src/accessPolicy.js";
import { lossyUpdateWarning } from "../src/partialUpdate.js";

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
  const chars = describeTag(ctx.spec, { ...group, operations }, gaps).length;
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
  for (const op of group.operations) {
    totalOps++;
    const w = [lossyUpdateWarning(op.id), roundTripWarning(gaps[op.id], op.id)].filter(Boolean).join(" ");
    if (w) {
      warningChars += w.length;
      warnedOps++;
    }
  }
}

perTool.sort((a, b) => b.chars - a.chars);
const median = perTool[Math.floor(perTool.length / 2)].chars;

console.log(`\nTool-description budget — what a client loads on connect\n`);
console.log(`  tools:            ${perTool.length}`);
console.log(`  operations:       ${totalOps}`);
console.log(`  total:            ${fmt(total)} chars  (~${fmt(approxTokens(total))} tokens)`);
console.log(`  mean per tool:    ${fmt(Math.round(total / perTool.length))} chars`);
console.log(`  median per tool:  ${fmt(median)} chars`);
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
console.log(`\n  as a share of a client's context window:`);
for (const window of [32_000, 128_000, 200_000, 1_000_000]) {
  const pct = (approxTokens(total) / window) * 100;
  console.log(`    ${fmt(window).padStart(9)} tokens: ${pct.toFixed(1)}%`);
}
console.log(
  `\n  Trimming this means moving detail out of the descriptions and leaning on\n` +
    `  ivedaai_get_schema instead, which trades startup context for extra round-trips\n` +
    `  mid-conversation. Whether that is a good trade depends on the client, so this\n` +
    `  script reports the number rather than assuming an answer.\n`
);
