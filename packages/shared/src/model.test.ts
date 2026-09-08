import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL_BY_PROVIDER, MODEL_OPTIONS_BY_PROVIDER } from "@peakcode/contracts";

import {
  buildProviderOptionSelectionsFromDescriptors,
  formatModelDisplayName,
  getDefaultContextWindow,
  getDefaultEffort,
  getDefaultModel,
  getModelCapabilities,
  getModelOptions,
  getModelSelectionBooleanOptionValue,
  getModelSelectionOptionValue,
  getModelSelectionStringOptionValue,
  getProviderOptionCurrentLabel,
  getProviderOptionDescriptors,
  hasContextWindowOption,
  hasEffortLevel,
  normalizeModelSlug,
  normalizePiModelOptions,
  resolveLabeledOptionValue,
  resolveModelSlug,
  resolveModelSlugForProvider,
  resolveSelectableModel,
} from "./model";

describe("pi model options", () => {
  it("exposes an empty built-in model table for pi", () => {
    expect(getModelOptions("pi")).toEqual([]);
    expect(MODEL_OPTIONS_BY_PROVIDER.pi).toEqual([]);
  });

  it("returns no static default model for pi", () => {
    expect(getDefaultModel("pi")).toBeNull();
    expect(getDefaultModel()).toBeNull();
    expect(Object.keys(DEFAULT_MODEL_BY_PROVIDER)).toEqual([]);
  });
});

describe("normalizeModelSlug", () => {
  it("returns null for empty or missing values", () => {
    expect(normalizeModelSlug("")).toBeNull();
    expect(normalizeModelSlug("   ")).toBeNull();
    expect(normalizeModelSlug(null)).toBeNull();
    expect(normalizeModelSlug(undefined)).toBeNull();
  });

  it("preserves non-aliased model slugs since pi has no aliases", () => {
    expect(normalizeModelSlug("gpt-5.2")).toBe("gpt-5.2");
    expect(normalizeModelSlug("5.5")).toBe("5.5");
  });

  it("does not leak prototype properties as aliases", () => {
    expect(normalizeModelSlug("toString")).toBe("toString");
    expect(normalizeModelSlug("constructor")).toBe("constructor");
  });
});

describe("resolveModelSlug", () => {
  it("returns null when the model is missing", () => {
    expect(resolveModelSlug(undefined)).toBeNull();
    expect(resolveModelSlug(null)).toBeNull();
  });

  it("preserves known and unknown custom models", () => {
    expect(resolveModelSlug("gpt-4.1")).toBe("gpt-4.1");
    expect(resolveModelSlug("openai/gpt-5.5")).toBe("openai/gpt-5.5");
  });

  it("supports provider-aware resolution for pi", () => {
    expect(resolveModelSlugForProvider("pi", undefined)).toBeNull();
    expect(resolveModelSlugForProvider("pi", "openai/gpt-5.5")).toBe("openai/gpt-5.5");
  });
});

describe("resolveSelectableModel", () => {
  const options = [
    { slug: "openai/gpt-5.4", name: "GPT-5.4" },
    { slug: "openai/gpt-5.3", name: "GPT-5.3" },
  ];

  it("resolves exact slug matches", () => {
    expect(resolveSelectableModel("pi", "openai/gpt-5.4", options)).toBe("openai/gpt-5.4");
  });

  it("resolves case-insensitive display-name matches", () => {
    expect(resolveSelectableModel("pi", "gpt-5.4", options)).toBe("openai/gpt-5.4");
  });

  it("returns null for empty input", () => {
    expect(resolveSelectableModel("pi", "", options)).toBeNull();
    expect(resolveSelectableModel("pi", "   ", options)).toBeNull();
    expect(resolveSelectableModel("pi", null, options)).toBeNull();
  });

  it("returns null for unknown values that are not present in options", () => {
    expect(resolveSelectableModel("pi", "unknown/model", options)).toBeNull();
  });
});

describe("getModelCapabilities", () => {
  it("returns empty capabilities for pi since no built-in models exist", () => {
    const caps = getModelCapabilities("pi", "openai/gpt-5.4");
    expect(caps.reasoningEffortLevels).toEqual([]);
    expect(caps.supportsFastMode).toBe(false);
    expect(caps.supportsThinkingToggle).toBe(false);
    expect(caps.contextWindowOptions).toEqual([]);
  });

  it("returns empty capabilities for unknown providers/models", () => {
    expect(getModelCapabilities("pi", undefined).reasoningEffortLevels).toEqual([]);
  });
});

describe("getDefaultEffort and hasEffortLevel", () => {
  it("return null / false for empty pi capabilities", () => {
    const caps = getModelCapabilities("pi", "openai/gpt-5.4");
    expect(getDefaultEffort(caps)).toBeNull();
    expect(hasEffortLevel(caps, "high")).toBe(false);
  });
});

describe("context window helpers", () => {
  it("return null / false for empty pi capabilities", () => {
    const caps = getModelCapabilities("pi", "openai/gpt-5.4");
    expect(getDefaultContextWindow(caps)).toBeNull();
    expect(hasContextWindowOption(caps, "200k")).toBe(false);
  });
});

describe("provider option descriptor helpers", () => {
  it("generates no option descriptors for empty pi capabilities", () => {
    const descriptors = getProviderOptionDescriptors({
      provider: "pi",
      caps: getModelCapabilities("pi", "openai/gpt-5.4"),
      selections: {},
    });

    expect(descriptors).toEqual([]);
    expect(buildProviderOptionSelectionsFromDescriptors(descriptors)).toBeUndefined();
  });

  it("maps pi reasoning controls onto the thinkingLevel option", () => {
    const descriptors = getProviderOptionDescriptors({
      provider: "pi",
      caps: {
        reasoningEffortLevels: [
          { value: "off", label: "Off" },
          { value: "medium", label: "Medium", isDefault: true },
          { value: "xhigh", label: "Extra High" },
        ],
        supportsFastMode: false,
        supportsThinkingToggle: false,
        promptInjectedEffortLevels: [],
        contextWindowOptions: [],
      },
      selections: { thinkingLevel: "xhigh" },
    });

    expect(descriptors.find((descriptor) => descriptor.id === "thinkingLevel")).toMatchObject({
      type: "select",
      currentValue: "xhigh",
    });
    expect(descriptors.some((descriptor) => descriptor.id === "reasoningEffort")).toBe(false);
    expect(getProviderOptionCurrentLabel(descriptors[0])).toBe("Extra High");
  });

  it("honors explicit descriptors and serializes their current values", () => {
    const descriptors = getProviderOptionDescriptors({
      provider: "pi",
      caps: {
        ...getModelCapabilities("pi", "openai/gpt-5.4"),
        optionDescriptors: [
          {
            id: "reasoningDepth",
            label: "Reasoning Depth",
            type: "select",
            options: [
              { id: "normal", label: "Normal", isDefault: true },
              { id: "deep", label: "Deep" },
            ],
          },
        ],
      },
      selections: [{ id: "reasoningDepth", value: "deep" }],
    });

    expect(descriptors).toHaveLength(1);
    expect(descriptors[0]).toMatchObject({ id: "reasoningDepth", currentValue: "deep" });
    expect(buildProviderOptionSelectionsFromDescriptors(descriptors)).toEqual([
      { id: "reasoningDepth", value: "deep" },
    ]);
  });
});

describe("model selection option value helpers", () => {
  const piSelection = {
    provider: "pi" as const,
    model: "openai/gpt-5.4",
    options: {
      thinkingLevel: "xhigh" as const,
      fastMode: true,
    },
  };

  it("reads string and boolean option values from a model selection", () => {
    expect(getModelSelectionOptionValue(piSelection, "thinkingLevel")).toBe("xhigh");
    expect(getModelSelectionStringOptionValue(piSelection, "thinkingLevel")).toBe("xhigh");
    expect(getModelSelectionBooleanOptionValue(piSelection, "fastMode")).toBe(true);
    expect(getModelSelectionStringOptionValue(piSelection, "missing")).toBeUndefined();
  });

  it("returns undefined for empty or null selections", () => {
    expect(getModelSelectionOptionValue(null, "thinkingLevel")).toBeUndefined();
  });
});

describe("resolveLabeledOptionValue", () => {
  it("returns raw value when no options are provided", () => {
    expect(resolveLabeledOptionValue(undefined, "openai/gpt-5.4")).toBe("openai/gpt-5.4");
  });

  it("falls back to the default option when the value is not in options", () => {
    expect(
      resolveLabeledOptionValue([{ value: "a", isDefault: true }, { value: "b" }], "unknown"),
    ).toBe("a");
  });
});

describe("normalizePiModelOptions", () => {
  it("drops invalid thinking levels and trims whitespace", () => {
    expect(normalizePiModelOptions({ thinkingLevel: "medium" })).toEqual({
      thinkingLevel: "medium",
    });
    // Runtime data may arrive untyped; casting simulates loosely-typed payloads.
    expect(normalizePiModelOptions({ thinkingLevel: " high " as never })).toEqual({
      thinkingLevel: "high",
    });
    expect(normalizePiModelOptions(null)).toBeUndefined();
    expect(normalizePiModelOptions(undefined)).toBeUndefined();
    expect(normalizePiModelOptions({ thinkingLevel: "invalid" as never })).toBeUndefined();
  });
});

describe("formatModelDisplayName", () => {
  it("humanizes unknown GPT model slugs", () => {
    expect(formatModelDisplayName("gpt-4.1")).toBe("GPT-4.1");
  });

  it("leaves non-GPT custom slugs unchanged", () => {
    expect(formatModelDisplayName("custom/internal-model")).toBe("custom/internal-model");
  });

  it("returns undefined for empty or missing values", () => {
    expect(formatModelDisplayName(null)).toBeUndefined();
    expect(formatModelDisplayName("")).toBeUndefined();
  });
});
