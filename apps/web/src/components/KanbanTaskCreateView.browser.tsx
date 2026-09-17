// FILE: KanbanTaskCreateView.browser.tsx
// Purpose: Locks in the full-page creation flow: it drafts a requirement from the
//          title before the task exists, submits every field the old dialog
//          carried, returns to the board on success, and asks before leaving with
//          unsaved input.
// Layer: Component browser tests

import "../index.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import type { KanbanBoard, KanbanCreateTaskInput, ProjectId } from "@peakcode/contracts";

import { I18nProvider } from "../i18n";
import { KanbanTaskCreateView } from "./KanbanTaskCreateView";

const PROJECT_ID = "p_task_create" as ProjectId;
const TITLE = "Ship the create page";
const NOTES = "先按我的想法写一版";
const BRIEF = [
  "## Goal",
  "Ship the create page.",
  "",
  "## Acceptance",
  "- [ ] The brief lands in the requirements field",
].join("\n");

const api = vi.hoisted(() => ({
  listProjects: vi.fn(),
  getBoard: vi.fn(),
  createTask: vi.fn(),
  generateRequirementDraft: vi.fn(),
  listModels: vi.fn(),
}));
const navigate = vi.hoisted(() => vi.fn());
const blocker = vi.hoisted(() => vi.fn());

vi.mock("../nativeApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../nativeApi")>()),
  ensureNativeApi: () => ({ kanban: api, provider: { listModels: api.listModels } }),
}));
// The create page only reads these two settings; the real hook also queries the
// server, which this view does not need in order to render.
vi.mock("../appSettings", () => ({
  useAppSettings: () => ({ settings: { piBinaryPath: "", piAgentDir: "" } }),
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => navigate,
  useBlocker: blocker,
}));
// The sidebar module pulls in the app's stores and drag-and-drop wiring; the view
// only needs its frame.
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

async function mountCreatePage() {
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
        <KanbanTaskCreateView projectId={PROJECT_ID} initialStatus="todo" />
      </I18nProvider>
    </QueryClientProvider>,
  );
  await expect.element(page.getByRole("textbox", { name: "Task title" })).toBeVisible();
  return screen;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

it("drafts the requirement from the title before the task exists", async () => {
  await mountCreatePage();

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
  // Success lands back on the board.
  await expect.poll(() => navigate.mock.calls[0]?.[0]).toEqual({ to: "/kanban" });
});

it("submits every field the dialog carried", async () => {
  await mountCreatePage();

  await page.getByRole("textbox", { name: "Task title" }).fill("Wire the pipeline");
  await page.getByRole("textbox", { name: "Requirements" }).fill("Acceptance criteria here");
  await page.getByRole("button", { name: "High" }).click();
  await page.getByRole("textbox", { name: "Pipeline" }).fill("Full-stack pipeline");
  await page.getByRole("textbox", { name: "Assignee" }).fill("Full-stack dev");
  await page.getByRole("button", { name: "Create" }).click();

  await expect
    .poll(() => api.createTask.mock.calls[0]?.[0])
    .toEqual({
      projectId: PROJECT_ID,
      title: "Wire the pipeline",
      description: "Acceptance criteria here",
      status: "todo",
      priority: "high",
      pipeline: "Full-stack pipeline",
      assignee: "Full-stack dev",
      agentProvider: "pi",
      agentModel: "",
    });
});

it("asks before replacing requirements the user already wrote", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  await mountCreatePage();

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

it("leaves for the board without creating when cancelled clean", async () => {
  const confirm = vi.spyOn(window, "confirm");
  await mountCreatePage();

  await page.getByRole("button", { name: "Cancel" }).click();

  expect(confirm).not.toHaveBeenCalled();
  expect(api.createTask).not.toHaveBeenCalled();
  await expect.poll(() => navigate.mock.calls[0]?.[0]).toEqual({ to: "/kanban" });
});

it("asks before cancelling with unsaved input", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  await mountCreatePage();

  await page.getByRole("textbox", { name: "Task title" }).fill(TITLE);
  await page.getByRole("button", { name: "Cancel" }).click();
  // Staying keeps the draft and creates nothing.
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(api.createTask).not.toHaveBeenCalled();
  expect(navigate).not.toHaveBeenCalled();

  confirm.mockReturnValue(true);
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect.poll(() => navigate.mock.calls[0]?.[0]).toEqual({ to: "/kanban" });
});

it("guards a route change while the draft is dirty", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  await mountCreatePage();

  // Clean page: the guard is off.
  expect(blocker.mock.calls.at(-1)?.[0]?.disabled).toBe(true);

  await page.getByRole("textbox", { name: "Task title" }).fill(TITLE);

  const opts = blocker.mock.calls.at(-1)?.[0];
  expect(opts?.disabled).toBe(false);
  expect(opts?.enableBeforeUnload).toBe(true);
  // Declining the confirm blocks the navigation.
  expect(opts?.shouldBlockFn()).toBe(true);
  confirm.mockReturnValue(true);
  expect(blocker.mock.calls.at(-1)?.[0]?.shouldBlockFn()).toBe(false);
});
