// FILE: shellEnvironment.ts
// Purpose: Capture the login-shell environment once, cache it per user, and let every process
//   (server and desktop) reuse the capture at startup instead of paying for a login shell.
// Exports: the captured name list, the cache store, the cached capture and the hydration helper.

import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";

import {
  listLoginShellCandidates,
  mergePathEntries,
  readEnvironmentFromLoginShell,
  readPathFromLaunchctl,
  type ShellEnvironmentReader,
} from "./shell";

/**
 * Everything a GUI-launched process cannot inherit but its agents still need.
 *
 * Captured as one set on purpose: the desktop hydrates all of them while the server only
 * applies `PATH`, and a shared cache entry is only reusable when both ask for the same
 * names.
 */
export const SHELL_ENVIRONMENT_NAMES = [
  "PATH",
  "SSH_AUTH_SOCK",
  "HOMEBREW_PREFIX",
  "HOMEBREW_CELLAR",
  "HOMEBREW_REPOSITORY",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
] as const;

export type ShellEnvironment = Partial<Record<string, string>>;

/**
 * Where a capture came from. `cache` means no shell was started this launch.
 */
export type ShellEnvironmentSource = "cache" | "login-shell" | "launchctl" | "unavailable";

export interface CapturedShellEnvironment {
  readonly environment: ShellEnvironment;
  readonly source: ShellEnvironmentSource;
}

export interface ShellEnvironmentCacheStore {
  readonly read: () => string | undefined;
  readonly write: (contents: string) => void;
}

export interface ShellEnvironmentStampInput {
  readonly platform: NodeJS.Platform;
  readonly shells: ReadonlyArray<string>;
  readonly homeDir: string;
}

export interface CaptureShellEnvironmentOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly platform?: NodeJS.Platform;
  readonly userShell?: string;
  readonly homeDir?: string;
  /** Seam: replaced in tests so no real shell is started. */
  readonly readEnvironment?: ShellEnvironmentReader;
  readonly readLaunchctlPath?: typeof readPathFromLaunchctl;
  readonly logWarning?: (message: string, error?: unknown) => void;
  /** Omit to always probe. Callers that want reuse pass a store. */
  readonly cache?: ShellEnvironmentCacheStore | undefined;
  readonly now?: () => number;
  /** Seam: replaced in tests that need deterministic stamping. */
  readonly readStamps?: (input: ShellEnvironmentStampInput) => Record<string, string>;
  readonly maxCacheAgeMs?: number;
}

export interface HydrateShellEnvironmentOptions extends CaptureShellEnvironmentOptions {
  /** Names the caller wants applied to its own env. Defaults to {@link SHELL_ENVIRONMENT_NAMES}. */
  readonly names?: ReadonlyArray<string>;
}

const SHELL_ENVIRONMENT_CACHE_VERSION = 1;
const SHELL_ENVIRONMENT_CACHE_FILENAME = "shell-environment.json";

/**
 * Upper bound on cache reuse.
 *
 * Startup files are stamped, so the common way a PATH changes (someone edits `.zshrc`)
 * invalidates the entry on its own. A capture can still depend on state no stamp can see —
 * `nvm use` switching a default, a PATH built by running another command — so the entry is
 * also retired after this long rather than trusted forever.
 */
const SHELL_ENVIRONMENT_CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;

interface ShellEnvironmentCacheRecord {
  readonly version: number;
  readonly capturedAt: number;
  readonly shells: ReadonlyArray<string>;
  readonly requestedNames: ReadonlyArray<string>;
  readonly source: ShellEnvironmentSource;
  readonly environment: ShellEnvironment;
  readonly stamps: Record<string, string>;
}

function logShellEnvironmentWarning(message: string, error?: unknown): void {
  console.warn(`[shell] ${message}`, error instanceof Error ? error.message : (error ?? ""));
}

function expandHome(input: string, homeDir: string): string {
  if (input === "~") return homeDir;
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return Path.join(homeDir, input.slice(2));
  }
  return input;
}

/**
 * Cache location for the whole app.
 *
 * Derived from `PEAKCODE_HOME` the same way the desktop's `BASE_DIR` and the server's
 * `resolveBaseDir` derive it, so the desktop (which probes first) and the server (which
 * inherits `PEAKCODE_HOME` from it) resolve the same file.
 */
export function defaultShellEnvironmentCachePath(
  env: NodeJS.ProcessEnv = process.env,
  homeDir: string = OS.homedir(),
): string {
  const configured = env.PEAKCODE_HOME?.trim();
  const baseDir =
    configured && configured.length > 0
      ? Path.resolve(expandHome(configured, homeDir))
      : Path.join(homeDir, ".peakcode");
  return Path.join(baseDir, "userdata", SHELL_ENVIRONMENT_CACHE_FILENAME);
}

/**
 * File-backed store. Every failure is swallowed: the cache only ever saves time, so a
 * read-only or corrupt cache must fall back to probing rather than break startup.
 */
export function createFileShellEnvironmentCache(
  options: {
    readonly cachePath?: string;
    readonly env?: NodeJS.ProcessEnv;
    readonly homeDir?: string;
  } = {},
): ShellEnvironmentCacheStore {
  const cachePath =
    options.cachePath ?? defaultShellEnvironmentCachePath(options.env, options.homeDir);

  return {
    read: () => {
      try {
        return readFileSync(cachePath, "utf8");
      } catch {
        return undefined;
      }
    },
    write: (contents) => {
      try {
        mkdirSync(Path.dirname(cachePath), { recursive: true });
        writeFileSync(cachePath, contents, { mode: 0o600 });
      } catch {
        // Best effort.
      }
    },
  };
}

function shellStartupFiles(
  platform: NodeJS.Platform,
  shell: string,
  homeDir: string,
): ReadonlyArray<string> {
  const inHome = (...names: string[]) => names.map((name) => Path.join(homeDir, name));
  const inEtc = (...names: string[]) => names.map((name) => Path.join("/etc", name));

  switch (Path.basename(shell)) {
    case "zsh":
      return [
        ...inHome(".zshenv", ".zprofile", ".zshrc", ".zlogin"),
        ...inEtc("zshenv", "zprofile", "zshrc", "zlogin"),
      ];
    case "bash":
      return [
        ...inHome(".bash_profile", ".bash_login", ".bashrc", ".profile"),
        ...inEtc("profile", "bashrc", "bash.bashrc"),
      ];
    case "fish":
      return [...inHome(".profile"), ...inHome(".config", "fish", "config.fish")];
    case "nu":
      return [...inHome(".profile"), ...inHome(".config", "nushell", "env.nu")];
    default:
      return [...inHome(".profile", ".zshrc", ".bashrc"), ...inEtc("profile")];
  }
}

/**
 * macOS builds the base PATH in `/etc/zprofile` from `path_helper`'s input files, which no
 * shell rc mtime covers.
 */
function pathHelperFiles(): ReadonlyArray<string> {
  const files = ["/etc/paths"];
  try {
    for (const entry of readdirSync("/etc/paths.d")) {
      files.push(Path.join("/etc/paths.d", entry));
    }
  } catch {
    // Directory is optional.
  }
  return files;
}

function stampFile(file: string): string {
  try {
    const stats = statSync(file);
    return `${stats.size}:${stats.mtimeMs}`;
  } catch {
    return "absent";
  }
}

/**
 * Fingerprint of everything the candidates' startup files could contribute to a capture.
 *
 * Keyed by path so a file appearing (a first `.zshrc`) invalidates just as a file changing
 * does.
 */
export function collectShellStartupStamps(
  input: ShellEnvironmentStampInput,
): Record<string, string> {
  const files = new Set<string>();
  for (const shell of input.shells) {
    for (const file of shellStartupFiles(input.platform, shell, input.homeDir)) {
      files.add(file);
    }
  }
  if (input.platform === "darwin") {
    for (const file of pathHelperFiles()) {
      files.add(file);
    }
  }

  const stamps: Record<string, string> = {};
  for (const file of files) {
    stamps[file] = stampFile(file);
  }
  return stamps;
}

function sameNames(left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((name) => rightSet.has(name));
}

function sameStamps(left: Record<string, string>, right: Record<string, string>): boolean {
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) return false;
  return leftKeys.every((key) => left[key] === right[key]);
}

function isShellEnvironmentCacheRecord(value: unknown): value is ShellEnvironmentCacheRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Partial<ShellEnvironmentCacheRecord>;
  return (
    record.version === SHELL_ENVIRONMENT_CACHE_VERSION &&
    typeof record.capturedAt === "number" &&
    Array.isArray(record.shells) &&
    Array.isArray(record.requestedNames) &&
    typeof record.environment === "object" &&
    record.environment !== null &&
    typeof record.stamps === "object" &&
    record.stamps !== null
  );
}

/**
 * Reuses a capture only while it is still describing this machine's shell setup.
 *
 * Anything unexpected — unreadable file, older version, changed shell candidates, a new or
 * edited startup file, an expired entry — falls through to probing.
 */
function readCachedEnvironment(
  store: ShellEnvironmentCacheStore | undefined,
  input: {
    readonly shells: ReadonlyArray<string>;
    readonly stamps: Record<string, string>;
    readonly now: number;
    readonly maxAgeMs: number;
  },
): ShellEnvironment | undefined {
  if (!store) return undefined;

  let raw: string | undefined;
  try {
    raw = store.read();
  } catch {
    return undefined;
  }
  if (raw === undefined) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }

  if (!isShellEnvironmentCacheRecord(parsed)) return undefined;
  if (input.now - parsed.capturedAt > input.maxAgeMs) return undefined;
  if (!sameNames(parsed.shells, input.shells)) return undefined;
  if (!sameNames(parsed.requestedNames, SHELL_ENVIRONMENT_NAMES)) return undefined;
  if (!sameStamps(parsed.stamps, input.stamps)) return undefined;

  return parsed.environment;
}

function writeCachedEnvironment(
  store: ShellEnvironmentCacheStore | undefined,
  record: ShellEnvironmentCacheRecord,
): void {
  if (!store) return;
  try {
    store.write(`${JSON.stringify(record)}\n`);
  } catch {
    // Best effort.
  }
}

function probeShellEnvironment(options: {
  readonly platform: NodeJS.Platform;
  readonly shells: ReadonlyArray<string>;
  readonly readEnvironment: ShellEnvironmentReader;
  readonly readLaunchctlPath: typeof readPathFromLaunchctl;
  readonly logWarning: (message: string, error?: unknown) => void;
}): CapturedShellEnvironment {
  const environment: ShellEnvironment = {};
  let source: ShellEnvironmentSource = "unavailable";

  for (const shell of options.shells) {
    try {
      Object.assign(environment, options.readEnvironment(shell, SHELL_ENVIRONMENT_NAMES));
    } catch (error) {
      options.logWarning(`Failed to read login shell environment from ${shell}.`, error);
    }

    if (environment.PATH) {
      source = "login-shell";
      break;
    }
  }

  if (options.platform === "darwin" && !environment.PATH) {
    const launchctlPath = options.readLaunchctlPath();
    if (launchctlPath) {
      environment.PATH = launchctlPath;
      source = "launchctl";
    }
  }

  return { environment, source };
}

/**
 * The login-shell environment for this user, from cache when it is still valid.
 */
export function captureShellEnvironment(
  options: CaptureShellEnvironmentOptions = {},
): CapturedShellEnvironment {
  const platform = options.platform ?? process.platform;
  if (platform !== "darwin" && platform !== "linux") {
    return { environment: {}, source: "unavailable" };
  }

  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? OS.homedir();
  const readStamps = options.readStamps ?? collectShellStartupStamps;
  const shells = listLoginShellCandidates(platform, env.SHELL, options.userShell);
  const input: ShellEnvironmentStampInput = { platform, shells, homeDir };
  const stamps = readStamps(input);
  const now = (options.now ?? Date.now)();

  const cached = readCachedEnvironment(options.cache, {
    shells,
    stamps,
    now,
    maxAgeMs: options.maxCacheAgeMs ?? SHELL_ENVIRONMENT_CACHE_MAX_AGE_MS,
  });
  if (cached) {
    return { environment: cached, source: "cache" };
  }

  const captured = probeShellEnvironment({
    platform,
    shells,
    readEnvironment: options.readEnvironment ?? readEnvironmentFromLoginShell,
    readLaunchctlPath: options.readLaunchctlPath ?? readPathFromLaunchctl,
    logWarning: options.logWarning ?? logShellEnvironmentWarning,
  });

  // An empty capture is not worth remembering: the next launch should try again.
  if (captured.environment.PATH) {
    writeCachedEnvironment(options.cache, {
      version: SHELL_ENVIRONMENT_CACHE_VERSION,
      capturedAt: now,
      shells,
      requestedNames: SHELL_ENVIRONMENT_NAMES,
      source: captured.source,
      environment: captured.environment,
      stamps,
    });
  }

  return captured;
}

/**
 * Apply a capture to `env`.
 *
 * `PATH` is merged with whatever the process inherited (shell entries first, deduped);
 * every other name is only filled in when the process does not already have one, so an
 * inherited `SSH_AUTH_SOCK` keeps winning.
 */
export function hydrateShellEnvironment(
  env: NodeJS.ProcessEnv,
  options: HydrateShellEnvironmentOptions = {},
): CapturedShellEnvironment {
  const platform = options.platform ?? process.platform;
  if (platform !== "darwin" && platform !== "linux") {
    return { environment: {}, source: "unavailable" };
  }

  const captured = captureShellEnvironment({ ...options, env, platform });
  const mergedPath = mergePathEntries(captured.environment.PATH, env.PATH, platform);
  if (mergedPath) {
    env.PATH = mergedPath;
  }

  for (const name of options.names ?? SHELL_ENVIRONMENT_NAMES) {
    if (name === "PATH") continue;
    const value = captured.environment[name];
    if (!env[name] && value) {
      env[name] = value;
    }
  }

  return captured;
}
