/**
 * `kanban_comment` 的单测。
 *
 * 这个工具的全部意义是"把一步进度写到卡片上"，所以钉住三件事：
 * 有没有装宿主时要如实说、空白内容不许写、参数之外的卡片信息一律由宿主决定
 * （工具只转交 body，不替模型传任务 id）。
 */
import { describe, expect, test } from "vitest";

import {
  buildAgentTools,
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
