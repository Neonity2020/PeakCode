/**
 * boardDocument - Pure helpers for the per-project kanban document at
 * `<project>/.kanban/board.json`.
 *
 * The document format matches the standalone 看板 plugin (board.py) so both
 * surfaces read and write the same file: unknown top-level keys and unknown
 * task keys are preserved on write, statuses/priorities accept the same
 * aliases (including Chinese labels), and column ordering follows the fixed
 * status order.
 *
 * @module boardDocument
 */

import { randomUUID } from "node:crypto";

import { KanbanTaskId, ThreadId } from "@peakcode/contracts";
import type {
  KanbanAgentRunStatus,
  KanbanBoard,
  KanbanColumn,
  KanbanComment,
  KanbanCommentAuthor,
  KanbanCommentKind,
  KanbanCommentStatusCode,
  KanbanTask,
  KanbanTaskAttachment,
  KanbanTaskPriority,
  KanbanTaskStatus,
  ModelSelection,
  ProjectId,
  ProviderKind,
} from "@peakcode/contracts";

export interface KanbanStoredTask {
  id: string;
  title: string;
  description: string;
  status: KanbanTaskStatus;
  priority: KanbanTaskPriority;
  pipeline: string;
  assignee: string;
  /** Agent the task is handed to, and the model to run it with ("" = default). */
  agentProvider: string;
  agentModel: string;
  /** Thread the task was dispatched to; empty when it never ran. */
  agentThreadId: string;
  agentRunStatus: KanbanAgentRunStatus | null;
  /** Images stored under `.kanban/attachments/` and attached to the requirement. */
  attachments: Array<KanbanTaskAttachment>;
  comments: Array<KanbanComment>;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

export interface KanbanStoredBoard {
  version: number;
  name: string;
  projectId: string;
  columns: ReadonlyArray<KanbanColumn>;
  tasks: Array<KanbanStoredTask>;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

export interface KanbanBoardContext {
  readonly projectId: ProjectId;
  readonly projectTitle: string;
  readonly workspaceRoot: string;
  readonly boardFilePath: string;
}

/** Default columns written into new boards, matching the plugin's palette. */
export const KANBAN_DEFAULT_COLUMNS: ReadonlyArray<KanbanColumn> = [
  { key: "todo", name: "待开始", dot: "#9CA3AF" },
  { key: "in_progress", name: "进行中", dot: "#3B82F6" },
  { key: "done", name: "已完成", dot: "#22C55E" },
  { key: "blocked", name: "已阻塞", dot: "#EF4444" },
  { key: "archived", name: "归档", dot: "#6B7280" },
];

const STATUS_ORDER: ReadonlyArray<KanbanTaskStatus> = [
  "todo",
  "in_progress",
  "done",
  "blocked",
  "archived",
];

const STATUS_ALIASES: Record<string, KanbanTaskStatus> = {
  todo: "todo",
  待开始: "todo",
  未开始: "todo",
  backlog: "todo",
  in_progress: "in_progress",
  doing: "in_progress",
  进行中: "in_progress",
  done: "done",
  completed: "done",
  已完成: "done",
  完成: "done",
  blocked: "blocked",
  已阻塞: "blocked",
  阻塞: "blocked",
  archived: "archived",
  archive: "archived",
  归档: "archived",
  已归档: "archived",
};

const PRIORITY_ALIASES: Record<string, KanbanTaskPriority> = {
  high: "high",
  h: "high",
  高: "high",
  紧急: "high",
  medium: "medium",
  m: "medium",
  中: "medium",
  normal: "medium",
  low: "low",
  l: "low",
  低: "low",
};

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asNonEmptyString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

/** Plugin-compatible timestamp: second precision, UTC, trailing `Z`. */
export function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function newTaskId(): string {
  return `t_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
}

export function newCommentId(): string {
  return `c_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
}

export function normalizeStatus(
  value: unknown,
  fallback: KanbanTaskStatus = "todo",
): KanbanTaskStatus {
  if (typeof value !== "string") return fallback;
  const key = value
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, "_");
  return STATUS_ALIASES[key] ?? fallback;
}

export function normalizePriority(
  value: unknown,
  fallback: KanbanTaskPriority = "medium",
): KanbanTaskPriority {
  if (typeof value !== "string") return fallback;
  const key = value.trim().toLowerCase();
  return PRIORITY_ALIASES[key] ?? fallback;
}

/** Only agents this app can actually run threads with are kept. */
export function normalizeAgentProvider(
  value: unknown,
  fallback: ProviderKind = "pi",
): ProviderKind {
  if (typeof value !== "string") return fallback;
  const key = value.trim().toLowerCase();
  return key === "pi" ? key : fallback;
}

/**
 * Model selection a task runs with, or null when the task leaves the choice to
 * the project/app default.
 */
export function taskModelSelection(task: {
  readonly agentProvider: string;
  readonly agentModel: string;
}): ModelSelection | null {
  const model = task.agentModel.trim();
  if (model.length === 0) return null;
  return { provider: normalizeAgentProvider(task.agentProvider), model };
}

export function normalizeAgentRunStatus(value: unknown): KanbanAgentRunStatus | null {
  if (typeof value !== "string") return null;
  const key = value.trim().toLowerCase();
  return key === "running" || key === "done" || key === "failed" || key === "interrupted"
    ? key
    : null;
}

function normalizeColumns(value: unknown): ReadonlyArray<KanbanColumn> {
  if (!Array.isArray(value)) return KANBAN_DEFAULT_COLUMNS;
  const columns: Array<KanbanColumn> = [];
  for (const entry of value) {
    if (!isPlainRecord(entry)) continue;
    const key = asNonEmptyString(entry["key"]);
    if (!key || !STATUS_ORDER.includes(key as KanbanTaskStatus)) continue;
    const status = key as KanbanTaskStatus;
    if (columns.some((column) => column.key === status)) continue;
    const fallback = KANBAN_DEFAULT_COLUMNS.find((column) => column.key === status)!;
    columns.push({
      key: status,
      name: asNonEmptyString(entry["name"]) ?? fallback.name,
      dot: asNonEmptyString(entry["dot"]) ?? fallback.dot,
    });
  }
  if (columns.length === 0) return KANBAN_DEFAULT_COLUMNS;
  // Columns added by later versions (归档) appear on boards written before them,
  // and the fixed status order keeps a hand-edited list rendering predictably.
  const withNewDefaults = STATUS_ORDER.map(
    (status) =>
      columns.find((column) => column.key === status) ??
      KANBAN_DEFAULT_COLUMNS.find((column) => column.key === status)!,
  );
  return withNewDefaults;
}

/**
 * Image descriptors kept with a task. Entries that lost their id, mime type or
 * a safe relative path are dropped: an unresolvable path would render as a
 * broken image and would be handed to the agent as a dead reference.
 */
function normalizeAttachments(value: unknown): Array<KanbanTaskAttachment> {
  if (!Array.isArray(value)) return [];
  const attachments: Array<KanbanTaskAttachment> = [];
  for (const entry of value) {
    if (!isPlainRecord(entry)) continue;
    const attachmentId = asNonEmptyString(entry["attachmentId"]);
    const name = asNonEmptyString(entry["name"]);
    const mimeType = asNonEmptyString(entry["mimeType"]);
    const relativePath = asNonEmptyString(entry["relativePath"]);
    const sizeBytes = entry["sizeBytes"];
    if (!attachmentId || !name || !mimeType || !relativePath) continue;
    if (!mimeType.toLowerCase().startsWith("image/")) continue;
    if (!isSafeAttachmentRelativePath(relativePath)) continue;
    attachments.push({
      attachmentId,
      name,
      mimeType,
      sizeBytes:
        typeof sizeBytes === "number" && Number.isFinite(sizeBytes) && sizeBytes >= 0
          ? Math.floor(sizeBytes)
          : 0,
      relativePath,
    });
  }
  return attachments;
}

/** Rejects absolute paths and `..` escapes; attachments stay inside the project. */
function isSafeAttachmentRelativePath(relativePath: string): boolean {
  const normalized = relativePath.trim().replace(/\\/g, "/");
  if (normalized.length === 0 || normalized.startsWith("/") || normalized.includes("\0")) {
    return false;
  }
  return !normalized.split("/").includes("..");
}

/** Comments are kept verbatim: their order and text are the task's history. */
function normalizeComments(value: unknown): Array<KanbanComment> {
  if (!Array.isArray(value)) return [];
  const comments: Array<KanbanComment> = [];
  for (const entry of value) {
    if (!isPlainRecord(entry)) continue;
    const body = typeof entry["body"] === "string" ? entry["body"] : "";
    const createdAt = asNonEmptyString(entry["createdAt"]);
    const commentId = asNonEmptyString(entry["commentId"]) ?? asNonEmptyString(entry["id"]);
    if (!commentId || !createdAt) continue;
    const author = entry["author"] === "user" ? "user" : "agent";
    const kind = entry["kind"] === "status" || entry["kind"] === "message" ? entry["kind"] : "note";
    const statusCode = normalizeCommentStatusCode(entry["statusCode"]);
    comments.push({
      commentId,
      author,
      kind,
      ...(statusCode ? { statusCode } : {}),
      body,
      createdAt,
    });
  }
  return comments;
}

export function normalizeCommentStatusCode(value: unknown): KanbanCommentStatusCode | null {
  if (typeof value !== "string") return null;
  const key = value.trim().toLowerCase();
  return key === "started" ||
    key === "done" ||
    key === "failed" ||
    key === "interrupted" ||
    key === "steered"
    ? key
    : null;
}

/** Appends a comment to a task; the caller owns persistence. */
export function appendStoredComment(
  task: KanbanStoredTask,
  input: {
    readonly author: KanbanCommentAuthor;
    readonly kind: KanbanCommentKind;
    readonly body: string;
    readonly statusCode?: KanbanCommentStatusCode | undefined;
    readonly now: string;
  },
): KanbanComment {
  const comment: KanbanComment = {
    commentId: newCommentId(),
    author: input.author,
    kind: input.kind,
    ...(input.statusCode ? { statusCode: input.statusCode } : {}),
    body: input.body.trim(),
    createdAt: input.now,
  };
  task.comments.push(comment);
  return comment;
}

function normalizeTask(value: unknown, fallbackTimestamp: string): KanbanStoredTask | null {
  if (!isPlainRecord(value)) return null;
  return {
    ...value,
    id: asNonEmptyString(value["id"]) ?? newTaskId(),
    title: typeof value["title"] === "string" ? value["title"] : "",
    description: typeof value["description"] === "string" ? value["description"].trim() : "",
    status: normalizeStatus(value["status"]),
    priority: normalizePriority(value["priority"]),
    pipeline: typeof value["pipeline"] === "string" ? value["pipeline"] : "",
    assignee: typeof value["assignee"] === "string" ? value["assignee"] : "",
    agentProvider: normalizeAgentProvider(value["agentProvider"]),
    agentModel: typeof value["agentModel"] === "string" ? value["agentModel"].trim() : "",
    attachments: normalizeAttachments(value["attachments"]),
    comments: normalizeComments(value["comments"]),
    agentThreadId: asNonEmptyString(value["agentThreadId"]) ?? "",
    agentRunStatus: normalizeAgentRunStatus(value["agentRunStatus"]),
    createdAt: asNonEmptyString(value["createdAt"]) ?? fallbackTimestamp,
    updatedAt: asNonEmptyString(value["updatedAt"]) ?? fallbackTimestamp,
  };
}

/** Normalize a parsed board.json (or an absent one) into the stored shape. */
export function normalizeBoardDocument(
  raw: unknown,
  input: { readonly projectId: string; readonly projectTitle: string; readonly now?: string },
): KanbanStoredBoard {
  const now = input.now ?? nowIso();
  const source = isPlainRecord(raw) ? raw : {};
  const tasks = Array.isArray(source["tasks"])
    ? source["tasks"]
        .map((task) => normalizeTask(task, now))
        .filter((task): task is KanbanStoredTask => task !== null)
    : [];

  return {
    ...source,
    version: typeof source["version"] === "number" ? source["version"] : 1,
    name: asNonEmptyString(source["name"]) ?? `${input.projectTitle} 看板`,
    projectId: asNonEmptyString(source["projectId"]) ?? input.projectId,
    columns: normalizeColumns(source["columns"]),
    tasks,
    createdAt: asNonEmptyString(source["createdAt"]) ?? now,
    updatedAt: asNonEmptyString(source["updatedAt"]) ?? now,
  };
}

export function findStoredTask(
  tasks: ReadonlyArray<KanbanStoredTask>,
  taskId: string,
): KanbanStoredTask | undefined {
  return tasks.find((task) => task.id === taskId);
}

/** Fixed status order, stable inside a column (file order is the manual order). */
export function sortStoredTasks(tasks: ReadonlyArray<KanbanStoredTask>): Array<KanbanStoredTask> {
  return tasks.toSorted(
    (left, right) => STATUS_ORDER.indexOf(left.status) - STATUS_ORDER.indexOf(right.status),
  );
}

/**
 * Move a task to `status` at `order` (0-based within the target column's
 * visible list); without an order the task is appended. Mirrors the plugin's
 * reorder so both surfaces agree on card order.
 */
export function reorderStoredTask(
  tasks: ReadonlyArray<KanbanStoredTask>,
  taskId: string,
  status: KanbanTaskStatus,
  order: number | undefined,
  now: string,
): Array<KanbanStoredTask> {
  const task = findStoredTask(tasks, taskId);
  if (!task) return [...tasks];

  const others = tasks.filter((entry) => entry.id !== taskId);
  const columnTasks = others.filter((entry) => entry.status === status);
  const position =
    order === undefined || order < 0 || order > columnTasks.length ? columnTasks.length : order;
  columnTasks.splice(position, 0, task);

  const result: Array<KanbanStoredTask> = [];
  let blockInserted = false;
  for (const entry of others) {
    if (entry.status === status) {
      if (!blockInserted) {
        result.push(...columnTasks);
        blockInserted = true;
      }
      continue;
    }
    result.push(entry);
  }
  if (!blockInserted) {
    result.push(...columnTasks);
  }

  task.status = status;
  task.updatedAt = now;
  return result;
}

export function createStoredTask(input: {
  readonly title: string;
  readonly description: string;
  readonly status: KanbanTaskStatus;
  readonly priority: KanbanTaskPriority;
  readonly pipeline: string;
  readonly assignee: string;
  readonly attachmentDescriptors?: ReadonlyArray<KanbanTaskAttachment>;
  readonly agentProvider?: string;
  readonly agentModel?: string;
  readonly now: string;
}): KanbanStoredTask {
  return {
    id: newTaskId(),
    title: input.title.trim(),
    description: input.description.trim(),
    status: input.status,
    priority: input.priority,
    pipeline: input.pipeline.trim(),
    assignee: input.assignee.trim(),
    agentProvider: normalizeAgentProvider(input.agentProvider),
    agentModel: (input.agentModel ?? "").trim(),
    agentThreadId: "",
    agentRunStatus: null,
    attachments: [...(input.attachmentDescriptors ?? [])],
    comments: [],
    createdAt: input.now,
    updatedAt: input.now,
  };
}

/**
 * A task is handed to an agent when it lands in 进行中 without a run already in
 * flight — a fresh move, a retry after a failure, or a re-run after a previous
 * run finished.
 */
export function taskNeedsAgentRun(task: KanbanStoredTask): boolean {
  return task.status === "in_progress" && task.agentRunStatus !== "running";
}

/**
 * The standing instructions every dispatched run gets, after the task's own text.
 *
 * A dispatched run has no user sitting in the conversation: nobody reads the thread while it
 * works, and nobody can answer a question. What the user *does* watch is the card, and the
 * card only shows what lands in its comments — so the two things this block has to establish
 * are "how work gets decided here" and "every finished step goes onto the card".
 *
 * The workflow itself is not restated in full: the system prompt carries it, along with the
 * skills that spell each stage out. This block only binds it to the board.
 */
export const BOARD_RUN_INSTRUCTIONS = [
  "---",
  "",
  "这是一张看板卡片派发出来的任务：没有用户在会话里等你，用户在**卡片**上看进度。",
  "",
  "1. **按流程推进**：先界定要做什么、怎么算做完，再拆步骤、小步实现、逐段验证，最后自查一遍。",
  "   标题或需求里没说清的地方，按最小合理假设定下来 —— 并在评论里写明你假设了什么。",
  "   系统提示里的工程流程与技能（`read_skill`）就是这套做法，到哪一步读哪个技能。",
  "2. **每完成一步就用 `kanban_comment` 在卡片上留一条评论**：这一步做完了什么、拿什么证明的",
  "   （改了哪些文件、跑了什么命令、输出是什么）、下一步做什么。一条日志，不是汇报。",
  "   会话里说了什么卡片上看不到 —— 只有写进评论的才留得下来。",
  "3. **别把回合耗在提问上**：用户在卡片那边，不一定开着会话。遇到需要人拍板的分叉，",
  "   选一个合理做法继续，并把分叉与选择写进评论；只有真的无法继续时才调用 ask_user。",
  "4. **不要自己改卡片状态**：任务进入已完成 / 已阻塞由这一轮的结果自动回写，",
  "   你只需要把过程与结论写清楚。",
  "5. 收尾时再留一条总结评论：做完的内容、验证结果与命令、遗留问题或没做的部分。",
].join("\n");

/**
 * Requirement handed to the agent: the task title, then the requirement body
 * when the user wrote one, then the board's standing instructions.
 */
export function buildTaskPrompt(task: {
  readonly title: string;
  readonly description: string;
  readonly attachments?: ReadonlyArray<KanbanTaskAttachment>;
}): string {
  const title = task.title.trim();
  const description = task.description.trim();
  const brief =
    description.length === 0
      ? title
      : title.length === 0
        ? description
        : `${title}\n\n${description}`;
  // The agent runs with the project workspace as its working directory, so the
  // workspace-relative attachment paths can be read straight from the prompt.
  const attachmentLines = (task.attachments ?? []).map(
    (attachment) =>
      `- ${attachment.relativePath}${attachment.name ? `（${attachment.name}）` : ""}`,
  );
  const attachmentBlock =
    attachmentLines.length === 0
      ? ""
      : `需求附带图片（相对项目根目录，可用 read 工具查看）：\n${attachmentLines.join("\n")}`;
  const withAttachments =
    attachmentBlock.length === 0
      ? brief
      : brief.length === 0
        ? attachmentBlock
        : `${brief}\n\n${attachmentBlock}`;
  // A card with no text at all still gets the standing instructions: they are what makes the
  // run comment on the board, and a title-less task is exactly when that matters most.
  return withAttachments.length === 0
    ? BOARD_RUN_INSTRUCTIONS
    : `${withAttachments}\n\n${BOARD_RUN_INSTRUCTIONS}`;
}

/** Terminal task status for a finished agent run. */
export function taskStatusForRunOutcome(
  runStatus: Exclude<KanbanAgentRunStatus, "running">,
): KanbanTaskStatus {
  switch (runStatus) {
    case "done":
      return "done";
    case "failed":
      return "blocked";
    case "interrupted":
      return "todo";
  }
}

/** Maps a finished checkpoint back onto the run outcome it represents. */
export function runOutcomeForCheckpointStatus(
  status: "ready" | "missing" | "error",
): Exclude<KanbanAgentRunStatus, "running"> {
  switch (status) {
    case "ready":
      return "done";
    case "error":
      return "failed";
    case "missing":
      return "interrupted";
  }
}

export interface KanbanStatusCounts {
  readonly taskCount: number;
  readonly todoCount: number;
  readonly inProgressCount: number;
  readonly doneCount: number;
  readonly blockedCount: number;
}

export function countTasksByStatus(tasks: ReadonlyArray<KanbanStoredTask>): KanbanStatusCounts {
  const countOf = (status: KanbanTaskStatus) =>
    tasks.filter((task) => task.status === status).length;
  return {
    taskCount: tasks.length,
    todoCount: countOf("todo"),
    inProgressCount: countOf("in_progress"),
    doneCount: countOf("done"),
    blockedCount: countOf("blocked"),
  };
}

function toKanbanTask(task: KanbanStoredTask): KanbanTask {
  return {
    taskId: KanbanTaskId.makeUnsafe(task.id),
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    pipeline: task.pipeline,
    assignee: task.assignee,
    agentProvider: normalizeAgentProvider(task.agentProvider),
    agentModel: task.agentModel,
    agentThreadId: task.agentThreadId ? ThreadId.makeUnsafe(task.agentThreadId) : null,
    agentRunStatus: task.agentRunStatus,
    attachments: [...(task.attachments ?? [])],
    comments: [...task.comments],
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

export function toKanbanBoard(board: KanbanStoredBoard, context: KanbanBoardContext): KanbanBoard {
  return {
    projectId: context.projectId,
    projectTitle: context.projectTitle,
    workspaceRoot: context.workspaceRoot,
    boardFilePath: context.boardFilePath,
    columns: [...board.columns],
    tasks: sortStoredTasks(board.tasks).map(toKanbanTask),
    updatedAt: board.updatedAt,
  };
}
