// FILE: useWorkspaceFileTree.ts
// Purpose: Lazily load one workspace directory level at a time for tree surfaces, and refresh
//          the already-open levels when a turn changes files.
// Layer: Web hooks
// Exports: useWorkspaceFileTree

import type { ProjectFileSystemEntry } from "@peakcode/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

import { useWorkspaceRevision } from "~/lib/workspaceRevision";
import { readNativeApi } from "~/nativeApi";

export type WorkspaceEntriesByParent = Record<
  string,
  readonly ProjectFileSystemEntry[] | undefined
>;

export interface WorkspaceFileTreeController {
  entriesByParent: WorkspaceEntriesByParent;
  expandedPaths: ReadonlySet<string>;
  loadingPaths: ReadonlySet<string>;
  errorMessage: string | null;
  isRootLoading: boolean;
  toggleDirectory: (relativePath: string, options?: { hasChildren?: boolean }) => void;
  ensureLoaded: (relativePath?: string) => void;
  /** Refetch the levels that are currently loaded, keeping expansion and the visible rows. */
  refresh: () => void;
}

/**
 * Directory entries are cached per parent path. The cache is dropped only on an explicit
 * refresh or when the root changes, so expanding a large tree stays responsive instead of
 * re-walking the workspace.
 */
export function useWorkspaceFileTree(input: {
  rootPath: string | null;
  includeFiles?: boolean;
  enabled?: boolean;
}): WorkspaceFileTreeController {
  const { rootPath, includeFiles = true, enabled = true } = input;
  const [entriesByParent, setEntriesByParent] = useState<WorkspaceEntriesByParent>({});
  const [expandedPaths, setExpandedPaths] = useState<ReadonlySet<string>>(() => new Set());
  const [loadingPaths, setLoadingPaths] = useState<ReadonlySet<string>>(() => new Set());
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const workspaceRevision = useWorkspaceRevision();
  // In-flight requests must not be restarted by a state update from a neighbouring level.
  const inFlightPathsRef = useRef<Set<string>>(new Set());
  const loadedPathsRef = useRef<Set<string>>(new Set());
  // Bumped on every reset so a response from the previous root cannot land in the new tree.
  const generationRef = useRef(0);

  useEffect(() => {
    generationRef.current += 1;
    inFlightPathsRef.current = new Set();
    loadedPathsRef.current = new Set();
    setEntriesByParent({});
    setExpandedPaths(new Set());
    setLoadingPaths(new Set());
    setErrorMessage(null);
  }, [rootPath]);

  const loadDirectory = useCallback(
    async (relativePath: string, options?: { force?: boolean }) => {
      const api = readNativeApi();
      if (!api || !rootPath || !enabled) {
        return;
      }
      if (inFlightPathsRef.current.has(relativePath)) {
        return;
      }
      if (!options?.force && loadedPathsRef.current.has(relativePath)) {
        return;
      }

      const generation = generationRef.current;
      // A late response belongs to whatever tree is current when it lands, not to this one.
      const isCurrentGeneration = () => generationRef.current === generation;
      inFlightPathsRef.current.add(relativePath);
      setLoadingPaths((current) => new Set(current).add(relativePath));
      try {
        const result = await api.projects.listDirectories({
          cwd: rootPath,
          ...(includeFiles ? { includeFiles: true } : {}),
          ...(relativePath ? { relativePath } : {}),
        });
        if (isCurrentGeneration()) {
          loadedPathsRef.current.add(relativePath);
          setEntriesByParent((current) => ({ ...current, [relativePath]: result.entries }));
          setErrorMessage(null);
        }
      } catch (error) {
        if (isCurrentGeneration()) {
          setErrorMessage(error instanceof Error ? error.message : "Unable to read directory.");
        }
      } finally {
        // In-flight bookkeeping is per request and must always be released: leaving a path
        // marked here would block every later load of that directory for good. Only the
        // cached payload belongs to a generation, so the loading flag is cleared
        // unconditionally too — the reducer is a no-op once a reset has dropped the key.
        inFlightPathsRef.current.delete(relativePath);
        setLoadingPaths((current) => {
          if (!current.has(relativePath)) {
            return current;
          }
          const next = new Set(current);
          next.delete(relativePath);
          return next;
        });
      }
    },
    [enabled, includeFiles, rootPath],
  );

  const ensureLoaded = useCallback(
    (relativePath = "") => {
      void loadDirectory(relativePath);
    },
    [loadDirectory],
  );

  useEffect(() => {
    if (enabled) {
      void loadDirectory("");
    }
  }, [enabled, loadDirectory]);

  // Refresh every level that is already on screen; levels that were never opened stay cold.
  const refresh = useCallback(() => {
    const loadedPaths = [...loadedPathsRef.current];
    for (const relativePath of loadedPaths.length > 0 ? loadedPaths : [""]) {
      void loadDirectory(relativePath, { force: true });
    }
  }, [loadDirectory]);

  // A turn may have created or removed files; re-read the open levels so the tree catches up.
  const isFirstRevisionRef = useRef(workspaceRevision);
  useEffect(() => {
    if (isFirstRevisionRef.current === workspaceRevision) {
      return;
    }
    isFirstRevisionRef.current = workspaceRevision;
    refresh();
  }, [refresh, workspaceRevision]);

  const toggleDirectory = useCallback(
    (relativePath: string, options?: { hasChildren?: boolean }) => {
      const isExpanded = expandedPaths.has(relativePath);
      setExpandedPaths((current) => {
        const next = new Set(current);
        if (next.has(relativePath)) {
          next.delete(relativePath);
        } else {
          next.add(relativePath);
        }
        return next;
      });
      if (!isExpanded && options?.hasChildren !== false) {
        // Expansion is also the moment a level may have gone stale, so always re-read it.
        void loadDirectory(relativePath, { force: loadedPathsRef.current.has(relativePath) });
      }
    },
    [expandedPaths, loadDirectory],
  );

  return {
    entriesByParent,
    expandedPaths,
    loadingPaths,
    errorMessage,
    isRootLoading: loadingPaths.has(""),
    toggleDirectory,
    ensureLoaded,
    refresh,
  };
}
