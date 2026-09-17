import * as Schema from "effect/Schema";

import { ThreadId } from "./baseSchemas";

/**
 * Runtime state the composer's toolbar shows for the active thread.
 *
 * Two things live here rather than on the orchestration read model, because both are owned
 * by the agent toolkit (`AGENT_APPROVAL_MODE` setting, per-conversation context accounting)
 * and change without a thread event: which approval policy is in force, and how full the
 * context window is.
 */
export const AgentApprovalMode = Schema.Literals(["manual", "smart", "auto", "strict"]);
export type AgentApprovalMode = typeof AgentApprovalMode.Type;

export const AGENT_APPROVAL_MODES: readonly AgentApprovalMode[] = [
  "manual",
  "smart",
  "auto",
  "strict",
];

export const AgentContextUsage = Schema.Struct({
  /** The model's context window. */
  windowTokens: Schema.Number,
  /** What compaction measures against — 60% of the window. */
  budgetTokens: Schema.Number,
  usedTokens: Schema.Number,
  remainingTokens: Schema.Number,
  /** `usedTokens / budgetTokens`, clamped to 100. */
  percent: Schema.Number,
  /**
   * `usage` = measured by the provider on the last turn; `estimate` = derived from the
   * transcript. The UI must not present an estimate as a measurement.
   */
  source: Schema.Literals(["usage", "estimate"]),
});
export type AgentContextUsage = typeof AgentContextUsage.Type;

export const AgentRuntimeGetInput = Schema.Struct({ threadId: ThreadId });
export type AgentRuntimeGetInput = typeof AgentRuntimeGetInput.Type;

export const AgentRuntimeGetResult = Schema.Struct({
  approvalMode: AgentApprovalMode,
  /** `null` until the thread has produced a turn worth accounting for. */
  context: Schema.NullOr(AgentContextUsage),
});
export type AgentRuntimeGetResult = typeof AgentRuntimeGetResult.Type;

export const AgentApprovalModeSetInput = Schema.Struct({
  approvalMode: AgentApprovalMode,
});
export type AgentApprovalModeSetInput = typeof AgentApprovalModeSetInput.Type;

export const AgentApprovalModeSetResult = Schema.Struct({
  approvalMode: AgentApprovalMode,
});
export type AgentApprovalModeSetResult = typeof AgentApprovalModeSetResult.Type;
