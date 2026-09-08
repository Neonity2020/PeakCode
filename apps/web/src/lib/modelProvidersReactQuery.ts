// FILE: modelProvidersReactQuery.ts
// Purpose: React Query hooks for the "Model Providers" settings surface.
// Layer: Web data fetching helpers

import type { ModelProvidersFile, ServerSaveModelProvidersInput } from "@peakcode/contracts";
import { queryOptions, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { ensureNativeApi } from "../nativeApi";
import { providerDiscoveryQueryKeys } from "./providerDiscoveryReactQuery";
import { toastManager } from "../components/ui/toast";

export const modelProvidersQueryKeys = {
  all: ["modelProviders"] as const,
  file: (agentDir?: string) => ["modelProviders", "file", agentDir || null] as const,
};

export const modelProvidersQueryOptions = (agentDir?: string) => queryOptions({
  queryKey: modelProvidersQueryKeys.file(agentDir),
  queryFn: async () => {
    const api = ensureNativeApi();
    return api.server.listModelProviders(agentDir ? { agentDir } : {});
  },
  // External edits are reloaded on a subsequent mount or focus.
  staleTime: 30_000,
});

export function useModelProvidersQuery(agentDir?: string) {
  return useQuery(modelProvidersQueryOptions(agentDir));
}

export function saveModelProvidersMutationOptions(queryClient: QueryClient) {
  return {
    mutationFn: async (input: ServerSaveModelProvidersInput) => {
      const api = ensureNativeApi();
      return api.server.saveModelProviders(input);
    },
    onSuccess: async (saved: ModelProvidersFile, input: ServerSaveModelProvidersInput) => {
      await queryClient.cancelQueries({ queryKey: modelProvidersQueryKeys.file(input.agentDir) });
      queryClient.setQueryData<ModelProvidersFile>(modelProvidersQueryKeys.file(input.agentDir), saved);
      await queryClient.invalidateQueries({
        queryKey: [...providerDiscoveryQueryKeys.all, "models", "pi"],
      });
    },
    onError: (error: Error) => {
      toastManager.add({ type: "error", title: error.message });
    },
  };
}

export function useSaveModelProvidersMutation() {
  return useMutation(saveModelProvidersMutationOptions(useQueryClient()));
}
