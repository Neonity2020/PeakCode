import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getGoal } from "@peakcode/agent-toolkit/agent-goals";
import { getPlan } from "@peakcode/agent-toolkit/agent-plans";
import { createInMemoryAgentStore, setAgentStore } from "@peakcode/agent-toolkit/store/AgentStore";
import { setAgentDataDir } from "@peakcode/agent-toolkit/runtime/paths";
import { updateSettings } from "@peakcode/agent-toolkit/runtime/settings";
import { ThreadId, type ProviderInteractionMode } from "@peakcode/contracts";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { afterAll, beforeEach, describe, expect, test } from "vitest";

import {
  activeToolNamesForMode,
  applyGoalStatus,
  handleGoalTool,
  handleWritePlan,
  makeToolkitContextExtension,
  readGoalView,
} from "./agentToolkitMode";
import { threadConversationKey } from "./agentToolkit";

/**
 * Interaction modes.
 *
 * The two things worth pinning are the ones a reader can't verify by looking at the UI:
 *
 * 1. **plan mode really can't write.** The guarantee is enforced by which tools are active,
 *    not by asking the model nicely — so the test lists the write-capable tools from *both*
 *    families (the toolkit's and pi's built-ins) and asserts none of them survive.
 * 2. **`complete` requires evidence.** "I did a lot of things" is how an autonomous loop
 *    lies about being finished; the tool refuses a completion without an outcome.
 */
const THREAD = ThreadId.makeUnsafe("thread-mode-test");
const CONVERSATION = threadConversationKey(THREAD);
const WORKSPACE = "/tmp/peakcode-mode-ws";

/** Every tool a session registers, spelled the way pi reports them at runtime. */
const ALL_TOOLS = [
  // pi built-ins
  "read",
  "write",
  "edit",
  "bash",
  "grep",
  "find",
  "ls",
  // toolkit
  "read_file",
  "list_dir",
  "glob",
  "grep",
  "view_image",
  "write_file",
  "edit_file",
  "apply_patch",
  "web_search",
  "web_fetch",
  "knowledge_search",
  "request_permissions",
  "get_context_remaining",
  "todo_write",
  "ask_user",
  "goal",
  "write_plan",
  "schedule_task",
  "kanban_comment",
  "task",
  "checkpoint",
  "rewind",
  "think",
  "read_skill",
  // Contributed by installed pi packages rather than by this repo. The `crew_*` tools come
  // from pi-crew, which Peak Code can install from Settings → Pi Packages.
  "crew_list",
  "crew_status",
  "crew_spawn",
  "crew_respond",
  "crew_done",
  "crew_abort",
  "crew_report",
];

const WRITE_CAPABLE = [
  "write",
  "edit",
  "bash",
  "write_file",
  "edit_file",
  "apply_patch",
  "task",
  // Writes the project's `.kanban/board.json`, so plan mode must not reach it either.
  "kanban_comment",
  // Delegation: the spawn itself writes nothing, but the subagent it starts can.
  "crew_spawn",
  "crew_respond",
];

let scratchDir: string;

beforeEach(() => {
  setAgentStore(createInMemoryAgentStore());
  scratchDir = mkdtempSync(join(tmpdir(), "peakcode-mode-"));
  setAgentDataDir(scratchDir);
});

afterAll(() => {
  rmSync(scratchDir, { recursive: true, force: true });
});

describe("activeToolNamesForMode", () => {
  test("plan：一个写工具都不剩，只额外拿到 write_plan", () => {
    const active = activeToolNamesForMode("plan", ALL_TOOLS);
    for (const tool of WRITE_CAPABLE) {
      expect(active, `${tool} 不该在 plan 模式可用`).not.toContain(tool);
    }
    expect(active).toContain("write_plan");
    // goal 只在 goal 模式可用：plan 模式不该能给自己登记目标。
    expect(active).not.toContain("goal");
    // 只读能力照旧
    expect(active).toContain("read");
    expect(active).toContain("read_file");
    expect(active).toContain("grep");
    expect(active).toContain("ask_user");
    expect(active).toContain("think");
    // 包提供的只读工具照旧可用，只有会派活的那些被摘掉。
    expect(active).toContain("crew_list");
    expect(active).toContain("crew_status");
    expect(active).not.toContain("crew_spawn");
    expect(active).not.toContain("crew_respond");
  });

  test("goal：全套可用 + goal，但不给 write_plan", () => {
    const active = activeToolNamesForMode("goal", ALL_TOOLS);
    expect(active).toContain("goal");
    expect(active).not.toContain("write_plan");
    for (const tool of WRITE_CAPABLE) expect(active).toContain(tool);
  });

  test("default：两个模式专属工具都不给，其余全给", () => {
    const active = activeToolNamesForMode("default", ALL_TOOLS);
    expect(active).not.toContain("goal");
    expect(active).not.toContain("write_plan");
    for (const tool of WRITE_CAPABLE) expect(active).toContain(tool);
  });

  test("三个模式都不会把工具集扩成不存在的名字", () => {
    for (const mode of ["default", "plan", "goal"] as const) {
      const active = activeToolNamesForMode(mode, ALL_TOOLS);
      expect(active.every((name) => ALL_TOOLS.includes(name))).toBe(true);
    }
  });
});

describe("handleGoalTool", () => {
  test("create 需要 objective", () => {
    const missing = handleGoalTool(CONVERSATION, { op: "create" });
    expect(missing.content[0]?.text).toContain("objective");
    expect(getGoal(CONVERSATION)).toBeNull();
  });

  test("create → get → 状态与验收标准可往返", () => {
    handleGoalTool(CONVERSATION, {
      op: "create",
      objective: "把 CI 跑通",
      acceptance: "所有 job 绿",
    });
    const goal = getGoal(CONVERSATION);
    expect(goal?.objective).toBe("把 CI 跑通");
    expect(goal?.acceptance).toBe("所有 job 绿");
    expect(goal?.status).toBe("active");

    const view = readGoalView(THREAD);
    expect(view?.objective).toBe("把 CI 跑通");
    expect(view?.maxContinuations).toBeGreaterThan(0);
  });

  test("complete 必须先给证据，否则拒绝而不是假装完成", () => {
    handleGoalTool(CONVERSATION, { op: "create", objective: "x" });
    const refused = handleGoalTool(CONVERSATION, { op: "complete" });
    expect(refused.content[0]?.text).toContain("证据");
    expect(getGoal(CONVERSATION)?.status).toBe("active");

    handleGoalTool(CONVERSATION, { op: "complete", outcome: "跑了 npm test，全绿" });
    expect(getGoal(CONVERSATION)?.status).toBe("complete");
    expect(getGoal(CONVERSATION)?.outcome).toContain("npm test");
  });

  test("abandon 收下原因并置为终态", () => {
    handleGoalTool(CONVERSATION, { op: "create", objective: "x" });
    handleGoalTool(CONVERSATION, { op: "abandon", outcome: "缺权限，做不了" });
    expect(getGoal(CONVERSATION)?.status).toBe("dropped");
  });

  test("终态之后不再接受 complete（不会把放弃改写成完成）", () => {
    handleGoalTool(CONVERSATION, { op: "create", objective: "x" });
    handleGoalTool(CONVERSATION, { op: "abandon", outcome: "算了" });
    const again = handleGoalTool(CONVERSATION, { op: "complete", outcome: "其实做完了" });
    expect(again.content[0]?.text).toContain("终态");
    expect(getGoal(CONVERSATION)?.status).toBe("dropped");
  });
});

describe("handleWritePlan", () => {
  test("落盘到数据目录并回传 markdown 供 proposed-plan 事件使用", () => {
    const result = handleWritePlan(CONVERSATION, WORKSPACE, "# 方案\n\n第一步：改 a.ts");
    expect(result.planMarkdown).toContain("改 a.ts");
    expect(getPlan(CONVERSATION)?.content).toContain("改 a.ts");
    // 工作区一行都不能碰
    expect(getPlan(CONVERSATION)?.filePath ?? "").toContain(scratchDir);
  });

  test("空方案被拒绝，不产生 proposed-plan", () => {
    const result = handleWritePlan(CONVERSATION, WORKSPACE, "   ");
    expect(result.planMarkdown).toBeNull();
    expect(getPlan(CONVERSATION)).toBeNull();
  });
});

describe("applyGoalStatus", () => {
  test("从 budget-limited 恢复时重置续跑计数（否则下一次立刻又停）", () => {
    handleGoalTool(CONVERSATION, { op: "create", objective: "x" });
    const store = createInMemoryAgentStore();
    setAgentStore(store);
    handleGoalTool(CONVERSATION, { op: "create", objective: "x" });

    // 模拟撞上预算：计到上限并置为 budget-limited
    const goal = getGoal(CONVERSATION);
    expect(goal).not.toBeNull();
    store.upsertGoal({
      ...goal!,
      status: "budget-limited",
      continuations: 6,
      createdAt: goal!.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    });

    const resumed = applyGoalStatus(THREAD, "active");
    expect(resumed?.status).toBe("active");
    expect(resumed?.continuations).toBe(0);
  });

  test("没有目标时返回 null 而不是抛错", () => {
    expect(applyGoalStatus(THREAD, "active")).toBeNull();
  });

  test("暂停保留计数（只是不继续跑）", () => {
    handleGoalTool(CONVERSATION, { op: "create", objective: "x" });
    const paused = applyGoalStatus(THREAD, "paused");
    expect(paused?.status).toBe("paused");
  });
});

/**
 * 每轮系统提示的拼装。
 *
 * 流程段是"默认走流程"这个承诺的唯一落点：它在 `before_agent_start` 里拼进每一轮的
 * 系统提示，任何一个模式、任何一条会话都绕不过去。这里用一个假的 pi API 把 handler
 * 抓出来直接调用，钉住"基础提示被保留 + 两段都被追加 + 关掉开关就消失"。
 */
describe("makeToolkitContextExtension", () => {
  type Handler = (event: { systemPrompt: string }) => { systemPrompt?: string } | void;

  const runHandler = (conversationId: number, mode: ProviderInteractionMode) => {
    const handlers = new Map<string, Handler>();
    const pi = {
      on: (name: string, handler: Handler) => {
        handlers.set(name, handler);
      },
    } as unknown as Parameters<ExtensionFactory>[0];

    makeToolkitContextExtension({ conversationId, currentMode: () => mode })(pi);
    const handler = handlers.get("before_agent_start");
    expect(handler, "扩展没有注册 before_agent_start").toBeDefined();
    return handler!({ systemPrompt: "BASE PROMPT" });
  };

  test("Agent 模式下也追加流程段（不是只有 goal / plan 才注入）", () => {
    const result = runHandler(CONVERSATION, "default");
    const prompt = result && "systemPrompt" in result ? result.systemPrompt : undefined;
    expect(prompt).toContain("BASE PROMPT");
    // 流程段与机器上装了哪些技能无关，因此这条在任何环境都成立；
    // 技能清单那一半取决于 `~/.agents/skills`，不在这里断言。
    expect(prompt).toContain("工程流程");
    expect(prompt).toContain("read_skill");
  });

  test("关掉流程开关后不再追加这一段", () => {
    updateSettings({ AGENT_SKILL_WORKFLOW: "0" });
    const result = runHandler(CONVERSATION, "default");
    const prompt = result && "systemPrompt" in result ? result.systemPrompt : undefined;
    expect(prompt ?? "").not.toContain("工程流程");
  });
});
