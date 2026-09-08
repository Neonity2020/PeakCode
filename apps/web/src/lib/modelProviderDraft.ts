import type { ModelProviderConfig } from "@peakcode/contracts";

/** Empty controls remove optional fields instead of retaining their previous values. */
export function patchModelProvider(
  provider: ModelProviderConfig,
  patch: Partial<ModelProviderConfig>,
): ModelProviderConfig {
  return Object.fromEntries(
    Object.entries({ ...provider, ...patch }).filter(([, value]) => value !== undefined),
  );
}

export function cleanModelProviderDraft(
  providers: Readonly<Record<string, ModelProviderConfig>>,
): Record<string, ModelProviderConfig> {
  return Object.fromEntries(Object.entries(providers).map(([key, provider]) => {
    const models = provider.models?.filter((model) => model.id.trim().length > 0)
      .map((model) => ({ ...model, id: model.id.trim() }));
    return [key, patchModelProvider(provider, { models: models?.length ? models : undefined })];
  }));
}
