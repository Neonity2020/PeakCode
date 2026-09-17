// FILE: KanbanView.tsx
// Purpose: Full-page kanban board for a project's .kanban/board.json: the board's
//          own left menu (projects, status / priority / agent-run filters), a
//          searchable toolbar, and the work itself either as status columns with
//          drag-and-drop or as a scannable list.
// Layer: Component
// Exports: KanbanView

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  type KanbanBoard,
  type KanbanTask,
  type KanbanTaskId,
  type KanbanTaskStatus,
  type ProjectId,
} from "@peakcode/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useMessages } from "../i18n/I18nContext";
import { readKanbanUiState, persistKanbanUiState, type KanbanUiState } from "../kanbanUiState";
import { dropIndexFromMiddles, resolveDropIndex } from "../lib/kanbanDrag";
import {
  KANBAN_FILTERS_EMPTY,
  filterKanbanTasks,
  isKanbanFilterActive,
  type KanbanFilterState,
} from "../lib/kanbanFilters";
import {
  KANBAN_STATUS_ORDER,
  kanbanColumnAccent,
  kanbanProjectCode,
  kanbanStatusLabel,
  shortWorkspacePath,
} from "../lib/kanbanPresentation";
import {
  useKanbanBoardQuery,
  useKanbanMoveTaskMutation,
  useKanbanProjectsQuery,
} from "../lib/kanbanReactQuery";
import {
  ChevronRightIcon,
  FilterIcon,
  FolderIcon,
  KanbanIcon,
  ListIcon,
  LoaderIcon,
  PanelLeftIcon,
  PlusIcon,
  SearchIcon,
  XIcon,
} from "../lib/icons";
import { cn } from "../lib/utils";
import { useLatestProjectStore } from "../latestProjectStore";
import { KanbanSidebar } from "./KanbanSidebar";
import { KanbanStatusGlyph } from "./KanbanPresentation";
import { KanbanTaskCard, KanbanTaskRow } from "./KanbanTaskCard";
import { SidebarInset } from "./ui/sidebar";

type DropTarget = {
  readonly status: KanbanTaskStatus;
  readonly index: number;
};

/** Fresh per-status buckets; a shared value would leak tasks across columns. */
const statusGroup = <T,>(makeValue: () => T): Record<KanbanTaskStatus, T> => ({
  todo: makeValue(),
  in_progress: makeValue(),
  done: makeValue(),
  blocked: makeValue(),
  archived: makeValue(),
});

/** Pointer slot inside a column, measured against the rendered card midpoints. */
function dropIndexFor(container: HTMLElement, clientY: number): number {
  const cardMiddles = Array.from(
    container.querySelectorAll<HTMLElement>("[data-kanban-card]"),
    (card) => card.getBoundingClientRect(),
  ).map((rect) => rect.top + rect.height / 2);
  return dropIndexFromMiddles(cardMiddles, clientY);
}

/** Column order the board uses: its own file order, or the standard statuses. */
function boardColumnKeys(board: KanbanBoard): ReadonlyArray<KanbanTaskStatus> {
  if (board.columns.length > 0) return board.columns.map((column) => column.key);
  return KANBAN_STATUS_ORDER;
}

export function KanbanView() {
  const messages = useMessages();
  const navigate = useNavigate();
  const projectsQuery = useKanbanProjectsQuery();
  const projects = useMemo(() => projectsQuery.data?.projects ?? [], [projectsQuery.data]);
  const latestProjectId = useLatestProjectStore((state) => state.latestProjectId);

  const [uiState, setUiState] = useState<KanbanUiState>(() => readKanbanUiState());
  const selectedProjectId = (uiState.selectedProjectId as ProjectId | null) ?? null;
  const [filters, setFilters] = useState<KanbanFilterState>(KANBAN_FILTERS_EMPTY);
  const [search, setSearch] = useState("");
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const draggingTaskIdRef = useRef<KanbanTaskId | null>(null);

  const updateUiState = useCallback((patch: Partial<KanbanUiState>) => {
    setUiState((previous) => ({ ...previous, ...patch }));
    persistKanbanUiState(patch);
  }, []);

  // Keep the selection valid as projects come and go, preferring the project
  // the user was last working in.
  useEffect(() => {
    if (projects.length === 0) return;
    const known = projects.some((project) => project.projectId === selectedProjectId);
    if (known) return;
    const preferred =
      projects.find((project) => project.projectId === latestProjectId) ??
      projects.find((project) => project.projectId === uiState.selectedProjectId) ??
      projects[0]!;
    updateUiState({ selectedProjectId: preferred.projectId });
  }, [latestProjectId, projects, selectedProjectId, uiState.selectedProjectId, updateUiState]);

  const boardQuery = useKanbanBoardQuery(selectedProjectId);
  const board = boardQuery.data ?? null;
  const moveTask = useKanbanMoveTaskMutation();

  const selectedSummary = useMemo(
    () => projects.find((project) => project.projectId === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );

  const projectCode = useMemo(
    () => kanbanProjectCode(board?.projectTitle ?? selectedSummary?.title ?? ""),
    [board?.projectTitle, selectedSummary?.title],
  );

  /** Column colour per status, so cards and column headers agree with the board. */
  const accentByStatus = useMemo(() => {
    const accents = new Map<KanbanTaskStatus, string>();
    for (const column of board?.columns ?? []) {
      accents.set(column.key, kanbanColumnAccent(column.key, column.dot));
    }
    for (const status of KANBAN_STATUS_ORDER) {
      if (!accents.has(status)) accents.set(status, kanbanColumnAccent(status));
    }
    return accents;
  }, [board]);

  const selectProject = useCallback(
    (projectId: ProjectId) => {
      updateUiState({ selectedProjectId: projectId });
    },
    [updateUiState],
  );

  const filtersActive = isKanbanFilterActive(filters) || search.trim().length > 0;

  const visibleTasks = useMemo(
    () => filterKanbanTasks(board?.tasks ?? [], filters, search, projectCode),
    [board, filters, search, projectCode],
  );

  const tasksByStatus = useMemo(() => {
    const groups = statusGroup<KanbanTask[]>(() => []);
    for (const task of visibleTasks) {
      groups[task.status].push(task);
    }
    return groups;
  }, [visibleTasks]);

  const clearFilters = useCallback(() => {
    setFilters(KANBAN_FILTERS_EMPTY);
    setSearch("");
  }, []);

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

  const handleDragEnd = useCallback(() => {
    draggingTaskIdRef.current = null;
    setDropTarget(null);
  }, []);

  /**
   * A drop lands between two *visible* cards. Filters can hide cards, so the
   * slot is translated back into an order over the whole column: the card the
   * drop pushes down keeps its neighbour's place in the unfiltered list.
   */
  const resolveServerOrder = useCallback(
    (taskId: KanbanTaskId, status: KanbanTaskStatus, rawIndex: number): number => {
      const columnTasks = (board?.tasks ?? []).filter((entry) => entry.status === status);
      const visibleColumn = tasksByStatus[status];
      const fullOthers = columnTasks.filter((entry) => entry.taskId !== taskId);
      const visibleOthers = visibleColumn.filter((entry) => entry.taskId !== taskId);
      const originalIndex = visibleColumn.findIndex((entry) => entry.taskId === taskId);
      const rawOthers = resolveDropIndex({
        rawIndex,
        originalIndex: originalIndex >= 0 ? originalIndex : null,
      });
      const anchor = visibleOthers[rawOthers];
      if (!anchor) return fullOthers.length;
      const anchorIndex = fullOthers.findIndex((entry) => entry.taskId === anchor.taskId);
      return anchorIndex >= 0 ? anchorIndex : fullOthers.length;
    },
    [board, tasksByStatus],
  );

  const handleDrop = (status: KanbanTaskStatus) => (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const taskId = draggingTaskIdRef.current;
    setDropTarget(null);
    draggingTaskIdRef.current = null;
    if (!taskId || !selectedProjectId) return;

    const rawIndex = dropIndexFor(event.currentTarget, event.clientY);
    const order = resolveServerOrder(taskId, status, rawIndex);
    moveTask.mutate({ projectId: selectedProjectId, taskId, status, order });
  };

  const handleDragStart = useCallback((task: KanbanTask, event: DragEvent<HTMLElement>) => {
    draggingTaskIdRef.current = task.taskId;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", task.taskId);
  }, []);

  const renderColumnHeader = (status: KanbanTaskStatus, count: number) => (
    <header className="flex shrink-0 items-center gap-2 px-3 py-2.5">
      <KanbanStatusGlyph status={status} color={accentByStatus.get(status)} />
      {/* The board file names its columns in the plugin's language; the header
          follows the UI language so one screen never mixes both. */}
      <span className="truncate text-[12px] font-medium text-foreground">
        {kanbanStatusLabel(messages, status)}
      </span>
      <span className="rounded-full bg-accent/50 px-1.5 text-[10px] tabular-nums text-muted-foreground">
        {count}
      </span>
      <button
        type="button"
        aria-label={`${messages.kanban.addTask} · ${kanbanStatusLabel(messages, status)}`}
        className="ml-auto inline-flex size-6 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-accent/60 hover:text-foreground"
        onClick={() => openCreatePage(status)}
      >
        <PlusIcon className="size-3.5" />
      </button>
    </header>
  );

  const renderBoard = (current: KanbanBoard) => (
    <div className="flex h-full min-h-0 gap-3 overflow-x-auto pb-2">
      {boardColumnKeys(current).map((status) => {
        const columnTasks = tasksByStatus[status];
        const indicatorIndex = dropTarget?.status === status ? dropTarget.index : null;
        return (
          <section
            key={status}
            data-kanban-column-section={status}
            className="flex h-full min-h-0 w-[286px] shrink-0 flex-col rounded-2xl border border-border/50 bg-[var(--color-background-panel)]"
          >
            {renderColumnHeader(status, columnTasks.length)}
            <div className="mx-3 h-px shrink-0 bg-border/40" />
            <div
              data-kanban-column={status}
              className={cn(
                "flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pt-2 pb-2",
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
                  {filtersActive ? messages.kanban.noMatchesColumn : messages.kanban.noTasks}
                </div>
              ) : null}
              {columnTasks.map((task, index) => (
                <div key={task.taskId} className="flex flex-col gap-2">
                  {indicatorIndex === index ? (
                    <span className="h-0.5 rounded-full bg-primary/70" aria-hidden />
                  ) : null}
                  <KanbanTaskCard
                    task={task}
                    projectCode={projectCode}
                    statusAccent={accentByStatus.get(status) ?? ""}
                    isDragging={draggingTaskIdRef.current === task.taskId}
                    onOpen={openTaskDetail}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                  />
                </div>
              ))}
              {indicatorIndex !== null && indicatorIndex >= columnTasks.length ? (
                <span className="h-0.5 rounded-full bg-primary/70" aria-hidden />
              ) : null}
              <button
                type="button"
                onClick={() => openCreatePage(status)}
                aria-label={messages.kanban.addTaskIn(kanbanStatusLabel(messages, status))}
                data-kanban-column-new-task={status}
                className="mt-auto inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-xl px-2 text-[12px] text-muted-foreground/60 transition-colors hover:bg-accent/40 hover:text-foreground"
              >
                <PlusIcon className="size-3.5 shrink-0" />
                {messages.kanban.addTask}
              </button>
            </div>
          </section>
        );
      })}
    </div>
  );

  const renderList = (current: KanbanBoard) => (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col gap-5 overflow-y-auto pb-2">
      {boardColumnKeys(current).map((status) => {
        const columnTasks = tasksByStatus[status];
        if (columnTasks.length === 0) return null;
        return (
          <section key={status} data-kanban-list-group={status} className="flex flex-col gap-1">
            <header className="flex items-center gap-2 px-3 pb-1">
              <KanbanStatusGlyph status={status} color={accentByStatus.get(status)} />
              <span className="text-[12px] font-medium text-foreground">
                {kanbanStatusLabel(messages, status)}
              </span>
              <span className="rounded-full bg-accent/50 px-1.5 text-[10px] tabular-nums text-muted-foreground">
                {columnTasks.length}
              </span>
              <button
                type="button"
                aria-label={`${messages.kanban.addTask} · ${kanbanStatusLabel(messages, status)}`}
                className="ml-auto inline-flex size-6 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-accent/60 hover:text-foreground"
                onClick={() => openCreatePage(status)}
              >
                <PlusIcon className="size-3.5" />
              </button>
            </header>
            <div className="flex flex-col rounded-xl border border-border/50 bg-[var(--color-background-panel)] p-1">
              {columnTasks.map((task) => (
                <KanbanTaskRow
                  key={task.taskId}
                  task={task}
                  projectCode={projectCode}
                  statusAccent={accentByStatus.get(status) ?? ""}
                  onOpen={openTaskDetail}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );

  const renderContent = () => {
    if (projectsQuery.isPending || (projects.length > 0 && !board)) {
      return (
        <div className="mx-auto flex w-full max-w-2xl flex-col items-center text-center">
          <LoaderIcon className="size-7 animate-spin text-muted-foreground/70" />
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

    if (boardQuery.isError && !board) {
      return (
        <div className="mx-auto flex w-full max-w-2xl flex-col items-center text-center">
          <p className="text-[13px] text-destructive">{boardQuery.error.message}</p>
        </div>
      );
    }

    if (!board) return null;

    if (filtersActive && visibleTasks.length === 0) {
      return (
        <div className="mx-auto flex w-full max-w-2xl flex-col items-center text-center">
          <div className="mb-5 flex size-14 items-center justify-center rounded-full border border-border/60 bg-background/60">
            <FilterIcon className="size-6 text-muted-foreground/70" />
          </div>
          <h2 className="text-[17px] font-semibold text-foreground">{messages.kanban.noMatches}</h2>
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground/85">
            {messages.kanban.noMatchesDescription}
          </p>
          <button
            type="button"
            onClick={clearFilters}
            className="mt-4 inline-flex h-8 items-center rounded-md border border-border/60 bg-background/60 px-3 text-[12px] text-foreground/80 transition-colors hover:bg-accent/40"
          >
            {messages.kanban.clearFilters}
          </button>
        </div>
      );
    }

    return uiState.viewMode === "list" ? renderList(board) : renderBoard(board);
  };

  const renderToolbar = () => (
    <header className="flex shrink-0 items-center gap-3 border-b border-border/60 px-5 py-3">
      {uiState.sidebarVisible ? null : (
        <button
          type="button"
          onClick={() => updateUiState({ sidebarVisible: true })}
          aria-label={messages.kanban.showSidebar}
          title={messages.kanban.showSidebar}
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-accent/50 hover:text-foreground"
        >
          <PanelLeftIcon className="size-4" />
        </button>
      )}
      <div className="flex min-w-0 items-center gap-1.5 text-[12px] text-muted-foreground/70">
        <KanbanIcon className="size-3.5 shrink-0" />
        <span className="shrink-0">{messages.sidebar.kanbanLabel}</span>
        <ChevronRightIcon className="size-3 shrink-0 text-muted-foreground/40" />
        <span className="truncate text-foreground" title={selectedSummary?.workspaceRoot}>
          {selectedSummary?.title ?? messages.kanban.selectProject}
        </span>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label={messages.kanban.searchPlaceholder}
            placeholder={messages.kanban.searchPlaceholder}
            data-kanban-search
            className="h-8 w-[180px] rounded-md border border-border/60 bg-background/60 pr-6 pl-7 text-[12px] text-foreground outline-hidden placeholder:text-muted-foreground/50 focus-visible:ring-1 focus-visible:ring-ring"
          />
          {search.length > 0 ? (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label={messages.kanban.clearSearch}
              className="absolute top-1/2 right-1.5 inline-flex size-4 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground/60 transition-colors hover:text-foreground"
            >
              <XIcon className="size-3" />
            </button>
          ) : null}
        </div>
        <div className="inline-flex rounded-md border border-border/60 bg-background/60 p-0.5">
          {(["board", "list"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => updateUiState({ viewMode: mode })}
              aria-pressed={uiState.viewMode === mode}
              aria-label={mode === "board" ? messages.kanban.viewBoard : messages.kanban.viewList}
              title={mode === "board" ? messages.kanban.viewBoard : messages.kanban.viewList}
              data-kanban-view={mode}
              className={cn(
                "inline-flex size-7 items-center justify-center rounded-sm transition-colors",
                uiState.viewMode === mode
                  ? "bg-accent/70 text-foreground"
                  : "text-muted-foreground/70 hover:text-foreground",
              )}
            >
              {mode === "board" ? (
                <KanbanIcon className="size-4" />
              ) : (
                <ListIcon className="size-4" />
              )}
            </button>
          ))}
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
  );

  const renderStatusStrip = () =>
    board ? (
      <div className="flex shrink-0 items-center gap-3 border-b border-border/40 px-5 py-2 text-[11.5px] text-muted-foreground/80">
        <span>{messages.kanban.taskCount(board.tasks.length)}</span>
        {filtersActive ? (
          <>
            <span className="text-muted-foreground/40" aria-hidden>
              ·
            </span>
            <span className="inline-flex items-center gap-1.5">
              <FilterIcon className="size-3" />
              {messages.kanban.showingCount(visibleTasks.length)}
            </span>
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] text-muted-foreground/80 transition-colors hover:bg-accent/50 hover:text-foreground"
            >
              <XIcon className="size-3" />
              {messages.kanban.clearFilters}
            </button>
          </>
        ) : null}
        <span
          className="ml-auto truncate text-[11px] text-muted-foreground/55"
          title={board.boardFilePath}
        >
          {messages.kanban.boardFileLabel} {shortWorkspacePath(board.boardFilePath)}
        </span>
      </div>
    ) : null;

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden isolate">
      <div className="flex h-full min-h-0 bg-background">
        {uiState.sidebarVisible ? (
          <KanbanSidebar
            projects={projects}
            selectedProjectId={selectedProjectId}
            onSelectProject={selectProject}
            board={board}
            filters={filters}
            onFiltersChange={setFilters}
            onHide={() => updateUiState({ sidebarVisible: false })}
          />
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col">
          {renderToolbar()}
          {renderStatusStrip()}
          <div className="flex min-h-0 flex-1 flex-col px-5 py-4">{renderContent()}</div>
        </div>
      </div>
    </SidebarInset>
  );
}
