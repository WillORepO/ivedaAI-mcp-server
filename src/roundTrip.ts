/**
 * Finds update operations whose request body accepts fields you cannot simply
 * read back — and, where the value *is* readable under another name, says where.
 *
 * One endpoint here nulls fields the body omits — `PATCH
 * /api/user-groups/{userGroupId}` provably does — and the remedy for that is to
 * read the record first and send the complete object. That remedy assumes the
 * read hands back what the write accepts, keyed the same way. On this API it very
 * often does not.
 *
 * Whether a given endpoint needs the remedy at all is a separate question, and
 * not one the verb answers: `PATCH /api/alertRules/{alertRuleId}` was tested
 * against a throwaway rule and *merges*, leaving every omitted field alone. See
 * `CONFIRMED_UPDATE_SEMANTICS` in src/partialUpdate.ts — the warnings below are
 * phrased from it, so an endpoint known to merge does not get told it might lose
 * data.
 *
 * A first pass compared request and response field *names* and concluded that 16
 * operations had unpreservable fields — including, alarmingly, that
 * `PATCH /api/rois/{roiId}` could not preserve `roiContour`, a region's own
 * geometry. Checking that against a live deployment showed the conclusion was
 * wrong, and wrong in an informative way. `GET /api/rois/{roiId}` does return the
 * geometry; it calls it `region[].contour`. It returns the name as `eventName`,
 * `isEnabled` as `enabled`, `excludeRoiContour` as `excludedRegion`. All nine
 * "unpreservable" ROI fields are in fact readable.
 *
 * The pattern, confirmed across every resource checked, is that this API's read
 * and write models are deliberately different shapes:
 *
 *   - ids expand into objects: `nvrId` → `nvr.nvrId`, `userGroupId` →
 *     `userGroup.userGroupId`, `brandId` → `brand.brandId`
 *   - fields are renamed: `name` → `alertName`, `enableForever` →
 *     `schedule.forever`, `isEnabled` → `enabled`
 *   - several request fields collapse into one composite: `query`, `cameraIds`
 *     and `type` all live inside `expression`; an alert rule's `roiIds`,
 *     `cameraIds`, `hashtags`, `typeLogic` and `cooldownInterval` inside
 *     `condition`, which is itself a JSON *string* rather than an object, and
 *     whose contents vary with the rule's `alertType`
 *
 * So a name diff on its own badly overstates the risk. What it produces is a set
 * of *candidates*, which then have to be resolved against a real server. The
 * table below records that resolution: for each field, where the value actually
 * turned up. Everything in it was read from a live deployment via
 * `npm run validate:roundtrip`, which re-checks these mappings against real
 * responses and fails if one stops holding.
 *
 * What is left after resolution — fields with no identified equivalent — is a
 * much smaller and more believable set, and is what still warrants a warning.
 */

import { updateSemantics } from "./partialUpdate.js";
import { asObject, objectEntries, type JsonObject, type SchemaNode } from "./swagger.js";
import { schemaDefinitions, requestBodySchema, successResponseSchema } from "./swagger.js";

/** Where a request field's value actually appears in the read response. */
export interface RenamedField {
  field: string;
  /** Dotted path into the response body, `[]` marking an array hop. */
  readAt: string;
}

/** A field readable only by calling a different endpoint. */
export interface SubresourceField {
  field: string;
  /** The operation that returns it, e.g. `GET /api/user-groups/{userGroupId}/accounts`. */
  readOp: string;
  /** Where the value sits in that operation's response. */
  readAt: string;
}

export interface RoundTripGap {
  /** Readable, but under a different key — the caller just has to look there. */
  renamed: RenamedField[];
  /** Readable, but only by calling a second endpoint. */
  viaSubresource: SubresourceField[];
  /** No equivalent identified in the response. Genuinely at risk. */
  unreadable: string[];
  /** The read operation compared against. */
  readOp: string;
  requestDef: string;
  responseDef: string;
}

/**
 * Live-verified locations for request fields the response keys differently.
 * Keyed by request definition. Every entry here was confirmed by reading a real
 * record on a live deployment, not inferred from the spec — `validate:roundtrip`
 * re-checks each one and reports any that no longer resolve.
 */
const READ_LOCATIONS: Record<string, Record<string, string>> = {
  // `condition` is a JSON-encoded string, not a nested object, and it carries far
  // more of the request than its name suggests — which of these keys are present
  // depends on the rule's alertType. Observed on live rules:
  //   INTRUSION:    {"…","roiIds":[6,7,8,9,10],"typeLogic":"and","cooldownInterval":1}
  //   VIDEO_SEARCH: {"…","cameras":[37,39,…],"hashtagIds":[15],"hashtags":["shoplifting3"],
  //                  "typeLogic":"and","cooldownInterval":0}
  // So `cameraIds` reads back as `cameras`, and a rule of the wrong type simply
  // won't carry the key — validate:roundtrip reports that as unverified rather
  // than broken.
  AlertRuleRequest: {
    name: "alertName",
    abnormalTypes: "condition (JSON string).abnormalTypes",
    roiIds: "condition (JSON string).roiIds",
    cameraIds: "condition (JSON string).cameras",
    hashtags: "condition (JSON string).hashtags",
    typeLogic: "condition (JSON string).typeLogic",
    cooldownInterval: "condition (JSON string).cooldownInterval",
    weekdays: "schedule.weekdays",
    enableForever: "schedule.forever",
  },
  // Observed: expression = {cameraIds:[], query:"person and cat …", type:"basic"}.
  // This is why the CRUD probe saw the filter's query echoed back as
  // `expression.query` rather than at the top level.
  FilterRequest: {
    query: "expression.query",
    cameraIds: "expression.cameraIds",
    type: "expression.type",
  },
  CameraRequest: {
    nvrId: "nvr.nvrId",
    cameraGroupIds: "cameraGroups[].cameraGroupId",
  },
  AccountRequest: {
    userGroupId: "userGroup.userGroupId",
  },
  NvrRequest: {
    brandId: "brand.brandId",
  },
  // Plural on the request, singular on the response, and an array on both —
  // creating a profile with engineModelIds: [1] reads back as engineModelId: [1].
  // Observed by probe:semantics, which was watching this field to test the
  // endpoint's omission behaviour and incidentally established where it lives.
  EngineProfileRequest: {
    engineModelIds: "engineModelId",
  },
  CameraGroupRequest: {
    // Only on the item read: GET /api/camera-groups answers `cameras: null`
    // (alongside a non-zero numberOfCameras), while
    // GET /api/camera-groups/{cameraGroupId} returns the full array — even
    // though the spec declares no response schema for it at all.
    cameraIds: "cameras[].cameraId (item read only — the collection read returns null)",
  },
  // The same id-expands-into-an-object shape as RoiRequest below. Surfaced by
  // the 10.0 spec, which declares a `LineSet` response carrying `camera` as a
  // nested object while the request takes a flat `cameraId`; 9.3's response
  // schema was vague enough that no gap was computed at all. Live-confirmed
  // rather than inferred from that change: `GET /api/lineSets` returns
  // `camera: {cameraId: 272, name: "Front Entrance", …}` per record, read off
  // the deployment on 2026-07-29 while establishing the line1/line2 format.
  LineSetRequest: {
    cameraId: "camera.cameraId",
  },
  RoiRequest: {
    cameraId: "camera.cameraId",
    type: "eventType",
    name: "eventName",
    roiContour: "region[].contour",
    parameter: "parameters",
    condition: "types",
    conditionLogic: "logical",
    isEnabled: "enabled",
    excludeRoiContour: "excludedRegion",
  },
};

/**
 * Fields the record itself never carries, readable only from a second endpoint.
 *
 * A relation exposed as a sub-resource rather than an array on the parent. This
 * matters because the difference between "you cannot read this back" and "read it
 * from over there" is the difference between a warning a caller can act on and one
 * they can only worry about — and the first version of this check said the former
 * about `accountIds`, while `GET /api/user-groups/{userGroupId}/accounts` sat
 * there returning exactly that.
 *
 * Live-verified like the rest: `validate:roundtrip` calls the named operation and
 * checks the field actually shows up in its response.
 */
const READ_VIA_OPERATION: Record<string, Record<string, { readOp: string; readAt: string }>> = {
  UserGroupRequest: {
    // Returns full account records; the ids are on them. Confirmed against a
    // populated group — the empty "Undefined" group tells you nothing, which is
    // why a sweep that happens to sample it concludes the field is unreadable.
    accountIds: {
      readOp: "GET /api/user-groups/{userGroupId}/accounts",
      readAt: "content[].accountId",
    },
  },
};

/**
 * Fields a response definition omits but the server actually returns, so the
 * spec understates what is readable. Keyed by response definition.
 *
 * `LineSet` is the one case found where the fields come back under their own
 * names and the schema simply fails to mention them.
 */
const SPEC_UNDERSTATES_RESPONSE: Record<string, string[]> = {
  LineSet: ["objectTypes", "inCountingEnabled", "outCountingEnabled"],
};

/**
 * Every spec name the tables in this file depend on.
 *
 * Exposed so `npm run diff:spec` can ask, of a spec upgrade, whether anything
 * recorded here now points at something that no longer exists. The tables
 * themselves stay private: what a caller needs is the question "does this still
 * resolve", not the ability to edit the answers.
 *
 * A dead reference here is silent and dangerous in a specific way — these tables
 * decide whether a *warning* fires, so an entry keyed to a definition the spec
 * renamed stops warning and looks exactly like an endpoint that became safe.
 */
export function knowledgeReferences(): { definitions: string[]; operations: string[] } {
  const definitions = new Set<string>([
    ...Object.keys(READ_LOCATIONS),
    ...Object.keys(READ_VIA_OPERATION),
    ...Object.keys(SPEC_UNDERSTATES_RESPONSE),
    ...Object.keys(WRITE_ONLY_FIELDS),
  ]);
  const operations = new Set<string>();
  for (const byField of Object.values(READ_VIA_OPERATION)) {
    for (const entry of Object.values(byField)) operations.add(entry.readOp);
  }
  return { definitions: [...definitions].sort(), operations: [...operations].sort() };
}

/**
 * Fields a request is *supposed* to accept without the read echoing them back:
 * credentials a well-behaved API never returns, and paths the server manages.
 */
const WRITE_ONLY_FIELDS: Record<string, string[]> = {
  AccountRequest: ["password"],
  AinvrRequest: ["username", "password"],
  NvrRequest: ["username", "password"],
  VoPlugin: ["filePath", "tempPath"],
};

/**
 * Operations excluded outright. Bulk/action endpoints whose body is a command
 * rather than a record, so "the read didn't return this field" is meaningless —
 * `alertIds` is a list of targets to act on, not a property of an alert.
 */
const NOT_RECORD_UPDATES: Record<string, string> = {
  "PUT /api/alerts": "bulk state change; the body selects alerts to act on rather than describing one",
  "PUT /api/camera-groups/{cameraGroupId}/cameras": "membership action, not a record update",
};

function refName(ref: string | undefined): string | undefined {
  return ref ? ref.split("/").pop() : undefined;
}

function schemaRefOf(schema: SchemaNode | undefined): string | undefined {
  return refName(typeof schema?.$ref === "string" ? schema.$ref : undefined);
}

function propsOf(spec: JsonObject, defName: string | undefined): string[] | undefined {
  if (!defName) return undefined;
  const def = schemaDefinitions(spec)[defName];
  if (!def?.properties) return undefined;
  return Object.keys(def.properties);
}

/**
 * Unwraps a paged wrapper (`PageX` — `{content: X[], …}`) to the item
 * definition, so a resource readable only through its collection endpoint still
 * counts as readable.
 */
function itemDefOf(spec: JsonObject, defName: string | undefined): string | undefined {
  if (!defName) return undefined;
  const content = schemaDefinitions(spec)[defName]?.properties?.content;
  if (content?.type === "array" && content.items?.$ref) return refName(content.items.$ref);
  return defName;
}

/**
 * The best read available for a written path: the item `GET` on the same path,
 * falling back to the collection `GET` on its parent.
 *
 * The fallback is load-bearing. `PUT`/`PATCH /api/user-groups/{userGroupId}`
 * have no item `GET` at all, and without it every field would be reported
 * unreadable — including `externalId`, which is readable via
 * `GET /api/user-groups` and which the lossy-update guard already tells callers
 * to fetch and resend.
 */
function findReadFor(spec: JsonObject, path: string): { readOp: string; defName: string } | undefined {
  const candidates = [path, path.replace(/\/\{[^}]+\}$/, "")];
  for (const candidate of candidates) {
    const get = asObject(asObject(spec.paths)?.[candidate])?.get;
    if (!get) continue;
    const defName = itemDefOf(spec, schemaRefOf(successResponseSchema(get)));
    if (defName && propsOf(spec, defName)) return { readOp: `GET ${candidate}`, defName };
  }
  return undefined;
}

/** Derives the read/write gap for every body-taking update operation in the spec. */
export function computeRoundTripGaps(spec: JsonObject): Record<string, RoundTripGap> {
  const gaps: Record<string, RoundTripGap> = {};

  for (const [path, pathItem] of objectEntries(spec.paths)) {
    for (const method of ["put", "patch"]) {
      const op = asObject(pathItem)?.[method];
      if (!op) continue;

      const opId = `${method.toUpperCase()} ${path}`;
      if (NOT_RECORD_UPDATES[opId]) continue;

      const requestDef = schemaRefOf(requestBodySchema(op));
      const requestProps = propsOf(spec, requestDef);
      if (!requestDef || !requestProps) continue;

      const read = findReadFor(spec, path);
      // No readable schema at all is a different and worse situation, and not
      // one this check can quantify — it would have to report every field,
      // which is more alarm than information. Skipped deliberately.
      if (!read) continue;

      const readable = new Set([
        ...(propsOf(spec, read.defName) ?? []),
        ...(SPEC_UNDERSTATES_RESPONSE[read.defName] ?? []),
      ]);
      const writeOnly = new Set(WRITE_ONLY_FIELDS[requestDef] ?? []);
      const locations = READ_LOCATIONS[requestDef] ?? {};

      const subresources = READ_VIA_OPERATION[requestDef] ?? {};

      const candidates = requestProps.filter((f) => !readable.has(f) && !writeOnly.has(f));
      const renamed = candidates.filter((f) => locations[f]).map((f) => ({ field: f, readAt: locations[f] }));
      const viaSubresource = candidates
        .filter((f) => !locations[f] && subresources[f])
        .map((f) => ({ field: f, ...subresources[f] }));
      const unreadable = candidates.filter((f) => !locations[f] && !subresources[f]);

      if (renamed.length === 0 && viaSubresource.length === 0 && unreadable.length === 0) continue;
      gaps[opId] = { renamed, viaSubresource, unreadable, readOp: read.readOp, requestDef, responseDef: read.defName };
    }
  }

  return gaps;
}

export interface RoundTripRisk {
  /** Omitted, but readable elsewhere in the response — fetch and resend. */
  recoverable: RenamedField[];
  /** Omitted, but readable by calling a second endpoint. */
  viaSubresource: SubresourceField[];
  /** Omitted with no known way to read the current value. */
  unrecoverable: string[];
}

/** Splits the fields a given body leaves out by whether they can be recovered. */
export function fieldsAtRisk(gap: RoundTripGap | undefined, body: unknown): RoundTripRisk {
  if (!gap) return { recoverable: [], viaSubresource: [], unrecoverable: [] };
  const omitted = (field: string) => {
    if (body === null || typeof body !== "object" || Array.isArray(body)) return true;
    return (body as Record<string, unknown>)[field] === undefined;
  };
  return {
    recoverable: gap.renamed.filter((r) => omitted(r.field)),
    viaSubresource: gap.viaSubresource.filter((r) => omitted(r.field)),
    unrecoverable: gap.unreadable.filter(omitted),
  };
}

/** Outcome of checking one claimed read location against one real record. */
export type MappingStatus = "held" | "unverified" | "broken";

export interface SubresourceAttempt {
  status: MappingStatus;
  detail?: string;
}

/**
 * Reduces per-record attempts to one verdict.
 *
 * Status-driven on purpose. A first version inferred the verdict by pattern
 * matching the detail *string* — treating anything that did not look like an HTTP
 * code or the word "empty" as broken — which quietly reclassified a perfectly
 * ordinary `no "accountId" inside "content" on this record` as a broken mapping.
 * That is the same false alarm the retry loop exists to prevent, reintroduced one
 * layer up, so the statuses are now carried through rather than reconstructed.
 *
 * Any record resolving the path proves the mapping. Failing that, only a
 * structurally wrong path counts as broken; a 4xx, an unset field or an empty
 * collection leaves it untested.
 */
export function classifySubresource(attempts: SubresourceAttempt[]): SubresourceAttempt {
  if (attempts.length === 0) return { status: "unverified", detail: "no record could be read" };
  const held = attempts.find((a) => a.status === "held");
  if (held) return held;
  const broken = attempts.find((a) => a.status === "broken");
  if (broken) return broken;
  return attempts.find((a) => a.detail) ?? { status: "unverified", detail: "no record could be read" };
}


/** Whether anything is actually at risk, so callers can stay quiet when not. */
export function hasRisk(risk: RoundTripRisk): boolean {
  return risk.recoverable.length > 0 || risk.viaSubresource.length > 0 || risk.unrecoverable.length > 0;
}

/**
 * The note attached to a write that omits fields it could not trivially read back.
 *
 * Takes `opId` so it can say what the endpoint actually does, rather than warning
 * generically. Without it this told callers on a confirmed-merging endpoint that
 * their values "cannot be read back to preserve them" while the tool description
 * for the same operation said omitted fields are left alone — two contradictory
 * claims on one call, which teaches a caller to ignore both.
 */
export function roundTripNote(gap: RoundTripGap, risk: RoundTripRisk, opId?: string): string {
  const semantics = opId ? updateSemantics(opId) : "unknown";
  const parts: string[] = [];

  // Which of the three clauses comes first depends on what this body omitted, so
  // "also" cannot be baked into any of them: a note whose only clause opens "It
  // also omits" refers back to nothing.
  const omits = (existing: string[]) => (existing.length === 0 ? "This body omits" : "It also omits");

  if (risk.recoverable.length > 0) {
    const one = risk.recoverable.length === 1;
    const advice =
      semantics === "merges"
        ? `This endpoint has been confirmed to leave omitted fields alone, so ${one ? "it survives" : "they survive"} ` +
          `this call — that location is where to read ${one ? "it" : "them"} if you need the value.`
        : semantics === "rejects-partial"
          ? `This endpoint refuses partial bodies, so the call will fail until the full object is sent; read ` +
            `${one ? "it" : "them"} from there.`
          : `Read the current ${one ? "value" : "values"} from there and include ${one ? "it" : "them"} in the update ` +
            `rather than leaving ${one ? "it" : "them"} out.`;
    parts.push(
      `${omits(parts)} ${risk.recoverable.map((r) => `"${r.field}"`).join(", ")}, which ${gap.readOp} does return ` +
        `but under a different key — ${risk.recoverable.map((r) => `"${r.field}" is at ${r.readAt}`).join("; ")}. ${advice}`
    );
  }

  if (risk.viaSubresource.length > 0) {
    const one = risk.viaSubresource.length === 1;
    parts.push(
      `${omits(parts)} ${risk.viaSubresource.map((r) => `"${r.field}"`).join(", ")}, which the record does not carry ` +
        `but a second endpoint does — ${risk.viaSubresource.map((r) => `${r.readOp} (${r.readAt})`).join("; ")}. ` +
        `Read ${one ? "it" : "them"} there if you need the current ${one ? "value" : "values"}.`
    );
  }

  if (risk.unrecoverable.length > 0) {
    const one = risk.unrecoverable.length === 1;
    const consequence =
      semantics === "merges"
        ? `${one ? "It" : "They"} cannot be read back, but this endpoint keeps omitted fields, so ` +
          `${one ? "it is" : "they are"} unaffected by this call.`
        : semantics === "rejects-partial"
          ? `${one ? "It" : "They"} cannot be read back — and this endpoint refuses partial bodies, so the call ` +
            `will fail rather than apply anything.`
          : `So the current ${one ? "value" : "values"} cannot be read back to preserve ${one ? "it" : "them"}. Set ` +
            `${one ? "it" : "them"} explicitly if ${one ? "it matters" : "they matter"}, and verify the record afterwards.`;
    parts.push(
      `${omits(parts)} ${risk.unrecoverable.map((f) => `"${f}"`).join(", ")}, for which no equivalent has been found ` +
        `in ${gap.readOp}. ${consequence} Note that composite fields on this API can carry request fields inside ` +
        `them (an alert rule's "condition" is a JSON string holding "roiIds", "cameras", "hashtags" and more), so a ` +
        `value may be present somewhere not yet identified.`
    );
  }

  return parts.join(" ");
}

/**
 * The same caution, for the operation's entry in the generated tool description.
 *
 * Phrasing follows what live testing established about the operation, because
 * "omitted fields may be reset" is simply false for an endpoint confirmed to
 * merge, and stating it anyway would train a caller to ignore these lines.
 */
export function roundTripWarning(gap: RoundTripGap | undefined, opId?: string): string | undefined {
  if (!gap) return undefined;
  const semantics = opId ? updateSemantics(opId) : "unknown";
  const parts: string[] = [];

  const consequence =
    semantics === "merges"
      ? `This endpoint has been confirmed to leave omitted fields alone, so this is for reading the value, not a ` +
        `warning about losing it.`
      : semantics === "clears-omitted"
        ? `This endpoint nulls fields the body omits, so read and resend anything you want kept.`
        : semantics === "replaces"
          ? `This endpoint replaces the record, so omitted fields revert to their defaults — send the full object.`
          : semantics === "rejects-partial"
            ? // Deliberately no status code: these refuse with 400 or 500 depending
              // on the endpoint, and naming one was wrong for two of the five.
              `This endpoint refuses partial bodies outright, so the full object is required regardless.`
            : `Whether this endpoint keeps omitted fields is untested, and one endpoint on this API nulls them, so ` +
              `read and resend anything you want kept.`;

  if (gap.renamed.length > 0) {
    parts.push(
      `NOTE: ${gap.readOp} returns ${gap.renamed.length === 1 ? "this field" : "these fields"} under a different key — ` +
        `${gap.renamed.map((r) => `${r.field} → ${r.readAt}`).join(", ")}. ${consequence}`
    );
  }

  if (gap.viaSubresource.length > 0) {
    const one = gap.viaSubresource.length === 1;
    // Deliberately not the shared `consequence`. That string is derived from the
    // operation's semantics, which are recorded per endpoint, while these fields
    // are collections — and on the one endpoint this currently covers the two
    // disagree. `PATCH /api/user-groups/{userGroupId}` is `clears-omitted`
    // because it nulls the scalar `externalId`, but `accountIds` is a collection
    // and collections provably survive there, so appending the generic "this
    // endpoint nulls fields the body omits, so read and resend anything you want
    // kept" contradicted this file's own recorded evidence and sent callers off
    // to do a GET and a larger PATCH for nothing. Claiming neither loss nor
    // safety is the honest option until the semantics table can speak per field.
    const advice =
      semantics === "rejects-partial"
        ? `This endpoint refuses partial bodies, so the full object is required regardless.`
        : `Read ${one ? "it" : "them"} there if you need the current ${one ? "value" : "values"}.`;
    parts.push(
      `NOTE: ${gap.viaSubresource.map((r) => `"${r.field}"`).join(", ")} ${one ? "is" : "are"} not on the record ` +
        `at all, but a second endpoint returns ${one ? "it" : "them"} — ` +
        `${gap.viaSubresource.map((r) => `read ${r.field} from ${r.readOp} at ${r.readAt}`).join("; ")}. ${advice}`
    );
  }

  if (gap.unreadable.length > 0) {
    const one = gap.unreadable.length === 1;
    const fields = gap.unreadable.map((f) => `"${f}"`).join(", ");
    const absent = `${fields} ${one ? "has" : "have"} no known equivalent in ${gap.readOp}`;
    // "may be reset" is false for an endpoint that refuses partial bodies —
    // nothing is reset because nothing is applied. Pairing it with "refuses
    // partial bodies" in the same blockquote said both at once.
    const lead =
      semantics === "merges"
        ? `NOTE: ${absent}, so ${one ? "it" : "they"} cannot be read back — but this endpoint keeps omitted fields, ` +
          `so ${one ? "it survives" : "they survive"} an update that leaves ${one ? "it" : "them"} out.`
        : semantics === "rejects-partial"
          ? `NOTE: ${absent}, so ${one ? "it" : "they"} cannot be read back — but this endpoint refuses partial ` +
            `bodies, so an update omitting ${one ? "it" : "them"} fails rather than resetting anything.`
          : `CAUTION: ${absent}, so ${one ? "its" : "their"} current ${one ? "value" : "values"} cannot be read back. ` +
            `Set ${one ? "it" : "them"} explicitly, or accept that ${one ? "it" : "they"} may be reset.`;
    parts.push(lead);
  }

  return parts.join(" ");
}
