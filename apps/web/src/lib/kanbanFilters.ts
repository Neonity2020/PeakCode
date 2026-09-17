// FILE: kanbanFilters.ts
// Purpose: The board's filter model — status, priority, agent-run state, and the
//          free-text search — plus the predicate the columns and the list run
//          every task through.
// Layer: Web data helpers
// Exports: KanbanAgentRunFilter, KanbanFilterState, KANBAN_FILTERS_EMPTY,
//          isKanbanFilterActive, matchesKanbanTask, filterKanbanTasks

import type {
  KanbanAgentRunStatus,
  KanbanTask,
  KanbanTaskPriority,
  KanbanTaskStatus,
} from "@peakcode/contracts";

import { kanbanTaskCode } from "./kanbanPresentation";

/** `"all"` means the filter is off; `"idle"` means the task never ran an agent. */
export type KanbanAgentRunFilter = KanbanAgentRunStatus | "idle" | "all";

export interface KanbanFilterState {
  readonly status: KanbanTaskStatus | "all";
  readonly priority: KanbanTaskPriority | "all";
  readonly agentRun: KanbanAgentRunFilter;
}

export const KANBAN_FILTERS_EMPTY: KanbanFilterState = {
  status: "all",
  priority: "all",
  agentRun: "all",
};

export function isKanbanFilterActive(filters: KanbanFilterState): boolean {
  return filters.status !== "all" || filters.priority !== "all" || filters.agentRun !== "all";
}

function matchesAgentRun(task: KanbanTask, agentRun: KanbanAgentRunFilter): boolean {
  switch (agentRun) {
    case "all":
      return true;
    case "idle":
      return task.agentRunStatus === null;
    default:
      return task.agentRunStatus === agentRun;
  }
}

/**
 * The search box looks at what a card shows plus the requirement, so pasting a
 * work-item code (`PC-29B8`) or a raw task id both find their task.
 */
function matchesQuery(task: KanbanTask, query: string, projectCode: string): boolean {
  if (query.length === 0) return true;
  const haystack = [
    task.title,
    task.description,
    task.assignee,
    task.pipeline,
    task.agentModel,
    kanbanTaskCode(task.taskId, projectCode),
    task.taskId,
  ]
    .join("\n")
    .toLowerCase();
  return haystack.includes(query);
}

export function matchesKanbanTask(
  task: KanbanTask,
  filters: KanbanFilterState,
  query: string,
  projectCode: string,
): boolean {
  if (filters.status !== "all" && task.status !== filters.status) return false;
  if (filters.priority !== "all" && task.priority !== filters.priority) return false;
  if (!matchesAgentRun(task, filters.agentRun)) return false;
  return matchesQuery(task, query.trim().toLowerCase(), projectCode);
}

export function filterKanbanTasks(
  tasks: ReadonlyArray<KanbanTask>,
  filters: KanbanFilterState,
  query: string,
  projectCode: string,
): ReadonlyArray<KanbanTask> {
  return tasks.filter((task) => matchesKanbanTask(task, filters, query, projectCode));
}
