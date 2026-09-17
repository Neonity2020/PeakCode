/**
 * TerminalSessionState - Session keying, spawn environment assembly and history/activity bookkeeping.
 *
 * @module TerminalSessionState
 */
import {
  terminalCliKindFromValue,
  PEAKCODE_TERMINAL_CLI_KIND_ENV_KEY,
  type TerminalActivityState,
  type TerminalAgentHookEventType,
  type TerminalCliKind,
} from "@peakcode/shared/terminalThreads";
import { Encoding } from "effect";

import { applyManagedTerminalAgentWrapperEnv } from "./managedTerminalWrappers.ts";
import type { TerminalSessionState } from "./Services/Manager.ts";
import { capHistory, countCharacter, historyLineCount, measureHistory } from "./terminalHistory.ts";

const TERMINAL_ENV_BLOCKLIST = new Set(["PORT", "ELECTRON_RENDERER_PORT", "ELECTRON_RUN_AS_NODE"]);

export function legacySafeThreadId(threadId: string): string {
  return threadId.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function toSafeThreadId(threadId: string): string {
  return `terminal_${Encoding.encodeBase64Url(threadId)}`;
}

export function toSafeTerminalId(terminalId: string): string {
  return Encoding.encodeBase64Url(terminalId);
}

export function toSessionKey(threadId: string, terminalId: string): string {
  return `${threadId}\u0000${terminalId}`;
}

function shouldExcludeTerminalEnvKey(key: string): boolean {
  const normalizedKey = key.toUpperCase();
  if (normalizedKey.startsWith("PEAKCODE_")) {
    return true;
  }
  if (normalizedKey.startsWith("VITE_")) {
    return true;
  }
  return TERMINAL_ENV_BLOCKLIST.has(normalizedKey);
}

export function createTerminalSpawnEnv(
  baseEnv: NodeJS.ProcessEnv,
  runtimeEnv?: Record<string, string> | null,
  managedWrapperOptions?: {
    binDir: string | null;
    zshDir: string | null;
  },
): NodeJS.ProcessEnv {
  const spawnEnv: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    if (value === undefined) continue;
    if (shouldExcludeTerminalEnvKey(key)) continue;
    spawnEnv[key] = value;
  }
  if (runtimeEnv) {
    for (const [key, value] of Object.entries(runtimeEnv)) {
      spawnEnv[key] = value;
    }
  }
  return managedWrapperOptions
    ? applyManagedTerminalAgentWrapperEnv(spawnEnv, managedWrapperOptions)
    : spawnEnv;
}

export function normalizedRuntimeEnv(
  env: Record<string, string> | undefined,
): Record<string, string> | null {
  if (!env) return null;
  const entries = Object.entries(env);
  if (entries.length === 0) return null;
  return Object.fromEntries(entries.toSorted(([left], [right]) => left.localeCompare(right)));
}

export function cliKindFromRuntimeEnv(
  runtimeEnv: Record<string, string> | null | undefined,
): TerminalCliKind | null {
  return terminalCliKindFromValue(runtimeEnv?.[PEAKCODE_TERMINAL_CLI_KIND_ENV_KEY]);
}

export function resetSessionHistory(session: TerminalSessionState): void {
  session.history = "";
  session.historyLineBreakCount = 0;
  session.historyEndsWithNewline = false;
  session.pendingHistoryControlSequence = "";
  session.pendingInputBuffer = "";
  session.managedAgentRunning = false;
  session.managedAgentState = null;
  session.managedAgentObserved = false;
}

export function deriveActivityAgentState(
  session: TerminalSessionState,
): TerminalActivityState | null {
  if (session.managedAgentState !== null) {
    return session.managedAgentState;
  }
  if (session.hasRunningSubprocess && session.detectedCliKind !== null) {
    return "running";
  }
  return null;
}

export function agentStateFromHookEvent(
  eventType: TerminalAgentHookEventType,
): TerminalActivityState {
  switch (eventType) {
    case "PermissionRequest":
      return "attention";
    case "Stop":
      return "review";
    case "Start":
      return "running";
  }
}

export function appendSessionHistory(
  session: TerminalSessionState,
  chunk: string,
  historyLineLimit: number,
): void {
  if (chunk.length === 0) return;

  const nextHistory = `${session.history}${chunk}`;
  const nextLineBreakCount = session.historyLineBreakCount + countCharacter(chunk, "\n");
  const nextEndsWithNewline = chunk.endsWith("\n");
  const nextLineCount = historyLineCount(nextHistory, nextLineBreakCount, nextEndsWithNewline);

  if (nextLineCount <= historyLineLimit) {
    session.history = nextHistory;
    session.historyLineBreakCount = nextLineBreakCount;
    session.historyEndsWithNewline = nextEndsWithNewline;
    return;
  }

  session.history = capHistory(nextHistory, historyLineLimit);
  const cappedMetrics = measureHistory(session.history);
  session.historyLineBreakCount = cappedMetrics.historyLineBreakCount;
  session.historyEndsWithNewline = cappedMetrics.historyEndsWithNewline;
}
