/**
 * TerminalSubprocess - Detects running subprocesses and provider descendants behind a terminal session.
 *
 * @module TerminalSubprocess
 */
import path from "node:path";

import {
  deriveTerminalProcessIdentity,
  type TerminalCliKind,
} from "@peakcode/shared/terminalThreads";

import { runProcess } from "../processRunner";
import type { TerminalSessionState } from "./Services/Manager.ts";

const PROVIDER_INPUT_ACTIVITY_GRACE_MS = 8_000;
const PROVIDER_OUTPUT_ACTIVITY_GRACE_MS = 4_000;

export interface TerminalSubprocessActivity {
  cliKind: TerminalCliKind | null;
  hasRunningSubprocess: boolean;
  hasProviderDescendant: boolean;
  hasNonProviderSubprocess: boolean;
}

export type TerminalSubprocessChecker = (
  terminalPid: number,
) => Promise<boolean | TerminalSubprocessActivity>;

export function normalizeSubprocessActivity(
  result: boolean | TerminalSubprocessActivity,
): TerminalSubprocessActivity {
  return typeof result === "boolean"
    ? {
        cliKind: null,
        hasNonProviderSubprocess: result,
        hasProviderDescendant: false,
        hasRunningSubprocess: result,
      }
    : result;
}

export function isProviderSessionBusy(session: TerminalSessionState, now: number): boolean {
  const lastInputAt = session.lastInputAt ?? 0;
  const lastOutputAt = session.lastOutputAt ?? 0;
  const latestSignalAt = Math.max(lastInputAt, lastOutputAt);
  if (latestSignalAt <= 0) {
    return false;
  }
  if (lastOutputAt >= lastInputAt) {
    return now - lastOutputAt <= PROVIDER_OUTPUT_ACTIVITY_GRACE_MS;
  }
  return now - lastInputAt <= PROVIDER_INPUT_ACTIVITY_GRACE_MS;
}

export function normalizeProviderOutputSignature(visibleText: string): string {
  return visibleText
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b[P^_].*?(?:\u001b\\|\u0007|\u009c)/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(-256);
}

async function checkWindowsSubprocessActivity(
  terminalPid: number,
): Promise<TerminalSubprocessActivity> {
  const command = [
    `$children = Get-CimInstance Win32_Process -Filter "ParentProcessId = ${terminalPid}" -ErrorAction SilentlyContinue`,
    "if ($children) { exit 0 }",
    "exit 1",
  ].join("; ");
  try {
    const result = await runProcess(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", command],
      {
        timeoutMs: 1_500,
        allowNonZeroExit: true,
        maxBufferBytes: 32_768,
        outputMode: "truncate",
      },
    );
    return {
      cliKind: null,
      hasNonProviderSubprocess: false,
      hasProviderDescendant: false,
      hasRunningSubprocess: result.code === 0,
    };
  } catch {
    return {
      cliKind: null,
      hasNonProviderSubprocess: false,
      hasProviderDescendant: false,
      hasRunningSubprocess: false,
    };
  }
}

async function checkPosixSubprocessActivity(
  terminalPid: number,
): Promise<TerminalSubprocessActivity> {
  const shellLikeProcessNames = new Set([
    "bash",
    "dash",
    "fish",
    "ksh",
    "login",
    "nu",
    "screen",
    "sh",
    "tcsh",
    "tmux",
    "zellij",
    "zsh",
  ]);

  const isShellLikeProcessName = (command: string): boolean => {
    const normalized = path.basename(command.trim().split(/\s+/g)[0] ?? "").toLowerCase();
    return shellLikeProcessNames.has(normalized);
  };

  const inspectDescendants = (
    parentPid: number,
    childrenByParentPid: Map<number, Array<{ pid: number; command: string }>>,
  ): TerminalSubprocessActivity => {
    const children = childrenByParentPid.get(parentPid) ?? [];
    let cliKind: TerminalCliKind | null = null;
    let hasNonProviderSubprocess = false;
    let hasProviderDescendant = false;
    let hasRunningSubprocess = false;
    for (const child of children) {
      const nestedActivity = inspectDescendants(child.pid, childrenByParentPid);
      const childCliKind = deriveTerminalProcessIdentity(child.command)?.cliKind ?? null;
      if (childCliKind || nestedActivity.hasProviderDescendant) {
        hasProviderDescendant = true;
      }
      if (
        (!childCliKind && !isShellLikeProcessName(child.command)) ||
        nestedActivity.hasNonProviderSubprocess
      ) {
        hasNonProviderSubprocess = true;
      }
      cliKind = cliKind ?? childCliKind ?? nestedActivity.cliKind;
      if (!isShellLikeProcessName(child.command) || nestedActivity.hasRunningSubprocess) {
        hasRunningSubprocess = true;
      }
    }
    return { cliKind, hasNonProviderSubprocess, hasProviderDescendant, hasRunningSubprocess };
  };

  try {
    const pgrepResult = await runProcess("pgrep", ["-P", String(terminalPid)], {
      timeoutMs: 1_000,
      allowNonZeroExit: true,
      maxBufferBytes: 32_768,
      outputMode: "truncate",
    });
    if (pgrepResult.code === 0) {
      if (pgrepResult.stdout.trim().length === 0) {
        return {
          cliKind: null,
          hasNonProviderSubprocess: false,
          hasProviderDescendant: false,
          hasRunningSubprocess: false,
        };
      }
    }
    if (pgrepResult.code === 1) {
      return {
        cliKind: null,
        hasNonProviderSubprocess: false,
        hasProviderDescendant: false,
        hasRunningSubprocess: false,
      };
    }
  } catch {
    // Fall back to ps when pgrep is unavailable.
  }

  try {
    const psResult = await runProcess("ps", ["-eo", "pid=,ppid=,command="], {
      timeoutMs: 1_000,
      allowNonZeroExit: true,
      maxBufferBytes: 262_144,
      outputMode: "truncate",
    });
    if (psResult.code !== 0) {
      return {
        cliKind: null,
        hasNonProviderSubprocess: false,
        hasProviderDescendant: false,
        hasRunningSubprocess: false,
      };
    }

    const childrenByParentPid = new Map<number, Array<{ pid: number; command: string }>>();
    for (const line of psResult.stdout.split(/\r?\n/g)) {
      const [pidRaw, ppidRaw, ...commandParts] = line.trim().split(/\s+/g);
      const pid = Number(pidRaw);
      const ppid = Number(ppidRaw);
      const command = commandParts.join(" ").trim();
      if (!Number.isInteger(pid) || !Number.isInteger(ppid)) continue;
      if (command.length === 0) continue;
      const siblings = childrenByParentPid.get(ppid) ?? [];
      siblings.push({ pid, command });
      childrenByParentPid.set(ppid, siblings);
    }

    return inspectDescendants(terminalPid, childrenByParentPid);
  } catch {
    return {
      cliKind: null,
      hasNonProviderSubprocess: false,
      hasProviderDescendant: false,
      hasRunningSubprocess: false,
    };
  }
}

export async function defaultSubprocessChecker(
  terminalPid: number,
): Promise<TerminalSubprocessActivity> {
  if (!Number.isInteger(terminalPid) || terminalPid <= 0) {
    return {
      cliKind: null,
      hasNonProviderSubprocess: false,
      hasProviderDescendant: false,
      hasRunningSubprocess: false,
    };
  }
  if (process.platform === "win32") {
    return checkWindowsSubprocessActivity(terminalPid);
  }
  return checkPosixSubprocessActivity(terminalPid);
}
