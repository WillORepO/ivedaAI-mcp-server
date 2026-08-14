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
 *
 * `POST /api/cameras` is here for a different reason: its documented contract is
 * wrong, and this server prints the wrong part faithfully. The spec declares
 * `CameraRequest.required` as `["cameraType"]`, so the tool description says
 * `required: cameraType` — and a body with just that comes back 400:
 *
 *     [engineProfileId (null) must not be null, roiContour (null) must not be null,
 *      doRecording (null) must not be null, protocol (null) must not be null]
 *
 * Measured, along with the fact that nothing is persisted when it fails. The
 * error is legible, which is the redeeming part, but a caller reaches it only by
 * trying — and `ivedaai_add_camera` already exists to handle this and is not
 * mentioned anywhere a caller of the generic tool would look. Worth noting that
 * `CameraRequest` is the outlier here: of the 35 request schemas that declare
 * required fields at all, the rest look right.
 *
 * The activation note also carries the asymmetry between its two directions,
 * because both surprises land on whoever sets several cameras at once:
 *
 *     activate=true  on an already-active camera  -> 200, but jobId 297 was
 *                                                    cancelled and 298 started
 *     activate=false on an already-idle camera    -> 400 "Camera is not active"
 *
 * The first is the dangerous one. It looks idempotent from the status code and
 * from `status`, which reads "Processing" before and after, while underneath the
 * running job was cancelled and replaced — so "make sure these cameras are on"
 * silently restarts the ones that already were. The job list is the only place
 * the restart is visible.
 *
 * There is a third failure, found by running into it rather than by looking for
 * it. Activation is licence-capped, and at the cap it answers:
 *
 *     400 InvalidParameterException, errorCode 305
 *     "Number of active cameras has reached the maximum allowed. You can
 *      deactivate another camera to activate new camera."
 *
 * That is worth naming because a 400 normally means the request was wrong, and
 * the useful response to those is to fix the arguments and try again. Here the
 * request is fine and the deployment is full: retrying cannot succeed, and the
 * only remedy is to deactivate something else. The message says so, but a caller
 * has to read it rather than react to the status code.
 */

export const CAPABILITY_NOTES: Record<string, string> = {
  "POST /api/cameras/{cameraId}/jobs":
    'NOTE: this is how a camera is activated and deactivated. activate=true starts analytics processing, ' +
    'activate=false stops it. The camera\'s "status" becomes "Processing" or "Idle" within about a second, ' +
    'and the deployment records an ACTIVATE/DEACTIVATE audit entry. There is no activation field on the ' +
    'camera record — read the current state from "status", or with GET /api/cameras?isActivate=true|false. ' +
    'The two directions do not behave alike, so check "status" before calling either: activate=true on a ' +
    'camera that is already active answers 200 but cancels its running job and starts a new one, which ' +
    'interrupts analytics; activate=false on a camera that is already idle answers 400 "Camera is not ' +
    'active". Both matter when setting several cameras at once. Activation is also capped by licence: once the ' +
    'deployment is at its limit, activate=true fails with 400 errorCode 305, "Number of active cameras has ' +
    'reached the maximum allowed" — a full deployment, not a bad request, so the fix is to deactivate another ' +
    'camera rather than to retry or to change the arguments.',

  "POST /api/cameras":
    'NOTE: the spec marks only "cameraType" required, and that is not enough — the API also rejects a body ' +
    'missing "engineProfileId", "roiContour", "doRecording" or "protocol", with a 400 naming them and no ' +
    "record created. Creating the record does not start the camera either; it stays Idle until activated. " +
    "For onboarding a real camera prefer the ivedaai_add_camera tool, which supplies these and the other " +
    "defaults, activates the camera, and cleans up after a partial create.",

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
