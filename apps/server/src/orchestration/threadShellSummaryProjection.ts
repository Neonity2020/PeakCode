/**
 * ThreadShellSummaryProjection - Refreshes the persisted thread shell summary for summary-affecting events.
 *
 * @module ThreadShellSummaryProjection
 */
import {
  ApprovalRequestId,
  EventId,
  type OrchestrationEvent,
  type OrchestrationThreadActivity,
} from "@peakcode/contracts";
import { Effect } from "effect";
import { deriveThreadSummaryState } from "@peakcode/shared/threadSummary";

import type { ProjectionPendingApprovalRepositoryShape } from "../persistence/Services/ProjectionPendingApprovals.ts";
import { ProjectionThreadActivityRepositoryShape } from "../persistence/Services/ProjectionThreadActivities.ts";
import type { ProjectionThreadMessageRepositoryShape } from "../persistence/Services/ProjectionThreadMessages.ts";
import type { ProjectionThreadProposedPlanRepositoryShape } from "../persistence/Services/ProjectionThreadProposedPlans.ts";
import { ProjectionThread } from "../persistence/Services/ProjectionThreads.ts";

const THREAD_SHELL_SUMMARY_ACTIVITY_KINDS = new Set([
  "approval.requested",
  "approval.resolved",
  "provider.approval.respond.failed",
  "user-input.requested",
  "user-input.resolved",
  "provider.user-input.respond.failed",
]);

export function extractActivityRequestId(payload: unknown): ApprovalRequestId | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const requestId = (payload as Record<string, unknown>).requestId;
  return typeof requestId === "string" ? ApprovalRequestId.makeUnsafe(requestId) : null;
}

export function isStalePendingApprovalFailure(payload: unknown): boolean {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }
  const detail = (payload as Record<string, unknown>).detail;
  if (typeof detail !== "string") {
    return false;
  }
  const normalized = detail.toLowerCase();
  return (
    normalized.includes("stale pending approval request") ||
    normalized.includes("unknown pending approval request") ||
    normalized.includes("unknown pending permission request")
  );
}

export function shouldRefreshThreadShellSummary(event: OrchestrationEvent): boolean {
  switch (event.type) {
    case "thread.message-sent":
      return event.payload.role === "user";
    case "thread.proposed-plan-upserted":
    case "thread.approval-response-requested":
    case "thread.user-input-response-requested":
    case "thread.reverted":
    case "thread.conversation-rolled-back":
    case "thread.session-set":
    case "thread.turn-diff-completed":
      return true;
    case "thread.activity-appended":
      return THREAD_SHELL_SUMMARY_ACTIVITY_KINDS.has(event.payload.activity.kind);
    default:
      return false;
  }
}

export const withRefreshedThreadShellSummary = Effect.fn(function* (input: {
  readonly thread: ProjectionThread;
  readonly projectionThreadMessageRepository: ProjectionThreadMessageRepositoryShape;
  readonly projectionThreadActivityRepository: ProjectionThreadActivityRepositoryShape;
  readonly projectionThreadProposedPlanRepository: ProjectionThreadProposedPlanRepositoryShape;
  readonly projectionPendingApprovalRepository: ProjectionPendingApprovalRepositoryShape;
  readonly summaryUserInputResponseRequestId?: string;
  readonly summaryUserInputResponseCreatedAt?: string;
}) {
  const [messages, activities, proposedPlans, pendingApprovals] = yield* Effect.all([
    input.projectionThreadMessageRepository.listByThreadId({
      threadId: input.thread.threadId,
    }),
    input.projectionThreadActivityRepository.listByThreadId({
      threadId: input.thread.threadId,
    }),
    input.projectionThreadProposedPlanRepository.listByThreadId({
      threadId: input.thread.threadId,
    }),
    input.projectionPendingApprovalRepository.listByThreadId({
      threadId: input.thread.threadId,
    }),
  ]);
  const summary = deriveThreadSummaryState({
    messages,
    activities: [
      ...activities.map((activity) => ({
        id: activity.activityId,
        kind: activity.kind,
        payload: activity.payload as OrchestrationThreadActivity["payload"],
        sequence: activity.sequence,
        createdAt: activity.createdAt,
      })),
      ...(input.summaryUserInputResponseRequestId
        ? [
            {
              id: EventId.makeUnsafe(
                `synthetic-user-input-resolved:${input.summaryUserInputResponseRequestId}:${input.summaryUserInputResponseCreatedAt ?? input.thread.updatedAt}`,
              ),
              kind: "user-input.resolved" as const,
              payload: {
                requestId: input.summaryUserInputResponseRequestId,
              },
              createdAt: input.summaryUserInputResponseCreatedAt ?? input.thread.updatedAt,
            },
          ]
        : []),
    ],
    proposedPlans: proposedPlans.map((plan) => ({
      id: plan.planId,
      turnId: plan.turnId,
      updatedAt: plan.updatedAt,
      implementedAt: plan.implementedAt,
    })),
    latestTurn: input.thread.latestTurnId ? { turnId: input.thread.latestTurnId } : null,
  });
  const requestedApprovalIds = new Set(
    activities
      .filter((activity) => activity.kind === "approval.requested")
      .map((activity) => extractActivityRequestId(activity.payload))
      .filter((requestId): requestId is ApprovalRequestId => requestId !== null),
  );
  const pendingApprovalCount = pendingApprovals.filter(
    (approval) => approval.status === "pending" && requestedApprovalIds.has(approval.requestId),
  ).length;

  return {
    ...input.thread,
    latestUserMessageAt: summary.latestUserMessageAt,
    pendingApprovalCount,
    pendingUserInputCount: summary.pendingUserInputCount,
    hasActionableProposedPlan: summary.hasActionableProposedPlan ? 1 : 0,
  } satisfies ProjectionThread;
});
