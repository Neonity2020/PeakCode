// FILE: composerDraftStore.ts
// Purpose: Stores composer drafts, model selections, queued turns, and sticky provider choices.
// Layer: Web state store
// Depends on: contracts schemas, app model resolution helpers, and zustand persistence.

import {
  ModelSelection,
  ProviderInteractionMode,
  ProviderKind,
  ThreadId,
} from "@peakcode/contracts";
import * as Schema from "effect/Schema";
import * as Equal from "effect/Equal";

import { getDefaultModel, normalizeModelSlug } from "@peakcode/shared/model";
import { useMemo } from "react";

import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE } from "./types";
import { ensureInlineTerminalContextPlaceholders } from "./lib/terminalContext";

import { buildModelSelection } from "./providerModelOptions";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import {
  COMPOSER_DRAFT_STORAGE_KEY,
  COMPOSER_DRAFT_STORAGE_VERSION,
  COMPOSER_PROVIDER_KINDS,
  ComposerImageAttachment,
} from "./composerDraftStore.schemas";
import {
  ComposerDraftStoreState,
  ComposerThreadDraftState,
  DraftThreadState,
  EffectiveComposerModelState,
} from "./composerDraftStore.types";
import {
  deriveEffectiveComposerModelState,
  makeModelSelection,
  normalizeModelSelection,
  normalizeProviderKind,
  normalizeProviderModelOptions,
} from "./composerDraftStore.modelSelection";
import {
  EMPTY_THREAD_DRAFT,
  assistantSelectionDedupKey,
  buildTransferredComposerDraft,
  composerImageDedupKey,
  createEmptyThreadDraft,
  normalizeAssistantSelection,
  normalizeTerminalContextForThread,
  normalizeTerminalContextsForThread,
  projectDraftThreadMappingKey,
  projectIdFromDraftThreadMappingKey,
  shouldRemoveDraft,
  writeDraftEntry,
  terminalContextDedupKey,
} from "./composerDraftStore.draft";
import {
  composerDebouncedStorage,
  migratePersistedComposerDraftStoreState,
  normalizeCurrentPersistedComposerDraftStoreState,
  normalizeDraftThreadEntryPoint,
  partializeComposerDraftStoreState,
  revokeDraftPreviewUrls,
  revokeObjectPreviewUrl,
  revokeQueuedTurnPreviewUrls,
  toHydratedThreadDraft,
  verifyPersistedAttachments,
} from "./composerDraftStore.persistence";

// Re-exported so existing consumers of this module keep their import path.
export {
  COMPOSER_DRAFT_STORAGE_KEY,
  type ComposerAssistantSelectionAttachment,
  type ComposerImageAttachment,
  type DraftThreadEnvMode,
  type PersistedComposerImageAttachment,
  type QueuedComposerChatTurn,
  type QueuedComposerPlanFollowUp,
  type QueuedComposerTurn,
} from "./composerDraftStore.schemas";
export {
  type ComposerDraftStoreState,
  type ComposerThreadDraftState,
  type DraftThreadState,
  type EffectiveComposerModelState,
} from "./composerDraftStore.types";
export {
  deriveEffectiveComposerModelState,
  resolvePreferredComposerModelSelection,
} from "./composerDraftStore.modelSelection";

export const useComposerDraftStore = create<ComposerDraftStoreState>()(
  persist(
    (set, get) => ({
      draftsByThreadId: {},
      draftThreadsByThreadId: {},
      projectDraftThreadIdByProjectId: {},
      stickyModelSelectionByProvider: {},
      stickyActiveProvider: null,
      getDraftThreadByProjectId: (projectId, entryPoint = "chat") => {
        if (projectId.length === 0) {
          return null;
        }
        const threadId =
          get().projectDraftThreadIdByProjectId[
            projectDraftThreadMappingKey(projectId, entryPoint)
          ];
        if (!threadId) {
          return null;
        }
        const draftThread = get().draftThreadsByThreadId[threadId];
        if (
          !draftThread ||
          draftThread.projectId !== projectId ||
          normalizeDraftThreadEntryPoint(draftThread.entryPoint) !== entryPoint ||
          draftThread.promotedTo !== undefined
        ) {
          return null;
        }
        return {
          threadId,
          ...draftThread,
        };
      },
      getDraftThread: (threadId) => {
        if (threadId.length === 0) {
          return null;
        }
        return get().draftThreadsByThreadId[threadId] ?? null;
      },
      setProjectDraftThreadId: (projectId, threadId, options) => {
        if (projectId.length === 0 || threadId.length === 0) {
          return;
        }
        set((state) => {
          const existingThread = state.draftThreadsByThreadId[threadId];
          const entryPoint = normalizeDraftThreadEntryPoint(
            options?.entryPoint,
            existingThread?.entryPoint ?? "chat",
          );
          const mappingKey = projectDraftThreadMappingKey(projectId, entryPoint);
          const previousThreadIdForProject = state.projectDraftThreadIdByProjectId[mappingKey];
          const nextWorktreePath =
            options?.worktreePath === undefined
              ? (existingThread?.worktreePath ?? null)
              : (options.worktreePath ?? null);
          const nextIsTemporary =
            options?.isTemporary === true
              ? true
              : options?.isTemporary === false
                ? false
                : existingThread?.isTemporary === true;
          const nextPromotedTo = existingThread?.promotedTo;
          const nextDraftThread: DraftThreadState = {
            projectId,
            createdAt: options?.createdAt ?? existingThread?.createdAt ?? new Date().toISOString(),
            runtimeMode:
              options?.runtimeMode ?? existingThread?.runtimeMode ?? DEFAULT_RUNTIME_MODE,
            interactionMode:
              options?.interactionMode ??
              existingThread?.interactionMode ??
              DEFAULT_INTERACTION_MODE,
            entryPoint,
            branch:
              options?.branch === undefined
                ? (existingThread?.branch ?? null)
                : (options.branch ?? null),
            worktreePath: nextWorktreePath,
            lastKnownPr:
              options?.lastKnownPr === undefined
                ? (existingThread?.lastKnownPr ?? null)
                : (options.lastKnownPr ?? null),
            envMode:
              options?.envMode ??
              (nextWorktreePath ? "worktree" : (existingThread?.envMode ?? "local")),
            ...(nextIsTemporary ? { isTemporary: true } : {}),
            ...(nextPromotedTo ? { promotedTo: nextPromotedTo } : {}),
          };
          const hasSameProjectMapping = previousThreadIdForProject === threadId;
          const hasSameDraftThread =
            existingThread &&
            existingThread.projectId === nextDraftThread.projectId &&
            existingThread.createdAt === nextDraftThread.createdAt &&
            existingThread.runtimeMode === nextDraftThread.runtimeMode &&
            existingThread.interactionMode === nextDraftThread.interactionMode &&
            existingThread.entryPoint === nextDraftThread.entryPoint &&
            existingThread.branch === nextDraftThread.branch &&
            existingThread.worktreePath === nextDraftThread.worktreePath &&
            Equal.equals(existingThread.lastKnownPr ?? null, nextDraftThread.lastKnownPr ?? null) &&
            existingThread.envMode === nextDraftThread.envMode &&
            (existingThread.isTemporary === true) === (nextDraftThread.isTemporary === true) &&
            existingThread.promotedTo === nextDraftThread.promotedTo;
          if (hasSameProjectMapping && hasSameDraftThread) {
            return state;
          }
          const nextProjectDraftThreadIdByProjectId: Record<string, ThreadId> = {
            ...state.projectDraftThreadIdByProjectId,
            [mappingKey]: threadId,
          };
          const nextDraftThreadsByThreadId: Record<ThreadId, DraftThreadState> = {
            ...state.draftThreadsByThreadId,
            [threadId]: nextDraftThread,
          };
          let nextDraftsByThreadId = state.draftsByThreadId;
          if (
            previousThreadIdForProject &&
            previousThreadIdForProject !== threadId &&
            !Object.values(nextProjectDraftThreadIdByProjectId).includes(previousThreadIdForProject)
          ) {
            delete nextDraftThreadsByThreadId[previousThreadIdForProject];
            if (state.draftsByThreadId[previousThreadIdForProject] !== undefined) {
              revokeDraftPreviewUrls(state.draftsByThreadId[previousThreadIdForProject]);
              nextDraftsByThreadId = { ...state.draftsByThreadId };
              delete nextDraftsByThreadId[previousThreadIdForProject];
            }
          }
          return {
            draftsByThreadId: nextDraftsByThreadId,
            draftThreadsByThreadId: nextDraftThreadsByThreadId,
            projectDraftThreadIdByProjectId: nextProjectDraftThreadIdByProjectId,
          };
        });
      },
      setDraftThreadContext: (threadId, options) => {
        if (threadId.length === 0) {
          return;
        }
        set((state) => {
          const existing = state.draftThreadsByThreadId[threadId];
          if (!existing) {
            return state;
          }
          const nextProjectId = options.projectId ?? existing.projectId;
          if (nextProjectId.length === 0) {
            return state;
          }
          const nextWorktreePath =
            options.worktreePath === undefined
              ? existing.worktreePath
              : (options.worktreePath ?? null);
          const nextEntryPoint = normalizeDraftThreadEntryPoint(
            options.entryPoint,
            existing.entryPoint,
          );
          const nextIsTemporary =
            options.isTemporary === true
              ? true
              : options.isTemporary === false
                ? false
                : existing.isTemporary === true;
          const nextPromotedTo = existing.promotedTo;
          const nextDraftThread: DraftThreadState = {
            projectId: nextProjectId,
            createdAt:
              options.createdAt === undefined
                ? existing.createdAt
                : options.createdAt || existing.createdAt,
            runtimeMode: options.runtimeMode ?? existing.runtimeMode,
            interactionMode: options.interactionMode ?? existing.interactionMode,
            entryPoint: nextEntryPoint,
            branch: options.branch === undefined ? existing.branch : (options.branch ?? null),
            worktreePath: nextWorktreePath,
            lastKnownPr:
              options.lastKnownPr === undefined
                ? (existing.lastKnownPr ?? null)
                : (options.lastKnownPr ?? null),
            envMode:
              options.envMode ?? (nextWorktreePath ? "worktree" : (existing.envMode ?? "local")),
            ...(nextIsTemporary ? { isTemporary: true } : {}),
            ...(nextPromotedTo ? { promotedTo: nextPromotedTo } : {}),
          };
          const isUnchanged =
            nextDraftThread.projectId === existing.projectId &&
            nextDraftThread.createdAt === existing.createdAt &&
            nextDraftThread.runtimeMode === existing.runtimeMode &&
            nextDraftThread.interactionMode === existing.interactionMode &&
            nextDraftThread.entryPoint === existing.entryPoint &&
            nextDraftThread.branch === existing.branch &&
            nextDraftThread.worktreePath === existing.worktreePath &&
            Equal.equals(nextDraftThread.lastKnownPr ?? null, existing.lastKnownPr ?? null) &&
            nextDraftThread.envMode === existing.envMode &&
            (nextDraftThread.isTemporary === true) === (existing.isTemporary === true) &&
            nextDraftThread.promotedTo === existing.promotedTo;
          if (isUnchanged) {
            return state;
          }
          const nextProjectDraftThreadIdByProjectId: Record<string, ThreadId> = {
            ...state.projectDraftThreadIdByProjectId,
          };
          for (const [mappingKey, mappedThreadId] of Object.entries(
            nextProjectDraftThreadIdByProjectId,
          )) {
            if (mappedThreadId === threadId) {
              delete nextProjectDraftThreadIdByProjectId[mappingKey];
            }
          }
          nextProjectDraftThreadIdByProjectId[
            projectDraftThreadMappingKey(nextProjectId, nextEntryPoint)
          ] = threadId;
          return {
            draftThreadsByThreadId: {
              ...state.draftThreadsByThreadId,
              [threadId]: nextDraftThread,
            },
            projectDraftThreadIdByProjectId: nextProjectDraftThreadIdByProjectId,
          };
        });
      },
      clearProjectDraftThreadId: (projectId, entryPoint = "chat") => {
        if (projectId.length === 0) {
          return;
        }
        set((state) => {
          const mappingKey = projectDraftThreadMappingKey(projectId, entryPoint);
          const threadId = state.projectDraftThreadIdByProjectId[mappingKey];
          if (threadId === undefined) {
            return state;
          }
          const { [mappingKey]: _removed, ...restProjectMappingsRaw } =
            state.projectDraftThreadIdByProjectId;
          const restProjectMappings = restProjectMappingsRaw as Record<string, ThreadId>;
          const nextDraftThreadsByThreadId: Record<ThreadId, DraftThreadState> = {
            ...state.draftThreadsByThreadId,
          };
          let nextDraftsByThreadId = state.draftsByThreadId;
          if (!Object.values(restProjectMappings).includes(threadId)) {
            delete nextDraftThreadsByThreadId[threadId];
            if (state.draftsByThreadId[threadId] !== undefined) {
              revokeDraftPreviewUrls(state.draftsByThreadId[threadId]);
              nextDraftsByThreadId = { ...state.draftsByThreadId };
              delete nextDraftsByThreadId[threadId];
            }
          }
          return {
            draftsByThreadId: nextDraftsByThreadId,
            draftThreadsByThreadId: nextDraftThreadsByThreadId,
            projectDraftThreadIdByProjectId: restProjectMappings,
          };
        });
      },
      clearProjectDraftThreads: (projectId) => {
        if (projectId.length === 0) {
          return;
        }
        set((state) => {
          const nextProjectDraftThreadIdByProjectId: Record<string, ThreadId> = {};
          const removedThreadIds = new Set<ThreadId>();
          for (const [mappingKey, threadId] of Object.entries(
            state.projectDraftThreadIdByProjectId,
          )) {
            if (projectIdFromDraftThreadMappingKey(mappingKey) === projectId) {
              removedThreadIds.add(threadId);
              continue;
            }
            nextProjectDraftThreadIdByProjectId[mappingKey] = threadId;
          }
          if (removedThreadIds.size === 0) {
            return state;
          }
          const retainedThreadIds = new Set(Object.values(nextProjectDraftThreadIdByProjectId));
          const nextDraftThreadsByThreadId: Record<ThreadId, DraftThreadState> = {
            ...state.draftThreadsByThreadId,
          };
          let nextDraftsByThreadId = state.draftsByThreadId;
          for (const threadId of removedThreadIds) {
            if (retainedThreadIds.has(threadId)) continue;
            delete nextDraftThreadsByThreadId[threadId];
            if (state.draftsByThreadId[threadId] !== undefined) {
              revokeDraftPreviewUrls(state.draftsByThreadId[threadId]);
              if (nextDraftsByThreadId === state.draftsByThreadId) {
                nextDraftsByThreadId = { ...state.draftsByThreadId };
              }
              delete nextDraftsByThreadId[threadId];
            }
          }
          return {
            draftsByThreadId: nextDraftsByThreadId,
            draftThreadsByThreadId: nextDraftThreadsByThreadId,
            projectDraftThreadIdByProjectId: nextProjectDraftThreadIdByProjectId,
          };
        });
      },
      clearProjectDraftThreadById: (projectId, threadId) => {
        if (projectId.length === 0 || threadId.length === 0) {
          return;
        }
        set((state) => {
          const matchingMappingKey = Object.entries(state.projectDraftThreadIdByProjectId).find(
            ([mappingKey, mappedThreadId]) =>
              projectIdFromDraftThreadMappingKey(mappingKey) === projectId &&
              mappedThreadId === threadId,
          )?.[0];
          if (!matchingMappingKey) {
            return state;
          }
          const { [matchingMappingKey]: _removed, ...restProjectMappingsRaw } =
            state.projectDraftThreadIdByProjectId;
          const restProjectMappings = restProjectMappingsRaw as Record<string, ThreadId>;
          const nextDraftThreadsByThreadId: Record<ThreadId, DraftThreadState> = {
            ...state.draftThreadsByThreadId,
          };
          let nextDraftsByThreadId = state.draftsByThreadId;
          if (!Object.values(restProjectMappings).includes(threadId)) {
            delete nextDraftThreadsByThreadId[threadId];
            if (state.draftsByThreadId[threadId] !== undefined) {
              revokeDraftPreviewUrls(state.draftsByThreadId[threadId]);
              nextDraftsByThreadId = { ...state.draftsByThreadId };
              delete nextDraftsByThreadId[threadId];
            }
          }
          return {
            draftsByThreadId: nextDraftsByThreadId,
            draftThreadsByThreadId: nextDraftThreadsByThreadId,
            projectDraftThreadIdByProjectId: restProjectMappings,
          };
        });
      },
      markDraftThreadPromoting: (threadId, promotedTo) => {
        if (threadId.length === 0) {
          return;
        }
        set((state) => {
          const existing = state.draftThreadsByThreadId[threadId];
          if (!existing) {
            return state;
          }
          const nextPromotedTo = promotedTo ?? threadId;
          if (existing.promotedTo === nextPromotedTo) {
            return state;
          }
          return {
            draftThreadsByThreadId: {
              ...state.draftThreadsByThreadId,
              [threadId]: {
                ...existing,
                promotedTo: nextPromotedTo,
              },
            },
          };
        });
      },
      finalizePromotedDraftThread: (threadId) => {
        const draftThread = get().draftThreadsByThreadId[threadId];
        if (!draftThread?.promotedTo) {
          return;
        }
        get().clearDraftThread(threadId);
      },
      clearDraftThread: (threadId) => {
        if (threadId.length === 0) {
          return;
        }
        revokeDraftPreviewUrls(get().draftsByThreadId[threadId]);
        set((state) => {
          const hasDraftThread = state.draftThreadsByThreadId[threadId] !== undefined;
          const hasProjectMapping = Object.values(state.projectDraftThreadIdByProjectId).includes(
            threadId,
          );
          const hasComposerDraft = state.draftsByThreadId[threadId] !== undefined;
          if (!hasDraftThread && !hasProjectMapping && !hasComposerDraft) {
            return state;
          }
          const nextProjectDraftThreadIdByProjectId = Object.fromEntries(
            Object.entries(state.projectDraftThreadIdByProjectId).filter(
              ([, draftThreadId]) => draftThreadId !== threadId,
            ),
          ) as Record<string, ThreadId>;
          const { [threadId]: _removedDraftThread, ...restDraftThreadsByThreadId } =
            state.draftThreadsByThreadId;
          const { [threadId]: _removedComposerDraft, ...restDraftsByThreadId } =
            state.draftsByThreadId;
          return {
            draftsByThreadId: restDraftsByThreadId,
            draftThreadsByThreadId: restDraftThreadsByThreadId,
            projectDraftThreadIdByProjectId: nextProjectDraftThreadIdByProjectId,
          };
        });
      },
      setStickyModelSelection: (modelSelection) => {
        const normalized = normalizeModelSelection(modelSelection);
        set((state) => {
          if (!normalized) {
            return state;
          }
          const nextMap: Partial<Record<ProviderKind, ModelSelection>> = {
            ...state.stickyModelSelectionByProvider,
            [normalized.provider]: normalized,
          };
          if (Equal.equals(state.stickyModelSelectionByProvider, nextMap)) {
            return state.stickyActiveProvider === normalized.provider
              ? state
              : { stickyActiveProvider: normalized.provider };
          }
          return {
            stickyModelSelectionByProvider: nextMap,
            stickyActiveProvider: normalized.provider,
          };
        });
      },
      applyStickyState: (threadId) => {
        if (threadId.length === 0) {
          return;
        }
        set((state) => {
          const stickyMap = state.stickyModelSelectionByProvider;
          const stickyActiveProvider = state.stickyActiveProvider;
          if (Object.keys(stickyMap).length === 0 && stickyActiveProvider === null) {
            return state;
          }
          const existing = state.draftsByThreadId[threadId];
          const base = existing ?? createEmptyThreadDraft();
          const nextMap = { ...base.modelSelectionByProvider };
          for (const [provider, selection] of Object.entries(stickyMap)) {
            if (selection) {
              const current = nextMap[provider as ProviderKind];
              nextMap[provider as ProviderKind] = {
                ...selection,
                model: current?.model ?? selection.model,
              };
            }
          }
          if (
            Equal.equals(base.modelSelectionByProvider, nextMap) &&
            base.activeProvider === stickyActiveProvider
          ) {
            return state;
          }
          const nextDraft: ComposerThreadDraftState = {
            ...base,
            modelSelectionByProvider: nextMap,
            activeProvider: stickyActiveProvider,
          };
          return { draftsByThreadId: writeDraftEntry(state.draftsByThreadId, threadId, nextDraft) };
        });
      },
      setPrompt: (threadId, prompt) => {
        if (threadId.length === 0) {
          return;
        }
        set((state) => {
          const existing = state.draftsByThreadId[threadId] ?? createEmptyThreadDraft();
          const nextDraft: ComposerThreadDraftState = {
            ...existing,
            prompt,
          };
          return { draftsByThreadId: writeDraftEntry(state.draftsByThreadId, threadId, nextDraft) };
        });
      },
      setTerminalContexts: (threadId, contexts) => {
        if (threadId.length === 0) {
          return;
        }
        const normalizedContexts = normalizeTerminalContextsForThread(threadId, contexts);
        set((state) => {
          const existing = state.draftsByThreadId[threadId] ?? createEmptyThreadDraft();
          const nextDraft: ComposerThreadDraftState = {
            ...existing,
            prompt: ensureInlineTerminalContextPlaceholders(
              existing.prompt,
              normalizedContexts.length,
            ),
            terminalContexts: normalizedContexts,
          };
          return { draftsByThreadId: writeDraftEntry(state.draftsByThreadId, threadId, nextDraft) };
        });
      },
      setModelSelection: (threadId, modelSelection) => {
        if (threadId.length === 0) {
          return;
        }
        const normalized = normalizeModelSelection(modelSelection);
        set((state) => {
          const existing = state.draftsByThreadId[threadId];
          if (!existing && normalized === null) {
            return state;
          }
          const base = existing ?? createEmptyThreadDraft();
          const nextMap = { ...base.modelSelectionByProvider };
          if (normalized) {
            const current = nextMap[normalized.provider];
            if (normalized.options !== undefined) {
              // Explicit options provided → use them
              nextMap[normalized.provider] = normalized;
            } else {
              // No options in selection → preserve existing options, update provider+model
              nextMap[normalized.provider] = makeModelSelection(
                normalized.provider,
                normalized.model,
                current?.options,
              );
            }
          }
          const nextActiveProvider = normalized?.provider ?? base.activeProvider;
          if (
            Equal.equals(base.modelSelectionByProvider, nextMap) &&
            base.activeProvider === nextActiveProvider
          ) {
            return state;
          }
          const nextDraft: ComposerThreadDraftState = {
            ...base,
            modelSelectionByProvider: nextMap,
            activeProvider: nextActiveProvider,
          };
          return { draftsByThreadId: writeDraftEntry(state.draftsByThreadId, threadId, nextDraft) };
        });
      },
      setModelOptions: (threadId, modelOptions) => {
        if (threadId.length === 0) {
          return;
        }
        const normalizedOpts = normalizeProviderModelOptions(modelOptions);
        set((state) => {
          const existing = state.draftsByThreadId[threadId];
          if (!existing && normalizedOpts === null) {
            return state;
          }
          const base = existing ?? createEmptyThreadDraft();
          const nextMap = { ...base.modelSelectionByProvider };
          for (const provider of COMPOSER_PROVIDER_KINDS) {
            // Only touch providers explicitly present in the input
            if (!normalizedOpts || !(provider in normalizedOpts)) continue;
            const opts = normalizedOpts[provider];
            const current = nextMap[provider];
            if (opts) {
              const model = current?.model ?? getDefaultModel(provider);
              if (!model) continue;
              nextMap[provider] = makeModelSelection(provider, model, opts);
            } else if (current?.options) {
              // Remove options but keep the selection
              nextMap[provider] = buildModelSelection(provider, current.model);
            }
          }
          if (Equal.equals(base.modelSelectionByProvider, nextMap)) {
            return state;
          }
          const nextDraft: ComposerThreadDraftState = {
            ...base,
            modelSelectionByProvider: nextMap,
          };
          return { draftsByThreadId: writeDraftEntry(state.draftsByThreadId, threadId, nextDraft) };
        });
      },
      setProviderModelOptions: (threadId, provider, nextProviderOptions, options) => {
        if (threadId.length === 0) {
          return;
        }
        const normalizedProvider = normalizeProviderKind(provider);
        if (normalizedProvider === null) {
          return;
        }
        // Normalize just this provider's options
        const normalizedOpts = normalizeProviderModelOptions(
          { [normalizedProvider]: nextProviderOptions },
          normalizedProvider,
        );
        const providerOpts = normalizedOpts?.[normalizedProvider];
        const fallbackModel =
          normalizeModelSlug(options?.model, normalizedProvider) ??
          getDefaultModel(normalizedProvider);

        set((state) => {
          const existing = state.draftsByThreadId[threadId];
          const base = existing ?? createEmptyThreadDraft();

          // Update the map entry for this provider
          const nextMap = { ...base.modelSelectionByProvider };
          const currentForProvider = nextMap[normalizedProvider];
          if (providerOpts) {
            const nextModel = currentForProvider?.model ?? fallbackModel;
            if (!nextModel) {
              return state;
            }
            nextMap[normalizedProvider] = makeModelSelection(
              normalizedProvider,
              nextModel,
              providerOpts,
            );
          } else if (currentForProvider?.options) {
            nextMap[normalizedProvider] = buildModelSelection(
              normalizedProvider,
              currentForProvider.model,
            );
          }

          // Handle sticky persistence
          let nextStickyMap = state.stickyModelSelectionByProvider;
          let nextStickyActiveProvider = state.stickyActiveProvider;
          if (options?.persistSticky === true) {
            nextStickyMap = { ...state.stickyModelSelectionByProvider };
            const stickyBase =
              nextStickyMap[normalizedProvider] ??
              base.modelSelectionByProvider[normalizedProvider] ??
              (fallbackModel ? makeModelSelection(normalizedProvider, fallbackModel) : null);
            if (!stickyBase) {
              return state;
            }
            if (providerOpts) {
              nextStickyMap[normalizedProvider] = makeModelSelection(
                normalizedProvider,
                stickyBase.model,
                providerOpts,
              );
            } else if (stickyBase.options) {
              nextStickyMap[normalizedProvider] = buildModelSelection(
                normalizedProvider,
                stickyBase.model,
              );
            }
            nextStickyActiveProvider = base.activeProvider ?? normalizedProvider;
          }

          if (
            Equal.equals(base.modelSelectionByProvider, nextMap) &&
            Equal.equals(state.stickyModelSelectionByProvider, nextStickyMap) &&
            state.stickyActiveProvider === nextStickyActiveProvider
          ) {
            return state;
          }

          const nextDraft: ComposerThreadDraftState = {
            ...base,
            modelSelectionByProvider: nextMap,
          };
          const nextDraftsByThreadId = { ...state.draftsByThreadId };
          if (shouldRemoveDraft(nextDraft)) {
            delete nextDraftsByThreadId[threadId];
          } else {
            nextDraftsByThreadId[threadId] = nextDraft;
          }

          return {
            draftsByThreadId: nextDraftsByThreadId,
            ...(options?.persistSticky === true
              ? {
                  stickyModelSelectionByProvider: nextStickyMap,
                  stickyActiveProvider: nextStickyActiveProvider,
                }
              : {}),
          };
        });
      },
      setRuntimeMode: (threadId, runtimeMode) => {
        if (threadId.length === 0) {
          return;
        }
        const nextRuntimeMode =
          runtimeMode === "approval-required" || runtimeMode === "full-access" ? runtimeMode : null;
        set((state) => {
          const existing = state.draftsByThreadId[threadId];
          if (!existing && nextRuntimeMode === null) {
            return state;
          }
          const base = existing ?? createEmptyThreadDraft();
          if (base.runtimeMode === nextRuntimeMode) {
            return state;
          }
          const nextDraft: ComposerThreadDraftState = {
            ...base,
            runtimeMode: nextRuntimeMode,
          };
          return { draftsByThreadId: writeDraftEntry(state.draftsByThreadId, threadId, nextDraft) };
        });
      },
      setInteractionMode: (threadId, interactionMode) => {
        if (threadId.length === 0) {
          return;
        }
        const nextInteractionMode = Schema.is(ProviderInteractionMode)(interactionMode)
          ? interactionMode
          : null;
        set((state) => {
          const existing = state.draftsByThreadId[threadId];
          if (!existing && nextInteractionMode === null) {
            return state;
          }
          const base = existing ?? createEmptyThreadDraft();
          if (base.interactionMode === nextInteractionMode) {
            return state;
          }
          const nextDraft: ComposerThreadDraftState = {
            ...base,
            interactionMode: nextInteractionMode,
          };
          return { draftsByThreadId: writeDraftEntry(state.draftsByThreadId, threadId, nextDraft) };
        });
      },
      // Keep queued follow-ups with the thread draft so route changes do not hide them.
      enqueueQueuedTurn: (threadId, queuedTurn) => {
        if (threadId.length === 0) {
          return;
        }
        set((state) => {
          const existing = state.draftsByThreadId[threadId] ?? createEmptyThreadDraft();
          return {
            draftsByThreadId: {
              ...state.draftsByThreadId,
              [threadId]: {
                ...existing,
                queuedTurns: [...existing.queuedTurns, queuedTurn],
              },
            },
          };
        });
      },
      insertQueuedTurn: (threadId, queuedTurn, index) => {
        if (threadId.length === 0) {
          return;
        }
        set((state) => {
          const existing = state.draftsByThreadId[threadId] ?? createEmptyThreadDraft();
          const boundedIndex = Math.max(0, Math.min(existing.queuedTurns.length, index));
          return {
            draftsByThreadId: {
              ...state.draftsByThreadId,
              [threadId]: {
                ...existing,
                queuedTurns: [
                  ...existing.queuedTurns.slice(0, boundedIndex),
                  queuedTurn,
                  ...existing.queuedTurns.slice(boundedIndex),
                ],
              },
            },
          };
        });
      },
      removeQueuedTurn: (threadId, queuedTurnId) => {
        if (threadId.length === 0 || queuedTurnId.length === 0) {
          return;
        }
        const removedQueuedTurn = get().draftsByThreadId[threadId]?.queuedTurns.find(
          (entry) => entry.id === queuedTurnId,
        );
        if (removedQueuedTurn) {
          revokeQueuedTurnPreviewUrls(removedQueuedTurn);
        }
        set((state) => {
          const current = state.draftsByThreadId[threadId];
          if (!current || current.queuedTurns.every((entry) => entry.id !== queuedTurnId)) {
            return state;
          }
          const nextDraft: ComposerThreadDraftState = {
            ...current,
            queuedTurns: current.queuedTurns.filter((entry) => entry.id !== queuedTurnId),
          };
          return { draftsByThreadId: writeDraftEntry(state.draftsByThreadId, threadId, nextDraft) };
        });
      },
      addImage: (threadId, image) => {
        if (threadId.length === 0) {
          return;
        }
        get().addImages(threadId, [image]);
      },
      addImages: (threadId, images) => {
        if (threadId.length === 0 || images.length === 0) {
          return;
        }
        set((state) => {
          const existing = state.draftsByThreadId[threadId] ?? createEmptyThreadDraft();
          const existingIds = new Set(existing.images.map((image) => image.id));
          const existingDedupKeys = new Set(
            existing.images.map((image) => composerImageDedupKey(image)),
          );
          const acceptedPreviewUrls = new Set(existing.images.map((image) => image.previewUrl));
          const dedupedIncoming: ComposerImageAttachment[] = [];
          for (const image of images) {
            const dedupKey = composerImageDedupKey(image);
            if (existingIds.has(image.id) || existingDedupKeys.has(dedupKey)) {
              // Avoid revoking a blob URL that's still referenced by an accepted image.
              if (!acceptedPreviewUrls.has(image.previewUrl)) {
                revokeObjectPreviewUrl(image.previewUrl);
              }
              continue;
            }
            dedupedIncoming.push(image);
            existingIds.add(image.id);
            existingDedupKeys.add(dedupKey);
            acceptedPreviewUrls.add(image.previewUrl);
          }
          if (dedupedIncoming.length === 0) {
            return state;
          }
          return {
            draftsByThreadId: {
              ...state.draftsByThreadId,
              [threadId]: {
                ...existing,
                images: [...existing.images, ...dedupedIncoming],
              },
            },
          };
        });
      },
      removeImage: (threadId, imageId) => {
        if (threadId.length === 0) {
          return;
        }
        const existing = get().draftsByThreadId[threadId];
        if (!existing) {
          return;
        }
        const removedImage = existing.images.find((image) => image.id === imageId);
        if (removedImage) {
          revokeObjectPreviewUrl(removedImage.previewUrl);
        }
        set((state) => {
          const current = state.draftsByThreadId[threadId];
          if (!current) {
            return state;
          }
          const nextDraft: ComposerThreadDraftState = {
            ...current,
            images: current.images.filter((image) => image.id !== imageId),
            nonPersistedImageIds: current.nonPersistedImageIds.filter((id) => id !== imageId),
            persistedAttachments: current.persistedAttachments.filter(
              (attachment) => attachment.id !== imageId,
            ),
          };
          return { draftsByThreadId: writeDraftEntry(state.draftsByThreadId, threadId, nextDraft) };
        });
      },
      addAssistantSelection: (threadId, selection) => {
        if (threadId.length === 0) {
          return false;
        }
        let inserted = false;
        set((state) => {
          const existing = state.draftsByThreadId[threadId] ?? createEmptyThreadDraft();
          const normalizedSelection = normalizeAssistantSelection(selection);
          if (!normalizedSelection) {
            return state;
          }
          const dedupKey = assistantSelectionDedupKey(normalizedSelection);
          if (
            existing.assistantSelections.some((entry) => entry.id === normalizedSelection.id) ||
            existing.assistantSelections.some(
              (entry) => assistantSelectionDedupKey(entry) === dedupKey,
            )
          ) {
            return state;
          }
          inserted = true;
          return {
            draftsByThreadId: {
              ...state.draftsByThreadId,
              [threadId]: {
                ...existing,
                assistantSelections: [...existing.assistantSelections, normalizedSelection],
              },
            },
          };
        });
        return inserted;
      },
      removeAssistantSelection: (threadId, selectionId) => {
        if (threadId.length === 0 || selectionId.length === 0) {
          return;
        }
        set((state) => {
          const current = state.draftsByThreadId[threadId];
          if (!current) {
            return state;
          }
          const nextDraft: ComposerThreadDraftState = {
            ...current,
            assistantSelections: current.assistantSelections.filter(
              (selection) => selection.id !== selectionId,
            ),
          };
          return { draftsByThreadId: writeDraftEntry(state.draftsByThreadId, threadId, nextDraft) };
        });
      },
      clearAssistantSelections: (threadId) => {
        if (threadId.length === 0) {
          return;
        }
        set((state) => {
          const current = state.draftsByThreadId[threadId];
          if (!current || current.assistantSelections.length === 0) {
            return state;
          }
          const nextDraft: ComposerThreadDraftState = {
            ...current,
            assistantSelections: [],
          };
          return { draftsByThreadId: writeDraftEntry(state.draftsByThreadId, threadId, nextDraft) };
        });
      },
      insertTerminalContext: (threadId, prompt, context, index) => {
        if (threadId.length === 0) {
          return false;
        }
        let inserted = false;
        set((state) => {
          const existing = state.draftsByThreadId[threadId] ?? createEmptyThreadDraft();
          const normalizedContext = normalizeTerminalContextForThread(threadId, context);
          if (!normalizedContext) {
            return state;
          }
          const dedupKey = terminalContextDedupKey(normalizedContext);
          if (
            existing.terminalContexts.some((entry) => entry.id === normalizedContext.id) ||
            existing.terminalContexts.some((entry) => terminalContextDedupKey(entry) === dedupKey)
          ) {
            return state;
          }
          inserted = true;
          const boundedIndex = Math.max(0, Math.min(existing.terminalContexts.length, index));
          const nextDraft: ComposerThreadDraftState = {
            ...existing,
            prompt,
            terminalContexts: [
              ...existing.terminalContexts.slice(0, boundedIndex),
              normalizedContext,
              ...existing.terminalContexts.slice(boundedIndex),
            ],
          };
          return {
            draftsByThreadId: {
              ...state.draftsByThreadId,
              [threadId]: nextDraft,
            },
          };
        });
        return inserted;
      },
      addTerminalContext: (threadId, context) => {
        if (threadId.length === 0) {
          return;
        }
        get().addTerminalContexts(threadId, [context]);
      },
      addTerminalContexts: (threadId, contexts) => {
        if (threadId.length === 0 || contexts.length === 0) {
          return;
        }
        set((state) => {
          const existing = state.draftsByThreadId[threadId] ?? createEmptyThreadDraft();
          const acceptedContexts = normalizeTerminalContextsForThread(threadId, [
            ...existing.terminalContexts,
            ...contexts,
          ]).slice(existing.terminalContexts.length);
          if (acceptedContexts.length === 0) {
            return state;
          }
          return {
            draftsByThreadId: {
              ...state.draftsByThreadId,
              [threadId]: {
                ...existing,
                prompt: ensureInlineTerminalContextPlaceholders(
                  existing.prompt,
                  existing.terminalContexts.length + acceptedContexts.length,
                ),
                terminalContexts: [...existing.terminalContexts, ...acceptedContexts],
              },
            },
          };
        });
      },
      removeTerminalContext: (threadId, contextId) => {
        if (threadId.length === 0 || contextId.length === 0) {
          return;
        }
        set((state) => {
          const current = state.draftsByThreadId[threadId];
          if (!current) {
            return state;
          }
          const nextDraft: ComposerThreadDraftState = {
            ...current,
            terminalContexts: current.terminalContexts.filter(
              (context) => context.id !== contextId,
            ),
          };
          return { draftsByThreadId: writeDraftEntry(state.draftsByThreadId, threadId, nextDraft) };
        });
      },
      clearTerminalContexts: (threadId) => {
        if (threadId.length === 0) {
          return;
        }
        set((state) => {
          const current = state.draftsByThreadId[threadId];
          if (!current || current.terminalContexts.length === 0) {
            return state;
          }
          const nextDraft: ComposerThreadDraftState = {
            ...current,
            terminalContexts: [],
          };
          return { draftsByThreadId: writeDraftEntry(state.draftsByThreadId, threadId, nextDraft) };
        });
      },
      clearPersistedAttachments: (threadId) => {
        if (threadId.length === 0) {
          return;
        }
        set((state) => {
          const current = state.draftsByThreadId[threadId];
          if (!current) {
            return state;
          }
          const nextDraft: ComposerThreadDraftState = {
            ...current,
            persistedAttachments: [],
            nonPersistedImageIds: [],
          };
          return { draftsByThreadId: writeDraftEntry(state.draftsByThreadId, threadId, nextDraft) };
        });
      },
      syncPersistedAttachments: (threadId, attachments) => {
        if (threadId.length === 0) {
          return;
        }
        const attachmentIdSet = new Set(attachments.map((attachment) => attachment.id));
        set((state) => {
          const current = state.draftsByThreadId[threadId];
          if (!current) {
            return state;
          }
          const nextDraft: ComposerThreadDraftState = {
            ...current,
            // Stage attempted attachments so persist middleware can try writing them.
            persistedAttachments: attachments,
            nonPersistedImageIds: current.nonPersistedImageIds.filter(
              (id) => !attachmentIdSet.has(id),
            ),
          };
          return { draftsByThreadId: writeDraftEntry(state.draftsByThreadId, threadId, nextDraft) };
        });
        Promise.resolve().then(() => {
          verifyPersistedAttachments(threadId, attachments, set);
        });
      },
      copyTransferableComposerState: (sourceThreadId, targetThreadId) => {
        if (sourceThreadId.length === 0 || targetThreadId.length === 0) {
          return;
        }
        set((state) => {
          const sourceDraft = state.draftsByThreadId[sourceThreadId];
          if (!sourceDraft) {
            return state;
          }
          const nextDraft = buildTransferredComposerDraft({
            sourceDraft,
            targetDraft: state.draftsByThreadId[targetThreadId],
            targetThreadId,
          });
          const currentTargetDraft = state.draftsByThreadId[targetThreadId];
          if (Equal.equals(currentTargetDraft, nextDraft)) {
            return state;
          }
          return {
            draftsByThreadId: writeDraftEntry(state.draftsByThreadId, targetThreadId, nextDraft),
          };
        });
      },
      clearComposerContent: (threadId) => {
        if (threadId.length === 0) {
          return;
        }
        set((state) => {
          const current = state.draftsByThreadId[threadId];
          if (!current) {
            return state;
          }
          const nextDraft: ComposerThreadDraftState = {
            ...current,
            prompt: "",
            images: [],
            nonPersistedImageIds: [],
            persistedAttachments: [],
            assistantSelections: [],
            terminalContexts: [],
          };
          return { draftsByThreadId: writeDraftEntry(state.draftsByThreadId, threadId, nextDraft) };
        });
      },
    }),
    {
      name: COMPOSER_DRAFT_STORAGE_KEY,
      version: COMPOSER_DRAFT_STORAGE_VERSION,
      storage: createJSONStorage(() => composerDebouncedStorage),
      migrate: migratePersistedComposerDraftStoreState,
      partialize: partializeComposerDraftStoreState,
      merge: (persistedState, currentState) => {
        const normalizedPersisted =
          normalizeCurrentPersistedComposerDraftStoreState(persistedState);
        const draftsByThreadId = Object.fromEntries(
          Object.entries(normalizedPersisted.draftsByThreadId).map(([threadId, draft]) => [
            threadId,
            toHydratedThreadDraft(threadId as ThreadId, draft),
          ]),
        );
        return {
          ...currentState,
          draftsByThreadId,
          draftThreadsByThreadId: normalizedPersisted.draftThreadsByThreadId,
          projectDraftThreadIdByProjectId: normalizedPersisted.projectDraftThreadIdByProjectId,
          stickyModelSelectionByProvider: normalizedPersisted.stickyModelSelectionByProvider ?? {},
          stickyActiveProvider: normalizedPersisted.stickyActiveProvider ?? null,
        };
      },
    },
  ),
);

export function useComposerThreadDraft(threadId: ThreadId): ComposerThreadDraftState {
  return useComposerDraftStore((state) => state.draftsByThreadId[threadId] ?? EMPTY_THREAD_DRAFT);
}

export function useEffectiveComposerModelState(input: {
  threadId: ThreadId;
  selectedProvider: ProviderKind;
  threadModelSelection: ModelSelection | null | undefined;
  projectModelSelection: ModelSelection | null | undefined;
  customModelsByProvider: Record<ProviderKind, readonly string[]>;
  availableModelOptionsByProvider?: Partial<
    Record<ProviderKind, ReadonlyArray<{ slug: string; name: string }>>
  >;
}): EffectiveComposerModelState {
  const draft = useComposerThreadDraft(input.threadId);

  return useMemo(
    () =>
      deriveEffectiveComposerModelState({
        draft,
        selectedProvider: input.selectedProvider,
        threadModelSelection: input.threadModelSelection,
        projectModelSelection: input.projectModelSelection,
        customModelsByProvider: input.customModelsByProvider,
        ...(input.availableModelOptionsByProvider !== undefined
          ? { availableModelOptionsByProvider: input.availableModelOptionsByProvider }
          : {}),
      }),
    [
      input.availableModelOptionsByProvider,
      draft,
      input.customModelsByProvider,
      input.projectModelSelection,
      input.selectedProvider,
      input.threadModelSelection,
    ],
  );
}

// Mark drafts as promoted first; route/composer cleanup happens after the server thread starts.
export function markPromotedDraftThreads(serverThreadIds: ReadonlySet<ThreadId>): void {
  const store = useComposerDraftStore.getState();
  const draftThreadIds = Object.keys(store.draftThreadsByThreadId) as ThreadId[];
  for (const draftId of draftThreadIds) {
    if (serverThreadIds.has(draftId)) {
      store.markDraftThreadPromoting(draftId);
    }
  }
}

export function finalizePromotedDraftThreads(serverThreadIds: ReadonlySet<ThreadId>): void {
  const store = useComposerDraftStore.getState();
  for (const threadId of serverThreadIds) {
    store.finalizePromotedDraftThread(threadId);
  }
}
