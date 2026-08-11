/**
 * Helpers for adding cameras — encodes everything discovered by testing
 * against a real deployment, not documented in the spec:
 *
 *   - The spec's CameraRequest.required list is misleading: it claims
 *     floorPlanId/floorPlanX/floorPlanY/floorPlanAngle are always required,
 *     but locationType:"NONE" correctly waives them. The two fields that
 *     really matter and are easy to miss are engineProfileId and roiContour
 *     (a >=3-point polygon — a full-frame rectangle is the sane default).
 *   - A "minimal but schema-valid" body (name, streamUrl, engineProfileId,
 *     roiContour) still throws a bare NullPointerException with no message.
 *     Filling in the rest of the optional-looking fields (resolution,
 *     frameRate, schedule, plugins, fpsType, flipState, codec,
 *     cameraGroupIds, account/password/description/manufacturer/model as
 *     empty strings) avoids it.
 *   - That NullPointerException is NOT a clean failure: it can still create
 *     a partial camera record before crashing. Any error from creation must
 *     be followed by a check for whether the camera was actually created
 *     anyway (by exact name), or a retry produces a confusing "Duplicate"
 *     error instead of a real one.
 *   - Creating the camera record is not enough for it to actually work or
 *     show up fully provisioned: POST /api/cameras/{id}/jobs?activate=true
 *     is a separate, required step that allocates a processing resource and
 *     starts the stream connection (a StreamJob). Without it, the camera's
 *     status/resource/engineModels/cscState fields stay null indefinitely.
 */

export interface CameraSpec {
  name: string;
  streamUrl?: string;
  ip?: string;
  port?: number;
  account?: string;
  password?: string;
  engineProfileId?: number;
  /**
   * Defaults to `General`, which is the type that actually processes.
   *
   * `VideoSource` reads like the right answer — it is what the spec calls an
   * RTSP video source — and it was the default until a controlled comparison
   * showed cameras created that way never provision. Same stream, same
   * resolution, same engine profile: the `General` camera reported
   * `status: "Idle"` at creation and reached `"Processing"` about five seconds
   * after activation, while three `VideoSource` cameras stayed `status: null`,
   * `resource: null` past 300 seconds with their activation jobs stuck at 0%.
   * Across the same deployment, none of the 104 cameras with a populated
   * `status` is a `VideoSource`.
   *
   * That is one deployment, so this stays overridable rather than fixed. But a
   * default that returns 2xx and silently produces a camera which never analyses
   * anything is the worse failure of the two: nothing in the response says so,
   * and `ivedaai_add_camera` is the tool a caller reaches for precisely because
   * they do not know these fields.
   */
  cameraType?: "VideoSource" | "Onvif" | "External" | "General" | "App" | "Footage";
  resolution?: string;
  roiContour?: unknown;
  latitude?: number;
  longitude?: number;
  protocol?: "Both" | "TCP" | "UDP";
  doRecording?: boolean;
  cameraGroupIds?: string[];
  description?: string;
}

const DEFAULT_RESOLUTION = "1920x1080";

function parseResolution(resolution: string): { width: number; height: number } {
  const match = /^(\d+)x(\d+)$/.exec(resolution.trim());
  if (!match) return parseResolution(DEFAULT_RESOLUTION);
  return { width: Number(match[1]), height: Number(match[2]) };
}

/** A full-frame rectangle ROI — the sane default when the caller doesn't specify one. */
export function defaultRoiContour(resolution: string = DEFAULT_RESOLUTION): unknown {
  const { width, height } = parseResolution(resolution);
  return [
    {
      contour: [
        { x: 0, y: 0 },
        { x: width, y: 0 },
        { x: width, y: height },
        { x: 0, y: height },
      ],
    },
  ];
}

/**
 * Builds a best-effort streamUrl from ip/port/account/password when no
 * explicit streamUrl is given. This is a generic guess (bare RTSP root path)
 * — real cameras very often need a manufacturer-specific path
 * (e.g. /Streaming/Channels/101), which this cannot know. Prefer supplying
 * streamUrl directly whenever it's known.
 */
function guessStreamUrl(spec: CameraSpec): string {
  const port = spec.port ?? 554;
  const auth = spec.account ? `${spec.account}:${spec.password ?? ""}@` : "";
  return `rtsp://${auth}${spec.ip}:${port}`;
}

export interface CameraBuildResult {
  body: Record<string, unknown>;
  warnings: string[];
}

/** Builds a full CameraRequest body with every field that's silently required in practice filled in. */
export function buildCameraBody(spec: CameraSpec, defaultEngineProfileId: number | undefined): CameraBuildResult {
  const warnings: string[] = [];

  let streamUrl = spec.streamUrl;
  if (!streamUrl) {
    if (!spec.ip) {
      throw new Error(`Camera "${spec.name}" needs either "streamUrl" or "ip".`);
    }
    streamUrl = guessStreamUrl(spec);
    warnings.push(
      `No streamUrl given — guessed "${streamUrl}" (bare RTSP root path). Many cameras need a ` +
        `manufacturer-specific path instead; if this doesn't connect, supply the exact streamUrl.`
    );
  }

  if (spec.engineProfileId === undefined && defaultEngineProfileId === undefined) {
    throw new Error(`Camera "${spec.name}" needs "engineProfileId" and no default is available.`);
  }
  const engineProfileId = spec.engineProfileId ?? defaultEngineProfileId!;
  if (spec.engineProfileId === undefined) {
    warnings.push(`No engineProfileId given — defaulted to ${defaultEngineProfileId} (first profile found).`);
  }

  const resolution = spec.resolution ?? DEFAULT_RESOLUTION;
  const roiContour = spec.roiContour ?? defaultRoiContour(resolution);
  if (!spec.roiContour) {
    warnings.push(`No roiContour given — defaulted to a full-frame rectangle for ${resolution}.`);
  }

  const hasLocation = spec.latitude !== undefined && spec.longitude !== undefined;

  const body: Record<string, unknown> = {
    name: spec.name,
    cameraType: spec.cameraType ?? "General",
    protocol: spec.protocol ?? "Both",
    doRecording: spec.doRecording ?? false,
    streamUrl,
    ip: spec.ip ?? null,
    port: spec.port ?? null,
    account: spec.account ?? "",
    password: spec.password ?? "",
    description: spec.description ?? "",
    manufacturer: "",
    model: "",
    resolution,
    frameRate: 25,
    plugins: [],
    locationType: hasLocation ? "GPS_MAP" : "NONE",
    latitude: spec.latitude ?? null,
    longitude: spec.longitude ?? null,
    engineProfileId,
    roiContour,
    gpuId: 0,
    hwDecode: false,
    schedule: { weekdays: [], forever: true },
    fpsType: "Camera",
    loop: 0,
    flipState: "None",
    codec: "H264",
    detectionMode: "",
    cameraGroupIds: spec.cameraGroupIds ?? [],
  };

  return { body, warnings };
}
