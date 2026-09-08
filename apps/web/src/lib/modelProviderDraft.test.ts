import { describe, expect, it } from "vitest";
import { cleanModelProviderDraft, patchModelProvider } from "./modelProviderDraft";

describe("model provider drafts", () => {
  it("clears optional fields while preserving advanced configuration", () => {
    const original = {
      name: "Old",
      baseUrl: "https://example.test",
      apiKey: "key",
      extra: { compat: true },
    };
    expect(
      patchModelProvider(original, { name: undefined, baseUrl: undefined, apiKey: undefined }),
    ).toEqual({ extra: { compat: true } });
    expect(original.apiKey).toBe("key");
  });

  it("removes blank model rows even when none remain", () => {
    expect(
      cleanModelProviderDraft({ custom: { models: [{ id: " " }], headers: { "x-test": "yes" } } }),
    ).toEqual({ custom: { headers: { "x-test": "yes" } } });
  });

  it("trims model IDs and preserves model overrides", () => {
    expect(
      cleanModelProviderDraft({
        custom: {
          models: [
            { id: " model ", extra: { compat: { supportsDeveloperRole: false } } },
            { id: "" },
          ],
        },
      }),
    ).toEqual({
      custom: { models: [{ id: "model", extra: { compat: { supportsDeveloperRole: false } } }] },
    });
  });
});
