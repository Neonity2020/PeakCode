/**
 * The category heading is the one piece of the marketplace layout that depends on data the
 * server does not control the language of: a plugin's category is a machine key from its
 * manifest, and a plugin from someone else's marketplace can declare any key at all.
 */
import { describe, expect, it } from "vitest";

import { OTHER_CATEGORY_KEY, pluginCategoryLabel } from "./useProviderDiscoveryData";

const messages = {
  plugins: {
    category: {
      productivity: "生产力",
      "developer-tools": "开发者工具",
      utilities: "实用工具",
    },
  },
};

describe("pluginCategoryLabel", () => {
  it("translates a key it knows", () => {
    expect(pluginCategoryLabel("developer-tools", messages)).toBe("开发者工具");
    expect(pluginCategoryLabel("productivity", messages)).toBe("生产力");
  });

  it("keeps the raw key for one it does not, rather than hiding the plugin", () => {
    // Dropping the section would take its plugins off the page entirely, which is a much
    // worse outcome than an untranslated heading.
    expect(pluginCategoryLabel("payments", messages)).toBe("payments");
    expect(pluginCategoryLabel("Some Vendor Category", messages)).toBe("Some Vendor Category");
  });

  it("names the bucket a plugin with no category lands in", () => {
    expect(pluginCategoryLabel(OTHER_CATEGORY_KEY, messages)).toBe("Other");
  });

  it("treats the empty string as a key, not as a match", () => {
    // `??` rather than `||`: an empty-string category is the manifest saying nothing, and
    // the fallback for "nothing" is the raw value, not the first known label.
    expect(pluginCategoryLabel("", { plugins: { category: { "": "never" } } })).toBe("never");
  });
});
