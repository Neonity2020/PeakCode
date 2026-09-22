/**
 * 子智能体注册表的单测。
 *
 * 最该钉住的两条：
 * 1. **"没配过"与"配成空"不是一回事** —— 前者回落到内置默认，后者是用户的合法选择
 *    （把 worker 全删了），删完又冒出一批默认值会让"删除"看起来没生效；
 * 2. **模型为空是"继承"，不是"没填"** —— 解析成 null 而不是空串，且保存时原样往返，
 *    否则"继承默认"会在一次保存后被固化成当时碰巧的模型。
 */
import { beforeEach, describe, expect, test } from "vitest";

import {
  DEFAULT_SUB_AGENTS,
  deleteSubAgent,
  enabledSubAgents,
  getSubAgent,
  listSubAgents,
  multiAgentPromptSection,
  normalizeSubAgentId,
  saveSubAgent,
  subAgentRosterSection,
} from "../agent-subagents.ts";
import { updateSettings } from "../runtime/settings.ts";

/** Clear the registry back to "never configured". */
function resetRegistry(): void {
  updateSettings({ AGENT_SUBAGENTS: "" });
}

beforeEach(() => {
  resetRegistry();
});

describe("注册表", () => {
  test("没配过时给出内置的三个 worker", () => {
    const agents = listSubAgents();
    expect(agents.map((agent) => agent.id)).toEqual(DEFAULT_SUB_AGENTS.map((agent) => agent.id));
    expect(agents.every((agent) => agent.model === null)).toBe(true);
  });

  test("删光并保存后是空表，不再回落到默认", () => {
    for (const agent of DEFAULT_SUB_AGENTS) deleteSubAgent(agent.id);
    expect(listSubAgents()).toEqual([]);
    expect(enabledSubAgents()).toEqual([]);
  });

  test("保存是按 id 覆盖，不是追加", () => {
    saveSubAgent({ id: "explore", name: "Explore", description: "第一次" });
    saveSubAgent({ id: "explore", name: "Explore", description: "第二次" });
    expect(listSubAgents().filter((agent) => agent.id === "explore")).toHaveLength(1);
    expect(getSubAgent("explore")!.description).toBe("第二次");
  });

  test("模型留空解析成 null（继承），填了才固化", () => {
    saveSubAgent({ name: "Cheap", model: "  " });
    expect(getSubAgent("cheap")!.model).toBeNull();
    saveSubAgent({ name: "Cheap", model: "openai/gpt-5-mini" });
    expect(getSubAgent("cheap")!.model).toBe("openai/gpt-5-mini");
  });

  test("句柄按名称规范化；停用的 worker 不参与派发但仍可读取", () => {
    saveSubAgent({ name: "Code Reviewer", enabled: false });
    const agent = getSubAgent("code-reviewer")!;
    expect(agent).not.toBeNull();
    expect(agent.enabled).toBe(false);
    expect(enabledSubAgents().some((entry) => entry.id === "code-reviewer")).toBe(false);
  });

  test("坏掉的配置当作没配过，不抛出", () => {
    updateSettings({ AGENT_SUBAGENTS: "{ not json" });
    expect(listSubAgents().length).toBeGreaterThan(0);
  });
});

describe("名册与协议", () => {
  test("名册只列出启用的 worker，且标注各自模型", () => {
    saveSubAgent({ name: "Planner", model: "openai/gpt-5.5" });
    saveSubAgent({ name: "Hidden", enabled: false });
    const roster = subAgentRosterSection()!;
    expect(roster).toContain("Planner");
    expect(roster).toContain("openai/gpt-5.5");
    expect(roster).not.toContain("Hidden");
  });

  test("没有 worker 时名册与协议都不注入", () => {
    for (const agent of DEFAULT_SUB_AGENTS) deleteSubAgent(agent.id);
    expect(subAgentRosterSection()).toBeNull();
    expect(multiAgentPromptSection()).toBeNull();
  });

  test("协议里保留「先拆再派、派完要检查合并」的流程要求", () => {
    const section = multiAgentPromptSection()!;
    expect(section).toContain("编排");
    expect(section).toContain("task");
    expect(section).toContain("合并");
  });

  test("协议要求开工就并行派发，而不是串行一个一个来", () => {
    const section = multiAgentPromptSection()!;
    expect(section).toContain("并行派发");
    expect(section).toContain("同一轮里连续调用 `task`");
    // 并行是默认，不是为了用功能而硬拆：只有一个工作面时仍应自己做。
    expect(section).toContain("确实只有一个工作面");
  });

  test("协议要求先讲清拆解理由再派活，而不是默默创建一堆 worker", () => {
    const section = multiAgentPromptSection()!;
    expect(section).toContain("先分析，并把分析写出来");
    // 分析必须是界面上看得见的回复文字，不是只留在思考里。
    expect(section).toContain("必须出现在界面上");
    // 不拆的时候也要给理由。
    expect(section).toContain("同样先用一句话说明为什么自己做");
  });

  test("协议要求收齐所有 worker 的结论并交付成品，而不是「都做完了」", () => {
    const section = multiAgentPromptSection()!;
    expect(section).toContain("收齐报告");
    expect(section).toContain("逐条收进来");
    expect(section).toContain("合并成成品并交付");
    // 失败/被中断的 worker 要算作缺口，不能让报告全绿。
    expect(section).toContain("不要让报告看起来是全绿的");
    expect(section).toContain("不要用「都做完了」当交付物");
  });
});

describe("normalizeSubAgentId", () => {
  test("小写、空格转横线、去掉不合法字符", () => {
    expect(normalizeSubAgentId("  Code Reviewer! ")).toBe("code-reviewer");
    expect(normalizeSubAgentId("a.b_c-1")).toBe("a.b_c-1");
    expect(normalizeSubAgentId(null)).toBe("");
  });
});
