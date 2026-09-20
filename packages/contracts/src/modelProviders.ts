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

/**
 * Input kinds pi accepts in a model's `input` array. pi validates `models.json`
 * against this exact union and rejects the whole file for any other value, so
 * keep it in sync with pi's `ModelDefinitionSchema`.
 */
export const ModelInputKind = Schema.Literals(["text", "image"]);
export type ModelInputKind = typeof ModelInputKind.Type;

/**
 * Input kinds the "输入类型" picker offers. `video`/`pdf` are not in pi's
 * schema, so they are stored in `CustomModelConfig.inputTypes` (a key pi
 * ignores) instead of `input`, which would invalidate the file.
 */
export const ModelInputTypeKind = Schema.Literals(["text", "image", "video", "pdf"]);
export type ModelInputTypeKind = typeof ModelInputTypeKind.Type;

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
  /**
   * Full input-kind selection from the settings GUI. Only written when it goes
   * beyond what `input` can express (see {@link ModelInputTypeKind}).
   */
  inputTypes: Schema.optional(Schema.Array(ModelInputTypeKind)),
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
 *
 * `apiKey` holds a *reference* (`$ENV_VAR`, `${ENV_VAR}` or `!command`), which is
 * configuration rather than a secret and so belongs in this file. A literal key is a
 * secret: it is kept in pi's credential store instead (`hasStoredKey`), never here. The
 * two are mutually exclusive because a stored credential outranks a configured key, so
 * keeping both would silently ignore whichever one lost.
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
  /** Read-only: a key for this provider is stored in the credential store. */
  hasStoredKey: Schema.optional(Schema.Boolean),
  /** Write-only: forget the stored key. Ignored when `apiKey` carries a new key. */
  clearStoredKey: Schema.optional(Schema.Boolean),
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
