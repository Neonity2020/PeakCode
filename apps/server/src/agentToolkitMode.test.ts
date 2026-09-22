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
/** The mode every gate assertion below runs in, as a reader so `currentMode` can be re-read. */
const multiMode: () => ProviderInteractionMode = () => "multi";

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
  // 读卡片是只读的：plan 模式要能看历史，所以它不在 WRITE_CAPABLE 里。
  "kanban_task",
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
  "crew_reminder",
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
    // 看板一写一读：写的那半属于"改工作区"被摘掉，读的那半留着 ——
    // 出方案的人正是最需要先看卡片历史的人。
    expect(active).not.toContain("kanban_comment");
    expect(active).toContain("kanban_task");
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

  test("multi：与 default 同一套工具（减去 pi-crew），编排靠提示词与每个 worker 的模型", () => {
    const active = activeToolNamesForMode("multi", ALL_TOOLS);
    // 编排者自己也要能改文件、跑命令：拆不动的小事直接做掉比派出去更快。
    // `crew_*` 是唯一例外：multi 自己就有 `task`，两套派活机制不能同时露给模型。
    for (const tool of WRITE_CAPABLE.filter((name) => !name.startsWith("crew_"))) {
      expect(active).toContain(tool);
    }
    // 派活的入口必须在，否则这个模式没法工作。
    expect(active).toContain("task");
    expect(active).not.toContain("write_plan");
    expect(active).not.toContain("goal");
  });

  test("multi：整套 pi-crew 工具都被摘掉，派活只能走 task", () => {
    const active = activeToolNamesForMode("multi", ALL_TOOLS);
    // 两套派活机制并存时模型会随机挑，挑到 crew 就是一次界面上看不见、也停不掉的干活。
    for (const tool of ALL_TOOLS.filter((name) => name.startsWith("crew_"))) {
      expect(active, `${tool} 不该在 multi 模式可用`).not.toContain(tool);
    }
    expect(active).toContain("task");
    // 只在这个模式里收起来：别的模式照旧能用 pi-crew。
    expect(activeToolNamesForMode("default", ALL_TOOLS)).toContain("crew_spawn");
    expect(activeToolNamesForMode("goal", ALL_TOOLS)).toContain("crew_list");
  });

  test("四个模式都不会把工具集扩成不存在的名字", () => {
    for (const mode of ["default", "plan", "goal", "multi"] as const) {
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

/**
 * 派活闸门。
 *
 * 协议里写了"先分析、先说明"，但实测模型可以完全无视它 —— 用户消息之后直接是一串 `task`
 * 调用，界面上就是莫名其妙冒出来一堆子 Agent。所以这条约束由 `tool_call` 钩子强制：没有
 * 输出过任何可见文字时，本轮的第一次 `task` 会被拒绝一次并回一句"先说方案"。这里钉的是
 * 三个边界：真拦、拦一次就放行（不能死锁）、别的模式不拦。
 */
describe("Multi-Agent 派活闸门", () => {
  type BeforeStartHandler = (event: { systemPrompt: string }) => { systemPrompt?: string } | void;
  type MessageHandler = (event: {
    message: { role: string; content: ReadonlyArray<Record<string, unknown>> };
  }) => void;
  type ToolCallHandler = (event: {
    toolName: string;
    input: Record<string, unknown>;
  }) => { block?: boolean; reason?: string } | void;

  const build = (mode: () => ProviderInteractionMode) => {
    let beforeAgentStart: BeforeStartHandler | undefined;
    let messageUpdate: MessageHandler | undefined;
    let toolCall: ToolCallHandler | undefined;

    const pi = {
      on: (name: string, handler: unknown) => {
        if (name === "before_agent_start") beforeAgentStart = handler as BeforeStartHandler;
        else if (name === "message_update") messageUpdate = handler as MessageHandler;
        else if (name === "tool_call") toolCall = handler as ToolCallHandler;
      },
    } as unknown as Parameters<ExtensionFactory>[0];

    makeToolkitContextExtension({ conversationId: CONVERSATION, currentMode: mode })(pi);

    const assistant = (content: ReadonlyArray<Record<string, unknown>>) =>
      messageUpdate?.({ message: { role: "assistant", content } });
    return {
      newTurn: () => beforeAgentStart?.({ systemPrompt: "BASE" }),
      assistantText: (text: string) => assistant([{ type: "text", text }]),
      thinkingOnly: () => assistant([{ type: "thinking", thinking: "先想想" }]),
      task: () => toolCall?.({ toolName: "task", input: {} }),
    };
  };

  const MULTI: () => ProviderInteractionMode = multiMode;

  test("multi：还没说清拆解就派活，第一次被挡下来并要求先说明", () => {
    const gate = build(MULTI);
    gate.newTurn();
    const result = gate.task();
    expect(result?.block).toBe(true);
    expect(result?.reason).toContain("先说明拆解方案");
    expect(result?.reason).toContain("为什么要创建这几个子");
  });

  test("multi：先输出过可见文字再派活就放行", () => {
    const gate = build(MULTI);
    gate.newTurn();
    gate.assistantText("我打算拆成三块：A 交给 Explore，B 交给 General，C 自己查。");
    expect(gate.task()).toBeUndefined();
  });

  test("multi：只想不做（没有可见文字）不算说明", () => {
    const gate = build(MULTI);
    gate.newTurn();
    gate.thinkingOnly();
    expect(gate.task()?.block).toBe(true);
  });

  test("multi：闸门只用一次，之后必须放行（否则这一轮再也派不出活）", () => {
    const gate = build(MULTI);
    gate.newTurn();
    expect(gate.task()?.block).toBe(true);
    expect(gate.task()).toBeUndefined();
  });

  test("multi：下一条用户消息会重新上闸（上一轮派过活也不豁免）", () => {
    const gate = build(MULTI);
    gate.newTurn();
    gate.assistantText("先说方案。");
    expect(gate.task()).toBeUndefined();
    gate.newTurn();
    expect(gate.task()?.block).toBe(true);
  });

  test("其他模式不拦：task 是普通工具", () => {
    for (const mode of ["default", "plan", "goal"] as const) {
      const gate = build(() => mode);
      gate.newTurn();
      expect(gate.task(), `${mode} 模式不该拦 task`).toBeUndefined();
    }
  });
});
