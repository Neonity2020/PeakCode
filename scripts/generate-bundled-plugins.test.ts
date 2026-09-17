/**
 * Guards against a plugin edit that was never regenerated into the shipped payload.
 *
 * The plugin manifests and skill bodies live under `./plugins` as ordinary files, but the
 * server bundle only carries TypeScript — so what actually ships is
 * `packages/agent-toolkit/src/plugins/bundled.generated.ts`. Editing the source without
 * running the generator produces a build that looks fine and quietly serves the old
 * plugins, which is exactly the kind of drift a test should catch instead of a user.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { buildBundledPlugins, readPlugins } from "./generate-bundled-plugins.ts";

const COMMITTED = resolve(
  import.meta.dirname,
  "..",
  "packages",
  "agent-toolkit",
  "src",
  "plugins",
  "bundled.generated.ts",
);

/** Build a throwaway plugins directory so the failure modes can be exercised for real. */
function scratchPlugins(
  name: string,
  manifest: { skills?: readonly string[] } & Record<string, unknown>,
  skillFiles: Record<string, string> = { "SKILL.md": "---\nname: x\ndescription: y\n---\n" },
): string {
  const root = mkdtempSync(join(tmpdir(), "peakcode-plugin-fixture-"));
  const pluginDir = join(root, name);
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(join(pluginDir, "plugin.json"), JSON.stringify(manifest), "utf8");
  // Fixture skills live under the id the manifest declares, the way a real plugin is laid out.
  const skillId = manifest.skills?.[0] ?? "x";
  for (const [file, content] of Object.entries(skillFiles)) {
    const target = join(pluginDir, "skills", skillId, file);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, content, "utf8");
  }
  return root;
}

const created: string[] = [];
const fixture = (...args: Parameters<typeof scratchPlugins>): string => {
  const root = scratchPlugins(...args);
  created.push(root);
  return root;
};

afterAll(() => {
  for (const root of created) rmSync(root, { recursive: true, force: true });
});

interface ReadSkill {
  id: string;
  description: string;
  files: { path: string; content: string }[];
}

/** The one skill of a single-plugin fixture, failing loudly when the fixture is wrong. */
function onlySkill(root: string): ReadSkill {
  const [plugin] = readPlugins(root);
  if (!plugin) throw new Error(`fixture at ${root} produced no plugin`);
  const [skill] = plugin.skills as ReadSkill[];
  if (!skill) throw new Error(`fixture at ${root} produced no skill`);
  return skill;
}

describe("bundled plugin generation", () => {
  /**
   * Every string the payload carries, JSON-encoded the way the generator writes it.
   *
   * Compared as encoded literals rather than as a whole file so the check does not depend on
   * how the module is laid out. The formatter leaves `*.generated.ts` alone (see
   * `.oxfmtrc.json`), which is why the generator's own quoting is what is on disk and this
   * comparison can be exact.
   */
  const payloadLiterals = (): string[] => {
    const literals: string[] = [];
    for (const plugin of buildBundledPlugins()) {
      literals.push(JSON.stringify(plugin.name));
      for (const value of Object.values(plugin.interface)) {
        for (const item of Array.isArray(value) ? value : [value]) {
          literals.push(JSON.stringify(item));
        }
      }
      for (const skill of plugin.skills) {
        literals.push(JSON.stringify(skill.id), JSON.stringify(skill.description));
        for (const file of skill.files) {
          literals.push(JSON.stringify(file.path), JSON.stringify(file.content));
        }
      }
    }
    return literals;
  };

  it("has a committed payload that matches the plugin sources", () => {
    const committed = readFileSync(COMMITTED, "utf8");
    const missing = payloadLiterals().filter((literal) => !committed.includes(literal));

    expect(
      missing,
      "plugins/ changed but bundled.generated.ts did not. " +
        "Run: bun run fmt && bun scripts/generate-bundled-plugins.ts",
    ).toEqual([]);
  });

  it("does not ship a plugin that is no longer on disk", () => {
    // The other direction: a removed plugin leaves its literals in the committed file, so
    // containment alone would never notice the deletion.
    const committed = readFileSync(COMMITTED, "utf8");
    const onDisk = new Set(buildBundledPlugins().map((plugin) => plugin.name));
    const declared = [...committed.matchAll(/^\s{4}name: "([^"]+)",$/gm)].map((match) => match[1]);

    expect(declared.toSorted()).toEqual([...onDisk].toSorted());
  });

  it("ships the skill bodies verbatim, not a summary of them", () => {
    const committed = readFileSync(COMMITTED, "utf8");
    for (const plugin of buildBundledPlugins()) {
      for (const skill of plugin.skills) {
        for (const file of skill.files) {
          expect(committed, `${plugin.name}/${skill.id}/${file.path}`).toContain(
            JSON.stringify(file.content),
          );
        }
      }
    }
  });

  it("reads a plugin's manifest and its skill files", () => {
    const browserUse = readPlugins().find((entry) => entry.manifest.name === "browser-use");

    expect(browserUse?.manifest.skills).toEqual(["browser-use"]);
    expect((browserUse?.skills as ReadSkill[] | undefined)?.[0]?.id).toBe("browser-use");
  });

  it("refuses a plugin whose directory and manifest name disagree", () => {
    // A mismatch would make the plugin unreachable under the name the UI shows.
    const root = fixture("renamed", { name: "something-else", skills: ["x"] });

    expect(() => readPlugins(root)).toThrow(/must match the directory/);
  });

  it("refuses a plugin that declares no skills", () => {
    // It would install nothing, be unreferenceable, and still occupy a slot in the UI.
    const root = fixture("empty", { name: "empty", skills: [] });

    expect(() => readPlugins(root)).toThrow(/at least one skill id/);
  });

  it("refuses a declared skill that has no SKILL.md", () => {
    const root = fixture(
      "broken",
      { name: "broken", skills: ["missing"] },
      { "notes.md": "not a skill" },
    );

    expect(() => readPlugins(root)).toThrow(/missing SKILL.md/);
  });

  it("takes a skill's description from its frontmatter", () => {
    const root = fixture(
      "described",
      { name: "described", skills: ["described"] },
      { "SKILL.md": '---\nname: described\ndescription: "A quoted description."\n---\nbody\n' },
    );

    expect(onlySkill(root).description).toBe("A quoted description.");
  });

  it("carries the skill body through unchanged", () => {
    const body = "---\nname: carried\ndescription: d\n---\n\n# Heading\n\nText.\n";
    const root = fixture("carried", { name: "carried", skills: ["carried"] }, { "SKILL.md": body });

    expect(onlySkill(root).files).toEqual([{ path: "SKILL.md", content: body }]);
  });

  it("leaves dotfiles out of the payload", () => {
    const root = fixture(
      "clean",
      { name: "clean", skills: ["clean"] },
      { "SKILL.md": "---\nname: clean\ndescription: d\n---\n", ".DS_Store": "junk" },
    );

    expect(onlySkill(root).files.map((file) => file.path)).toEqual(["SKILL.md"]);
  });
});
