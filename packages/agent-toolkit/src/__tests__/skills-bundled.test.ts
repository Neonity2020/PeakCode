/**
 * Bundled skills: the in-tree oh-my-pi payload is written into the shared skill library at
 * startup. The contract these tests pin is "create-only and never fatal": an existing
 * directory is left alone, and a bad payload is reported per skill instead of thrown.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { installBundledSkills } from "../skills/bundled.ts";
import {
  OH_MY_PI_BUNDLED_SKILLS,
  type BundledSkill,
} from "../skills/oh-my-pi.bundled.generated.ts";

const tempDirs: string[] = [];

function makeTempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "peakcode-bundled-skills-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("bundled oh-my-pi skills", () => {
  test("payload is namespaced and every skill carries a SKILL.md", () => {
    expect(OH_MY_PI_BUNDLED_SKILLS.map((skill) => skill.id)).toEqual([
      "semantic-compression",
      "system-prompts",
    ]);
    for (const skill of OH_MY_PI_BUNDLED_SKILLS) {
      expect(
        skill.files.some((file) => file.path === "SKILL.md"),
        skill.id,
      ).toBe(true);
      expect(skill.description.length, skill.id).toBeGreaterThan(0);
    }
  });

  test("writes every file, including referenced ones", () => {
    const root = makeTempRoot();
    const results = installBundledSkills({ root, enabled: true, installed: [] });
    expect(results).toEqual([
      { skill: "semantic-compression", status: "installed" },
      { skill: "system-prompts", status: "installed" },
    ]);
    const skillDir = join(root, "system-prompts");
    expect(existsSync(join(skillDir, "SKILL.md"))).toBe(true);
    expect(existsSync(join(skillDir, "small-models.md"))).toBe(true);
    expect(readFileSync(join(skillDir, "SKILL.md"), "utf8")).toContain("name: system-prompts");
    // The embedded payload must survive verbatim — exact strings are load-bearing here.
    expect(readFileSync(join(root, "semantic-compression", "SKILL.md"), "utf8")).toContain(
      "cl100k_base",
    );
  });

  test("never overwrites a directory that already exists", () => {
    const root = makeTempRoot();
    const sentinel = join(root, "system-prompts");
    // Simulate a user-owned skill directory with the same id.
    mkdirSync(sentinel, { recursive: true });
    writeFileSync(join(sentinel, "SKILL.md"), "user edit");

    const results = installBundledSkills({ root, enabled: true, installed: [] });
    expect(results.find((result) => result.skill === "system-prompts")?.status).toBe(
      "already-present",
    );
    expect(readFileSync(join(sentinel, "SKILL.md"), "utf8")).toBe("user edit");
  });

  test("skips when a skill id is already in the shared library", () => {
    const root = makeTempRoot();
    const results = installBundledSkills({
      root,
      enabled: true,
      installed: ["system-prompts"],
    });
    expect(results).toEqual([
      { skill: "semantic-compression", status: "installed" },
      { skill: "system-prompts", status: "already-present" },
    ]);
  });

  test("reports skipped when the pack switch is off and writes nothing", () => {
    const root = makeTempRoot();
    const results = installBundledSkills({ root, enabled: false });
    expect(results.every((result) => result.status === "skipped")).toBe(true);
    expect(existsSync(join(root, "system-prompts"))).toBe(false);
  });

  test("reports a bad payload path instead of throwing", () => {
    const root = makeTempRoot();
    const bad: BundledSkill[] = [
      {
        id: "bad-skill",
        description: "bad",
        files: [{ path: "../escape.md", content: "nope" }],
      },
    ];
    const results = installBundledSkills({ root, enabled: true, installed: [], skills: bad });
    expect(results[0]?.status).toBe("failed");
    expect(existsSync(join(root, "..", "escape.md"))).toBe(false);
  });
});
