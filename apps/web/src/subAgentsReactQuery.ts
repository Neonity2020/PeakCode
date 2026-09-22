// FILE: subAgentsReactQuery.ts
// Purpose: TanStack Query bindings for the `subAgents.*` WebSocket RPCs. Backs the
//          Settings → Sub-agents panel and the model picker on each worker.
// Layer: Web React Query binding
// Exports: subAgentsQueryKey, subAgentsQueryOptions, useSubAgentsQuery,
//          save/delete mutation options, useSaveSubAgentMutation, useDeleteSubAgentMutation,
//          useStopSubAgentRunMutation (ending one running worker)

import type {
  SubAgentDefinition,
  SubAgentsDeleteInput,
  SubAgentsSaveInput,
  SubAgentsSavedInput,
  ProviderStopSubagentInput,
} from "@peakcode/contracts";
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { ensureNativeApi } from "~/nativeApi";

export const subAgentsQueryKey = ["subAgents", "list"] as const;

export function subAgentsQueryOptions() {
  return queryOptions({
    queryKey: subAgentsQueryKey,
    queryFn: async (): Promise<SubAgentsSavedInput> => {
      return ensureNativeApi().subAgents.list({});
    },
    staleTime: 30 * 1000,
  });
}

export function useSubAgentsQuery() {
  return useQuery(subAgentsQueryOptions());
}

/**
 * Save (upsert) a worker.
 *
 * The server answers with the whole registry, so the cache is replaced from that snapshot
 * instead of patched — the response is the authoritative ordering and the id normalization
 * (the server slugs the handle), and a local patch would disagree with it.
 */
export function saveSubAgentMutationOptions(queryClient: QueryClient) {
  return {
    mutationFn: async (input: SubAgentsSaveInput): Promise<SubAgentsSavedInput> => {
      return ensureNativeApi().subAgents.save(input);
    },
    onSuccess: (snapshot: SubAgentsSavedInput) => {
      queryClient.setQueryData<SubAgentsSavedInput>(subAgentsQueryKey, snapshot);
      void queryClient.invalidateQueries({ queryKey: subAgentsQueryKey });
    },
  };
}

export function deleteSubAgentMutationOptions(queryClient: QueryClient) {
  return {
    mutationFn: async (input: SubAgentsDeleteInput): Promise<SubAgentsSavedInput> => {
      return ensureNativeApi().subAgents.delete(input);
    },
    onSuccess: (snapshot: SubAgentsSavedInput) => {
      queryClient.setQueryData<SubAgentsSavedInput>(subAgentsQueryKey, snapshot);
      void queryClient.invalidateQueries({ queryKey: subAgentsQueryKey });
    },
  };
}

export function useSaveSubAgentMutation() {
  return useMutation(saveSubAgentMutationOptions(useQueryClient()));
}

export function useDeleteSubAgentMutation() {
  return useMutation(deleteSubAgentMutationOptions(useQueryClient()));
}

/** A blank worker for the panel's "New" form. */
export function emptySubAgentDraft(): SubAgentDefinition {
  return {
    id: "",
    name: "",
    description: "",
    systemPrompt: "",
    tools: [],
    model: null,
    enabled: true,
  };
}

/**
 * End one worker of a running Multi-Agent turn.
 *
 * Not a query invalidation: the registry did not change, the *run* did. The card reads its state
 * from the orchestration stream, so the server's settlement of the worker is what updates it —
 * this mutation only carries the request and reports whether anything was still running.
 */
export function useStopSubAgentRunMutation() {
  return useMutation({
    mutationFn: async (input: ProviderStopSubagentInput): Promise<boolean> => {
      return ensureNativeApi().subAgents.stopRun(input);
    },
  });
}
