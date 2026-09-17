// FILE: syncShellEnvironment.ts
// Purpose: Hydrates Electron's inherited env with values from the user's login shell.
// Exports: syncShellEnvironment for desktop startup.

import { readPathFromLaunchctl, type ShellEnvironmentReader } from "@peakcode/shared/shell";
import {
  hydrateShellEnvironment,
  type ShellEnvironmentCacheStore,
  type ShellEnvironmentStampInput,
} from "@peakcode/shared/shellEnvironment";

function logShellEnvironmentWarning(message: string, error?: unknown): void {
  console.warn(`[desktop] ${message}`, error instanceof Error ? error.message : (error ?? ""));
}

export interface SyncShellEnvironmentOptions {
  readonly platform?: NodeJS.Platform;
  readonly readEnvironment?: ShellEnvironmentReader;
  readonly readLaunchctlPath?: typeof readPathFromLaunchctl;
  readonly userShell?: string;
  readonly logWarning?: (message: string, error?: unknown) => void;
  /**
   * Omit to probe the login shell on every start. The desktop passes the shared file cache:
   * this process probes first and writes it, so the server spawned below reuses the capture
   * instead of starting the same login shell again.
   */
  readonly cache?: ShellEnvironmentCacheStore | undefined;
  readonly now?: () => number;
  readonly readStamps?: (input: ShellEnvironmentStampInput) => Record<string, string>;
}

/**
 * A GUI-launched process inherits launchd's minimal environment, so the user's real PATH,
 * agent socket and toolchain prefixes all have to come from their login shell.
 */
export function syncShellEnvironment(
  env: NodeJS.ProcessEnv = process.env,
  options: SyncShellEnvironmentOptions = {},
): void {
  try {
    hydrateShellEnvironment(env, options);
  } catch (error) {
    (options.logWarning ?? logShellEnvironmentWarning)(
      "Failed to synchronize the desktop shell environment.",
      error,
    );
  }
}
