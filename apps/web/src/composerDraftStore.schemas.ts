/**
 * ComposerDraftStoreSchemas - Persisted composer draft schemas, storage key and legacy shapes.
 *
 * @module ComposerDraftStoreSchemas
 */
// FILE: composerDraftStore.ts
// Purpose: Stores composer drafts, model selections, queued turns, and sticky provider choices.
// Layer: Web state store
// Depends on: contracts schemas, app model resolution helpers, and zustand persistence.

import {
  ModelSelection,
  OrchestrationThreadPullRequest,
  ProjectId,
  ProviderMentionReference,
  ProviderInteractionMode,
  ProviderKind,
  ProviderModelOptions,
  ProviderSkillReference,
  ProviderStartOptions,
  RuntimeMode,
  ThreadId,
} from "@peakcode/contracts";
import * as Schema from "effect/Schema";

import type { ChatAssistantSelectionAttachment, ChatImageAttachment } from "./types";
import type { TerminalContextDraft } from "./lib/terminalContext";

export const COMPOSER_DRAFT_STORAGE_KEY = "peakcode:composer-drafts:v1";
export const COMPOSER_DRAFT_STORAGE_VERSION = 4;
export const DraftThreadEnvModeSchema = Schema.Literals(["local", "worktree"]);
export type DraftThreadEnvMode = typeof DraftThreadEnvModeSchema.Type;
export const DraftThreadEntryPointSchema = Schema.Literals(["chat", "terminal"]);
export const COMPOSER_PROVIDER_KINDS = ["pi"] as const satisfies readonly ProviderKind[];
export const isProviderKind = Schema.is(ProviderKind);

export const COMPOSER_PERSIST_DEBOUNCE_MS = 300;
export const TERMINAL_DRAFT_THREAD_MAPPING_SUFFIX = "::terminal";

export const PersistedComposerImageAttachment = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  mimeType: Schema.String,
  sizeBytes: Schema.Number,
  dataUrl: Schema.String,
});
export type PersistedComposerImageAttachment = typeof PersistedComposerImageAttachment.Type;

export interface ComposerImageAttachment extends Omit<ChatImageAttachment, "previewUrl"> {
  previewUrl: string;
  file: File;
}

export type ComposerAssistantSelectionAttachment = ChatAssistantSelectionAttachment;

export interface QueuedComposerChatTurn {
  id: string;
  kind: "chat";
  createdAt: string;
  previewText: string;
  prompt: string;
  images: ComposerImageAttachment[];
  assistantSelections: ComposerAssistantSelectionAttachment[];
  terminalContexts: TerminalContextDraft[];
  skills: ProviderSkillReference[];
  mentions: ProviderMentionReference[];
  selectedProvider: ProviderKind;
  selectedModel: string | null;
  selectedPromptEffort: string | null;
  modelSelection: ModelSelection;
  providerOptionsForDispatch?: ProviderStartOptions | undefined;
  runtimeMode: RuntimeMode;
  interactionMode: ProviderInteractionMode;
  envMode: DraftThreadEnvMode;
}

export interface QueuedComposerPlanFollowUp {
  id: string;
  kind: "plan-follow-up";
  createdAt: string;
  previewText: string;
  text: string;
  interactionMode: ProviderInteractionMode;
  selectedProvider: ProviderKind;
  selectedModel: string | null;
  selectedPromptEffort: string | null;
  modelSelection: ModelSelection;
  providerOptionsForDispatch?: ProviderStartOptions | undefined;
  runtimeMode: RuntimeMode;
}

export type QueuedComposerTurn = QueuedComposerChatTurn | QueuedComposerPlanFollowUp;

export const PersistedTerminalContextDraft = Schema.Struct({
  id: Schema.String,
  threadId: ThreadId,
  createdAt: Schema.String,
  terminalId: Schema.String,
  terminalLabel: Schema.String,
  lineStart: Schema.Number,
  lineEnd: Schema.Number,
});
export type PersistedTerminalContextDraft = typeof PersistedTerminalContextDraft.Type;

export const PersistedQueuedTerminalContextDraft = Schema.Struct({
  id: Schema.String,
  threadId: ThreadId,
  createdAt: Schema.String,
  terminalId: Schema.String,
  terminalLabel: Schema.String,
  lineStart: Schema.Number,
  lineEnd: Schema.Number,
  text: Schema.String,
});
export type PersistedQueuedTerminalContextDraft = typeof PersistedQueuedTerminalContextDraft.Type;

export const PersistedQueuedComposerChatTurn = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literal("chat"),
  createdAt: Schema.String,
  previewText: Schema.String,
  prompt: Schema.String,
  images: Schema.Array(PersistedComposerImageAttachment),
  assistantSelections: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        assistantMessageId: Schema.String,
        text: Schema.String,
      }),
    ),
  ),
  terminalContexts: Schema.Array(PersistedQueuedTerminalContextDraft),
  skills: Schema.Array(ProviderSkillReference),
  mentions: Schema.Array(ProviderMentionReference),
  selectedProvider: ProviderKind,
  selectedModel: Schema.NullOr(Schema.String),
  selectedPromptEffort: Schema.NullOr(Schema.String),
  modelSelection: ModelSelection,
  providerOptionsForDispatch: Schema.optionalKey(ProviderStartOptions),
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  envMode: DraftThreadEnvModeSchema,
});
export type PersistedQueuedComposerChatTurn = typeof PersistedQueuedComposerChatTurn.Type;

export const PersistedQueuedComposerPlanFollowUp = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literal("plan-follow-up"),
  createdAt: Schema.String,
  previewText: Schema.String,
  text: Schema.String,
  interactionMode: ProviderInteractionMode,
  selectedProvider: ProviderKind,
  selectedModel: Schema.NullOr(Schema.String),
  selectedPromptEffort: Schema.NullOr(Schema.String),
  modelSelection: ModelSelection,
  providerOptionsForDispatch: Schema.optionalKey(ProviderStartOptions),
  runtimeMode: RuntimeMode,
});
export type PersistedQueuedComposerPlanFollowUp = typeof PersistedQueuedComposerPlanFollowUp.Type;

export const PersistedQueuedComposerTurn = Schema.Union([
  PersistedQueuedComposerChatTurn,
  PersistedQueuedComposerPlanFollowUp,
]);
export type PersistedQueuedComposerTurn = typeof PersistedQueuedComposerTurn.Type;

export const PersistedComposerThreadDraftState = Schema.Struct({
  prompt: Schema.String,
  attachments: Schema.Array(PersistedComposerImageAttachment),
  assistantSelections: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        assistantMessageId: Schema.String,
        text: Schema.String,
      }),
    ),
  ),
  terminalContexts: Schema.optionalKey(Schema.Array(PersistedTerminalContextDraft)),
  queuedTurns: Schema.optionalKey(Schema.Array(PersistedQueuedComposerTurn)),
  modelSelectionByProvider: Schema.optionalKey(
    Schema.Record(ProviderKind, Schema.optionalKey(ModelSelection)),
  ),
  activeProvider: Schema.optionalKey(Schema.NullOr(ProviderKind)),
  runtimeMode: Schema.optionalKey(RuntimeMode),
  interactionMode: Schema.optionalKey(ProviderInteractionMode),
});
export type PersistedComposerThreadDraftState = typeof PersistedComposerThreadDraftState.Type;

export const LegacyCodexFields = Schema.Struct({
  effort: Schema.optionalKey(Schema.String),
  codexFastMode: Schema.optionalKey(Schema.Boolean),
  serviceTier: Schema.optionalKey(Schema.String),
});
export type LegacyCodexFields = typeof LegacyCodexFields.Type;

export const LegacyThreadModelFields = Schema.Struct({
  provider: Schema.optionalKey(ProviderKind),
  model: Schema.optionalKey(Schema.String),
  modelOptions: Schema.optionalKey(Schema.NullOr(ProviderModelOptions)),
});
export type LegacyThreadModelFields = typeof LegacyThreadModelFields.Type;

export type LegacyV2ThreadDraftFields = {
  modelSelection?: ModelSelection | null;
  modelOptions?: ProviderModelOptions | null;
};

export type LegacyPersistedComposerThreadDraftState = PersistedComposerThreadDraftState &
  LegacyCodexFields &
  LegacyThreadModelFields &
  LegacyV2ThreadDraftFields;

export const LegacyStickyModelFields = Schema.Struct({
  stickyProvider: Schema.optionalKey(ProviderKind),
  stickyModel: Schema.optionalKey(Schema.String),
  stickyModelOptions: Schema.optionalKey(Schema.NullOr(ProviderModelOptions)),
});
export type LegacyStickyModelFields = typeof LegacyStickyModelFields.Type;

export type LegacyV2StoreFields = {
  stickyModelSelection?: ModelSelection | null;
  stickyModelOptions?: ProviderModelOptions | null;
};

export type LegacyPersistedComposerDraftStoreState = PersistedComposerDraftStoreState &
  LegacyStickyModelFields &
  LegacyV2StoreFields;

export const PersistedDraftThreadState = Schema.Struct({
  projectId: ProjectId,
  createdAt: Schema.String,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  entryPoint: DraftThreadEntryPointSchema.pipe(Schema.withDecodingDefault(() => "chat")),
  branch: Schema.NullOr(Schema.String),
  worktreePath: Schema.NullOr(Schema.String),
  lastKnownPr: Schema.optionalKey(Schema.NullOr(OrchestrationThreadPullRequest)),
  envMode: DraftThreadEnvModeSchema,
  isTemporary: Schema.optionalKey(Schema.Boolean),
  promotedTo: Schema.optionalKey(ThreadId),
});
export type PersistedDraftThreadState = typeof PersistedDraftThreadState.Type;

export const PersistedComposerDraftStoreState = Schema.Struct({
  draftsByThreadId: Schema.Record(ThreadId, PersistedComposerThreadDraftState),
  draftThreadsByThreadId: Schema.Record(ThreadId, PersistedDraftThreadState),
  projectDraftThreadIdByProjectId: Schema.Record(ProjectId, ThreadId),
  stickyModelSelectionByProvider: Schema.optionalKey(
    Schema.Record(ProviderKind, Schema.optionalKey(ModelSelection)),
  ),
  stickyActiveProvider: Schema.optionalKey(Schema.NullOr(ProviderKind)),
});
export type PersistedComposerDraftStoreState = typeof PersistedComposerDraftStoreState.Type;

export const PersistedComposerDraftStoreStorage = Schema.Struct({
  version: Schema.Number,
  state: PersistedComposerDraftStoreState,
});
