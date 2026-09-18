import { ProjectId } from "@peakcode/contracts";
import { describe, expect, it } from "vitest";

import {
  appendStoredComment,
  BOARD_RUN_INSTRUCTIONS,
  buildTaskPrompt,
  countTasksByStatus,
  KANBAN_DEFAULT_COLUMNS,
  createStoredTask,
  normalizeAgentRunStatus,
  normalizeBoardDocument,
  normalizePriority,
  normalizeStatus,
  reorderStoredTask,
  runOutcomeForCheckpointStatus,
  sortStoredTasks,
  taskModelSelection,
  taskNeedsAgentRun,
  taskStatusForRunOutcome,
  toKanbanBoard,
  type KanbanStoredBoard,
  type KanbanStoredTask,
} from "./boardDocument";

const CONTEXT = {
  projectId: ProjectId.makeUnsafe("project-1"),
  projectTitle: "Peak Code",
  workspaceRoot: "/tmp/peak-code",
  boardFilePath: "/tmp/peak-code/.kanban/board.json",
};

const NOW = "2026-09-16T03:27:15Z";

const makeTask = (overrides: Partial<KanbanStoredTask> = {}): KanbanStoredTask => ({
  id: "t_1",
  title: "Task",
  description: "",
  status: "todo",
  priority: "medium",
  pipeline: "",
  assignee: "",
  agentProvider: "pi",
  agentModel: "",
  attachments: [],
  comments: [],
  agentThreadId: "",
  agentRunStatus: null,
  createdAt: NOW,
  updatedAt: NOW,
  ...overrides,
});

describe("kanban status and priority aliases", () => {
  it("accepts the plugin's aliases, including Chinese labels", () => {
    expect(normalizeStatus("进行中")).toBe("in_progress");
    expect(normalizeStatus("In-Progress")).toBe("in_progress");
    expect(normalizeStatus("已完成")).toBe("done");
    expect(normalizeStatus("阻塞")).toBe("blocked");
    expect(normalizePriority("高")).toBe("high");
    expect(normalizePriority("紧急")).toBe("high");
    expect(normalizePriority("Low")).toBe("low");
  });

  it("falls back instead of failing on unknown values", () => {
    expect(normalizeStatus("sideways")).toBe("todo");
    expect(normalizePriority("urgent-ish")).toBe("medium");
    expect(normalizeStatus(undefined)).toBe("todo");
  });
});

describe("normalizeBoardDocument", () => {
  it("builds a default board when the project has no board file", () => {
    const board = normalizeBoardDocument(null, {
      projectId: "project-1",
      projectTitle: "Peak Code",
      now: NOW,
    });

    expect(board.version).toBe(1);
    expect(board.name).toBe("Peak Code 看板");
    expect(board.tasks).toEqual([]);
    expect(board.columns.map((column) => column.key)).toEqual([
      "todo",
      "in_progress",
      "done",
      "blocked",
      "archived",
    ]);
    expect(board.createdAt).toBe(NOW);
  });

  it("preserves unknown top-level keys and unknown task keys", () => {
    const board = normalizeBoardDocument(
      {
        version: 2,
        name: "Board 看板",
        projectId: "p_2cbeb743bb",
        customField: { keep: true },
        tasks: [
          {
            id: "t_9f26575a5b",
            title: "优化界面风格与Zcode 一致",
            status: "in_progress",
            priority: "medium",
            pipeline: "全栈开发流水线",
            extraTaskField: 42,
          },
        ],
      },
      { projectId: "project-1", projectTitle: "Peak Code", now: NOW },
    );

    expect(board.customField).toEqual({ keep: true });
    expect(board.version).toBe(2);
    expect(board.projectId).toBe("p_2cbeb743bb");
    expect(board.tasks).toHaveLength(1);
    expect(board.tasks[0]?.extraTaskField).toBe(42);
    expect(board.tasks[0]?.status).toBe("in_progress");
    expect(board.tasks[0]?.createdAt).toBe(NOW);
  });

  it("drops entries that are not task objects", () => {
    const board = normalizeBoardDocument(
      { tasks: ["nope", 7, null, { title: "kept" }] },
      {
        projectId: "project-1",
        projectTitle: "Peak Code",
        now: NOW,
      },
    );

    expect(board.tasks).toHaveLength(1);
    expect(board.tasks[0]?.title).toBe("kept");
  });

  it("reads a task's requirement description and defaults missing ones to empty", () => {
    const board = normalizeBoardDocument(
      {
        tasks: [
          {
            id: "t_desc",
            title: "带需求描述",
            description: "  需要支持多行描述\n第二行  ",
          },
          { id: "t_plain", title: "没有描述" },
          { id: "t_bad", title: "描述不是字符串", description: 42 },
        ],
      },
      { projectId: "project-1", projectTitle: "Peak Code", now: NOW },
    );

    expect(board.tasks[0]?.description).toBe("需要支持多行描述\n第二行");
    expect(board.tasks[1]?.description).toBe("");
    expect(board.tasks[2]?.description).toBe("");
  });

  it("keeps custom column names and orders them by status", () => {
    const board = normalizeBoardDocument(
      {
        columns: [
          { key: "blocked", name: "先看阻塞", dot: "#111111" },
          { key: "todo", name: "待开始", dot: "#222222" },
          { key: "nonsense", name: "x", dot: "#333333" },
        ],
      },
      { projectId: "project-1", projectTitle: "Peak Code", now: NOW },
    );

    // Columns the board did not define are filled in with the defaults, and the
    // custom name for 已阻塞 survives.
    expect(board.columns.map((column) => column.key)).toEqual([
      "todo",
      "in_progress",
      "done",
      "blocked",
      "archived",
    ]);
    expect(board.columns[3]?.name).toBe("先看阻塞");
  });
});

describe("reorderStoredTask", () => {
  const tasks = [
    makeTask({ id: "t_a", status: "todo", title: "A" }),
    makeTask({ id: "t_b", status: "todo", title: "B" }),
    makeTask({ id: "t_c", status: "done", title: "C" }),
  ];

  it("moves a task into another column at the requested index", () => {
    const next = reorderStoredTask(tasks, "t_c", "todo", 1, NOW);

    expect(next.map((task) => task.id)).toEqual(["t_a", "t_c", "t_b"]);
    expect(next.find((task) => task.id === "t_c")?.status).toBe("todo");
    expect(next.find((task) => task.id === "t_c")?.updatedAt).toBe(NOW);
  });

  it("appends when no order is given", () => {
    const next = reorderStoredTask(tasks, "t_c", "todo", undefined, NOW);

    expect(next.map((task) => task.id)).toEqual(["t_a", "t_b", "t_c"]);
  });

  it("reorders inside the same column", () => {
    const next = reorderStoredTask(tasks, "t_a", "todo", 1, NOW);

    expect(next.map((task) => task.id)).toEqual(["t_b", "t_a", "t_c"]);
  });

  it("clamps out-of-range orders to the end of the column", () => {
    const next = reorderStoredTask(tasks, "t_a", "done", 99, NOW);

    expect(next.map((task) => task.id)).toEqual(["t_b", "t_c", "t_a"]);
  });

  it("returns the original list when the task is unknown", () => {
    const next = reorderStoredTask(tasks, "t_missing", "done", 0, NOW);

    expect(next.map((task) => task.id)).toEqual(["t_a", "t_b", "t_c"]);
  });
});

describe("board views", () => {
  it("sorts tasks by status and maps them onto the wire shape", () => {
    const board: KanbanStoredBoard = normalizeBoardDocument(
      {
        tasks: [
          { id: "t_done", title: "Done", status: "done" },
          { id: "t_todo", title: "Todo", status: "todo" },
          { id: "t_progress", title: "Progress", status: "in_progress" },
        ],
      },
      { projectId: "project-1", projectTitle: "Peak Code", now: NOW },
    );

    expect(sortStoredTasks(board.tasks).map((task) => task.status)).toEqual([
      "todo",
      "in_progress",
      "done",
    ]);

    const view = toKanbanBoard(board, CONTEXT);
    expect(view.projectId).toBe("project-1");
    expect(view.boardFilePath).toBe("/tmp/peak-code/.kanban/board.json");
    expect(view.tasks.map((task) => task.taskId)).toEqual(["t_todo", "t_progress", "t_done"]);
    expect(view.tasks[0]?.createdAt).toBe(NOW);
    expect(view.tasks.map((task) => task.description)).toEqual(["", "", ""]);
  });

  it("counts tasks per column for the project scan", () => {
    const counts = countTasksByStatus([
      makeTask({ id: "t_1", status: "todo" }),
      makeTask({ id: "t_2", status: "in_progress" }),
      makeTask({ id: "t_3", status: "in_progress" }),
      makeTask({ id: "t_4", status: "blocked" }),
    ]);

    expect(counts).toEqual({
      taskCount: 4,
      todoCount: 1,
      inProgressCount: 2,
      doneCount: 0,
      blockedCount: 1,
    });
  });

  it("creates plugin-compatible task ids and trimmed fields", () => {
    const task = createStoredTask({
      title: "  写周报  ",
      description: "  汇总本周进展\n并给出下周计划  ",
      status: "todo",
      priority: "high",
      pipeline: " 日常运营 ",
      assignee: " 全栈开发 ",
      now: NOW,
    });

    expect(task.id).toMatch(/^t_[0-9a-f]{10}$/);
    expect(task.title).toBe("写周报");
    expect(task.description).toBe("汇总本周进展\n并给出下周计划");
    expect(task.pipeline).toBe("日常运营");
    expect(task.assignee).toBe("全栈开发");
    expect(task.createdAt).toBe(NOW);
    expect(task.updatedAt).toBe(NOW);
  });
});

describe("agent runs", () => {
  it("reads an agent run off a task and defaults missing ones", () => {
    const board = normalizeBoardDocument(
      {
        tasks: [
          { id: "t_run", title: "运行中", agentThreadId: "thread_1", agentRunStatus: "running" },
          { id: "t_idle", title: "还没跑" },
          { id: "t_bad", title: "脏数据", agentRunStatus: "sideways", agentThreadId: "  " },
        ],
      },
      { projectId: "project-1", projectTitle: "Peak Code", now: NOW },
    );

    expect(board.tasks[0]).toMatchObject({ agentThreadId: "thread_1", agentRunStatus: "running" });
    expect(board.tasks[1]).toMatchObject({ agentThreadId: "", agentRunStatus: null });
    expect(board.tasks[2]).toMatchObject({ agentThreadId: "", agentRunStatus: null });
    expect(normalizeAgentRunStatus("RUNNING")).toBe("running");
    expect(normalizeAgentRunStatus(7)).toBeNull();
  });

  it("hands a task to an agent only when it sits in progress without a run in flight", () => {
    expect(taskNeedsAgentRun(makeTask({ status: "in_progress" }))).toBe(true);
    expect(taskNeedsAgentRun(makeTask({ status: "in_progress", agentRunStatus: "failed" }))).toBe(
      true,
    );
    expect(taskNeedsAgentRun(makeTask({ status: "in_progress", agentRunStatus: "running" }))).toBe(
      false,
    );
    expect(taskNeedsAgentRun(makeTask({ status: "todo" }))).toBe(false);
    expect(taskNeedsAgentRun(makeTask({ status: "done" }))).toBe(false);
  });

  it("sends the title and the requirement description to the agent", () => {
    expect(buildTaskPrompt({ title: " 写周报 ", description: " 汇总本周进展 " })).toBe(
      `写周报\n\n汇总本周进展\n\n${BOARD_RUN_INSTRUCTIONS}`,
    );
    expect(buildTaskPrompt({ title: "只有标题", description: "   " })).toBe(
      `只有标题\n\n${BOARD_RUN_INSTRUCTIONS}`,
    );
    expect(buildTaskPrompt({ title: "  ", description: "只有描述" })).toBe(
      `只有描述\n\n${BOARD_RUN_INSTRUCTIONS}`,
    );
    expect(buildTaskPrompt({ title: "", description: "" })).toBe(BOARD_RUN_INSTRUCTIONS);
  });

  it("lists attachment paths for the agent without putting bytes in the prompt", () => {
    const prompt = buildTaskPrompt({
      title: "改首页",
      description: "按设计稿改",
      attachments: [
        {
          attachmentId: "a1",
          name: "设计稿.png",
          mimeType: "image/png",
          sizeBytes: 1234,
          relativePath: ".kanban/attachments/a1.png",
        },
      ],
    });

    expect(prompt).toContain("需求附带图片");
    expect(prompt).toContain(".kanban/attachments/a1.png（设计稿.png）");
    expect(prompt).toContain(BOARD_RUN_INSTRUCTIONS);
  });

  it("names the card and its board so a run can read the history behind the brief", () => {
    const prompt = buildTaskPrompt(
      { title: "接上多端同步", description: "先把离线队列做出来。" },
      { boardFilePath: "/tmp/peakcode/.kanban/board.json", taskId: "t_29b8116000" },
    );

    expect(prompt).toContain("`t_29b8116000`");
    expect(prompt).toContain("`/tmp/peakcode/.kanban/board.json`");
    // The path is only worth naming if the model is told what to do with it.
    expect(prompt).toContain("kanban_task");
    expect(prompt).toContain("git log");
    // Still the brief first, the standing instructions last.
    expect(prompt.startsWith("接上多端同步")).toBe(true);
    expect(prompt.endsWith(BOARD_RUN_INSTRUCTIONS)).toBe(true);
  });

  it("leaves the prompt alone when the caller does not know the board", () => {
    expect(buildTaskPrompt({ title: "写周报", description: "" })).not.toContain("kanban_task");
  });

  it("keeps only resolvable image attachments and rejects path escapes", () => {
    const board = normalizeBoardDocument(
      {
        tasks: [
          {
            id: "t_img",
            title: "图片任务",
            attachments: [
              {
                attachmentId: "ok",
                name: "shot.png",
                mimeType: "image/png",
                sizeBytes: 10,
                relativePath: ".kanban/attachments/ok.png",
              },
              {
                attachmentId: "escape",
                name: "sneaky.png",
                mimeType: "image/png",
                sizeBytes: 10,
                relativePath: "../outside.png",
              },
              {
                attachmentId: "absolute",
                name: "abs.png",
                mimeType: "image/png",
                sizeBytes: 10,
                relativePath: "/tmp/abs.png",
              },
              {
                attachmentId: "notimage",
                name: "f.pdf",
                mimeType: "application/pdf",
                relativePath: "x.pdf",
              },
            ],
          },
        ],
      },
      { projectId: "p_1", projectTitle: "Board" },
    );

    expect(board.tasks[0]?.attachments).toEqual([
      {
        attachmentId: "ok",
        name: "shot.png",
        mimeType: "image/png",
        sizeBytes: 10,
        relativePath: ".kanban/attachments/ok.png",
      },
    ]);
    expect(toKanbanBoard(board, CONTEXT).tasks[0]?.attachments).toHaveLength(1);
  });

  it("tells a dispatched run to leave a comment per finished step", () => {
    // The board only shows what lands in its comments, so the standing instructions have to
    // name the tool and the per-step cadence — without them a run works silently in its thread.
    expect(BOARD_RUN_INSTRUCTIONS).toContain("kanban_comment");
    expect(BOARD_RUN_INSTRUCTIONS).toContain("每完成一步");
  });

  it("maps a run outcome and a checkpoint status onto the task column", () => {
    expect(taskStatusForRunOutcome("done")).toBe("done");
    expect(taskStatusForRunOutcome("failed")).toBe("blocked");
    expect(taskStatusForRunOutcome("interrupted")).toBe("todo");

    expect(runOutcomeForCheckpointStatus("ready")).toBe("done");
    expect(runOutcomeForCheckpointStatus("error")).toBe("failed");
    expect(runOutcomeForCheckpointStatus("missing")).toBe("interrupted");
  });

  it("exposes the agent run on the wire shape", () => {
    const board = normalizeBoardDocument(
      {
        tasks: [
          { id: "t_run", title: "跑过的任务", agentThreadId: "thread_9", agentRunStatus: "done" },
        ],
      },
      { projectId: "project-1", projectTitle: "Peak Code", now: NOW },
    );

    const view = toKanbanBoard(board, CONTEXT);
    expect(view.tasks[0]?.agentThreadId).toBe("thread_9");
    expect(view.tasks[0]?.agentRunStatus).toBe("done");
  });
});

describe("task agent selection", () => {
  it("reads the agent and model off a task and defaults missing ones", () => {
    const board = normalizeBoardDocument(
      {
        tasks: [
          { id: "t_pick", title: "指定模型", agentProvider: "pi", agentModel: " deepseek/v4 " },
          { id: "t_default", title: "跟随默认" },
          { id: "t_bad", title: "脏数据", agentProvider: "hal", agentModel: 42 },
        ],
      },
      { projectId: "project-1", projectTitle: "Peak Code", now: NOW },
    );

    expect(board.tasks[0]).toMatchObject({ agentProvider: "pi", agentModel: "deepseek/v4" });
    expect(board.tasks[1]).toMatchObject({ agentProvider: "pi", agentModel: "" });
    expect(board.tasks[2]).toMatchObject({ agentProvider: "pi", agentModel: "" });
  });

  it("only builds a model selection when the task names a model", () => {
    expect(taskModelSelection({ agentProvider: "pi", agentModel: "deepseek/v4" })).toEqual({
      provider: "pi",
      model: "deepseek/v4",
    });
    expect(taskModelSelection({ agentProvider: "pi", agentModel: "   " })).toBeNull();
    expect(taskModelSelection({ agentProvider: "hal", agentModel: "x" })).toEqual({
      provider: "pi",
      model: "x",
    });
  });

  it("carries the selection through task creation and onto the wire shape", () => {
    const created = createStoredTask({
      title: "写周报",
      description: "",
      status: "todo",
      priority: "medium",
      pipeline: "",
      assignee: "",
      agentProvider: "pi",
      agentModel: " deepseek/v4 ",
      now: NOW,
    });

    expect(created.agentProvider).toBe("pi");
    expect(created.agentModel).toBe("deepseek/v4");

    const board: KanbanStoredBoard = normalizeBoardDocument(
      { tasks: [created] },
      { projectId: "project-1", projectTitle: "Peak Code", now: NOW },
    );
    expect(toKanbanBoard(board, CONTEXT).tasks[0]).toMatchObject({
      agentProvider: "pi",
      agentModel: "deepseek/v4",
    });
  });
});

describe("task comments and archiving", () => {
  it("keeps comments in order and drops entries without an id or timestamp", () => {
    const board = normalizeBoardDocument(
      {
        tasks: [
          {
            id: "t_comments",
            title: "带评论",
            comments: [
              {
                commentId: "c_1",
                author: "agent",
                kind: "status",
                statusCode: "started",
                body: "",
                createdAt: NOW,
              },
              {
                commentId: "c_2",
                author: "user",
                kind: "note",
                body: "看到问题了",
                createdAt: NOW,
              },
              { author: "user", kind: "note", body: "没有 id", createdAt: NOW },
              { commentId: "c_3", body: "没有时间戳" },
              "nonsense",
            ],
          },
        ],
      },
      { projectId: "project-1", projectTitle: "Peak Code", now: NOW },
    );

    expect(board.tasks[0]?.comments.map((comment) => comment.commentId)).toEqual(["c_1", "c_2"]);
    expect(board.tasks[0]?.comments[0]).toMatchObject({ kind: "status", statusCode: "started" });
  });

  it("appends comments with generated ids", () => {
    const task = makeTask();
    const comment = appendStoredComment(task, {
      author: "user",
      kind: "note",
      body: "  帮我先跑一遍测试  ",
      now: NOW,
    });

    expect(comment.commentId).toMatch(/^c_[0-9a-f]{10}$/);
    expect(comment.body).toBe("帮我先跑一遍测试");
    expect(task.comments).toHaveLength(1);
  });

  it("treats 归档 as an archived task", () => {
    const board = normalizeBoardDocument(
      { tasks: [{ id: "t_arch", title: "归档任务", status: "归档" }] },
      { projectId: "project-1", projectTitle: "Peak Code", now: NOW },
    );

    expect(board.tasks[0]?.status).toBe("archived");
    expect(normalizeStatus("Archived")).toBe("archived");
    expect(KANBAN_DEFAULT_COLUMNS.map((column) => column.key)).toContain("archived");
  });

  it("carries comments onto the wire shape", () => {
    const board = normalizeBoardDocument(
      {
        tasks: [
          {
            id: "t_wire",
            title: "评论上墙",
            comments: [
              {
                commentId: "c_wire",
                author: "agent",
                kind: "message",
                body: "我打算先改契约层",
                createdAt: NOW,
              },
            ],
          },
        ],
      },
      { projectId: "project-1", projectTitle: "Peak Code", now: NOW },
    );

    expect(toKanbanBoard(board, CONTEXT).tasks[0]?.comments).toHaveLength(1);
  });
});

describe("column migration", () => {
  it("adds columns introduced later to boards that predate them", () => {
    const board = normalizeBoardDocument(
      {
        columns: [
          { key: "blocked", name: "先看阻塞", dot: "#111111" },
          { key: "todo", name: "待开始", dot: "#222222" },
        ],
      },
      { projectId: "project-1", projectTitle: "Peak Code", now: NOW },
    );

    expect(board.columns.map((column) => column.key)).toEqual([
      "todo",
      "in_progress",
      "done",
      "blocked",
      "archived",
    ]);
    // Custom names survive the migration.
    expect(board.columns[3]?.name).toBe("先看阻塞");
    expect(board.columns[4]?.name).toBe("归档");
  });
});
