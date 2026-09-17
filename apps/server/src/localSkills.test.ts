/**
 * 本地技能清单：契约是"目录名就是 id，启用状态来自技能开关"。
 *
 * 这一层最容易悄悄坏掉的地方是 id：`read_skill` 与开关都按目录名解析，而卡片上显示的是
 * frontmatter 里的 `name`。两者不同的技能如果按 name 判断启用状态，开关就会静默失效 ——
 * 所以这里专门造一个 name ≠ 目录名的技能来钉住它。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createInMemoryAgentStore, setAgentStore } from "@peakcode/agent-toolkit/store/AgentStore";
import { setSkillEnabled } from "@peakcode/agent-toolkit/skills/enablement";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { listLocalUserSkills } from "./localSkills";

const tempDirs: string[] = [];

function makeSkillsDir(): string {
  const root = mkdtempSync(join(tmpdir(), "peakcode-local-skills-"));
  tempDirs.push(root);
  return root;
}

function writeSkill(root: string, dirName: string, frontmatterName: string): void {
  const dir = join(root, dirName);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "SKILL.md"),
    `---\nname: ${frontmatterName}\ndescription: ${frontmatterName} does a thing\nversion: 1.2.3\n---\n\n# ${frontmatterName}\n`,
  );
}

beforeEach(() => {
  setAgentStore(createInMemoryAgentStore());
});

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("listLocalUserSkills", () => {
  test("carries the directory name as id, separately from the display name", async () => {
    const root = makeSkillsDir();
    writeSkill(root, "dir-name-is-the-id", "A Nicer Display Name");

    const result = await listLocalUserSkills({ dirs: [{ source: "agents", path: root }] });

    expect(result.skills).toHaveLength(1);
    expect(result.skills[0]?.id).toBe("dir-name-is-the-id");
    expect(result.skills[0]?.name).toBe("A Nicer Display Name");
    expect(result.skills[0]?.version).toBe("1.2.3");
    expect(result.searchedDirs).toEqual([root]);
  });

  test("everything is enabled by default", async () => {
    const root = makeSkillsDir();
    writeSkill(root, "untouched-skill", "untouched-skill");

    const result = await listLocalUserSkills({ dirs: [{ source: "agents", path: root }] });

    expect(result.skills[0]?.enabled).toBe(true);
  });

  test("the toggle sets enabled, and it keys on the id rather than the display name", async () => {
    const root = makeSkillsDir();
    writeSkill(root, "dir-name-is-the-id", "A Nicer Display Name");
    const dirs = [{ source: "agents" as const, path: root }];

    // Keyed on the display name: must NOT switch anything off — that is the failure mode this
    // test exists for.
    setSkillEnabled("A Nicer Display Name", false);
    expect((await listLocalUserSkills({ dirs })).skills[0]?.enabled).toBe(true);

    setSkillEnabled("dir-name-is-the-id", false);
    expect((await listLocalUserSkills({ dirs })).skills[0]?.enabled).toBe(false);

    setSkillEnabled("dir-name-is-the-id", true);
    expect((await listLocalUserSkills({ dirs })).skills[0]?.enabled).toBe(true);
  });

  test("a missing search root is not an error", async () => {
    const result = await listLocalUserSkills({
      dirs: [{ source: "agents", path: join(tmpdir(), "peakcode-does-not-exist") }],
    });

    expect(result.skills).toEqual([]);
  });
});
