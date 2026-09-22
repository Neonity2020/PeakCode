/**
 * SessionLogicTypes - Public session/work-log types shared by the web app.
 *
 * @module SessionLogicTypes
 */
import {
  ApprovalRequestId,
  type OrchestrationThreadActivity,
  type OrchestrationProposedPlanId,
  type ProviderKind,
  type ToolLifecycleItemType,
  type UserInputQuestion,
  type ThreadId,
  type TurnId,
} from "@peakcode/contracts";

import { ChatMessage, ProposedPlan } from "./types";

export type ProviderPickerKind = ProviderKind;

export const PROVIDER_OPTIONS: Array<{
  value: ProviderPickerKind;
  label: string;
  available: boolean;
}> = [{ value: "pi", label: "Pi", available: true }];

export interface WorkLogEntry {
  id: string;
  createdAt: string;
  label: string;
  detail?: string;
  command?: string;
  rawCommand?: string;
  preview?: string;
  changedFiles?: ReadonlyArray<string>;
  tone: "thinking" | "tool" | "info" | "error";
  toolTitle?: string;
  toolName?: string;
  toolCallId?: string;
  itemType?: ToolLifecycleItemType;
  requestKind?: PendingApproval["requestKind"];
  subagents?: ReadonlyArray<WorkLogSubagent>;
  subagentAction?: WorkLogSubagentAction;
}

export const WORK_LOG_PRESENTATION_VERSION = 5;

export interface WorkLogSubagent {
  threadId: string;
  providerThreadId?: string | undefined;
  resolvedThreadId?: string | undefined;
  agentId?: string | undefined;
  nickname?: string | undefined;
  role?: string | undefined;
  model?: string | undefined;
  prompt?: string | undefined;
  rawStatus?: string | undefined;
  latestUpdate?: string | undefined;
  title?: string | undefined;
  statusLabel?: string | undefined;
  isActive?: boolean | undefined;
  /** Tool calls the worker started, counted off its child thread. */
  steps?: number | undefined;
  /** Time from the worker's first step to its last, for the node's duration line. */
  elapsedMs?: number | undefined;
  /** Readable title of the worker's most recent tool call. */
  latestStep?: string | undefined;
  /** When that call happened, so the card can show how long the worker has been quiet. */
  latestStepAt?: string | undefined;
  /**
   * When the worker was dispatched, as published on the delegation item.
   *
   * The card measures a running worker from here when its child thread has not reported any
   * steps yet — otherwise a worker that has been out for ten minutes shows no duration at all.
   */
  startedAt?: string | undefined;
  /**
   * The worker's most recent tool calls, oldest first, each with the call's own id.
   *
   * Also published on the delegation item, so a node can be expanded into a record of what the
   * worker did without opening its child thread. The id is what keeps two calls to the same tool
   * distinct entries.
   */
  recentSteps?: readonly { id: string; title: string }[] | undefined;
}

export interface WorkLogSubagentAction {
  tool: string;
  status: string;
  summaryText: string;
  model?: string | undefined;
  prompt?: string | undefined;
}

export interface DerivedWorkLogEntry extends WorkLogEntry {
  activityKind: OrchestrationThreadActivity["kind"];
  collapseKey?: string;
  collapseCommand?: string;
  toolName?: string;
}

export interface PendingApproval {
  requestId: ApprovalRequestId;
  requestKind: "command" | "file-read" | "file-change" | "tool";
  createdAt: string;
  detail?: string;
}

export interface PendingUserInput {
  requestId: ApprovalRequestId;
  createdAt: string;
  questions: ReadonlyArray<UserInputQuestion>;
}

export interface ActiveTaskListState {
  createdAt: string;
  turnId: TurnId | null;
  explanation?: string | null;
  tasks: Array<{
    task: string;
    status: "pending" | "inProgress" | "completed";
  }>;
}

export interface ActiveBackgroundTasksState {
  activeCount: number;
}

export interface LatestProposedPlanState {
  id: OrchestrationProposedPlanId;
  createdAt: string;
  updatedAt: string;
  turnId: TurnId | null;
  planMarkdown: string;
  implementedAt: string | null;
  implementationThreadId: ThreadId | null;
}

export type TimelineEntry =
  | {
      id: string;
      kind: "message";
      createdAt: string;
      message: ChatMessage;
    }
  | {
      id: string;
      kind: "proposed-plan";
      createdAt: string;
      proposedPlan: ProposedPlan;
    }
  | {
      id: string;
      kind: "work";
      createdAt: string;
      entry: WorkLogEntry;
    };

export interface CommandAction {
  type: string;
  command?: string;
  name?: string;
  path?: string;
  query?: string;
}

export interface CommandActionDisplay {
  title: string;
  preview?: string;
}
