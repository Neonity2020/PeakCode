import { randomUUID } from "node:crypto";

import { Effect, Exit, FileSystem, Layer, Option, Path } from "effect";
import * as Semaphore from "effect/Semaphore";

import {
  CommandId,
  KANBAN_TASK_MAX_ATTACHMENT_BYTES,
  MessageId,
  ThreadId,
} from "@peakcode/contracts";
import type {
  KanbanAgentRunStatus,
  KanbanBoard,
  KanbanComment,
  KanbanCommentStatusCode,
  KanbanListProjectsInput,
  KanbanListProjectsResult,
  KanbanProjectSummary,
  KanbanTaskAttachment,
  KanbanTaskDetail,
  KanbanTaskStatus,
  KanbanUploadTaskAttachment,
  ModelSelection,
  OrchestrationProjectShell,
  ProjectId,
} from "@peakcode/contracts";

import { writeFileStringAtomically } from "../../atomicWrite.ts";
import { inferImageExtension, parseBase64DataUrl } from "../../imageMime.ts";
import { TextGeneration } from "../../git/Services/TextGeneration.ts";
import { makeHeadlessModelResolver } from "../../provider/resolveHeadlessModelSelection.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { WorkspaceEntries } from "../../workspace/Services/WorkspaceEntries.ts";
import { KanbanService, type KanbanServiceShape } from "../Services/KanbanService.ts";
import {
  appendStoredComment,
  buildTaskPrompt,
  countTasksByStatus,
  createStoredTask,
  findStoredTask,
  normalizeAgentProvider,
  normalizeBoardDocument,
  nowIso,
  reorderStoredTask,
  taskModelSelection,
  taskNeedsAgentRun,
  taskStatusForRunOutcome,
  toKanbanBoard,
  type KanbanBoardContext,
  type KanbanStoredBoard,
  type KanbanStoredTask,
  type KanbanThreadTaskRecord,
} from "../boardDocument.ts";

const BOARD_DIRECTORY_NAME = ".kanban";
const BOARD_FILE_NAME = "board.json";
/** Images a task's requirement carries; kept beside the board so they travel with the project. */
const ATTACHMENTS_DIRECTORY_NAME = "attachments";

const newCommandId = () => CommandId.makeUnsafe(`cmd_${randomUUID()}`);
const newThreadId = () => ThreadId.makeUnsafe(`thread_${randomUUID()}`);
const newMessageId = () => MessageId.makeUnsafe(`msg_${randomUUID()}`);

const MAX_THREAD_TITLE_LENGTH = 120;

const describeCause = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

/** Comment code recorded when a run finishes. */
const runStatusCodeFor = (
  runStatus: Exclude<KanbanAgentRunStatus, "running">,
): KanbanCommentStatusCode =>
  runStatus === "done" ? "done" : runStatus === "failed" ? "failed" : "interrupted";

/** A task that has been claimed for an agent run but not yet dispatched. */
interface PendingTaskRun {
  readonly taskId: string;
  readonly threadId: ThreadId;
  readonly threadTitle: string;
  /**
   * The requirement as it stood when the run was claimed. Kept as its parts
   * rather than a finished prompt because the board's path — which the prompt
   * names — is a property of the project, only known at dispatch.
   */
  readonly brief: {
    readonly title: string;
    readonly description: string;
    readonly attachments: ReadonlyArray<KanbanTaskAttachment>;
  };
  readonly previousStatus: KanbanTaskStatus;
  /** Explicit model for this task; null means "use the project default". */
  readonly modelSelection: ModelSelection | null;
}

const makeKanbanService = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const projectQuery = yield* ProjectionSnapshotQuery;
  const workspaceEntries = yield* WorkspaceEntries;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const textGeneration = yield* TextGeneration;
  const headlessModel = yield* makeHeadlessModelResolver;
  // Board writes are read-modify-write cycles; serialize them per process so
  // concurrent drags cannot drop each other's changes.
  const writeSemaphore = yield* Semaphore.make(1);

  const boardFilePathOf = (workspaceRoot: string) =>
    path.join(workspaceRoot, BOARD_DIRECTORY_NAME, BOARD_FILE_NAME);

  /**
   * Writes task requirement images beside the board and returns their
   * descriptors. Bytes live on disk (never in board.json) so the board stays a
   * small text document and both the UI and the agent can read the same file.
   */
  const storeTaskAttachments = (
    workspaceRoot: string,
    uploads: ReadonlyArray<KanbanUploadTaskAttachment>,
  ): Effect.Effect<Array<KanbanTaskAttachment>, Error> =>
    Effect.gen(function* () {
      if (uploads.length === 0) return [];

      const attachmentsRoot = path.join(
        workspaceRoot,
        BOARD_DIRECTORY_NAME,
        ATTACHMENTS_DIRECTORY_NAME,
      );
      yield* fs
        .makeDirectory(attachmentsRoot, { recursive: true })
        .pipe(
          Effect.mapError(
            (cause) => new Error(`Failed to create ${attachmentsRoot}: ${describeCause(cause)}`),
          ),
        );

      const stored: Array<KanbanTaskAttachment> = [];
      for (const upload of uploads) {
        const parsed = parseBase64DataUrl(upload.dataUrl);
        if (!parsed) {
          return yield* Effect.fail(new Error(`Attachment '${upload.name}' is not a valid image.`));
        }
        const bytes = Buffer.from(parsed.base64, "base64");
        if (bytes.byteLength > KANBAN_TASK_MAX_ATTACHMENT_BYTES) {
          return yield* Effect.fail(new Error(`Attachment '${upload.name}' is too large.`));
        }

        const attachmentId = randomUUID();
        const fileName = `${attachmentId}${inferImageExtension({
          mimeType: upload.mimeType,
          fileName: upload.name,
        })}`;
        yield* fs
          .writeFile(path.join(attachmentsRoot, fileName), bytes)
          .pipe(
            Effect.mapError(
              (cause) =>
                new Error(`Failed to write attachment '${upload.name}': ${describeCause(cause)}`),
            ),
          );
        stored.push({
          attachmentId,
          name: upload.name,
          mimeType: upload.mimeType,
          sizeBytes: bytes.byteLength,
          relativePath: `${BOARD_DIRECTORY_NAME}/${ATTACHMENTS_DIRECTORY_NAME}/${fileName}`,
        });
      }
      return stored;
    });

  const requireProject = (projectId: ProjectId) =>
    Effect.gen(function* () {
      const project = Option.getOrUndefined(yield* projectQuery.getProjectShellById(projectId));
      if (!project) {
        return yield* Effect.fail(new Error(`Project '${projectId}' was not found.`));
      }
      return project;
    });

  /** Parsed board.json, or null when the project has no board yet. */
  const readBoardFile = (boardFilePath: string): Effect.Effect<unknown, Error> =>
    Effect.gen(function* () {
      const exists = yield* fs
        .exists(boardFilePath)
        .pipe(
          Effect.mapError(
            (cause) => new Error(`Failed to read ${boardFilePath}: ${describeCause(cause)}`),
          ),
        );
      if (!exists) return null;

      const raw = yield* fs
        .readFileString(boardFilePath)
        .pipe(
          Effect.mapError(
            (cause) => new Error(`Failed to read ${boardFilePath}: ${describeCause(cause)}`),
          ),
        );
      return yield* Effect.try({
        try: () => JSON.parse(raw) as unknown,
        catch: (cause) => new Error(`Failed to parse ${boardFilePath}: ${describeCause(cause)}`),
      });
    });

  const writeBoardFile = (boardFilePath: string, document: KanbanStoredBoard) =>
    writeFileStringAtomically({
      filePath: boardFilePath,
      contents: `${JSON.stringify(document, null, 2)}\n`,
    }).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
      Effect.mapError(
        (cause) => new Error(`Failed to write ${boardFilePath}: ${describeCause(cause)}`),
      ),
    );

  const boardContextOf = (project: {
    readonly id: ProjectId;
    readonly title: string;
    readonly workspaceRoot: string;
  }): KanbanBoardContext => {
    const boardFilePath = boardFilePathOf(project.workspaceRoot);
    return {
      projectId: project.id,
      projectTitle: project.title,
      workspaceRoot: project.workspaceRoot,
      boardFilePath,
    };
  };

  const loadBoardDocument = (context: KanbanBoardContext) =>
    Effect.gen(function* () {
      const raw = yield* readBoardFile(context.boardFilePath);
      return normalizeBoardDocument(raw, {
        projectId: context.projectId,
        projectTitle: context.projectTitle,
      });
    });

  const summarizeProject = (
    project: OrchestrationProjectShell,
  ): Effect.Effect<KanbanProjectSummary, never> =>
    Effect.gen(function* () {
      const context = boardContextOf(project);
      const readResult = yield* Effect.exit(readBoardFile(context.boardFilePath));
      const empty: KanbanProjectSummary = {
        projectId: project.id,
        title: project.title,
        workspaceRoot: project.workspaceRoot,
        defaultModelSelection: project.defaultModelSelection,
        createdAt: project.createdAt,
        hasBoard: false,
        taskCount: 0,
        todoCount: 0,
        inProgressCount: 0,
        doneCount: 0,
        blockedCount: 0,
        updatedAt: null,
      };

      // A missing board is the normal empty case; an unreadable one is
      // reported as an existing-but-empty board so the picker still lists it.
      if (Exit.isFailure(readResult)) {
        return { ...empty, hasBoard: true };
      }
      if (readResult.value === null) {
        return empty;
      }

      const document = normalizeBoardDocument(readResult.value, {
        projectId: project.id,
        projectTitle: project.title,
      });
      return {
        ...empty,
        hasBoard: true,
        ...countTasksByStatus(document.tasks),
        updatedAt: document.updatedAt,
      };
    });

  /** Board comments plus the agent's own messages, oldest first. */
  const commentsForTask = (
    task: KanbanStoredTask,
    threadMessages: ReadonlyArray<{
      readonly id: string;
      readonly role: string;
      readonly text: string;
      readonly createdAt: string;
    }>,
  ): Array<KanbanComment> => {
    const agentMessages: Array<KanbanComment> = threadMessages
      .filter((message) => message.role === "assistant" && message.text.trim().length > 0)
      .map((message) => ({
        commentId: message.id,
        author: "agent" as const,
        kind: "message" as const,
        body: message.text.trim(),
        createdAt: message.createdAt,
      }));
    return [...task.comments, ...agentMessages].toSorted((left, right) =>
      left.createdAt.localeCompare(right.createdAt),
    );
  };

  /** Agent messages from the task's thread; empty when it never ran. */
  const threadMessagesOf = (agentThreadId: string) => {
    if (agentThreadId.length === 0) return Effect.succeed([]);
    return projectQuery.getThreadDetailById(ThreadId.makeUnsafe(agentThreadId)).pipe(
      Effect.map((thread) => (Option.isSome(thread) ? thread.value.messages : [])),
      Effect.catch(() => Effect.succeed([])),
    );
  };

  const detailOf = (
    context: KanbanBoardContext,
    document: KanbanStoredBoard,
    task: KanbanStoredTask,
  ) =>
    threadMessagesOf(task.agentThreadId).pipe(
      Effect.map(
        (messages) =>
          ({
            projectId: context.projectId,
            projectTitle: context.projectTitle,
            boardFilePath: context.boardFilePath,
            workspaceRoot: context.workspaceRoot,
            task: toKanbanBoard(document, context).tasks.find((entry) => entry.taskId === task.id)!,
            comments: commentsForTask(task, messages),
          }) satisfies KanbanTaskDetail,
      ),
    );

  /** Looks a task up for read paths that do not mutate the board. */
  const withTask = <A>(
    projectId: ProjectId,
    taskId: string,
    use: (
      context: KanbanBoardContext,
      document: KanbanStoredBoard,
      task: KanbanStoredTask,
    ) => Effect.Effect<A, Error>,
  ): Effect.Effect<A, Error> =>
    Effect.gen(function* () {
      const project = yield* requireProject(projectId);
      const context = boardContextOf(project);
      const document = yield* loadBoardDocument(context);
      const task = findStoredTask(document.tasks, taskId);
      if (!task) {
        return yield* Effect.fail(new Error(`Task '${taskId}' was not found on this board.`));
      }
      return yield* use(context, document, task);
    });

  /**
   * Injects a comment into the running turn so the agent sees it mid-flight:
   * `steer` applies it to the active turn instead of queueing a new one.
   */
  const steerRunningTask = (agentThreadId: string, body: string) =>
    orchestrationEngine
      .dispatch({
        type: "thread.turn.start",
        commandId: newCommandId(),
        threadId: ThreadId.makeUnsafe(agentThreadId),
        message: {
          messageId: newMessageId(),
          role: "user",
          text: body,
          attachments: [],
        },
        dispatchMode: "steer",
        runtimeMode: "approval-required",
        interactionMode: "default",
        createdAt: nowIso(),
      })
      .pipe(
        Effect.mapError(
          (cause) => new Error(`Failed to steer the running task: ${describeCause(cause)}`),
        ),
      );

  const interruptRunningTask = (agentThreadId: string) =>
    orchestrationEngine
      .dispatch({
        type: "thread.turn.interrupt",
        commandId: newCommandId(),
        threadId: ThreadId.makeUnsafe(agentThreadId),
        createdAt: nowIso(),
      })
      .pipe(
        Effect.mapError(
          (cause) => new Error(`Failed to interrupt the running task: ${describeCause(cause)}`),
        ),
      );

  const mutateBoard = (
    projectId: ProjectId,
    mutate: (
      document: KanbanStoredBoard,
      now: string,
    ) => Effect.Effect<{ document: KanbanStoredBoard; changed: boolean }, Error>,
  ): Effect.Effect<KanbanBoard, Error> =>
    writeSemaphore.withPermits(1)(
      Effect.gen(function* () {
        const project = yield* requireProject(projectId);
        const context = boardContextOf(project);
        const document = yield* loadBoardDocument(context);
        const now = nowIso();
        const result = yield* mutate(document, now);

        // A mutation that leaves the document untouched (an outcome for a task
        // this board no longer tracks) must not rewrite the file.
        if (!result.changed) {
          return toKanbanBoard(result.document, context);
        }

        result.document.updatedAt = now;
        yield* writeBoardFile(context.boardFilePath, result.document);
        yield* workspaceEntries.invalidate(project.workspaceRoot);
        return toKanbanBoard(result.document, context);
      }),
    );

  /**
   * Claims a run for a task that just entered 进行中: the board records the
   * thread id before the agent is dispatched, so a crash mid-dispatch cannot
   * hand the same task to two agents.
   */
  const claimTaskRun = (
    task: KanbanStoredTask,
    previousStatus: KanbanTaskStatus,
  ): PendingTaskRun => {
    const threadId = newThreadId();
    const threadTitle =
      task.title.trim().slice(0, MAX_THREAD_TITLE_LENGTH) || `${task.id} 看板任务`;
    task.agentThreadId = threadId;
    task.agentRunStatus = "running";
    appendStoredComment(task, {
      author: "agent",
      kind: "status",
      statusCode: "started",
      body: "",
      now: nowIso(),
    });
    return {
      taskId: task.id,
      threadId,
      threadTitle,
      brief: {
        title: task.title,
        description: task.description,
        attachments: task.attachments,
      },
      previousStatus,
      modelSelection: taskModelSelection(task),
    };
  };

  /**
   * Creates the thread and kicks off its first turn, using the agent and model
   * the task carries (falling back to the project's default model).
   */
  const dispatchTaskRun = (project: OrchestrationProjectShell, pending: PendingTaskRun) =>
    Effect.gen(function* () {
      const now = nowIso();
      // The task's own model wins; otherwise the workspace default, otherwise whatever the
      // provider offers — never a constant slug that the install may not have.
      const modelSelection =
        pending.modelSelection ??
        (yield* headlessModel.resolve(project.defaultModelSelection)) ??
        (yield* Effect.fail(
          new Error(
            "这个工作区还没有可用的模型：先在 Peak Code 里给工作区选一个模型，再让 Agent 执行任务。",
          ),
        ));

      yield* orchestrationEngine.dispatch({
        type: "thread.create",
        commandId: newCommandId(),
        threadId: pending.threadId,
        projectId: project.id,
        title: pending.threadTitle,
        modelSelection,
        runtimeMode: "approval-required",
        interactionMode: "default",
        envMode: "local",
        branch: null,
        worktreePath: null,
        createdAt: now,
      });

      yield* orchestrationEngine.dispatch({
        type: "thread.turn.start",
        commandId: newCommandId(),
        threadId: pending.threadId,
        message: {
          messageId: newMessageId(),
          role: "user",
          text: buildTaskPrompt(pending.brief, {
            boardFilePath: boardFilePathOf(project.workspaceRoot),
            taskId: pending.taskId,
          }),
          attachments: [],
        },
        modelSelection,
        assistantDeliveryMode: "streaming",
        dispatchMode: "queue",
        runtimeMode: "approval-required",
        interactionMode: "default",
        createdAt: now,
      });
    }).pipe(
      Effect.mapError(
        (cause) =>
          new Error(`Failed to dispatch task '${pending.taskId}': ${describeCause(cause)}`),
      ),
    );

  /**
   * Rolls the claim back when the agent could not be started: the task returns
   * to the column it came from instead of sitting in 进行中 with no run.
   */
  const revertTaskRunClaim = (projectId: ProjectId, pending: PendingTaskRun) =>
    mutateBoard(projectId, (document, now) =>
      Effect.sync(() => {
        const task = findStoredTask(document.tasks, pending.taskId);
        if (!task || task.agentThreadId !== pending.threadId) {
          return { document, changed: false };
        }
        task.agentThreadId = "";
        task.agentRunStatus = null;
        task.status = pending.previousStatus;
        task.updatedAt = now;
        return { document, changed: true };
      }),
    ).pipe(
      Effect.catch((error) =>
        Effect.logWarning("kanban task run rollback failed", {
          taskId: pending.taskId,
          cause: describeCause(error),
        }),
      ),
    );

  /**
   * Runs a board mutation and, when it left a task waiting for an agent, hands
   * the task's requirement to a fresh thread.
   */
  const mutateBoardAndDispatch = (
    projectId: ProjectId,
    mutate: (
      document: KanbanStoredBoard,
      now: string,
    ) => Effect.Effect<{ document: KanbanStoredBoard; pendingRun: PendingTaskRun | null }, Error>,
  ): Effect.Effect<KanbanBoard, Error> =>
    Effect.gen(function* () {
      let pendingRun: PendingTaskRun | null = null;
      const board = yield* mutateBoard(projectId, (document, now) =>
        mutate(document, now).pipe(
          Effect.map((result) => {
            pendingRun = result.pendingRun;
            return { document: result.document, changed: true };
          }),
        ),
      );

      const claimed = pendingRun as PendingTaskRun | null;
      if (!claimed) return board;

      const project = yield* requireProject(projectId);
      return yield* dispatchTaskRun(project, claimed).pipe(
        Effect.catch((error) =>
          revertTaskRunClaim(projectId, claimed).pipe(Effect.flatMap(() => Effect.fail(error))),
        ),
        Effect.as(board),
      );
    });

  return {
    listProjects: (_input: KanbanListProjectsInput) =>
      Effect.gen(function* () {
        const snapshot = yield* projectQuery
          .getShellSnapshot()
          .pipe(
            Effect.mapError(
              (cause) => new Error(`Failed to list projects: ${describeCause(cause)}`),
            ),
          );
        const projects = snapshot.projects.filter((project) => project.kind !== "chat");
        const summaries = yield* Effect.forEach(projects, summarizeProject, { concurrency: 4 });
        return { projects: summaries } satisfies KanbanListProjectsResult;
      }),

    getBoard: (input) =>
      Effect.gen(function* () {
        const project = yield* requireProject(input.projectId);
        const context = boardContextOf(project);
        const document = yield* loadBoardDocument(context);
        return toKanbanBoard(document, context);
      }),

    createTask: (input) =>
      mutateBoardAndDispatch(input.projectId, (document, now) =>
        Effect.gen(function* () {
          const project = yield* requireProject(input.projectId);
          const attachmentDescriptors = yield* storeTaskAttachments(
            project.workspaceRoot,
            input.attachments ?? [],
          );
          const task = createStoredTask({
            title: input.title,
            description: input.description ?? "",
            attachmentDescriptors,
            status: input.status,
            priority: input.priority,
            pipeline: input.pipeline,
            assignee: input.assignee,
            ...(input.agentProvider !== undefined ? { agentProvider: input.agentProvider } : {}),
            ...(input.agentModel !== undefined ? { agentModel: input.agentModel } : {}),
            now,
          });
          document.tasks.push(task);
          return {
            document,
            pendingRun: taskNeedsAgentRun(task) ? claimTaskRun(task, "todo") : null,
          };
        }),
      ),

    updateTask: (input) =>
      mutateBoardAndDispatch(input.projectId, (document, now) =>
        Effect.gen(function* () {
          const task = findStoredTask(document.tasks, input.taskId);
          if (!task) {
            return yield* Effect.fail(
              new Error(`Task '${input.taskId}' was not found on this board.`),
            );
          }

          const previousStatus = task.status;
          if (input.title !== undefined) task.title = input.title;
          if (input.description !== undefined) task.description = input.description.trim();
          if (input.priority !== undefined) task.priority = input.priority;
          if (input.pipeline !== undefined) task.pipeline = input.pipeline;
          if (input.assignee !== undefined) task.assignee = input.assignee;
          if (input.agentProvider !== undefined) {
            task.agentProvider = normalizeAgentProvider(input.agentProvider);
          }
          if (input.agentModel !== undefined) task.agentModel = input.agentModel.trim();
          if (input.status !== undefined) {
            if (input.status !== task.status) {
              document.tasks = reorderStoredTask(
                document.tasks,
                task.id,
                input.status,
                input.order,
                now,
              );
            }
          } else if (input.order !== undefined) {
            document.tasks = reorderStoredTask(
              document.tasks,
              task.id,
              task.status,
              input.order,
              now,
            );
          }
          task.updatedAt = now;
          const enteredInProgress =
            previousStatus !== "in_progress" && task.status === "in_progress";
          return {
            document,
            pendingRun:
              enteredInProgress && taskNeedsAgentRun(task)
                ? claimTaskRun(task, previousStatus)
                : null,
          };
        }),
      ),

    moveTask: (input) =>
      mutateBoardAndDispatch(input.projectId, (document, now) =>
        Effect.gen(function* () {
          const existing = findStoredTask(document.tasks, input.taskId);
          if (!existing) {
            return yield* Effect.fail(
              new Error(`Task '${input.taskId}' was not found on this board.`),
            );
          }
          const previousStatus = existing.status;
          document.tasks = reorderStoredTask(
            document.tasks,
            input.taskId,
            input.status,
            input.order,
            now,
          );
          const task = findStoredTask(document.tasks, input.taskId)!;
          // Only an actual entry into 进行中 starts work: reordering inside the
          // column, or a run already in flight, must not dispatch again.
          const enteredInProgress =
            previousStatus !== "in_progress" && task.status === "in_progress";
          return {
            document,
            pendingRun:
              enteredInProgress && taskNeedsAgentRun(task)
                ? claimTaskRun(task, previousStatus)
                : null,
          };
        }),
      ),

    deleteTask: (input) =>
      mutateBoard(input.projectId, (document) =>
        Effect.gen(function* () {
          if (!findStoredTask(document.tasks, input.taskId)) {
            return yield* Effect.fail(
              new Error(`Task '${input.taskId}' was not found on this board.`),
            );
          }
          document.tasks = document.tasks.filter((task) => task.id !== input.taskId);
          return { document, changed: true };
        }),
      ),

    recordTaskRunOutcome: (input) =>
      Effect.gen(function* () {
        const thread = Option.getOrUndefined(
          yield* projectQuery
            .getThreadShellById(input.threadId)
            .pipe(
              Effect.mapError(
                (cause) =>
                  new Error(`Failed to read thread '${input.threadId}': ${describeCause(cause)}`),
              ),
            ),
        );
        if (!thread) return;
        // A failed run explains itself in the comment the task keeps.
        const failureReason = thread.session?.lastError ?? "";

        yield* mutateBoard(thread.projectId, (document, now) =>
          Effect.sync(() => {
            const task = document.tasks.find(
              (entry) =>
                entry.agentThreadId === input.threadId && entry.agentRunStatus === "running",
            );
            // No task, or a newer run already replaced this one: leave the board alone.
            if (!task) return { document, changed: false };
            task.agentRunStatus = input.runStatus;
            task.status = taskStatusForRunOutcome(input.runStatus);
            task.updatedAt = now;
            appendStoredComment(task, {
              author: "agent",
              kind: "status",
              statusCode: runStatusCodeFor(input.runStatus),
              body: input.runStatus === "failed" ? failureReason : "",
              now,
            });
            return { document, changed: true };
          }),
        ).pipe(Effect.asVoid);
      }),

    recordTaskRunComment: (input) =>
      Effect.gen(function* () {
        const body = input.body.trim();
        if (body.length === 0) {
          return yield* Effect.fail(new Error("A board comment needs text to record."));
        }
        const thread = Option.getOrUndefined(
          yield* projectQuery
            .getThreadShellById(input.threadId)
            .pipe(
              Effect.mapError(
                (cause) =>
                  new Error(`Failed to read thread '${input.threadId}': ${describeCause(cause)}`),
              ),
            ),
        );
        if (!thread) {
          return yield* Effect.fail(new Error(`Thread '${input.threadId}' was not found.`));
        }

        // Kept outside the mutation so the "no card owns this thread" case stays
        // distinguishable from "written" — the mutation itself reports nothing.
        let written = false;
        yield* mutateBoard(thread.projectId, (document, now) =>
          Effect.sync(() => {
            const task = document.tasks.find(
              (entry) =>
                entry.agentThreadId === input.threadId && entry.agentRunStatus === "running",
            );
            // No task, or a newer run already replaced this one: the note has no
            // card to belong to, so the board is left alone and the caller is told.
            if (!task) return { document, changed: false };
            appendStoredComment(task, { author: "agent", kind: "note", body, now });
            task.updatedAt = now;
            written = true;
            return { document, changed: true };
          }),
        );
        return written;
      }),

    /**
     * The card a conversation was dispatched from, with its full timeline.
     *
     * Read side of {@link recordTaskRunComment}. It matches on `agentThreadId`
     * alone rather than requiring a *running* run, because the history is most
     * useful on a second pass: a card that was interrupted or blocked and later
     * handed back to an agent still owns the notes and feedback from the first
     * attempt, and that is what the next run should read before starting.
     */
    readTaskForThread: (input) =>
      Effect.gen(function* () {
        const thread = Option.getOrUndefined(
          yield* projectQuery
            .getThreadShellById(input.threadId)
            .pipe(
              Effect.mapError(
                (cause) =>
                  new Error(`Failed to read thread '${input.threadId}': ${describeCause(cause)}`),
              ),
            ),
        );
        if (!thread) {
          return yield* Effect.fail(new Error(`Thread '${input.threadId}' was not found.`));
        }

        const project = yield* requireProject(thread.projectId);
        const context = boardContextOf(project);
        const document = yield* loadBoardDocument(context);
        const task = document.tasks.find((entry) => entry.agentThreadId === input.threadId);
        if (!task) return null;

        return {
          context,
          task,
          comments: commentsForTask(task, yield* threadMessagesOf(task.agentThreadId)),
        } satisfies KanbanThreadTaskRecord;
      }),

    releaseStaleTaskRuns: () =>
      Effect.gen(function* () {
        const snapshot = yield* projectQuery
          .getShellSnapshot()
          .pipe(Effect.catch(() => Effect.succeed(null)));
        if (!snapshot) return;

        const projects = snapshot.projects.filter((entry) => entry.kind !== "chat");
        yield* Effect.forEach(
          projects,
          (project) =>
            Effect.gen(function* () {
              const context = boardContextOf(project);
              const document = yield* loadBoardDocument(context).pipe(
                Effect.catch(() => Effect.succeed(null)),
              );
              if (!document) return;

              const running = document.tasks.filter(
                (task) => task.agentRunStatus === "running" && task.agentThreadId.length > 0,
              );
              if (running.length === 0) return;

              const now = nowIso();
              let changed = false;
              for (const task of running) {
                const thread = Option.getOrUndefined(
                  yield* projectQuery
                    .getThreadShellById(ThreadId.makeUnsafe(task.agentThreadId))
                    .pipe(Effect.catch(() => Effect.succeed(Option.none()))),
                );
                // A live run always has a session that is running; anything else
                // (stopped session, deleted thread) means the run is gone.
                if (thread?.session?.status === "running") continue;
                task.agentRunStatus = "interrupted";
                task.status = taskStatusForRunOutcome("interrupted");
                task.updatedAt = now;
                appendStoredComment(task, {
                  author: "agent",
                  kind: "status",
                  statusCode: "interrupted",
                  body: "",
                  now,
                });
                changed = true;
              }

              if (!changed) return;
              document.updatedAt = now;
              yield* writeSemaphore.withPermits(1)(
                writeBoardFile(context.boardFilePath, document).pipe(
                  Effect.flatMap(() => workspaceEntries.invalidate(project.workspaceRoot)),
                  Effect.catch((error) =>
                    Effect.logWarning("kanban stale run release failed to write the board", {
                      projectId: project.id,
                      cause: describeCause(error),
                    }),
                  ),
                ),
              );
            }),
          { concurrency: 2 },
        );
      }),

    generateTaskRequirement: (input) =>
      Effect.gen(function* () {
        const project = yield* requireProject(input.projectId);
        const task = yield* withTask(input.projectId, input.taskId, (_context, _document, found) =>
          Effect.succeed(found),
        );
        const modelSelection =
          taskModelSelection(task) ??
          (yield* headlessModel.resolve(project.defaultModelSelection)) ??
          (yield* Effect.fail(
            new Error("这个工作区还没有可用的模型：先在 Peak Code 里给工作区选一个模型。"),
          ));

        const generated = yield* textGeneration
          .generateTaskRequirement({
            cwd: project.workspaceRoot,
            title: task.title.trim(),
            ...(task.description.trim().length > 0 ? { notes: task.description.trim() } : {}),
            modelSelection,
          })
          .pipe(
            Effect.mapError(
              (cause) =>
                new Error(
                  `Failed to generate a requirement for '${task.id}': ${describeCause(cause)}`,
                ),
            ),
          );

        yield* mutateBoard(input.projectId, (document, now) =>
          Effect.sync(() => {
            const stored = findStoredTask(document.tasks, task.id);
            if (!stored) return { document, changed: false };
            stored.description = generated.requirement;
            stored.updatedAt = now;
            return { document, changed: true };
          }),
        );

        return yield* withTask(input.projectId, input.taskId, (detailContext, document, stored) =>
          detailOf(detailContext, document, stored),
        );
      }),

    getTaskDetail: (input) =>
      withTask(input.projectId, input.taskId, (context, document, task) =>
        detailOf(context, document, task),
      ),

    generateRequirementDraft: (input) =>
      Effect.gen(function* () {
        const project = yield* requireProject(input.projectId);
        const notes = input.notes?.trim() ?? "";
        const modelSelection =
          taskModelSelection({
            agentProvider: input.agentProvider ?? "",
            agentModel: input.agentModel ?? "",
          }) ??
          (yield* headlessModel.resolve(project.defaultModelSelection)) ??
          (yield* Effect.fail(
            new Error("这个工作区还没有可用的模型：先在 Peak Code 里给工作区选一个模型。"),
          ));

        const generated = yield* textGeneration
          .generateTaskRequirement({
            cwd: project.workspaceRoot,
            title: input.title.trim(),
            ...(notes.length > 0 ? { notes } : {}),
            modelSelection,
          })
          .pipe(
            Effect.mapError(
              (cause) =>
                new Error(
                  `Failed to generate a requirement for '${input.title.trim()}': ${describeCause(cause)}`,
                ),
            ),
          );

        return { requirement: generated.requirement };
      }),

    addTaskComment: (input) =>
      Effect.gen(function* () {
        const action = input.action ?? "comment";
        yield* mutateBoard(input.projectId, (document, now) =>
          Effect.gen(function* () {
            const task = findStoredTask(document.tasks, input.taskId);
            if (!task) {
              return yield* Effect.fail(
                new Error(`Task '${input.taskId}' was not found on this board.`),
              );
            }

            const body = input.body.trim();
            if (action === "steer" && body.length === 0) {
              return yield* Effect.fail(new Error("A steered comment needs text to insert."));
            }
            if (body.length > 0) {
              appendStoredComment(task, {
                author: "user",
                kind: "note",
                body,
                now,
              });
            }
            task.updatedAt = now;

            const canReachRun = task.agentThreadId.length > 0 && task.agentRunStatus === "running";
            if (action === "steer" && canReachRun) {
              yield* steerRunningTask(task.agentThreadId, body);
              appendStoredComment(task, {
                author: "user",
                kind: "status",
                statusCode: "steered",
                body: "",
                now,
              });
            } else if (action === "interrupt" && canReachRun) {
              yield* interruptRunningTask(task.agentThreadId);
            }

            return { document, changed: true };
          }),
        );
        return yield* withTask(input.projectId, input.taskId, (context, document, stored) =>
          detailOf(context, document, stored),
        );
      }),
  } satisfies KanbanServiceShape;
});

export const KanbanServiceLive = Layer.effect(KanbanService, makeKanbanService);
