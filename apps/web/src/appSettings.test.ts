import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  AppSettingsSchema,
  DEFAULT_CHAT_FONT_SIZE_PX,
  DEFAULT_SIDEBAR_PROJECT_SORT_ORDER,
  DEFAULT_SIDEBAR_THREAD_SORT_ORDER,
  DEFAULT_TIMESTAMP_FORMAT,
  getAppModelOptions,
  getDefaultNativeFontSmoothing,
  getCustomModelOptionsByProvider,
  getCustomModelsByProvider,
  getCustomModelsForProvider,
  getDefaultCustomModelsForProvider,
  getGitTextGenerationModelOptions,
  getProviderStartOptions,
  MODEL_PROVIDER_SETTINGS,
  normalizeChatFontSizePx,
  normalizeCustomModelSlugs,
  normalizeStoredAppSettings,
  patchCustomModels,
  resolveAppModelSelection,
} from "./appSettings";

describe("normalizeCustomModelSlugs", () => {
  it("normalizes slugs, removes duplicates, and filters empty values", () => {
    expect(
      normalizeCustomModelSlugs([
        " custom/internal-model ",
        "gpt-5.3-codex",
        "5.3",
        "custom/internal-model",
        "",
        null,
      ]),
    ).toEqual(["custom/internal-model", "gpt-5.3-codex", "5.3"]);
  });

  it("preserves pi model slugs without alias resolution", () => {
    expect(normalizeCustomModelSlugs(["sonnet"], "pi")).toEqual(["sonnet"]);
    expect(normalizeCustomModelSlugs(["claude/custom-sonnet"], "pi")).toEqual([
      "claude/custom-sonnet",
    ]);
  });
});

describe("getAppModelOptions", () => {
  it("appends saved custom models after the built-in options", () => {
    const options = getAppModelOptions("pi", ["custom/internal-model"]);

    expect(options.map((option) => option.slug)).toEqual(["custom/internal-model"]);
  });

  it("keeps the currently selected custom model available even if it is no longer saved", () => {
    const options = getAppModelOptions("pi", [], "custom/selected-model");

    expect(options.at(-1)).toMatchObject({
      slug: "custom/selected-model",
      provider: "pi",
      isCustom: true,
    });
  });

  it("formats unknown custom models with a readable label", () => {
    const options = getAppModelOptions("pi", ["gpt-5.1-codex-max"]);

    expect(options.at(-1)).toEqual({
      slug: "gpt-5.1-codex-max",
      name: "GPT-5.1 Codex Max",
      provider: "pi",
      isCustom: true,
    });
  });

  it("keeps a saved custom provider model available as an exact slug option", () => {
    const options = getAppModelOptions("pi", ["claude/custom-opus"], "claude/custom-opus");

    expect(options.some((option) => option.slug === "claude/custom-opus" && option.isCustom)).toBe(
      true,
    );
  });
});

describe("getGitTextGenerationModelOptions", () => {
  it("merges pi custom model options for git writing settings", () => {
    const options = getGitTextGenerationModelOptions({
      customPiModels: ["custom/pi-model"],
      textGenerationModel: "openai/gpt-5",
      textGenerationProvider: "pi",
    });

    expect(options.some((option) => option.slug === "custom/pi-model")).toBe(true);
    expect(options.some((option) => option.slug === "openai/gpt-5")).toBe(true);
  });

  it("preserves a currently selected transient git writing model", () => {
    const options = getGitTextGenerationModelOptions({
      customPiModels: [],
      textGenerationModel: "openrouter/custom-model",
      textGenerationProvider: "pi",
    });

    expect(options.at(-1)).toEqual({
      slug: "openrouter/custom-model",
      name: "Custom Model",
      provider: "pi",
      isCustom: true,
    });
  });

  it("humanizes transient pi git-writing models instead of showing the raw slug", () => {
    const options = getGitTextGenerationModelOptions({
      customPiModels: [],
      textGenerationModel: "opencode-go/kimi-k2.6",
      textGenerationProvider: "pi",
    });

    expect(options.at(-1)).toEqual({
      slug: "opencode-go/kimi-k2.6",
      name: "Kimi K2.6",
      provider: "pi",
      isCustom: true,
    });
  });
});

describe("resolveAppModelSelection", () => {
  it("preserves saved custom model slugs instead of returning an empty string", () => {
    expect(resolveAppModelSelection("pi", { pi: ["galapagos-alpha"] }, "galapagos-alpha")).toBe(
      "galapagos-alpha",
    );
  });

  it("returns an empty string when no model is selected", () => {
    expect(resolveAppModelSelection("pi", { pi: [] }, "")).toBe("");
  });

  it("resolves a transient selected custom model included in the app model options", () => {
    expect(resolveAppModelSelection("pi", { pi: [] }, "custom/selected-model")).toBe(
      "custom/selected-model",
    );
  });
});

describe("timestamp format defaults", () => {
  it("defaults timestamp format to locale", () => {
    expect(DEFAULT_TIMESTAMP_FORMAT).toBe("locale");
  });
});

describe("chat font size defaults", () => {
  it("defaults chat font size to 12px", () => {
    expect(DEFAULT_CHAT_FONT_SIZE_PX).toBe(12);
  });

  it("clamps chat font size updates into the supported range", () => {
    expect(normalizeChatFontSizePx(9)).toBe(11);
    expect(normalizeChatFontSizePx(18.4)).toBe(18);
    expect(normalizeChatFontSizePx(Number.NaN)).toBe(DEFAULT_CHAT_FONT_SIZE_PX);
  });
});

describe("sidebar sort defaults", () => {
  it("defaults project sorting to manual", () => {
    expect(DEFAULT_SIDEBAR_PROJECT_SORT_ORDER).toBe("manual");
  });

  it("defaults thread sorting to updated_at", () => {
    expect(DEFAULT_SIDEBAR_THREAD_SORT_ORDER).toBe("updated_at");
  });
});

describe("normalizeStoredAppSettings", () => {
  it("defaults native font smoothing by platform", () => {
    expect(getDefaultNativeFontSmoothing("MacIntel")).toBe(true);
    expect(getDefaultNativeFontSmoothing("Win32")).toBe(false);
    expect(getDefaultNativeFontSmoothing("Linux x86_64")).toBe(false);
  });

  it("uses the current platform default for existing settings without a stored value", () => {
    const decodedSettings = Schema.decodeSync(Schema.fromJsonString(AppSettingsSchema))("{}");

    expect(decodedSettings.enableNativeFontSmoothing).toBe(getDefaultNativeFontSmoothing());
  });

  it("preserves an explicitly stored updated_at project sort order", () => {
    const decodedSettings = Schema.decodeSync(Schema.fromJsonString(AppSettingsSchema))(
      JSON.stringify({
        sidebarProjectSortOrder: "updated_at",
        chatFontSizePx: 99,
        customPiModels: [" custom/internal-model ", "gpt-5.4", "custom/internal-model"],
      }),
    );

    expect(normalizeStoredAppSettings(decodedSettings)).toMatchObject({
      sidebarProjectSortOrder: "updated_at",
      chatFontSizePx: 18,
      customPiModels: ["custom/internal-model", "gpt-5.4"],
    });
  });
});

describe("provider-specific custom models", () => {
  it("includes pi custom slugs in the pi model list", () => {
    const piOptions = getAppModelOptions("pi", ["claude/custom-opus"]);

    expect(piOptions.some((option) => option.slug === "claude/custom-opus")).toBe(true);
  });
});

describe("getProviderStartOptions", () => {
  it("returns only populated pi overrides", () => {
    expect(
      getProviderStartOptions({
        piAgentDir: "/Users/you/.pi",
        piBinaryPath: "/usr/local/bin/pi",
      }),
    ).toEqual({
      pi: {
        binaryPath: "/usr/local/bin/pi",
        agentDir: "/Users/you/.pi",
      },
    });
  });

  it("returns undefined when no provider overrides are configured", () => {
    expect(
      getProviderStartOptions({
        piAgentDir: "",
        piBinaryPath: "",
      }),
    ).toBeUndefined();
  });
});

describe("provider-indexed custom model settings", () => {
  const settings = {
    customPiModels: ["anthropic/custom-pi"],
  } as const;

  it("exports one provider config per provider", () => {
    expect(MODEL_PROVIDER_SETTINGS.map((config) => config.provider)).toEqual(["pi"]);
  });

  it("reads custom models for pi", () => {
    expect(getCustomModelsForProvider(settings, "pi")).toEqual(["anthropic/custom-pi"]);
  });

  it("reads default custom models for pi", () => {
    const defaults = {
      customPiModels: ["anthropic/default-pi"],
    } as const;

    expect(getDefaultCustomModelsForProvider(defaults, "pi")).toEqual(["anthropic/default-pi"]);
  });

  it("patches custom models for pi", () => {
    expect(patchCustomModels("pi", ["anthropic/custom-pi"])).toEqual({
      customPiModels: ["anthropic/custom-pi"],
    });
  });

  it("builds a complete provider-indexed custom model record", () => {
    expect(getCustomModelsByProvider(settings)).toEqual({
      pi: ["anthropic/custom-pi"],
    });
  });

  it("builds provider-indexed model options including custom models", () => {
    const modelOptionsByProvider = getCustomModelOptionsByProvider(settings);

    expect(modelOptionsByProvider.pi.some((option) => option.slug === "anthropic/custom-pi")).toBe(
      true,
    );
  });

  it("normalizes and deduplicates custom model options per provider", () => {
    const modelOptionsByProvider = getCustomModelOptionsByProvider({
      customPiModels: [
        " anthropic/claude-sonnet-4-5 ",
        "anthropic/custom-pi",
        "anthropic/custom-pi",
      ],
    });

    expect(
      modelOptionsByProvider.pi.filter((option) => option.slug === "anthropic/custom-pi"),
    ).toHaveLength(1);
    expect(
      modelOptionsByProvider.pi.some((option) => option.slug === "anthropic/claude-sonnet-4-5"),
    ).toBe(true);
  });
});

describe("AppSettingsSchema", () => {
  it("fills decoding defaults for persisted settings that predate newer keys", () => {
    const decode = Schema.decodeSync(Schema.fromJsonString(AppSettingsSchema));

    expect(
      decode(
        JSON.stringify({
          piBinaryPath: "/usr/local/bin/pi",
          confirmThreadDelete: false,
        }),
      ),
    ).toMatchObject({
      piBinaryPath: "/usr/local/bin/pi",
      piAgentDir: "",
      chatFontSizePx: DEFAULT_CHAT_FONT_SIZE_PX,
      defaultThreadEnvMode: "local",
      confirmThreadDelete: false,
      confirmTerminalTabClose: true,
      enableAssistantStreaming: false,
      sidebarProjectSortOrder: DEFAULT_SIDEBAR_PROJECT_SORT_ORDER,
      sidebarThreadSortOrder: DEFAULT_SIDEBAR_THREAD_SORT_ORDER,
      timestampFormat: DEFAULT_TIMESTAMP_FORMAT,
      customPiModels: [],
    });
  });
});
