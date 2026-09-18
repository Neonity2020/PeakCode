// FILE: useThreadWorkspaceContext.ts
// Purpose: Resolve a chat's effective workspace root (local checkout or worktree) for
//          panels that read from the filesystem.
// Layer: Web hooks
// Exports: useThreadWorkspaceContext

import type { ProjectId, ThreadId } from "@peakcode/contracts";
import { useMemo } from "react";

import { useComposerDraftStore } from "~/composerDraftStore";
import { resolveDiffPanelThread } from "~/components/DiffPanel.logic";
import { resolveDiffEnvironmentState } from "~/lib/threadEnvironment";
import { useStore } from "~/store";
import { createProjectSelector, createThreadSelector } from "~/storeSelectors";

export interface ThreadWorkspaceContext {
  threadId: ThreadId | null;
  /** Absolute workspace root, or null while a worktree is still being prepared. */
  cwd: string | null;
  /** True while the chat targets a worktree whose path is not ready yet. */
  pending: boolean;
  projectId: ProjectId | null;
  projectName: string | null;
}

/**
 * Draft chats have no server thread yet, so the composer draft stands in for it. This
 * mirrors how the diff panel resolves the same workspace so both panels agree on `cwd`.
 */
export function useThreadWorkspaceContext(
  threadId: ThreadId | null | undefined,
): ThreadWorkspaceContext {
  const serverThread = useStore(useMemo(() => createThreadSelector(threadId ?? null), [threadId]));
  const draftThread = useComposerDraftStore((store) =>
    threadId ? (store.draftThreadsByThreadId[threadId] ?? null) : null,
  );
  const fallbackDraftProjectId = draftThread?.projectId ?? null;
  const fallbackDraftProject = useStore(
    useMemo(() => createProjectSelector(fallbackDraftProjectId), [fallbackDraftProjectId]),
  );
  const activeThread = useMemo(
    () =>
      resolveDiffPanelThread({
        threadId,
        serverThread,
        draftThread,
        fallbackModelSelection: fallbackDraftProject?.defaultModelSelection ?? null,
      }),
    [threadId, serverThread, draftThread, fallbackDraftProject?.defaultModelSelection],
  );
  const projectId = activeThread?.projectId ?? draftThread?.projectId ?? null;
  const project = useStore(useMemo(() => createProjectSelector(projectId), [projectId]));
  const environmentState = resolveDiffEnvironmentState({
    projectCwd: project?.cwd ?? null,
    envMode: serverThread?.envMode ?? draftThread?.envMode ?? activeThread?.envMode,
    worktreePath:
      serverThread?.worktreePath ?? draftThread?.worktreePath ?? activeThread?.worktreePath ?? null,
  });

  return {
    threadId: threadId ?? null,
    cwd: environmentState.cwd,
    pending: environmentState.pending,
    projectId,
    projectName: project?.name ?? null,
  };
}
