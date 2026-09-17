/**
 * ProjectionSnapshotMappers - Maps decoded projection rows onto orchestration contract shapes.
 *
 * @module ProjectionSnapshotMappers
 */
import {
  OrchestrationProjectShell,
  type OrchestrationCheckpointSummary,
  type OrchestrationLatestTurn,
  type OrchestrationMessage,
  type OrchestrationProposedPlan,
  type OrchestrationSession,
  OrchestrationThread,
  type OrchestrationThreadShell,
  type OrchestrationThreadActivity,
} from "@peakcode/contracts";
import type { Schema } from "effect";
import { deriveThreadSummaryMetadata } from "@peakcode/shared/threadSummary";

import { SNAPSHOT_READ_PROJECTORS } from "./projectionNames.ts";
import { ProjectionStateDbRowSchema } from "./projectionSnapshotRows.ts";

import type {
  ProjectionCheckpointDbRow,
  ProjectionLatestTurnDbRow,
  ProjectionProjectDbRow,
  ProjectionThreadActivityDbRow,
  ProjectionThreadDbRow,
  ProjectionThreadMessageDbRow,
  ProjectionThreadProposedPlanDbRow,
  ProjectionThreadSessionDbRow,
} from "./projectionSnapshotRows.ts";

export function maxIso(left: string | null, right: string): string {
  if (left === null) {
    return right;
  }
  return left > right ? left : right;
}

export function toProjectedMessage(row: ProjectionThreadMessageDbRow): OrchestrationMessage {
  return {
    id: row.messageId,
    role: row.role,
    text: row.text,
    ...(row.attachments !== null ? { attachments: row.attachments } : {}),
    ...(row.skills !== null ? { skills: row.skills } : {}),
    ...(row.mentions !== null ? { mentions: row.mentions } : {}),
    ...(row.dispatchMode ? { dispatchMode: row.dispatchMode } : {}),
    turnId: row.turnId,
    streaming: row.isStreaming === 1,
    source: row.source,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toProjectedProposedPlan(
  row: ProjectionThreadProposedPlanDbRow,
): OrchestrationProposedPlan {
  return {
    id: row.planId,
    turnId: row.turnId,
    planMarkdown: row.planMarkdown,
    implementedAt: row.implementedAt,
    implementationThreadId: row.implementationThreadId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toProjectedActivity(
  row: ProjectionThreadActivityDbRow,
): OrchestrationThreadActivity {
  return {
    id: row.activityId,
    tone: row.tone,
    kind: row.kind,
    summary: row.summary,
    payload: row.payload as OrchestrationThreadActivity["payload"],
    turnId: row.turnId,
    ...(row.sequence !== null ? { sequence: row.sequence } : {}),
    createdAt: row.createdAt,
  };
}

export function toProjectedCheckpoint(
  row: ProjectionCheckpointDbRow,
): OrchestrationCheckpointSummary {
  return {
    turnId: row.turnId,
    checkpointTurnCount: row.checkpointTurnCount,
    checkpointRef: row.checkpointRef,
    status: row.status,
    files: row.files,
    assistantMessageId: row.assistantMessageId,
    completedAt: row.completedAt,
  };
}

export function toProjectedLatestTurn(row: ProjectionLatestTurnDbRow): OrchestrationLatestTurn {
  return {
    turnId: row.turnId,
    state:
      row.state === "error"
        ? "error"
        : row.state === "interrupted"
          ? "interrupted"
          : row.state === "completed"
            ? "completed"
            : "running",
    requestedAt: row.requestedAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    assistantMessageId: row.assistantMessageId,
    ...(row.sourceProposedPlanThreadId !== null && row.sourceProposedPlanId !== null
      ? {
          sourceProposedPlan: {
            threadId: row.sourceProposedPlanThreadId,
            planId: row.sourceProposedPlanId,
          },
        }
      : {}),
  };
}

export function toProjectedSession(row: ProjectionThreadSessionDbRow): OrchestrationSession {
  return {
    threadId: row.threadId,
    status: row.status,
    providerName: row.providerName,
    runtimeMode: row.runtimeMode,
    activeTurnId: row.activeTurnId,
    lastError: row.lastError,
    updatedAt: row.updatedAt,
  };
}

export function toProjectedProjectShell(row: ProjectionProjectDbRow): OrchestrationProjectShell {
  return {
    id: row.projectId,
    kind: row.kind,
    title: row.title,
    workspaceRoot: row.workspaceRoot,
    defaultModelSelection: row.defaultModelSelection,
    scripts: row.scripts,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toProjectedThreadShell(input: {
  readonly threadRow: ProjectionThreadDbRow;
  readonly latestTurn: OrchestrationLatestTurn | null;
  readonly messages: ReadonlyArray<Pick<OrchestrationMessage, "role" | "createdAt">>;
  readonly proposedPlans: ReadonlyArray<
    Pick<OrchestrationProposedPlan, "id" | "turnId" | "updatedAt" | "implementedAt">
  >;
  readonly activities: ReadonlyArray<
    Pick<OrchestrationThreadActivity, "createdAt" | "id" | "kind" | "payload" | "sequence">
  >;
  readonly session: OrchestrationSession | null;
}): OrchestrationThreadShell {
  const { threadRow } = input;
  const summary = deriveThreadSummaryMetadata(input);
  return {
    id: threadRow.threadId,
    projectId: threadRow.projectId,
    title: threadRow.title,
    modelSelection: threadRow.modelSelection,
    runtimeMode: threadRow.runtimeMode,
    interactionMode: threadRow.interactionMode,
    envMode: threadRow.envMode,
    branch: threadRow.branch,
    worktreePath: threadRow.worktreePath,
    associatedWorktreePath: threadRow.associatedWorktreePath,
    associatedWorktreeBranch: threadRow.associatedWorktreeBranch,
    associatedWorktreeRef: threadRow.associatedWorktreeRef,
    createBranchFlowCompleted: threadRow.createBranchFlowCompleted > 0,
    isPinned: threadRow.isPinned > 0,
    parentThreadId: threadRow.parentThreadId ?? null,
    subagentAgentId: threadRow.subagentAgentId ?? null,
    subagentNickname: threadRow.subagentNickname ?? null,
    subagentRole: threadRow.subagentRole ?? null,
    forkSourceThreadId: threadRow.forkSourceThreadId ?? null,
    sidechatSourceThreadId: threadRow.sidechatSourceThreadId ?? null,
    lastKnownPr: threadRow.lastKnownPr,
    latestTurn: input.latestTurn,
    latestUserMessageAt: summary.latestUserMessageAt,
    hasPendingApprovals: summary.hasPendingApprovals,
    hasPendingUserInput: summary.hasPendingUserInput,
    hasActionableProposedPlan: summary.hasActionableProposedPlan,
    createdAt: threadRow.createdAt,
    updatedAt: threadRow.updatedAt,
    archivedAt: threadRow.archivedAt ?? null,
    handoff: threadRow.handoff,
    session: input.session,
  };
}

export function toProjectedThreadShellFromStoredSummary(input: {
  readonly threadRow: ProjectionThreadDbRow;
  readonly latestTurn: OrchestrationLatestTurn | null;
  readonly session: OrchestrationSession | null;
}): OrchestrationThreadShell {
  const { threadRow } = input;
  return {
    id: threadRow.threadId,
    projectId: threadRow.projectId,
    title: threadRow.title,
    modelSelection: threadRow.modelSelection,
    runtimeMode: threadRow.runtimeMode,
    interactionMode: threadRow.interactionMode,
    envMode: threadRow.envMode,
    branch: threadRow.branch,
    worktreePath: threadRow.worktreePath,
    associatedWorktreePath: threadRow.associatedWorktreePath,
    associatedWorktreeBranch: threadRow.associatedWorktreeBranch,
    associatedWorktreeRef: threadRow.associatedWorktreeRef,
    createBranchFlowCompleted: threadRow.createBranchFlowCompleted > 0,
    isPinned: threadRow.isPinned > 0,
    parentThreadId: threadRow.parentThreadId ?? null,
    subagentAgentId: threadRow.subagentAgentId ?? null,
    subagentNickname: threadRow.subagentNickname ?? null,
    subagentRole: threadRow.subagentRole ?? null,
    forkSourceThreadId: threadRow.forkSourceThreadId ?? null,
    sidechatSourceThreadId: threadRow.sidechatSourceThreadId ?? null,
    lastKnownPr: threadRow.lastKnownPr,
    latestTurn: input.latestTurn,
    latestUserMessageAt: threadRow.latestUserMessageAt,
    hasPendingApprovals: threadRow.pendingApprovalCount > 0,
    hasPendingUserInput: threadRow.pendingUserInputCount > 0,
    hasActionableProposedPlan: threadRow.hasActionableProposedPlan > 0,
    createdAt: threadRow.createdAt,
    updatedAt: threadRow.updatedAt,
    archivedAt: threadRow.archivedAt ?? null,
    handoff: threadRow.handoff,
    session: input.session,
  };
}

export function toProjectedThread(input: {
  readonly threadRow: ProjectionThreadDbRow;
  readonly latestTurn: OrchestrationLatestTurn | null;
  readonly messages: ReadonlyArray<OrchestrationMessage>;
  readonly proposedPlans: ReadonlyArray<OrchestrationProposedPlan>;
  readonly activities: ReadonlyArray<OrchestrationThreadActivity>;
  readonly checkpoints: ReadonlyArray<OrchestrationCheckpointSummary>;
  readonly session: OrchestrationSession | null;
}): OrchestrationThread {
  const { threadRow } = input;
  const summary = deriveThreadSummaryMetadata(input);
  return {
    id: threadRow.threadId,
    projectId: threadRow.projectId,
    title: threadRow.title,
    modelSelection: threadRow.modelSelection,
    runtimeMode: threadRow.runtimeMode,
    interactionMode: threadRow.interactionMode,
    envMode: threadRow.envMode,
    branch: threadRow.branch,
    worktreePath: threadRow.worktreePath,
    associatedWorktreePath: threadRow.associatedWorktreePath,
    associatedWorktreeBranch: threadRow.associatedWorktreeBranch,
    associatedWorktreeRef: threadRow.associatedWorktreeRef,
    createBranchFlowCompleted: threadRow.createBranchFlowCompleted > 0,
    isPinned: threadRow.isPinned > 0,
    parentThreadId: threadRow.parentThreadId ?? null,
    subagentAgentId: threadRow.subagentAgentId ?? null,
    subagentNickname: threadRow.subagentNickname ?? null,
    subagentRole: threadRow.subagentRole ?? null,
    forkSourceThreadId: threadRow.forkSourceThreadId,
    sidechatSourceThreadId: threadRow.sidechatSourceThreadId ?? null,
    lastKnownPr: threadRow.lastKnownPr,
    latestTurn: input.latestTurn,
    createdAt: threadRow.createdAt,
    updatedAt: threadRow.updatedAt,
    archivedAt: threadRow.archivedAt ?? null,
    deletedAt: threadRow.deletedAt,
    handoff: threadRow.handoff,
    latestUserMessageAt: summary.latestUserMessageAt,
    hasPendingApprovals: summary.hasPendingApprovals,
    hasPendingUserInput: summary.hasPendingUserInput,
    hasActionableProposedPlan: summary.hasActionableProposedPlan,
    messages: input.messages,
    proposedPlans: input.proposedPlans,
    activities: input.activities,
    checkpoints: input.checkpoints,
    session: input.session,
  };
}

export function computeSnapshotSequence(
  stateRows: ReadonlyArray<Schema.Schema.Type<typeof ProjectionStateDbRowSchema>>,
): number {
  if (stateRows.length === 0) {
    return 0;
  }
  const sequenceByProjector = new Map(
    stateRows.map((row) => [row.projector, row.lastAppliedSequence] as const),
  );

  let minSequence = Number.POSITIVE_INFINITY;
  for (const projector of SNAPSHOT_READ_PROJECTORS) {
    const sequence = sequenceByProjector.get(projector);
    if (sequence === undefined) {
      return 0;
    }
    if (sequence < minSequence) {
      minSequence = sequence;
    }
  }

  return Number.isFinite(minSequence) ? minSequence : 0;
}
