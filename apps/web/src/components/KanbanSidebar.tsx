// FILE: KanbanSidebar.tsx
// Purpose: The board's own left menu: which project's board is open, and the
//          status / priority / agent-run filters that narrow what the columns
//          and the list show.
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

import { useMessages } from "../i18n/I18nContext";
import {
  BotIcon,
  CheckIcon,
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

function SectionRow(props: {
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
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors",
        props.active
          ? "bg-accent/60 text-foreground"
          : "text-muted-foreground/85 hover:bg-accent/35 hover:text-foreground",
      )}
    >
      <span className="inline-flex size-4 shrink-0 items-center justify-center">{props.icon}</span>
      <span className="min-w-0 flex-1 truncate">{props.label}</span>
      <span className="shrink-0 text-[10.5px] tabular-nums text-muted-foreground/60">
        {props.count}
      </span>
    </button>
  );
}

function SidebarSection(props: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="flex flex-col gap-0.5">
      <h2 className="px-2 pb-1 text-[10.5px] font-medium tracking-wider text-muted-foreground/55 uppercase">
        {props.title}
      </h2>
      {props.children}
    </section>
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
}) {
  const messages = useMessages();
  const { board, filters, onFiltersChange } = props;
  const counts = useMemo(() => countBoardTasks(board), [board]);
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
      className="flex h-full w-[236px] shrink-0 flex-col border-r border-border/60 bg-[var(--color-background-panel)]"
    >
      <header className="flex shrink-0 items-center gap-2 px-3 py-3">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-foreground/90 text-background">
          <KanbanIcon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-foreground">
            {messages.sidebar.kanbanLabel}
          </p>
          <p className="truncate text-[11px] text-muted-foreground/70">
            {board?.projectTitle ?? messages.kanban.selectProject}
          </p>
        </div>
        <button
          type="button"
          onClick={props.onHide}
          aria-label={messages.kanban.hideSidebar}
          title={messages.kanban.hideSidebar}
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent/50 hover:text-foreground"
        >
          <PanelLeftCloseIcon className="size-3.5" />
        </button>
      </header>

      <nav className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2 pb-3">
        <SidebarSection title={messages.kanban.sections.projects}>
          {props.projects.map((project) => {
            const active = project.projectId === props.selectedProjectId;
            return (
              <button
                key={project.projectId}
                type="button"
                onClick={() => props.onSelectProject(project.projectId)}
                aria-pressed={active}
                data-kanban-project={project.projectId}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors",
                  active
                    ? "bg-accent/60 text-foreground"
                    : "text-muted-foreground/85 hover:bg-accent/35 hover:text-foreground",
                )}
              >
                <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-[5px] bg-muted/70 font-mono text-[8.5px] leading-none text-muted-foreground/80">
                  {kanbanProjectCode(project.title).slice(0, 2)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{project.title}</span>
                  <span
                    className="mt-px block truncate text-[10px] text-muted-foreground/55"
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
                {active ? <CheckIcon className="size-3.5 shrink-0 text-foreground" /> : null}
              </button>
            );
          })}
        </SidebarSection>

        <SidebarSection title={messages.kanban.status}>
          <SectionRow
            icon={<CircleDashedIcon className="size-3.5 text-muted-foreground/70" />}
            label={messages.kanban.filterAll}
            count={counts.byAgentRun.all}
            active={filters.status === "all"}
            onClick={() => onFiltersChange({ ...filters, status: "all" })}
            testId="status-all"
          />
          {KANBAN_TASK_STATUSES.map((status) => (
            <SectionRow
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
        </SidebarSection>

        <SidebarSection title={messages.kanban.priority}>
          <SectionRow
            icon={<FlagIcon className="size-3.5 text-muted-foreground/70" />}
            label={messages.kanban.filterAll}
            count={counts.byAgentRun.all}
            active={filters.priority === "all"}
            onClick={() => onFiltersChange({ ...filters, priority: "all" })}
            testId="priority-all"
          />
          {(["high", "medium", "low"] as const).map((priority) => (
            <SectionRow
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
        </SidebarSection>

        <SidebarSection title={messages.kanban.agentRun}>
          {AGENT_RUN_FILTERS.map((agentRun) => (
            <SectionRow
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
        </SidebarSection>
      </nav>

      <footer className="shrink-0 border-t border-border/50 px-3 py-2.5">
        <p className="truncate text-[10.5px] text-muted-foreground/55" title={board?.boardFilePath}>
          {messages.kanban.boardFileLabel}{" "}
          {board ? shortWorkspacePath(board.boardFilePath) : messages.kanban.selectProject}
        </p>
        <p className="mt-0.5 text-[10.5px] text-muted-foreground/55">
          {messages.kanban.taskCount(counts.byAgentRun.all)}
        </p>
      </footer>
    </aside>
  );
}
