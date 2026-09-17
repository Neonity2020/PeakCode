import { Schema } from "effect";

import {
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas";
import { ModelSelection, ProviderKind } from "./orchestration";

/**
 * Kanban boards are stored per project at `<project>/.kanban/board.json`, the
 * same document format the standalone 看板 plugin reads and writes. These
 * schemas describe the wire shape; the stored shape is normalized on the
 * server (see apps/server/src/kanban/boardDocument.ts).
 */

export const KanbanTaskId = TrimmedNonEmptyString.pipe(Schema.brand("KanbanTaskId"));
export type KanbanTaskId = typeof KanbanTaskId.Type;

export const KANBAN_TASK_STATUSES = ["todo", "in_progress", "done", "blocked", "archived"] as const;
export const KanbanTaskStatus = Schema.Literals(KANBAN_TASK_STATUSES);
export type KanbanTaskStatus = typeof KanbanTaskStatus.Type;

export const KANBAN_TASK_PRIORITIES = ["high", "medium", "low"] as const;
export const KanbanTaskPriority = Schema.Literals(KANBAN_TASK_PRIORITIES);
export type KanbanTaskPriority = typeof KanbanTaskPriority.Type;

/**
 * Lifecycle of the agent run a task was dispatched to. `running` is written when
 * the task enters 进行中; the terminal values are written back from the thread's
 * turn outcome.
 */
export const KANBAN_AGENT_RUN_STATUSES = ["running", "done", "failed", "interrupted"] as const;
export const KanbanAgentRunStatus = Schema.Literals(KANBAN_AGENT_RUN_STATUSES);
export type KanbanAgentRunStatus = typeof KanbanAgentRunStatus.Type;

/** Agents a task can be handed to; the same set the app can run threads with. */
export const KANBAN_AGENT_PROVIDERS = ["pi"] as const;
export const KanbanAgentProvider = Schema.Literals(KANBAN_AGENT_PROVIDERS);
export type KanbanAgentProvider = typeof KanbanAgentProvider.Type;

/** Who wrote a task comment. */
export const KANBAN_COMMENT_AUTHORS = ["agent", "user"] as const;
export const KanbanCommentAuthor = Schema.Literals(KANBAN_COMMENT_AUTHORS);
export type KanbanCommentAuthor = typeof KanbanCommentAuthor.Type;

/**
 * A lifecycle notice (`status`, rendered in the UI language), a written note, or
 * the agent's own words pulled from its thread (`message`).
 */
export const KANBAN_COMMENT_KINDS = ["status", "note", "message"] as const;
export const KanbanCommentKind = Schema.Literals(KANBAN_COMMENT_KINDS);
export type KanbanCommentKind = typeof KanbanCommentKind.Type;

/** Lifecycle notice codes; `body` carries any detail such as a failure reason. */
export const KANBAN_COMMENT_STATUS_CODES = [
  "started",
  "done",
  "failed",
  "interrupted",
  "steered",
] as const;
export const KanbanCommentStatusCode = Schema.Literals(KANBAN_COMMENT_STATUS_CODES);
export type KanbanCommentStatusCode = typeof KanbanCommentStatusCode.Type;

export const KanbanComment = Schema.Struct({
  commentId: TrimmedNonEmptyString,
  author: KanbanCommentAuthor,
  kind: KanbanCommentKind,
  statusCode: Schema.optional(KanbanCommentStatusCode),
  body: Schema.String,
  createdAt: IsoDateTime,
});
export type KanbanComment = typeof KanbanComment.Type;

/** What sending a comment does beyond recording it. */
export const KANBAN_COMMENT_ACTIONS = ["comment", "steer", "interrupt"] as const;
export const KanbanCommentAction = Schema.Literals(KANBAN_COMMENT_ACTIONS);
export type KanbanCommentAction = typeof KanbanCommentAction.Type;

export const KanbanColumn = Schema.Struct({
  key: KanbanTaskStatus,
  name: TrimmedNonEmptyString,
  dot: TrimmedNonEmptyString,
});
export type KanbanColumn = typeof KanbanColumn.Type;

export const KanbanTask = Schema.Struct({
  taskId: KanbanTaskId,
  title: Schema.String,
  /** Requirement text for the task: what has to be built and how it is judged done. */
  description: Schema.String,
  status: KanbanTaskStatus,
  priority: KanbanTaskPriority,
  pipeline: Schema.String,
  assignee: Schema.String,
  /** Agent the task is handed to, and the model it should run with ("" = default). */
  agentProvider: ProviderKind,
  agentModel: Schema.String,
  /** Thread the task was dispatched to, so its outcome can be written back. */
  agentThreadId: Schema.NullOr(ThreadId),
  agentRunStatus: Schema.NullOr(KanbanAgentRunStatus),
  /** Run notices and notes kept with the task, oldest first. */
  comments: Schema.Array(KanbanComment),
  createdAt: Schema.NullOr(IsoDateTime),
  updatedAt: Schema.NullOr(IsoDateTime),
});
export type KanbanTask = typeof KanbanTask.Type;

export const KanbanProjectSummary = Schema.Struct({
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  /** Model a task uses when it does not name one itself. */
  defaultModelSelection: Schema.NullOr(ModelSelection),
  hasBoard: Schema.Boolean,
  taskCount: NonNegativeInt,
  todoCount: NonNegativeInt,
  inProgressCount: NonNegativeInt,
  doneCount: NonNegativeInt,
  blockedCount: NonNegativeInt,
  updatedAt: Schema.NullOr(IsoDateTime),
});
export type KanbanProjectSummary = typeof KanbanProjectSummary.Type;

export const KanbanBoard = Schema.Struct({
  projectId: ProjectId,
  projectTitle: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  boardFilePath: TrimmedNonEmptyString,
  columns: Schema.Array(KanbanColumn),
  tasks: Schema.Array(KanbanTask),
  updatedAt: Schema.NullOr(IsoDateTime),
});
export type KanbanBoard = typeof KanbanBoard.Type;

export const KanbanListProjectsInput = Schema.Struct({});
export type KanbanListProjectsInput = typeof KanbanListProjectsInput.Type;

export const KanbanListProjectsResult = Schema.Struct({
  projects: Schema.Array(KanbanProjectSummary),
});
export type KanbanListProjectsResult = typeof KanbanListProjectsResult.Type;

export const KanbanGetBoardInput = Schema.Struct({
  projectId: ProjectId,
});
export type KanbanGetBoardInput = typeof KanbanGetBoardInput.Type;

export const KanbanCreateTaskInput = Schema.Struct({
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  description: Schema.optional(Schema.String),
  status: KanbanTaskStatus,
  priority: KanbanTaskPriority,
  pipeline: Schema.String,
  assignee: Schema.String,
  agentProvider: Schema.optional(ProviderKind),
  agentModel: Schema.optional(Schema.String),
});
export type KanbanCreateTaskInput = typeof KanbanCreateTaskInput.Type;

export const KanbanUpdateTaskInput = Schema.Struct({
  projectId: ProjectId,
  taskId: KanbanTaskId,
  title: Schema.optional(TrimmedNonEmptyString),
  description: Schema.optional(Schema.String),
  agentProvider: Schema.optional(ProviderKind),
  agentModel: Schema.optional(Schema.String),
  status: Schema.optional(KanbanTaskStatus),
  priority: Schema.optional(KanbanTaskPriority),
  pipeline: Schema.optional(Schema.String),
  assignee: Schema.optional(Schema.String),
  order: Schema.optional(NonNegativeInt),
});
export type KanbanUpdateTaskInput = typeof KanbanUpdateTaskInput.Type;

export const KanbanMoveTaskInput = Schema.Struct({
  projectId: ProjectId,
  taskId: KanbanTaskId,
  status: KanbanTaskStatus,
  order: Schema.optional(NonNegativeInt),
});
export type KanbanMoveTaskInput = typeof KanbanMoveTaskInput.Type;

export const KanbanDeleteTaskInput = Schema.Struct({
  projectId: ProjectId,
  taskId: KanbanTaskId,
});
export type KanbanDeleteTaskInput = typeof KanbanDeleteTaskInput.Type;

export const KanbanGetTaskDetailInput = Schema.Struct({
  projectId: ProjectId,
  taskId: KanbanTaskId,
});
export type KanbanGetTaskDetailInput = typeof KanbanGetTaskDetailInput.Type;

export const KanbanTaskDetail = Schema.Struct({
  projectId: ProjectId,
  projectTitle: TrimmedNonEmptyString,
  boardFilePath: TrimmedNonEmptyString,
  task: KanbanTask,
  /**
   * The task's comment stream: comments kept on the board merged with the
   * messages the agent wrote in its thread, oldest first.
   */
  comments: Schema.Array(KanbanComment),
});
export type KanbanTaskDetail = typeof KanbanTaskDetail.Type;

export const KanbanGenerateTaskRequirementInput = Schema.Struct({
  projectId: ProjectId,
  taskId: KanbanTaskId,
});
export type KanbanGenerateTaskRequirementInput = typeof KanbanGenerateTaskRequirementInput.Type;

/**
 * Requirement generation for a task that is still being written, so it is keyed
 * by the draft's own text instead of a task id. Nothing is stored: the caller
 * drops the result into the field it is editing.
 */
export const KanbanGenerateRequirementDraftInput = Schema.Struct({
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  /** Notes the requester already wrote, used to steer the draft. */
  notes: Schema.optional(Schema.String),
  agentProvider: Schema.optional(ProviderKind),
  /** Explicit model for the draft; omitted means the project default. */
  agentModel: Schema.optional(Schema.String),
});
export type KanbanGenerateRequirementDraftInput = typeof KanbanGenerateRequirementDraftInput.Type;

export const KanbanGenerateRequirementDraftResult = Schema.Struct({
  requirement: Schema.String,
});
export type KanbanGenerateRequirementDraftResult = typeof KanbanGenerateRequirementDraftResult.Type;

export const KanbanAddTaskCommentInput = Schema.Struct({
  projectId: ProjectId,
  taskId: KanbanTaskId,
  /** Empty is allowed for `interrupt`, where there is nothing to say. */
  body: Schema.String,
  action: Schema.optional(KanbanCommentAction),
});
export type KanbanAddTaskCommentInput = typeof KanbanAddTaskCommentInput.Type;
