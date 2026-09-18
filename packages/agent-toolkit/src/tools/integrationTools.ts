/**
 * IntegrationTools - Tools that bridge into automations, kanban boards and subagents.
 *
 * @module IntegrationTools
 */

import path from "node:path";

import {
  BuiltTool,
  KanbanCommentToolParams,
  ScheduleTaskToolParams,
  ToolContext,
  errorResult,
  textResult,
} from "./toolSupport.ts";

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
 * `schedule_task`：把一句话变成以后会自己跑的定时任务。
 *
 * 用户平常就是这么描述定时任务的（"每天早上帮我把昨天的改动汇总一下"），
 * 与其让宿主去猜自然语言，不如给模型一个工具：它听得懂人话，也知道该把哪些细节补全。
 * 真正的落库、计划计算、到点开一条会话，全在宿主的自动化模块里，这里只做转述。
 *
 * 结果里必须带上任务 id 和**下次触发时间**：用户要的是"我什么时候能看到结果"，
 * 模型也要靠 id 才能在后续对话里暂停 / 恢复这个任务。
 */
export function createScheduleTaskTool(ctx: ToolContext): BuiltTool {
  return {
    name: "schedule_task",
    label: "Schedule a task",
    description:
      "Create and manage scheduled tasks (automations): a plan plus one instruction, run in a workspace on a schedule. " +
      "Each run opens a real conversation in that workspace, so the work is readable afterwards. " +
      "`create` adds a task — give it a title, instructions, and schedule_kind (once | daily | weekly) with the matching " +
      "time fields: `at` (ISO) for once, `hour` + `minute` for daily, `hour` + `minute` + `days_of_week` for weekly. " +
      "It runs in the current workspace unless `project_id` says otherwise, and in the current timezone unless `timezone` does. " +
      "`list` shows the existing tasks with their ids, plan and next run. " +
      "`set_enabled` pauses or resumes one by automation_id. " +
      "Write instructions that stand on their own: a scheduled run has nobody to answer questions, so name the files to touch, " +
      "the exact format you want, and where the result should be written. " +
      "Summarise what you scheduled — next run included — in your reply.",
    parameters: Type.Object({
      op: Type.String({ description: "create | list | set_enabled" }),
      title: Type.Optional(
        Type.String({
          description: "create: short name, used in the task list and in run titles.",
        }),
      ),
      instructions: Type.Optional(
        Type.String({
          description:
            "create: what the run must do, in one paragraph. Self-contained: nobody will be there to clarify it.",
        }),
      ),
      schedule_kind: Type.Optional(Type.String({ description: "create: once | daily | weekly." })),
      at: Type.Optional(
        Type.String({ description: "create, once: ISO instant of the single run (future)." }),
      ),
      hour: Type.Optional(
        Type.Number({ description: "create, daily/weekly: wall-clock hour in `timezone` (0-23)." }),
      ),
      minute: Type.Optional(
        Type.Number({
          description: "create, daily/weekly: wall-clock minute in `timezone` (0-59).",
        }),
      ),
      days_of_week: Type.Optional(
        Type.Array(Type.Number(), {
          description: "create, weekly: weekdays, 0=Sunday … 6=Saturday.",
        }),
      ),
      timezone: Type.Optional(
        Type.String({
          description: "create: IANA timezone, e.g. Asia/Shanghai. Defaults to the current one.",
        }),
      ),
      mode: Type.Optional(
        Type.String({
          description:
            "create: default | plan | goal. `plan` only proposes changes, `goal` works toward an acceptance criterion.",
        }),
      ),
      project_id: Type.Optional(
        Type.String({
          description: "create: run in another workspace (project id) instead of this one.",
        }),
      ),
      automation_id: Type.Optional(
        Type.String({ description: "set_enabled: the task id reported by list." }),
      ),
      enabled: Type.Optional(
        Type.Boolean({ description: "set_enabled: true resumes the plan, false pauses it." }),
      ),
    }),
    execute: async (_toolCallId, params: ScheduleTaskToolParams) => {
      if (!ctx.onScheduleTask) {
        return errorResult("Scheduled tasks are not available in this session.");
      }
      return ctx.onScheduleTask(params);
    },
  };
}

/**
 * `kanban_comment`：把"这一步做完了"记到看板卡片上。
 *
 * 看板派发的任务在界面上是**一张卡片**：用户盯着卡片看进度，不一定会开那条会话。
 * 会话里说过什么，卡片那边看不见 —— 只有落到 comments 里的东西才看得见。
 * 所以流程每走完一步就留一条，卡片详情页的时间线才是完整的。
 *
 * 宿主按会话反查卡片，模型只管写内容：让它自己填任务 id 既多余又容易填错。
 */
export function createKanbanCommentTool(ctx: ToolContext): BuiltTool {
  return {
    name: "kanban_comment",
    label: "Comment on the board",
    description:
      "Post one progress comment on the kanban card this conversation was started from. " +
      "Board tasks are expected to leave a comment whenever a step of the workflow finishes " +
      "(define / plan / build / verify / review / ship) — the card's timeline is the only place " +
      "someone watching the board can follow the work, since conversation text does not reach it. " +
      "Write one short line: which step just finished, the evidence (files touched, commands run, " +
      "what the output showed), and what comes next. No essays — this is a log line. " +
      "Conversations that are not a board task are told so instead of writing anything.",
    parameters: Type.Object({
      body: Type.String({
        description:
          "The progress line, plain text. Say what finished, what proved it, and what is next.",
      }),
    }),
    execute: async (_toolCallId, params: KanbanCommentToolParams) => {
      if (!ctx.onKanbanComment) {
        return errorResult("Board comments are not available in this session.");
      }
      if (!params.body?.trim()) return errorResult("A board comment needs a `body`.");
      return ctx.onKanbanComment(params);
    },
  };
}

/**
 * `kanban_task`：读回这张卡片的历史。
 *
 * 派发时进提示词的只有**当前**这一版需求，而卡片上真正积累下来的东西 ——
 * 需求改过几版、之前几轮怎么设计的、为什么被中断、用户反馈了什么 —— 都在评论区里。
 * 所以：二次上手、被中断后重来、或需求看起来和现状对不上时，先读一次再动手。
 *
 * 和 `kanban_comment` 一样由宿主按会话反查卡片，模型不带任何 id；
 * 只读，所以 Plan 模式下也能用。
 */
export function createKanbanTaskTool(ctx: ToolContext): BuiltTool {
  return {
    name: "kanban_task",
    label: "Read the board card",
    description:
      "Read the kanban card this conversation was dispatched from: its original requirement, " +
      "how that requirement changed, what earlier runs decided and did, and what the user wrote " +
      "back on the card. Call it when you are picking up work someone else started — a card that " +
      "was interrupted, blocked, or handed to an agent a second time — rather than assuming the " +
      "prompt is the whole story. It also returns the board file path; that file is plain JSON " +
      "committed with the project, so `git log` on it shows how the requirement evolved. " +
      "Read-only, safe in any mode. Conversations that are not a board task are told so instead " +
      "of getting an empty card.",
    parameters: Type.Object({}),
    execute: async () => {
      if (!ctx.onKanbanTask) {
        return errorResult("The board is not available in this session.");
      }
      return ctx.onKanbanTask();
    },
  };
}

/**
 * `task` 的子智能体类型。
 *
 * - `explore`：只读调研，自己读一堆文件，只回一段能自包含的结论；
 * - `general`：全能力（仍然受权限策略约束），用于"这一块独立做完"的活；
 * - `review`：**审阅当前工作区的改动**。和另外两种的区别是它不需要模型描述要审什么 ——
 *   工作区里未提交的 diff 由主进程直接喂给它（对齐 oh-my-pi 的 reviewer 子智能体：
 *   按"能证明的影响 + 确实是这次引入的"给结论，而不是泛泛地说"建议加注释"）。
 */
export const SUBAGENT_TYPES = ["explore", "general", "review"] as const;
export type SubagentType = (typeof SUBAGENT_TYPES)[number];

export function normalizeSubagentType(raw: string | undefined): SubagentType {
  const value = raw?.trim();
  return (SUBAGENT_TYPES as readonly string[]).includes(value ?? "")
    ? (value as SubagentType)
    : "general";
}

export function createTaskTool(ctx: ToolContext): BuiltTool {
  return {
    name: "task",
    label: "Delegate to subagent",
    description:
      "Delegate a self-contained sub-task to a subagent that has its own context window, then " +
      'returns only its final answer. Use it for broad exploration ("find every place X is used") ' +
      "or work that would flood your own context with tool output. The subagent cannot ask the user.\n" +
      "- subagent_type=explore: read-only search over the workspace.\n" +
      "- subagent_type=general: full tools (default), for doing a self-contained piece of work.\n" +
      "- subagent_type=review: review the CURRENT uncommitted workspace changes. You do not need to " +
      "describe what changed — the diff is handed to the reviewer; just say what to focus on.",
    parameters: Type.Object({
      description: Type.String({ description: "Short (3-5 words) description of the sub-task." }),
      prompt: Type.String({ description: "Full, self-contained instructions for the subagent." }),
      subagent_type: Type.Optional(
        Type.String({
          description:
            "explore (read-only) | general (full tools, default) | review (review current changes)",
        }),
      ),
    }),
    execute: async (
      _toolCallId,
      params: { description: string; prompt: string; subagent_type?: string },
      signal?: AbortSignal,
    ) => {
      if (!ctx.spawnSubagent) return errorResult("Subagents are not available in this mode.");
      void signal;
      const subagentType = normalizeSubagentType(params.subagent_type);
      try {
        const summary = await ctx.spawnSubagent({
          description: params.description,
          prompt: params.prompt,
          subagentType,
        });
        return textResult(summary || "(subagent returned no output)");
      } catch (e) {
        return errorResult(`task failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  };
}

/** 抓网页正文：只做 GET + 去标签，够模型读文档 / 排错，不做浏览器自动化。 */
