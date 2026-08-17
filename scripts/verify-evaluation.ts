/**
 * Recomputes every answer in the evaluation file from the bundled spec.
 *
 * An evaluation is only worth running if its answers are right, and these are
 * right *about resources/openapi.json* — "how many alert categories can be
 * reported but not requested" is a fact about the shipped document, not an
 * opinion. Which means a spec upgrade can silently turn the whole file into a
 * set of wrong answers, and the failure would look like the model getting worse
 * rather than the fixture going stale. This is what makes that impossible:
 * every answer is derived here from the same spec the server serves, and
 * compared against what the XML claims.
 *
 * Deliberately not a test of the *questions* — whether they are good, hard or
 * fair is a judgement, and this only checks the arithmetic underneath them.
 *
 * Usage: npm run verify:evals  (no deployment or credentials needed)
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadSwagger, schemaDefinitions, tagToToolName } from "../src/swagger.js";
import { allowedOperations, type AccessPolicy } from "../src/accessPolicy.js";
import { TRIGGER_TYPES } from "../src/alertTrigger.js";

// The evaluation describes the checked-in spec, never an operator-selected
// runtime document. Remove every runtime surface switch before loading it.
delete process.env.IVEDAAI_SWAGGER_PATH;
const ctx = loadSwagger();
const defs = schemaDefinitions(ctx.spec);
// Evaluation answers describe the documented default tool surface. Ambient
// operator policy must not change which answer the same checked-in file expects.
const policy: AccessPolicy = { readOnly: false, allowCollectionDelete: false };

const props = (name: string): Record<string, any> => defs[name]?.properties ?? {};
const required = (name: string): string[] => defs[name]?.required ?? [];

function operationsPerTool(): Array<[string, number]> {
  return ctx.tags
    .map((g) => [tagToToolName(g.tag), allowedOperations(g.operations, policy).length] as [string, number])
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
}

function findOperation(id: string) {
  for (const group of ctx.tags) {
    const op = group.operations.find((o) => o.id === id);
    if (op) return { op, tool: tagToToolName(group.tag) };
  }
  return undefined;
}

/**
 * Each answer, recomputed. Keyed by the opening words of its question so a
 * reordered file still lines up, and so a question edited beyond recognition
 * fails loudly rather than silently matching the wrong check.
 */
const derivations: Array<{ startsWith: string; derive: () => string }> = [
  {
    startsWith: "This system can report more kinds of alert",
    derive: () => {
      const reportable: string[] = props("Alert").alertType?.enum ?? [];
      const requestable: string[] = props("AlertRuleRequest").alertType?.enum ?? [];
      return String(reportable.filter((t) => !requestable.includes(t)).length);
    },
  },
  {
    startsWith: "Registering a camera requires supplying the outline",
    derive: () => {
      // CameraRequest.roiContour -> VoContour.contour[] -> the coordinate object.
      const roi = props("CameraRequest").roiContour;
      const outer = String(roi?.items?.$ref ?? "").split("/").pop() ?? "";
      const inner = props(outer).contour?.items?.$ref ?? "";
      return String(inner).split("/").pop() ?? "";
    },
  },
  {
    startsWith: "This server groups the API into one tool per resource",
    derive: () => {
      const ranked = operationsPerTool();
      // A tie would make the question ambiguous rather than merely wrong.
      if (ranked[0][1] === ranked[1][1]) throw new Error(`tie for most operations: ${ranked[0][0]} / ${ranked[1][0]}`);
      return ranked[0][0];
    },
  },
  {
    startsWith: "Alerts can be routed onward to external systems",
    derive: () => String(Object.values(TRIGGER_TYPES).filter((t) => t.testable).length),
  },
  {
    startsWith: "Exactly two of the onward-routing mechanisms",
    derive: () => {
      const untestable = Object.values(TRIGGER_TYPES).filter((t) => !t.testable);
      if (untestable.length !== 2) throw new Error(`question says two are untestable, spec has ${untestable.length}`);
      const categories = new Set(untestable.map((t) => t.category));
      if (categories.size !== 1) throw new Error(`the two untestable types no longer share a category`);
      return [...categories][0];
    },
  },
  {
    startsWith: "Routing alerts to a named third-party video management platform",
    derive: () => String(Object.keys(props("AlertTriggerNvr")).length),
  },
  {
    startsWith: "Creating the record for a camera is not on its own enough",
    derive: () => {
      const found = findOperation("POST /api/cameras/{cameraId}/jobs");
      if (!found) throw new Error("the camera activation operation is gone from the spec");
      const query = found.op.parameters.filter((p) => p.in === "query");
      if (query.length !== 1) throw new Error(`question says one query parameter, spec has ${query.length}`);
      return query[0].name;
    },
  },
  {
    startsWith: "A request for a list of records comes back holding fewer entries",
    derive: () => {
      const page = Object.keys(props("PageOfCamera"));
      const total = page.filter((f) => /^total(Elements)?$/.test(f));
      if (total.length !== 1) throw new Error(`expected one collection-total field, found ${total.join(", ")}`);
      // The question turns on there being a second, different count to confuse it with.
      if (!page.includes("numberOfElements")) throw new Error("the per-page count field is gone; the question no longer bites");
      return total[0];
    },
  },
  {
    startsWith: "Is it possible, using only the operations this server exposes",
    derive: () => String(Boolean(findOperation("GET /api/streaming/{cameraId}/{type}.jpg"))).replace(/^t/, "T"),
  },
  {
    startsWith: "Adding a new recording appliance to the system",
    derive: () => {
      const fields = required("AinvrRequest");
      if (fields.length !== 6) throw new Error(`question says six required fields, spec has ${fields.length}`);
      const reaching = new Set(["host", "port", "scheme", "username", "password"]);
      const rest = fields.filter((f) => !reaching.has(f));
      if (rest.length !== 1) throw new Error(`expected exactly one non-connection field, found ${rest.join(", ")}`);
      return rest[0];
    },
  },
];

const evalPath = fileURLToPath(new URL("../evaluations/tool-navigation.xml", import.meta.url));
const xml = readFileSync(evalPath, "utf8");
const pairs = [...xml.matchAll(/<qa_pair>\s*<question>([\s\S]*?)<\/question>\s*<answer>([\s\S]*?)<\/answer>\s*<\/qa_pair>/g)].map(
  (m) => ({ question: m[1].trim(), answer: m[2].trim() })
);

let failures = 0;

if (pairs.length !== derivations.length) {
  console.error(`✗ ${pairs.length} question(s) in the file, ${derivations.length} derivation(s) here — they must correspond.`);
  failures++;
}

for (const { startsWith, derive } of derivations) {
  const pair = pairs.find((p) => p.question.startsWith(startsWith));
  if (!pair) {
    console.error(`✗ no question beginning "${startsWith}"`);
    failures++;
    continue;
  }
  let derived: string;
  try {
    derived = derive();
  } catch (err) {
    console.error(`✗ ${startsWith}...\n    cannot derive an answer: ${err instanceof Error ? err.message : String(err)}`);
    failures++;
    continue;
  }
  if (derived !== pair.answer) {
    console.error(`✗ ${startsWith}...\n    file says "${pair.answer}", the spec says "${derived}"`);
    failures++;
  } else {
    console.log(`✓ ${pair.answer.padEnd(20)} ${startsWith}...`);
  }
}

console.log();
if (failures > 0) {
  console.error(
    `${failures} answer(s) no longer match resources/openapi.json. The spec has moved under the evaluation:\n` +
      `fix the answers, or rewrite the questions the change invalidated. Do not adjust this script to agree\n` +
      `with the file — deriving the answer from the spec is the only thing making the file trustworthy.`
  );
  process.exit(1);
}
console.log(`All ${pairs.length} answers still hold against IvedaAI ${ctx.spec.info?.version}.`);
