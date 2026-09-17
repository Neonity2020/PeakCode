import { homedir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";

const APP_IDENTIFIER = "peakcode";

function platformDataDir(): string {
  const home = homedir();
  switch (process.platform) {
    case "win32":
      return process.env.LOCALAPPDATA ?? join(home, "AppData", "Local");
    case "linux":
      return process.env.XDG_DATA_HOME ?? join(home, ".local", "share");
    default:
      return join(home, "Library", "Application Support");
  }
}

let overrideDataDir: string | null = null;

/**
 * Pin the toolkit's data directory. Hosts call this with their own resolved app dir
 * (PeakCode's `ServerConfig.baseDir`, OmniStudio's `OMNI_DATA_DIR`, …) so scratch
 * state — snapshots, spilled tool output, plans — lands next to the app's other state.
 */
export function setAgentDataDir(dir: string | null): void {
  overrideDataDir = dir;
}

/**
 * Resolve a path inside the toolkit data directory.
 *
 * Precedence: explicit override → `PEAKCODE_AGENT_DATA_DIR` → the platform app-data
 * directory. Snapshots, spill files and plan documents all live under here, never
 * inside the user's workspace.
 */
export function getDataDir(...parts: string[]): string {
  const base =
    overrideDataDir ??
    process.env.PEAKCODE_AGENT_DATA_DIR ??
    join(platformDataDir(), APP_IDENTIFIER, "agent");
  return parts.length > 0 ? join(base, ...parts) : base;
}

/**
 * True when `target` points into the toolkit's own data directory (or the app-data
 * directory that contains it). Used to keep the agent's file tools out of the
 * toolkit's own state, which also holds credentials.
 */
export function isAgentDataPath(target: string): boolean {
  try {
    const resolved = resolve(target);
    const dataDir = resolve(getDataDir());
    const hits = (root: string) => resolved === root || resolved.startsWith(root + sep);
    const parent = dirname(dataDir);
    const ours = basename(parent) === APP_IDENTIFIER || basename(parent).startsWith("peakcode");
    return hits(dataDir) || (ours && hits(parent));
  } catch {
    return false;
  }
}
