import type {
  ProjectListChangedFilesResult,
  ProjectReadFileResult,
  ProjectSearchEntriesResult,
  ProjectSearchLocalEntriesResult,
} from "@peakcode/contracts";
import { queryOptions } from "@tanstack/react-query";
import { ensureNativeApi } from "~/nativeApi";

export const projectQueryKeys = {
  all: ["projects"] as const,
  searchEntries: (cwd: string | null, query: string, limit: number) =>
    ["projects", "search-entries", cwd, query, limit] as const,
  searchLocalEntries: (rootPath: string | null, query: string, limit: number) =>
    ["projects", "search-local-entries", rootPath, query, limit] as const,
  readFile: (cwd: string | null, relativePath: string | null) =>
    ["projects", "read-file", cwd, relativePath] as const,
  changedFiles: (cwd: string | null) => ["projects", "changed-files", cwd] as const,
};

const DEFAULT_SEARCH_ENTRIES_LIMIT = 80;
const DEFAULT_SEARCH_ENTRIES_STALE_TIME = 15_000;
const DEFAULT_SEARCH_LOCAL_ENTRIES_LIMIT = 50;
const DEFAULT_SEARCH_LOCAL_ENTRIES_STALE_TIME = 10_000;
const READ_FILE_STALE_TIME = 5_000;
const CHANGED_FILES_STALE_TIME = 5_000;
const CHANGED_FILES_REFETCH_INTERVAL_MS = 15_000;
const EMPTY_CHANGED_FILES_RESULT: ProjectListChangedFilesResult = {
  isGitRepository: false,
  files: [],
};
const EMPTY_SEARCH_ENTRIES_RESULT: ProjectSearchEntriesResult = {
  entries: [],
  truncated: false,
};
const EMPTY_SEARCH_LOCAL_ENTRIES_RESULT: ProjectSearchLocalEntriesResult = {
  entries: [],
  truncated: false,
};

export function projectSearchEntriesQueryOptions(input: {
  cwd: string | null;
  query: string;
  enabled?: boolean;
  limit?: number;
  staleTime?: number;
}) {
  const limit = input.limit ?? DEFAULT_SEARCH_ENTRIES_LIMIT;
  return queryOptions({
    queryKey: projectQueryKeys.searchEntries(input.cwd, input.query, limit),
    queryFn: async () => {
      const api = ensureNativeApi();
      if (!input.cwd) {
        throw new Error("Workspace entry search is unavailable.");
      }
      return api.projects.searchEntries({
        cwd: input.cwd,
        query: input.query,
        limit,
      });
    },
    enabled: (input.enabled ?? true) && input.cwd !== null && input.query.length > 0,
    staleTime: input.staleTime ?? DEFAULT_SEARCH_ENTRIES_STALE_TIME,
    placeholderData: (previous) => previous ?? EMPTY_SEARCH_ENTRIES_RESULT,
  });
}

export function projectSearchLocalEntriesQueryOptions(input: {
  rootPath: string | null;
  query: string;
  enabled?: boolean;
  limit?: number;
  includeFiles?: boolean;
  staleTime?: number;
}) {
  const limit = input.limit ?? DEFAULT_SEARCH_LOCAL_ENTRIES_LIMIT;
  const trimmedQuery = input.query.trim();
  return queryOptions({
    queryKey: projectQueryKeys.searchLocalEntries(input.rootPath, trimmedQuery, limit),
    queryFn: async () => {
      const api = ensureNativeApi();
      if (!input.rootPath) {
        throw new Error("Local entry search is unavailable.");
      }
      return api.projects.searchLocalEntries({
        rootPath: input.rootPath,
        query: trimmedQuery,
        limit,
        ...(input.includeFiles !== undefined ? { includeFiles: input.includeFiles } : {}),
      });
    },
    enabled: (input.enabled ?? true) && input.rootPath !== null && trimmedQuery.length >= 2,
    staleTime: input.staleTime ?? DEFAULT_SEARCH_LOCAL_ENTRIES_STALE_TIME,
    placeholderData: (previous) => previous ?? EMPTY_SEARCH_LOCAL_ENTRIES_RESULT,
  });
}

export function projectReadFileQueryOptions(input: {
  cwd: string | null;
  relativePath: string | null;
  enabled?: boolean;
}) {
  return queryOptions({
    // The file panel reads its own file path, so keep the key per path to allow tab switches
    // to hit already-cached contents instead of refetching.
    queryKey: projectQueryKeys.readFile(input.cwd, input.relativePath),
    queryFn: async (): Promise<ProjectReadFileResult> => {
      const api = ensureNativeApi();
      if (!input.cwd || !input.relativePath) {
        throw new Error("Workspace file contents are unavailable.");
      }
      return api.projects.readFile({ cwd: input.cwd, relativePath: input.relativePath });
    },
    enabled: (input.enabled ?? true) && input.cwd !== null && input.relativePath !== null,
    staleTime: READ_FILE_STALE_TIME,
    refetchOnWindowFocus: false,
  });
}

export function projectChangedFilesQueryOptions(input: {
  cwd: string | null;
  enabled?: boolean;
  refetchInterval?: number | false;
}) {
  return queryOptions({
    queryKey: projectQueryKeys.changedFiles(input.cwd),
    queryFn: async (): Promise<ProjectListChangedFilesResult> => {
      const api = ensureNativeApi();
      if (!input.cwd) {
        throw new Error("Changed files are unavailable.");
      }
      return api.projects.listChangedFiles({ cwd: input.cwd });
    },
    enabled: (input.enabled ?? true) && input.cwd !== null,
    staleTime: CHANGED_FILES_STALE_TIME,
    refetchInterval: input.refetchInterval ?? CHANGED_FILES_REFETCH_INTERVAL_MS,
    refetchOnWindowFocus: true,
    placeholderData: (previous) => previous ?? EMPTY_CHANGED_FILES_RESULT,
  });
}
