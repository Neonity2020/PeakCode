// FILE: filesExplorerStore.ts
// Purpose: Persist the workspace file explorer — which workspace the sidebar is browsing plus
//          each chat's open file tabs and active tab.
// Layer: UI state store
// Exports: files explorer store, default-state helpers, and selectors.

import type { ThreadId } from "@peakcode/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export interface FilesExplorerThreadState {
  // Workspace-relative paths in tab order; the last opened tab is appended.
  openFilePaths: string[];
  activeFilePath: string | null;
}

/**
 * What the sidebar is browsing. The root is stored rather than a thread id because the
 * explorer is reachable from a chat (its worktree-aware root) and from a project row (the
 * project root) — both just need a directory to walk and a name to show.
 */
export interface FilesExplorerSidebarTarget {
  rootPath: string;
  label: string;
}

interface FilesExplorerStore {
  // Sidebar mode: the workspace tree replaces the thread list while this is set.
  sidebarTarget: FilesExplorerSidebarTarget | null;
  // "Changed only" filter shared by the explorer sidebar for its current root.
  sidebarChangedOnly: boolean;
  stateByThreadId: Record<string, FilesExplorerThreadState | undefined>;
  openSidebar: (target: FilesExplorerSidebarTarget) => void;
  closeSidebar: () => void;
  setSidebarChangedOnly: (changedOnly: boolean) => void;
  openFile: (threadId: ThreadId, filePath: string) => void;
  closeFile: (threadId: ThreadId, filePath: string) => void;
  setActiveFile: (threadId: ThreadId, filePath: string) => void;
  clearThreadExplorer: (threadId: ThreadId) => void;
}

const FILES_EXPLORER_STORAGE_KEY = "peakcode:files-explorer:v1";
// Tabs stay bounded so a long browsing session cannot grow the persisted payload without limit.
export const MAX_OPEN_FILE_TABS = 12;

const DEFAULT_THREAD_EXPLORER_STATE: FilesExplorerThreadState = {
  openFilePaths: [],
  activeFilePath: null,
};

export function createDefaultFilesExplorerThreadState(): FilesExplorerThreadState {
  return { openFilePaths: [], activeFilePath: null };
}

export function readThreadExplorerState(
  store: Pick<FilesExplorerStore, "stateByThreadId">,
  threadId: ThreadId | null,
): FilesExplorerThreadState {
  if (!threadId) {
    return DEFAULT_THREAD_EXPLORER_STATE;
  }
  return store.stateByThreadId[threadId] ?? DEFAULT_THREAD_EXPLORER_STATE;
}

function resolveNextOpenFilePaths(
  openFilePaths: readonly string[],
  filePath: string,
): readonly string[] {
  if (openFilePaths.includes(filePath)) {
    return openFilePaths;
  }
  const next = [...openFilePaths, filePath];
  return next.length > MAX_OPEN_FILE_TABS ? next.slice(next.length - MAX_OPEN_FILE_TABS) : next;
}

export const useFilesExplorerStore = create<FilesExplorerStore>()(
  persist(
    (set) => ({
      sidebarTarget: null,
      sidebarChangedOnly: false,
      stateByThreadId: {},
      openSidebar: (target) =>
        set((state) =>
          state.sidebarTarget?.rootPath === target.rootPath &&
          state.sidebarTarget.label === target.label
            ? state
            : { sidebarTarget: target },
        ),
      closeSidebar: () =>
        set((state) => (state.sidebarTarget === null ? state : { sidebarTarget: null })),
      setSidebarChangedOnly: (changedOnly) =>
        set((state) =>
          state.sidebarChangedOnly === changedOnly ? state : { sidebarChangedOnly: changedOnly },
        ),
      openFile: (threadId, filePath) =>
        set((state) => {
          const previous = state.stateByThreadId[threadId] ?? DEFAULT_THREAD_EXPLORER_STATE;
          const openFilePaths = resolveNextOpenFilePaths(previous.openFilePaths, filePath);
          if (openFilePaths === previous.openFilePaths && previous.activeFilePath === filePath) {
            return state;
          }
          return {
            stateByThreadId: {
              ...state.stateByThreadId,
              [threadId]: { openFilePaths: [...openFilePaths], activeFilePath: filePath },
            },
          };
        }),
      closeFile: (threadId, filePath) =>
        set((state) => {
          const previous = state.stateByThreadId[threadId];
          if (!previous || !previous.openFilePaths.includes(filePath)) {
            return state;
          }
          const openFilePaths = previous.openFilePaths.filter((path) => path !== filePath);
          // Closing the active tab falls back to the neighbouring tab on the left.
          const activeFilePath =
            previous.activeFilePath === filePath
              ? (openFilePaths.at(-1) ?? null)
              : previous.activeFilePath;
          return {
            stateByThreadId: {
              ...state.stateByThreadId,
              [threadId]: { openFilePaths, activeFilePath },
            },
          };
        }),
      setActiveFile: (threadId, filePath) =>
        set((state) => {
          const previous = state.stateByThreadId[threadId] ?? DEFAULT_THREAD_EXPLORER_STATE;
          if (previous.activeFilePath === filePath) {
            return state;
          }
          return {
            stateByThreadId: {
              ...state.stateByThreadId,
              [threadId]: {
                openFilePaths: [...resolveNextOpenFilePaths(previous.openFilePaths, filePath)],
                activeFilePath: filePath,
              },
            },
          };
        }),
      clearThreadExplorer: (threadId) =>
        set((state) => {
          if (!Object.hasOwn(state.stateByThreadId, threadId)) {
            return state;
          }
          const stateByThreadId = { ...state.stateByThreadId };
          delete stateByThreadId[threadId];
          return { stateByThreadId };
        }),
    }),
    {
      name: FILES_EXPLORER_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        sidebarTarget: state.sidebarTarget,
        sidebarChangedOnly: state.sidebarChangedOnly,
        stateByThreadId: state.stateByThreadId,
      }),
    },
  ),
);

export function selectFilesExplorerThreadState(threadId: ThreadId | null) {
  return (store: FilesExplorerStore) => readThreadExplorerState(store, threadId);
}
