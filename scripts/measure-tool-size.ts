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
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { toJsonSchemaCompat } from "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js";
import { stripSchemaDialect } from "../src/schemaDialect.js";
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

/**
 * The schema as this server actually publishes it.
 *
 * The SDK's converter stamps a dialect declaration that the transport strips
 * before the response leaves — see src/schemaDialect.ts. Counting it here would
 * charge the budget 6,864 characters that no client ever receives.
 */
function publishedSchema(shape: Parameters<typeof z.object>[0]): string {
  const schema = toJsonSchemaCompat(z.object(shape), { strictUnions: true, pipeStrategy: "output" });
  stripSchemaDialect(schema);
  return JSON.stringify(schema);
}

const outputSchemaChars = publishedSchema(apiResponseOutput).length;
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
  schemaChars: publishedSchema(t.output).length,
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
/**
 * What a client is actually sent, taken from the server rather than rebuilt.
 *
 * Everything above this line is reconstructed: the descriptions are regenerated
 * from the spec and the output schemas converted a second time. That is useful
 * for attribution — it says where the characters go — but it can only count the
 * things it knows to look for, and for a long time it did not know to look for
 * `inputSchema` at all. It was reporting 106,001 characters against a real
 * 190,727: **44% low**, and every budget figure quoted in this repository, the
 * changelog and the hand-off inherited that error.
 *
 * The lesson is the one the startup banner taught the same week. A description
 * of what a program does can disagree with the program; a reading of the program
 * cannot. So the authoritative figure now comes from `tools/list` on a real
 * server, and the reconstruction is checked against it rather than trusted.
 *
 * The server is spawned with an unreachable base URL and junk credentials — it
 * builds its tool list from the bundled spec and opens no connection to do it.
 * IVEDAAI_READ_ONLY passes through, so a read-only budget still measures the
 * read-only surface.
 */
interface ListedTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  annotations?: unknown;
}

async function toolsListFromServer(): Promise<{ tools: ListedTool[]; wholeResult: number }> {
  const dist = fileURLToPath(new URL("../dist/index.js", import.meta.url));
  if (!existsSync(dist)) {
    console.error(
      "measure: dist/index.js not found. This script now reads the real tools/list rather than\n" +
        "rebuilding it, so the server has to be built first: npm run build"
    );
    process.exit(1);
  }

  const child = spawn(process.execPath, [dist], {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      IVEDAAI_BASE_URL: "http://127.0.0.1:1",
      IVEDAAI_USERNAME: "unused",
      IVEDAAI_PASSWORD: "unused",
    },
  });
  child.stderr.resume();

  let buffer = "";
  const pending = new Map<number, (m: Record<string, unknown>) => void>();
  child.stdout.on("data", (chunk: Buffer) => {
    buffer += chunk.toString();
    let cut: number;
    while ((cut = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, cut).trim();
      buffer = buffer.slice(cut + 1);
      if (!line) continue;
      try {
        const message = JSON.parse(line) as { id?: number };
        const resolve = typeof message.id === "number" ? pending.get(message.id) : undefined;
        if (resolve) {
          pending.delete(message.id as number);
          resolve(message as Record<string, unknown>);
        }
      } catch {
        // stdout belongs to JSON-RPC; anything else is not ours to interpret.
      }
    }
  });

  const send = (id: number, method: string, params: unknown) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      pending.set(id, resolve);
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
      setTimeout(() => reject(new Error(`measure: timed out waiting for ${method}`)), 30_000);
    });

  try {
    await send(1, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "measure", version: "0" },
    });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    const listed = await send(2, "tools/list", {});
    const result = (listed.result ?? {}) as { tools?: ListedTool[] };
    return { tools: result.tools ?? [], wholeResult: JSON.stringify(result).length };
  } finally {
    child.kill();
  }
}

const { tools: listedTools, wholeResult } = await toolsListFromServer();

const jsonSize = (value: unknown) => (value === undefined ? 0 : JSON.stringify(value).length);
let realDescriptions = 0;
let realInput = 0;
let realOutput = 0;
let realNamesAndAnnotations = 0;
let realOperationEnums = 0;
for (const tool of listedTools) {
  realDescriptions += (tool.description ?? "").length + (tool.title ?? "").length;
  realInput += jsonSize(tool.inputSchema);
  realOutput += jsonSize(tool.outputSchema);
  realNamesAndAnnotations += tool.name.length + jsonSize(tool.annotations);
  const operationEnum = (tool.inputSchema as { properties?: { operation?: { enum?: unknown } } } | undefined)
    ?.properties?.operation?.enum;
  realOperationEnums += jsonSize(operationEnum);
}

console.log(`\n  WHAT A CLIENT ACTUALLY RECEIVES (tools/list, ${listedTools.length} tools)\n`);
const line = (label: string, chars: number) =>
  console.log(
    `    ${label.padEnd(26)} ${fmt(chars).padStart(8)} chars  ~${fmt(approxTokens(chars)).padStart(6)} tok  ` +
      `${((chars / wholeResult) * 100).toFixed(0).padStart(3)}%`
  );
line("descriptions + titles", realDescriptions);
line("input schemas", realInput);
console.log(`      of which operation enums ${fmt(realOperationEnums).padStart(6)} chars`);
line("output schemas", realOutput);
line("names + annotations", realNamesAndAnnotations);
console.log(`    ${"-".repeat(56)}`);
line("TOTAL on connect", wholeResult);

// The reconstruction above is only worth keeping if it still describes the
// server. This is the check that says so.
const gap = wholeResult - connectTotal;
console.log(
  `\n  reconstructed above: ${fmt(connectTotal)} chars — ` +
    `${gap === 0 ? "reconciled" : `${fmt(gap)} chars short (${((gap / wholeResult) * 100).toFixed(0)}%)`}`
);
console.log(
  `    The gap is structural, not an error: the breakdown above attributes\n` +
    `    descriptions and output schemas, and does not model input schemas,\n` +
    `    tool names or annotations. Use the TOTAL for budget decisions and the\n` +
    `    breakdown for deciding what to trim.`
);

console.log(`\n  live-testing cautions: ${fmt(warningChars)} chars (~${fmt(approxTokens(warningChars))} tokens), ` +
  `${((warningChars / wholeResult) * 100).toFixed(1)}% of what a client receives, across ${warnedOps} of ${totalOps} operations`);

console.log(`\n  largest tools by description:`);
for (const t of perTool.slice(0, 10)) {
  console.log(
    `    ${t.tool.padEnd(30)} ${fmt(t.chars).padStart(7)} chars  ~${fmt(approxTokens(t.chars)).padStart(6)} tok  ` +
      `(${t.ops} ops)`
  );
}

// A rough sense of what fraction of a session's budget this claims, since that is
// the decision the number actually informs. Measured against the real total, not
// the reconstruction — the earlier figures were computed on a base 44% too small.
console.log(`\n  as a share of a client's context window:`);
for (const window of [32_000, 128_000, 200_000, 1_000_000]) {
  const pct = (approxTokens(wholeResult) / window) * 100;
  console.log(`    ${fmt(window).padStart(9)} tokens: ${pct.toFixed(1)}%`);
}
console.log(
  `\n  Trimming this means moving detail out of the descriptions and leaning on\n` +
    `  ivedaai_get_schema instead, which trades startup context for extra round-trips\n` +
    `  mid-conversation. Whether that is a good trade depends on the client, so this\n` +
    `  script reports the number rather than assuming an answer.\n`
);
