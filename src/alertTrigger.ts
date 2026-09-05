/**
 * Knowledge and helpers for AlertRule.trigger — the API's mechanism for routing
 * alerts to external systems (generic HTTP webhooks, named VMS/PSIM platforms,
 * email, Immix, mobile push).
 *
 * Everything here beyond the raw schema was learned by testing
 * POST /api/alertTriggers against a real deployment, not from the bundled
 * spec — the spec alone does not document:
 *   - which of the 17 trigger types the "test" endpoint actually supports
 *   - that the webhook type's `authorization`/`httpBody` fields, though marked
 *     optional, must be present (e.g. {auth:"NONE"}/{type:"NONE"}) or the
 *     server fails before attempting any connection
 *   - that per-vendor connection timeouts vary enormously (sub-second for
 *     Milestone/Genetec, 20+ seconds observed for Axis)
 */

export type TriggerCategory = "webhook" | "vms" | "mail" | "mobile";

export interface TriggerTypeInfo {
  category: TriggerCategory;
  /** Whether POST /api/alertTriggers can live-test this type. */
  testable: boolean;
  description: string;
}

export const VMS_TYPES = [
  "milestone",
  "genetec",
  "nx",
  "dw",
  "lux",
  "salient",
  "axis",
  "ocularis",
  "digifort",
  "avigilon",
  "hanwha",
  "amag",
  "idis",
] as const;

export const TRIGGER_TYPES: Record<string, TriggerTypeInfo> = {
  request: {
    category: "webhook",
    testable: true,
    description: "Generic outbound HTTP webhook — POST/GET/etc. to any URL.",
  },
  mobile: {
    category: "mobile",
    testable: true,
    description: "Push notification to the IvedaAI mobile app.",
  },
  mail: {
    category: "mail",
    testable: false,
    description: "SMTP email notification. Not live-testable via POST /api/alertTriggers (confirmed: returns \"Unsupported check connection alert trigger type\").",
  },
  immix: {
    category: "mail",
    testable: false,
    description: "Immix alarm-monitoring-station notification. Shares mail's underlying type; not live-testable either (confirmed).",
  },
  ...Object.fromEntries(
    VMS_TYPES.map((name) => [
      name,
      {
        category: "vms" as const,
        testable: true,
        description:
          `${name[0].toUpperCase()}${name.slice(1)} VMS/PSIM integration. Live-testable, but how long a failed ` +
          `connection takes to report back is unpredictable — repeated tests against the same unreachable address ` +
          `varied from under a second to ~24 seconds in testing, seemingly based on real-time network conditions ` +
          `(immediate rejection vs. a silent connect timeout) rather than being a fixed property of any one vendor. ` +
          `Use a generous timeout regardless of which VMS type you're testing.`,
      },
    ])
  ),
};

export interface WebhookConfig {
  method: string;
  url: string;
  headers?: Record<string, string>;
  params?: Record<string, string>;
  authorization?: { auth: "NONE" | "BASIC" | "DIGEST"; account?: string; password?: string };
  httpBody?: { type: "NONE" | "RAW" | "FORMDATA"; raw?: { content: string; contentType?: string }; formData?: Record<string, string> };
}

export interface VmsConfig {
  ip: string;
  port: string;
  username?: string;
  password?: string;
  protocol?: "HTTP" | "HTTPS" | "ALL" | "NONE";
  severity?: "info" | "low" | "normal" | "high" | "critical";
  attachmentType?: string;
  triggerName?: string;
  alertName?: string;
  alertNames?: string[];
  cameraIds?: number[];
  logicalId?: string;
  enableSsl?: boolean;
  source?: string;
  caption?: string;
  title?: string;
  description?: string;
}

export interface MailConfig {
  emails: Array<{ mailIds?: string[]; subject?: string; content?: string }>;
  smtpServer: string;
  port: string;
}

export interface MobileConfig {
  enableCriticalAlertNotice?: boolean;
}

/**
 * Builds the full { trigger: { [type]: {...} } } request body for a trigger
 * type, filling in the fields we discovered are required-in-practice even
 * though the spec marks them optional.
 */
export function buildTriggerBody(type: string, config: unknown): { trigger: Record<string, unknown> } {
  const info = TRIGGER_TYPES[type];
  if (!info) {
    throw new Error(
      `Unknown trigger type "${type}". Valid types: ${Object.keys(TRIGGER_TYPES).sort().join(", ")}.`
    );
  }

  if (info.category === "webhook") {
    const c = config as WebhookConfig;
    if (!c?.method || !c?.url) throw new Error(`Webhook config requires "method" and "url".`);
    if (c.httpBody?.type === "RAW" &&
        (!c.httpBody.raw || typeof c.httpBody.raw !== "object" || typeof c.httpBody.raw.content !== "string")) {
      throw new Error('Webhook httpBody.raw requires an object with a string "content" field and optional "contentType", for example { content: "{\\"test\\":true}", contentType: "application/json" }.');
    }
    return {
      trigger: {
        [type]: {
          enable: true,
          requests: [
            {
              method: c.method,
              url: c.url,
              headers: c.headers,
              params: c.params,
              // Discovered requirement: omitting these causes the server to fail
              // before attempting any connection, regardless of target.
              authorization: c.authorization ?? { auth: "NONE" },
              httpBody: c.httpBody ?? { type: "NONE" },
            },
          ],
        },
      },
    };
  }

  if (info.category === "vms") {
    const c = config as VmsConfig;
    if (!c?.ip || !c?.port) throw new Error(`VMS config requires "ip" and "port".`);
    return { trigger: { [type]: { enable: true, ...c } } };
  }

  if (info.category === "mail") {
    const c = config as MailConfig;
    if (!c?.smtpServer || !c?.emails?.length) throw new Error(`Mail config requires "smtpServer" and "emails".`);
    return { trigger: { [type]: { enable: true, ...c } } };
  }

  // mobile
  const c = (config ?? {}) as MobileConfig;
  return { trigger: { [type]: { enable: true, enableCriticalAlertNotice: c.enableCriticalAlertNotice ?? false } } };
}

/** Renders a compact per-type reference for the tool description. */
/**
 * The type reference as a *tool description* pays for itself 66 times over.
 *
 * `describeTriggerTypes` renders every type with its prose description: 6,549
 * characters, 72% of this tool's description and 8.7% of everything a client
 * loads on connect — the single largest line item in the budget. And it is paid
 * twice, because `action: "list_types"` returns the same table as JSON for the
 * caller who actually wants it.
 *
 * This is the trade `describeBodyForTool` already makes for body schemas: keep
 * inline what a caller cannot postpone, and make the rest a lookup. Here that
 * split is
 *
 *   - **names, grouped by category** — you cannot choose a type you cannot name,
 *     and the grouping is the thing the `type` enum in the input schema does not
 *     already carry;
 *   - **which types `test` actually works on** — 2 of the 17 always answer
 *     "unsupported", and learning that from a failed call costs a round trip
 *     and reads like a broken integration rather than a documented limit;
 *   - everything else — what each platform is, and the evidence behind the
 *     untestable ones — moves to `list_types`, unchanged.
 *
 * Nothing is lost: `TRIGGER_TYPES` is untouched and `list_types` still returns
 * all of it.
 */
export function describeTriggerTypesCompact(): string {
  const lines: string[] = [];
  for (const category of ["webhook", "mobile", "vms", "mail"] as TriggerCategory[]) {
    const names = Object.entries(TRIGGER_TYPES).filter(([, info]) => info.category === category);
    if (names.length === 0) continue;
    lines.push(`  ${category}: ${names.map(([n, i]) => (i.testable ? n : `${n}*`)).join(", ")}`);
  }
  lines.push(
    "  * = not live-testable; 'test' returns \"unsupported\" for these. Call action:\"list_types\" for what each " +
      "type is and the evidence behind that."
  );
  return lines.join("\n");
}

export function describeTriggerTypes(): string {
  const lines: string[] = [];
  for (const category of ["webhook", "mobile", "vms", "mail"] as TriggerCategory[]) {
    const names = Object.entries(TRIGGER_TYPES).filter(([, info]) => info.category === category);
    if (names.length === 0) continue;
    lines.push(`${category.toUpperCase()}:`);
    for (const [name, info] of names) {
      lines.push(`  ${name} — ${info.testable ? "testable" : "NOT testable via 'test'"} — ${info.description}`);
    }
  }
  return lines.join("\n");
}

/**
 * Applying a trigger means updating an existing alert rule, and this API gives
 * a caller no way to do that without risking the rest of the rule.
 *
 * `PATCH /api/alertRules/{alertRuleId}` takes an `AlertRuleRequest`. The standing
 * advice for this API's other lossy update — see src/partialUpdate.ts — is "read
 * the record first and send the complete object". Here that advice cannot be
 * followed: `GET /api/alertRules/{alertRuleId}` returns an `AlertRule`, and the
 * two schemas barely overlap. Of the 21 fields `AlertRuleRequest` accepts, the
 * read endpoint returns four (`alertType`, `description`, `trigger`, `isEnabled`)
 * plus `name` under the different key `alertName`. The rest are simply not in
 * the response — there is no read that recovers them. That gap is derived from
 * the spec by src/roundTrip.ts, which finds the same problem on 15 other update
 * operations; this rule is the worst instance, not a special case.
 *
 * So the most any client can do is carry forward what it can actually see, and
 * say plainly what it could not. That is strictly better than the bare
 * `{trigger}` body this tool used to send — which additionally omitted `name`
 * and `alertType`, both of which `AlertRuleRequest` marks required — under every
 * hypothesis about how the server treats omissions: if it merges, carrying
 * fields forward changes nothing; if it nulls omitted scalars the way
 * `PATCH /api/user-groups/{userGroupId}` provably does, five fields survive that
 * would otherwise have been wiped.
 *
 * That question has since been settled by writing to a throwaway rule: this
 * endpoint *merges*, leaving omitted fields alone (see
 * `CONFIRMED_UPDATE_SEMANTICS` in src/partialUpdate.ts). So carrying fields
 * forward is now precaution against a future change in that behaviour rather than
 * repair of a present hazard — worth keeping, because it also makes the body
 * schema-valid, which the original bare `{trigger}` was not. Note that `PUT` on
 * the same path behaves completely differently: it rejects a partial body
 * outright.
 */

/** The JSON-string `condition` field, parsed, or undefined if it isn't usable. */
function parseCondition(raw: unknown): Record<string, unknown> | undefined {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw !== "string" || raw.trim() === "") return undefined;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** `AlertRuleRequest.required`, per the spec. */
const ALERT_RULE_REQUIRED_FIELDS = ["alertType", "name", "trigger"] as const;

export interface MergedAlertRule {
  /** The AlertRuleRequest body to send. */
  body: Record<string, unknown>;
  /** Fields recovered from the read and carried into the update. */
  carriedForward: string[];
  /** Required fields the read did not yield, so the update would violate the schema. */
  missingRequired: string[];
  /** Fields the update cannot preserve because no read returns them. */
  unrecoverable: string[];
}

/**
 * Builds the fullest AlertRuleRequest body obtainable from a rule as read back,
 * with `trigger` replaced by the new one.
 *
 * `name` is taken from the response's `alertName`; that rename is the only
 * mapping applied. Values are carried forward when present, including explicit
 * nulls — a null that was already stored is not a loss.
 *
 * `unreadable` is the spec-derived gap for this operation. The rename is why it
 * has to be filtered rather than reported as-is: the derivation compares field
 * names, so it counts `name` as unreadable, while this function can in fact
 * recover it from `alertName`. Whatever was genuinely carried forward is
 * subtracted, leaving only what is really beyond reach.
 */
export function mergeTriggerIntoRule(
  rule: unknown,
  triggerBody: { trigger: Record<string, unknown> },
  unreadable: readonly string[]
): MergedAlertRule {
  const read = (rule && typeof rule === "object" && !Array.isArray(rule) ? rule : {}) as Record<string, unknown>;

  const body: Record<string, unknown> = { trigger: triggerBody.trigger };
  const carriedForward: string[] = [];

  const carryValue = (target: string, value: unknown) => {
    if (value === undefined) return;
    body[target] = value;
    carriedForward.push(target);
  };

  // request field <- response field
  const carry: Array<[string, string]> = [
    ["name", "alertName"],
    ["alertType", "alertType"],
    ["description", "description"],
    ["isEnabled", "isEnabled"],
  ];
  for (const [target, source] of carry) carryValue(target, read[source]);

  // `schedule` holds two request fields, one of them renamed.
  // Observed: {"weekdays":[],"forever":true}
  const schedule = read.schedule as Record<string, unknown> | undefined;
  if (schedule && typeof schedule === "object") {
    carryValue("weekdays", schedule.weekdays);
    carryValue("enableForever", schedule.forever);
  }

  // `condition` is a JSON-encoded *string*, not a nested object, and carries
  // request fields inside it. Observed on a live rule:
  // {"type":"…AlertCondition","roiIds":[6,7,8,9,10],"cooldownInterval":1}
  // Parsed defensively: a malformed or absent condition simply yields nothing
  // to carry, which is the same position as before rather than a failure.
  // Which keys `condition` carries depends on the rule's alertType — an INTRUSION
  // rule holds roiIds, a VIDEO_SEARCH rule holds cameras/hashtags/typeLogic — so
  // all five are attempted and whichever are absent simply aren't carried. Note
  // the rename: the request's `cameraIds` is stored as `cameras`.
  const condition = parseCondition(read.condition);
  if (condition) {
    // CAMERA_ABNORMAL stores its subtypes in the condition as well.
    carryValue("abnormalTypes", condition.abnormalTypes);
    carryValue("roiIds", condition.roiIds);
    carryValue("cameraIds", condition.cameras);
    carryValue("hashtags", condition.hashtags);
    carryValue("typeLogic", condition.typeLogic);
    carryValue("cooldownInterval", condition.cooldownInterval);
  }

  // Camera-scoped rules also expose their targets as Camera objects here.
  // A CAMERA_ABNORMAL PATCH requires cameraIds even when the array is empty.
  // Do not turn an absent/malformed association into an empty grant list.
  if (body.cameraIds === undefined && Array.isArray(read.alertRulePermissions) &&
      read.alertRulePermissions.every(camera => camera && typeof camera === "object" &&
        Number.isSafeInteger((camera as Record<string, unknown>).cameraId))) {
    carryValue("cameraIds", read.alertRulePermissions.map(camera => (camera as Record<string, unknown>).cameraId));
  }

  return {
    body,
    carriedForward,
    missingRequired: [
      ...ALERT_RULE_REQUIRED_FIELDS.filter((f) => body[f] === undefined),
      ...(body.alertType === "CAMERA_ABNORMAL" && body.cameraIds === undefined ? ["cameraIds"] : []),
    ],
    unrecoverable: unreadable.filter((f) => !carriedForward.includes(f)),
  };
}

export type TestOutcome = "success" | "unsupported" | "invalid_config" | "connection_failed" | "unknown";

export interface TestInterpretation {
  outcome: TestOutcome;
  message: string;
}

/** Translates a raw POST /api/alertTriggers result into a plain-language verdict. */
export function interpretTestResult(status: number, body: unknown): TestInterpretation {
  if (status === 200 && body === true) {
    return { outcome: "success", message: "Connection test succeeded." };
  }

  const b = body as { type?: string; message?: string } | undefined;

  if (status === 400 && typeof b?.message === "string" && b.message.includes("Unsupported check connection")) {
    return {
      outcome: "unsupported",
      message:
        "This trigger type cannot be live-tested by the server (confirmed for mail/immix). The config can still be " +
        "saved to an alert rule, but you'll need to verify delivery another way (e.g. trigger a real alert).",
    };
  }

  if (status === 400 && b?.type === "InvalidParameterException") {
    return {
      outcome: "invalid_config",
      message:
        `The server rejected this configuration before attempting a connection — likely a missing or malformed ` +
        `field rather than a network problem. Raw message: ${b.message ?? "(none)"}`,
    };
  }

  if (status === 500 && b?.type === "ConnectionException") {
    return {
      outcome: "connection_failed",
      message:
        `Could not connect to the target system. Check the IP/port/credentials and that it's reachable from the ` +
        `IvedaAI server's network (not necessarily from wherever this tool runs). Raw message: ${b.message ?? "(none)"}`,
    };
  }

  return {
    outcome: "unknown",
    message: `Unrecognized response shape (status ${status}). Raw body: ${JSON.stringify(body).slice(0, 300)}`,
  };
}
