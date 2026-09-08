// FILE: modelProviders.ts
// Purpose: Contracts for the "Model Providers" settings surface. Mirrors the
// shape of pi's `~/.pi/agent/models.json` (a provider-keyed map) while staying
// permissive about fields Peak Code does not render: unknown keys are carried
// in `extra` so editing in the settings GUI never drops provider/model config
// that pi understands.
// Layer: Shared contracts
// Exports: provider/model config schemas plus inferred types.

import { Schema } from "effect";

import { TrimmedNonEmptyString } from "./baseSchemas";

export const ModelProviderApiKind = Schema.Literals([
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generative-ai",
]);
export type ModelProviderApiKind = typeof ModelProviderApiKind.Type;

export const ModelInputKind = Schema.Literals(["text", "image"]);
export type ModelInputKind = typeof ModelInputKind.Type;

const ModelConfigCostTier = Schema.Record(Schema.String, Schema.Unknown);

export const ModelConfigCost = Schema.Struct({
  input: Schema.optional(Schema.Number),
  output: Schema.optional(Schema.Number),
  cacheRead: Schema.optional(Schema.Number),
  cacheWrite: Schema.optional(Schema.Number),
  tiers: Schema.optional(Schema.Array(ModelConfigCostTier)),
});
export type ModelConfigCost = typeof ModelConfigCost.Type;

/**
 * One model entry inside a provider's `models` array.
 *
 * The subset Peak Code edits directly plus opaque `extra` fields that are
 * preserved verbatim on save.
 */
export const CustomModelConfig = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: Schema.optional(TrimmedNonEmptyString),
  api: Schema.optional(ModelProviderApiKind),
  baseUrl: Schema.optional(TrimmedNonEmptyString),
  reasoning: Schema.optional(Schema.Boolean),
  input: Schema.optional(Schema.Array(ModelInputKind)),
  contextWindow: Schema.optional(Schema.Number),
  maxTokens: Schema.optional(Schema.Number),
  cost: Schema.optional(ModelConfigCost),
  samplingParams: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  extra: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
});
export type CustomModelConfig = typeof CustomModelConfig.Type;

/**
 * One provider entry in `models.json` (`providers["my-provider"]`).
 *
 * Fields Peak Code edits directly (`name`, `api`, `baseUrl`, `apiKey`,
 * `headers`, `models`, ...) plus `extra` carrying every key we do not model.
 */
export const ModelProviderConfig = Schema.Struct({
  name: Schema.optional(TrimmedNonEmptyString),
  api: Schema.optional(ModelProviderApiKind),
  baseUrl: Schema.optional(TrimmedNonEmptyString),
  apiKey: Schema.optional(Schema.String),
  headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  authHeader: Schema.optional(Schema.Boolean),
  modelOverrides: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  models: Schema.optional(Schema.Array(CustomModelConfig)),
  extra: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
});
export type ModelProviderConfig = typeof ModelProviderConfig.Type;

/**
 * The editable view of `models.json`: a provider-keyed map plus the resolved
 * file path so the UI can tell the user exactly where config is written.
 */
export const ModelProvidersFile = Schema.Struct({
  path: TrimmedNonEmptyString,
  providers: Schema.Record(Schema.String, ModelProviderConfig),
});
export type ModelProvidersFile = typeof ModelProvidersFile.Type;
