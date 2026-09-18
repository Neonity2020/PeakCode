/**
 * KanbanService - Service tag for the per-project kanban board.
 *
 * Each board lives inside its project directory at `.kanban/board.json` so the
 * app, coding agents, and the standalone 看板 plugin all read and write the
 * same file.
 *
 * @module KanbanService
 */
import { Effect, ServiceMap } from "effect";

import type {
  KanbanAddTaskCommentInput,
  KanbanGenerateRequirementDraftInput,
  KanbanGenerateRequirementDraftResult,
  KanbanGenerateTaskRequirementInput,
  KanbanAgentRunStatus,
  KanbanBoard,
  KanbanCreateTaskInput,
  KanbanDeleteTaskInput,
  KanbanGetBoardInput,
  KanbanGetTaskDetailInput,
  KanbanListProjectsInput,
  KanbanListProjectsResult,
  KanbanMoveTaskInput,
  KanbanTaskDetail,
  KanbanUpdateTaskInput,
  ThreadId,
} from "@peakcode/contracts";

import type { KanbanThreadTaskRecord } from "../boardDocument.ts";

/** Terminal outcome of a dispatched task run. */
export type KanbanTaskRunOutcome = Exclude<KanbanAgentRunStatus, "running">;

export interface KanbanTaskRunOutcomeInput {
  readonly threadId: ThreadId;
  readonly runStatus: KanbanTaskRunOutcome;
}

export interface KanbanTaskRunCommentInput {
  readonly threadId: ThreadId;
  /** The progress line. Empty text is refused rather than silently dropped. */
  readonly body: string;
}

export interface KanbanServiceShape {
  /**
   * List the app's projects with kanban task counts, so callers can see which
   * projects have work in flight without opening each board.
   */
  readonly listProjects: (
    input: KanbanListProjectsInput,
  ) => Effect.Effect<KanbanListProjectsResult, Error>;

  /**
   * Read one project's board. Never creates the board file.
   */
  readonly getBoard: (input: KanbanGetBoardInput) => Effect.Effect<KanbanBoard, Error>;

  /**
   * Append a task, creating the board file when the project has none yet.
   *
   * A task created straight into 进行中 is dispatched to an agent like any
   * other task entering that column.
   */
  readonly createTask: (input: KanbanCreateTaskInput) => Effect.Effect<KanbanBoard, Error>;

  /**
   * Patch a task's fields and/or position.
   */
  readonly updateTask: (input: KanbanUpdateTaskInput) => Effect.Effect<KanbanBoard, Error>;

  /**
   * Move a task to a column, optionally at a specific index. Landing in 进行中
   * dispatches the task's requirement to an agent.
   */
  readonly moveTask: (input: KanbanMoveTaskInput) => Effect.Effect<KanbanBoard, Error>;

  /**
   * Delete a task.
   */
  readonly deleteTask: (input: KanbanDeleteTaskInput) => Effect.Effect<KanbanBoard, Error>;

  /**
   * Write a finished agent run back onto its task: 已完成 on success, 已阻塞 on
   * failure, 待开始 when the run was interrupted. Runs whose turn never came
   * back are resolved by the reactor that calls this.
   */
  readonly recordTaskRunOutcome: (input: KanbanTaskRunOutcomeInput) => Effect.Effect<void, Error>;

  /**
   * Append one progress note from the agent to the task its run belongs to. The
   * task is resolved from the thread, so the agent never names a card itself.
   *
   * Resolves `false` when no running task owns this thread (a plain chat, or a
   * run that already finished) — the caller has to be able to say "nothing was
   * written" instead of reporting a comment that never landed.
   *
   * This is what keeps the card's timeline readable on its own: a dispatched run
   * leaves a line per finished step, and the conversation it ran in stays where
   * the detail belongs.
   */
  readonly recordTaskRunComment: (
    input: KanbanTaskRunCommentInput,
  ) => Effect.Effect<boolean, Error>;

  /**
   * One task with its full comment stream: comments kept on the board plus the
   * agent's own messages from the thread it ran in, oldest first.
   */
  readonly getTaskDetail: (
    input: KanbanGetTaskDetailInput,
  ) => Effect.Effect<KanbanTaskDetail, Error>;

  /**
   * The card a conversation was dispatched from, with its timeline — resolved
   * from the thread id alone, which is all a running agent has. Null when the
   * conversation did not come from a board, so the caller can say so plainly
   * instead of handing back an empty card.
   */
  readonly readTaskForThread: (input: {
    readonly threadId: ThreadId;
  }) => Effect.Effect<KanbanThreadTaskRecord | null, Error>;

  /**
   * Append a comment to a task. `steer` also injects the text into the running
   * turn, `interrupt` stops it.
   */
  readonly addTaskComment: (
    input: KanbanAddTaskCommentInput,
  ) => Effect.Effect<KanbanTaskDetail, Error>;

  /**
   * Release tasks whose agent run is no longer alive (the app was closed or the
   * session stopped): they go back to 待开始 with an interruption notice, so a
   * stale 执行中 never blocks re-dispatching. Best effort, never fails.
   */
  readonly releaseStaleTaskRuns: () => Effect.Effect<void, never>;

  /**
   * Write the task's requirement with an agent: a short agile brief with
   * acceptance criteria derived from the title, stored on the task.
   */
  readonly generateTaskRequirement: (
    input: KanbanGenerateTaskRequirementInput,
  ) => Effect.Effect<KanbanTaskDetail, Error>;

  /**
   * Same generation for a task that does not exist yet: the requester's own
   * title and notes go in, the brief comes back without touching any board.
   */
  readonly generateRequirementDraft: (
    input: KanbanGenerateRequirementDraftInput,
  ) => Effect.Effect<KanbanGenerateRequirementDraftResult, Error>;
}

export class KanbanService extends ServiceMap.Service<KanbanService, KanbanServiceShape>()(
  "t3/services/KanbanService",
) {}
