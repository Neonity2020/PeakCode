// FILE: composerDraftStore.modelSelection.ts
// Purpose: Model selection normalization and effective-model derivation for composer drafts.
// Layer: Web state store

// Depends on: contracts schemas, app model resolution helpers, and zustand persistence.

import {
  type ModelSlug,
  type PiThinkingLevel,
  ModelSelection,
  ProviderKind,
  ProviderModelOptions,
} from "@peakcode/contracts";

import {
  getDefaultModel,
  normalizeModelSlug,
  resolveSelectableModel,
  resolveModelSlugForProvider,
} from "@peakcode/shared/model";

import { resolveAppModelSelection } from "./appSettings";

import {
  COMPOSER_PROVIDER_KINDS,
  LegacyCodexFields,
  isProviderKind,
} from "./composerDraftStore.schemas";
import { ComposerThreadDraftState, EffectiveComposerModelState } from "./composerDraftStore.types";

export function mergeProviderModelOptionsFromSelections(
  ...selections: ReadonlyArray<ModelSelection | null | undefined>
): ProviderModelOptions | null {
  const result: Partial<Record<ProviderKind, ProviderModelOptions[ProviderKind]>> = {};
  for (const selection of selections) {
    if (!selection) continue;
    if (selection.options) {
      result[selection.provider] = selection.options;
    } else {
      delete result[selection.provider];
    }
  }
  return Object.keys(result).length > 0 ? (result as ProviderModelOptions) : null;
}

export function deriveEffectiveComposerModelOptions(input: {
  draft:
    | Pick<ComposerThreadDraftState, "modelSelectionByProvider" | "activeProvider">
    | null
    | undefined;
  threadModelSelection: ModelSelection | null | undefined;
  projectModelSelection: ModelSelection | null | undefined;
}): ProviderModelOptions | null {
  const baseOptions = mergeProviderModelOptionsFromSelections(
    input.projectModelSelection,
    input.threadModelSelection,
  );
  const draftSelections = input.draft?.modelSelectionByProvider;
  if (!draftSelections) {
    return baseOptions;
  }

  const result: Partial<Record<ProviderKind, ProviderModelOptions[ProviderKind]>> = {
    ...(baseOptions ?? {}),
  };
  for (const [provider, selection] of Object.entries(draftSelections) as Array<
    [ProviderKind, ModelSelection | undefined]
  >) {
    if (!selection) continue;
    if (selection.options) {
      result[provider] = selection.options;
    } else {
      delete result[provider];
    }
  }
  return Object.keys(result).length > 0 ? (result as ProviderModelOptions) : null;
}

export function normalizeProviderKind(value: unknown): ProviderKind | null {
  return isProviderKind(value) ? value : null;
}

export function trimStringOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function makeModelSelection(
  provider: ProviderKind,
  model: string,
  options?: ProviderModelOptions[ProviderKind],
): ModelSelection {
  switch (provider) {
    case "pi":
      return {
        provider,
        model,
        ...(options
          ? { options: options as Extract<ModelSelection, { provider: "pi" }>["options"] }
          : {}),
      };
  }
}

export function normalizeProviderModelOptions(
  value: unknown,
  provider?: ProviderKind | null,
  legacy?: LegacyCodexFields,
): ProviderModelOptions | null {
  const candidate = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  const piCandidate =
    candidate?.pi && typeof candidate.pi === "object"
      ? (candidate.pi as Record<string, unknown>)
      : null;
  const piThinkingLevel: PiThinkingLevel | undefined =
    piCandidate?.thinkingLevel === "off" ||
    piCandidate?.thinkingLevel === "minimal" ||
    piCandidate?.thinkingLevel === "low" ||
    piCandidate?.thinkingLevel === "medium" ||
    piCandidate?.thinkingLevel === "high" ||
    piCandidate?.thinkingLevel === "xhigh"
      ? piCandidate.thinkingLevel
      : undefined;
  const pi = piThinkingLevel !== undefined ? { thinkingLevel: piThinkingLevel } : undefined;
  if (!pi) {
    return null;
  }
  return {
    ...(pi ? { pi } : {}),
  };
}

export function normalizeModelSelection(
  value: unknown,
  legacy?: {
    provider?: unknown;
    model?: unknown;
    modelOptions?: unknown;
    legacyCodex?: LegacyCodexFields;
  },
): ModelSelection | null {
  const candidate = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  const provider = normalizeProviderKind(candidate?.provider ?? legacy?.provider);
  if (provider === null) {
    return null;
  }
  const rawModel = candidate?.model ?? legacy?.model;
  if (typeof rawModel !== "string") {
    return null;
  }
  const model = normalizeModelSlug(rawModel, provider);
  if (!model) {
    return null;
  }
  const modelOptions = normalizeProviderModelOptions(
    candidate?.options ? { [provider]: candidate.options } : legacy?.modelOptions,
  );
  const options = modelOptions?.pi;
  return makeModelSelection(provider, model, options);
}

// ── Legacy sync helpers (used only during migration from v2 storage) ──

export function legacySyncModelSelectionOptions(
  modelSelection: ModelSelection | null,
  modelOptions: ProviderModelOptions | null | undefined,
): ModelSelection | null {
  if (modelSelection === null) {
    return null;
  }
  const options = modelOptions?.[modelSelection.provider];
  return makeModelSelection(modelSelection.provider, modelSelection.model, options);
}

export function legacyMergeModelSelectionIntoProviderModelOptions(
  modelSelection: ModelSelection | null,
  currentModelOptions: ProviderModelOptions | null | undefined,
): ProviderModelOptions | null {
  if (modelSelection?.options === undefined) {
    return normalizeProviderModelOptions(currentModelOptions);
  }
  return legacyReplaceProviderModelOptions(
    normalizeProviderModelOptions(currentModelOptions),
    modelSelection.provider,
    modelSelection.options,
  );
}

export function legacyReplaceProviderModelOptions(
  currentModelOptions: ProviderModelOptions | null | undefined,
  provider: ProviderKind,
  nextProviderOptions: ProviderModelOptions[ProviderKind] | null | undefined,
): ProviderModelOptions | null {
  const { [provider]: _discardedProviderModelOptions, ...otherProviderModelOptions } =
    currentModelOptions ?? {};
  const normalizedNextProviderOptions = normalizeProviderModelOptions(
    { [provider]: nextProviderOptions },
    provider,
  );

  return normalizeProviderModelOptions({
    ...otherProviderModelOptions,
    ...(normalizedNextProviderOptions ? normalizedNextProviderOptions : {}),
  });
}

// ── New helpers for the consolidated representation ────────────────────

export function legacyToModelSelectionByProvider(
  modelSelection: ModelSelection | null,
  modelOptions: ProviderModelOptions | null | undefined,
): Partial<Record<ProviderKind, ModelSelection>> {
  const result: Partial<Record<ProviderKind, ModelSelection>> = {};
  // Add entries from the options bag (for non-active providers)
  if (modelOptions) {
    for (const provider of COMPOSER_PROVIDER_KINDS) {
      const options = modelOptions[provider];
      if (options && Object.keys(options).length > 0) {
        const model =
          modelSelection?.provider === provider ? modelSelection.model : getDefaultModel(provider);
        if (model) {
          result[provider] = makeModelSelection(provider, model, options);
        }
      }
    }
  }
  // Add/overwrite the active selection (it's authoritative for its provider)
  if (modelSelection) {
    result[modelSelection.provider] = modelSelection;
  }
  return result;
}

export function deriveEffectiveComposerModelState(input: {
  draft:
    | Pick<ComposerThreadDraftState, "modelSelectionByProvider" | "activeProvider">
    | null
    | undefined;
  selectedProvider: ProviderKind;
  threadModelSelection: ModelSelection | null | undefined;
  projectModelSelection: ModelSelection | null | undefined;
  /** The server-wide default for new chats; absent when nobody configured one. */
  serverDefaultModelSelection?: ModelSelection | null | undefined;
  customModelsByProvider: Record<ProviderKind, readonly string[]>;
  availableModelOptionsByProvider?: Partial<
    Record<ProviderKind, ReadonlyArray<{ slug: string; name: string }>>
  >;
}): EffectiveComposerModelState {
  const resolveAvailableModel = (candidate: string | null | undefined): ModelSlug | null => {
    const availableOptions = input.availableModelOptionsByProvider?.[input.selectedProvider];
    if (!availableOptions || availableOptions.length === 0) {
      return null;
    }
    return resolveSelectableModel(input.selectedProvider, candidate, availableOptions);
  };
  // Every source below only speaks for the provider currently selected in the composer.
  const modelOf = (selection: ModelSelection | null | undefined): string | null =>
    selection?.provider === input.selectedProvider ? selection.model : null;
  const persistedModelOf = (selection: ModelSelection | null | undefined): string | null => {
    const model = modelOf(selection);
    return model === null ? null : (normalizeModelSlug(model, input.selectedProvider) ?? model);
  };
  const baseModel = resolveModelSlugForProvider(
    input.selectedProvider,
    modelOf(input.threadModelSelection) ??
      modelOf(input.projectModelSelection) ??
      modelOf(input.serverDefaultModelSelection) ??
      getDefaultModel(input.selectedProvider),
  );
  const activeSelection = input.draft?.modelSelectionByProvider?.[input.selectedProvider];
  const selectedDraftModel = activeSelection?.model
    ? resolveAppModelSelection(
        input.selectedProvider,
        input.customModelsByProvider,
        activeSelection.model,
      )
    : null;
  const unlistedDraftModel = input.selectedProvider === "pi" ? selectedDraftModel : null;
  const selectedModel =
    resolveAvailableModel(activeSelection?.model) ??
    resolveAvailableModel(modelOf(input.threadModelSelection)) ??
    resolveAvailableModel(modelOf(input.projectModelSelection)) ??
    resolveAvailableModel(modelOf(input.serverDefaultModelSelection)) ??
    resolveAvailableModel(selectedDraftModel) ??
    persistedModelOf(input.threadModelSelection) ??
    persistedModelOf(input.projectModelSelection) ??
    persistedModelOf(input.serverDefaultModelSelection) ??
    unlistedDraftModel ??
    input.availableModelOptionsByProvider?.[input.selectedProvider]?.[0]?.slug ??
    selectedDraftModel ??
    baseModel ??
    getDefaultModel("pi") ??
    "";
  const modelOptions = deriveEffectiveComposerModelOptions(input);

  return {
    selectedModel,
    modelOptions,
  };
}

// Resolve the model we should persist for a draft-backed thread promotion.
// This keeps terminal-first thread creation aligned with the composer precedence.
export function resolvePreferredComposerModelSelection(input: {
  draft:
    | Pick<ComposerThreadDraftState, "modelSelectionByProvider" | "activeProvider">
    | null
    | undefined;
  threadModelSelection: ModelSelection | null | undefined;
  projectModelSelection: ModelSelection | null | undefined;
  /** The server-wide default for new chats; absent when nobody configured one. */
  serverDefaultModelSelection?: ModelSelection | null | undefined;
  defaultProvider?: ProviderKind | null | undefined;
}): ModelSelection {
  const draftProviderWithSelection =
    COMPOSER_PROVIDER_KINDS.find(
      (provider) => input.draft?.modelSelectionByProvider?.[provider] !== undefined,
    ) ?? null;
  const preferredProvider =
    input.draft?.activeProvider ??
    draftProviderWithSelection ??
    input.threadModelSelection?.provider ??
    input.projectModelSelection?.provider ??
    input.serverDefaultModelSelection?.provider ??
    input.defaultProvider ??
    "pi";

  return (
    input.draft?.modelSelectionByProvider?.[preferredProvider] ??
    (input.threadModelSelection?.provider === preferredProvider
      ? input.threadModelSelection
      : null) ??
    (input.projectModelSelection?.provider === preferredProvider
      ? input.projectModelSelection
      : null) ??
    (input.serverDefaultModelSelection?.provider === preferredProvider
      ? input.serverDefaultModelSelection
      : null) ?? {
      provider: preferredProvider,
      model: getDefaultModel(preferredProvider) ?? "",
    }
  );
}
