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
 * wrong. The spec declares `CameraRequest.required` as `["cameraType"]`, and a
 * body with just that comes back 400:
 *
 *     [engineProfileId (null) must not be null, roiContour (null) must not be null,
 *      doRecording (null) must not be null, protocol (null) must not be null]
 *
 * Measured, along with the fact that nothing is persisted when it fails. The
 * four names are no longer carried here: `CONFIRMED_REQUIRED_FIELDS` in
 * `swagger.ts` corrects the schema itself, so the description's own required
 * list now states them and repeating them in prose would be a second place to
 * go stale. What the note still earns is the part a corrected list cannot say —
 * that the published spec disagrees, that creating a record does not start the
 * camera, and that `ivedaai_add_camera` exists and is not mentioned anywhere a
 * caller of the generic tool would look. Worth noting that `CameraRequest` is
 * the outlier: of the 35 request schemas that declare required fields at all,
 * the rest look right.
 *
 * `GET /api/alerts` is noted for a reason none of the others share: the shape of
 * the answer, not the shape of the call. A live deployment returned 227,600
 * alerts for a single week, which is 113,800 pages at the size a response cap
 * allows — a model asked to summarise the last hour and left to page the
 * collection does not get a wrong answer, it never finishes.
 *
 * Two independent live runs, given the same operator question, both arrived at
 * the same technique: filter, set size=1, and read `pagination.total`. Each such
 * call costs about 0.7 KB and yields an exact count, and repeating it per
 * alertType, per camera, per state and per rule produced a full breakdown of
 * 1,825 alerts for roughly 28 KB. That is the difference between the question
 * being answerable and not, and both runs spent calls discovering it.
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
 * `DELETE /api/cameras/{cameraId}` is here for the sharpest version of the same
 * problem: a call that does nothing and reports it the same way as a call that
 * worked. Deleting an active camera is ignored, and the two responses are
 * byte-identical:
 *
 *     idle   -> 202, content-length 0, body null   ... gone ~2s later
 *     active -> 202, content-length 0, body null   ... still Processing at 41s
 *
 * There is no header, no body, and no status to tell them apart, so "remove
 * these cameras" reports success and leaves the running ones in place. It took
 * three attempts to establish: the first observation was tangled up with
 * deactivating in between, the second trial deleted a camera that had not
 * finished activating and so tested nothing, and only the third — waiting for
 * "Processing", then one delete and no further calls — was clean.
 *
 * There is a third activation failure too, found by running into it rather than
 * by looking for it. Activation is licence-capped, and at the cap it answers:
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

// Live read-only validation established that `types` means an object-type key,
// not a line-set type, a counting direction, or one of the nested synonyms the
// type catalog returns. The wrong vocabulary answers 400 on dashboard and can
// return 500 on history; a top-level catalog key returned 200 on both with the
// same line set and time range.
const COUNTING_TYPES_NOTE =
  "NOTE: types values must use top-level object-type keys returned by GET /api/types/{category}; do not send a " +
  "nested synonym, line-set type, or counting direction such as IN/OUT.";

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
    "NOTE: the required list above is corrected — the published spec marks only \"cameraType\", and a body " +
    "carrying just that is refused with a 400 naming the other four and no record created. Creating the " +
    "record does not start the camera either; it stays Idle until activated. For onboarding a real camera " +
    "prefer the ivedaai_add_camera tool, which supplies these and the other defaults, activates the camera, " +
    "and cleans up after a partial create.",

  "GET /api/alerts":
    "NOTE: on an active deployment this collection is very large — hundreds of thousands of records over a "
    + "week is normal — so it cannot be read through to answer a question about it. To count, send the "
    + "filters you care about with size=1 (not 0, which is ignored for a default page) and read "
    + "pagination.total: that is an exact figure for well under "
    + "a kilobyte, and start/end, alertTypes, states, cameraIds and alertRuleIds all combine. Repeat it per "
    + "value to break a total down. Use GET /api/alerts/latest for what is happening now rather than paging "
    + "this one from the start.",

  "GET /api/cameras":
    'NOTE: isActivate filters on whether a camera is actively processing. The camera record carries no ' +
    'activation field, so "status" ("Processing" when active, "Idle" when not) is the per-record signal. ' +
    "To change it, use POST /api/cameras/{cameraId}/jobs with activate=true|false.",

  "GET /api/counting/dashboard": COUNTING_TYPES_NOTE,

  "GET /api/countings": COUNTING_TYPES_NOTE,

  "DELETE /api/cameras/{cameraId}":
    "NOTE: deleting a camera that is currently active does nothing at all, and the response does not say so — " +
    'an ignored delete and a real one both answer 202 with an empty body. Measured: an "Idle" camera was gone ' +
    'about 2 seconds later, a "Processing" one was still there, still Processing, after 41. Deactivate first ' +
    "with POST /api/cameras/{cameraId}/jobs?activate=false, then poll GET /api/cameras/{cameraId} until its " +
    'status is "Idle" before calling this DELETE. Deletion is asynchronous too: poll that GET until it answers ' +
    "404 Not Found rather than trusting the 202 — it is 202 Accepted, not 204, so it promises nothing about " +
    "having happened.",

  "PUT /api/jobs":
    "NOTE: this takes no job id and no camera filter — see the operation list for POST /api/jobs/{cameraId}, " +
    "which cancels one camera's job, before using this one.",
};

/** The note for an operation, or undefined when it needs no explaining. */
export function capabilityNote(operationId: string): string | undefined {
  return CAPABILITY_NOTES[operationId];
}
