// FILE: useAttachPluginToComposer.ts
// Purpose: The "use this plugin" action behind the plugin library's detail view: attach the
//          plugin to a composer draft as a chip and take the user to that composer.
// Layer: Web hook
// Depends on: composer draft store, sidebar last-route state and the new-chat handler.

import { useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ThreadId } from "@peakcode/contracts";

import { resolveRestorableThreadRoute } from "../chatRouteRestore";
import { readSidebarUiState } from "../components/Sidebar.uiState";
import { useComposerDraftStore } from "../composerDraftStore";
import { buildPluginMentionReference } from "../lib/providerDiscovery";
import { findDefaultWorkspaceProject } from "../lib/defaultWorkspace";
import type { PluginEntry } from "../components/useProviderDiscoveryData";
import { useStore } from "../store";
import { useWorkspaceStore } from "../workspaceStore";
import { useHandleNewChat } from "./useHandleNewChat";

/**
 * Where "use" lands: the chat the user was last in, otherwise a new one.
 *
 * The plugin itself goes on the draft, not the prompt: the composer shows it as a chip and
 * the next turn carries it, so the user can still type, paste a screenshot or attach images
 * around it. A draft the app has no record of is not a target — a thread that was deleted
 * while the route was stored must not be resurrected — so an unknown id falls back to a new chat.
 */
export function useAttachPluginToComposer() {
  const navigate = useNavigate();
  const { handleNewChat } = useHandleNewChat();
  const threadIds = useStore((store) => store.threadIds ?? []);
  const draftThreadsByThreadId = useComposerDraftStore((store) => store.draftThreadsByThreadId);
  const homeDir = useWorkspaceStore((store) => store.homeDir);

  return useCallback(
    async (entry: PluginEntry): Promise<boolean> => {
      const plugin = buildPluginMentionReference(entry.plugin.name, entry.marketplaceName);
      const store = useComposerDraftStore.getState();
      const restorableRoute = resolveRestorableThreadRoute({
        lastThreadRoute: readSidebarUiState().lastThreadRoute,
        availableThreadIds: new Set([...threadIds, ...Object.keys(draftThreadsByThreadId)]),
      });

      if (restorableRoute) {
        const threadId = ThreadId.makeUnsafe(restorableRoute.threadId);
        store.addPlugin(threadId, plugin);
        await navigate({ to: "/$threadId", params: { threadId } });
        return true;
      }

      const newChat = await handleNewChat();
      if (!newChat.ok) {
        return false;
      }
      // `handleNewChat` opens a draft composer for the default workspace — a project it may
      // have just created — so both the project list and the draft map are read fresh here.
      // It has already navigated to that composer.
      const createdDraftThread = (() => {
        const defaultWorkspaceProject = findDefaultWorkspaceProject(
          useStore.getState().projects,
          homeDir,
        );
        return defaultWorkspaceProject
          ? useComposerDraftStore.getState().getDraftThreadByProjectId(defaultWorkspaceProject.id)
          : null;
      })();
      if (!createdDraftThread) {
        return false;
      }
      useComposerDraftStore.getState().addPlugin(createdDraftThread.threadId, plugin);
      return true;
    },
    [draftThreadsByThreadId, handleNewChat, homeDir, navigate, threadIds],
  );
}
