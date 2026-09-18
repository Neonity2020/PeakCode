// FILE: KanbanView.tsx
// Purpose: Full-page kanban board for a project's .kanban/board.json: a
//          breadcrumb bar over a tab strip, the work as bare status columns with
//          drag-and-drop or as a scannable list, columns the user folded away
//          parked in a rail on the right, and the board's own menu alongside.
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
import { isElectron } from "../env";
import { useLeadingColumnTrafficLightGutterClassName } from "../hooks/useDesktopTopBarGutter";
import { useMessages } from "../i18n/I18nContext";
import { readKanbanUiState, persistKanbanUiState, type KanbanUiState } from "../kanbanUiState";
import { isDefaultWorkspaceRoot } from "../lib/defaultWorkspace";
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
  sortKanbanProjects,
} from "../lib/kanbanPresentation";
import {
  useKanbanBoardQuery,
  useKanbanMoveTaskMutation,
  useKanbanProjectsQuery,
} from "../lib/kanbanReactQuery";
import {
  ChevronRightIcon,
  EllipsisIcon,
  FileIcon,
  FilterIcon,
  FolderIcon,
  KanbanIcon,
  LoaderIcon,
  PanelLeftCloseIcon,
  PanelLeftIcon,
  PanelRightCloseIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  XIcon,
} from "../lib/icons";
import { cn } from "../lib/utils";
import { useLatestProjectStore } from "../latestProjectStore";
import { useWorkspaceStore } from "../workspaceStore";
import { KanbanSidebar } from "./KanbanSidebar";
import { KanbanStatusBadge, KanbanStatusGlyph } from "./KanbanPresentation";
import { KanbanTaskCard, KanbanTaskRow } from "./KanbanTaskCard";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "./ui/menu";
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

/**
 * Splits the board's columns into the ones drawn as columns and the ones parked
 * in the rail. Folding every column away would leave nothing to drop on, so the
 * last one standing is always drawn.
 */
function splitColumns(
  keys: ReadonlyArray<KanbanTaskStatus>,
  hidden: ReadonlySet<KanbanTaskStatus>,
): {
  readonly drawn: ReadonlyArray<KanbanTaskStatus>;
  readonly parked: ReadonlyArray<KanbanTaskStatus>;
} {
  const drawn = keys.filter((key) => !hidden.has(key));
  return drawn.length > 0
    ? { drawn, parked: keys.filter((key) => hidden.has(key)) }
    : { drawn: keys, parked: [] };
}

export function KanbanView() {
  const messages = useMessages();
  const navigate = useNavigate();
  const projectsQuery = useKanbanProjectsQuery();
  const homeDir = useWorkspaceStore((store) => store.homeDir);
  const allProjects = useMemo(() => projectsQuery.data?.projects ?? [], [projectsQuery.data]);
  // The picker reads the way the workspace sidebar does: newest first, with the
  // app's own scratch workspace at the bottom.
  const workspaceProjectId = useMemo(
    () =>
      allProjects.find((project) => isDefaultWorkspaceRoot(project.workspaceRoot, homeDir))
        ?.projectId ?? null,
    [allProjects, homeDir],
  );
  const projects = useMemo(
    () => sortKanbanProjects(allProjects, workspaceProjectId),
    [allProjects, workspaceProjectId],
  );
  const latestProjectId = useLatestProjectStore((state) => state.latestProjectId);

  const [uiState, setUiState] = useState<KanbanUiState>(() => readKanbanUiState());
  const selectedProjectId = (uiState.selectedProjectId as ProjectId | null) ?? null;
  const [filters, setFilters] = useState<KanbanFilterState>(KANBAN_FILTERS_EMPTY);
  const [search, setSearch] = useState("");
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [railDropStatus, setRailDropStatus] = useState<KanbanTaskStatus | null>(null);
  const draggingTaskIdRef = useRef<KanbanTaskId | null>(null);

  const updateUiState = useCallback((patch: Partial<KanbanUiState>) => {
    setUiState((previous) => ({ ...previous, ...patch }));
    persistKanbanUiState(patch);
  }, []);

  // The board's own menu replaces the workspace sidebar, so it owns the window's
  // left edge and has to clear the desktop traffic lights. The top bar only
  // inherits that job while the menu is folded away.
  const leadingColumnGutter = useLeadingColumnTrafficLightGutterClassName();
  const topBarGutter = uiState.sidebarVisible ? null : leadingColumnGutter;

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

  const hiddenStatuses = useMemo(() => new Set(uiState.hiddenStatuses), [uiState.hiddenStatuses]);

  const { drawn: drawnColumns, parked: parkedColumns } = useMemo(() => {
    const keys = board ? boardColumnKeys(board) : KANBAN_STATUS_ORDER;
    return splitColumns(keys, hiddenStatuses);
  }, [board, hiddenStatuses]);

  const selectProject = useCallback(
    (projectId: ProjectId) => {
      updateUiState({ selectedProjectId: projectId });
    },
    [updateUiState],
  );

  /**
   * Narrowing to a column that is folded away would otherwise leave a filter
   * with nothing on the board to show for it, so picking one pulls it back out.
   */
  const changeFilters = useCallback(
    (next: KanbanFilterState) => {
      setFilters(next);
      if (next.status === "all" || !hiddenStatuses.has(next.status)) return;
      updateUiState({
        hiddenStatuses: uiState.hiddenStatuses.filter((status) => status !== next.status),
      });
    },
    [hiddenStatuses, uiState.hiddenStatuses, updateUiState],
  );

  const parkColumn = useCallback(
    (status: KanbanTaskStatus) => {
      updateUiState({ hiddenStatuses: [...uiState.hiddenStatuses, status] });
    },
    [uiState.hiddenStatuses, updateUiState],
  );

  const revealColumn = useCallback(
    (status: KanbanTaskStatus) => {
      updateUiState({
        hiddenStatuses: uiState.hiddenStatuses.filter((entry) => entry !== status),
      });
    },
    [uiState.hiddenStatuses, updateUiState],
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

  /** Everything in a column regardless of filters, for the rail's counts. */
  const countsByStatus = useMemo(() => {
    const counts = statusGroup<number>(() => 0);
    for (const task of board?.tasks ?? []) {
      counts[task.status] += 1;
    }
    return counts;
  }, [board]);

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
    setRailDropStatus(null);
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

  /** The rail has no cards to land between, so a drop there goes to the end. */
  const handleRailDrop = (status: KanbanTaskStatus) => (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    const taskId = draggingTaskIdRef.current;
    setRailDropStatus(null);
    draggingTaskIdRef.current = null;
    if (!taskId || !selectedProjectId) return;
    const order = (board?.tasks ?? []).filter((entry) => entry.status === status).length;
    moveTask.mutate({ projectId: selectedProjectId, taskId, status, order });
  };

  const handleDragStart = useCallback((task: KanbanTask, event: DragEvent<HTMLElement>) => {
    draggingTaskIdRef.current = task.taskId;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", task.taskId);
  }, []);

  const renderColumnMenu = (status: KanbanTaskStatus) => {
    const label = kanbanStatusLabel(messages, status);
    return (
      <Menu>
        <MenuTrigger
          render={
            <button
              type="button"
              aria-label={messages.kanban.columnActions(label)}
              title={messages.kanban.columnActions(label)}
              data-kanban-column-menu={status}
              className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent/60 hover:text-foreground"
            />
          }
        >
          <EllipsisIcon className="size-3.5" />
        </MenuTrigger>
        <MenuPopup
          align="end"
          className="min-w-44 rounded-lg border-[color:var(--color-border)] bg-[var(--color-background-elevated-primary-opaque)] shadow-lg"
        >
          <MenuItem onClick={() => openCreatePage(status)} data-kanban-menu-new-task={status}>
            <PlusIcon />
            {messages.kanban.addTask}
          </MenuItem>
          <MenuSeparator />
          <MenuItem onClick={() => parkColumn(status)} data-kanban-menu-hide-column={status}>
            <PanelRightCloseIcon />
            {messages.kanban.hideColumn}
          </MenuItem>
          <MenuItem
            onClick={() => updateUiState({ hiddenStatuses: [] })}
            disabled={uiState.hiddenStatuses.length === 0}
          >
            <PanelLeftIcon />
            {messages.kanban.showAllColumns}
          </MenuItem>
        </MenuPopup>
      </Menu>
    );
  };

  const renderColumnHeader = (status: KanbanTaskStatus, count: number) => (
    <header className="flex shrink-0 items-center gap-2 px-3 pt-2.5 pb-2">
      <KanbanStatusBadge
        status={status}
        color={accentByStatus.get(status)}
        title={kanbanStatusLabel(messages, status)}
      />
      <span className="truncate text-[12.5px] font-medium text-foreground">
        {kanbanStatusLabel(messages, status)}
      </span>
      <span className="shrink-0 text-[11.5px] tabular-nums text-muted-foreground/60">{count}</span>
      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          aria-label={`${messages.kanban.addTask} · ${kanbanStatusLabel(messages, status)}`}
          title={messages.kanban.addTaskIn(kanbanStatusLabel(messages, status))}
          data-kanban-column-new-task={status}
          className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent/60 hover:text-foreground"
          onClick={() => openCreatePage(status)}
        >
          <PlusIcon className="size-3.5" />
        </button>
        {renderColumnMenu(status)}
      </div>
    </header>
  );

  /**
   * A lane is drawn as a faint panel rather than a hole in the page: the board is
   * mostly whitespace, and without the frame the columns stop reading as the
   * separate tracks that cards move between.
   */
  const renderBoard = () => (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <div className="flex min-h-0 flex-1 gap-4 overflow-x-auto px-4 pb-1">
        {drawnColumns.map((status) => {
          const columnTasks = tasksByStatus[status];
          const indicatorIndex = dropTarget?.status === status ? dropTarget.index : null;
          return (
            <section
              key={status}
              data-kanban-column-section={status}
              className="flex h-full min-h-0 w-[290px] shrink-0 flex-col overflow-hidden rounded-2xl border border-border/60 bg-muted/35"
            >
              {renderColumnHeader(status, columnTasks.length)}
              <div className="mx-3 h-px shrink-0 bg-border/50" />
              <div
                data-kanban-column={status}
                className={cn(
                  "flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2 transition-colors",
                  indicatorIndex !== null && "bg-accent/25",
                )}
                onDragOver={handleDragOver(status)}
                onDragLeave={(event) => {
                  if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
                  setDropTarget((previous) => (previous?.status === status ? null : previous));
                }}
                onDrop={handleDrop(status)}
              >
                {columnTasks.length === 0 && indicatorIndex === null ? (
                  <p className="flex flex-1 items-center justify-center text-[12px] text-muted-foreground/50">
                    {filtersActive ? messages.kanban.noMatchesColumn : messages.kanban.noTasks}
                  </p>
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
              </div>
            </section>
          );
        })}
      </div>
      {parkedColumns.length > 0 ? renderHiddenRail() : null}
    </div>
  );

  /**
   * Folded-away columns, parked on the right. Rows are drop targets too, so a
   * card can be dragged straight into archived work without unfolding it first.
   */
  const renderHiddenRail = () => (
    <aside
      data-kanban-hidden-rail
      className="mr-4 flex w-[196px] shrink-0 flex-col overflow-hidden rounded-2xl border border-border/60 bg-muted/25"
    >
      <header className="flex shrink-0 items-center px-3 pt-2.5 pb-2">
        <span className="truncate text-[12.5px] text-muted-foreground">
          {messages.kanban.hiddenColumns}
        </span>
      </header>
      <div className="mx-3 h-px shrink-0 bg-border/50" />
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2">
        {parkedColumns.map((status) => {
          const label = kanbanStatusLabel(messages, status);
          const isDropTarget = railDropStatus === status;
          return (
            <button
              key={status}
              type="button"
              data-kanban-hidden-column={status}
              aria-label={messages.kanban.revealColumn(label)}
              title={messages.kanban.revealColumn(label)}
              onClick={() => revealColumn(status)}
              onDragOver={(event) => {
                if (!draggingTaskIdRef.current) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setRailDropStatus(status);
              }}
              onDragLeave={() => {
                setRailDropStatus((previous) => (previous === status ? null : previous));
              }}
              onDrop={handleRailDrop(status)}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[12.5px] transition-colors",
                isDropTarget
                  ? "bg-accent/60 text-foreground"
                  : "text-muted-foreground/85 hover:bg-accent/35 hover:text-foreground",
              )}
            >
              <KanbanStatusGlyph status={status} color={accentByStatus.get(status)} />
              <span className="min-w-0 flex-1 truncate">{label}</span>
              <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/60">
                {countsByStatus[status]}
              </span>
            </button>
          );
        })}
      </div>
    </aside>
  );

  /** Folding a column away hides it in both readings of the board. */
  const renderList = () => (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col gap-5 overflow-y-auto pb-2">
      {drawnColumns.map((status) => {
        const columnTasks = tasksByStatus[status];
        if (columnTasks.length === 0) return null;
        return (
          <section key={status} data-kanban-list-group={status} className="flex flex-col gap-1">
            <header className="flex items-center gap-2 px-3 pb-1">
              <KanbanStatusBadge
                status={status}
                color={accentByStatus.get(status)}
                title={kanbanStatusLabel(messages, status)}
              />
              <span className="text-[12.5px] font-medium text-foreground">
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
            <div className="flex flex-col gap-1.5">
              {columnTasks.map((task) => (
                <KanbanTaskRow
                  key={task.taskId}
                  task={task}
                  status={status}
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

    return uiState.viewMode === "list" ? renderList() : renderBoard();
  };

  /** Window-level drag strip: the breadcrumb says where this board belongs. */
  const renderTopBar = () => (
    <header
      className={cn(
        "flex shrink-0 items-center gap-2 px-4 pt-3 pb-2",
        isElectron && "drag-region",
        topBarGutter,
      )}
    >
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
      <div className="flex min-w-0 items-center gap-1.5">
        <KanbanIcon className="size-4 shrink-0 text-muted-foreground/70" />
        <span className="shrink-0 text-[13px] text-muted-foreground/80">
          {messages.sidebar.kanbanLabel}
        </span>
        <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground/40" />
        <FileIcon className="size-3.5 shrink-0 text-muted-foreground/60" />
        <span
          className="truncate text-[13px] font-medium text-foreground"
          title={selectedSummary?.workspaceRoot}
        >
          {selectedSummary?.title ?? messages.kanban.selectProject}
        </span>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={() => void boardQuery.refetch()}
          disabled={!selectedProjectId || boardQuery.isFetching}
          aria-label={messages.kanban.refreshBoard}
          title={messages.kanban.refreshBoard}
          className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-accent/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCwIcon className={cn("size-3.5", boardQuery.isFetching && "animate-spin")} />
        </button>
      </div>
    </header>
  );

  /** Tabs for the two readings of the same board, with the board's tools beside them. */
  const renderTabStrip = () => (
    <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-4">
      <div className="flex shrink-0 items-center gap-1">
        {(["board", "list"] as const).map((mode) => {
          const active = uiState.viewMode === mode;
          return (
            <button
              key={mode}
              type="button"
              onClick={() => updateUiState({ viewMode: mode })}
              aria-pressed={active}
              aria-label={mode === "board" ? messages.kanban.viewBoard : messages.kanban.viewList}
              title={mode === "board" ? messages.kanban.viewBoard : messages.kanban.viewList}
              data-kanban-view={mode}
              className={cn(
                "relative inline-flex h-9 items-center px-2 text-[13px] transition-colors",
                active
                  ? "font-medium text-foreground"
                  : "text-muted-foreground/75 hover:text-foreground",
              )}
            >
              {mode === "board" ? messages.kanban.boardTab : messages.kanban.listTab}
              {active ? (
                <span
                  className="absolute inset-x-1 -bottom-px h-0.5 rounded-full bg-foreground"
                  aria-hidden
                />
              ) : null}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => openCreatePage("todo")}
          disabled={!selectedProjectId}
          aria-label={messages.kanban.addTask}
          title={messages.kanban.addTask}
          className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-accent/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          <PlusIcon className="size-4" />
        </button>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-2 py-1.5">
        {filtersActive ? (
          <>
            <span className="text-[11.5px] text-muted-foreground/70">
              {messages.kanban.showingCount(visibleTasks.length)}
            </span>
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11.5px] text-muted-foreground/80 transition-colors hover:bg-accent/50 hover:text-foreground"
            >
              <XIcon className="size-3" />
              {messages.kanban.clearFilters}
            </button>
          </>
        ) : null}
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label={messages.kanban.searchPlaceholder}
            placeholder={messages.kanban.searchPlaceholder}
            data-kanban-search
            className="h-8 w-[220px] rounded-lg border border-border/70 bg-[var(--color-background-panel)] pr-7 pl-8 text-[12px] text-foreground outline-hidden placeholder:text-muted-foreground/50 focus-visible:ring-1 focus-visible:ring-ring"
          />
          {search.length > 0 ? (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label={messages.kanban.clearSearch}
              className="absolute top-1/2 right-2 inline-flex size-4 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground/60 transition-colors hover:text-foreground"
            >
              <XIcon className="size-3" />
            </button>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => updateUiState({ sidebarVisible: false })}
          aria-label={messages.kanban.hideSidebar}
          title={messages.kanban.hideSidebar}
          className="inline-flex size-8 items-center justify-center rounded-lg border border-border/70 text-muted-foreground/70 transition-colors hover:bg-accent/50 hover:text-foreground"
        >
          <PanelLeftCloseIcon className="size-4" />
        </button>
      </div>
    </div>
  );

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
            onFiltersChange={changeFilters}
            onHide={() => updateUiState({ sidebarVisible: false })}
            gutterClassName={leadingColumnGutter}
          />
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col">
          {renderTopBar()}
          {renderTabStrip()}
          <div className="flex min-h-0 flex-1 flex-col pt-3 pb-2">{renderContent()}</div>
        </div>
      </div>
    </SidebarInset>
  );
}
