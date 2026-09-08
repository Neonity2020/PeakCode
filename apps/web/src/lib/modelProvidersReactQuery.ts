// FILE: modelProvidersReactQuery.ts
// Purpose: React Query hooks for the "Model Providers" settings surface.
// Layer: Web data fetching helpers

import type { ModelProvidersFile, ServerSaveModelProvidersInput } from "@peakcode/contracts";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ensureNativeApi } from "../nativeApi";
import { toastManager } from "../components/ui/toast";

export const modelProvidersQueryKeys = {
  all: ["modelProviders"] as const,
  file: () => ["modelProviders", "file"] as const,
};

export const modelProvidersQueryOptions = queryOptions({
  queryKey: modelProvidersQueryKeys.file(),
  queryFn: async () => {
    const api = ensureNativeApi();
    return api.server.listModelProviders({});
  },
  // The file only changes through this panel, so a long staleness window keeps
  // the panel from refetching on every keystroke while still syncing on mount.
  staleTime: 30_000,
});

export function useModelProvidersQuery() {
  return useQuery(modelProvidersQueryOptions);
}

export function useSaveModelProvidersMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ServerSaveModelProvidersInput) => {
      const api = ensureNativeApi();
      return api.server.saveModelProviders(input);
    },
    onSuccess: (saved: ModelProvidersFile) => {
      queryClient.setQueryData<ModelProvidersFile>(modelProvidersQueryKeys.file(), saved);
    },
    onError: (error: Error) => {
      toastManager.add({
        type: "error",
        title: "保存模型提供商失败",
        description: error.message,
      });
    },
  });
}
