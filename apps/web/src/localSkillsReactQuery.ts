// FILE: localSkillsReactQuery.ts
// Purpose: TanStack Query bindings for the `skills.listLocal` WebSocket RPC. Used by the
//          Skills view to show the user's home-directory skills independent of any
//          provider session.
// Layer: Web React Query binding
// Exports: localSkillsQueryKey, localSkillsQueryOptions, useSetSkillEnabledMutation

import type { ListLocalUserSkillsResult, SetSkillEnabledResult } from "@peakcode/contracts";
import { queryOptions, useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { ensureNativeApi } from "~/nativeApi";

export const localSkillsQueryKey = ["skills", "listLocal"] as const;

export function localSkillsQueryOptions() {
  return queryOptions({
    queryKey: localSkillsQueryKey,
    queryFn: async (): Promise<ListLocalUserSkillsResult> => {
      return ensureNativeApi().skills.listLocal();
    },
    staleTime: 30 * 1000,
  });
}

/**
 * Switch one skill on or off.
 *
 * The server answers with the full disabled set, so the cache can be patched in place — the
 * checkbox has to move on click, and a refetch of the whole list would make it lag. The
 * listing is still invalidated so a later mount reads the stored truth.
 */
export function setSkillEnabledMutationOptions(queryClient: QueryClient) {
  return {
    mutationFn: async (input: { id: string; enabled: boolean }) => {
      const api = ensureNativeApi();
      return api.skills.setEnabled(input);
    },
    onSuccess: (_result: SetSkillEnabledResult, input: { id: string; enabled: boolean }) => {
      queryClient.setQueryData<ListLocalUserSkillsResult>(localSkillsQueryKey, (previous) =>
        previous
          ? {
              ...previous,
              skills: previous.skills.map((skill) =>
                skill.id === input.id ? { ...skill, enabled: input.enabled } : skill,
              ),
            }
          : previous,
      );
      void queryClient.invalidateQueries({ queryKey: localSkillsQueryKey });
    },
  };
}

export function useSetSkillEnabledMutation() {
  return useMutation(setSkillEnabledMutationOptions(useQueryClient()));
}
