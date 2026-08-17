import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readSync,
  realpathSync,
  statfsSync,
  statSync,
  type BigIntStats,
} from "node:fs";
import { resolve, sep } from "node:path";

/**
 * What this server is willing to read off the local disk and send to a
 * deployment.
 *
 * 25 operations accept a file, and the path for one arrives as a tool argument
 * — which means it is chosen by a model, from whatever is in its context. That
 * context includes text this server itself returned: camera names, alert rule
 * descriptions, watchlist entries, all of it typed by whoever can write to the
 * deployment. So "upload the file at this path" is reachable from data, and the
 * server used to answer it with a bare `readFileSync` on anything the process
 * could open.
 *
 * The consequence is worth stating plainly, because it is not the usual
 * directory-traversal story: this is not a service exposing a filesystem to
 * strangers, it is a local process that reads a file and POSTs it somewhere. A
 * path pointing at `~/.ssh/id_rsa`, or at the MCP client's own config file —
 * which on a normal install holds `IVEDAAI_PASSWORD` in clear text — is a
 * complete exfiltration route, from local secret to remote server, in one call.
 *
 * `IVEDAAI_UPLOAD_ROOT` is the real control: set it and nothing outside that
 * directory can be read, whatever the path says. With no root, uploads are
 * disabled unless the operator explicitly accepts the old behavior through
 * `IVEDAAI_ALLOW_UNCONFINED_UPLOADS=true`. The checks below remain a backstop
 * in that compatibility mode; they are not presented as a boundary.
 */
export interface UploadPolicy {
  /** Canonical path uploads are confined to, when `IVEDAAI_UPLOAD_ROOT` is set. */
  root?: string;
  /** Absolute configured spelling, retained for the pre-filesystem lexical check. */
  configuredRoot?: string;
  /** Explicit compatibility escape hatch for operators who accept arbitrary local-file access. */
  allowUnconfined?: boolean;
  /** Refuse anything larger. The descriptor-bound reader stops at this cap. */
  maxBytes: number;
}

/**
 * 64 MB, chosen against what the API actually takes: face and licence-plate
 * images, engine models, notification sounds. Large enough that no legitimate
 * upload exceeds it, small enough that a path pointing at a disk image or a log
 * that grew without bound is refused rather than read into the heap of a
 * process the client cannot restart.
 */
const DEFAULT_MAX_UPLOAD_BYTES = 64 * 1024 * 1024;

/**
 * Path fragments refused in explicit unconstrained compatibility mode.
 *
 * Deliberately short, and deliberately not a general-purpose secret detector.
 * Each entry is somewhere a credential is kept by convention, so refusing it
 * costs a legitimate caller nothing — nobody's face-target photo lives in
 * `.ssh`. It cannot be complete and is not offered as though it were; the
 * refusal message names `IVEDAAI_UPLOAD_ROOT` for that reason.
 */
const SENSITIVE_SEGMENTS = [".ssh", ".aws", ".gnupg", ".kube", ".docker", ".azure", "gcloud"];

const SENSITIVE_NAMES = [
  ".env",
  ".npmrc",
  ".netrc",
  "_netrc",
  ".pgpass",
  ".htpasswd",
  "credentials",
  "id_rsa",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  // The MCP client's own configuration, which on a normal install of this
  // server holds IVEDAAI_PASSWORD in clear text.
  "claude_desktop_config.json",
];

const SENSITIVE_EXTENSIONS = [".pem", ".key", ".pfx", ".p12", ".jks", ".keystore", ".ppk"];

/** Linux virtual filesystems whose regular-looking files can expose process or kernel state. */
const LINUX_VIRTUAL_FILESYSTEMS = new Set([
  0x9fa0, // procfs
  0x62656572, // sysfs
  0x27e0eb, // cgroup v1
  0x63677270, // cgroup v2
  0x64626720, // debugfs
  0x73636673, // securityfs
  0x74726163, // tracefs
  0xcafe4a11, // bpf
]);

/** Sensitive-name matching follows ordinary Windows case-insensitivity. */
const foldCase = (value: string): string => (process.platform === "win32" ? value.toLowerCase() : value);

function parseMaxBytes(): number {
  const raw = process.env.IVEDAAI_MAX_UPLOAD_BYTES;
  if (!raw) return DEFAULT_MAX_UPLOAD_BYTES;
  const parsed = Number(raw);
  if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(parsed)) {
    throw new Error(`IVEDAAI_MAX_UPLOAD_BYTES must be a positive integer, got "${raw}".`);
  }
  return parsed;
}

export function uploadPolicyFromEnv(): UploadPolicy {
  const configured = process.env.IVEDAAI_UPLOAD_ROOT;
  let root: string | undefined;
  let configuredRoot: string | undefined;
  if (configured) {
    const absolute = resolve(configured);
    try {
      // The root is resolved through symlinks once, here, so that the
      // containment check below compares two real paths. Failing at startup on
      // a root that does not exist is the right moment to find out: the
      // alternative is every upload failing later with a confusing message.
      root = realpathSync(absolute);
      configuredRoot = absolute;
    } catch {
      throw new Error(
        `IVEDAAI_UPLOAD_ROOT points at "${configured}", which does not exist or cannot be read. ` +
          `Create the directory or unset the variable.`
      );
    }
    if (!statSync(root).isDirectory()) {
      throw new Error(`IVEDAAI_UPLOAD_ROOT points at "${configured}", which is not a directory.`);
    }
  }
  return {
    root,
    configuredRoot,
    allowUnconfined: !root && process.env.IVEDAAI_ALLOW_UNCONFINED_UPLOADS === "true",
    maxBytes: parseMaxBytes(),
  };
}

/** True when canonical `candidate` is `root` itself or sits underneath it. */
export function isUploadPathInsideRoot(root: string, candidate: string, separator = sep): boolean {
  if (candidate === root) return true;
  const prefix = root.endsWith(separator) ? root : `${root}${separator}`;
  // Exact comparison is intentional. `node:path.win32.relative` folds case,
  // but an NTFS directory can opt into case sensitivity and make `Root` and
  // `root` distinct siblings. Rejecting a differently-cased spelling on an
  // ordinary Windows directory is the safe false negative.
  return candidate.startsWith(prefix);
}

function sensitiveReason(realPath: string): string | undefined {
  const segments = realPath.split(/[\\/]/).map(foldCase);
  const name = segments[segments.length - 1] ?? "";
  const directories = segments.slice(0, -1);

  const segment = SENSITIVE_SEGMENTS.find((s) => directories.includes(foldCase(s)));
  if (segment) return `it is inside a "${segment}" directory`;
  if (SENSITIVE_NAMES.some((n) => name === foldCase(n))) return `it is named "${name}"`;
  const extension = SENSITIVE_EXTENSIONS.find((e) => name.endsWith(foldCase(e)));
  if (extension) return `it ends in "${extension}"`;
  return undefined;
}

/**
 * Resolves a requested upload path, or throws with something a caller can act on.
 *
 * Returns the real path — symlinks resolved — so the caller reads the same file
 * this vetted, rather than whatever the link points at by the time it opens it.
 */
interface VettedUpload {
  path: string;
  stats: BigIntStats;
}

type StatFile = (path: string) => BigIntStats;
const statFileExactly: StatFile = (path) => statSync(path, { bigint: true });

export function isSameUploadFileIdentity(
  left: Pick<BigIntStats, "dev" | "ino">,
  right: Pick<BigIntStats, "dev" | "ino">
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function inspectUploadPath(requested: string, policy: UploadPolicy, statFile: StatFile = statFileExactly): VettedUpload {
  if (typeof requested !== "string" || requested.trim() === "") {
    throw new Error("Upload path is empty. Give the full path to a file on the machine running this server.");
  }

  if (!policy.root && !policy.allowUnconfined) {
    throw new Error(
      "Local file uploads are disabled until IVEDAAI_UPLOAD_ROOT confines them to a directory. " +
        "Set that variable to the directory containing approved upload files."
    );
  }

  const absolute = resolve(requested);

  // Checked lexically first, before the filesystem is touched at all. A
  // confined server that answered "no such file" for one path outside the root
  // and "outside the root" for another would be reporting what exists out
  // there, which is exactly what confining it was meant to stop.
  const lexicalRoots = [policy.configuredRoot, policy.root].filter((root): root is string => root !== undefined);
  if (lexicalRoots.length > 0 && !lexicalRoots.some((root) => isUploadPathInsideRoot(root, absolute))) {
    const displayRoot = policy.configuredRoot ?? policy.root;
    throw new Error(
      `Refusing to upload "${requested}": it is outside IVEDAAI_UPLOAD_ROOT (${displayRoot}), which this ` +
        `server is confined to. Move the file inside that directory, or ask the operator to change the setting.`
    );
  }

  // Establish identity before canonical containment. If an ancestor is swapped
  // after this point, either realpath observes the outside target and rejects it,
  // or the opened descriptor no longer matches this identity. Doing realpath
  // first left macOS/Windows vulnerable to a swap immediately before stat.
  let stats: BigIntStats;
  try {
    stats = statFile(absolute);
  } catch {
    throw new Error(
      `No readable file at "${requested}" (resolved to "${absolute}") on the machine running this server. ` +
        `The path is read here, not on the IvedaAI server, and not on the machine running the MCP client if ` +
        `that is a different one.`
    );
  }

  let realPath: string;
  try {
    realPath = realpathSync(absolute);
  } catch {
    throw new Error(`Refusing to upload "${requested}": the file changed while its path was being validated.`);
  }

  // Again, on the real path: a symlink inside the root pointing outside it
  // passes the check above and would otherwise escape here.
  if (policy.root && !isUploadPathInsideRoot(policy.root, realPath)) {
    throw new Error(
      `Refusing to upload "${requested}": it resolves to "${realPath}", outside IVEDAAI_UPLOAD_ROOT ` +
        `(${policy.root}). A symlink cannot be used to reach past the configured root.`
    );
  }

  if (process.platform === "linux" && LINUX_VIRTUAL_FILESYSTEMS.has(statfsSync(realPath).type)) {
    throw new Error(
      `Refusing to upload "${requested}": it is on a virtual filesystem that can expose process or kernel state.`
    );
  }

  // Not merely tidiness: a FIFO or a character device answers a read forever,
  // which would hang the upload rather than fail it.
  if (!stats.isFile()) {
    throw new Error(`Refusing to upload "${requested}": it is not a regular file.`);
  }
  if (stats.size > BigInt(policy.maxBytes)) {
    throw new Error(
      `Refusing to upload "${requested}": it is ${stats.size} bytes, over the ${policy.maxBytes}-byte limit. ` +
        `Raise IVEDAAI_MAX_UPLOAD_BYTES if this file is genuinely meant to be sent.`
    );
  }

  if (!policy.root) {
    const reason = sensitiveReason(realPath);
    if (reason) {
      throw new Error(
        `Refusing to upload "${requested}" because ${reason}, which is where credentials are normally kept. ` +
          `Uploading it would send it to the IvedaAI deployment. If this file really is meant to be uploaded, ` +
          `copy it somewhere that is not credential-shaped. Note that this check only covers the obvious ` +
          `locations — set IVEDAAI_UPLOAD_ROOT to confine uploads to one directory properly.`
      );
    }
  }

  return { path: realPath, stats };
}

export function resolveUploadPath(requested: string, policy: UploadPolicy): string {
  return inspectUploadPath(requested, policy).path;
}

/**
 * Opens the vetted path without following a replacement symlink and reads at
 * most one byte beyond the configured limit, so a growing file cannot bypass
 * the pre-open size check or make the process allocate without bound.
 */
type OpenFile = (path: string, flags: number) => number;

export function readUploadFile(
  requested: string,
  policy: UploadPolicy,
  openFile: OpenFile = openSync,
  statFile: StatFile = statFileExactly
): { path: string; data: Buffer } {
  const vetted = inspectUploadPath(requested, policy, statFile);
  const path = vetted.path;
  const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
  // A pathname race can replace a vetted regular file with a FIFO. O_RDONLY
  // would block before fstat could reject the substituted descriptor, so make
  // acquisition nonblocking where the platform exposes the flag. It has no
  // effect on ordinary regular files.
  const nonBlocking = typeof constants.O_NONBLOCK === "number" ? constants.O_NONBLOCK : 0;
  let fd: number;
  try {
    fd = openFile(path, constants.O_RDONLY | noFollow | nonBlocking);
  } catch (error) {
    const detail = error instanceof Error ? ` ${error.message}` : "";
    throw new Error(`Refusing to upload "${requested}": the vetted file could not be opened safely.${detail}`);
  }

  try {
    const opened = fstatSync(fd, { bigint: true });
    if (!isSameUploadFileIdentity(opened, vetted.stats)) {
      throw new Error(`Refusing to upload "${requested}": the file changed after validation and before it was opened.`);
    }
    if (!opened.isFile()) {
      throw new Error(`Refusing to upload "${requested}": it is not a regular file.`);
    }
    if (opened.size > BigInt(policy.maxBytes)) {
      throw new Error(
        `Refusing to upload "${requested}": it is ${opened.size} bytes, over the ${policy.maxBytes}-byte limit. ` +
          `Raise IVEDAAI_MAX_UPLOAD_BYTES if this file is genuinely meant to be sent.`
      );
    }

    // Linux exposes the path and filesystem belonging to the opened descriptor,
    // not merely to the pathname we validated. This independently catches an
    // ancestor-directory swap and re-applies confinement to what will be read.
    if (process.platform === "linux") {
      const descriptor = `/proc/self/fd/${fd}`;
      let openedPath: string;
      try {
        openedPath = realpathSync(descriptor);
      } catch {
        throw new Error(`Refusing to upload "${requested}": the opened file could not be revalidated.`);
      }
      if (policy.root && !isUploadPathInsideRoot(policy.root, openedPath)) {
        throw new Error(`Refusing to upload "${requested}": the opened file escaped IVEDAAI_UPLOAD_ROOT.`);
      }
      if (LINUX_VIRTUAL_FILESYSTEMS.has(statfsSync(descriptor).type)) {
        throw new Error(
          `Refusing to upload "${requested}": the opened file is on a virtual filesystem that can expose process or kernel state.`
        );
      }
    }

    const chunks: Buffer[] = [];
    let total = 0;
    while (total <= policy.maxBytes) {
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, policy.maxBytes - total + 1));
      const bytesRead = readSync(fd, chunk, 0, chunk.length, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > policy.maxBytes) {
        throw new Error(
          `Refusing to upload "${requested}": it grew beyond the ${policy.maxBytes}-byte limit while being read. ` +
            `Raise IVEDAAI_MAX_UPLOAD_BYTES if this file is genuinely meant to be sent.`
        );
      }
      chunks.push(chunk.subarray(0, bytesRead));
    }
    return { path, data: Buffer.concat(chunks, total) };
  } finally {
    closeSync(fd);
  }
}
