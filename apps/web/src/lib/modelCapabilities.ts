// FILE: modelCapabilities.ts
// Purpose: Translate between the "输入类型" picker in the model dialog and the
// fields written to models.json.
// Layer: Web UI support
//
// pi validates models.json strictly: a model's `input` may only contain
// "text"/"image", and any other value makes pi reject the *whole* file and fall
// back to built-in models. Extra kinds the picker offers (video/pdf) are
// therefore kept in `inputTypes`, a key pi ignores, instead of `input`.

import type { CustomModelConfig, ModelInputTypeKind } from "@peakcode/contracts";

/** Render order of the capability picker. */
export const INPUT_TYPE_ORDER: readonly ModelInputTypeKind[] = ["text", "image", "video", "pdf"];

/** Every chat model takes text, so the picker keeps it checked and locked. */
export const BASE_INPUT_TYPE: ModelInputTypeKind = "text";

/** The subset pi's own schema accepts in `input`. */
const PI_INPUT_TYPES: ReadonlySet<ModelInputTypeKind> = new Set(["text", "image"]);

function isPiInputType(kind: ModelInputTypeKind): kind is "text" | "image" {
  return PI_INPUT_TYPES.has(kind);
}

function normalize(kinds: Iterable<ModelInputTypeKind>): ModelInputTypeKind[] {
  const selected = new Set(kinds);
  selected.add(BASE_INPUT_TYPE);
  return INPUT_TYPE_ORDER.filter((kind) => selected.has(kind));
}

/**
 * Input kinds a model advertises. Models configured before the picker existed
 * only carry `input`; models edited here also carry `inputTypes`.
 */
export function modelInputTypes(model: CustomModelConfig): ModelInputTypeKind[] {
  return normalize(model.inputTypes ?? model.input ?? []);
}

/** Write a picker selection back onto a model, keeping pi's `input` valid. */
export function withModelInputTypes(
  model: CustomModelConfig,
  kinds: Iterable<ModelInputTypeKind>,
): CustomModelConfig {
  const selected = normalize(kinds);
  const input = selected.filter(isPiInputType);
  // Property order survives the spread, so untouched keys stay where they were
  // and the panel's JSON-text draft comparison stays accurate.
  const next: CustomModelConfig = { ...model, input };
  if (selected.length !== input.length) {
    return Object.assign({ ...next }, { inputTypes: selected });
  }
  const { inputTypes: _dropped, ...withoutInputTypes } = next;
  return withoutInputTypes;
}
