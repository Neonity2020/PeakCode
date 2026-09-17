import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import { ServerSettingsService } from "../serverSettings.ts";
import { ProviderDiscoveryService } from "./Services/ProviderDiscoveryService.ts";
import {
  makeHeadlessModelResolver,
  pickHeadlessModelSelection,
} from "./resolveHeadlessModelSelection.ts";

describe("pickHeadlessModelSelection", () => {
  it("keeps the workspace default while the provider still offers it", () => {
    expect(
      pickHeadlessModelSelection({
        projectDefault: { provider: "pi", model: "openai/gpt-5.5" },
        discoveredSlugs: ["openai/gpt-5.5", "anthropic/claude-sonnet-4-6"],
      }),
    ).toEqual({ provider: "pi", model: "openai/gpt-5.5" });
  });

  it("uses the server-wide default before guessing from the catalogue", () => {
    expect(
      pickHeadlessModelSelection({
        projectDefault: null,
        serverDefault: { provider: "pi", model: "deepseek/deepseek-v4-pro" },
        discoveredSlugs: ["deepseek/deepseek-v4-pro", "openai/gpt-5.5"],
      }),
    ).toEqual({ provider: "pi", model: "deepseek/deepseek-v4-pro" });
  });

  it("drops a configured default the endpoint no longer serves", () => {
    // The bug behind "the bot never answers": the slug stayed configured long after the
    // gateway stopped serving it, and every unattended run died with model_unavailable.
    expect(
      pickHeadlessModelSelection({
        projectDefault: { provider: "pi", model: "deepseek/deepseek-v4-flash" },
        serverDefault: { provider: "pi", model: "deepseek/deepseek-v4.1" },
        discoveredSlugs: ["deepseek/deepseek-v4.1", "Step/water18-0910"],
      }),
    ).toEqual({ provider: "pi", model: "deepseek/deepseek-v4.1" });
  });

  it("still prefers a runnable default over the first listed model", () => {
    expect(
      pickHeadlessModelSelection({
        projectDefault: null,
        serverDefault: { provider: "pi", model: "deepseek/deepseek-v4-flash" },
        discoveredSlugs: ["anthropic/claude-fable-5", "deepseek/deepseek-v4.1"],
      }),
    ).toEqual({ provider: "pi", model: "anthropic/claude-fable-5" });
  });

  it("matches a stored alias onto the offered slug", () => {
    expect(
      pickHeadlessModelSelection({
        projectDefault: { provider: "pi", model: "sonnet-4-6" },
        discoveredSlugs: ["anthropic/claude-sonnet-4-6"],
      }),
    ).toEqual({ provider: "pi", model: "anthropic/claude-sonnet-4-6" });
  });

  it("keeps the configured default when the provider cannot be asked at all", () => {
    expect(
      pickHeadlessModelSelection({
        projectDefault: { provider: "pi", model: "openai/gpt-5.5" },
        discoveredSlugs: [],
      }),
    ).toEqual({ provider: "pi", model: "openai/gpt-5.5" });
  });

  it("falls back to the first model the provider offers", () => {
    // The bug this replaces: a constant "pi/default" slug that no install has, which made
    // every headless run fail on its first request.
    expect(
      pickHeadlessModelSelection({ projectDefault: null, discoveredSlugs: ["openai/gpt-5.5"] }),
    ).toEqual({ provider: "pi", model: "openai/gpt-5.5" });
  });

  it("returns null when nothing is available, so callers can explain instead of failing later", () => {
    expect(pickHeadlessModelSelection({ projectDefault: null, discoveredSlugs: [] })).toBeNull();
  });
});

describe("makeHeadlessModelResolver", () => {
  const model = (slug: string) => ({ slug, name: slug });
  const withDiscovery = (
    models: ReadonlyArray<{ slug: string; name: string }>,
    fail = false,
    settings: Parameters<typeof ServerSettingsService.layerTest>[0] = {},
  ) =>
    Layer.merge(
      ProviderDiscoveryService.layerTest({ models, fail }),
      ServerSettingsService.layerTest(settings),
    );

  it("asks the provider once the workspace default is missing", async () => {
    const resolver = await Effect.runPromise(
      makeHeadlessModelResolver.pipe(Effect.provide(withDiscovery([model("openai/gpt-5.5")]))),
    );
    expect(await Effect.runPromise(resolver.resolve(null))).toEqual({
      provider: "pi",
      model: "openai/gpt-5.5",
    });
  });

  it("uses the configured default model without asking for a catalogue", async () => {
    const resolver = await Effect.runPromise(
      makeHeadlessModelResolver.pipe(
        // A failing discovery proves the shortcut: the setting alone must be enough.
        Effect.provide(
          withDiscovery([], true, {
            defaultModelSelection: { provider: "pi", model: "deepseek/deepseek-v4-pro" },
          }),
        ),
      ),
    );
    expect(await Effect.runPromise(resolver.resolve(null))).toEqual({
      provider: "pi",
      model: "deepseek/deepseek-v4-pro",
    });
  });

  it("never asks the provider when the workspace already decided", async () => {
    const resolver = await Effect.runPromise(
      makeHeadlessModelResolver.pipe(
        Effect.provide(
          withDiscovery([], true, {
            defaultModelSelection: { provider: "pi", model: "deepseek/deepseek-v4-pro" },
          }),
        ),
      ),
    );
    expect(await Effect.runPromise(resolver.resolve({ provider: "pi", model: "chosen" }))).toEqual({
      provider: "pi",
      model: "chosen",
    });
  });

  it("treats an unavailable provider as 'no model' rather than an error", async () => {
    const resolver = await Effect.runPromise(
      makeHeadlessModelResolver.pipe(Effect.provide(withDiscovery([], true))),
    );
    expect(await Effect.runPromise(resolver.resolve(null))).toBeNull();
  });
});
