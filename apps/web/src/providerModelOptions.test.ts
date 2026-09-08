// FILE: providerModelOptions.test.ts
// Purpose: Verifies provider-aware model-name formatting for picker and composer labels.
// Layer: Web unit tests
// Depends on: providerModelOptions shared formatting helpers.

import { describe, expect, it } from "vitest";

import {
  buildProviderOptionPatch,
  formatProviderModelOptionName,
  groupProviderModelOptions,
  groupProviderModelOptionsWithFavorites,
  type ProviderModelOption,
} from "./providerModelOptions";

describe("formatProviderModelOptionName", () => {
  it("humanizes unknown pi runtime model slugs using the model identifier", () => {
    expect(
      formatProviderModelOptionName({
        provider: "pi",
        slug: "opencode-go/kimi-k2.6",
      }),
    ).toBe("Kimi K2.6");
  });

  it("keeps known model slugs on their shared display names", () => {
    expect(
      formatProviderModelOptionName({
        provider: "pi",
        slug: "openai/gpt-5",
      }),
    ).toBe("GPT-5");
  });

  it("humanizes unknown pi slugs into readable labels", () => {
    expect(
      formatProviderModelOptionName({
        provider: "pi",
        slug: "custom/internal-model",
      }),
    ).toBe("Internal Model");
  });
});

describe("buildProviderOptionPatch", () => {
  it("passes through option ids unchanged for pi", () => {
    expect(buildProviderOptionPatch("pi", "thinkingBudget", "512")).toEqual({
      thinkingBudget: "512",
    });
    expect(buildProviderOptionPatch("pi", "thinkingLevel", "HIGH")).toEqual({
      thinkingLevel: "HIGH",
    });
  });

  it("passes through non-Gemini option ids unchanged", () => {
    expect(buildProviderOptionPatch("pi", "reasoningEffort", "xhigh")).toEqual({
      reasoningEffort: "xhigh",
    });
    expect(buildProviderOptionPatch("pi", "reasoningEffort", "high")).toEqual({
      reasoningEffort: "high",
    });
    expect(buildProviderOptionPatch("pi", "fastMode", true)).toEqual({ fastMode: true });
  });
});

describe("groupProviderModelOptions", () => {
  it("groups provider models by upstream provider", () => {
    const options = [
      {
        slug: "anthropic/claude-sonnet",
        name: "Claude Sonnet",
        upstreamProviderId: "anthropic",
        upstreamProviderName: "Anthropic",
      },
      {
        slug: "openai/gpt-5",
        name: "GPT-5",
        upstreamProviderId: "openai",
        upstreamProviderName: "OpenAI",
      },
    ] satisfies ProviderModelOption[];

    const groupedOptions = groupProviderModelOptions(options);

    expect(groupedOptions.map((group) => group.label)).toEqual(["Anthropic", "OpenAI"]);
  });
});

describe("groupProviderModelOptionsWithFavorites", () => {
  it("adds a favourites group ahead of the normal provider groups", () => {
    const options = [
      {
        slug: "anthropic/claude-sonnet",
        name: "Claude Sonnet",
        upstreamProviderId: "anthropic",
        upstreamProviderName: "Anthropic",
      },
      {
        slug: "openai/gpt-5",
        name: "GPT-5",
        upstreamProviderId: "openai",
        upstreamProviderName: "OpenAI",
      },
    ] satisfies ProviderModelOption[];

    const groupedOptions = groupProviderModelOptionsWithFavorites({
      options,
      favoriteSlugs: new Set(["openai/gpt-5"]),
    });

    expect(groupedOptions.map((group) => group.label)).toEqual(["Favourites", "Anthropic"]);
    expect(groupedOptions[0]?.options.map((option) => option.slug)).toEqual(["openai/gpt-5"]);
    expect(groupedOptions.flatMap((group) => group.options.map((option) => option.slug))).toEqual([
      "openai/gpt-5",
      "anthropic/claude-sonnet",
    ]);
  });
});
