/**
 * PiSessionSnapshot - Pi session context shape and provider snapshot / token-usage projection.
 *
 * @module PiSessionSnapshot
 */
import type {
  AgentSession as PiAgentSession,
  createAgentSessionRuntime,
} from "@earendil-works/pi-coding-agent";
import type {
  CanonicalRequestType,
  ProviderApprovalDecision,
  ProviderSession,
  ProviderUserInputAnswers,
  RuntimeItemId,
  ThreadTokenUsageSnapshot,
  TurnId,
} from "@peakcode/contracts";

import { PROVIDER, type PiModelRuntime } from "./piModels.ts";

export interface PiSessionContext {
  runtime: Awaited<ReturnType<typeof createAgentSessionRuntime>>;
  modelRuntime: PiModelRuntime;
  session: ProviderSession;
  turns: PiStoredTurn[];
  activeTurnId: TurnId | undefined;
  activeAssistantItemId: RuntimeItemId | undefined;
  activeReasoningItemId: RuntimeItemId | undefined;
  activeToolItems: Map<string, PiTrackedToolCall>;
  stopped: boolean;
  lastKnownTokenUsage: ThreadTokenUsageSnapshot | undefined;
  unsubscribe: (() => void) | undefined;
  /**
   * Assistant prose accumulated for the active turn. The stream is forwarded to the UI as
   * deltas and never re-assembled there, so the plan-tag fallback needs its own copy.
   */
  activeTurnText: string;
  /**
   * In-flight approval prompts, keyed by the request id handed to the UI. The tool-call
   * extension blocks on the stored resolver; `respondToRequest` wakes it up.
   */
  pendingApprovals: Map<string, PiPendingApproval>;
  /** Same idea for `ask_user` questions answered through the user-input panel. */
  pendingQuestions: Map<string, PiPendingQuestion>;
}

/** An approval prompt waiting on the user, plus what the panel needs to clear it. */
export interface PiPendingApproval {
  requestType: CanonicalRequestType;
  resolve: (decision: ProviderApprovalDecision) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** An `ask_user` question set waiting on the user. */
export interface PiPendingQuestion {
  resolve: (answers: ProviderUserInputAnswers) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface PiStoredTurn {
  readonly id: TurnId;
  readonly items: unknown[];
  leafId?: string | null;
}

export interface PiTrackedToolCall {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly args: unknown;
  readonly itemId: RuntimeItemId;
  readonly itemType: "command_execution" | "file_change" | "dynamic_tool_call" | "web_search";
}

export function extractResumeSessionFile(resumeCursor: unknown): string | undefined {
  if (typeof resumeCursor === "string" && resumeCursor.trim().length > 0) {
    return resumeCursor;
  }
  if (!resumeCursor || typeof resumeCursor !== "object") {
    return undefined;
  }
  const record = resumeCursor as Record<string, unknown>;
  for (const key of ["sessionFile", "sessionFilePath", "nativeHandle", "path"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return undefined;
}

export function getSessionFile(session: PiAgentSession): string | undefined {
  return session.sessionFile ?? session.sessionManager.getSessionFile();
}

export function makeSessionSnapshot(context: PiSessionContext): ProviderSession {
  const resumeCursor = getSessionFile(context.runtime.session);
  return {
    provider: PROVIDER,
    status: context.stopped ? "closed" : context.activeTurnId ? "running" : "ready",
    runtimeMode: context.session.runtimeMode,
    threadId: context.session.threadId,
    createdAt: context.session.createdAt,
    updatedAt: new Date().toISOString(),
    ...(context.session.cwd ? { cwd: context.session.cwd } : {}),
    ...(context.session.model ? { model: context.session.model } : {}),
    ...(resumeCursor ? { resumeCursor } : {}),
    ...(context.activeTurnId ? { activeTurnId: context.activeTurnId } : {}),
    ...(context.session.lastError ? { lastError: context.session.lastError } : {}),
  };
}

export function normalizeTokenUsage(
  stats: ReturnType<PiAgentSession["getSessionStats"]>,
  contextWindow?: number | null,
): ThreadTokenUsageSnapshot | undefined {
  const inputTokens = stats.tokens.input;
  const cachedInputTokens = stats.tokens.cacheRead;
  const outputTokens = stats.tokens.output;
  const totalProcessedTokens = stats.tokens.total;
  const contextUsage = stats.contextUsage;
  const contextUsageWindow =
    typeof contextUsage?.contextWindow === "number" &&
    Number.isFinite(contextUsage.contextWindow) &&
    contextUsage.contextWindow > 0
      ? Math.floor(contextUsage.contextWindow)
      : undefined;
  const fallbackWindow =
    typeof contextWindow === "number" && Number.isFinite(contextWindow) && contextWindow > 0
      ? Math.floor(contextWindow)
      : undefined;
  const maxTokens = contextUsageWindow ?? fallbackWindow;
  const contextUsageTokens =
    typeof contextUsage?.tokens === "number" &&
    Number.isFinite(contextUsage.tokens) &&
    contextUsage.tokens >= 0
      ? Math.round(contextUsage.tokens)
      : undefined;
  const usedPercent =
    typeof contextUsage?.percent === "number" && Number.isFinite(contextUsage.percent)
      ? Math.max(0, Math.min(100, contextUsage.percent))
      : undefined;
  const usedTokensFromPercent =
    contextUsageTokens === undefined && usedPercent !== undefined && maxTokens !== undefined
      ? Math.round((usedPercent / 100) * maxTokens)
      : undefined;
  const usedTokens =
    contextUsageTokens ??
    usedTokensFromPercent ??
    (contextUsage
      ? 0
      : maxTokens !== undefined
        ? Math.min(totalProcessedTokens, maxTokens)
        : totalProcessedTokens);
  if (
    usedTokens <= 0 &&
    inputTokens <= 0 &&
    cachedInputTokens <= 0 &&
    outputTokens <= 0 &&
    maxTokens === undefined &&
    usedPercent === undefined
  ) {
    return undefined;
  }
  return {
    usedTokens,
    ...(usedPercent !== undefined ? { usedPercent } : {}),
    ...(totalProcessedTokens > usedTokens ? { totalProcessedTokens } : {}),
    inputTokens,
    cachedInputTokens,
    outputTokens,
    ...(maxTokens !== undefined ? { maxTokens } : {}),
    lastUsedTokens: usedTokens,
    lastInputTokens: inputTokens,
    lastCachedInputTokens: cachedInputTokens,
    lastOutputTokens: outputTokens,
  };
}
