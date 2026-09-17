// FILE: KanbanView.browser.tsx
// Purpose: Locks in that creating a task leaves the board for the full create
//          page instead of opening a dialog: the clicked column travels along as
//          the initial status, and no form is rendered over the board.
// Layer: Component browser tests

import "../index.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import type { KanbanBoard, ProjectId } from "@peakcode/contracts";

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
// The sidebar module pulls in the app's stores and drag-and-drop wiring; the board
// only needs its timestamp helper.
vi.mock("./Sidebar", () => ({ formatRelativeTime: () => "just now" }));

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
    tasks: [],
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
        taskCount: 0,
        todoCount: 0,
        inProgressCount: 0,
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
