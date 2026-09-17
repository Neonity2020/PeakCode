import {
  type ModelSelection,
  type ServerSettings,
  type ServerSettingsPatch,
} from "@peakcode/contracts";
import { deepMerge, type DeepPartial } from "./Struct";

type ModelSelectionPatch = ServerSettingsPatch["textGenerationModelSelection"];

function shouldReplaceModelSelection(patch: ModelSelectionPatch | undefined): boolean {
  return Boolean(patch && (patch.provider !== undefined || patch.model !== undefined));
}

/**
 * Merge a selection patch into a stored one, or null when the result carries no model.
 *
 * A patch that names neither a provider nor a model is only about `options`, and keeps the
 * stored selection; one that does name them starts from the patch, but keeps the current
 * model string when only the provider changes — Pi has no static default model to fall
 * back to. An empty model is "no selection", which callers handle per setting: the
 * text-generation model is required and keeps its previous value, the chat default is
 * optional and disappears.
 */
function applyModelSelectionPatch(
  current: ModelSelection | null,
  patch: ModelSelectionPatch | undefined,
): ModelSelection | null {
  const provider = patch?.provider ?? current?.provider ?? "pi";
  const model = patch?.model ?? current?.model ?? "";
  if (model.trim().length === 0) return null;
  const options = shouldReplaceModelSelection(patch)
    ? patch?.options
    : (patch?.options ?? current?.options);

  return {
    provider,
    model,
    ...(options !== undefined ? { options } : {}),
  } as ModelSelection;
}

export function applyServerSettingsPatch(
  current: ServerSettings,
  patch: ServerSettingsPatch,
): ServerSettings {
  const textGenerationPatch = patch.textGenerationModelSelection;
  const defaultModelPatch = patch.defaultModelSelection;
  const next = deepMerge(current, patch as DeepPartial<ServerSettings>);

  const withTextGeneration = textGenerationPatch
    ? {
        ...next,
        textGenerationModelSelection:
          applyModelSelectionPatch(current.textGenerationModelSelection, textGenerationPatch) ??
          current.textGenerationModelSelection,
      }
    : next;
  if (!defaultModelPatch) {
    return withTextGeneration;
  }

  const defaultModelSelection = applyModelSelectionPatch(
    current.defaultModelSelection ?? null,
    defaultModelPatch,
  );
  const { defaultModelSelection: _previous, ...withoutDefaultModel } = withTextGeneration;

  return defaultModelSelection === null
    ? (withoutDefaultModel as ServerSettings)
    : { ...withTextGeneration, defaultModelSelection };
}
