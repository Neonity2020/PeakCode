/**
 * 技能单项开关：这一层的契约是"关掉的技能，模型既看不到也读不到"。
 *
 * 默认（没有设置值）必须全部放行 —— 这个功能是加出来的，不能顺手把任何技能关掉。
 * 测试把中央技能库指到临时目录（`SKILLS_CENTRAL_PATH`），不碰真实的 `~/.agents/skills`。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { readSkillFile, skillsPromptSection } from "../agent-skills.ts";
import { updateSettings } from "../runtime/settings.ts";
import {
  disabledSkillIds,
  isSkillEnabled,
  parseDisabledSkillIds,
  setSkillEnabled,
} from "../skills/enablement.ts";
import { workflowPromptSection } from "../skills/workflow.ts";

const tempDirs: string[] = [];

function makeLibrary(skillIds: readonly string[]): string {
  const root = mkdtempSync(join(tmpdir(), "peakcode-skill-toggle-"));
  tempDirs.push(root);
  for (const id of skillIds) {
    const dir = join(root, id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "SKILL.md"),
      `---\nname: ${id}\ndescription: ${id} does a thing\n---\n\n# ${id}\n\nBody.\n`,
    );
  }
  return root;
}

afterEach(() => {
  updateSettings({ AGENT_DISABLED_SKILLS: "", SKILLS_CENTRAL_PATH: "" });
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("技能开关的存储", () => {
  test("默认全部放行", () => {
    expect(parseDisabledSkillIds("")).toEqual([]);
    expect(disabledSkillIds().size).toBe(0);
    expect(isSkillEnabled("system-prompts")).toBe(true);
  });

  test("停用与恢复会往返，并保持排序稳定", () => {
    expect(setSkillEnabled("b-skill", false)).toEqual(["b-skill"]);
    expect(setSkillEnabled("a-skill", false)).toEqual(["a-skill", "b-skill"]);
    expect(isSkillEnabled("b-skill")).toBe(false);
    expect(isSkillEnabled("a-skill")).toBe(false);

    expect(setSkillEnabled("a-skill", true)).toEqual(["b-skill"]);
    expect(isSkillEnabled("a-skill")).toBe(true);
    expect(isSkillEnabled("b-skill")).toBe(false);
  });

  test("大小写与空白归一化：UI 与 read_skill 传来的是同一个 id", () => {
    setSkillEnabled("  System-Prompts ", false);
    expect(isSkillEnabled("system-prompts")).toBe(false);
    expect(isSkillEnabled("SYSTEM-PROMPTS")).toBe(false);
    expect(setSkillEnabled("system-prompts", true)).toEqual([]);
  });

  test("坏值退化为'什么都没关'，而不是把所有技能藏起来", () => {
    expect(parseDisabledSkillIds("not json")).toEqual([]);
    expect(parseDisabledSkillIds('{"a":1}')).toEqual([]);
    expect(parseDisabledSkillIds('["ok", 3, null, ""]')).toEqual(["ok"]);
    updateSettings({ AGENT_DISABLED_SKILLS: "{{{" });
    expect(isSkillEnabled("anything")).toBe(true);
  });
});

describe("运行时闸门", () => {
  test("停用的技能不再出现在每轮技能清单里", () => {
    updateSettings({ SKILLS_CENTRAL_PATH: makeLibrary(["alpha-skill", "beta-skill"]) });
    const before = skillsPromptSection();
    expect(before).toContain("alpha-skill");
    expect(before).toContain("beta-skill");

    setSkillEnabled("alpha-skill", false);
    const after = skillsPromptSection();
    expect(after).not.toContain("alpha-skill");
    expect(after).toContain("beta-skill");
  });

  test("read_skill 拒绝读取停用的技能，并说明下一步", () => {
    updateSettings({ SKILLS_CENTRAL_PATH: makeLibrary(["alpha-skill"]) });
    expect(readSkillFile("alpha-skill").ok).toBe(true);

    setSkillEnabled("alpha-skill", false);
    const refused = readSkillFile("alpha-skill");
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.reason).toContain("已在本机停用");
      // 模型需要知道该怎么办，而不是反复重试同一个名字。
      expect(refused.reason).toContain("按你自己的判断");
    }
    // 子文件同样读不到：开关关的是这个技能，不是它某一个文件。
    expect(readSkillFile("alpha-skill", "SKILL.md").ok).toBe(false);
  });

  test("流程段不再点名停用的技能（否则会指引模型去读一个读不到的名字）", () => {
    const before = workflowPromptSection();
    expect(before).toContain("interview-me");

    setSkillEnabled("interview-me", false);
    const after = workflowPromptSection();
    expect(after).not.toContain("`interview-me`");
    // 阶段本身照常输出：流程不依赖技能文件。
    expect(after).toContain("工程流程");
  });
});
