import type { ProviderKind, ServerUsageStatisticsSourceId } from "@peakcode/contracts";
import { queryOptions } from "@tanstack/react-query";
import { ensureNativeApi } from "~/nativeApi";

export const serverQueryKeys = {
  all: ["server"] as const,
  config: () => ["server", "config"] as const,
  authSession: () => ["server", "auth", "session"] as const,
  environment: () => ["server", "environment"] as const,
  settings: () => ["server", "settings"] as const,
  worktrees: () => ["server", "worktrees"] as const,
  providerUsage: (provider: ProviderKind | null | undefined, homePath?: string | null) =>
    ["server", "providerUsage", provider ?? null, homePath ?? null] as const,
  usageStatistics: (source?: ServerUsageStatisticsSourceId | null) =>
    ["server", "usageStatistics", source ?? null] as const,
  usageSessionDetail: (source: ServerUsageStatisticsSourceId | null, sessionId: string | null) =>
    ["server", "usageSessionDetail", source ?? null, sessionId ?? null] as const,
};

export function serverConfigQueryOptions() {
  return queryOptions({
    queryKey: serverQueryKeys.config(),
    queryFn: async () => {
      const api = ensureNativeApi();
      return api.server.getConfig();
    },
    staleTime: Infinity,
  });
}

export function serverAuthSessionQueryOptions() {
  return queryOptions({
    queryKey: serverQueryKeys.authSession(),
    queryFn: async () => {
      const api = ensureNativeApi();
      return api.server.getAuthSession();
    },
    staleTime: 15_000,
  });
}

export function serverEnvironmentQueryOptions() {
  return queryOptions({
    queryKey: serverQueryKeys.environment(),
    queryFn: async () => {
      const api = ensureNativeApi();
      return api.server.getEnvironment();
    },
    staleTime: Infinity,
  });
}

export function serverSettingsQueryOptions() {
  return queryOptions({
    queryKey: serverQueryKeys.settings(),
    queryFn: async () => {
      const api = ensureNativeApi();
      return api.server.getSettings();
    },
    staleTime: Infinity,
  });
}

export function serverWorktreesQueryOptions() {
  return queryOptions({
    queryKey: serverQueryKeys.worktrees(),
    queryFn: async () => {
      const api = ensureNativeApi();
      return api.server.listWorktrees();
    },
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
}

export function serverProviderUsageSnapshotQueryOptions(input: {
  provider: ProviderKind | null | undefined;
  homePath?: string | null;
}) {
  return queryOptions({
    queryKey: serverQueryKeys.providerUsage(input.provider, input.homePath),
    enabled: input.provider !== null && input.provider !== undefined,
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: async () => {
      if (!input.provider) return null;
      const api = ensureNativeApi();
      return api.server.getProviderUsageSnapshot({
        provider: input.provider,
        ...(input.homePath ? { homePath: input.homePath } : {}),
      });
    },
  });
}

/**
 * Usage statistics are read from local agent logs, so they only change while
 * sessions run: a short stale window keeps the page cheap to reopen, and the page's
 * own refresh button asks the server to rescan instead of waiting it out.
 */
export function usageStatisticsQueryOptions(input: {
  source?: ServerUsageStatisticsSourceId | null;
  refresh?: boolean;
}) {
  return queryOptions({
    queryKey: serverQueryKeys.usageStatistics(input.source),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: async () => {
      const api = ensureNativeApi();
      return api.server.getUsageStatistics({
        ...(input.source ? { source: input.source } : {}),
        ...(input.refresh ? { refresh: true } : {}),
      });
    },
  });
}

/** One session's request log, fetched only when the user opens the drill-down. */
export function usageSessionDetailQueryOptions(input: {
  source: ServerUsageStatisticsSourceId | null;
  sessionId: string | null;
}) {
  return queryOptions({
    queryKey: serverQueryKeys.usageSessionDetail(input.source, input.sessionId),
    enabled: input.source !== null && input.sessionId !== null,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: async () => {
      if (!input.source || !input.sessionId) return null;
      const api = ensureNativeApi();
      return api.server.getUsageSessionDetail({
        source: input.source,
        sessionId: input.sessionId,
      });
    },
  });
}
