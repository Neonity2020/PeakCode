import { describe, expect, it } from "vitest";

import { MAX_SKILL_DESCRIPTION_CHARS } from "../agent-skills.ts";
import { BUNDLED_PLUGINS } from "./bundled.generated.ts";
import {
  BUNDLED_PLUGIN_MARKETPLACE_PATH,
  bundledPluginId,
  bundledPluginSkills,
  listBundledPlugins,
  readBundledPlugin,
} from "./registry.ts";

describe("bundled plugins", () => {
  it("ships the plugins Peak Code is expected to have", () => {
    expect(listBundledPlugins().map((plugin) => plugin.name)).toEqual([
      "browser-use",
      "computer-use",
    ]);
  });

  it("looks a plugin up by name, case-insensitively", () => {
    expect(readBundledPlugin("browser-use")?.name).toBe("browser-use");
    expect(readBundledPlugin("  BROWSER-USE  ")?.name).toBe("browser-use");
  });

  it("returns null for something it does not ship", () => {
    expect(readBundledPlugin("definitely-not-a-plugin")).toBeNull();
    expect(readBundledPlugin("")).toBeNull();
  });

  it("builds an id from the marketplace and the name", () => {
    expect(bundledPluginId("browser-use")).toBe("peak-code/browser-use");
    expect(BUNDLED_PLUGIN_MARKETPLACE_PATH).toBe("bundled");
  });
});

describe("bundled plugin skills", () => {
  it("flattens every plugin's skills", () => {
    const ids = bundledPluginSkills().map((skill) => skill.id);
    expect(ids).toEqual(["browser-use", "computer-use"]);
  });

  it("gives every declared skill a SKILL.md", () => {
    for (const skill of bundledPluginSkills()) {
      expect(
        skill.files.some((file) => file.path === "SKILL.md"),
        `${skill.id} has no SKILL.md`,
      ).toBe(true);
    }
  });

  it("describes every skill in a form the prompt listing can use", () => {
    for (const skill of bundledPluginSkills()) {
      // The listing truncates, so an over-long description is a silent loss of meaning and
      // an empty one leaves the model with a name and nothing to go on.
      expect(skill.description.length, `${skill.id} description`).toBeGreaterThan(0);
      expect(skill.description.length, `${skill.id} description`).toBeLessThanOrEqual(
        MAX_SKILL_DESCRIPTION_CHARS,
      );
    }
  });

  it("keeps each skill's frontmatter name matching its id", () => {
    for (const skill of bundledPluginSkills()) {
      const body = skill.files.find((file) => file.path === "SKILL.md")?.content ?? "";
      // `read_skill` and the composer's `$name` token both address the skill by this name,
      // so a mismatch makes the skill unreadable by the handle the model was given.
      expect(/^name:\s*(.+)$/m.exec(body)?.[1]?.trim()).toBe(skill.id);
    }
  });

  it("names skills in a way the skill library will accept", () => {
    for (const skill of bundledPluginSkills()) {
      // `safeName` in the installer refuses anything that is not a plain directory name, and
      // a plugin whose skill cannot be installed would look installed while doing nothing.
      expect(skill.id, `${skill.id} is not a plain directory name`).toMatch(/^[a-zA-Z0-9._-]+$/);
      expect(skill.id).not.toMatch(/^\./);
    }
  });
});

describe("bundled plugin payload integrity", () => {
  it("declares an interface the plugin browser can render", () => {
    for (const plugin of BUNDLED_PLUGINS) {
      expect(plugin.interface.displayName, `${plugin.name} displayName`).toBeTruthy();
      expect(plugin.interface.shortDescription, `${plugin.name} shortDescription`).toBeTruthy();
      expect(plugin.interface.category, `${plugin.name} category`).toBeTruthy();
      // The composer menu falls back to `source.path` when there is no short description,
      // which reads as a path rather than as a sentence — so it has to be present.
      expect(plugin.interface.defaultPrompt?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("never ships a plugin with no skills", () => {
    // A plugin with no skills has nothing to install, nothing for the composer to reference
    // and nothing for the agent to read; it would only occupy a slot in the plugins view.
    for (const plugin of BUNDLED_PLUGINS) {
      expect(plugin.skills.length, `${plugin.name} has no skills`).toBeGreaterThan(0);
    }
  });
});
