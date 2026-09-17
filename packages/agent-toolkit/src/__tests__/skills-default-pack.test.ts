/**
 * 默认技能包 + 流程段的单测。
 *
 * 这一层的契约是"装没装上都要给出可用的结果"：安装走的是外部 CLI（`npx`），
 * 测试里一律用注入的假安装器，既不联网也不碰真实的 `~/.agents/skills`。
 */
import { describe, expect, test } from "vitest";

import { updateSettings } from "../runtime/settings.ts";
import {
  DEFAULT_SKILL_PACKS,
  defaultSkillPacksEnabled,
  ensureDefaultSkillPacks,
  missingPackSkills,
  skillPackInstallArgv,
  type SkillPack,
} from "../skills/default-pack.ts";
import {
  defaultPackSkillIds,
  skillWorkflowEnabled,
  workflowPromptSection,
} from "../skills/workflow.ts";

const pack = DEFAULT_SKILL_PACKS[0]!;

describe("默认技能包清单", () => {
  test("技能 id 不重复，且都带说明", () => {
    const ids = pack.skills;
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of DEFAULT_SKILL_PACKS) expect(entry.description.length).toBeGreaterThan(0);
  });

  test("安装命令落在公共技能库（universal），而不是某个具体 agent 的私有目录", () => {
    // `-a pi` 会把文件放进 ~/.pi/agent/skills，`read_skill` 读的公共库反而拿不到；
    // 这一条就是防着"顺手改成 pi"的回归。
    expect(skillPackInstallArgv(pack)).toEqual([
      "npx",
      "--yes",
      "skills",
      "add",
      "addyosmani/agent-skills",
      "--global",
      "--agent",
      "universal",
      "--yes",
    ]);
  });

  test("按已装目录算出缺哪些技能", () => {
    expect(missingPackSkills(pack, pack.skills)).toEqual([]);
    expect(missingPackSkills(pack, [])).toEqual(pack.skills);
    expect(missingPackSkills(pack, pack.skills.slice(1))).toEqual([pack.skills[0]]);
  });
});

describe("ensureDefaultSkillPacks", () => {
  const fakePack: SkillPack = { source: "owner/repo", skills: ["a", "b"], description: "测试包" };

  test("已经装全了就不再调安装器（启动路径不联网）", async () => {
    let calls = 0;
    const results = await ensureDefaultSkillPacks({
      packs: [fakePack],
      listInstalled: () => ["a", "b", "别的技能"],
      install: async () => {
        calls += 1;
        return { ok: true, detail: "" };
      },
    });
    expect(calls).toBe(0);
    expect(results).toEqual([{ pack: "owner/repo", status: "already-present" }]);
  });

  test("缺技能时装一次，装完以目录为准并记下清单", async () => {
    const installed: string[] = ["a"];
    const results = await ensureDefaultSkillPacks({
      packs: [fakePack],
      listInstalled: () => [...installed],
      install: async () => {
        installed.push("b");
        return { ok: true, detail: "" };
      },
    });
    expect(results).toEqual([{ pack: "owner/repo", status: "installed" }]);
  });

  test("命令成功但目录里还是没有，算失败并说明缺了什么", async () => {
    const results = await ensureDefaultSkillPacks({
      packs: [fakePack],
      listInstalled: () => ["a"],
      install: async () => ({ ok: true, detail: "" }),
    });
    expect(results[0]?.status).toBe("failed");
    expect(results[0]?.detail).toContain("b");
  });

  test("安装器失败时带上原因，不抛异常", async () => {
    const results = await ensureDefaultSkillPacks({
      packs: [fakePack],
      listInstalled: () => [],
      install: async () => ({ ok: false, detail: "安装命令退出码 1：network unreachable" }),
    });
    expect(results[0]?.status).toBe("failed");
    expect(results[0]?.detail).toContain("network unreachable");
  });

  test("设置里关掉后直接跳过，不去看磁盘也不装", async () => {
    updateSettings({ AGENT_SKILL_PACKS: "0" });
    let calls = 0;
    const results = await ensureDefaultSkillPacks({
      packs: [fakePack],
      listInstalled: () => [],
      install: async () => {
        calls += 1;
        return { ok: true, detail: "" };
      },
    });
    expect(calls).toBe(0);
    expect(results[0]?.status).toBe("skipped");
    expect(defaultSkillPacksEnabled()).toBe(false);
  });
});

describe("工程流程段", () => {
  test("六个阶段与技能包里的技能都能在提示词里找到", () => {
    const section = workflowPromptSection();
    expect(section).not.toBeNull();
    for (const stage of ["DEFINE", "PLAN", "BUILD", "VERIFY", "REVIEW", "SHIP"]) {
      expect(section).toContain(stage);
    }
    // 技能包里的每个技能都要在流程段里点名，否则模型读不到它们（清单默认不列它们）。
    for (const skill of pack.skills) {
      expect(section, `${skill} 没出现在流程段里`).toContain(`\`${skill}\``);
    }
  });

  test("把「哪些要走流程」交给模型判断，而不是一律强推", () => {
    const section = workflowPromptSection()!;
    expect(section).toContain("由你判断");
    expect(section).toContain("要走");
    expect(section).toContain("不用走");
  });

  test("技能包还没装上时仍然给流程，并说明可以按描述自己走", () => {
    const section = workflowPromptSection()!;
    expect(section).toContain("read_skill");
    expect(section).toContain("尚未装上");
  });

  test("关掉开关后不再注入", () => {
    updateSettings({ AGENT_SKILL_WORKFLOW: "0" });
    expect(skillWorkflowEnabled()).toBe(false);
    expect(workflowPromptSection()).toBeNull();
  });

  test("默认技能包的 id 集合就是清单里的那些", () => {
    expect(defaultPackSkillIds([pack])).toEqual(new Set(pack.skills));
  });
});
