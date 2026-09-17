import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { DEFAULT_SERVER_SETTINGS, ServerSettings, ServerSettingsPatch } from "@peakcode/contracts";

import { applyServerSettingsPatch } from "./serverSettings";

const decodeSettings = (input: unknown): ServerSettings =>
  Schema.decodeUnknownSync(ServerSettings)(input);
const decodePatch = (input: unknown): ServerSettingsPatch =>
  Schema.decodeUnknownSync(ServerSettingsPatch)(input);

describe("default model selection", () => {
  it("starts unset, so a fresh install keeps resolving the first available model", () => {
    expect(DEFAULT_SERVER_SETTINGS.defaultModelSelection).toBeUndefined();
    expect(
      decodeSettings({ defaultModelSelection: { provider: "pi", model: "pi/one" } })
        .defaultModelSelection,
    ).toEqual({ provider: "pi", model: "pi/one" });
  });

  it("stores a chosen model and keeps it across unrelated patches", () => {
    const stored = applyServerSettingsPatch(
      DEFAULT_SERVER_SETTINGS,
      decodePatch({ defaultModelSelection: { provider: "pi", model: "pi/one" } }),
    );
    expect(stored.defaultModelSelection).toEqual({ provider: "pi", model: "pi/one" });

    const afterUnrelatedPatch = applyServerSettingsPatch(
      stored,
      decodePatch({ enableAssistantStreaming: true }),
    );
    expect(afterUnrelatedPatch.defaultModelSelection).toEqual({ provider: "pi", model: "pi/one" });
  });

  it("switches the model without losing the provider, and the other way round", () => {
    const stored = applyServerSettingsPatch(
      DEFAULT_SERVER_SETTINGS,
      decodePatch({ defaultModelSelection: { provider: "pi", model: "pi/one" } }),
    );

    expect(
      applyServerSettingsPatch(stored, decodePatch({ defaultModelSelection: { model: "pi/two" } }))
        .defaultModelSelection,
    ).toEqual({ provider: "pi", model: "pi/two" });
    // Pi has no static default model, so changing only the provider keeps the slug.
    expect(
      applyServerSettingsPatch(stored, decodePatch({ defaultModelSelection: { provider: "pi" } }))
        .defaultModelSelection,
    ).toEqual({ provider: "pi", model: "pi/one" });
  });

  it("clears the setting with an empty model instead of storing an unusable one", () => {
    const stored = applyServerSettingsPatch(
      DEFAULT_SERVER_SETTINGS,
      decodePatch({ defaultModelSelection: { provider: "pi", model: "pi/one" } }),
    );

    const cleared = applyServerSettingsPatch(
      stored,
      decodePatch({ defaultModelSelection: { model: "" } }),
    );

    expect(cleared.defaultModelSelection).toBeUndefined();
    // The result is still a decodable settings document, which a stored "" model would not be.
    expect(
      decodeSettings(JSON.parse(JSON.stringify(cleared))).defaultModelSelection,
    ).toBeUndefined();
  });

  it("leaves the text-generation model out of it", () => {
    const stored = applyServerSettingsPatch(
      DEFAULT_SERVER_SETTINGS,
      decodePatch({ defaultModelSelection: { provider: "pi", model: "pi/one" } }),
    );

    expect(stored.textGenerationModelSelection).toEqual(
      DEFAULT_SERVER_SETTINGS.textGenerationModelSelection,
    );
  });

  it("keeps a required selection when a patch would empty it", () => {
    const next = applyServerSettingsPatch(
      DEFAULT_SERVER_SETTINGS,
      decodePatch({ textGenerationModelSelection: { model: "" } }),
    );

    expect(next.textGenerationModelSelection).toEqual(
      DEFAULT_SERVER_SETTINGS.textGenerationModelSelection,
    );
  });
});
