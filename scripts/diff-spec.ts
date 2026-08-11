/**
 * Compares two IvedaAI spec files and reports what an upgrade would cost.
 *
 * Written when 10.0 arrived and the question was "do we start over?". Answering
 * it by hand took an afternoon of one-off scripts, and the answer — mostly no —
 * was not the valuable part. The valuable part was knowing *which* of this
 * repo's recorded findings still pointed at operations and definitions that
 * still exist, because that is the difference between a spec bump and a rewrite.
 * The next upgrade should be a command.
 *
 * Reads Swagger 2.0 and OpenAPI 3 on either side. 10.0 changed format as well as
 * content, and a diff that could only read one of them would have been useless
 * for the only comparison anyone wanted.
 *
 * WHAT IT CHECKS, and why the last section is the one that matters:
 *
 *   1. Operations added and removed.
 *   2. Tags added and removed — these decide the one-tool-per-resource split.
 *   3. Schemas gone, and schemas whose `required` set moved.
 *   4. Whether this repo's own knowledge tables still resolve.
 *
 * (4) is the point. `CONFIRMED_UPDATE_SEMANTICS`, `LOSSY_UPDATE_OPS` and the
 * round-trip tables all decide whether a *warning* fires. An entry keyed to an
 * operation the spec renamed does not error — it silently stops warning, and
 * looks identical to an endpoint that became safe. That is the failure mode this
 * script exists to make loud.
 *
 * A caution about (3), learned from the 10.0 diff: a `required` array getting
 * SHORTER is not evidence that a field became optional. 10.0 dropped
 * CameraRequest from twelve required fields to one, while the 9.3 server it
 * replaces silently rejects a body missing most of them with a bare
 * NullPointerException. Treat this section as a list of things to re-measure,
 * never as a reason to relax something that live testing established.
 *
 * Usage:
 *   npm run diff:spec -- --against path/to/api-docs-10.0.json
 *   npm run diff:spec -- --base path/to/old.json --against path/to/new.json
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { CONFIRMED_UPDATE_SEMANTICS, LOSSY_UPDATE_OPS } from "../src/partialUpdate.js";
import { knowledgeReferences } from "../src/roundTrip.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const argv = process.argv.slice(2);
function flag(name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

const basePath = flag("--base") ?? join(repoRoot, "resources", "openapi.json");
const againstPath = flag("--against");
if (!againstPath) {
  console.error("usage: npm run diff:spec -- --against <path to spec.json> [--base <path>]");
  process.exit(2);
}

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"];

interface Normalized {
  label: string;
  format: string;
  version: string;
  /** `METHOD /api/...` — the shape every table in this repo is keyed by. */
  operations: Set<string>;
  /** Definition name -> its `required` list. */
  schemas: Map<string, string[]>;
  tags: Set<string>;
}

/**
 * Flattens either spec format into the same shape.
 *
 * The path prefix is the subtlety. Swagger 2.0 carried `/ainvr` in `basePath`
 * and left it off every path; OpenAPI 3 has no `basePath`, so 10.0 folds it into
 * all 190 paths instead. The effective URL never changed, so the prefix is
 * stripped on both sides — otherwise every operation would read as removed and
 * re-added, and the diff would say "start over" about a rename.
 */
function normalize(raw: any, label: string): Normalized {
  const isV3 = typeof raw.openapi === "string";
  const declaredBase: string = isV3 ? "" : raw.basePath ?? "";

  const operations = new Set<string>();
  for (const [rawPath, item] of Object.entries<any>(raw.paths ?? {})) {
    let path = rawPath;
    // v2: basePath sits outside the path. v3: it has been folded in.
    if (!isV3 && declaredBase && path.startsWith(declaredBase)) path = path.slice(declaredBase.length);
    if (isV3) {
      for (const prefix of ["/ainvr"]) {
        if (path.startsWith(prefix)) path = path.slice(prefix.length);
      }
    }
    for (const m of HTTP_METHODS) if (item?.[m]) operations.add(`${m.toUpperCase()} ${path}`);
  }

  const schemaSource = isV3 ? raw.components?.schemas ?? {} : raw.definitions ?? {};
  const schemas = new Map<string, string[]>();
  for (const [name, def] of Object.entries<any>(schemaSource)) {
    schemas.set(name, [...(def?.required ?? [])].sort());
  }

  return {
    label,
    format: isV3 ? `OpenAPI ${raw.openapi}` : `Swagger ${raw.swagger}`,
    version: raw.info?.version ?? "?",
    operations,
    schemas,
    tags: new Set((raw.tags ?? []).map((t: any) => t.name)),
  };
}

const base = normalize(JSON.parse(readFileSync(basePath, "utf8")), basePath);
const next = normalize(JSON.parse(readFileSync(againstPath, "utf8")), againstPath);

const fmt = (n: number) => n.toLocaleString("en-US");
const bullet = (xs: string[], limit = 0) => {
  const shown = limit > 0 ? xs.slice(0, limit) : xs;
  for (const x of shown) console.log(`    ${x}`);
  if (limit > 0 && xs.length > limit) console.log(`    … ${xs.length - limit} more`);
  if (!xs.length) console.log("    (none)");
};

console.log(`\nbase    ${base.label}`);
console.log(`        ${base.format}, version ${base.version} — ${fmt(base.operations.size)} operations, ${fmt(base.schemas.size)} schemas`);
console.log(`against ${next.label}`);
console.log(`        ${next.format}, version ${next.version} — ${fmt(next.operations.size)} operations, ${fmt(next.schemas.size)} schemas`);

if (base.format !== next.format) {
  console.log(
    `\n!! FORMAT CHANGE: ${base.format} -> ${next.format}. src/swagger.ts parses the base format; adopting\n` +
      `   the target needs the loader taught to build the same Operation/ParamDef model from it.`
  );
}

const removedOps = [...base.operations].filter((o) => !next.operations.has(o)).sort();
const addedOps = [...next.operations].filter((o) => !base.operations.has(o)).sort();
console.log(`\n--- operations: ${fmt(base.operations.size - removedOps.length)} kept, ${removedOps.length} removed, ${addedOps.length} added`);
console.log(`  removed:`);
bullet(removedOps);
console.log(`  added:`);
bullet(addedOps, 25);

const removedTags = [...base.tags].filter((t) => !next.tags.has(t)).sort();
const addedTags = [...next.tags].filter((t) => !base.tags.has(t)).sort();
console.log(`\n--- tags: ${removedTags.length} removed, ${addedTags.length} added  (each tag is one MCP tool)`);
console.log(`  removed:`);
bullet(removedTags);
console.log(`  added:`);
bullet(addedTags);

const goneSchemas = [...base.schemas.keys()].filter((s) => !next.schemas.has(s)).sort();
const requiredChanged: string[] = [];
for (const [name, req] of base.schemas) {
  const other = next.schemas.get(name);
  if (!other) continue;
  if (JSON.stringify(req) !== JSON.stringify(other)) {
    const loosened = other.length < req.length ? "  <- LOOSENED" : "";
    requiredChanged.push(`${name}: [${req.join(", ")}] -> [${other.join(", ")}]${loosened}`);
  }
}
console.log(`\n--- schemas: ${goneSchemas.length} gone, ${requiredChanged.length} changed their required set`);
console.log(`  gone:`);
bullet(goneSchemas, 25);
console.log(`  required changed — treat as a list to RE-MEASURE, not as permission to relax anything:`);
bullet(requiredChanged, 40);

// ---------------------------------------------------------------- the point

console.log(`\n=== does this repo's recorded knowledge still resolve? ===`);
let dead = 0;

const checkOps = (label: string, ids: string[]) => {
  const missing = [...new Set(ids)].filter((id) => !next.operations.has(id)).sort();
  dead += missing.length;
  console.log(`\n  ${label}: ${new Set(ids).size} referenced, ${missing.length} dead`);
  for (const m of missing) console.log(`     DEAD  ${m}`);
};

const refs = knowledgeReferences();
checkOps("CONFIRMED_UPDATE_SEMANTICS", Object.keys(CONFIRMED_UPDATE_SEMANTICS));
checkOps("LOSSY_UPDATE_OPS (suppressing one of these silently disarms a guard)", Object.keys(LOSSY_UPDATE_OPS));
checkOps("round-trip read operations", refs.operations);

const deadDefs = refs.definitions.filter((d) => !next.schemas.has(d)).sort();
dead += deadDefs.length;
console.log(`\n  round-trip definitions: ${refs.definitions.length} referenced, ${deadDefs.length} dead`);
for (const d of deadDefs) console.log(`     DEAD  ${d}`);

console.log(
  dead === 0
    ? `\nAll recorded knowledge still resolves against the target spec. The upgrade is a port, not a rewrite.\n`
    : `\n${dead} recorded reference(s) point at something the target spec does not have. Each is a finding that\n` +
        `has to be re-established or retired — none of them will fail loudly on their own.\n`
);
