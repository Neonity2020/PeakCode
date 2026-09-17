// FILE: kanbanFilters.test.ts
// Purpose: Pins the board's filter predicate: status / priority / agent-run
//          narrowing, the free-text search, and how they combine.
// Layer: Web data helper tests

import { describe, expect, it } from "vitest";
import type { KanbanTask, KanbanTaskId } from "@peakcode/contracts";

import {
  KANBAN_FILTERS_EMPTY,
  filterKanbanTasks,
  isKanbanFilterActive,
  matchesKanbanTask,
  type KanbanFilterState,
} from "./kanbanFilters";

function task(overrides: Partial<KanbanTask>): KanbanTask {
  return {
    taskId: "t_0000000000" as KanbanTaskId,
    title: "Ship the board",
    description: "",
    status: "todo",
    priority: "medium",
    pipeline: "",
    assignee: "",
    agentProvider: "pi",
    agentModel: "",
    agentThreadId: null,
    agentRunStatus: null,
    attachments: [],
    comments: [],
    createdAt: null,
    updatedAt: null,
    ...overrides,
  };
}

const filters = (overrides: Partial<KanbanFilterState>): KanbanFilterState => ({
  ...KANBAN_FILTERS_EMPTY,
  ...overrides,
});

const board = [
  task({ taskId: "t_1111111111" as KanbanTaskId, title: "Design the column header" }),
  task({
    taskId: "t_2222222222" as KanbanTaskId,
    title: "Wire the agent run",
    status: "in_progress",
    priority: "high",
    agentRunStatus: "running",
    assignee: "Peak",
  }),
  task({
    taskId: "t_3333333333" as KanbanTaskId,
    title: "Write the requirement",
    description: "Cover the acceptance criteria",
    status: "done",
    priority: "low",
    agentRunStatus: "done",
    agentModel: "anthropic/claude-sonnet-4",
  }),
];

const titles = (tasks: ReadonlyArray<KanbanTask>) => tasks.map((entry) => entry.title);

describe("isKanbanFilterActive", () => {
  it("is false until one of the three filters is set", () => {
    expect(isKanbanFilterActive(KANBAN_FILTERS_EMPTY)).toBe(false);
    expect(isKanbanFilterActive(filters({ priority: "high" }))).toBe(true);
    expect(isKanbanFilterActive(filters({ agentRun: "idle" }))).toBe(true);
  });
});

describe("filterKanbanTasks", () => {
  it("returns every task when nothing is set", () => {
    expect(filterKanbanTasks(board, KANBAN_FILTERS_EMPTY, "", "PC")).toHaveLength(3);
  });

  it("narrows by status and priority", () => {
    expect(titles(filterKanbanTasks(board, filters({ status: "done" }), "", "PC"))).toEqual([
      "Write the requirement",
    ]);
    expect(titles(filterKanbanTasks(board, filters({ priority: "high" }), "", "PC"))).toEqual([
      "Wire the agent run",
    ]);
  });

  it("treats an unstarted task as idle rather than matching every run state", () => {
    expect(titles(filterKanbanTasks(board, filters({ agentRun: "idle" }), "", "PC"))).toEqual([
      "Design the column header",
    ]);
    expect(titles(filterKanbanTasks(board, filters({ agentRun: "running" }), "", "PC"))).toEqual([
      "Wire the agent run",
    ]);
  });

  it("searches titles, requirements, and the derived work-item code", () => {
    expect(titles(filterKanbanTasks(board, KANBAN_FILTERS_EMPTY, "acceptance", "PC"))).toEqual([
      "Write the requirement",
    ]);
    expect(titles(filterKanbanTasks(board, KANBAN_FILTERS_EMPTY, "console", "PC"))).toEqual([]);
    expect(titles(filterKanbanTasks(board, KANBAN_FILTERS_EMPTY, "pc-3333", "PC"))).toEqual([
      "Write the requirement",
    ]);
    expect(titles(filterKanbanTasks(board, KANBAN_FILTERS_EMPTY, "2222", "PC"))).toEqual([
      "Wire the agent run",
    ]);
  });
  it("combines the filters instead of widening them", () => {
    expect(matchesKanbanTask(board[1]!, filters({ status: "todo" }), "", "PC")).toBe(false);
    expect(
      matchesKanbanTask(board[1]!, filters({ status: "in_progress", priority: "high" }), "", "PC"),
    ).toBe(true);
    expect(filterKanbanTasks(board, filters({ status: "todo" }), "agent", "PC")).toHaveLength(0);
  });
});
