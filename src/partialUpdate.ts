/**
 * Guards against updates this API silently discards data on.
 *
 * `PATCH` invites a partial body — send the fields you want to change, leave
 * the rest alone. On this API that assumption is wrong, and wrong in a way no
 * caller can see: the request succeeds with `200` and a response body that
 * looks correct, while a field the caller never mentioned has been set to null.
 *
 * The round-trip CRUD probe found this against a real
 * deployment. `PATCH /api/user-groups/{userGroupId}` with only `{"name": "…"}`
 * returns `200` and nulls `externalId`. It is not a clean replace either —
 * `privileges` set at create time survived the same call untouched. The pattern
 * observed is that omitted *scalars* are nulled while omitted *collections* are
 * left alone, which is worse than either consistent behaviour: a caller cannot
 * predict which of their fields will survive.
 *
 * This matters more here than in a hand-written client. These tools are driven
 * by a model that will quite reasonably send the minimal body a partial update
 * appears to call for, and nothing in the response would tell it that something
 * was lost. So the omission is refused up front, with an explanation, rather
 * than left to be discovered in production.
 *
 * Only operations confirmed by live testing belong in the table below. A guess
 * here costs real functionality — every entry blocks calls that would otherwise
 * succeed.
 */

export interface LossyUpdateRule {
  /** Fields this operation sets to null when the request body omits them. */
  clearedWhenOmitted: string[];
  /** Why losing these particular fields matters, quoted into the refusal. */
  consequence: string;
}

export const LOSSY_UPDATE_OPS: Record<string, LossyUpdateRule> = {
  "PATCH /api/user-groups/{userGroupId}": {
    clearedWhenOmitted: ["externalId"],
    consequence:
      "externalId is what maps an OpenID group onto this IvedaAI group, so silently losing it can break SSO " +
      "group mapping for everyone in the group. (privileges and other collections do survive a partial PATCH " +
      "here — this server nulls omitted scalar fields but leaves omitted lists alone.)",
  },
};

/**
 * What each update operation actually does with fields the body omits, where
 * live testing has settled it.
 *
 * This exists because the obvious generalisation is false. `PATCH
 * /api/user-groups/{userGroupId}` nulls omitted scalars, and for several commits
 * this project assumed — and warned — that other PATCH endpoints probably did the
 * same, alert rules especially. Writing to a throwaway alert rule settled it the
 * other way: `PATCH /api/alertRules/{alertRuleId}` merges. A partial body
 * carrying only the three required fields left `description`, `cameras`,
 * `hashtags`, `typeLogic`, `cooldownInterval` and `schedule.forever` all intact,
 * reproduced across three runs. `description` matters most there — it is a plain
 * top-level scalar, exactly the shape of the `externalId` that user-groups does
 * clear. So the behaviour is per-endpoint, not a property of the API's PATCH
 * handling, and it cannot be inferred from the verb.
 *
 * Only add entries live testing has established, and record the evidence. An
 * entry claiming "merges" suppresses a warning, so a wrong one is worse than
 * silence.
 */
export type UpdateSemantics =
  /** Omitting a field sets it to null, and the call still succeeds. */
  | "clears-omitted"
  /** Omitting a field resets it to its default — ordinary PUT replacement. */
  | "replaces"
  /** Omitting a field leaves it alone. */
  | "merges"
  /** A partial body is refused outright, so nothing is lost but nothing applies. */
  | "rejects-partial"
  /** Not established. */
  | "unknown";

export const CONFIRMED_UPDATE_SEMANTICS: Record<string, { semantics: UpdateSemantics; evidence: string }> = {
  "PATCH /api/user-groups/{userGroupId}": {
    semantics: "clears-omitted",
    evidence:
      "A PATCH sending only {name} returned 200 and set externalId to null, while privileges (a collection) " +
      "survived the same call. Found by the round-trip CRUD probe and since reproduced on a second, unrelated " +
      "deployment, so it is a property of the API rather than of one installation. Membership behaves the same "
      + "way: accountIds survives a partial PATCH, confirmed by moving a disposable account into a throwaway "
      + "group and back, so the rule for this endpoint is that collections survive and scalars do not.",
  },
  // Ordinary PUT replacement rather than a surprise: recorded so the distinction
  // between "this verb replaces, as advertised" and "this PATCH quietly nulls
  // things" is written down rather than inferred.
  "PUT /api/face/categories/{faceCategoryId}": {
    semantics: "replaces",
    evidence:
      "An update omitting colorCode reset it from #3366cc to the server default #3E80B5. Observed by the CRUD " +
      "probe on two deployments.",
  },
  "PUT /api/lpr/categories/{categoryId}": {
    semantics: "replaces",
    evidence:
      "An update omitting colorCode reset it from #cc6633 to the server default #3E80B5, matching the face " +
      "category endpoint. Observed by the CRUD probe on two deployments.",
  },
  // A PUT that merges. Worth recording precisely because it contradicts the
  // three PUTs above it: same verb, same API, opposite behaviour on an omitted
  // field. This is the clearest single piece of evidence for the rule the README
  // states — that whether an endpoint loses what you omit is per-endpoint and
  // cannot be inferred from the verb.
  // Measured separately from the PUT below rather than assumed from it. On this
  // API the two verbs routinely disagree — PATCH /api/alertRules merges while
  // PUT /api/alertRules refuses a partial body outright — so one verb's
  // behaviour is not evidence about the other's. Here they happen to agree.
  "PATCH /api/lineSets/{lineSetId}": {
    semantics: "merges",
    evidence:
      "A PATCH sending only cameraId/name/type/line1/line2 left the omitted objectTypes (['person']) intact. " +
      "Observed by the CRUD probe (plan `line_set_patch`) on 2026-07-30, against the 10.0 deployment, on a " +
      "lineSet attached to a throwaway camera the probe created. One run, one deployment — recorded because " +
      "the 10.0 spec made this operation produce a round-trip gap, and a warning without measured semantics " +
      "would have had to hedge.",
  },
  "PUT /api/lineSets/{lineSetId}": {
    semantics: "merges",
    evidence:
      "An update sending only the required cameraId/name/type/line1/line2 left the omitted objectTypes " +
      "(['person']) intact. Observed by the CRUD probe on 2026-07-29 against a lineSet attached to a " +
      "throwaway camera the probe created, so nothing about it depends on an existing record's state.",
  },
  // The two verbs on the same resource, measured separately and disagreeing —
  // which is the whole reason this table exists. A caller who reaches for PUT
  // because it "feels" like the full-update verb loses every field they omit;
  // the same body sent as PATCH keeps them.
  "PUT /api/face/targets/{targetId}": {
    semantics: "replaces",
    evidence:
      "An update omitting description set it to null. Observed by the CRUD probe (plan `face_target`) on " +
      "2026-08-07 against the 10.0 deployment, on a target the probe created inside its own throwaway " +
      "category. One deployment, one run.",
  },
  "PATCH /api/face/targets/{targetId}": {
    semantics: "merges",
    evidence:
      "The same body sent as PATCH left the omitted description intact — measured by plan `face_target_patch` " +
      "on 2026-08-07, immediately after the PUT above and against the same deployment, so the difference is " +
      "the verb and nothing else.",
  },
  "PUT /api/lpr/targets/{targetId}": {
    semantics: "replaces",
    evidence:
      "An update omitting vehicleOwner set it to null. Observed by the CRUD probe (plan `lpr_target`) on " +
      "2026-08-06 against the 10.0 deployment, on a target the probe created inside its own throwaway " +
      "category. One deployment, one run.",
  },
  "PUT /api/indoor-maps/{indoorMapId}": {
    semantics: "replaces",
    evidence:
      "An update omitting description set it to null. Observed by the CRUD probe on 2026-07-28 — one " +
      "deployment, reproduced across three consecutive runs, unlike the two entries above which have been " +
      "seen on two. Recorded as replaces because that is what PUT advertises and what was measured; it is not " +
      "evidence about any other indoor-map verb.",
  },
  "PATCH /api/alertRules/{alertRuleId}": {
    semantics: "merges",
    evidence:
      "A partial PATCH carrying only the required name/alertType/trigger returned 200 and left description, " +
      "condition.cameras, condition.hashtags, condition.typeLogic, condition.cooldownInterval and " +
      "schedule.forever all unchanged. Reproduced three times against a throwaway rule by " +
      "scripts/probe-update-semantics.ts.",
  },
  "PUT /api/alertRules/{alertRuleId}": {
    semantics: "rejects-partial",
    evidence:
      "The same partial body that PATCH accepts returns 500 NullPointerException here, leaving the record " +
      "untouched. Consistent with PUT /api/filters/{filterId}, which also NPEs on an incomplete body rather " +
      "than replacing what it was given.",
  },
  // Cameras are the most-used resource here, so this one mattered most to get
  // right — and it was nearly recorded backwards. A first probe sent
  // `locationType: "NONE"` in its partial body and saw latitude/longitude cleared,
  // which looks exactly like the user-groups hazard. Re-running with
  // `locationType` omitted entirely left the coordinates intact: the location mode
  // was doing it, not the omission. A field the body *sets* is not evidence about
  // fields the body leaves out.
  "PATCH /api/cameras/{cameraId}": {
    semantics: "merges",
    evidence:
      "A PATCH carrying only name/streamUrl/engineProfileId/roiContour returned 200 and left description, " +
      "latitude, longitude, locationType and resolution untouched. Isolated from an earlier false positive " +
      "caused by sending locationType: NONE, which legitimately discards GPS coordinates.",
  },
  "PUT /api/cameras/{cameraId}": {
    semantics: "rejects-partial",
    evidence:
      "The same partial body returns 400 MethodArgumentNotValidException naming cameraType, doRecording and " +
      "protocol as must-not-be-null — three fields CameraRequest does not mark required. Nothing is lost, but " +
      "nothing applies either.",
  },
  // Both verbs merge here, which is unusual: everywhere else on this API a PUT
  // either replaces or refuses.
  "PATCH /api/rois/{roiId}": {
    semantics: "merges",
    evidence:
      "A body carrying only the six fields RoiRequest marks required returned 200 and left conditionLogic " +
      "(read back as `logical`) and isEnabled (as `enabled`) unchanged.",
  },
  "PUT /api/rois/{roiId}": {
    semantics: "merges",
    evidence:
      "Same body, same result as the PATCH — 200 with conditionLogic and isEnabled intact. Notable because PUT " +
      "replaces or refuses on every other resource tested here.",
  },
  // The two verbs disagree about whether `password` is required, which is the
  // practical gotcha here rather than the semantics: PATCH accepts a body without
  // one, PUT answers 400 "Parameter Error : 'password'". So an account cannot be
  // updated via PUT at all without resetting the account holder's password, while
  // PATCH updates it freely.
  //
  // This is also why the semantics could be established without touching a
  // password: PATCH's tolerance made a full-object restore possible, and PUT's
  // refusal of a partial body is itself the answer for PUT.
  "PATCH /api/accounts/{accountId}": {
    semantics: "merges",
    evidence:
      "A PATCH carrying only name and userGroupId returned 200 and left note, email, locale, " +
      "authenticationType, multiFactorAuthenticationType, activeUserSelfManagementMfa, showTermsConditions, " +
      "showExpirationNotice, preferenceConfig and isActive untouched — despite AccountRequest marking email, " +
      "isActive, locale and password required. Probed against an operator-designated disposable non-admin " +
      "account and restored afterwards.",
  },
  "PUT /api/accounts/{accountId}": {
    semantics: "rejects-partial",
    evidence:
      "The same partial body PATCH accepts returns 400 InvalidParameterException 'Parameter Error : password'. " +
      "PUT enforces password where PATCH does not, so nothing is lost but nothing applies — and no update via " +
      "PUT is possible without setting the account holder's password.",
  },
  "PUT /api/engineProfiles/{profileId}": {
    semantics: "merges",
    evidence:
      "A PUT sending only {name} returned 200 with engineModelIds (read back as the singular engineModelId) and " +
      "description intact. Note that creating a profile needs more than the spec claims: EngineProfileRequest " +
      "marks only `name` required, but a body without engineConfig fails with 500 " +
      "ConstraintViolationException, so the probe clones engineConfig off an existing profile.",
  },
  "PUT /api/camera-groups/{cameraGroupId}": {
    semantics: "replaces",
    evidence:
      "A PUT sending only {name} returned 200 and unbound every camera: a group holding one camera came back with " +
      "cameras empty and numberOfCameras 0. Omitting cameraIds empties the group. Testable only because the probe " +
      "binds a throwaway camera — with an empty group the omission proves nothing.",
  },
  "PUT /api/user-groups/{userGroupId}": {
    semantics: "replaces",
    evidence:
      "A PUT sending only {name} returned 200 and cleared both externalId (to null) and privileges (to []). Worth " +
      "contrasting with PATCH on the same path, which clears externalId but leaves privileges alone: the verbs " +
      "differ in whether collections survive, so neither can be inferred from the other.",
  },
  "PUT /api/nvrs/{nvrId}": {
    semantics: "rejects-partial",
    evidence:
      "A PUT sending only {name} returns 500 NullPointerException, leaving the record untouched — the same " +
      "shape of failure as PUT on filters and alert rules. Probed with a throwaway NVR rather than the " +
      "deployment's real one, because NvrRequest carries the device's own username/password, the read does not " +
      "echo them back, and a PUT that dropped them could not be repaired from any readable value.",
  },
  "PUT /api/filters/{filterId}": {
    semantics: "rejects-partial",
    evidence:
      "Answers 500 NullPointerException when query or cameraIds is absent, though the spec marks both optional. " +
      "Omitting type — which the spec marks required — is accepted and silently resets the filter to \"advance\", " +
      "so this endpoint is only fully safe with all four fields sent.",
  },
};

/** What this operation does with omitted fields, where that has been established. */
export function updateSemantics(opId: string): UpdateSemantics {
  return CONFIRMED_UPDATE_SEMANTICS[opId]?.semantics ?? "unknown";
}

/** The guarded fields this body would silently clear. Empty when the call is safe. */
export function findLossyOmissions(opId: string, body: unknown): string[] {
  const rule = LOSSY_UPDATE_OPS[opId];
  if (!rule) return [];

  // No usable object body means every guarded field is omitted.
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return [...rule.clearedWhenOmitted];
  }

  const record = body as Record<string, unknown>;
  // An explicit `undefined` is dropped by JSON.stringify, so it reaches the
  // server as an omission and must be treated as one here.
  return rule.clearedWhenOmitted.filter((field) => record[field] === undefined);
}

/**
 * The refusal message for a lossy call, or undefined when there's nothing to refuse.
 *
 * Passing the field explicitly as `null` is allowed through: clearing it is
 * then the caller's stated intent rather than an invisible side effect.
 */
export function lossyUpdateError(opId: string, body: unknown): string | undefined {
  const missing = findLossyOmissions(opId, body);
  if (missing.length === 0) return undefined;

  const rule = LOSSY_UPDATE_OPS[opId]!;
  const quoted = missing.map((f) => `"${f}"`).join(", ");
  const nulls = missing.map((f) => `"${f}": null`).join(", ");

  return (
    `Refusing to call ${opId}: the body omits ${quoted}.\n\n` +
    `Despite being a PATCH, this endpoint does not leave omitted fields alone — it sets ${quoted} to null and ` +
    `still answers 200, so the data loss is invisible in the response. ${rule.consequence}\n\n` +
    `To fix: read the record first and include the current value of ${quoted} in your body, so the update ` +
    `preserves it. If you genuinely mean to clear it, send ${nulls} explicitly and this call will go through.`
  );
}

/** Whether an operation is guarded, for tool documentation. */
export function lossyUpdateWarning(opId: string): string | undefined {
  const rule = LOSSY_UPDATE_OPS[opId];
  if (!rule) return undefined;
  const fields = rule.clearedWhenOmitted;
  const one = fields.length === 1;
  return (
    `CAUTION: this endpoint nulls ${fields.map((f) => `"${f}"`).join(", ")} if the body omits ` +
    `${one ? "it" : "them"}, and still returns 200. Send the full object, including the current value of ` +
    `${one ? "that field" : "those fields"}. Omitting ${one ? "it" : "them"} is refused by this tool; pass ` +
    `${one ? "it" : "them"} as null to clear ${one ? "it" : "them"} deliberately.`
  );
}
