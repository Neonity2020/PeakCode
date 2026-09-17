// FILE: computerUseHelper.ts
// Purpose: Installs, signs and starts the native computer-use helper, and reports the state
//          the app is in.
// Layer: Desktop computer-use lifecycle
// Depends on: node:child_process/crypto/fs, the shared computer-use contract and build recipe
//
// ## The property this file exists to protect
//
// macOS pins an Accessibility grant to the signed identity of the app that holds it. For the
// helper that identity is stable — but only if the bundle on disk does not change. So the
// build is content-addressed: the artifact being installed is fingerprinted, and an install
// whose fingerprint still matches is left completely untouched. Rebuilding the host app a
// hundred times therefore does not disturb the helper, and the user's grant keeps working.
//
// ## Where the helper comes from
//
// Two sources, in this order:
//
// 1. **Source, in a checkout.** `apps/desktop/native/computer-use/main.m` is compiled and
//    signed on the spot, so a developer always has the helper their working tree describes.
// 2. **The app's own bundle, in a packaged build.** There is no source to compile there, so
//    the release ships a built bundle in `Contents/Resources/computer-use` and this copies it
//    into place. The copy keeps the shipped signature when that signature is anchored to a
//    team, and otherwise applies this machine's own plan — because the ad-hoc packaging step
//    (`codesign --deep`) cannot preserve a designated requirement, and a copy that kept its
//    `cdhash` requirement would lose the grant on the next app update.
//
// The helper is started through LaunchServices rather than as a child process. That is not a
// style choice: a child process inherits its parent's privacy attribution, so a spawned
// helper would borrow Peak Code's identity — and the dev build's ad-hoc identity changes on
// every rebuild, taking the grant with it. LaunchServices gives the helper its own.
//
// The socket path and the token are deliberately outside the app bundle too, for the same
// reason: moving the helper would invalidate the grant.

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  COMPUTER_USE_BUNDLED_HELPER_DIR_NAME,
  COMPUTER_USE_HELPER_APP_NAME,
  COMPUTER_USE_HELPER_BUNDLE_ID,
  PEAKCODE_COMPUTER_USE_BUNDLED_HELPER_ENV,
  resolveComputerUseDir,
  resolveComputerUseHelperPath,
  resolveComputerUseSocketPath,
  resolveComputerUseTokenPath,
} from "@peakcode/shared/computerUse";
import {
  compileHelperBundle,
  HELPER_BUILD_REVISION,
  helperBundleFingerprint,
  helperDesignatedRequirement,
  helperExecutablePath,
  helperSourceFingerprint,
  isAnchoredRequirement,
  resolveSigningPlan,
  signHelperBundle,
  type SigningPlan,
} from "@peakcode/shared/computerUseHelperBuild";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Where the helper came from. Recorded so a support question does not have to guess. */
export type HelperInstallSource = "compiled" | "bundled";

export type ComputerUseHelperStatus = {
  /** `ready` means the socket can be dialed. */
  readonly status: "ready" | "unsupported" | "failed";
  readonly helperPath: string;
  readonly socketPath: string;
  readonly directory: string;
  /** True when this call rebuilt the bundle, which is the one case that may need a re-grant. */
  readonly rebuilt: boolean;
  /** Which identity signed the helper — `ad-hoc`, or a certificate's common name. */
  readonly signingIdentity?: string;
  /** Which of the two sources the installed helper came from. */
  readonly source?: HelperInstallSource;
  readonly detail?: string;
};

type InstallMetadata = {
  readonly sourceHash: string;
  readonly buildRevision: number;
  readonly identifier: string;
  /** Which identity signed it. Recorded because it explains a requirement mismatch later. */
  readonly signingIdentity: string;
  readonly source: HelperInstallSource;
  readonly builtAt: string;
};

type HelperArtifact =
  | { readonly kind: "compiled"; readonly sourcePath: string }
  | { readonly kind: "bundled"; readonly bundlePath: string };

function metadataPath(directory: string): string {
  return join(directory, ".helper-build.json");
}

function readInstallMetadata(directory: string): InstallMetadata | null {
  try {
    const raw = readFileSync(metadataPath(directory), "utf8");
    const parsed = JSON.parse(raw) as InstallMetadata;
    return typeof parsed?.sourceHash === "string" ? parsed : null;
  } catch {
    return null;
  }
}

/** The native source, when running from a checkout rather than a packaged bundle. */
function resolveNativeSourcePath(): string | null {
  // dist-electron/ → apps/desktop/native/computer-use/main.m
  const candidate = resolve(__dirname, "..", "native", "computer-use", "main.m");
  return existsSync(candidate) ? candidate : null;
}

/**
 * The helper that shipped inside the app bundle, when there is one.
 *
 * `resourcesPath` exists only in the Electron main process, which is why this is read off the
 * process rather than imported from `electron`: this module stays importable — and testable —
 * outside Electron.
 */
export function resolveBundledHelperPath(env: NodeJS.ProcessEnv = process.env): string | null {
  const override = env[PEAKCODE_COMPUTER_USE_BUNDLED_HELPER_ENV]?.trim();
  if (override) {
    return existsSync(override) ? override : null;
  }

  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (!resourcesPath) {
    return null;
  }

  const candidate = join(
    resourcesPath,
    COMPUTER_USE_BUNDLED_HELPER_DIR_NAME,
    COMPUTER_USE_HELPER_APP_NAME,
  );
  return existsSync(candidate) ? candidate : null;
}

/** The token a client has to present. Stable across starts so a running client is not
 *  locked out by a helper restart, and 0600 so only this user can read it. */
function ensureToken(tokenPath: string): void {
  if (existsSync(tokenPath)) {
    chmodSync(tokenPath, 0o600);
    return;
  }
  mkdirSync(dirname(tokenPath), { recursive: true });
  writeFileSync(tokenPath, `${randomBytes(32).toString("hex")}\n`, { mode: 0o600 });
}

/** Compile the helper from source into a fresh bundle at `stagingPath`. */
function stageCompiledHelper(
  sourcePath: string,
  stagingPath: string,
  plan: SigningPlan,
): { ok: true; warning?: string } | { ok: false; detail: string } {
  const compiled = compileHelperBundle({ sourcePath, bundlePath: stagingPath, plan });
  return compiled.ok ? { ok: true } : { ok: false, detail: compiled.detail };
}

/**
 * Copy the shipped helper into a fresh bundle at `stagingPath`, and make sure the copy carries
 * a designated requirement this machine can keep.
 *
 * A shipped signature that is anchored to a team is kept exactly as it is: it is the strongest
 * thing this path will ever see, and re-signing with an ad-hoc identity would replace it with
 * something weaker. Anything else — a `cdhash` left behind by the packaging step's
 * `codesign --deep`, or no signature at all — is replaced with this machine's plan, because a
 * `cdhash` requirement stops matching the moment the binary changes.
 *
 * A signing failure is a warning rather than an error: the copy is already a runnable helper,
 * and refusing to install it would trade a working tool for a tidy state.
 */
function stageBundledHelper(
  bundlePath: string,
  stagingPath: string,
  plan: SigningPlan,
): { ok: true; warning?: string } | { ok: false; detail: string } {
  try {
    // The staging path is inside the install directory, so this is a local copy of a directory
    // tree — no privileges, and the result is replaced into place in one step below.
    cpSync(bundlePath, stagingPath, { recursive: true, dereference: false });
    chmodSync(helperExecutablePath(stagingPath), 0o755);
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }

  if (isAnchoredRequirement(helperDesignatedRequirement(stagingPath))) {
    return { ok: true };
  }

  const signed = signHelperBundle(stagingPath, plan);
  return signed.ok
    ? { ok: true }
    : {
        ok: true,
        warning:
          `the helper was installed but could not be re-signed (${signed.detail}); its grant may ` +
          "not survive the next app update",
      };
}

export interface EnsureInstalledHelperOptions {
  /** Install directory. Defaults to the real one; tests point this at a temp dir. */
  readonly directory?: string;
  /** Native source to compile. `null` means "there is none"; omit to detect it. */
  readonly sourcePath?: string | null;
  /** Shipped helper bundle to copy. `null` means "there is none"; omit to detect it. */
  readonly bundledHelperPath?: string | null;
  /** Signing plan. Defaults to the resolved one; tests pass a fixed ad-hoc plan. */
  readonly plan?: SigningPlan;
}

/**
 * Install the helper if it is missing or out of date.
 *
 * Returns without touching anything when the installed bundle already matches the artifact —
 * which is the normal case, and the reason a rebuild of the app does not cost the user their
 * grant. Nothing here is fatal: every failure is a state the caller reports.
 */
export function ensureInstalledHelper(options: EnsureInstalledHelperOptions = {}): {
  installed: boolean;
  rebuilt: boolean;
  signingIdentity?: string;
  source?: HelperInstallSource;
  detail?: string;
} {
  const directory = options.directory ?? resolveComputerUseDir();
  const helperPath =
    options.directory === undefined
      ? resolveComputerUseHelperPath()
      : join(options.directory, COMPUTER_USE_HELPER_APP_NAME);
  const executable = helperExecutablePath(helperPath);

  const sourcePath =
    options.sourcePath === undefined ? resolveNativeSourcePath() : options.sourcePath;
  const bundledBundlePath =
    options.bundledHelperPath === undefined
      ? resolveBundledHelperPath()
      : options.bundledHelperPath;

  const artifact: HelperArtifact | null = sourcePath
    ? { kind: "compiled", sourcePath }
    : bundledBundlePath
      ? { kind: "bundled", bundlePath: bundledBundlePath }
      : null;

  if (!artifact) {
    // Neither source nor a shipped copy: accept whatever is already installed rather than
    // reporting a build failure the user cannot act on.
    if (existsSync(executable)) {
      return { installed: true, rebuilt: false };
    }
    return {
      installed: false,
      rebuilt: false,
      detail:
        "the computer-use helper is not installed, and this build carries neither the native " +
        "source nor a bundled copy to install it from",
    };
  }

  const plan = options.plan ?? resolveSigningPlan();
  const sourceHash =
    artifact.kind === "compiled"
      ? helperSourceFingerprint(artifact.sourcePath, plan)
      : helperBundleFingerprint(artifact.bundlePath, plan);

  const metadata = readInstallMetadata(directory);
  if (existsSync(executable) && metadata?.sourceHash === sourceHash) {
    return {
      installed: true,
      rebuilt: false,
      signingIdentity: metadata.signingIdentity || plan.label,
      // What is on disk, which is not necessarily what this build would install: metadata
      // written before this field existed falls back to the artifact at hand.
      source: metadata.source ?? artifact.kind,
    };
  }

  const stagingPath = join(directory, ".staging-helper");
  rmSync(stagingPath, { recursive: true, force: true });

  const staged =
    artifact.kind === "compiled"
      ? stageCompiledHelper(artifact.sourcePath, stagingPath, plan)
      : stageBundledHelper(artifact.bundlePath, stagingPath, plan);

  if (!staged.ok) {
    rmSync(stagingPath, { recursive: true, force: true });
    return { installed: false, rebuilt: false, detail: staged.detail };
  }

  // Swap in one step so a concurrent launch never observes a half-written bundle.
  rmSync(helperPath, { recursive: true, force: true });
  mkdirSync(dirname(helperPath), { recursive: true });
  renameSync(stagingPath, helperPath);

  writeFileSync(
    metadataPath(directory),
    `${JSON.stringify(
      {
        sourceHash,
        buildRevision: HELPER_BUILD_REVISION,
        identifier: COMPUTER_USE_HELPER_BUNDLE_ID,
        signingIdentity: plan.label,
        source: artifact.kind,
        builtAt: new Date().toISOString(),
      } satisfies InstallMetadata,
      null,
      2,
    )}\n`,
  );

  return {
    installed: true,
    rebuilt: true,
    signingIdentity: plan.label,
    source: artifact.kind,
    ...(staged.warning ? { detail: staged.warning } : {}),
  };
}

/**
 * Start the helper through LaunchServices.
 *
 * `open` is what gives the helper its own privacy attribution instead of borrowing this
 * process's — the whole point of the design. It returns as soon as the app is launched; the
 * client polls the socket for readiness rather than waiting here.
 *
 * There is deliberately no "is it already running" guard here. The socket file survives a
 * crash, so checking for it either skips the relaunch a dead helper needs or is a guess that
 * has to be re-verified anyway. The helper owns that decision instead: on start it asks the
 * existing socket whether a live helper owns it and exits if so, so launching an already
 * running helper is a no-op that costs one process start. LaunchServices does not pass
 * arguments to an app that is already running, which also means `--prompt-access` is only
 * ever seen by a genuine first start.
 */
function launchHelper(
  helperPath: string,
  directory: string,
  socketPath: string,
  tokenPath: string,
  promptForAccess: boolean,
): void {
  // The helper accepts these as arguments, but LaunchServices cannot be relied on to pass
  // them to an app that is already running. They match the defaults the helper computes, so
  // a second launch and a first launch behave the same way.
  const args = [
    "-g",
    "-a",
    helperPath,
    "--args",
    "--dir",
    directory,
    "--socket",
    socketPath,
    "--token-file",
    tokenPath,
  ];
  if (promptForAccess) {
    args.push("--prompt-access");
  }

  spawnSync("open", args, {
    encoding: "utf8",
  });
}

/**
 * Make the helper ready to serve, and say what happened.
 *
 * Never throws: a missing compiler or a denied permission is a state the caller reports, not
 * a reason to fail app startup.
 */
export function ensureComputerUseHelper(): ComputerUseHelperStatus {
  const directory = resolveComputerUseDir();
  const helperPath = resolveComputerUseHelperPath();
  const socketPath = resolveComputerUseSocketPath();
  const tokenPath = resolveComputerUseTokenPath();

  if (process.platform !== "darwin") {
    return {
      status: "unsupported",
      helperPath,
      socketPath,
      directory,
      rebuilt: false,
      detail: `computer use needs macOS, this is ${process.platform}`,
    };
  }

  let install: ReturnType<typeof ensureInstalledHelper>;
  try {
    install = ensureInstalledHelper();
  } catch (error) {
    return {
      status: "failed",
      helperPath,
      socketPath,
      directory,
      rebuilt: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  if (!install.installed) {
    return {
      status: "failed",
      helperPath,
      socketPath,
      directory,
      rebuilt: false,
      detail: install.detail ?? "the computer-use helper could not be installed",
    };
  }

  try {
    ensureToken(tokenPath);
    // A fresh install is the one moment the user has just been told this helper exists, so
    // it is the right moment for macOS to show its own "wants to control this computer"
    // prompt. Later launches stay quiet — nagging someone who already declined is worse than
    // letting them find the switch. The model can always ask through `request_access`.
    launchHelper(helperPath, directory, socketPath, tokenPath, install.rebuilt);
  } catch (error) {
    return {
      status: "failed",
      helperPath,
      socketPath,
      directory,
      rebuilt: install.rebuilt,
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  return {
    status: "ready",
    helperPath,
    socketPath,
    directory,
    rebuilt: install.rebuilt,
    ...(install.signingIdentity === undefined ? {} : { signingIdentity: install.signingIdentity }),
    ...(install.source === undefined ? {} : { source: install.source }),
    ...(install.detail === undefined ? {} : { detail: install.detail }),
  };
}

/** Read the token a client presents on the socket. */
export function readComputerUseToken(): string | null {
  try {
    return readFileSync(resolveComputerUseTokenPath(), "utf8").trim() || null;
  } catch {
    return null;
  }
}

/** The bundle's modification time, for diagnosing a helper that was replaced underneath a
 *  running app. Not used for correctness — the build hash decides that. */
export function helperMtime(): number | null {
  try {
    return statSync(helperExecutablePath(resolveComputerUseHelperPath())).mtimeMs;
  } catch {
    return null;
  }
}

/** Re-exported so callers do not have to reach into @peakcode/shared for the paths that
 *  describe the same thing this module manages. */
export { resolveComputerUseHelperPath, resolveComputerUseSocketPath };
