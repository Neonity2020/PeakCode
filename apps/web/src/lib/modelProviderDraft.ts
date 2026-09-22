import type { ModelProviderConfig } from "@peakcode/contracts";

/**
 * The `models.json` provider key for a new provider, derived from its display name.
 *
 * The create form no longer asks for this separately: a free-text "provider key" field
 * invited pasting the API key into it (the key then became the provider's id, and the
 * secret landed in `models.json`). The name is something users already have to type, and
 * it is the id they will see everywhere else afterwards.
 *
 * A name with no ASCII letters (e.g. all-Chinese) still needs a stable, unique key, so it
 * falls back to a short hash of the name rather than collapsing every such provider onto
 * the same "provider" key.
 */
export function providerIdFromName(name: string, taken: readonly string[]): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "");
  const seed = slug.length > 0 ? slug : `provider-${shortHash(name.trim())}`;
  if (!taken.includes(seed)) return seed;
  let suffix = 2;
  while (taken.includes(`${seed}-${suffix}`)) suffix += 1;
  return `${seed}-${suffix}`;
}

/** Small deterministic hash so a non-ASCII name still maps to a stable key. */
function shortHash(value: string): string {
  let hash = 0;
  for (const character of value) {
    hash = (hash * 31 + character.codePointAt(0)!) >>> 0;
  }
  return hash.toString(36).slice(0, 4).padStart(4, "0");
}

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
  return Object.fromEntries(
    Object.entries(providers).map(([key, provider]) => {
      const models = provider.models
        ?.filter((model) => model.id.trim().length > 0)
        .map((model) => ({ ...model, id: model.id.trim() }));
      return [key, patchModelProvider(provider, { models: models?.length ? models : undefined })];
    }),
  );
}
