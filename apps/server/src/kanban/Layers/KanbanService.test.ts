import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer, Option, Stream } from "effect";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  KanbanTaskId,
  ProjectId,
  ThreadId,
  type ModelSelection,
  type OrchestrationCommand,
  type OrchestrationProjectShell,
  type OrchestrationThreadShell,
} from "@peakcode/contracts";
import { describe, expect, it } from "vitest";

import { TextGeneration } from "../../git/Services/TextGeneration.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { WorkspaceLayerLive } from "../../workspace/runtimeLayer.ts";
import { BOARD_RUN_INSTRUCTIONS } from "../boardDocument.ts";
import { KanbanService } from "../Services/KanbanService.ts";
import { ProviderDiscoveryService } from "../../provider/Services/ProviderDiscoveryService.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { KanbanServiceLive } from "./KanbanService.ts";

/** What the discovery stub reports. */
const TEST_MODEL_SLUG = "anthropic/claude-sonnet-4-6";
/** The project default two tests configure; it has to be offered to be used. */
const TEST_PROJECT_MODEL_SLUG = "deepseek/deepseek-v4-pro";
/** A model named in the create dialog. */
const TEST_DIALOG_MODEL_SLUG = "pi/fast";

const PROJECT_ID = ProjectId.makeUnsafe("project-kanban-test");

const projectShell = (
  workspaceRoot: string,
  defaultModelSelection: OrchestrationProjectShell["defaultModelSelection"] = null,
): OrchestrationProjectShell => ({
  id: PROJECT_ID,
  kind: "project",
  title: "Peak Code",
  workspaceRoot,
  defaultModelSelection,
  scripts: [],
  createdAt: "2026-09-16T03:00:00Z",
  updatedAt: "2026-09-16T03:00:00Z",
});

const stubProjectionQuery = (
  projects: ReadonlyArray<OrchestrationProjectShell>,
  threads: ReadonlyArray<OrchestrationThreadShell> = [],
) =>
  Layer.succeed(ProjectionSnapshotQuery, {
    getCommandReadModel: () => Effect.die("unused"),
    getSnapshot: () => Effect.die("unused"),
    getCounts: () => Effect.die("unused"),
    getSnapshotSequence: () => Effect.die("unused"),
    getShellSnapshot: () =>
      Effect.succeed({
        snapshotSequence: 0,
        projects,
        threads: [],
        updatedAt: "2026-09-16T03:00:00Z",
      }),
    getActiveProjectByWorkspaceRoot: () => Effect.die("unused"),
    getProjectShellById: (projectId) =>
      Effect.succeed(
        Option.fromNullishOr(projects.find((project) => project.id === projectId) ?? null),
      ),
    getFirstActiveThreadIdByProjectId: () => Effect.die("unused"),
    getThreadCheckpointContext: () => Effect.die("unused"),
    getFullThreadDiffContext: () => Effect.die("unused"),
    getThreadShellById: (threadId) =>
      Effect.succeed(
        Option.fromNullishOr(threads.find((thread) => thread.id === threadId) ?? null),
      ),
    findSyntheticSubagentParentThread: () => Effect.die("unused"),
    // Detail reads fold the agent's own messages into the comment stream; boards
    // in these tests have no messages unless a test says so.
    getThreadDetailById: () => Effect.succeed(Option.none()),
    getThreadDetailSnapshotById: () => Effect.die("unused"),
  });

interface EngineStub {
  readonly dispatches: Array<OrchestrationCommand>;
  readonly failDispatch: boolean;
}

const stubOrchestrationEngine = (stub: EngineStub) =>
  Layer.succeed(OrchestrationEngineService, {
    dispatch: (command) =>
      stub.failDispatch
        ? Effect.fail({
            _tag: "OrchestrationDispatchError",
            message: "provider unavailable",
          } as never)
        : Effect.sync(() => {
            stub.dispatches.push(command);
            return { sequence: stub.dispatches.length };
          }),
    readEvents: () => Stream.empty,
    getReadModel: () => Effect.die("unused"),
    repairState: () => Effect.die("unused"),
    streamDomainEvents: Stream.empty,
  });

interface RequirementStub {
  calls: Array<{
    readonly cwd: string;
    readonly title: string;
    readonly notes?: string;
    readonly modelSelection?: ModelSelection | undefined;
  }>;
  requirement: string;
}

const stubTextGeneration = (stub: RequirementStub) =>
  Layer.succeed(TextGeneration, {
    generateTaskRequirement: (input) => {
      stub.calls.push({
        cwd: input.cwd,
        title: input.title,
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        modelSelection: input.modelSelection,
      });
      return Effect.succeed({ requirement: stub.requirement });
    },
    generateCommitMessage: () => Effect.die("unused"),
    generatePrContent: () => Effect.die("unused"),
    generateDiffSummary: () => Effect.die("unused"),
    generateBranchName: () => Effect.die("unused"),
    generateThreadTitle: () => Effect.die("unused"),
  });

const makeTestLayer = (
  projects: ReadonlyArray<OrchestrationProjectShell>,
  options?: {
    readonly engine?: EngineStub;
    readonly threads?: ReadonlyArray<OrchestrationThreadShell>;
    readonly requirement?: RequirementStub;
  },
) =>
  KanbanServiceLive.pipe(
    Layer.provideMerge(WorkspaceLayerLive),
    Layer.provide(stubProjectionQuery(projects, options?.threads ?? [])),
    Layer.provide(
      stubOrchestrationEngine(options?.engine ?? { dispatches: [], failDispatch: false }),
    ),
    Layer.provide(
      stubTextGeneration(
        options?.requirement ?? { calls: [], requirement: "## Goal\n- 生成的需求" },
      ),
    ),
    Layer.provideMerge(NodeServices.layer),
    // No default model is configured here, so the discovery stub below decides.
    Layer.provide(ServerSettingsService.layerTest()),
    // Board runs resolve a model too; the stub keeps the dispatch on a real slug. The
    // extra entries are the project/dialog defaults the tests configure: a headless run
    // only keeps a configured model while the provider still offers it.
    Layer.provide(
      ProviderDiscoveryService.layerTest({
        models: [
          { slug: TEST_MODEL_SLUG, name: "Test" },
          { slug: TEST_PROJECT_MODEL_SLUG, name: "Project default" },
          { slug: TEST_DIALOG_MODEL_SLUG, name: "Dialog pick" },
        ],
      }),
    ),
  );

interface Harness {
  readonly workspaceRoot: string;
  readonly boardFilePath: string;
  readonly engine: EngineStub;
  readonly threads: Array<OrchestrationThreadShell>;
  readonly requirement: RequirementStub;
  readonly run: <A, E>(effect: Effect.Effect<A, E, KanbanService>) => Promise<A>;
  readonly dispose: () => Promise<void>;
}

const makeHarness = async (options?: {
  readonly failDispatch?: boolean;
  /** Mutable: tests append the thread a dispatch actually created. */
  readonly threads?: Array<OrchestrationThreadShell>;
  readonly defaultModelSelection?: OrchestrationProjectShell["defaultModelSelection"];
  readonly requirement?: RequirementStub;
}): Promise<Harness> => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "peakcode-kanban-"));
  const boardFilePath = join(workspaceRoot, ".kanban", "board.json");
  const engine: EngineStub = {
    dispatches: [],
    failDispatch: options?.failDispatch ?? false,
  };
  const threads: Array<OrchestrationThreadShell> = [...(options?.threads ?? [])];
  const requirement: RequirementStub = options?.requirement ?? {
    calls: [],
    requirement:
      "## 背景与目标\n- 让看板任务能一键生成需求。\n\n## 需求要点\n- 根据标题生成需求与验收标准\n\n## 验收标准\n- [ ] 生成的内容包含验收标准",
  };
  const layer = makeTestLayer(
    [projectShell(workspaceRoot, options?.defaultModelSelection ?? null)],
    {
      engine,
      threads,
      requirement,
    },
  );
  return {
    workspaceRoot,
    boardFilePath,
    engine,
    threads,
    requirement,
    run: <A, E>(effect: Effect.Effect<A, E, KanbanService>) =>
      Effect.runPromise(effect.pipe(Effect.provide(layer))),
    dispose: () => rm(workspaceRoot, { recursive: true, force: true }),
  };
};

const threadShell = (threadId: ThreadId): OrchestrationThreadShell =>
  ({
    id: threadId,
    projectId: PROJECT_ID,
    title: "看板任务",
    modelSelection: { provider: "pi", model: "pi/default" },
    runtimeMode: "approval-required",
    interactionMode: "default",
    envMode: "local",
    branch: null,
    worktreePath: null,
  }) as OrchestrationThreadShell;

describe("KanbanService", () => {
  it("reads an empty board without creating the board file", async () => {
    const harness = await makeHarness();
    try {
      const board = await harness.run(
        Effect.gen(function* () {
          const kanban = yield* KanbanService;
          return yield* kanban.getBoard({ projectId: PROJECT_ID });
        }),
      );

      expect(board.tasks).toEqual([]);
      expect(board.columns.map((column) => column.key)).toEqual([
        "todo",
        "in_progress",
        "done",
        "blocked",
        "archived",
      ]);
      expect(board.projectId).toBe(PROJECT_ID);
      expect(board.boardFilePath).toBe(harness.boardFilePath);
      await expect(readFile(harness.boardFilePath, "utf8")).rejects.toThrow();
    } finally {
      await harness.dispose();
    }
  });

  it("writes plugin-compatible task JSON and reports counts per project", async () => {
    const harness = await makeHarness();
    try {
      const created = await harness.run(
        Effect.gen(function* () {
          const kanban = yield* KanbanService;
          return yield* kanban.createTask({
            projectId: PROJECT_ID,
            title: "  集成看板  ",
            description: "  支持在任务里记录需求描述\n供智能体按需求执行  ",
            status: "in_progress",
            priority: "high",
            pipeline: " 全栈开发流水线 ",
            assignee: "全栈开发",
          });
        }),
      );

      expect(created.tasks).toHaveLength(1);
      expect(created.tasks[0]?.title).toBe("集成看板");
      expect(created.tasks[0]?.description).toBe("支持在任务里记录需求描述\n供智能体按需求执行");
      expect(created.tasks[0]?.taskId).toMatch(/^t_[0-9a-f]{10}$/);

      const raw = await readFile(harness.boardFilePath, "utf8");
      expect(raw.endsWith("\n")).toBe(true);
      const parsed = JSON.parse(raw) as {
        version: number;
        name: string;
        columns: ReadonlyArray<{ key: string; name: string; dot: string }>;
        tasks: ReadonlyArray<Record<string, unknown>>;
        updatedAt: string;
      };
      expect(parsed.version).toBe(1);
      expect(parsed.name).toBe("Peak Code 看板");
      expect(parsed.columns.map((column) => column.name)).toEqual([
        "待开始",
        "进行中",
        "已完成",
        "已阻塞",
        "归档",
      ]);
      expect(parsed.tasks[0]).toMatchObject({
        id: created.tasks[0]?.taskId,
        title: "集成看板",
        description: "支持在任务里记录需求描述\n供智能体按需求执行",
        status: "in_progress",
        priority: "high",
        pipeline: "全栈开发流水线",
        assignee: "全栈开发",
      });
      expect(parsed.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);

      const summary = await harness.run(
        Effect.gen(function* () {
          const kanban = yield* KanbanService;
          return yield* kanban.listProjects({});
        }),
      );
      expect(summary.projects).toHaveLength(1);
      expect(summary.projects[0]).toMatchObject({
        projectId: PROJECT_ID,
        hasBoard: true,
        taskCount: 1,
        inProgressCount: 1,
        doneCount: 0,
      });
    } finally {
      await harness.dispose();
    }
  });

  it("stores requirement images beside the board and keeps base64 out of board.json", async () => {
    const harness = await makeHarness();
    try {
      // 1x1 transparent PNG.
      const dataUrl =
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
      const created = await harness.run(
        Effect.gen(function* () {
          const kanban = yield* KanbanService;
          return yield* kanban.createTask({
            projectId: PROJECT_ID,
            title: "带图任务",
            description: "按图实现",
            attachments: [{ name: "shot.png", mimeType: "image/png", sizeBytes: 70, dataUrl }],
            status: "todo",
            priority: "medium",
            pipeline: "",
            assignee: "",
          });
        }),
      );

      const attachment = created.tasks[0]?.attachments[0];
      expect(attachment).toMatchObject({ name: "shot.png", mimeType: "image/png" });
      expect(attachment?.relativePath).toMatch(/^\.kanban\/attachments\/[0-9a-f-]+\.png$/);
      expect(attachment?.sizeBytes).toBeGreaterThan(0);

      const storedFiles = await readdir(join(harness.workspaceRoot, ".kanban", "attachments"));
      expect(storedFiles).toHaveLength(1);

      const raw = await readFile(harness.boardFilePath, "utf8");
      expect(raw).toContain(attachment!.relativePath);
      // The bytes stay on disk; the board document only carries the descriptor.
      expect(raw).not.toContain("data:image/png;base64");

      const detail = await harness.run(
        Effect.gen(function* () {
          const kanban = yield* KanbanService;
          return yield* kanban.getTaskDetail({
            projectId: PROJECT_ID,
            taskId: KanbanTaskId.makeUnsafe(created.tasks[0]!.taskId),
          });
        }),
      );
      expect(detail.workspaceRoot).toBe(harness.workspaceRoot);
      expect(detail.task.attachments).toHaveLength(1);
    } finally {
      await harness.dispose();
    }
  });

  it("moves, updates and deletes tasks while preserving unknown board keys", async () => {
    const harness = await makeHarness();
    try {
      await mkdir(join(harness.workspaceRoot, ".kanban"), { recursive: true });
      await writeFile(
        harness.boardFilePath,
        JSON.stringify({
          version: 1,
          name: "Board 看板",
          projectId: "p_2cbeb743bb",
          customTopLevel: "keep-me",
          tasks: [
            { id: "t_aaa", title: "A", status: "todo", unknownTaskKey: 7 },
            { id: "t_bbb", title: "B", status: "todo" },
            { id: "t_ccc", title: "C", status: "done" },
          ],
        }),
        "utf8",
      );

      const afterMove = await harness.run(
        Effect.gen(function* () {
          const kanban = yield* KanbanService;
          return yield* kanban.moveTask({
            projectId: PROJECT_ID,
            taskId: KanbanTaskId.makeUnsafe("t_aaa"),
            status: "in_progress",
            order: 0,
          });
        }),
      );
      expect(afterMove.tasks.map((task) => [task.taskId, task.status])).toEqual([
        ["t_bbb", "todo"],
        ["t_aaa", "in_progress"],
        ["t_ccc", "done"],
      ]);

      const afterUpdate = await harness.run(
        Effect.gen(function* () {
          const kanban = yield* KanbanService;
          return yield* kanban.updateTask({
            projectId: PROJECT_ID,
            taskId: KanbanTaskId.makeUnsafe("t_bbb"),
            title: "B2",
            description: "  B2 的需求描述  ",
            priority: "low",
          });
        }),
      );
      expect(afterUpdate.tasks.find((task) => task.taskId === "t_bbb")).toMatchObject({
        title: "B2",
        description: "B2 的需求描述",
        priority: "low",
        status: "todo",
      });
      // Tasks that never carried a description still read back as empty strings.
      expect(afterUpdate.tasks.find((task) => task.taskId === "t_aaa")?.description).toBe("");

      const afterDelete = await harness.run(
        Effect.gen(function* () {
          const kanban = yield* KanbanService;
          return yield* kanban.deleteTask({
            projectId: PROJECT_ID,
            taskId: KanbanTaskId.makeUnsafe("t_ccc"),
          });
        }),
      );
      expect(afterDelete.tasks.map((task) => task.taskId)).toEqual(["t_bbb", "t_aaa"]);

      const parsed = JSON.parse(await readFile(harness.boardFilePath, "utf8")) as {
        customTopLevel: string;
        projectId: string;
        name: string;
        tasks: ReadonlyArray<Record<string, unknown>>;
      };
      expect(parsed.customTopLevel).toBe("keep-me");
      expect(parsed.projectId).toBe("p_2cbeb743bb");
      expect(parsed.name).toBe("Board 看板");
      expect(parsed.tasks.find((task) => task.id === "t_aaa")?.unknownTaskKey).toBe(7);
    } finally {
      await harness.dispose();
    }
  });

  it("reports unknown projects and unreadable boards as errors", async () => {
    const harness = await makeHarness();
    try {
      const unknownProject = await harness.run(
        Effect.gen(function* () {
          const kanban = yield* KanbanService;
          return yield* Effect.result(kanban.getBoard({ projectId: ProjectId.makeUnsafe("nope") }));
        }),
      );
      expect(unknownProject._tag).toBe("Failure");

      await mkdir(join(harness.workspaceRoot, ".kanban"), { recursive: true });
      await writeFile(harness.boardFilePath, "{ not json", "utf8");

      const brokenBoard = await harness.run(
        Effect.gen(function* () {
          const kanban = yield* KanbanService;
          return yield* Effect.result(kanban.getBoard({ projectId: PROJECT_ID }));
        }),
      );
      expect(brokenBoard._tag).toBe("Failure");
      if (brokenBoard._tag === "Failure") {
        expect(brokenBoard.failure.message).toContain("Failed to parse");
      }

      // The project scan tolerates an unreadable board so the picker still lists it.
      const summary = await harness.run(
        Effect.gen(function* () {
          const kanban = yield* KanbanService;
          return yield* kanban.listProjects({});
        }),
      );
      expect(summary.projects[0]).toMatchObject({ hasBoard: true, taskCount: 0 });
    } finally {
      await harness.dispose();
    }
  });
});

/** The first task id on a board, for readability in the dispatch tests. */
const boardTaskId = (board: {
  readonly tasks: ReadonlyArray<{ readonly taskId: string }>;
}): KanbanTaskId => board.tasks[0]!.taskId as KanbanTaskId;

describe("kanban task dispatch", () => {
  it("hands a task that lands in 进行中 to an agent with its requirement", async () => {
    const harness = await makeHarness();
    try {
      await harness.run(
        Effect.gen(function* () {
          const kanban = yield* KanbanService;
          yield* kanban.createTask({
            projectId: PROJECT_ID,
            title: "集成看板",
            description: "拖到进行中就开始执行",
            status: "todo",
            priority: "high",
            pipeline: "",
            assignee: "",
          });
        }),
      );
      expect(harness.engine.dispatches).toHaveLength(0);

      const board = await harness.run(
        Effect.gen(function* () {
          const kanban = yield* KanbanService;
          const created = yield* kanban.getBoard({ projectId: PROJECT_ID });
          return yield* kanban.moveTask({
            projectId: PROJECT_ID,
            taskId: boardTaskId(created),
            status: "in_progress",
            order: 0,
          });
        }),
      );

      const task = board.tasks[0]!;
      expect(task.status).toBe("in_progress");
      expect(task.agentRunStatus).toBe("running");
      expect(task.agentThreadId).not.toBeNull();

      expect(harness.engine.dispatches.map((command) => command.type)).toEqual([
        "thread.create",
        "thread.turn.start",
      ]);
      const create = harness.engine.dispatches[0]!;
      const turnStart = harness.engine.dispatches[1]!;
      if (create.type !== "thread.create" || turnStart.type !== "thread.turn.start") {
        throw new Error("expected thread.create followed by thread.turn.start");
      }
      expect(create.threadId).toBe(task.agentThreadId);
      expect(create.projectId).toBe(PROJECT_ID);
      expect(create.title).toBe("集成看板");
      expect(turnStart.threadId).toBe(task.agentThreadId);
      // The brief, then where the card lives, then the board's standing
      // instructions (which is what makes the run report each step back). The
      // board block is how a run finds the card's own history.
      const prompt = turnStart.message.text;
      expect(prompt.startsWith("集成看板\n\n拖到进行中就开始执行\n\n")).toBe(true);
      expect(prompt).toContain(`卡片：\`${task.taskId}\``);
      expect(prompt).toContain(".kanban/board.json");
      expect(prompt.endsWith(BOARD_RUN_INSTRUCTIONS)).toBe(true);

      // The claim is persisted, so a board reload still knows about the run.
      const reloaded = await harness.run(
        Effect.gen(function* () {
          const kanban = yield* KanbanService;
          return yield* kanban.getBoard({ projectId: PROJECT_ID });
        }),
      );
      expect(reloaded.tasks[0]?.agentThreadId).toBe(task.agentThreadId);
      expect(reloaded.tasks[0]?.agentRunStatus).toBe("running");
    } finally {
      await harness.dispose();
    }
  });

  it("does not dispatch again while a run is in flight", async () => {
    const harness = await makeHarness();
    try {
      const moved = await harness.run(
        Effect.gen(function* () {
          const kanban = yield* KanbanService;
          yield* kanban.createTask({
            projectId: PROJECT_ID,
            title: "只跑一次",
            description: "",
            status: "in_progress",
            priority: "medium",
            pipeline: "",
            assignee: "",
          });
          const board = yield* kanban.getBoard({ projectId: PROJECT_ID });
          // Reordering inside the column and re-saving the same status must not
          // start a second agent run.
          const reordered = yield* kanban.moveTask({
            projectId: PROJECT_ID,
            taskId: boardTaskId(board),
            status: "in_progress",
            order: 0,
          });
          return yield* kanban.updateTask({
            projectId: PROJECT_ID,
            taskId: boardTaskId(reordered),
            title: "只跑一次（改标题）",
            status: "in_progress",
          });
        }),
      );

      expect(harness.engine.dispatches).toHaveLength(2);
      expect(moved.tasks[0]?.agentRunStatus).toBe("running");
    } finally {
      await harness.dispose();
    }
  });

  it("rolls the task back to its previous column when the agent cannot start", async () => {
    const harness = await makeHarness({ failDispatch: true });
    try {
      const result = await harness.run(
        Effect.gen(function* () {
          const kanban = yield* KanbanService;
          yield* kanban.createTask({
            projectId: PROJECT_ID,
            title: "起不来的任务",
            description: "",
            status: "todo",
            priority: "medium",
            pipeline: "",
            assignee: "",
          });
          const board = yield* kanban.getBoard({ projectId: PROJECT_ID });
          const moved = yield* Effect.result(
            kanban.moveTask({
              projectId: PROJECT_ID,
              taskId: boardTaskId(board),
              status: "in_progress",
              order: 0,
            }),
          );
          const afterFailure = yield* kanban.getBoard({ projectId: PROJECT_ID });
          return { moved, afterFailure };
        }),
      );

      expect(result.moved._tag).toBe("Failure");
      if (result.moved._tag === "Failure") {
        expect(result.moved.failure.message).toContain("Failed to dispatch task");
      }
      expect(result.afterFailure.tasks[0]).toMatchObject({
        status: "todo",
        agentThreadId: null,
        agentRunStatus: null,
      });
    } finally {
      await harness.dispose();
    }
  });
});

describe("kanban run write-back", () => {
  const seedRunningTask = async (harness: Harness, threadId: ThreadId) => {
    await mkdir(join(harness.workspaceRoot, ".kanban"), { recursive: true });
    await writeFile(
      harness.boardFilePath,
      JSON.stringify({
        version: 1,
        name: "Peak Code 看板",
        projectId: PROJECT_ID,
        tasks: [
          {
            id: "t_run",
            title: "跑着的任务",
            status: "in_progress",
            agentThreadId: threadId,
            agentRunStatus: "running",
          },
          { id: "t_other", title: "别的任务", status: "todo" },
        ],
      }),
      "utf8",
    );
  };

  it("moves a finished run to 已完成, a failed one to 已阻塞 and an interrupted one back to 待开始", async () => {
    for (const [runStatus, expected] of [
      ["done", "done"],
      ["failed", "blocked"],
      ["interrupted", "todo"],
    ] as const) {
      const threadId = ThreadId.makeUnsafe(`thread_${runStatus}`);
      const harness = await makeHarness({ threads: [threadShell(threadId)] });
      try {
        await seedRunningTask(harness, threadId);
        await harness.run(
          Effect.gen(function* () {
            const kanban = yield* KanbanService;
            return yield* kanban.recordTaskRunOutcome({ threadId, runStatus });
          }),
        );

        const board = await harness.run(
          Effect.gen(function* () {
            const kanban = yield* KanbanService;
            return yield* kanban.getBoard({ projectId: PROJECT_ID });
          }),
        );
        expect(board.tasks.find((task) => task.taskId === "t_run")).toMatchObject({
          status: expected,
          agentRunStatus: runStatus,
          agentThreadId: threadId,
        });
        // Untouched tasks stay where they were.
        expect(board.tasks.find((task) => task.taskId === "t_other")?.status).toBe("todo");
      } finally {
        await harness.dispose();
      }
    }
  });

  it("ignores outcomes for threads the board no longer tracks as running", async () => {
    const threadId = ThreadId.makeUnsafe("thread_stale");
    const harness = await makeHarness({ threads: [threadShell(threadId)] });
    try {
      await seedRunningTask(harness, threadId);
      await harness.run(
        Effect.gen(function* () {
          const kanban = yield* KanbanService;
          yield* kanban.recordTaskRunOutcome({ threadId, runStatus: "done" });
          // The second outcome for the same thread must not touch the board again.
          return yield* kanban.recordTaskRunOutcome({ threadId, runStatus: "failed" });
        }),
      );

      const board = await harness.run(
        Effect.gen(function* () {
          const kanban = yield* KanbanService;
          return yield* kanban.getBoard({ projectId: PROJECT_ID });
        }),
      );
      expect(board.tasks.find((task) => task.taskId === "t_run")?.status).toBe("done");
    } finally {
      await harness.dispose();
    }
  });

  it("ignores outcomes for unknown threads", async () => {
    const harness = await makeHarness();
    try {
      await seedRunningTask(harness, ThreadId.makeUnsafe("thread_missing"));
      await harness.run(
        Effect.gen(function* () {
          const kanban = yield* KanbanService;
          return yield* kanban.recordTaskRunOutcome({
            threadId: ThreadId.makeUnsafe("thread_unknown"),
            runStatus: "done",
          });
        }),
      );

      const board = await harness.run(
        Effect.gen(function* () {
          const kanban = yield* KanbanService;
          return yield* kanban.getBoard({ projectId: PROJECT_ID });
        }),
      );
      expect(board.tasks.find((task) => task.taskId === "t_run")?.status).toBe("in_progress");
    } finally {
      await harness.dispose();
    }
  });
});

describe("kanban run progress comments", () => {
  const seedRunningTask = async (harness: Harness, threadId: ThreadId) => {
    await mkdir(join(harness.workspaceRoot, ".kanban"), { recursive: true });
    await writeFile(
      harness.boardFilePath,
      JSON.stringify({
        version: 1,
        name: "Peak Code 看板",
        projectId: PROJECT_ID,
        tasks: [
          {
            id: "t_run",
            title: "跑着的任务",
            status: "in_progress",
            agentThreadId: threadId,
            agentRunStatus: "running",
          },
          { id: "t_other", title: "别的任务", status: "todo" },
        ],
      }),
      "utf8",
    );
  };

  const detailOf = (harness: Harness, taskId: string) =>
    harness.run(
      Effect.gen(function* () {
        const kanban = yield* KanbanService;
        return yield* kanban.getTaskDetail({
          projectId: PROJECT_ID,
          taskId: KanbanTaskId.makeUnsafe(taskId),
        });
      }),
    );

  it("appends the note to the running task and reports that it landed", async () => {
    const threadId = ThreadId.makeUnsafe("thread_progress");
    const harness = await makeHarness({ threads: [threadShell(threadId)] });
    try {
      await seedRunningTask(harness, threadId);
      const written = await harness.run(
        Effect.gen(function* () {
          const kanban = yield* KanbanService;
          return yield* kanban.recordTaskRunComment({
            threadId,
            body: "  实现完成：改了 boardDocument.ts，bun run test 全绿  ",
          });
        }),
      );
      expect(written).toBe(true);

      const detail = await detailOf(harness, "t_run");
      const comments = detail.task.comments;
      expect(comments).toHaveLength(1);
      expect(comments[0]).toMatchObject({
        author: "agent",
        kind: "note",
        // Trimmed on the way in: the board keeps the text, not the model's padding.
        body: "实现完成：改了 boardDocument.ts，bun run test 全绿",
      });

      // The other card is untouched.
      const other = await detailOf(harness, "t_other");
      expect(other.task.comments).toHaveLength(0);
    } finally {
      await harness.dispose();
    }
  });

  it("keeps step comments in order, so the card reads as a timeline", async () => {
    const threadId = ThreadId.makeUnsafe("thread_timeline");
    const harness = await makeHarness({ threads: [threadShell(threadId)] });
    try {
      await seedRunningTask(harness, threadId);
      await harness.run(
        Effect.gen(function* () {
          const kanban = yield* KanbanService;
          yield* kanban.recordTaskRunComment({ threadId, body: "界定：按最小假设定了范围" });
          yield* kanban.recordTaskRunComment({ threadId, body: "验证：bun run test 通过" });
          return yield* kanban.recordTaskRunComment({ threadId, body: "收尾：无遗留问题" });
        }),
      );

      const detail = await detailOf(harness, "t_run");
      expect(detail.task.comments.map((comment) => comment.body)).toEqual([
        "界定：按最小假设定了范围",
        "验证：bun run test 通过",
        "收尾：无遗留问题",
      ]);
    } finally {
      await harness.dispose();
    }
  });

  it("writes nothing when the thread is not a running board task", async () => {
    const harness = await makeHarness({
      threads: [threadShell(ThreadId.makeUnsafe("thread_plain"))],
    });
    try {
      // A task exists, but it belongs to another thread: a plain conversation must not be
      // able to attach itself to a card.
      await seedRunningTask(harness, ThreadId.makeUnsafe("thread_someone_else"));
      const written = await harness.run(
        Effect.gen(function* () {
          const kanban = yield* KanbanService;
          return yield* kanban.recordTaskRunComment({
            threadId: ThreadId.makeUnsafe("thread_plain"),
            body: "顺便留一句",
          });
        }),
      );
      expect(written).toBe(false);

      const detail = await detailOf(harness, "t_run");
      expect(detail.task.comments).toHaveLength(0);
    } finally {
      await harness.dispose();
    }
  });

  it("refuses an empty body instead of quietly recording nothing", async () => {
    const threadId = ThreadId.makeUnsafe("thread_empty");
    const harness = await makeHarness({ threads: [threadShell(threadId)] });
    try {
      await seedRunningTask(harness, threadId);
      const failure = await harness
        .run(
          Effect.gen(function* () {
            const kanban = yield* KanbanService;
            return yield* kanban.recordTaskRunComment({ threadId, body: "   " });
          }),
        )
        .then(() => null)
        .catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(Error);

      const detail = await detailOf(harness, "t_run");
      expect(detail.task.comments).toHaveLength(0);
    } finally {
      await harness.dispose();
    }
  });

  it("fails for a thread the projection does not know", async () => {
    const harness = await makeHarness();
    try {
      await seedRunningTask(harness, ThreadId.makeUnsafe("thread_missing"));
      const failure = await harness
        .run(
          Effect.gen(function* () {
            const kanban = yield* KanbanService;
            return yield* kanban.recordTaskRunComment({
              threadId: ThreadId.makeUnsafe("thread_unknown"),
              body: "内容",
            });
          }),
        )
        .then(() => null)
        .catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(Error);
    } finally {
      await harness.dispose();
    }
  });
});

describe("kanban agent and model selection", () => {
  it("runs a task with the model it names", async () => {
    const harness = await makeHarness();
    try {
      await harness.run(
        Effect.gen(function* () {
          const kanban = yield* KanbanService;
          return yield* kanban.createTask({
            projectId: PROJECT_ID,
            title: "指定模型",
            description: "",
            status: "in_progress",
            priority: "medium",
            pipeline: "",
            assignee: "",
            agentProvider: "pi",
            agentModel: "deepseek/v4",
          });
        }),
      );

      const create = harness.engine.dispatches[0]!;
      const turnStart = harness.engine.dispatches[1]!;
      expect(create.type === "thread.create" && create.modelSelection).toEqual({
        provider: "pi",
        model: "deepseek/v4",
      });
      expect(turnStart.type === "thread.turn.start" && turnStart.modelSelection).toEqual({
        provider: "pi",
        model: "deepseek/v4",
      });
    } finally {
      await harness.dispose();
    }
  });

  it("falls back to the project's default model when the task names none", async () => {
    const harness = await makeHarness({
      defaultModelSelection: { provider: "pi", model: TEST_PROJECT_MODEL_SLUG },
    });
    try {
      await harness.run(
        Effect.gen(function* () {
          const kanban = yield* KanbanService;
          return yield* kanban.createTask({
            projectId: PROJECT_ID,
            title: "跟随默认",
            description: "",
            status: "in_progress",
            priority: "medium",
            pipeline: "",
            assignee: "",
          });
        }),
      );

      const create = harness.engine.dispatches[0]!;
      expect(create.type === "thread.create" && create.modelSelection).toEqual({
        provider: "pi",
        model: TEST_PROJECT_MODEL_SLUG,
      });
    } finally {
      await harness.dispose();
    }
  });

  it("keeps the selection when the task is edited", async () => {
    const harness = await makeHarness();
    try {
      const board = await harness.run(
        Effect.gen(function* () {
          const kanban = yield* KanbanService;
          yield* kanban.createTask({
            projectId: PROJECT_ID,
            title: "改模型",
            description: "",
            status: "todo",
            priority: "medium",
            pipeline: "",
            assignee: "",
          });
          const current = yield* kanban.getBoard({ projectId: PROJECT_ID });
          return yield* kanban.updateTask({
            projectId: PROJECT_ID,
            taskId: boardTaskId(current),
            agentProvider: "pi",
            agentModel: " deepseek/v4-flash ",
          });
        }),
      );

      expect(board.tasks[0]).toMatchObject({
        agentProvider: "pi",
        agentModel: "deepseek/v4-flash",
      });
      expect(harness.engine.dispatches).toHaveLength(0);
    } finally {
      await harness.dispose();
    }
  });
});

describe("kanban task comments", () => {
  it("records that the agent took the task and how the run ended", async () => {
    const threadId = ThreadId.makeUnsafe("thread_comments");
    const harness = await makeHarness({ threads: [threadShell(threadId)] });
    try {
      const afterMove = await harness.run(
        Effect.gen(function* () {
          const kanban = yield* KanbanService;
          yield* kanban.createTask({
            projectId: PROJECT_ID,
            title: "留言跟踪",
            description: "每一步都要留痕",
            status: "todo",
            priority: "medium",
            pipeline: "",
            assignee: "",
          });
          const created = yield* kanban.getBoard({ projectId: PROJECT_ID });
          const moved = yield* kanban.moveTask({
            projectId: PROJECT_ID,
            taskId: boardTaskId(created),
            status: "in_progress",
            order: 0,
          });
          return moved;
        }),
      );

      expect(afterMove.tasks[0]?.comments.map((comment) => comment.statusCode)).toEqual([
        "started",
      ]);
      expect(afterMove.tasks[0]?.comments[0]?.author).toBe("agent");

      // Finish the run against the thread the board recorded.
      const runThreadId = afterMove.tasks[0]!.agentThreadId!;
      harness.threads.push(threadShell(ThreadId.makeUnsafe(runThreadId)));
      const settled = await harness.run(
        Effect.gen(function* () {
          const kanban = yield* KanbanService;
          yield* kanban.recordTaskRunOutcome({ threadId: runThreadId, runStatus: "done" });
          return yield* kanban.getBoard({ projectId: PROJECT_ID });
        }),
      );
      expect(settled.tasks[0]?.status).toBe("done");
      expect(settled.tasks[0]?.comments.map((comment) => comment.statusCode)).toEqual([
        "started",
        "done",
      ]);
    } finally {
      await harness.dispose();
    }
  });

  it("keeps a human comment on the task and shows it in the detail stream", async () => {
    const harness = await makeHarness();
    try {
      const detail = await harness.run(
        Effect.gen(function* () {
          const kanban = yield* KanbanService;
          yield* kanban.createTask({
            projectId: PROJECT_ID,
            title: "人类留言",
            description: "",
            status: "todo",
            priority: "medium",
            pipeline: "",
            assignee: "",
          });
          const board = yield* kanban.getBoard({ projectId: PROJECT_ID });
          return yield* kanban.addTaskComment({
            projectId: PROJECT_ID,
            taskId: boardTaskId(board),
            body: "这个先别动，等我确认",
          });
        }),
      );

      expect(detail.comments).toHaveLength(1);
      expect(detail.comments[0]).toMatchObject({
        author: "user",
        kind: "note",
        body: "这个先别动，等我确认",
      });
      expect(detail.projectTitle).toBe("Peak Code");
      expect(detail.task.comments).toHaveLength(1);
    } finally {
      await harness.dispose();
    }
  });

  it("steers a running task with the comment and interrupts it on request", async () => {
    const harness = await makeHarness();
    try {
      const result = await harness.run(
        Effect.gen(function* () {
          const kanban = yield* KanbanService;
          yield* kanban.createTask({
            projectId: PROJECT_ID,
            title: "插入留言",
            description: "",
            status: "in_progress",
            priority: "medium",
            pipeline: "",
            assignee: "",
          });
          const board = yield* kanban.getBoard({ projectId: PROJECT_ID });
          const taskId = boardTaskId(board);
          const steered = yield* kanban.addTaskComment({
            projectId: PROJECT_ID,
            taskId,
            body: "先只改服务端",
            action: "steer",
          });
          const interrupted = yield* kanban.addTaskComment({
            projectId: PROJECT_ID,
            taskId,
            body: "停下",
            action: "interrupt",
          });
          return { steered, interrupted };
        }),
      );

      const commands = harness.engine.dispatches;
      // thread.create + the first turn, then the steer injection and the interrupt.
      expect(commands.map((command) => command.type)).toEqual([
        "thread.create",
        "thread.turn.start",
        "thread.turn.start",
        "thread.turn.interrupt",
      ]);
      const steerCommand = commands[2]!;
      expect(steerCommand.type === "thread.turn.start" && steerCommand.dispatchMode).toBe("steer");
      expect(steerCommand.type === "thread.turn.start" && steerCommand.message.text).toBe(
        "先只改服务端",
      );
      expect(result.steered.comments.map((comment) => comment.statusCode)).toContain("steered");
      expect(result.interrupted.comments.filter((comment) => comment.kind === "note")).toHaveLength(
        2,
      );
    } finally {
      await harness.dispose();
    }
  });

  it("records a comment without touching the run when the task is idle", async () => {
    const harness = await makeHarness();
    try {
      await harness.run(
        Effect.gen(function* () {
          const kanban = yield* KanbanService;
          yield* kanban.createTask({
            projectId: PROJECT_ID,
            title: "空闲任务",
            description: "",
            status: "todo",
            priority: "medium",
            pipeline: "",
            assignee: "",
          });
          const board = yield* kanban.getBoard({ projectId: PROJECT_ID });
          return yield* kanban.addTaskComment({
            projectId: PROJECT_ID,
            taskId: boardTaskId(board),
            body: "先记一笔",
            action: "steer",
          });
        }),
      );

      expect(harness.engine.dispatches).toHaveLength(0);
    } finally {
      await harness.dispose();
    }
  });
});

describe("kanban comment guardrails", () => {
  it("interrupts without a comment body but refuses an empty steer", async () => {
    const harness = await makeHarness();
    try {
      const result = await harness.run(
        Effect.gen(function* () {
          const kanban = yield* KanbanService;
          yield* kanban.createTask({
            projectId: PROJECT_ID,
            title: "空留言",
            description: "",
            status: "in_progress",
            priority: "medium",
            pipeline: "",
            assignee: "",
          });
          const board = yield* kanban.getBoard({ projectId: PROJECT_ID });
          const taskId = boardTaskId(board);
          const interrupted = yield* kanban.addTaskComment({
            projectId: PROJECT_ID,
            taskId,
            body: "   ",
            action: "interrupt",
          });
          const emptySteer = yield* Effect.result(
            kanban.addTaskComment({
              projectId: PROJECT_ID,
              taskId,
              body: "  ",
              action: "steer",
            }),
          );
          return { interrupted, emptySteer };
        }),
      );

      // Interrupting needs no words; it still reaches the thread.
      expect(harness.engine.dispatches.map((command) => command.type)).toEqual([
        "thread.create",
        "thread.turn.start",
        "thread.turn.interrupt",
      ]);
      expect(result.interrupted.comments.filter((comment) => comment.kind === "note")).toHaveLength(
        0,
      );
      expect(result.emptySteer._tag).toBe("Failure");
    } finally {
      await harness.dispose();
    }
  });
});

describe("kanban requirement generation", () => {
  it("writes the generated brief onto the task and hands the agent the title and notes", async () => {
    const harness = await makeHarness();
    try {
      const detail = await harness.run(
        Effect.gen(function* () {
          const kanban = yield* KanbanService;
          yield* kanban.createTask({
            projectId: PROJECT_ID,
            title: "支持一键生成需求",
            description: "补充一些背景",
            status: "todo",
            priority: "medium",
            pipeline: "",
            assignee: "",
          });
          const board = yield* kanban.getBoard({ projectId: PROJECT_ID });
          return yield* kanban.generateTaskRequirement({
            projectId: PROJECT_ID,
            taskId: boardTaskId(board),
          });
        }),
      );

      expect(detail.task.description).toContain("## 验收标准");
      expect(detail.task.description).toContain("- [ ]");
      expect(harness.requirement.calls).toEqual([
        expect.objectContaining({
          cwd: harness.workspaceRoot,
          title: "支持一键生成需求",
          notes: "补充一些背景",
        }),
      ]);

      // The brief is persisted, so the board and the agent see the same text.
      const persisted = await harness.run(
        Effect.gen(function* () {
          const kanban = yield* KanbanService;
          return yield* kanban.getBoard({ projectId: PROJECT_ID });
        }),
      );
      expect(persisted.tasks[0]?.description).toBe(detail.task.description);
    } finally {
      await harness.dispose();
    }
  });

  it("omits empty notes and reports an unknown task", async () => {
    const harness = await makeHarness();
    try {
      const result = await harness.run(
        Effect.gen(function* () {
          const kanban = yield* KanbanService;
          yield* kanban.createTask({
            projectId: PROJECT_ID,
            title: "只有标题",
            description: "",
            status: "todo",
            priority: "medium",
            pipeline: "",
            assignee: "",
          });
          const board = yield* kanban.getBoard({ projectId: PROJECT_ID });
          yield* kanban.generateTaskRequirement({
            projectId: PROJECT_ID,
            taskId: boardTaskId(board),
          });
          return yield* Effect.result(
            kanban.generateTaskRequirement({
              projectId: PROJECT_ID,
              taskId: KanbanTaskId.makeUnsafe("t_missing"),
            }),
          );
        }),
      );

      expect(harness.requirement.calls[0]?.notes).toBeUndefined();
      expect(result._tag).toBe("Failure");
    } finally {
      await harness.dispose();
    }
  });
});

describe("kanban requirement drafts", () => {
  it("generates from the dialog's title and notes without writing a board", async () => {
    const harness = await makeHarness();
    try {
      const draft = await harness.run(
        Effect.gen(function* () {
          const kanban = yield* KanbanService;
          return yield* kanban.generateRequirementDraft({
            projectId: PROJECT_ID,
            title: "支持一键生成需求",
            notes: "先把需求生成出来，再创建任务",
          });
        }),
      );

      expect(draft.requirement).toContain("## 验收标准");
      expect(harness.requirement.calls).toEqual([
        expect.objectContaining({
          cwd: harness.workspaceRoot,
          title: "支持一键生成需求",
          notes: "先把需求生成出来，再创建任务",
          // Resolved from the provider rather than a constant slug.
          modelSelection: { provider: "pi", model: TEST_MODEL_SLUG },
        }),
      ]);
      // The task does not exist yet, so nothing may land on disk.
      await expect(readFile(harness.boardFilePath, "utf8")).rejects.toThrow();
    } finally {
      await harness.dispose();
    }
  });

  it("uses the model picked in the dialog, then the project default", async () => {
    const harness = await makeHarness({
      defaultModelSelection: { provider: "pi", model: TEST_PROJECT_MODEL_SLUG },
    });
    try {
      await harness.run(
        Effect.gen(function* () {
          const kanban = yield* KanbanService;
          yield* kanban.generateRequirementDraft({
            projectId: PROJECT_ID,
            title: "选中的模型",
            notes: "   ",
            agentProvider: "pi",
            agentModel: TEST_DIALOG_MODEL_SLUG,
          });
          yield* kanban.generateRequirementDraft({
            projectId: PROJECT_ID,
            title: "默认模型",
          });
        }),
      );

      expect(harness.requirement.calls[0]?.modelSelection).toEqual({
        provider: "pi",
        model: TEST_DIALOG_MODEL_SLUG,
      });
      expect(harness.requirement.calls[1]?.modelSelection).toEqual({
        provider: "pi",
        model: TEST_PROJECT_MODEL_SLUG,
      });
      // Blank notes would only steer the agent toward nothing.
      expect(harness.requirement.calls[0]?.notes).toBeUndefined();
    } finally {
      await harness.dispose();
    }
  });

  it("reports an unknown project", async () => {
    const harness = await makeHarness();
    try {
      const result = await harness.run(
        Effect.gen(function* () {
          const kanban = yield* KanbanService;
          return yield* Effect.result(
            kanban.generateRequirementDraft({
              projectId: ProjectId.makeUnsafe("project_missing"),
              title: "没有项目",
            }),
          );
        }),
      );

      expect(result._tag).toBe("Failure");
      expect(harness.requirement.calls).toHaveLength(0);
    } finally {
      await harness.dispose();
    }
  });
});

describe("stale run release", () => {
  const seedStaleRun = async (harness: Harness, threadId: ThreadId) => {
    await mkdir(join(harness.workspaceRoot, ".kanban"), { recursive: true });
    await writeFile(
      harness.boardFilePath,
      JSON.stringify({
        version: 1,
        name: "Peak Code 看板",
        projectId: PROJECT_ID,
        tasks: [
          {
            id: "t_stale",
            title: "被关掉的任务",
            status: "in_progress",
            agentThreadId: threadId,
            agentRunStatus: "running",
          },
          { id: "t_idle", title: "普通任务", status: "todo" },
        ],
      }),
      "utf8",
    );
  };

  const sessionThread = (
    threadId: ThreadId,
    status: "running" | "stopped",
  ): OrchestrationThreadShell => ({ ...threadShell(threadId), session: { status } }) as never;

  it("releases a task whose session is gone", async () => {
    const stoppedThread = ThreadId.makeUnsafe("thread_stopped");
    const harness = await makeHarness({ threads: [sessionThread(stoppedThread, "stopped")] });
    try {
      await seedStaleRun(harness, stoppedThread);
      await harness.run(
        Effect.gen(function* () {
          const kanban = yield* KanbanService;
          return yield* kanban.releaseStaleTaskRuns();
        }),
      );

      const board = await harness.run(
        Effect.gen(function* () {
          const kanban = yield* KanbanService;
          return yield* kanban.getBoard({ projectId: PROJECT_ID });
        }),
      );
      const task = board.tasks.find((entry) => entry.taskId === "t_stale")!;
      expect(task.status).toBe("todo");
      expect(task.agentRunStatus).toBe("interrupted");
      expect(task.comments.map((comment) => comment.statusCode)).toEqual(["interrupted"]);
      expect(board.tasks.find((entry) => entry.taskId === "t_idle")?.status).toBe("todo");
    } finally {
      await harness.dispose();
    }
  });

  it("leaves a genuinely running task alone", async () => {
    const liveThread = ThreadId.makeUnsafe("thread_live");
    const harness = await makeHarness({ threads: [sessionThread(liveThread, "running")] });
    try {
      await seedStaleRun(harness, liveThread);
      await harness.run(
        Effect.gen(function* () {
          const kanban = yield* KanbanService;
          return yield* kanban.releaseStaleTaskRuns();
        }),
      );

      const board = await harness.run(
        Effect.gen(function* () {
          const kanban = yield* KanbanService;
          return yield* kanban.getBoard({ projectId: PROJECT_ID });
        }),
      );
      expect(board.tasks.find((entry) => entry.taskId === "t_stale")).toMatchObject({
        status: "in_progress",
        agentRunStatus: "running",
      });
    } finally {
      await harness.dispose();
    }
  });
});

describe("kanban task read-back", () => {
  /** A card that ran, was written back to, and now sits in a terminal column. */
  const seedRecordedTask = async (harness: Harness, threadId: ThreadId) => {
    await mkdir(join(harness.workspaceRoot, ".kanban"), { recursive: true });
    await writeFile(
      harness.boardFilePath,
      JSON.stringify({
        version: 1,
        name: "Peak Code 看板",
        projectId: PROJECT_ID,
        tasks: [
          {
            id: "t_recorded",
            title: "接上多端同步",
            description: "先把离线队列做出来。",
            status: "in_progress",
            priority: "high",
            agentThreadId: threadId,
            agentRunStatus: "interrupted",
            comments: [
              {
                commentId: "c_1",
                author: "agent",
                kind: "note",
                body: "第一版只做了本地队列。",
                createdAt: "2026-09-16T05:00:00Z",
              },
              {
                commentId: "c_2",
                author: "user",
                kind: "note",
                body: "两台设备同时改会互相覆盖，先解决这个。",
                createdAt: "2026-09-17T01:00:00Z",
              },
            ],
          },
          { id: "t_other", title: "别的任务", status: "todo" },
        ],
      }),
      "utf8",
    );
  };

  const readBack = (harness: Harness, threadId: ThreadId) =>
    harness.run(
      Effect.gen(function* () {
        const kanban = yield* KanbanService;
        return yield* kanban.readTaskForThread({ threadId });
      }),
    );

  it("reads the card back with the requirement and the whole timeline", async () => {
    const threadId = ThreadId.makeUnsafe("thread_recorded");
    const harness = await makeHarness({ threads: [threadShell(threadId)] });
    try {
      await seedRecordedTask(harness, threadId);

      const record = await readBack(harness, threadId);

      expect(record?.task.title).toBe("接上多端同步");
      expect(record?.task.description).toBe("先把离线队列做出来。");
      expect(record?.context.boardFilePath).toBe(harness.boardFilePath);
      expect(record?.comments.map((comment) => comment.body)).toEqual([
        "第一版只做了本地队列。",
        "两台设备同时改会互相覆盖，先解决这个。",
      ]);
    } finally {
      await harness.dispose();
    }
  });

  it("still finds the card after the run that owned it ended", async () => {
    // The point of reading is the second attempt: the first one was interrupted,
    // and its notes are exactly what the next run needs. A "running" filter here
    // would hide the card from every run that could actually use it.
    const threadId = ThreadId.makeUnsafe("thread_recorded");
    const harness = await makeHarness({ threads: [threadShell(threadId)] });
    try {
      await seedRecordedTask(harness, threadId);

      const record = await readBack(harness, threadId);

      expect(record?.task.agentRunStatus).toBe("interrupted");
    } finally {
      await harness.dispose();
    }
  });

  it("reports nothing for a conversation that never came from a board", async () => {
    const harness = await makeHarness({
      threads: [threadShell(ThreadId.makeUnsafe("thread_plain"))],
    });
    try {
      await seedRecordedTask(harness, ThreadId.makeUnsafe("thread_recorded"));

      expect(await readBack(harness, ThreadId.makeUnsafe("thread_plain"))).toBeNull();
    } finally {
      await harness.dispose();
    }
  });

  it("leaves the board alone", async () => {
    const threadId = ThreadId.makeUnsafe("thread_recorded");
    const harness = await makeHarness({ threads: [threadShell(threadId)] });
    try {
      await seedRecordedTask(harness, threadId);
      const before = await readFile(harness.boardFilePath, "utf8");

      await readBack(harness, threadId);

      expect(await readFile(harness.boardFilePath, "utf8")).toBe(before);
    } finally {
      await harness.dispose();
    }
  });
});
