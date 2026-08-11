/**
 * What this server is allowed to do to the deployment it is pointed at.
 *
 * Until this existed, the answer was "anything". The tools carried
 * `destructiveHint` annotations, which are advice to a client rather than a
 * control, and nothing stopped a model from calling `DELETE /api/cameras` —
 * no id in the path, so it removes the camera estate — or `DELETE /api/accounts`.
 * The project's own probes have refused to touch those 23 operations since the
 * coverage inventory was written; the server offered them to callers anyway.
 *
 * Two switches, both closed by default in the direction that loses least:
 *
 *   IVEDAAI_READ_ONLY=true                  refuse every non-GET
 *   IVEDAAI_ALLOW_COLLECTION_DELETE=true    permit the collection-level DELETEs
 *
 * Collection deletes are refused unless explicitly enabled, because the failure
 * is unrecoverable and the call that causes it looks exactly like the safe
 * single-record delete beside it — `DELETE /api/cameras` versus
 * `DELETE /api/cameras/{cameraId}`. A model choosing between those two has one
 * character of signal.
 *
 * Read-only is off by default: the server's whole purpose is driving this API,
 * and defaulting to read-only would break every existing caller. The two
 * settings are independent — read-only implies no deletes of any kind, so the
 * collection-delete switch does not soften it.
 */
import type { Operation } from "./swagger.js";

/**
 * A DELETE that can be called without naming what it deletes.
 *
 * Worth calling out on its own rather than folding into a tier, because it cuts
 * across all four and it is the one shape where a single mistaken call cannot be
 * walked back. `DELETE /api/alerts` and `DELETE /api/accounts` are both in the
 * spec.
 *
 * The hazard is narrower than "no id in the path", which is what this used to
 * test, and the narrower reading is the more useful one. Of the 23 operations
 * that reading flagged:
 *
 *   - **20 take an array of ids in the request body** — `DELETE /api/cameras`
 *     accepts `[1,2,3]`. They are batch deletes of named records, not commands
 *     to empty a table. But the body is declared **optional**, so what an
 *     omitted body does is undefined by the spec and untested here, for the
 *     obvious reason. That uncertainty is the actual risk, and it is why these
 *     stay flagged.
 *   - **3 genuinely take no target at all**: `DELETE /api/cloud-storages`,
 *     `DELETE /api/configs/certificate`, `DELETE /api/jobs`.
 *   - **2 require ids as query parameters** and so *cannot* be called without a
 *     target: `DELETE /api/accounts/api-keys` needs `apiKeyIds`,
 *     `DELETE /api/modules` needs `moduleId`. Those are record-level operations
 *     wearing a collection-shaped path, and calling them a collection delete was
 *     simply wrong — the refusal told a caller "there is no id in its path"
 *     about an operation that will not run without one.
 *
 * So a required id-bearing parameter is what distinguishes them. Everything else
 * keeps the conservative classification.
 */
export function isCollectionDelete(op: Operation): boolean {
  if (op.method !== "DELETE") return false;
  if (/\{[^}]+\}/.test(op.path)) return false;
  const namesATarget = op.parameters.some((p) => p.required && /ids?$/i.test(p.name));
  return !namesATarget;
}

export interface AccessPolicy {
  /** Refuse anything that is not a GET. */
  readOnly: boolean;
  /** Permit DELETEs that address a collection rather than a record. */
  allowCollectionDelete: boolean;
}

export function policyFromEnv(env: NodeJS.ProcessEnv = process.env): AccessPolicy {
  return {
    readOnly: env.IVEDAAI_READ_ONLY === "true",
    allowCollectionDelete: env.IVEDAAI_ALLOW_COLLECTION_DELETE === "true",
  };
}

/**
 * Why this operation may not be called, or undefined when it may.
 *
 * Returns prose rather than a boolean because the refusal is shown to a model
 * that then has to decide what to do instead. "Refused" on its own invites a
 * retry; naming the safe alternative and the switch that would permit it does
 * not.
 */
export function refusalReason(operation: Operation, policy: AccessPolicy): string | undefined {
  if (policy.readOnly && operation.method !== "GET") {
    return (
      `Refused: this server is running read-only, so ${operation.id} cannot be called. ` +
      `Only GET operations are available. Unset IVEDAAI_READ_ONLY to allow writes.`
    );
  }

  if (isCollectionDelete(operation) && !policy.allowCollectionDelete) {
    const singleRecord = `DELETE ${operation.path}/{id}`;
    // Most of these do accept an array of ids — but the body is optional, so
    // what the server does with an omitted body is unspecified and deliberately
    // untested. Saying that plainly is more useful to a model than asserting the
    // operation empties the collection, which is only the worst case.
    return (
      `Refused: ${operation.id} names no record to delete. There is no id in its path, so the only ` +
      `subject would come from an optional request body, and what this endpoint does when that body is ` +
      `omitted is not specified — it may empty the collection, and the deletion cannot be undone. If you ` +
      `meant to remove a single record, use ${singleRecord} instead. To allow it anyway the operator ` +
      `must set IVEDAAI_ALLOW_COLLECTION_DELETE=true; this server will not do it on a tool call alone.`
    );
  }

  return undefined;
}

/**
 * The operations a policy leaves callable.
 *
 * Used at registration so a read-only server does not advertise writes it would
 * only refuse. That is not just tidiness: every operation listed costs context
 * on connect, and a tool description offering a model something it cannot have
 * invites it to try, fail, and try again.
 */
export function allowedOperations(operations: Operation[], policy: AccessPolicy): Operation[] {
  return operations.filter((op) => refusalReason(op, policy) === undefined);
}
