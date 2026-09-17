// FILE: composerDraftStore.types.ts
// Purpose: Public composer draft types and the store state contract.
// Layer: Web state store

// Depends on: contracts schemas, app model resolution helpers, and zustand persistence.

import {
  type ModelSlug,
  ModelSelection,
  OrchestrationThreadPullRequest,
  ProjectId,
  ProviderInteractionMode,
  ProviderKind,
  ProviderMentionReference,
  ProviderModelOptions,
  RuntimeMode,
  ThreadId,
} from "@peakcode/contracts";

import type { ThreadPrimarySurface } from "./types";
import type { TerminalContextDraft } from "./lib/terminalContext";

import {
  ComposerAssistantSelectionAttachment,
  ComposerImageAttachment,
  DraftThreadEnvMode,
  PersistedComposerImageAttachment,
  QueuedComposerTurn,
} from "./composerDraftStore.schemas";

export interface ComposerThreadDraftState {
  prompt: string;
  images: ComposerImageAttachment[];
  nonPersistedImageIds: string[];
  persistedAttachments: PersistedComposerImageAttachment[];
  assistantSelections: ComposerAssistantSelectionAttachment[];
  /**
   * Plugins picked for the next turn, as `plugin://` mention references.
   *
   * Separate from the `@name` tokens in the prompt: a chip keeps a plugin on the turn
   * even when the user never types its name, which is how the composer's `+` menu and
   * the plugin library's "use" action attach one.
   */
  plugins: ProviderMentionReference[];
  terminalContexts: TerminalContextDraft[];
  queuedTurns: QueuedComposerTurn[];
  modelSelectionByProvider: Partial<Record<ProviderKind, ModelSelection>>;
  activeProvider: ProviderKind | null;
  runtimeMode: RuntimeMode | null;
  interactionMode: ProviderInteractionMode | null;
}

export interface DraftThreadState {
  projectId: ProjectId;
  createdAt: string;
  runtimeMode: RuntimeMode;
  interactionMode: ProviderInteractionMode;
  entryPoint: ThreadPrimarySurface;
  branch: string | null;
  worktreePath: string | null;
  lastKnownPr?: OrchestrationThreadPullRequest | null;
  envMode: DraftThreadEnvMode;
  isTemporary?: boolean;
  promotedTo?: ThreadId;
}

export interface ProjectDraftThread extends DraftThreadState {
  threadId: ThreadId;
}

export interface ComposerDraftStoreState {
  draftsByThreadId: Record<ThreadId, ComposerThreadDraftState>;
  draftThreadsByThreadId: Record<ThreadId, DraftThreadState>;
  projectDraftThreadIdByProjectId: Record<string, ThreadId>;
  stickyModelSelectionByProvider: Partial<Record<ProviderKind, ModelSelection>>;
  stickyActiveProvider: ProviderKind | null;
  getDraftThreadByProjectId: (
    projectId: ProjectId,
    entryPoint?: ThreadPrimarySurface,
  ) => ProjectDraftThread | null;
  getDraftThread: (threadId: ThreadId) => DraftThreadState | null;
  setProjectDraftThreadId: (
    projectId: ProjectId,
    threadId: ThreadId,
    options?: {
      branch?: string | null;
      worktreePath?: string | null;
      lastKnownPr?: OrchestrationThreadPullRequest | null;
      createdAt?: string;
      envMode?: DraftThreadEnvMode;
      runtimeMode?: RuntimeMode;
      interactionMode?: ProviderInteractionMode;
      entryPoint?: ThreadPrimarySurface;
      isTemporary?: boolean;
    },
  ) => void;
  setDraftThreadContext: (
    threadId: ThreadId,
    options: {
      branch?: string | null;
      worktreePath?: string | null;
      lastKnownPr?: OrchestrationThreadPullRequest | null;
      projectId?: ProjectId;
      createdAt?: string;
      envMode?: DraftThreadEnvMode;
      runtimeMode?: RuntimeMode;
      interactionMode?: ProviderInteractionMode;
      entryPoint?: ThreadPrimarySurface;
      isTemporary?: boolean;
    },
  ) => void;
  clearProjectDraftThreadId: (projectId: ProjectId, entryPoint?: ThreadPrimarySurface) => void;
  clearProjectDraftThreads: (projectId: ProjectId) => void;
  clearProjectDraftThreadById: (projectId: ProjectId, threadId: ThreadId) => void;
  markDraftThreadPromoting: (threadId: ThreadId, promotedTo?: ThreadId) => void;
  finalizePromotedDraftThread: (threadId: ThreadId) => void;
  clearDraftThread: (threadId: ThreadId) => void;
  setStickyModelSelection: (modelSelection: ModelSelection | null | undefined) => void;
  setPrompt: (threadId: ThreadId, prompt: string) => void;
  setTerminalContexts: (threadId: ThreadId, contexts: TerminalContextDraft[]) => void;
  setModelSelection: (
    threadId: ThreadId,
    modelSelection: ModelSelection | null | undefined,
  ) => void;
  setModelOptions: (
    threadId: ThreadId,
    modelOptions: ProviderModelOptions | null | undefined,
  ) => void;
  applyStickyState: (threadId: ThreadId) => void;
  setProviderModelOptions: (
    threadId: ThreadId,
    provider: ProviderKind,
    nextProviderOptions: ProviderModelOptions[ProviderKind] | null | undefined,
    options?: {
      model?: string | null;
      persistSticky?: boolean;
    },
  ) => void;
  setRuntimeMode: (threadId: ThreadId, runtimeMode: RuntimeMode | null | undefined) => void;
  setInteractionMode: (
    threadId: ThreadId,
    interactionMode: ProviderInteractionMode | null | undefined,
  ) => void;
  enqueueQueuedTurn: (threadId: ThreadId, queuedTurn: QueuedComposerTurn) => void;
  insertQueuedTurn: (threadId: ThreadId, queuedTurn: QueuedComposerTurn, index: number) => void;
  removeQueuedTurn: (threadId: ThreadId, queuedTurnId: string) => void;
  addImage: (threadId: ThreadId, image: ComposerImageAttachment) => void;
  addImages: (threadId: ThreadId, images: ComposerImageAttachment[]) => void;
  removeImage: (threadId: ThreadId, imageId: string) => void;
  addAssistantSelection: (
    threadId: ThreadId,
    selection: ComposerAssistantSelectionAttachment,
  ) => boolean;
  removeAssistantSelection: (threadId: ThreadId, selectionId: string) => void;
  clearAssistantSelections: (threadId: ThreadId) => void;
  addPlugin: (threadId: ThreadId, plugin: ProviderMentionReference) => boolean;
  removePlugin: (threadId: ThreadId, pluginPath: string) => void;
  insertTerminalContext: (
    threadId: ThreadId,
    prompt: string,
    context: TerminalContextDraft,
    index: number,
  ) => boolean;
  addTerminalContext: (threadId: ThreadId, context: TerminalContextDraft) => void;
  addTerminalContexts: (threadId: ThreadId, contexts: TerminalContextDraft[]) => void;
  removeTerminalContext: (threadId: ThreadId, contextId: string) => void;
  clearTerminalContexts: (threadId: ThreadId) => void;
  clearPersistedAttachments: (threadId: ThreadId) => void;
  syncPersistedAttachments: (
    threadId: ThreadId,
    attachments: PersistedComposerImageAttachment[],
  ) => void;
  copyTransferableComposerState: (sourceThreadId: ThreadId, targetThreadId: ThreadId) => void;
  clearComposerContent: (threadId: ThreadId) => void;
}

export interface EffectiveComposerModelState {
  selectedModel: ModelSlug;
  modelOptions: ProviderModelOptions | null;
}
