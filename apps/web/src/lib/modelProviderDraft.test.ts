import { describe, expect, it } from "vitest";
import {
  cleanModelProviderDraft,
  patchModelProvider,
  providerIdFromName,
} from "./modelProviderDraft";

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

describe("providerIdFromName", () => {
  it("slugs a display name into a provider key", () => {
    expect(providerIdFromName("My Company", [])).toBe("my-company");
    expect(providerIdFromName("  170  ", [])).toBe("170");
  });

  it("suffixes instead of silently overwriting an existing provider", () => {
    expect(providerIdFromName("My Company", ["my-company"])).toBe("my-company-2");
    expect(providerIdFromName("My Company", ["my-company", "my-company-2"])).toBe("my-company-3");
  });

  it("gives a non-ASCII name a stable key rather than collapsing it", () => {
    const first = providerIdFromName("智谱", []);
    expect(first).toMatch(/^provider-[0-9a-z]{4}$/);
    // Same name, same key — a rename is the only thing that should change it.
    expect(providerIdFromName("智谱", [])).toBe(first);
    expect(providerIdFromName("通义", [])).not.toBe(first);
  });
});
