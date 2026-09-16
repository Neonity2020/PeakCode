// FILE: agentGoalReactQuery.ts
// Purpose: React Query hooks for the composer's Goal-mode panel.
// Layer: Web data fetching helpers

import type { AgentApprovalMode, AgentGoalSetStatusInput, ThreadId } from "@peakcode/contracts";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ensureNativeApi } from "../nativeApi";

/**
 * Goal state lives in the server's agent-toolkit store and only changes when the agent
 * calls the `goal` tool or the continuation loop books a turn — both of which happen while
 * a turn is running. Polling a thread that has no goal is one cheap request, so the panel
 * simply polls while the thread is open rather than wiring a push channel for infrequent
 * writes.
 */
const GOAL_POLL_INTERVAL_MS = 5_000;

export const agentGoalQueryKeys = {
  all: ["agentGoal"] as const,
  forThread: (threadId: ThreadId | null) => [...agentGoalQueryKeys.all, threadId] as const,
};

export const agentGoalQueryOptions = (threadId: ThreadId | null) =>
  queryOptions({
    queryKey: agentGoalQueryKeys.forThread(threadId),
    queryFn: async () => {
      if (!threadId) return { goal: null };
      return ensureNativeApi().agentGoal.get({ threadId });
    },
    enabled: threadId !== null,
    refetchInterval: GOAL_POLL_INTERVAL_MS,
  });

export function useAgentGoal(threadId: ThreadId | null) {
  return useQuery(agentGoalQueryOptions(threadId));
}

export function useSetAgentGoalStatus(threadId: ThreadId | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: Omit<AgentGoalSetStatusInput, "threadId">) => {
      if (!threadId) throw new Error("No active thread");
      return ensureNativeApi().agentGoal.setStatus({ threadId, ...input });
    },
    onSuccess: (result) => {
      // Seed the cache with the server's answer so the panel doesn't flicker back to the
      // previous status while the poll catches up.
      queryClient.setQueryData(agentGoalQueryKeys.forThread(threadId), result);
    },
  });
}

/**
 * Composer toolbar state for a thread: approval policy + context usage.
 *
 * Same polling rationale as the goal panel: both values move while a turn runs (the adapter
 * reports usage at turn end) and neither is worth a push channel.
 */
export const agentRuntimeQueryKeys = {
  all: ["agentRuntime"] as const,
  forThread: (threadId: ThreadId | null) => [...agentRuntimeQueryKeys.all, threadId] as const,
};

export const agentRuntimeQueryOptions = (threadId: ThreadId | null) =>
  queryOptions({
    queryKey: agentRuntimeQueryKeys.forThread(threadId),
    queryFn: async () => {
      if (!threadId) return null;
      return ensureNativeApi().agentRuntime.get({ threadId });
    },
    enabled: threadId !== null,
    refetchInterval: GOAL_POLL_INTERVAL_MS,
  });

export function useAgentRuntime(threadId: ThreadId | null) {
  return useQuery(agentRuntimeQueryOptions(threadId));
}

export function useSetAgentApprovalMode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (approvalMode: AgentApprovalMode) =>
      ensureNativeApi().agentRuntime.setApprovalMode({ approvalMode }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: agentRuntimeQueryKeys.all });
    },
  });
}
