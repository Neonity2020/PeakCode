// FILE: modelProviders.ts
// Purpose: Read/write the pi `models.json` provider map for the settings GUI.
// The file lives at `<agentDir>/models.json` (default `~/.pi/agent/models.json`)
// and is consumed by pi's ModelRegistry, which hot-reloads on refresh, so no
// server restart is needed after a save.
//
// Editing is lossless: providers round-trip through `ModelProviderConfig` which
// carries unknown keys in `extra`, and saving preserves every top-level key in
// the file that is not `providers`.
// Module: server
import path from "node:path";

import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type {
  CustomModelConfig,
  ModelInputTypeKind,
  ModelProviderApiKind,
  ModelProviderConfig,
  ModelProvidersFile,
  ServerSaveModelProvidersInput,
} from "@peakcode/contracts";
import { Effect, FileSystem, Path } from "effect";

import { writeFileStringAtomically } from "./atomicWrite";

const MODEL_ENTRY_EDITABLE_KEYS = new Set<string>([
  "id",
  "name",
  "api",
  "baseUrl",
  "reasoning",
  "input",
  "inputTypes",
  "contextWindow",
  "maxTokens",
  "cost",
  "samplingParams",
  "headers",
]);

const PROVIDER_EDITABLE_KEYS = new Set<string>([
  "name",
  "api",
  "baseUrl",
  "apiKey",
  "headers",
  "authHeader",
  "modelOverrides",
  "models",
]);

const MODEL_PROVIDER_API_KINDS: readonly string[] = [
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generative-ai",
];

const MODEL_INPUT_KINDS: readonly string[] = ["text", "image"];

// `inputTypes` is a Peak Code extension: pi ignores unknown model keys, and its
// own schema rejects anything outside MODEL_INPUT_KINDS in `input`.
const MODEL_INPUT_TYPE_KINDS: readonly string[] = ["text", "image", "video", "pdf"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isApiKind(value: unknown): value is ModelProviderApiKind {
  return typeof value === "string" && MODEL_PROVIDER_API_KINDS.includes(value);
}

function asInputKinds(value: unknown): CustomModelConfig["input"] {
  if (!Array.isArray(value)) return undefined;
  const kinds = value.filter(
    (kind): kind is "text" | "image" =>
      typeof kind === "string" && MODEL_INPUT_KINDS.includes(kind),
  );
  return kinds.length > 0 ? kinds : undefined;
}

function asInputTypes(value: unknown): CustomModelConfig["inputTypes"] {
  if (!Array.isArray(value)) return undefined;
  const kinds = value.filter(
    (kind): kind is ModelInputTypeKind =>
      typeof kind === "string" && MODEL_INPUT_TYPE_KINDS.includes(kind),
  );
  return kinds.length > 0 ? kinds : undefined;
}

function asStringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const record: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") record[key] = entry;
  }
  return Object.keys(record).length > 0 ? record : undefined;
}

function asNumberRecord(value: unknown): Record<string, number> | undefined {
  if (!isRecord(value)) return undefined;
  const record: Record<string, number> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "number") record[key] = entry;
  }
  return Object.keys(record).length > 0 ? record : undefined;
}

function pickExtra(raw: Record<string, unknown>, editableKeys: ReadonlySet<string>) {
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!editableKeys.has(key)) extra[key] = value;
  }
  return extra;
}

// ── Pure conversions (round-trip without data loss) ──────────────────────

export function modelEntryFromJson(raw: unknown): CustomModelConfig | null {
  if (!isRecord(raw)) return null;
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  if (id.length === 0) return null;

  const input = asInputKinds(raw.input);
  const inputTypes = asInputTypes(raw.inputTypes);
  const cost = asNumberRecord(raw.cost);
  const samplingParams = isRecord(raw.samplingParams) ? raw.samplingParams : undefined;
  const headers = asStringRecord(raw.headers);
  const extra = pickExtra(raw, MODEL_ENTRY_EDITABLE_KEYS);

  const entry: CustomModelConfig = {
    id,
    ...(typeof raw.name === "string" && raw.name.trim().length > 0 ? { name: raw.name } : {}),
    ...(isApiKind(raw.api) ? { api: raw.api } : {}),
    ...(typeof raw.baseUrl === "string" && raw.baseUrl.trim().length > 0
      ? { baseUrl: raw.baseUrl }
      : {}),
    ...(typeof raw.reasoning === "boolean" ? { reasoning: raw.reasoning } : {}),
    ...(input ? { input } : {}),
    ...(inputTypes ? { inputTypes } : {}),
    ...(typeof raw.contextWindow === "number" ? { contextWindow: raw.contextWindow } : {}),
    ...(typeof raw.maxTokens === "number" ? { maxTokens: raw.maxTokens } : {}),
    ...(cost ? { cost } : {}),
    ...(samplingParams && Object.keys(samplingParams).length > 0 ? { samplingParams } : {}),
    ...(headers ? { headers } : {}),
    ...(Object.keys(extra).length > 0 ? { extra } : {}),
  };
  return entry;
}

export function modelEntryToJson(entry: CustomModelConfig): Record<string, unknown> {
  const json: Record<string, unknown> = { id: entry.id };
  if (entry.name) json.name = entry.name;
  if (entry.api) json.api = entry.api;
  if (entry.baseUrl) json.baseUrl = entry.baseUrl;
  if (entry.reasoning !== undefined) json.reasoning = entry.reasoning;
  if (entry.input) json.input = entry.input;
  if (entry.inputTypes) json.inputTypes = entry.inputTypes;
  if (entry.contextWindow !== undefined) json.contextWindow = entry.contextWindow;
  if (entry.maxTokens !== undefined) json.maxTokens = entry.maxTokens;
  if (entry.cost) json.cost = entry.cost;
  if (entry.samplingParams) json.samplingParams = entry.samplingParams;
  if (entry.headers) json.headers = entry.headers;
  return { ...json, ...(entry.extra ?? {}) };
}

export function providerFromJson(name: string, raw: unknown): ModelProviderConfig | null {
  if (!isRecord(raw)) return null;

  const headers = asStringRecord(raw.headers);
  const extra = pickExtra(raw, PROVIDER_EDITABLE_KEYS);
  const models: CustomModelConfig[] = [];
  if (Array.isArray(raw.models)) {
    for (const modelRaw of raw.models) {
      const model = modelEntryFromJson(modelRaw);
      if (model) models.push(model);
    }
  }

  const config: ModelProviderConfig = {
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name : name,
    ...(isApiKind(raw.api) ? { api: raw.api } : {}),
    ...(typeof raw.baseUrl === "string" && raw.baseUrl.trim().length > 0
      ? { baseUrl: raw.baseUrl }
      : {}),
    ...(typeof raw.apiKey === "string" ? { apiKey: raw.apiKey } : {}),
    ...(headers ? { headers } : {}),
    ...(typeof raw.authHeader === "boolean" ? { authHeader: raw.authHeader } : {}),
    ...(isRecord(raw.modelOverrides) ? { modelOverrides: raw.modelOverrides } : {}),
    ...(models.length > 0 ? { models } : {}),
    ...(Object.keys(extra).length > 0 ? { extra } : {}),
  };
  return config;
}

export function providerToJson(config: ModelProviderConfig): Record<string, unknown> {
  const json: Record<string, unknown> = {};
  if (config.name) json.name = config.name;
  if (config.api) json.api = config.api;
  if (config.baseUrl) json.baseUrl = config.baseUrl;
  if (config.apiKey) json.apiKey = config.apiKey;
  if (config.headers) json.headers = config.headers;
  if (config.authHeader !== undefined) json.authHeader = config.authHeader;
  if (config.modelOverrides) json.modelOverrides = config.modelOverrides;
  if (config.models) json.models = config.models.map(modelEntryToJson);
  return { ...json, ...(config.extra ?? {}) };
}

// ── File service (Effect, FileSystem-backed) ──────────────────────────────

function modelsFilePath(agentDir: string | undefined): string {
  return path.join(agentDir?.trim() || getAgentDir(), "models.json");
}

function parseModelsJson(raw: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) {
    throw new Error("models.json must contain a JSON object");
  }
  return parsed;
}

function providersFromJson(topLevel: Record<string, unknown>): Record<string, ModelProviderConfig> {
  const rawProviders = topLevel.providers;
  if (rawProviders === undefined) return {};
  if (!isRecord(rawProviders)) {
    throw new Error('models.json "providers" must be an object');
  }
  const providers: Record<string, ModelProviderConfig> = {};
  for (const [name, rawProvider] of Object.entries(rawProviders)) {
    const provider = providerFromJson(name, rawProvider);
    if (provider) providers[name] = provider;
  }
  return providers;
}

/**
 * The model ids each provider in `models.json` declares, or null when that provider
 * falls back to the built-in catalogue.
 *
 * A provider entry that lists no models means "whatever the provider ships"; one that
 * lists models means exactly those. Model discovery uses this to stop advertising a
 * provider's catalogue entries that the user's own endpoint does not serve: an aggregator
 * configured with a single model otherwise still shows the provider's whole default list,
 * and anything that picks one of those — a configured default, the first-model fallback —
 * dies on its first request with `model_unavailable`.
 *
 * A file that cannot be parsed declares nothing: this only ever narrows a list, so a
 * broken file must not remove options.
 */
export function declaredModelIdsFromModelsJson(
  raw: string,
): Record<string, ReadonlySet<string> | null> {
  let topLevel: Record<string, unknown>;
  try {
    topLevel = parseModelsJson(raw);
  } catch {
    return {};
  }
  const rawProviders = topLevel.providers;
  if (!isRecord(rawProviders)) return {};

  const declared: Record<string, ReadonlySet<string> | null> = {};
  for (const [name, rawProvider] of Object.entries(rawProviders)) {
    if (!isRecord(rawProvider)) continue;
    const rawModels = rawProvider.models;
    if (!Array.isArray(rawModels)) {
      declared[name] = null;
      continue;
    }
    const ids = new Set<string>();
    for (const rawModel of rawModels) {
      if (!isRecord(rawModel)) continue;
      const id = typeof rawModel.id === "string" ? rawModel.id.trim() : "";
      if (id.length > 0) ids.add(id);
    }
    declared[name] = ids;
  }
  return declared;
}

/**
 * Read the current editable view of `models.json`. Missing file yields an empty
 * provider map; malformed JSON fails so the UI can surface the problem instead
 * of silently wiping user config on the next save.
 */
export const readModelProvidersFile = (
  agentDir?: string,
): Effect.Effect<ModelProvidersFile, Error, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const filePath = modelsFilePath(agentDir);
    if (!(yield* fs.exists(filePath))) {
      return { path: filePath, providers: {} };
    }
    const raw = yield* fs.readFileString(filePath);
    const topLevel = yield* Effect.try({
      try: () => parseModelsJson(raw),
      catch: (cause) =>
        new Error(
          `Failed to parse ${filePath}: ${cause instanceof Error ? cause.message : String(cause)}`,
          {
            cause,
          },
        ),
    });
    return {
      path: filePath,
      providers: yield* Effect.try({
        try: () => providersFromJson(topLevel),
        catch: (cause) =>
          new Error(
            `Failed to parse providers in ${filePath}: ${cause instanceof Error ? cause.message : String(cause)}`,
            {
              cause,
            },
          ),
      }),
    };
  });

/**
 * Persist the edited provider map. Unknown top-level keys in the existing file
 * are preserved; `providers` is replaced wholesale (providers themselves
 * round-trip unknown keys through `extra`). Chmod 0600 after writing to keep
 * any embedded key material at the same permission level pi uses.
 */
export const saveModelProvidersFile = (
  input: ServerSaveModelProvidersInput,
): Effect.Effect<ModelProvidersFile, Error, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const filePath = modelsFilePath(input.agentDir);

    let topLevel: Record<string, unknown> = {};
    if (yield* fs.exists(filePath)) {
      const existingRaw = yield* fs.readFileString(filePath);
      const parsed = yield* Effect.try({
        try: () => parseModelsJson(existingRaw),
        catch: (cause) =>
          new Error(
            `Refusing to overwrite malformed ${filePath}: ${cause instanceof Error ? cause.message : String(cause)}. Fix the file manually first.`,
            { cause },
          ),
      });
      topLevel = parsed;
    }

    const providersJson: Record<string, unknown> = {};
    for (const [name, provider] of Object.entries(input.providers)) {
      providersJson[name] = providerToJson(provider);
    }
    const merged = { ...topLevel, providers: providersJson };
    yield* writeFileStringAtomically({
      filePath,
      contents: `${JSON.stringify(merged, null, 2)}\n`,
    });
    yield* fs.chmod(filePath, 0o600);
    return {
      path: filePath,
      providers: yield* Effect.try({
        try: () => providersFromJson(merged),
        catch: (cause) =>
          new Error(
            `Failed to re-read ${filePath}: ${cause instanceof Error ? cause.message : String(cause)}`,
            { cause },
          ),
      }),
    };
  });
