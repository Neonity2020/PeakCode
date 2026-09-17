/**
 * InteractionTools - Conversational tools: todo_write, ask_user, goal and write_plan.
 *
 * @module InteractionTools
 */

import path from "node:path";

import { BuiltTool, ToolContext, errorResult, textResult } from "./toolSupport.ts";

import { Type } from "@earendil-works/pi-ai";

/**
 * Agent 可使用的工具集。
 *
 * 权限模型（对齐 PI-Desktop 的思路：特权操作必须显式放行）：
 * - 只读工具（read_file / list_dir / glob / grep / web_search）可访问工作区之外的
 *   绝对路径，因为"读"不产生副作用；
 * - 写操作（write_file / edit_file / apply_patch）与 shell（bash）只能作用于工作区目录内，
 *   且 shell 还受 AGENT_ALLOW_SHELL 开关控制。
 */

/**
 * 待办清单：Agent 把多步任务拆成清单并持续更新状态，UI 在输入框上方显示进度。
 * 这是让"长任务看起来在推进"的关键（对齐 OpenWork 的 todowrite）。
 */
export function createTodoWrite(ctx: ToolContext): BuiltTool {
  return {
    name: "todo_write",
    label: "Update todo list",
    description:
      "Create or update the task list for the current work. Pass the FULL list every time " +
      "(it replaces the previous one). Keep at most one item in_progress. " +
      "Use it for multi-step work so the user can see progress.",
    parameters: Type.Object({
      todos: Type.Array(
        Type.Object({
          content: Type.String({ description: "What this step does (short, imperative)." }),
          status: Type.Optional(
            Type.String({ description: "pending | in_progress | completed | cancelled" }),
          ),
          priority: Type.Optional(Type.String({ description: "high | medium | low" })),
        }),
      ),
    }),
    execute: async (
      _toolCallId,
      params: { todos: { content: string; status?: string; priority?: string }[] },
    ) => {
      if (!ctx.onTodoWrite) return errorResult("Todo list is not available in this mode.");
      ctx.onTodoWrite(params.todos ?? []);
      const done = (params.todos ?? []).filter((t) => t.status === "completed").length;
      return textResult(`Todo list updated (${done}/${params.todos?.length ?? 0} done).`);
    },
  };
}

/** 反问用户：需要澄清意图 / 让用户做选择时用，答案会作为工具结果回到上下文。 */
export function createAskUser(ctx: ToolContext): BuiltTool {
  return {
    name: "ask_user",
    label: "Ask the user",
    description:
      "Ask the user one or more questions and wait for the answer. Use it when the task is " +
      "ambiguous or a decision must be made by the user (choices, preferences, credentials). " +
      "Prefer concrete options; the user can always type a custom answer.",
    parameters: Type.Object({
      questions: Type.Array(
        Type.Object({
          header: Type.Optional(Type.String({ description: "Short label for the question." })),
          question: Type.String({ description: "The question to ask." }),
          options: Type.Optional(
            Type.Array(
              Type.Object({
                label: Type.String(),
                description: Type.Optional(Type.String()),
              }),
            ),
          ),
          multiple: Type.Optional(
            Type.Boolean({ description: "Allow selecting several options." }),
          ),
        }),
      ),
    }),
    execute: async (
      _toolCallId,
      params: {
        questions: {
          header?: string;
          question: string;
          options?: { label: string; description?: string }[];
          multiple?: boolean;
        }[];
      },
    ) => {
      if (!ctx.askUser) return errorResult("Asking the user is not available in this mode.");
      const questions = (params.questions ?? []).filter((q) => q?.question?.trim());
      if (questions.length === 0) return errorResult("No question provided.");
      const answers = await ctx.askUser(questions);
      if (answers.length === 0) {
        return textResult(
          "The user did not answer (dismissed or timed out). Continue sensibly and say what you assumed.",
        );
      }
      const formatted = questions
        .map((q, i) => `Q: ${q.question}\nA: ${(answers[i] ?? []).join("、") || "(no answer)"}`)
        .join("\n\n");
      return textResult(formatted);
    },
  };
}

/** 子智能体：把一块独立调研 / 执行交给子任务，主上下文只收它的结论。 */
/**
 * `goal`：Goal 模式的目标管理。
 *
 * 为什么需要一个工具而不是全靠提示词：目标要**跨回合**存在。Goal 模式会自动续跑，
 * 每次续跑都是一次新的请求 —— 目标、验收标准、跑到哪了，必须落在库里，
 * 不然模型第二轮就只剩"继续"两个字可以依据。
 */
export function createGoalTool(ctx: ToolContext): BuiltTool {
  return {
    name: "goal",
    label: "Goal",
    description:
      "Manage the current goal (Goal mode). " +
      "`create` sets the objective and acceptance criteria — call it FIRST, before doing any work, " +
      "and use ask_user if the criteria are not clear yet. " +
      "`get` reports objective, status and budget usage. " +
      "`complete` finishes the goal — pass the evidence in outcome (files, commands, output). " +
      "`abandon` gives up with a reason — use it when genuinely blocked instead of claiming success.",
    parameters: Type.Object({
      op: Type.String({ description: "create | get | complete | abandon" }),
      objective: Type.Optional(
        Type.String({ description: "create: what must be achieved, in one sentence." }),
      ),
      acceptance: Type.Optional(
        Type.String({
          description:
            "create: how we will know it is done (concrete, checkable). Agree it with the user first.",
        }),
      ),
      outcome: Type.Optional(
        Type.String({ description: "complete: the evidence. abandon: why it cannot be done." }),
      ),
    }),
    execute: async (
      _toolCallId,
      params: { op: string; objective?: string; acceptance?: string; outcome?: string },
    ) => {
      if (!ctx.onGoal) return errorResult("Goal 工具只在 Goal 模式下可用。");
      return ctx.onGoal(params);
    },
  };
}

/**
 * `write_plan`：Plan 模式**唯一**能写的东西。
 *
 * 把方案写进数据目录（不是工作区），并登记成产出物 —— 右侧面板能预览，切回 Agent 模式后
 * 模型手里也还留着那份方案（否则只能去历史正文里捞）。这是"Plan 模式一行都不许改工作区"
 * 与"方案要能留下来、能被批准"之间的那个折中。
 */
export function createWritePlan(ctx: ToolContext): BuiltTool {
  return {
    name: "write_plan",
    label: "Write plan",
    description:
      "Write the implementation plan to a plan file (outside the workspace) and show it to the user. " +
      "This is the ONLY way to save something in Plan mode — the workspace stays untouched. " +
      "Write the full plan in one call, replacing any previous version. " +
      "After writing it, summarise the plan briefly in your reply and stop; the user approves or asks for changes.",
    parameters: Type.Object({
      content: Type.String({
        description:
          "The plan in Markdown. It must be executable by someone who was not in this conversation: " +
          "goal, files to touch (with paths), step-by-step changes, risks, and how to verify. " +
          "Every path you name must have been read in this session — mark anything unverified as such.",
      }),
    }),
    execute: async (_toolCallId, params: { content: string }) => {
      if (!ctx.onWritePlan) return errorResult("写方案需要会话上下文（这个模式下拿不到）。");
      if (!params.content?.trim()) return errorResult("方案内容不能为空。");
      return ctx.onWritePlan(params.content);
    },
  };
}
