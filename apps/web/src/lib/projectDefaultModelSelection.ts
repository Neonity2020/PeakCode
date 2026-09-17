// FILE: projectDefaultModelSelection.ts
// Purpose: Resolves the default model a newly created project carries into `project.create`.
// Layer: Web lib
// Exports: empty-slug guard plus sticky-first, catalog-backed project default resolution.

import type { ModelSelection, ProviderKind } from "@peakcode/contracts";
import { resolveSelectableModel, type SelectableModelOption } from "@peakcode/shared/model";
import type { QueryClient } from "@tanstack/react-query";
import { useComposerDraftStore } from "../composerDraftStore";
import { readNativeApi } from "../nativeApi";
import { providerModelsQueryOptions } from "./providerDiscoveryReactQuery";

/** Folder creation must not wait on a slow or broken provider model listing. */
const MODEL_DISCOVERY_TIMEOUT_MS = 2_000;

export interface ProjectDefaultModelSelectionInput {
  readonly queryClient: QueryClient;
  readonly provider?: ProviderKind;
  readonly binaryPath?: string | null;
  readonly agentDir?: string | null;
}

/**
 * `project.create` decodes `defaultModelSelection` as a `ModelSelection`, whose model is a
 * non-empty slug. A caller that has no model yet must omit the field — the composer resolves one
 * before the first send — instead of sending an empty slug the command schema rejects.
 */
export function toProjectDefaultModelSelection(
  provider: ProviderKind,
  model: string | null | undefined,
): ModelSelection | null {
  const trimmed = model?.trim();
  return trimmed ? { provider, model: trimmed } : null;
}

/**
 * Pi models are resolved at runtime, so a new project defaults to the model the composer most
 * recently used for the provider when the provider still offers it, and otherwise to the first
 * model the provider reports. Returns null when no model is known.
 */
export async function resolveProjectDefaultModelSelection(
  input: ProjectDefaultModelSelectionInput,
): Promise<ModelSelection | null> {
  const provider = input.provider ?? "pi";
  const stickyModel =
    useComposerDraftStore.getState().stickyModelSelectionByProvider[provider]?.model;
  const modelOptions = await discoverModelOptions(input, provider);
  const model =
    resolveSelectableModel(provider, stickyModel, modelOptions) ?? modelOptions[0]?.slug ?? null;
  return toProjectDefaultModelSelection(provider, model);
}

/**
 * Model discovery is best effort: a provider that cannot list models still leaves a usable
 * project, because the composer fills the model in before the first send.
 */
async function discoverModelOptions(
  input: ProjectDefaultModelSelectionInput,
  provider: ProviderKind,
): Promise<ReadonlyArray<SelectableModelOption>> {
  if (!readNativeApi()) {
    return [];
  }
  const optionsPromise = input.queryClient
    .ensureQueryData(
      providerModelsQueryOptions({
        provider,
        binaryPath: input.binaryPath ?? null,
        agentDir: input.agentDir ?? null,
      }),
    )
    .then((result) => toModelOptions(result.models))
    .catch(() => [] as ReadonlyArray<SelectableModelOption>);
  return (await withTimeout(optionsPromise, MODEL_DISCOVERY_TIMEOUT_MS)) ?? [];
}

function toModelOptions(
  models: ReadonlyArray<{ slug: string; name?: string | undefined }>,
): ReadonlyArray<SelectableModelOption> {
  return models.map((model) => ({ slug: model.slug, name: model.name ?? model.slug }));
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    void promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}
