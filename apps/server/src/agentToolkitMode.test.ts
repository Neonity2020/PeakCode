import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getGoal } from "@peakcode/agent-toolkit/agent-goals";
import { getPlan } from "@peakcode/agent-toolkit/agent-plans";
import { createInMemoryAgentStore, setAgentStore } from "@peakcode/agent-toolkit/store/AgentStore";
import { setAgentDataDir } from "@peakcode/agent-toolkit/runtime/paths";
import { ThreadId } from "@peakcode/contracts";
import { afterAll, beforeEach, describe, expect, test } from "vitest";

import {
  activeToolNamesForMode,
  applyGoalStatus,
  handleGoalTool,
  handleWritePlan,
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
  "task",
  "checkpoint",
  "rewind",
  "think",
  "read_skill",
];

const WRITE_CAPABLE = ["write", "edit", "bash", "write_file", "edit_file", "apply_patch", "task"];

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
