// FILE: KanbanView.browser.tsx
// Purpose: Locks in the board's own chrome: creating a task leaves the board for
//          the full create page (the clicked column travels along as the initial
//          status), the left menu narrows the board, and the view switch swaps
//          the columns for a list of the same tasks.
// Layer: Component browser tests

import "../index.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import type { KanbanBoard, KanbanTask, KanbanTaskId, ProjectId } from "@peakcode/contracts";

import { I18nProvider } from "../i18n";
import { KanbanView } from "./KanbanView";

const PROJECT_ID = "p_kanban_view" as ProjectId;

const api = vi.hoisted(() => ({
  listProjects: vi.fn(),
  getBoard: vi.fn(),
  listModels: vi.fn(),
}));
const navigate = vi.hoisted(() => vi.fn());

vi.mock("../nativeApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../nativeApi")>()),
  ensureNativeApi: () => ({ kanban: api, provider: { listModels: api.listModels } }),
}));
// The board only reads these two settings; the real hook also queries the server.
vi.mock("../appSettings", () => ({
  useAppSettings: () => ({ settings: { piBinaryPath: "", piAgentDir: "" } }),
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => navigate,
}));

function taskFixture(overrides: Partial<KanbanTask>): KanbanTask {
  return {
    taskId: "t_0000000000" as KanbanTaskId,
    title: "Untitled task",
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

function boardFixture(): KanbanBoard {
  return {
    projectId: PROJECT_ID,
    projectTitle: "PeakCode",
    workspaceRoot: "/tmp/peakcode",
    boardFilePath: "/tmp/peakcode/.kanban/board.json",
    columns: [
      { key: "todo", name: "To do", dot: "#9CA3AF" },
      { key: "in_progress", name: "In progress", dot: "#3B82F6" },
    ],
    tasks: [
      taskFixture({ taskId: "t_29b8116000" as KanbanTaskId, title: "Draft the board header" }),
      taskFixture({
        taskId: "t_1111111111" as KanbanTaskId,
        title: "Hand the task to the agent",
        status: "in_progress",
        priority: "high",
        agentRunStatus: "running",
      }),
    ],
    updatedAt: null,
  };
}

/** Renders the board on a project that has one. */
async function mountBoard() {
  api.listProjects.mockResolvedValue({
    projects: [
      {
        projectId: PROJECT_ID,
        title: "PeakCode",
        workspaceRoot: "/tmp/peakcode",
        defaultModelSelection: null,
        hasBoard: true,
        taskCount: 2,
        todoCount: 1,
        inProgressCount: 1,
        doneCount: 0,
        blockedCount: 0,
        updatedAt: null,
      },
    ],
  });
  api.getBoard.mockImplementation(async () => boardFixture());
  api.listModels.mockResolvedValue({ models: [] });

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const screen = await render(
    <QueryClientProvider client={client}>
      <I18nProvider language="en">
        <KanbanView />
      </I18nProvider>
    </QueryClientProvider>,
  );

  await expect.element(page.getByRole("button", { name: "New task", exact: true })).toBeVisible();
  return screen;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  window.localStorage.clear();
});

it("opens the create page instead of a dialog", async () => {
  const screen = await mountBoard();

  // Exact: the per-column "+" buttons are named "New task · <column>".
  await page.getByRole("button", { name: "New task", exact: true }).click();

  await expect
    .poll(() => navigate.mock.calls[0]?.[0])
    .toEqual({ to: "/kanban/new", search: { project: PROJECT_ID, status: "todo" } });
  // No form is rendered over the board: creation is a page now.
  expect(screen.container.querySelector('input[aria-label="Task title"]')).toBeNull();
  expect(screen.container.textContent).not.toContain("Task title");
});

it("carries the clicked column along as the initial status", async () => {
  await mountBoard();

  await page.getByRole("button", { name: "New task · In progress" }).click();
  await expect
    .poll(() => navigate.mock.calls[0]?.[0])
    .toEqual({ to: "/kanban/new", search: { project: PROJECT_ID, status: "in_progress" } });
});

it("draws the board chrome: work-item codes, agent state, and the left menu", async () => {
  const screen = await mountBoard();
  await expect.poll(() => screen.container.querySelectorAll("[data-kanban-card]").length).toBe(2);

  // The card code is derived from the task id and the project title.
  expect(screen.container.querySelector("[data-kanban-task-code]")?.textContent).toBe("PC-29B8");
  // The running task marks its agent state on the card.
  expect(screen.container.querySelector('[data-kanban-agent-run="running"]')).not.toBeNull();
  // The left menu carries the project and the status filters with their counts.
  expect(screen.container.querySelector("[data-kanban-sidebar]")).not.toBeNull();
  expect(screen.container.querySelector(`[data-kanban-project="${PROJECT_ID}"]`)).not.toBeNull();
  expect(
    screen.container.querySelector('[data-kanban-filter="status-in_progress"]'),
  ).not.toBeNull();
});

it("narrows the columns from the left menu", async () => {
  const screen = await mountBoard();

  await page.getByRole("button", { name: /^To do/ }).click();

  await expect.poll(() => screen.container.querySelectorAll("[data-kanban-card]").length).toBe(1);
  // The board is filtered, not rebuilt: the in-progress column reports no matches.
  expect(screen.container.textContent).toContain("No matches");
});

it("switches to the list view over the same tasks", async () => {
  const screen = await mountBoard();

  await page.getByRole("button", { name: "List view" }).click();

  await expect.poll(() => screen.container.querySelectorAll("[data-kanban-row]").length).toBe(2);
  expect(screen.container.querySelector("[data-kanban-column]")).toBeNull();
});
