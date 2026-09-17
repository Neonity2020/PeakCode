/**
 * ComposerDraftStoreDraft - Empty draft sentinels, draft key helpers and draft content normalization.
 *
 * @module ComposerDraftStoreDraft
 */
// FILE: composerDraftStore.ts
// Purpose: Stores composer drafts, model selections, queued turns, and sticky provider choices.
// Layer: Web state store
// Depends on: contracts schemas, app model resolution helpers, and zustand persistence.

import { ModelSelection, ProjectId, ProviderKind, ThreadId } from "@peakcode/contracts";

import type { ThreadPrimarySurface } from "./types";
import { type TerminalContextDraft, normalizeTerminalContextText } from "./lib/terminalContext";
import { normalizeAssistantSelectionAttachment } from "./lib/assistantSelections";

import {
  ComposerAssistantSelectionAttachment,
  ComposerImageAttachment,
  PersistedComposerImageAttachment,
  QueuedComposerTurn,
  TERMINAL_DRAFT_THREAD_MAPPING_SUFFIX,
} from "./composerDraftStore.schemas";
import { ComposerThreadDraftState } from "./composerDraftStore.types";

export function projectDraftThreadMappingKey(
  projectId: ProjectId,
  entryPoint: ThreadPrimarySurface = "chat",
): string {
  return entryPoint === "terminal"
    ? `${projectId}${TERMINAL_DRAFT_THREAD_MAPPING_SUFFIX}`
    : projectId;
}

export function projectDraftThreadEntryPointFromKey(key: string): ThreadPrimarySurface {
  return key.endsWith(TERMINAL_DRAFT_THREAD_MAPPING_SUFFIX) ? "terminal" : "chat";
}

export function projectIdFromDraftThreadMappingKey(key: string): ProjectId {
  return (
    key.endsWith(TERMINAL_DRAFT_THREAD_MAPPING_SUFFIX)
      ? key.slice(0, -TERMINAL_DRAFT_THREAD_MAPPING_SUFFIX.length)
      : key
  ) as ProjectId;
}

export const EMPTY_IMAGES: ComposerImageAttachment[] = [];
export const EMPTY_IDS: string[] = [];
export const EMPTY_PERSISTED_ATTACHMENTS: PersistedComposerImageAttachment[] = [];
export const EMPTY_TERMINAL_CONTEXTS: TerminalContextDraft[] = [];
export const EMPTY_QUEUED_TURNS: QueuedComposerTurn[] = [];
Object.freeze(EMPTY_IMAGES);
Object.freeze(EMPTY_IDS);
Object.freeze(EMPTY_PERSISTED_ATTACHMENTS);
Object.freeze(EMPTY_QUEUED_TURNS);
export const EMPTY_MODEL_SELECTION_BY_PROVIDER: Partial<Record<ProviderKind, ModelSelection>> =
  Object.freeze({});

export const EMPTY_THREAD_DRAFT = Object.freeze<ComposerThreadDraftState>({
  prompt: "",
  images: EMPTY_IMAGES,
  nonPersistedImageIds: EMPTY_IDS,
  persistedAttachments: EMPTY_PERSISTED_ATTACHMENTS,
  assistantSelections: [],
  terminalContexts: EMPTY_TERMINAL_CONTEXTS,
  queuedTurns: EMPTY_QUEUED_TURNS,
  modelSelectionByProvider: EMPTY_MODEL_SELECTION_BY_PROVIDER,
  activeProvider: null,
  runtimeMode: null,
  interactionMode: null,
});

export function createEmptyThreadDraft(): ComposerThreadDraftState {
  return {
    prompt: "",
    images: [],
    nonPersistedImageIds: [],
    persistedAttachments: [],
    assistantSelections: [],
    terminalContexts: [],
    queuedTurns: [],
    modelSelectionByProvider: {},
    activeProvider: null,
    runtimeMode: null,
    interactionMode: null,
  };
}

export function composerImageDedupKey(image: ComposerImageAttachment): string {
  // Keep this independent from File.lastModified so dedupe is stable for hydrated
  // images reconstructed from localStorage (which get a fresh lastModified value).
  return `${image.mimeType}\u0000${image.sizeBytes}\u0000${image.name}`;
}

export function terminalContextDedupKey(context: TerminalContextDraft): string {
  return `${context.terminalId}\u0000${context.lineStart}\u0000${context.lineEnd}`;
}

export function assistantSelectionDedupKey(
  selection: Pick<ComposerAssistantSelectionAttachment, "assistantMessageId" | "text">,
): string {
  return `${selection.assistantMessageId}\u0000${selection.text}`;
}

export function normalizeAssistantSelection(
  selection: Pick<ComposerAssistantSelectionAttachment, "id" | "assistantMessageId" | "text">,
): ComposerAssistantSelectionAttachment | null {
  const normalized = normalizeAssistantSelectionAttachment(selection);
  if (!normalized) {
    return null;
  }
  return {
    type: "assistant-selection",
    ...selection,
    assistantMessageId: normalized.assistantMessageId,
    text: normalized.text,
  };
}

export function normalizeAssistantSelections(
  selections: ReadonlyArray<
    Pick<ComposerAssistantSelectionAttachment, "id" | "assistantMessageId" | "text">
  >,
): ComposerAssistantSelectionAttachment[] {
  const normalizedSelections: ComposerAssistantSelectionAttachment[] = [];
  const existingIds = new Set<string>();
  const existingDedupKeys = new Set<string>();

  for (const selection of selections) {
    const normalizedSelection = normalizeAssistantSelection(selection);
    if (!normalizedSelection) {
      continue;
    }
    const dedupKey = assistantSelectionDedupKey(normalizedSelection);
    if (existingIds.has(normalizedSelection.id) || existingDedupKeys.has(dedupKey)) {
      continue;
    }
    normalizedSelections.push(normalizedSelection);
    existingIds.add(normalizedSelection.id);
    existingDedupKeys.add(dedupKey);
  }

  return normalizedSelections;
}

export function normalizeTerminalContextForThread(
  threadId: ThreadId,
  context: TerminalContextDraft,
): TerminalContextDraft | null {
  const terminalId = context.terminalId.trim();
  const terminalLabel = context.terminalLabel.trim();
  if (terminalId.length === 0 || terminalLabel.length === 0) {
    return null;
  }
  const lineStart = Math.max(1, Math.floor(context.lineStart));
  const lineEnd = Math.max(lineStart, Math.floor(context.lineEnd));
  return {
    ...context,
    threadId,
    terminalId,
    terminalLabel,
    lineStart,
    lineEnd,
    text: normalizeTerminalContextText(context.text),
  };
}

export function normalizeTerminalContextsForThread(
  threadId: ThreadId,
  contexts: ReadonlyArray<TerminalContextDraft>,
): TerminalContextDraft[] {
  const existingIds = new Set<string>();
  const existingDedupKeys = new Set<string>();
  const normalizedContexts: TerminalContextDraft[] = [];

  for (const context of contexts) {
    const normalizedContext = normalizeTerminalContextForThread(threadId, context);
    if (!normalizedContext) {
      continue;
    }
    const dedupKey = terminalContextDedupKey(normalizedContext);
    if (existingIds.has(normalizedContext.id) || existingDedupKeys.has(dedupKey)) {
      continue;
    }
    normalizedContexts.push(normalizedContext);
    existingIds.add(normalizedContext.id);
    existingDedupKeys.add(dedupKey);
  }

  return normalizedContexts;
}

export function buildTransferredComposerDraft(input: {
  sourceDraft: ComposerThreadDraftState;
  targetDraft: ComposerThreadDraftState | undefined;
  targetThreadId: ThreadId;
}): ComposerThreadDraftState {
  const { sourceDraft, targetDraft, targetThreadId } = input;
  const base = targetDraft ?? createEmptyThreadDraft();
  return {
    ...base,
    prompt: sourceDraft.prompt,
    assistantSelections: normalizeAssistantSelections(sourceDraft.assistantSelections),
    terminalContexts: normalizeTerminalContextsForThread(
      targetThreadId,
      sourceDraft.terminalContexts,
    ),
  };
}

/**
 * Writes a draft entry, dropping the entry entirely when the draft has no
 * content left so empty drafts never accumulate in the persisted map.
 */
export function writeDraftEntry(
  draftsByThreadId: Record<ThreadId, ComposerThreadDraftState>,
  threadId: ThreadId,
  draft: ComposerThreadDraftState,
): Record<ThreadId, ComposerThreadDraftState> {
  const next = { ...draftsByThreadId };
  if (shouldRemoveDraft(draft)) {
    delete next[threadId];
  } else {
    next[threadId] = draft;
  }
  return next;
}

export function shouldRemoveDraft(draft: ComposerThreadDraftState): boolean {
  return (
    draft.prompt.length === 0 &&
    draft.images.length === 0 &&
    draft.persistedAttachments.length === 0 &&
    draft.assistantSelections.length === 0 &&
    draft.terminalContexts.length === 0 &&
    draft.queuedTurns.length === 0 &&
    Object.keys(draft.modelSelectionByProvider).length === 0 &&
    draft.activeProvider === null &&
    draft.runtimeMode === null &&
    draft.interactionMode === null
  );
}
