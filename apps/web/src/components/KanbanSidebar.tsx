// FILE: KanbanSidebar.tsx
// Purpose: The board's own menu, and the only navigation column on the kanban
//          surface: the brand and the open project, which project's board is
//          open, the status / priority / agent-run filters that narrow what the
//          columns and the list show, and the way back to the agents.
// Layer: Component
// Exports: KanbanSidebar

import { useMemo, type ReactNode } from "react";

import {
  KANBAN_TASK_STATUSES,
  type KanbanBoard,
  type KanbanProjectSummary,
  type KanbanTaskPriority,
  type KanbanTaskStatus,
  type ProjectId,
} from "@peakcode/contracts";
import { useNavigate } from "@tanstack/react-router";

import { isElectron } from "../env";
import { useMessages } from "../i18n/I18nContext";
import {
  ArrowLeftIcon,
  BotIcon,
  CheckIcon,
  ChevronDownIcon,
  CircleDashedIcon,
  FlagIcon,
  KanbanIcon,
  MinusIcon,
  PanelLeftCloseIcon,
} from "../lib/icons";
import type { KanbanAgentRunFilter, KanbanFilterState } from "../lib/kanbanFilters";
import {
  kanbanColumnAccent,
  kanbanProjectCode,
  kanbanRunStatusLabel,
  kanbanStatusLabel,
  shortWorkspacePath,
} from "../lib/kanbanPresentation";
import { cn } from "../lib/utils";
import {
  KanbanPriorityMeter,
  KanbanRunStatusMarker,
  KanbanStatusGlyph,
} from "./KanbanPresentation";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "./ui/menu";

/** Run-state buckets, including the tasks that were never handed to an agent. */
const AGENT_RUN_FILTERS: ReadonlyArray<KanbanAgentRunFilter> = [
  "all",
  "running",
  "done",
  "failed",
  "interrupted",
  "idle",
];

interface BoardCounts {
  readonly byStatus: Record<KanbanTaskStatus, number>;
  readonly byPriority: Record<KanbanTaskPriority, number>;
  readonly byAgentRun: Record<KanbanAgentRunFilter, number>;
}

function countBoardTasks(board: KanbanBoard | null): BoardCounts {
  const byStatus: Record<KanbanTaskStatus, number> = {
    todo: 0,
    in_progress: 0,
    done: 0,
    blocked: 0,
    archived: 0,
  };
  const byPriority: Record<KanbanTaskPriority, number> = { high: 0, medium: 0, low: 0 };
  const byAgentRun: Record<KanbanAgentRunFilter, number> = {
    all: 0,
    running: 0,
    done: 0,
    failed: 0,
    interrupted: 0,
    idle: 0,
  };
  for (const task of board?.tasks ?? []) {
    byStatus[task.status] += 1;
    byPriority[task.priority] += 1;
    byAgentRun.all += 1;
    if (task.agentRunStatus) byAgentRun[task.agentRunStatus] += 1;
    else byAgentRun.idle += 1;
  }
  return { byStatus, byPriority, byAgentRun };
}

/** One selectable line in the menu: a glyph, a label, and how many it holds. */
function MenuRow(props: {
  readonly icon: ReactNode;
  readonly label: string;
  readonly count: number;
  readonly active: boolean;
  readonly onClick: () => void;
  readonly testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      aria-pressed={props.active}
      data-kanban-filter={props.testId}
      className={cn(
        "flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-[12.5px] transition-colors",
        props.active
          ? "bg-[var(--sidebar-accent-active)] font-medium text-foreground"
          : "text-foreground/85 hover:bg-[var(--sidebar-accent)]",
      )}
    >
      <span className="inline-flex size-4 shrink-0 items-center justify-center">{props.icon}</span>
      <span className="min-w-0 flex-1 truncate">{props.label}</span>
      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/60">
        {props.count}
      </span>
    </button>
  );
}

function MenuSection(props: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="flex flex-col gap-0.5">
      <h2 className="px-2 pb-1 text-[11px] text-muted-foreground/58">{props.title}</h2>
      {props.children}
    </section>
  );
}

/** One project as the switcher draws it, in both the trigger and the menu. */
function ProjectRow(props: {
  readonly project: KanbanProjectSummary;
  readonly className?: string;
}) {
  const { project } = props;
  return (
    <span className={cn("flex min-w-0 flex-1 items-center gap-2", props.className)}>
      <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-[6px] bg-muted/70 font-mono text-[9px] leading-none text-muted-foreground/80">
        {kanbanProjectCode(project.title).slice(0, 2)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate">{project.title}</span>
        <span
          className="mt-px block truncate text-[10.5px] text-muted-foreground/55"
          title={project.workspaceRoot}
        >
          {shortWorkspacePath(project.workspaceRoot)}
        </span>
      </span>
      {project.inProgressCount > 0 ? (
        <span className="shrink-0 rounded-full bg-info/15 px-1.5 text-[10px] tabular-nums text-info">
          {project.inProgressCount}
        </span>
      ) : null}
      {project.blockedCount > 0 ? (
        <span className="shrink-0 rounded-full bg-destructive/12 px-1.5 text-[10px] tabular-nums text-destructive">
          {project.blockedCount}
        </span>
      ) : null}
      <span className="shrink-0 text-[10.5px] tabular-nums text-muted-foreground/55">
        {project.doneCount}/{project.taskCount}
      </span>
    </span>
  );
}

export function KanbanSidebar(props: {
  readonly projects: ReadonlyArray<KanbanProjectSummary>;
  readonly selectedProjectId: ProjectId | null;
  readonly onSelectProject: (projectId: ProjectId) => void;
  readonly board: KanbanBoard | null;
  readonly filters: KanbanFilterState;
  readonly onFiltersChange: (filters: KanbanFilterState) => void;
  readonly onHide: () => void;
  /** Desktop traffic-light gutter, because this column owns the window's left edge. */
  readonly gutterClassName: string | null;
}) {
  const messages = useMessages();
  const navigate = useNavigate();
  const { board, filters, onFiltersChange } = props;
  const counts = useMemo(() => countBoardTasks(board), [board]);
  const selectedProject = useMemo(
    () => props.projects.find((project) => project.projectId === props.selectedProjectId) ?? null,
    [props.projects, props.selectedProjectId],
  );
  const accentByStatus = useMemo(() => {
    const accents = new Map<KanbanTaskStatus, string>();
    for (const column of board?.columns ?? []) {
      accents.set(column.key, kanbanColumnAccent(column.key, column.dot));
    }
    for (const status of KANBAN_TASK_STATUSES) {
      if (!accents.has(status)) accents.set(status, kanbanColumnAccent(status));
    }
    return accents;
  }, [board]);

  return (
    <aside
      data-kanban-sidebar
      className="flex h-full w-[240px] shrink-0 flex-col border-r border-border/60 bg-[var(--color-background-panel)]"
    >
      <header
        className={cn(
          "flex shrink-0 items-center gap-2 px-3 pt-3 pb-2",
          isElectron && "drag-region",
          props.gutterClassName,
        )}
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-foreground/90 text-background">
          <KanbanIcon className="size-4" />
        </span>
        {/* The open project is the switcher's job — repeating it here would put
            the same name twice in a 240px column. */}
        <p className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
          {messages.sidebar.kanbanLabel}
        </p>
        <button
          type="button"
          onClick={props.onHide}
          aria-label={messages.kanban.hideSidebar}
          title={messages.kanban.hideSidebar}
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-[var(--sidebar-accent)] hover:text-foreground"
        >
          <PanelLeftCloseIcon className="size-3.5" />
        </button>
      </header>

      <nav className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2 pt-1 pb-3">
        {/* The column shows the project the board is on; the rest of the list
            lives behind the chevron, so the menu stays the same height however
            many projects the workspace accumulates. */}
        <MenuSection title={messages.kanban.sections.projects}>
          <Menu>
            <MenuTrigger
              render={
                <button
                  type="button"
                  title={messages.kanban.switchProject}
                  data-kanban-project-switcher
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] font-medium text-foreground transition-colors hover:bg-[var(--sidebar-accent)]"
                />
              }
            >
              {selectedProject ? (
                <ProjectRow project={selectedProject} />
              ) : (
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {messages.kanban.selectProject}
                </span>
              )}
              <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground/60" />
            </MenuTrigger>
            <MenuPopup
              align="start"
              className="w-(--anchor-width) min-w-56 rounded-lg border-[color:var(--color-border)] bg-[var(--color-background-elevated-primary-opaque)] shadow-lg"
            >
              {props.projects.map((project) => {
                const active = project.projectId === props.selectedProjectId;
                return (
                  <MenuItem
                    key={project.projectId}
                    data-kanban-project={project.projectId}
                    onClick={() => props.onSelectProject(project.projectId)}
                    className={cn("py-1.5", active && "font-medium")}
                  >
                    <ProjectRow project={project} />
                    {active ? <CheckIcon className="size-3.5 shrink-0 text-foreground" /> : null}
                  </MenuItem>
                );
              })}
            </MenuPopup>
          </Menu>
        </MenuSection>

        <MenuSection title={messages.kanban.status}>
          <MenuRow
            icon={<CircleDashedIcon className="size-3.5 text-muted-foreground/70" />}
            label={messages.kanban.filterAll}
            count={counts.byAgentRun.all}
            active={filters.status === "all"}
            onClick={() => onFiltersChange({ ...filters, status: "all" })}
            testId="status-all"
          />
          {KANBAN_TASK_STATUSES.map((status) => (
            <MenuRow
              key={status}
              icon={<KanbanStatusGlyph status={status} color={accentByStatus.get(status)} />}
              label={kanbanStatusLabel(messages, status)}
              count={counts.byStatus[status]}
              active={filters.status === status}
              onClick={() =>
                onFiltersChange({
                  ...filters,
                  status: filters.status === status ? "all" : status,
                })
              }
              testId={`status-${status}`}
            />
          ))}
        </MenuSection>

        <MenuSection title={messages.kanban.priority}>
          <MenuRow
            icon={<FlagIcon className="size-3.5 text-muted-foreground/70" />}
            label={messages.kanban.filterAll}
            count={counts.byAgentRun.all}
            active={filters.priority === "all"}
            onClick={() => onFiltersChange({ ...filters, priority: "all" })}
            testId="priority-all"
          />
          {(["high", "medium", "low"] as const).map((priority) => (
            <MenuRow
              key={priority}
              icon={<KanbanPriorityMeter priority={priority} />}
              label={messages.kanban.priorities[priority]}
              count={counts.byPriority[priority]}
              active={filters.priority === priority}
              onClick={() =>
                onFiltersChange({
                  ...filters,
                  priority: filters.priority === priority ? "all" : priority,
                })
              }
              testId={`priority-${priority}`}
            />
          ))}
        </MenuSection>

        <MenuSection title={messages.kanban.agentRun}>
          {AGENT_RUN_FILTERS.map((agentRun) => (
            <MenuRow
              key={agentRun}
              icon={
                agentRun === "all" ? (
                  <BotIcon className="size-3.5 text-muted-foreground/70" />
                ) : agentRun === "idle" ? (
                  <MinusIcon className="size-3.5 text-muted-foreground/60" />
                ) : (
                  <KanbanRunStatusMarker status={agentRun} />
                )
              }
              label={
                agentRun === "all"
                  ? messages.kanban.filterAll
                  : agentRun === "idle"
                    ? messages.kanban.agentRunUnknown
                    : kanbanRunStatusLabel(messages, agentRun)
              }
              count={counts.byAgentRun[agentRun]}
              active={filters.agentRun === agentRun}
              onClick={() =>
                onFiltersChange({
                  ...filters,
                  agentRun: filters.agentRun === agentRun ? "all" : agentRun,
                })
              }
              testId={`agent-run-${agentRun}`}
            />
          ))}
        </MenuSection>
      </nav>

      <footer className="shrink-0 border-t border-border/50 px-2 pt-2 pb-3">
        <button
          type="button"
          onClick={() => void navigate({ to: "/" })}
          data-kanban-back-to-agents
          className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-[12.5px] text-foreground/85 transition-colors hover:bg-[var(--sidebar-accent)]"
        >
          <ArrowLeftIcon className="size-4 shrink-0 text-muted-foreground/70" />
          <span className="truncate">{messages.kanban.backToAgents}</span>
        </button>
        <p
          className="mt-1.5 truncate px-2 text-[10.5px] text-muted-foreground/55"
          title={board?.boardFilePath}
        >
          {messages.kanban.boardFileLabel}{" "}
          {board ? shortWorkspacePath(board.boardFilePath) : messages.kanban.selectProject}
        </p>
        <p className="px-2 text-[10.5px] text-muted-foreground/55">
          {messages.kanban.taskCount(counts.byAgentRun.all)}
        </p>
      </footer>
    </aside>
  );
}
