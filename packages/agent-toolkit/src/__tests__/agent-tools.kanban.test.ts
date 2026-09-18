/**
 * 看板两个工具的单测：`kanban_comment`（写）和 `kanban_task`（读）。
 *
 * 它们的全部意义是"把进度写到卡片上 / 把卡片的历史读回来"，所以钉住四件事：
 * 有没有装宿主时要如实说、空白内容不许写、只读的那个在 Plan 模式下也得在，
 * 以及参数之外的卡片信息一律由宿主决定（工具不替模型传任务 id）。
 */
import { describe, expect, test } from "vitest";

import {
  buildAgentTools,
  buildReadOnlyTools,
  type BuiltTool,
  type KanbanCommentToolParams,
  type ToolContext,
} from "../agent-tools.ts";

const ctx: ToolContext = { workspace: "/tmp/peakcode-kanban-tool", allowShell: false };

function tool(tools: BuiltTool[], name: string): BuiltTool {
  const found = tools.find((item) => item.name === name);
  if (!found) throw new Error(`tool not found: ${name}`);
  return found;
}

const textOf = (result: { content: { type: string; text?: string }[] }): string =>
  result.content.map((part) => part.text ?? "").join("\n");

describe("kanban_comment 工具", () => {
  test("注册在完整工具集里（看板派发的会话拿得到）", () => {
    const names = buildAgentTools(ctx).map((item) => item.name);
    expect(names).toContain("kanban_comment");
  });

  test("没有宿主时说明这个会话没有看板，而不是静默成功", async () => {
    const result = await tool(buildAgentTools(ctx), "kanban_comment").execute("t1", {
      body: "实现完成",
    });
    expect(textOf(result)).toContain("not available");
  });

  test("把内容原样交给宿主，由宿主决定写到哪张卡片", async () => {
    const seen: KanbanCommentToolParams[] = [];
    const tools = buildAgentTools({
      ...ctx,
      onKanbanComment: (params) => {
        seen.push(params);
        return { content: [{ type: "text", text: "ok" }], details: {} };
      },
    });

    await tool(tools, "kanban_comment").execute("t1", { body: "  验证：bun run test 全绿  " });
    expect(seen).toEqual([{ body: "  验证：bun run test 全绿  " }]);
  });

  test("空内容被挡住（不写进卡片，也不骗模型说写好了）", async () => {
    let calls = 0;
    const tools = buildAgentTools({
      ...ctx,
      onKanbanComment: () => {
        calls += 1;
        return { content: [{ type: "text", text: "ok" }], details: {} };
      },
    });

    const result = await tool(tools, "kanban_comment").execute("t1", { body: "   " });
    expect(calls).toBe(0);
    expect(textOf(result)).toContain("body");
  });
});

describe("kanban_task 工具", () => {
  test("注册在完整工具集里", () => {
    const names = buildAgentTools(ctx).map((item) => item.name);
    expect(names).toContain("kanban_task");
  });

  test("不在只读工具集里（它靠宿主回调，不是本地读盘）", () => {
    // buildReadOnlyTools 是给没有宿主的环境用的那一套；看板只在服务器里存在。
    const names = buildReadOnlyTools(ctx).map((item) => item.name);
    expect(names).not.toContain("kanban_task");
  });

  test("没有宿主时说明这个会话没有看板，而不是回一张空卡片", async () => {
    const result = await tool(buildAgentTools(ctx), "kanban_task").execute("t1", {});
    expect(textOf(result)).toContain("not available");
  });

  test("不带任何参数，卡片由宿主按会话反查", async () => {
    let calls = 0;
    const tools = buildAgentTools({
      ...ctx,
      onKanbanTask: () => {
        calls += 1;
        return {
          content: [{ type: "text", text: "## 需求\n\n先把离线队列做出来。" }],
          details: {},
        };
      },
    });

    const result = await tool(tools, "kanban_task").execute("t1", {});
    expect(calls).toBe(1);
    expect(textOf(result)).toContain("先把离线队列做出来。");
  });
});
