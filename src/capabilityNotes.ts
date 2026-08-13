/**
 * Notes for operations whose name hides what they do.
 *
 * Most operations in this spec are findable: a model wanting to list cameras
 * finds `GET /api/cameras`. A few are not, because the capability lives in a
 * parameter while the summary describes the plumbing around it. Camera
 * activation is the clearest case, and it is worth the space because the whole
 * capability is otherwise invisible:
 *
 *     POST /api/cameras/{cameraId}/jobs — Operate jobs by camera id
 *       path: cameraId*:integer
 *       query: activate*:boolean
 *
 * Asked to deactivate a camera, a model searching the operation list for
 * "activate" finds nothing — no operation id contains the word. The summary
 * reads as job management. The camera record has no activation field to notice
 * either. The likely outcomes are inventing a field for `PUT /api/cameras/{id}`,
 * or reporting that the API cannot do it.
 *
 * That last one would be wrong in a particularly bad way, because the concept is
 * first-class everywhere except where you act on it: `GET /api/auditTrails`
 * offers `ACTIVATE` and `DEACTIVATE` in its action enum, and the deployment
 * writes "Camera - (name) activated." in plain English.
 *
 * The bar for adding a note here is that it was verified against a real
 * deployment, not inferred from the spec. Everything asserted below was
 * measured. Where only the shape of the spec is known — `PUT /api/jobs` takes
 * no filter, for instance — the note says what is on the page and points at the
 * narrower operation, rather than describing behaviour nobody has run.
 */

export const CAPABILITY_NOTES: Record<string, string> = {
  "POST /api/cameras/{cameraId}/jobs":
    'NOTE: this is how a camera is activated and deactivated. activate=true starts analytics processing, ' +
    'activate=false stops it. The camera\'s "status" becomes "Processing" or "Idle" within about a second, ' +
    'and the deployment records an ACTIVATE/DEACTIVATE audit entry. There is no activation field on the ' +
    'camera record — read the current state from "status", or with GET /api/cameras?isActivate=true|false.',

  "GET /api/cameras":
    'NOTE: isActivate filters on whether a camera is actively processing. The camera record carries no ' +
    'activation field, so "status" ("Processing" when active, "Idle" when not) is the per-record signal. ' +
    "To change it, use POST /api/cameras/{cameraId}/jobs with activate=true|false.",

  "PUT /api/jobs":
    "NOTE: this takes no job id and no camera filter — see the operation list for POST /api/jobs/{cameraId}, " +
    "which cancels one camera's job, before using this one.",
};

/** The note for an operation, or undefined when it needs no explaining. */
export function capabilityNote(operationId: string): string | undefined {
  return CAPABILITY_NOTES[operationId];
}
