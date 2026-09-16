// FILE: KanbanView.browser.tsx
// Purpose: Locks in how the create dialog drafts a task's requirement. The agent
//          works from the title and whatever the user already wrote, the brief
//          lands in the description field for review, and nothing reaches the
//          board until the task is actually created.
// Layer: Component browser tests

import "../index.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import type { KanbanBoard, KanbanCreateTaskInput, ProjectId } from "@peakcode/contracts";

import { I18nProvider } from "../i18n";
import { KanbanView } from "./KanbanView";

const PROJECT_ID = "p_kanban_view" as ProjectId;
const TITLE = "Ship the create dialog";
const NOTES = "先按我的想法写一版";
const BRIEF = [
  "## Goal",
  "Ship the create dialog.",
  "",
  "## Acceptance",
  "- [ ] The brief lands in the description field",
].join("\n");

const api = vi.hoisted(() => ({
  listProjects: vi.fn(),
  getBoard: vi.fn(),
  createTask: vi.fn(),
  generateRequirementDraft: vi.fn(),
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

/** Renders the board and opens the create dialog on a project that has one. */
async function openCreateDialog() {
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
  api.createTask.mockImplementation(async () => boardFixture());
  api.generateRequirementDraft.mockResolvedValue({ requirement: BRIEF });
  api.listModels.mockResolvedValue({ models: [] });

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const screen = await render(
    <QueryClientProvider client={client}>
      <I18nProvider language="en">
        <KanbanView />
      </I18nProvider>
    </QueryClientProvider>,
  );

  // Exact: the per-column "+" buttons are named "New task · <column>".
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await expect.element(page.getByRole("textbox", { name: "Task title" })).toBeVisible();
  return screen;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

it("drafts the requirement from the title before the task exists", async () => {
  await openCreateDialog();

  // Without a title there is nothing to draft a brief from.
  const generate = page.getByRole("button", { name: "Generate" });
  await expect.element(generate).toBeDisabled();

  await page.getByRole("textbox", { name: "Task title" }).fill(TITLE);
  await expect.element(generate).toBeEnabled();
  await generate.click();

  await expect
    .poll(() => api.generateRequirementDraft.mock.calls[0]?.[0])
    .toEqual({
      projectId: PROJECT_ID,
      title: TITLE,
      agentProvider: "pi",
    });
  await expect.element(page.getByRole("textbox", { name: "Requirements" })).toHaveValue(BRIEF);

  // Creating stores what is on screen; the draft alone never touches the board.
  await page.getByRole("button", { name: "Create" }).click();
  await expect
    .poll(() => api.createTask.mock.calls[0]?.[0])
    .toMatchObject({
      projectId: PROJECT_ID,
      title: TITLE,
      description: BRIEF,
    } satisfies Partial<KanbanCreateTaskInput>);
});

it("asks before replacing requirements the user already wrote", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  await openCreateDialog();

  await page.getByRole("textbox", { name: "Task title" }).fill(TITLE);
  const description = page.getByRole("textbox", { name: "Requirements" });
  await description.fill(NOTES);

  await page.getByRole("button", { name: "Generate" }).click();
  expect(api.generateRequirementDraft).not.toHaveBeenCalled();

  confirm.mockReturnValue(true);
  await page.getByRole("button", { name: "Generate" }).click();

  await expect
    .poll(() => api.generateRequirementDraft.mock.calls[0]?.[0])
    .toEqual({
      projectId: PROJECT_ID,
      title: TITLE,
      notes: NOTES,
      agentProvider: "pi",
    });
  await expect.element(description).toHaveValue(BRIEF);
});
