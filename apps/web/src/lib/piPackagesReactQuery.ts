// FILE: piPackagesReactQuery.ts
// Purpose: React Query hooks for the "Pi Packages" settings surface.
// Layer: Web data fetching helpers

import type { PiPackagesSnapshot, ServerInstallPiPackageInput } from "@peakcode/contracts";
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { ensureNativeApi } from "../nativeApi";
import { providerDiscoveryQueryKeys } from "./providerDiscoveryReactQuery";
import { toastManager } from "../components/ui/toast";

export const piPackagesQueryKeys = {
  all: ["piPackages"] as const,
  list: (agentDir?: string) => ["piPackages", "list", agentDir || null] as const,
};

export const piPackagesQueryOptions = (agentDir?: string) =>
  queryOptions({
    queryKey: piPackagesQueryKeys.list(agentDir),
    queryFn: async () => {
      const api = ensureNativeApi();
      return api.server.listPiPackages(agentDir ? { agentDir } : {});
    },
    // Install runs npm/git, so an install can change a lot of disk state; other windows
    // editing settings.json are picked up on the next mount or focus.
    staleTime: 30_000,
  });

export function usePiPackagesQuery(agentDir?: string) {
  return useQuery(piPackagesQueryOptions(agentDir));
}

/**
 * Install and remove both answer with the refreshed listing, so the cache is replaced from
 * the response instead of triggering a second round trip.
 */
function cacheSnapshot(
  queryClient: QueryClient,
  agentDir: string | undefined,
  snapshot: PiPackagesSnapshot,
): void {
  queryClient.setQueryData<PiPackagesSnapshot>(piPackagesQueryKeys.list(agentDir), snapshot);
  void queryClient.invalidateQueries({ queryKey: piPackagesQueryKeys.all });
  // Packages contribute skills, prompts, and extensions; the discovery views read those.
  void queryClient.invalidateQueries({ queryKey: providerDiscoveryQueryKeys.all });
}

export function installPiPackageMutationOptions(queryClient: QueryClient) {
  return {
    mutationFn: async (input: ServerInstallPiPackageInput) => {
      const api = ensureNativeApi();
      return api.server.installPiPackage(input);
    },
    onSuccess: (snapshot: PiPackagesSnapshot, input: ServerInstallPiPackageInput) => {
      cacheSnapshot(queryClient, input.agentDir, snapshot);
    },
    onError: (error: Error) => {
      toastManager.add({ type: "error", title: error.message });
    },
  };
}

export function useInstallPiPackageMutation() {
  return useMutation(installPiPackageMutationOptions(useQueryClient()));
}

export function removePiPackageMutationOptions(queryClient: QueryClient) {
  return {
    mutationFn: async (input: { agentDir?: string; source: string }) => {
      const api = ensureNativeApi();
      return api.server.removePiPackage(input);
    },
    onSuccess: (snapshot: PiPackagesSnapshot, input: { agentDir?: string }) => {
      cacheSnapshot(queryClient, input.agentDir, snapshot);
    },
    onError: (error: Error) => {
      toastManager.add({ type: "error", title: error.message });
    },
  };
}

export function useRemovePiPackageMutation() {
  return useMutation(removePiPackageMutationOptions(useQueryClient()));
}
