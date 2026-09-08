// FILE: modelSelectionCompatibility.ts
// Purpose: Normalizes persisted model-selection JSON from older/newer app builds.
// Layer: Persistence compatibility helper
// Exports: normalizeLegacyModelSelection, normalizePersistedModelSelection

// Pi is the only provider; legacy records from removed providers (codex,
// claudeAgent, gemini, grok, etc.) are normalized to the Pi provider while
// preserving their model slug and option rows.
type ModelProviderKind = "pi";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readTrimmedString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

// Imported/legacy instance ids may be runtime names rather than Peak Code
// provider literals. Whatever the source, Pi is the only provider today.
function inferLegacyModelProvider(provider: unknown, model: string): ModelProviderKind {
  void provider;
  void model;
  return "pi";
}

function readLegacyProviderOptions(options: unknown, provider: ModelProviderKind): unknown {
  if (!isRecord(options)) {
    return options;
  }
  const providerScopedOptions = options[provider];
  return providerScopedOptions === undefined ? options : providerScopedOptions;
}

// Maps legacy provider option ids to the Pi option key they represent. Pi's
// only model option is `thinkingLevel` (the analog of codex `reasoningEffort`
// / `effort`). Option ids with no Pi equivalent (e.g. fastMode, agent, variant)
// are dropped so the decoded Pi ModelSelection stays schema-valid.
const LEGACY_OPTION_ID_TO_PI: Record<string, string> = {
  reasoningEffort: "thinkingLevel",
  effort: "thinkingLevel",
};

function normalizeModelOptions(input: unknown): unknown {
  if (!Array.isArray(input)) {
    return input;
  }

  const entries: Array<readonly [string, unknown]> = [];
  for (const option of input) {
    if (!isRecord(option)) {
      return input;
    }
    const id = readTrimmedString(option, "id");
    if (id === undefined) {
      return input;
    }
    const piKey = LEGACY_OPTION_ID_TO_PI[id] ?? id;
    if (piKey !== "thinkingLevel") {
      // Unknown option ids have no Pi equivalent; drop them.
      continue;
    }
    entries.push([piKey, option.value]);
  }
  return Object.fromEntries(entries);
}

export function normalizeLegacyModelSelection(input: {
  readonly provider: unknown;
  readonly model: string;
  readonly options: unknown;
}): Record<string, unknown> {
  const provider = inferLegacyModelProvider(input.provider, input.model);
  const options = normalizeModelOptions(readLegacyProviderOptions(input.options, provider));
  return {
    provider,
    model: input.model,
    ...(options === undefined ? {} : { options }),
  };
}

export function normalizePersistedModelSelection(input: unknown): unknown {
  if (!isRecord(input)) {
    return input;
  }

  const model = readTrimmedString(input, "model");
  if (model === undefined) {
    return input;
  }

  // Newer T3 Code writes provider-less selections as { instanceId, model } and
  // option rows as [{ id, value }]; Peak Code stores canonical provider/options objects.
  return normalizeLegacyModelSelection({
    provider: input.provider ?? input.instanceId,
    model,
    options: input.options,
  });
}
