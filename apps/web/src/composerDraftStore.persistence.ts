// FILE: composerDraftStore.persistence.ts
// Purpose: Persisted-value validation, migration and hydration for composer drafts.
// Layer: Web state store

// Depends on: contracts schemas, app model resolution helpers, and zustand persistence.

import { createDebouncedStorage, createMemoryStorage } from "./lib/storage";
import {
  ModelSelection,
  OrchestrationThreadPullRequest,
  ProjectId,
  ProviderMentionReference,
  ProviderInteractionMode,
  ProviderKind,
  ProviderSkillReference,
  ProviderStartOptions,
  ThreadId,
} from "@peakcode/contracts";
import * as Schema from "effect/Schema";
import { DeepMutable } from "effect/Types";

import { getLocalStorageItem } from "./hooks/useLocalStorage";

import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE, type ThreadPrimarySurface } from "./types";
import {
  ensureInlineTerminalContextPlaceholders,
  normalizeTerminalContextText,
} from "./lib/terminalContext";

import {
  COMPOSER_DRAFT_STORAGE_KEY,
  COMPOSER_DRAFT_STORAGE_VERSION,
  COMPOSER_PERSIST_DEBOUNCE_MS,
  ComposerImageAttachment,
  DraftThreadEnvMode,
  LegacyPersistedComposerDraftStoreState,
  LegacyPersistedComposerThreadDraftState,
  PersistedComposerDraftStoreState,
  PersistedComposerDraftStoreStorage,
  PersistedComposerImageAttachment,
  PersistedComposerThreadDraftState,
  PersistedDraftThreadState,
  PersistedQueuedComposerTurn,
  PersistedQueuedTerminalContextDraft,
  PersistedTerminalContextDraft,
  QueuedComposerTurn,
} from "./composerDraftStore.schemas";
import { ComposerDraftStoreState, ComposerThreadDraftState } from "./composerDraftStore.types";
import {
  legacyMergeModelSelectionIntoProviderModelOptions,
  legacySyncModelSelectionOptions,
  legacyToModelSelectionByProvider,
  normalizeModelSelection,
  normalizeProviderKind,
  normalizeProviderModelOptions,
} from "./composerDraftStore.modelSelection";
import {
  normalizeAssistantSelections,
  normalizePluginMentions,
  normalizeTerminalContextsForThread,
  projectDraftThreadEntryPointFromKey,
  projectIdFromDraftThreadMappingKey,
  shouldRemoveDraft,
} from "./composerDraftStore.draft";

export const composerDebouncedStorage = createDebouncedStorage(
  typeof localStorage !== "undefined" ? localStorage : createMemoryStorage(),
  COMPOSER_PERSIST_DEBOUNCE_MS,
);

// Flush pending composer draft writes before page unload to prevent data loss.
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    composerDebouncedStorage.flush();
  });
}

export const EMPTY_PERSISTED_DRAFT_STORE_STATE = Object.freeze<PersistedComposerDraftStoreState>({
  draftsByThreadId: {},
  draftThreadsByThreadId: {},
  projectDraftThreadIdByProjectId: {},
  stickyModelSelectionByProvider: {},
  stickyActiveProvider: null,
});

export function revokeObjectPreviewUrl(previewUrl: string): void {
  if (typeof URL === "undefined") {
    return;
  }
  if (!previewUrl.startsWith("blob:")) {
    return;
  }
  URL.revokeObjectURL(previewUrl);
}

export function revokeQueuedTurnPreviewUrls(queuedTurn: QueuedComposerTurn): void {
  if (queuedTurn.kind !== "chat") {
    return;
  }
  for (const image of queuedTurn.images) {
    revokeObjectPreviewUrl(image.previewUrl);
  }
}

// Release any preview URLs still owned by this draft before we drop it from the store.
export function revokeDraftPreviewUrls(draft: ComposerThreadDraftState | undefined): void {
  if (!draft) {
    return;
  }
  for (const image of draft.images) {
    revokeObjectPreviewUrl(image.previewUrl);
  }
  for (const queuedTurn of draft.queuedTurns) {
    revokeQueuedTurnPreviewUrls(queuedTurn);
  }
}

export function normalizePersistedAttachment(
  value: unknown,
): PersistedComposerImageAttachment | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const id = candidate.id;
  const name = candidate.name;
  const mimeType = candidate.mimeType;
  const sizeBytes = candidate.sizeBytes;
  const dataUrl = candidate.dataUrl;
  if (
    typeof id !== "string" ||
    typeof name !== "string" ||
    typeof mimeType !== "string" ||
    typeof sizeBytes !== "number" ||
    !Number.isFinite(sizeBytes) ||
    typeof dataUrl !== "string" ||
    id.length === 0 ||
    dataUrl.length === 0
  ) {
    return null;
  }
  return {
    id,
    name,
    mimeType,
    sizeBytes,
    dataUrl,
  };
}

export function normalizePersistedTerminalContextDraft(
  value: unknown,
): PersistedTerminalContextDraft | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const id = candidate.id;
  const threadId = candidate.threadId;
  const createdAt = candidate.createdAt;
  const lineStart = candidate.lineStart;
  const lineEnd = candidate.lineEnd;
  if (
    typeof id !== "string" ||
    id.length === 0 ||
    typeof threadId !== "string" ||
    threadId.length === 0 ||
    typeof createdAt !== "string" ||
    createdAt.length === 0 ||
    typeof lineStart !== "number" ||
    !Number.isFinite(lineStart) ||
    typeof lineEnd !== "number" ||
    !Number.isFinite(lineEnd)
  ) {
    return null;
  }
  const terminalId = typeof candidate.terminalId === "string" ? candidate.terminalId.trim() : "";
  const terminalLabel =
    typeof candidate.terminalLabel === "string" ? candidate.terminalLabel.trim() : "";
  if (terminalId.length === 0 || terminalLabel.length === 0) {
    return null;
  }
  const normalizedLineStart = Math.max(1, Math.floor(lineStart));
  const normalizedLineEnd = Math.max(normalizedLineStart, Math.floor(lineEnd));
  return {
    id,
    threadId: threadId as ThreadId,
    createdAt,
    terminalId,
    terminalLabel,
    lineStart: normalizedLineStart,
    lineEnd: normalizedLineEnd,
  };
}

export function normalizePersistedQueuedTerminalContextDraft(
  value: unknown,
): PersistedQueuedTerminalContextDraft | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const base = normalizePersistedTerminalContextDraft(candidate);
  if (!base) {
    return null;
  }
  const text =
    typeof candidate.text === "string" ? normalizeTerminalContextText(candidate.text) : "";
  return {
    ...base,
    text,
  };
}

export function persistImageAttachmentFromDataUrl(input: {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  dataUrl: string;
}): PersistedComposerImageAttachment | null {
  return normalizePersistedAttachment(input);
}

export function persistQueuedComposerImages(
  images: ReadonlyArray<ComposerImageAttachment>,
): PersistedComposerImageAttachment[] {
  return images.flatMap((image) => {
    if (!image.previewUrl.startsWith("data:")) {
      return [];
    }
    const normalized = persistImageAttachmentFromDataUrl({
      id: image.id,
      name: image.name,
      mimeType: image.mimeType,
      sizeBytes: image.sizeBytes,
      dataUrl: image.previewUrl,
    });
    return normalized ? [normalized] : [];
  });
}

export function normalizePersistedQueuedTurns(
  rawQueuedTurns: unknown,
): DeepMutable<NonNullable<PersistedComposerThreadDraftState["queuedTurns"]>> | undefined {
  if (!Array.isArray(rawQueuedTurns)) {
    return undefined;
  }
  const normalizedTurns: DeepMutable<
    NonNullable<PersistedComposerThreadDraftState["queuedTurns"]>
  > = [];
  const seenIds = new Set<string>();
  for (const entry of rawQueuedTurns) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const candidate = entry as Record<string, unknown>;
    const id = typeof candidate.id === "string" ? candidate.id : "";
    const kind = candidate.kind;
    const createdAt = typeof candidate.createdAt === "string" ? candidate.createdAt : "";
    const previewText = typeof candidate.previewText === "string" ? candidate.previewText : "";
    const selectedProvider = normalizeProviderKind(candidate.selectedProvider);
    const selectedModel =
      candidate.selectedModel === null
        ? null
        : typeof candidate.selectedModel === "string"
          ? candidate.selectedModel
          : null;
    const selectedPromptEffort =
      candidate.selectedPromptEffort === null
        ? null
        : typeof candidate.selectedPromptEffort === "string"
          ? candidate.selectedPromptEffort
          : null;
    const modelSelection = normalizeModelSelection(candidate.modelSelection);
    const providerOptionsForDispatch = Schema.is(ProviderStartOptions)(
      candidate.providerOptionsForDispatch,
    )
      ? candidate.providerOptionsForDispatch
      : undefined;
    const runtimeMode =
      candidate.runtimeMode === "approval-required" || candidate.runtimeMode === "full-access"
        ? candidate.runtimeMode
        : null;
    if (
      id.length === 0 ||
      createdAt.length === 0 ||
      previewText.length === 0 ||
      selectedProvider === null ||
      modelSelection === null ||
      runtimeMode === null ||
      seenIds.has(id)
    ) {
      continue;
    }
    if (kind === "chat") {
      const prompt = typeof candidate.prompt === "string" ? candidate.prompt : "";
      const images = Array.isArray(candidate.images)
        ? candidate.images.flatMap((image) => {
            const normalized = normalizePersistedAttachment(image);
            return normalized ? [normalized] : [];
          })
        : [];
      const terminalContexts = Array.isArray(candidate.terminalContexts)
        ? candidate.terminalContexts.flatMap((context) => {
            const normalized = normalizePersistedQueuedTerminalContextDraft(context);
            return normalized ? [normalized] : [];
          })
        : [];
      const skills = Array.isArray(candidate.skills)
        ? candidate.skills.filter(Schema.is(ProviderSkillReference))
        : [];
      const mentions = Array.isArray(candidate.mentions)
        ? candidate.mentions.filter(Schema.is(ProviderMentionReference))
        : [];
      const plugins = Array.isArray(candidate.plugins)
        ? candidate.plugins.filter(Schema.is(ProviderMentionReference))
        : [];
      const interactionMode = Schema.is(ProviderInteractionMode)(candidate.interactionMode)
        ? candidate.interactionMode
        : null;
      const envMode =
        candidate.envMode === "local" || candidate.envMode === "worktree"
          ? candidate.envMode
          : null;
      if (interactionMode === null || envMode === null) {
        continue;
      }
      normalizedTurns.push({
        id,
        kind: "chat",
        createdAt,
        previewText,
        prompt,
        images,
        terminalContexts,
        skills: [...skills],
        mentions: [...mentions],
        plugins: [...plugins],
        selectedProvider,
        selectedModel,
        selectedPromptEffort,
        modelSelection,
        ...(providerOptionsForDispatch ? { providerOptionsForDispatch } : {}),
        runtimeMode,
        interactionMode,
        envMode,
      });
      seenIds.add(id);
      continue;
    }
    if (kind === "plan-follow-up") {
      const text = typeof candidate.text === "string" ? candidate.text : "";
      const interactionMode = Schema.is(ProviderInteractionMode)(candidate.interactionMode)
        ? candidate.interactionMode
        : null;
      if (interactionMode === null) {
        continue;
      }
      normalizedTurns.push({
        id,
        kind: "plan-follow-up",
        createdAt,
        previewText,
        text,
        interactionMode,
        selectedProvider,
        selectedModel,
        selectedPromptEffort,
        modelSelection,
        ...(providerOptionsForDispatch ? { providerOptionsForDispatch } : {}),
        runtimeMode,
      });
      seenIds.add(id);
    }
  }
  return normalizedTurns.length > 0 ? normalizedTurns : undefined;
}

export function normalizeDraftThreadEnvMode(
  value: unknown,
  fallbackWorktreePath: string | null,
): DraftThreadEnvMode {
  if (value === "local" || value === "worktree") {
    return value;
  }
  return fallbackWorktreePath ? "worktree" : "local";
}

export function normalizeDraftThreadEntryPoint(
  value: unknown,
  fallback: ThreadPrimarySurface = "chat",
) {
  return value === "terminal" || value === "chat" ? value : fallback;
}

export function normalizePersistedDraftThreads(
  rawDraftThreadsByThreadId: unknown,
  rawProjectDraftThreadIdByProjectId: unknown,
): Pick<
  PersistedComposerDraftStoreState,
  "draftThreadsByThreadId" | "projectDraftThreadIdByProjectId"
> {
  const draftThreadsByThreadId: Record<ThreadId, PersistedDraftThreadState> = {};
  if (rawDraftThreadsByThreadId && typeof rawDraftThreadsByThreadId === "object") {
    for (const [threadId, rawDraftThread] of Object.entries(
      rawDraftThreadsByThreadId as Record<string, unknown>,
    )) {
      if (typeof threadId !== "string" || threadId.length === 0) {
        continue;
      }
      if (!rawDraftThread || typeof rawDraftThread !== "object") {
        continue;
      }
      const candidateDraftThread = rawDraftThread as Record<string, unknown>;
      const projectId = candidateDraftThread.projectId;
      const createdAt = candidateDraftThread.createdAt;
      const branch = candidateDraftThread.branch;
      const worktreePath = candidateDraftThread.worktreePath;
      let lastKnownPr: OrchestrationThreadPullRequest | null = null;
      if (
        candidateDraftThread.lastKnownPr &&
        typeof candidateDraftThread.lastKnownPr === "object"
      ) {
        try {
          lastKnownPr = Schema.decodeUnknownSync(OrchestrationThreadPullRequest)(
            candidateDraftThread.lastKnownPr,
          );
        } catch {
          lastKnownPr = null;
        }
      }
      const normalizedWorktreePath = typeof worktreePath === "string" ? worktreePath : null;
      const isTemporary = candidateDraftThread.isTemporary === true ? true : undefined;
      const promotedTo =
        typeof candidateDraftThread.promotedTo === "string" &&
        candidateDraftThread.promotedTo.length > 0
          ? (candidateDraftThread.promotedTo as ThreadId)
          : undefined;
      if (typeof projectId !== "string" || projectId.length === 0) {
        continue;
      }
      draftThreadsByThreadId[threadId as ThreadId] = {
        projectId: projectId as ProjectId,
        createdAt:
          typeof createdAt === "string" && createdAt.length > 0
            ? createdAt
            : new Date().toISOString(),
        runtimeMode:
          candidateDraftThread.runtimeMode === "approval-required" ||
          candidateDraftThread.runtimeMode === "full-access"
            ? candidateDraftThread.runtimeMode
            : DEFAULT_RUNTIME_MODE,
        interactionMode:
          candidateDraftThread.interactionMode === "plan" ||
          candidateDraftThread.interactionMode === "goal" ||
          candidateDraftThread.interactionMode === "default"
            ? candidateDraftThread.interactionMode
            : DEFAULT_INTERACTION_MODE,
        entryPoint: normalizeDraftThreadEntryPoint(candidateDraftThread.entryPoint),
        branch: typeof branch === "string" ? branch : null,
        worktreePath: normalizedWorktreePath,
        ...(lastKnownPr ? { lastKnownPr } : {}),
        envMode: normalizeDraftThreadEnvMode(candidateDraftThread.envMode, normalizedWorktreePath),
        ...(isTemporary ? { isTemporary: true } : {}),
        ...(promotedTo ? { promotedTo } : {}),
      };
    }
  }

  const projectDraftThreadIdByProjectId: Record<string, ThreadId> = {};
  if (
    rawProjectDraftThreadIdByProjectId &&
    typeof rawProjectDraftThreadIdByProjectId === "object"
  ) {
    for (const [mappingKey, threadId] of Object.entries(
      rawProjectDraftThreadIdByProjectId as Record<string, unknown>,
    )) {
      const projectId = projectIdFromDraftThreadMappingKey(mappingKey);
      const entryPoint = projectDraftThreadEntryPointFromKey(mappingKey);
      if (
        typeof projectId === "string" &&
        projectId.length > 0 &&
        typeof threadId === "string" &&
        threadId.length > 0
      ) {
        projectDraftThreadIdByProjectId[mappingKey] = threadId as ThreadId;
        if (!draftThreadsByThreadId[threadId as ThreadId]) {
          draftThreadsByThreadId[threadId as ThreadId] = {
            projectId: projectId as ProjectId,
            createdAt: new Date().toISOString(),
            runtimeMode: DEFAULT_RUNTIME_MODE,
            interactionMode: DEFAULT_INTERACTION_MODE,
            entryPoint,
            branch: null,
            worktreePath: null,
            envMode: "local",
          };
        } else if (draftThreadsByThreadId[threadId as ThreadId]?.projectId !== projectId) {
          draftThreadsByThreadId[threadId as ThreadId] = {
            ...draftThreadsByThreadId[threadId as ThreadId]!,
            projectId: projectId as ProjectId,
          };
        } else if (draftThreadsByThreadId[threadId as ThreadId]?.entryPoint !== entryPoint) {
          draftThreadsByThreadId[threadId as ThreadId] = {
            ...draftThreadsByThreadId[threadId as ThreadId]!,
            entryPoint,
          };
        }
      }
    }
  }

  return { draftThreadsByThreadId, projectDraftThreadIdByProjectId };
}

export function normalizePersistedDraftsByThreadId(
  rawDraftMap: unknown,
): PersistedComposerDraftStoreState["draftsByThreadId"] {
  if (!rawDraftMap || typeof rawDraftMap !== "object") {
    return {};
  }

  const nextDraftsByThreadId: DeepMutable<PersistedComposerDraftStoreState["draftsByThreadId"]> =
    {};
  for (const [threadId, draftValue] of Object.entries(rawDraftMap as Record<string, unknown>)) {
    if (typeof threadId !== "string" || threadId.length === 0) {
      continue;
    }
    if (!draftValue || typeof draftValue !== "object") {
      continue;
    }
    const draftCandidate = draftValue as PersistedComposerThreadDraftState;
    const promptCandidate = typeof draftCandidate.prompt === "string" ? draftCandidate.prompt : "";
    const attachments = Array.isArray(draftCandidate.attachments)
      ? draftCandidate.attachments.flatMap((entry) => {
          const normalized = normalizePersistedAttachment(entry);
          return normalized ? [normalized] : [];
        })
      : [];
    const terminalContexts = Array.isArray(draftCandidate.terminalContexts)
      ? draftCandidate.terminalContexts.flatMap((entry) => {
          const normalized = normalizePersistedTerminalContextDraft(entry);
          return normalized ? [normalized] : [];
        })
      : [];
    const queuedTurns = normalizePersistedQueuedTurns(draftCandidate.queuedTurns);
    const plugins = Array.isArray(draftCandidate.plugins)
      ? normalizePluginMentions(draftCandidate.plugins.filter(Schema.is(ProviderMentionReference)))
      : [];
    const runtimeMode =
      draftCandidate.runtimeMode === "approval-required" ||
      draftCandidate.runtimeMode === "full-access"
        ? draftCandidate.runtimeMode
        : null;
    const interactionMode = Schema.is(ProviderInteractionMode)(draftCandidate.interactionMode)
      ? draftCandidate.interactionMode
      : null;
    const prompt = ensureInlineTerminalContextPlaceholders(
      promptCandidate,
      terminalContexts.length,
    );
    // If the draft already has the v3 shape, use it directly
    const legacyDraftCandidate = draftValue as LegacyPersistedComposerThreadDraftState;
    let modelSelectionByProvider: Partial<Record<ProviderKind, ModelSelection>> = {};
    let activeProvider: ProviderKind | null = null;

    if (
      draftCandidate.modelSelectionByProvider &&
      typeof draftCandidate.modelSelectionByProvider === "object"
    ) {
      // v3 format
      modelSelectionByProvider = draftCandidate.modelSelectionByProvider as Partial<
        Record<ProviderKind, ModelSelection>
      >;
      activeProvider = normalizeProviderKind(draftCandidate.activeProvider);
    } else {
      // v2 or legacy format: migrate
      const normalizedModelOptions =
        normalizeProviderModelOptions(
          legacyDraftCandidate.modelOptions,
          undefined,
          legacyDraftCandidate,
        ) ?? null;
      const normalizedModelSelection = normalizeModelSelection(
        legacyDraftCandidate.modelSelection,
        {
          provider: legacyDraftCandidate.provider,
          model: legacyDraftCandidate.model,
          modelOptions: normalizedModelOptions ?? legacyDraftCandidate.modelOptions,
          legacyCodex: legacyDraftCandidate,
        },
      );
      const mergedModelOptions = legacyMergeModelSelectionIntoProviderModelOptions(
        normalizedModelSelection,
        normalizedModelOptions,
      );
      const modelSelection = legacySyncModelSelectionOptions(
        normalizedModelSelection,
        mergedModelOptions,
      );
      modelSelectionByProvider = legacyToModelSelectionByProvider(
        modelSelection,
        mergedModelOptions,
      );
      activeProvider = modelSelection?.provider ?? null;
    }

    const normalizedQueuedTurns = queuedTurns ?? [];
    const hasModelData =
      Object.keys(modelSelectionByProvider).length > 0 || activeProvider !== null;
    const hasQueuedTurns = normalizedQueuedTurns.length > 0;
    if (
      promptCandidate.length === 0 &&
      attachments.length === 0 &&
      terminalContexts.length === 0 &&
      plugins.length === 0 &&
      !hasQueuedTurns &&
      !hasModelData &&
      !runtimeMode &&
      !interactionMode
    ) {
      continue;
    }
    nextDraftsByThreadId[threadId as ThreadId] = {
      prompt,
      attachments,
      ...(terminalContexts.length > 0 ? { terminalContexts } : {}),
      ...(plugins.length > 0 ? { plugins } : {}),
      ...(hasQueuedTurns ? { queuedTurns: normalizedQueuedTurns } : {}),
      ...(hasModelData ? { modelSelectionByProvider, activeProvider } : {}),
      ...(runtimeMode ? { runtimeMode } : {}),
      ...(interactionMode ? { interactionMode } : {}),
    };
  }

  return nextDraftsByThreadId;
}

export function migratePersistedComposerDraftStoreState(
  persistedState: unknown,
): PersistedComposerDraftStoreState {
  if (!persistedState || typeof persistedState !== "object") {
    return EMPTY_PERSISTED_DRAFT_STORE_STATE;
  }
  const candidate = persistedState as LegacyPersistedComposerDraftStoreState;
  const rawDraftMap = candidate.draftsByThreadId;
  const rawDraftThreadsByThreadId = candidate.draftThreadsByThreadId;
  const rawProjectDraftThreadIdByProjectId = candidate.projectDraftThreadIdByProjectId;

  // Migrate sticky state from v2 (dual) to v3 (consolidated)
  const stickyModelOptions = normalizeProviderModelOptions(candidate.stickyModelOptions) ?? {};
  const normalizedStickyModelSelection = normalizeModelSelection(candidate.stickyModelSelection, {
    provider: candidate.stickyProvider ?? "pi",
    model: candidate.stickyModel,
    modelOptions: stickyModelOptions,
  });
  const nextStickyModelOptions = legacyMergeModelSelectionIntoProviderModelOptions(
    normalizedStickyModelSelection,
    stickyModelOptions,
  );
  const stickyModelSelection = legacySyncModelSelectionOptions(
    normalizedStickyModelSelection,
    nextStickyModelOptions,
  );
  const stickyModelSelectionByProvider = legacyToModelSelectionByProvider(
    stickyModelSelection,
    nextStickyModelOptions,
  );
  const stickyActiveProvider = normalizeProviderKind(candidate.stickyProvider) ?? null;

  const { draftThreadsByThreadId, projectDraftThreadIdByProjectId } =
    normalizePersistedDraftThreads(rawDraftThreadsByThreadId, rawProjectDraftThreadIdByProjectId);
  const draftsByThreadId = normalizePersistedDraftsByThreadId(rawDraftMap);
  return {
    draftsByThreadId,
    draftThreadsByThreadId,
    projectDraftThreadIdByProjectId,
    stickyModelSelectionByProvider,
    stickyActiveProvider,
  };
}

export function partializeComposerDraftStoreState(
  state: ComposerDraftStoreState,
): PersistedComposerDraftStoreState {
  const persistedDraftsByThreadId: DeepMutable<
    PersistedComposerDraftStoreState["draftsByThreadId"]
  > = {};
  for (const [threadId, draft] of Object.entries(state.draftsByThreadId)) {
    if (typeof threadId !== "string" || threadId.length === 0) {
      continue;
    }
    const persistedQueuedTurns: DeepMutable<
      NonNullable<PersistedComposerThreadDraftState["queuedTurns"]>
    > = [];
    for (const queuedTurn of draft.queuedTurns) {
      if (queuedTurn.kind === "chat") {
        const images = persistQueuedComposerImages(queuedTurn.images);
        if (images.length !== queuedTurn.images.length) {
          continue;
        }
        persistedQueuedTurns.push({
          id: queuedTurn.id,
          kind: "chat",
          createdAt: queuedTurn.createdAt,
          previewText: queuedTurn.previewText,
          prompt: queuedTurn.prompt,
          images,
          assistantSelections: queuedTurn.assistantSelections.map((selection) => ({
            id: selection.id,
            assistantMessageId: selection.assistantMessageId,
            text: selection.text,
          })),
          terminalContexts: queuedTurn.terminalContexts.map((context) => ({
            id: context.id,
            threadId: context.threadId,
            createdAt: context.createdAt,
            terminalId: context.terminalId,
            terminalLabel: context.terminalLabel,
            lineStart: context.lineStart,
            lineEnd: context.lineEnd,
            text: context.text,
          })),
          skills: [...queuedTurn.skills],
          mentions: [...queuedTurn.mentions],
          plugins: [...queuedTurn.plugins],
          selectedProvider: queuedTurn.selectedProvider,
          selectedModel: queuedTurn.selectedModel,
          selectedPromptEffort: queuedTurn.selectedPromptEffort,
          modelSelection: queuedTurn.modelSelection,
          ...(queuedTurn.providerOptionsForDispatch
            ? { providerOptionsForDispatch: queuedTurn.providerOptionsForDispatch }
            : {}),
          runtimeMode: queuedTurn.runtimeMode,
          interactionMode: queuedTurn.interactionMode,
          envMode: queuedTurn.envMode,
        });
        continue;
      }
      persistedQueuedTurns.push({
        id: queuedTurn.id,
        kind: "plan-follow-up",
        createdAt: queuedTurn.createdAt,
        previewText: queuedTurn.previewText,
        text: queuedTurn.text,
        interactionMode: queuedTurn.interactionMode,
        selectedProvider: queuedTurn.selectedProvider,
        selectedModel: queuedTurn.selectedModel,
        selectedPromptEffort: queuedTurn.selectedPromptEffort,
        modelSelection: queuedTurn.modelSelection,
        ...(queuedTurn.providerOptionsForDispatch
          ? { providerOptionsForDispatch: queuedTurn.providerOptionsForDispatch }
          : {}),
        runtimeMode: queuedTurn.runtimeMode,
      });
    }
    const hasModelData =
      Object.keys(draft.modelSelectionByProvider).length > 0 || draft.activeProvider !== null;
    const hasQueuedTurns = persistedQueuedTurns.length > 0;
    if (
      draft.prompt.length === 0 &&
      draft.persistedAttachments.length === 0 &&
      draft.assistantSelections.length === 0 &&
      draft.plugins.length === 0 &&
      draft.terminalContexts.length === 0 &&
      !hasQueuedTurns &&
      !hasModelData &&
      draft.runtimeMode === null &&
      draft.interactionMode === null
    ) {
      continue;
    }
    const persistedDraft: DeepMutable<PersistedComposerThreadDraftState> = {
      prompt: draft.prompt,
      attachments: draft.persistedAttachments,
      ...(draft.assistantSelections.length > 0
        ? {
            assistantSelections: draft.assistantSelections.map((selection) => ({
              id: selection.id,
              assistantMessageId: selection.assistantMessageId,
              text: selection.text,
            })),
          }
        : {}),
      ...(draft.terminalContexts.length > 0
        ? {
            terminalContexts: draft.terminalContexts.map((context) => ({
              id: context.id,
              threadId: context.threadId,
              createdAt: context.createdAt,
              terminalId: context.terminalId,
              terminalLabel: context.terminalLabel,
              lineStart: context.lineStart,
              lineEnd: context.lineEnd,
            })),
          }
        : {}),
      ...(draft.plugins.length > 0 ? { plugins: [...draft.plugins] } : {}),
      ...(hasQueuedTurns ? { queuedTurns: persistedQueuedTurns } : {}),
      ...(hasModelData
        ? {
            modelSelectionByProvider: draft.modelSelectionByProvider,
            activeProvider: draft.activeProvider,
          }
        : {}),
      ...(draft.runtimeMode ? { runtimeMode: draft.runtimeMode } : {}),
      ...(draft.interactionMode ? { interactionMode: draft.interactionMode } : {}),
    };
    persistedDraftsByThreadId[threadId as ThreadId] = persistedDraft;
  }
  return {
    draftsByThreadId: persistedDraftsByThreadId,
    draftThreadsByThreadId: state.draftThreadsByThreadId,
    projectDraftThreadIdByProjectId: state.projectDraftThreadIdByProjectId,
    stickyModelSelectionByProvider: state.stickyModelSelectionByProvider,
    stickyActiveProvider: state.stickyActiveProvider,
  };
}

export function normalizeCurrentPersistedComposerDraftStoreState(
  persistedState: unknown,
): PersistedComposerDraftStoreState {
  if (!persistedState || typeof persistedState !== "object") {
    return EMPTY_PERSISTED_DRAFT_STORE_STATE;
  }
  const normalizedPersistedState = persistedState as LegacyPersistedComposerDraftStoreState;
  const { draftThreadsByThreadId, projectDraftThreadIdByProjectId } =
    normalizePersistedDraftThreads(
      normalizedPersistedState.draftThreadsByThreadId,
      normalizedPersistedState.projectDraftThreadIdByProjectId,
    );

  // Handle both v3 (modelSelectionByProvider) and v2/legacy formats
  let stickyModelSelectionByProvider: Partial<Record<ProviderKind, ModelSelection>> = {};
  let stickyActiveProvider: ProviderKind | null = null;
  if (
    normalizedPersistedState.stickyModelSelectionByProvider &&
    typeof normalizedPersistedState.stickyModelSelectionByProvider === "object"
  ) {
    stickyModelSelectionByProvider =
      normalizedPersistedState.stickyModelSelectionByProvider as Partial<
        Record<ProviderKind, ModelSelection>
      >;
    stickyActiveProvider = normalizeProviderKind(normalizedPersistedState.stickyActiveProvider);
  } else {
    // Legacy migration path
    const stickyModelOptions =
      normalizeProviderModelOptions(normalizedPersistedState.stickyModelOptions) ?? {};
    const normalizedStickyModelSelection = normalizeModelSelection(
      normalizedPersistedState.stickyModelSelection,
      {
        provider: normalizedPersistedState.stickyProvider,
        model: normalizedPersistedState.stickyModel,
        modelOptions: stickyModelOptions,
      },
    );
    const nextStickyModelOptions = legacyMergeModelSelectionIntoProviderModelOptions(
      normalizedStickyModelSelection,
      stickyModelOptions,
    );
    const stickyModelSelection = legacySyncModelSelectionOptions(
      normalizedStickyModelSelection,
      nextStickyModelOptions,
    );
    stickyModelSelectionByProvider = legacyToModelSelectionByProvider(
      stickyModelSelection,
      nextStickyModelOptions,
    );
    stickyActiveProvider = normalizeProviderKind(normalizedPersistedState.stickyProvider);
  }

  return {
    draftsByThreadId: normalizePersistedDraftsByThreadId(normalizedPersistedState.draftsByThreadId),
    draftThreadsByThreadId,
    projectDraftThreadIdByProjectId,
    stickyModelSelectionByProvider,
    stickyActiveProvider,
  };
}

export function readPersistedAttachmentIdsFromStorage(threadId: ThreadId): string[] {
  if (threadId.length === 0) {
    return [];
  }
  try {
    const persisted = getLocalStorageItem(
      COMPOSER_DRAFT_STORAGE_KEY,
      PersistedComposerDraftStoreStorage,
    );
    if (!persisted || persisted.version !== COMPOSER_DRAFT_STORAGE_VERSION) {
      return [];
    }
    return (persisted.state.draftsByThreadId[threadId]?.attachments ?? []).map(
      (attachment) => attachment.id,
    );
  } catch {
    return [];
  }
}

export function verifyPersistedAttachments(
  threadId: ThreadId,
  attachments: PersistedComposerImageAttachment[],
  set: (
    partial:
      | ComposerDraftStoreState
      | Partial<ComposerDraftStoreState>
      | ((
          state: ComposerDraftStoreState,
        ) => ComposerDraftStoreState | Partial<ComposerDraftStoreState>),
    replace?: false,
  ) => void,
): void {
  let persistedIdSet = new Set<string>();
  try {
    composerDebouncedStorage.flush();
    persistedIdSet = new Set(readPersistedAttachmentIdsFromStorage(threadId));
  } catch {
    persistedIdSet = new Set();
  }
  set((state) => {
    const current = state.draftsByThreadId[threadId];
    if (!current) {
      return state;
    }
    const imageIdSet = new Set(current.images.map((image) => image.id));
    const persistedAttachments = attachments.filter(
      (attachment) => imageIdSet.has(attachment.id) && persistedIdSet.has(attachment.id),
    );
    const nonPersistedImageIds = current.images
      .map((image) => image.id)
      .filter((imageId) => !persistedIdSet.has(imageId));
    const nextDraft: ComposerThreadDraftState = {
      ...current,
      persistedAttachments,
      nonPersistedImageIds,
    };
    const nextDraftsByThreadId = { ...state.draftsByThreadId };
    if (shouldRemoveDraft(nextDraft)) {
      delete nextDraftsByThreadId[threadId];
    } else {
      nextDraftsByThreadId[threadId] = nextDraft;
    }
    return { draftsByThreadId: nextDraftsByThreadId };
  });
}

export function hydreatePersistedComposerImageAttachment(
  attachment: PersistedComposerImageAttachment,
): File | null {
  const commaIndex = attachment.dataUrl.indexOf(",");
  const header = commaIndex === -1 ? attachment.dataUrl : attachment.dataUrl.slice(0, commaIndex);
  const payload = commaIndex === -1 ? "" : attachment.dataUrl.slice(commaIndex + 1);
  if (payload.length === 0) {
    return null;
  }
  try {
    const isBase64 = header.includes(";base64");
    if (!isBase64) {
      const decodedText = decodeURIComponent(payload);
      const inferredMimeType =
        header.startsWith("data:") && header.includes(";")
          ? header.slice("data:".length, header.indexOf(";"))
          : attachment.mimeType;
      return new File([decodedText], attachment.name, {
        type: inferredMimeType || attachment.mimeType,
      });
    }
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new File([bytes], attachment.name, { type: attachment.mimeType });
  } catch {
    return null;
  }
}

export function hydrateImagesFromPersisted(
  attachments: ReadonlyArray<PersistedComposerImageAttachment>,
): ComposerImageAttachment[] {
  return attachments.flatMap((attachment) => {
    const file = hydreatePersistedComposerImageAttachment(attachment);
    if (!file) return [];

    return [
      {
        type: "image" as const,
        id: attachment.id,
        name: attachment.name,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        previewUrl: attachment.dataUrl,
        file,
      } satisfies ComposerImageAttachment,
    ];
  });
}

export function hydrateQueuedTurnsFromPersisted(
  threadId: ThreadId,
  queuedTurns: ReadonlyArray<PersistedQueuedComposerTurn> | undefined,
): QueuedComposerTurn[] {
  if (!queuedTurns || queuedTurns.length === 0) {
    return [];
  }
  return queuedTurns.map((queuedTurn) => {
    if (queuedTurn.kind === "chat") {
      return {
        ...queuedTurn,
        images: hydrateImagesFromPersisted(queuedTurn.images),
        assistantSelections: normalizeAssistantSelections(queuedTurn.assistantSelections ?? []),
        terminalContexts: normalizeTerminalContextsForThread(threadId, queuedTurn.terminalContexts),
        skills: [...queuedTurn.skills],
        mentions: [...queuedTurn.mentions],
        plugins: normalizePluginMentions(queuedTurn.plugins ?? []),
      };
    }
    return { ...queuedTurn };
  });
}

export function toHydratedThreadDraft(
  threadId: ThreadId,
  persistedDraft: PersistedComposerThreadDraftState,
): ComposerThreadDraftState {
  // The persisted draft is already in v3 shape (migration handles older formats)
  const modelSelectionByProvider: Partial<Record<ProviderKind, ModelSelection>> =
    persistedDraft.modelSelectionByProvider ?? {};
  const activeProvider = normalizeProviderKind(persistedDraft.activeProvider) ?? null;

  return {
    prompt: persistedDraft.prompt,
    images: hydrateImagesFromPersisted(persistedDraft.attachments),
    nonPersistedImageIds: [],
    persistedAttachments: [...persistedDraft.attachments],
    assistantSelections: normalizeAssistantSelections(persistedDraft.assistantSelections ?? []),
    plugins: normalizePluginMentions(persistedDraft.plugins ?? []),
    terminalContexts:
      persistedDraft.terminalContexts?.map((context) => ({
        ...context,
        text: "",
      })) ?? [],
    queuedTurns: hydrateQueuedTurnsFromPersisted(threadId, persistedDraft.queuedTurns),
    modelSelectionByProvider,
    activeProvider,
    runtimeMode: persistedDraft.runtimeMode ?? null,
    interactionMode: persistedDraft.interactionMode ?? null,
  };
}
