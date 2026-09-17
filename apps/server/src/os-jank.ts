// FILE: os-jank.ts
// Purpose: Smooths over shell/path differences between packaged app launches and login shells.
// Exports: PATH hydration plus base-dir helpers used by server startup.

import * as OS from "node:os";
import { Effect, Path } from "effect";
import { readPathFromLaunchctl, type ShellEnvironmentReader } from "@peakcode/shared/shell";
import {
  hydrateShellEnvironment,
  type ShellEnvironmentCacheStore,
  type ShellEnvironmentStampInput,
} from "@peakcode/shared/shellEnvironment";

function logPathHydrationWarning(message: string, error?: unknown): void {
  console.warn(`[server] ${message}`, error instanceof Error ? error.message : (error ?? ""));
}

export interface FixPathOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly platform?: NodeJS.Platform;
  readonly readEnvironment?: ShellEnvironmentReader;
  readonly readLaunchctlPath?: typeof readPathFromLaunchctl;
  readonly userShell?: string;
  readonly logWarning?: (message: string, error?: unknown) => void;
  /**
   * Omit to probe the login shell on every start. The server passes the shared file cache:
   * the desktop already probed the same shell for this launch, and a repeat launch can
   * reuse a capture whose startup files have not changed.
   */
  readonly cache?: ShellEnvironmentCacheStore | undefined;
  readonly now?: () => number;
  readonly readStamps?: (input: ShellEnvironmentStampInput) => Record<string, string>;
}

/**
 * Give the agent's child processes the PATH a login shell would have.
 *
 * Only `PATH` is applied: the server inherits the rest of its environment from whichever
 * process launched it.
 */
export function fixPath(options: FixPathOptions = {}): void {
  try {
    hydrateShellEnvironment(options.env ?? process.env, {
      ...options,
      names: ["PATH"],
    });
  } catch (error) {
    (options.logWarning ?? logPathHydrationWarning)(
      "Failed to hydrate PATH from the user environment.",
      error,
    );
  }
}

export const expandHomePath = Effect.fn(function* (input: string) {
  const { join } = yield* Path.Path;
  if (input === "~") {
    return OS.homedir();
  }
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return join(OS.homedir(), input.slice(2));
  }
  return input;
});

export const resolveBaseDir = Effect.fn(function* (raw: string | undefined) {
  const { join, resolve } = yield* Path.Path;
  if (!raw || raw.trim().length === 0) {
    return join(OS.homedir(), ".peakcode");
  }
  return resolve(yield* expandHomePath(raw.trim()));
});
