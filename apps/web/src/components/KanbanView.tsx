// FILE: KanbanView.tsx
// Purpose: Full-page kanban board for a project's .kanban/board.json. Mirrors
//          the standalone 看板 plugin: four columns, task cards with priority /
//          pipeline / assignee, drag-and-drop, and a project picker that scans
//          every project for work in flight.
// Layer: Component
// Exports: KanbanView

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  type KanbanAgentRunStatus,
  type KanbanProjectSummary,
  type KanbanTask,
  type KanbanTaskId,
  type KanbanTaskPriority,
  type KanbanTaskStatus,
  type ProjectId,
} from "@peakcode/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useMessages } from "../i18n/I18nContext";
import { persistKanbanProjectId, readKanbanProjectId } from "../kanbanUiState";
import { dropIndexFromMiddles, resolveDropIndex } from "../lib/kanbanDrag";
import {
  useKanbanBoardQuery,
  useKanbanMoveTaskMutation,
  useKanbanProjectsQuery,
} from "../lib/kanbanReactQuery";
import {
  CheckIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  FolderIcon,
  LoaderIcon,
  PlusIcon,
} from "../lib/icons";
import { cn } from "../lib/utils";
import { useLatestProjectStore } from "../latestProjectStore";
import { formatRelativeTime } from "./Sidebar";
import { SidebarInset } from "./ui/sidebar";

const COLUMN_DOT_FALLBACK: Record<KanbanTaskStatus, string> = {
  todo: "#9CA3AF",
  in_progress: "#3B82F6",
  done: "#22C55E",
  blocked: "#EF4444",
  archived: "#6B7280",
};

const PRIORITY_CLASS: Record<KanbanTaskPriority, string> = {
  high: "bg-destructive/12 text-destructive",
  medium: "bg-warning/15 text-warning",
  low: "bg-muted text-muted-foreground",
};

const RUN_STATUS_CLASS: Record<KanbanAgentRunStatus, string> = {
  running: "text-info",
  done: "text-success",
  failed: "text-destructive",
  interrupted: "text-muted-foreground",
};

/** Fresh per-status buckets; a shared value would leak tasks across columns. */
const statusGroup = <T,>(makeValue: () => T): Record<KanbanTaskStatus, T> => ({
  todo: makeValue(),
  in_progress: makeValue(),
  done: makeValue(),
  blocked: makeValue(),
  archived: makeValue(),
});

const AVATAR_COLORS = ["#F59E0B", "#3B82F6", "#10B981", "#8B5CF6", "#EF4444", "#0EA5E9", "#F97316"];

const avatarColorFor = (name: string): string => {
  let sum = 0;
  for (let index = 0; index < name.length; index += 1) {
    sum += name.charCodeAt(index);
  }
  return AVATAR_COLORS[sum % AVATAR_COLORS.length]!;
};

/** `~`-shortened path for display; the full path lives in the tooltip. */
const shortPath = (value: string): string => {
  const match = /^\/Users\/[^/]+\/(.*)$/.exec(value);
  return match ? `~/${match[1]}` : value;
};

type DropTarget = {
  readonly status: KanbanTaskStatus;
  readonly index: number;
};

/** Pointer slot inside a column, measured against the rendered card midpoints. */
function dropIndexFor(container: HTMLElement, clientY: number): number {
  const cardMiddles = Array.from(
    container.querySelectorAll<HTMLElement>("[data-kanban-card]"),
    (card) => card.getBoundingClientRect(),
  ).map((rect) => rect.top + rect.height / 2);
  return dropIndexFromMiddles(cardMiddles, clientY);
}

export function KanbanView() {
  const messages = useMessages();
  const navigate = useNavigate();
  const projectsQuery = useKanbanProjectsQuery();
  const projects = useMemo(() => projectsQuery.data?.projects ?? [], [projectsQuery.data]);
  const latestProjectId = useLatestProjectStore((state) => state.latestProjectId);

  const [selectedProjectId, setSelectedProjectId] = useState<ProjectId | null>(
    () => (readKanbanProjectId() as ProjectId | null) ?? null,
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const draggingTaskIdRef = useRef<KanbanTaskId | null>(null);

  // Keep the selection valid as projects come and go, preferring the project
  // the user was last working in.
  useEffect(() => {
    if (projects.length === 0) return;
    const known = projects.some((project) => project.projectId === selectedProjectId);
    if (known) return;
    const preferred =
      projects.find((project) => project.projectId === latestProjectId) ??
      projects.find((project) => project.projectId === readKanbanProjectId()) ??
      projects[0]!;
    setSelectedProjectId(preferred.projectId);
  }, [latestProjectId, projects, selectedProjectId]);

  const boardQuery = useKanbanBoardQuery(selectedProjectId);
  const board = boardQuery.data ?? null;
  const moveTask = useKanbanMoveTaskMutation();

  const selectedSummary = useMemo(
    () => projects.find((project) => project.projectId === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );

  const selectProject = useCallback((projectId: ProjectId) => {
    setSelectedProjectId(projectId);
    persistKanbanProjectId(projectId);
    setPickerOpen(false);
  }, []);

  const tasksByStatus = useMemo(() => {
    const groups = statusGroup<KanbanTask[]>(() => []);
    for (const task of board?.tasks ?? []) {
      groups[task.status].push(task);
    }
    return groups;
  }, [board]);

  const statusCounts = useMemo(() => {
    const counts = statusGroup<number>(() => 0);
    for (const task of board?.tasks ?? []) {
      counts[task.status] += 1;
    }
    return counts;
  }, [board]);

  const columnLabel = useCallback(
    (status: KanbanTaskStatus): string =>
      status === "in_progress"
        ? messages.kanban.columns.inProgress
        : messages.kanban.columns[status],
    [messages],
  );

  const runStatusLabel = useCallback(
    (status: KanbanAgentRunStatus): string =>
      status === "running"
        ? messages.kanban.agentRunRunning
        : status === "done"
          ? messages.kanban.agentRunDone
          : status === "failed"
            ? messages.kanban.agentRunFailed
            : messages.kanban.agentRunInterrupted,
    [messages],
  );

  /**
   * Creation is a full page: the dialog was small and easy to dismiss with a
   * stray backdrop click. The clicked column travels along as the initial status.
   */
  const openCreatePage = useCallback(
    (status: KanbanTaskStatus) => {
      if (!selectedProjectId) return;
      void navigate({ to: "/kanban/new", search: { project: selectedProjectId, status } });
    },
    [navigate, selectedProjectId],
  );

  /**
   * A tracked task carries requirements, comments and run history, so it opens
   * as a full page rather than inside the create/edit dialog.
   */
  const openTaskDetail = useCallback(
    (task: KanbanTask) => {
      if (!selectedProjectId) return;
      void navigate({
        to: "/kanban/$taskId",
        params: { taskId: task.taskId },
        search: { project: selectedProjectId },
      });
    },
    [navigate, selectedProjectId],
  );

  useEffect(() => {
    if (!pickerOpen) return;
    const onPointerDown = () => setPickerOpen(false);
    window.addEventListener("click", onPointerDown);
    return () => window.removeEventListener("click", onPointerDown);
  }, [pickerOpen]);

  const handleDragOver = (status: KanbanTaskStatus) => (event: DragEvent<HTMLDivElement>) => {
    if (!draggingTaskIdRef.current) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const index = dropIndexFor(event.currentTarget, event.clientY);
    setDropTarget((previous) =>
      previous && previous.status === status && previous.index === index
        ? previous
        : { status, index },
    );
  };

  const handleDrop = (status: KanbanTaskStatus) => (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDropTarget(null);
    const taskId = draggingTaskIdRef.current;
    draggingTaskIdRef.current = null;
    if (!taskId || !selectedProjectId) return;

    const columnTasks = tasksByStatus[status];
    const rawIndex = dropIndexFor(event.currentTarget, event.clientY);
    const task = board?.tasks.find((entry) => entry.taskId === taskId) ?? null;
    const originalIndex =
      task && task.status === status
        ? columnTasks.findIndex((entry) => entry.taskId === taskId)
        : -1;
    const index = resolveDropIndex({
      rawIndex,
      originalIndex: originalIndex >= 0 ? originalIndex : null,
    });

    moveTask.mutate({ projectId: selectedProjectId, taskId, status, order: index });
  };

  const renderCard = (task: KanbanTask) => {
    const avatarName = task.assignee || task.pipeline || "?";
    const isDragging = draggingTaskIdRef.current === task.taskId;
    const runStatus = task.agentRunStatus;
    return (
      <article
        key={task.taskId}
        data-kanban-card
        draggable
        onDragStart={(event) => {
          draggingTaskIdRef.current = task.taskId;
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", task.taskId);
        }}
        onDragEnd={() => {
          draggingTaskIdRef.current = null;
          setDropTarget(null);
        }}
        onClick={() => openTaskDetail(task)}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          openTaskDetail(task);
        }}
        className={cn(
          "cursor-pointer rounded-xl border border-border/50 bg-card/70 px-3 py-2.5 transition-colors",
          "hover:border-border hover:bg-accent/40",
          isDragging && "opacity-50",
        )}
      >
        <div className="flex items-start gap-2">
          <span
            className={cn(
              "mt-px shrink-0 rounded px-1.5 py-0.5 text-[10px] leading-4 font-medium",
              PRIORITY_CLASS[task.priority],
            )}
          >
            {messages.kanban.priorities[task.priority]}
          </span>
          <span className="min-w-0 flex-1 text-[13px] leading-snug break-words text-foreground">
            {task.title}
          </span>
          {runStatus ? (
            <span
              className={cn("mt-px shrink-0", RUN_STATUS_CLASS[runStatus])}
              title={`${messages.kanban.agentRun} · ${runStatusLabel(runStatus)}`}
              data-kanban-agent-run={runStatus}
            >
              {runStatus === "running" ? (
                <LoaderIcon className="size-3.5 animate-spin" />
              ) : runStatus === "done" ? (
                <CheckIcon className="size-3.5" />
              ) : (
                <CircleAlertIcon className="size-3.5" />
              )}
            </span>
          ) : null}
        </div>
        {task.description ? (
          <p
            className="mt-1.5 line-clamp-2 text-[11.5px] leading-relaxed whitespace-pre-wrap text-muted-foreground/85"
            title={task.description}
          >
            {task.description}
          </p>
        ) : null}
        <div className="mt-2 h-px bg-border/40" />
        <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground/80">
          <span
            className="inline-flex size-4 shrink-0 items-center justify-center rounded-full text-[9px] font-medium text-white/95"
            style={{ backgroundColor: avatarColorFor(avatarName) }}
            title={avatarName}
          >
            {avatarName.slice(0, 1).toUpperCase()}
          </span>
          {task.pipeline ? <span className="truncate">{task.pipeline}</span> : null}
          {task.comments.length > 0 ? (
            <span
              className="shrink-0 text-muted-foreground/70"
              title={messages.kanban.detail.commentCount(task.comments.length)}
              data-kanban-comment-count={task.comments.length}
            >
              {task.comments.length}
            </span>
          ) : null}
          {task.updatedAt ? (
            <span className="ml-auto shrink-0" title={task.updatedAt}>
              {messages.kanban.updatedLabel} {formatRelativeTime(task.updatedAt)}
            </span>
          ) : null}
        </div>
      </article>
    );
  };

  const renderBoard = () => {
    if (projectsQuery.isPending || (projects.length > 0 && !board)) {
      return (
        <div className="mx-auto flex w-full max-w-2xl flex-col items-center text-center">
          <LoaderIcon className="size-7 text-muted-foreground/70 animate-spin" />
          <p className="mt-4 text-[13px] text-muted-foreground/85">{messages.kanban.loading}</p>
        </div>
      );
    }

    if (projects.length === 0) {
      return (
        <div className="mx-auto flex w-full max-w-2xl flex-col items-center text-center">
          <div className="mb-6 flex size-16 items-center justify-center rounded-full border border-border/60 bg-background/60">
            <FolderIcon className="size-7 text-muted-foreground/70" />
          </div>
          <h2 className="text-[20px] font-semibold text-foreground">
            {messages.kanban.noProjectsTitle}
          </h2>
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground/85">
            {messages.kanban.noProjectsDescription}
          </p>
        </div>
      );
    }

    if (!board) return null;

    return (
      <div className="flex h-full min-h-0 gap-3 overflow-x-auto pb-2">
        {board.columns.map((column) => {
          const status = column.key;
          const columnTasks = tasksByStatus[status];
          const dot = column.dot || COLUMN_DOT_FALLBACK[status];
          const indicatorIndex = dropTarget?.status === status ? dropTarget.index : null;
          return (
            <section
              key={status}
              className="flex h-full min-h-0 w-[286px] shrink-0 flex-col rounded-2xl border border-border/50 bg-[var(--color-background-panel)]"
            >
              <header className="flex shrink-0 items-center gap-2 px-3 py-2.5">
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: dot }}
                  aria-hidden
                />
                <span className="text-[12px] font-medium text-foreground">
                  {columnLabel(status)}
                </span>
                <span className="rounded-full bg-accent/50 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {columnTasks.length}
                </span>
                <button
                  type="button"
                  aria-label={`${messages.kanban.addTask} · ${columnLabel(status)}`}
                  className="ml-auto inline-flex size-6 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-accent/60 hover:text-foreground"
                  onClick={() => openCreatePage(status)}
                >
                  <PlusIcon className="size-3.5" />
                </button>
              </header>
              <div
                data-kanban-column={status}
                className={cn(
                  "flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2",
                  indicatorIndex !== null && "rounded-b-2xl bg-accent/20",
                )}
                onDragOver={handleDragOver(status)}
                onDragLeave={(event) => {
                  if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
                  setDropTarget((previous) => (previous?.status === status ? null : previous));
                }}
                onDrop={handleDrop(status)}
              >
                {columnTasks.length === 0 && indicatorIndex === null ? (
                  <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-border/50 py-8 text-[12px] text-muted-foreground/60">
                    {messages.kanban.noTasks}
                  </div>
                ) : null}
                {columnTasks.map((task, index) => (
                  <div key={task.taskId} className="flex flex-col gap-2">
                    {indicatorIndex === index ? (
                      <span className="h-0.5 rounded-full bg-primary/70" aria-hidden />
                    ) : null}
                    {renderCard(task)}
                  </div>
                ))}
                {indicatorIndex !== null && indicatorIndex >= columnTasks.length ? (
                  <span className="h-0.5 rounded-full bg-primary/70" aria-hidden />
                ) : null}
              </div>
            </section>
          );
        })}
      </div>
    );
  };

  const renderPickerMenu = () => (
    <div className="absolute top-full z-40 mt-1 w-[320px] overflow-hidden rounded-xl border border-border/60 bg-popover shadow-lg">
      <div className="border-b border-border/50 px-3 py-2 text-[11px] font-medium tracking-wider text-muted-foreground/70 uppercase">
        {messages.kanban.project}
      </div>
      <div className="max-h-[320px] overflow-y-auto py-1">
        {projects.map((project: KanbanProjectSummary) => {
          const active = project.projectId === selectedProjectId;
          return (
            <button
              key={project.projectId}
              type="button"
              onClick={() => selectProject(project.projectId)}
              className={cn(
                "flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-accent/50",
                active && "bg-accent/40",
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] text-foreground">
                  {project.title}
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-muted-foreground/70">
                  {shortPath(project.workspaceRoot)}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1.5 pt-0.5 text-[10.5px] text-muted-foreground/80">
                {project.inProgressCount > 0 ? (
                  <span className="rounded-full bg-info/15 px-1.5 py-0.5 text-info">
                    {messages.kanban.columns.inProgress} {project.inProgressCount}
                  </span>
                ) : null}
                {project.blockedCount > 0 ? (
                  <span className="rounded-full bg-destructive/12 px-1.5 py-0.5 text-destructive">
                    {messages.kanban.columns.blocked} {project.blockedCount}
                  </span>
                ) : null}
                {project.inProgressCount === 0 && project.blockedCount === 0 ? (
                  <span>
                    {project.taskCount}/{project.doneCount}
                  </span>
                ) : null}
              </span>
              {active ? <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-foreground" /> : null}
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden isolate">
      <div className="flex h-full min-h-0 flex-col bg-background">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border/60 px-6 py-4">
          <div className="min-w-0">
            <h1 className="truncate text-[20px] font-semibold text-foreground">
              {messages.sidebar.kanbanLabel}
            </h1>
            <p className="mt-0.5 truncate text-[13px] text-muted-foreground/80">
              {messages.kanban.subtitle}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <div className="relative">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setPickerOpen((previous) => !previous);
                }}
                className="inline-flex h-8 max-w-[260px] items-center gap-2 rounded-md border border-border/60 bg-background/60 px-3 text-[12px] text-foreground/80 transition-colors hover:bg-accent/40"
              >
                <FolderIcon className="size-3.5 shrink-0 text-muted-foreground/70" />
                <span className="truncate">
                  {selectedSummary?.title ?? messages.kanban.selectProject}
                </span>
                <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground/70" />
              </button>
              {pickerOpen ? renderPickerMenu() : null}
            </div>
            <button
              type="button"
              onClick={() => openCreatePage("todo")}
              disabled={!selectedProjectId}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-foreground/90 px-3 text-[12px] font-medium text-background transition-colors hover:bg-foreground disabled:cursor-not-allowed disabled:opacity-60"
            >
              <PlusIcon className="size-3.5" />
              {messages.kanban.addTask}
            </button>
          </div>
        </header>

        {board ? (
          <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-border/40 px-6 py-2 text-[11.5px] text-muted-foreground/85">
            {board.columns.map((column) => (
              <span key={column.key} className="inline-flex items-center gap-1.5">
                <span
                  className="size-1.5 rounded-full"
                  style={{ backgroundColor: column.dot || COLUMN_DOT_FALLBACK[column.key] }}
                  aria-hidden
                />
                {columnLabel(column.key)}
                <span className="font-medium text-foreground/80">{statusCounts[column.key]}</span>
              </span>
            ))}
            <span
              className="ml-auto truncate text-[11px] text-muted-foreground/60"
              title={board.boardFilePath}
            >
              {messages.kanban.boardFileLabel} {shortPath(board.boardFilePath)}
            </span>
          </div>
        ) : null}

        <div className="flex min-h-0 flex-1 flex-col px-6 py-4">
          {boardQuery.isError && !board ? (
            <div className="mx-auto flex w-full max-w-2xl flex-col items-center text-center">
              <p className="text-[13px] text-destructive">{boardQuery.error.message}</p>
            </div>
          ) : (
            renderBoard()
          )}
        </div>
      </div>
    </SidebarInset>
  );
}
