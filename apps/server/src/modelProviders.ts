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
