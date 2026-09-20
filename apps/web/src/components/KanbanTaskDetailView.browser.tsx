// FILE: KanbanTaskDetailView.browser.tsx
// Purpose: Locks in how the detail page treats a task's requirement. It reads as
//          the full brief instead of a short editor, defaulting to read-only so a
//          rewrite takes an explicit action, and the header form never carries the
//          requirement at all — follow-ups belong in the comments below.
// Layer: Component browser tests

import "../index.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import type {
  KanbanBoard,
  KanbanComment,
  KanbanTaskDetail,
  KanbanTaskId,
  KanbanUpdateTaskInput,
  ProjectId,
} from "@peakcode/contracts";

import { I18nProvider } from "../i18n";
import { KanbanTaskDetailView } from "./KanbanTaskDetailView";

const PROJECT_ID = "p_task_detail" as ProjectId;
const TASK_ID = "t_task_detail" as KanbanTaskId;

/** Long enough that a four-row editor would cut the acceptance criteria off. */
const REQUIREMENT = [
  "## Goal",
  "Add Plan, Goal and Agent modes to the composer.",
  "",
  "## Acceptance",
  "- [ ] Only one mode is selected at a time",
  "- [ ] The draft survives a mode switch",
  "- [ ] Send the selected mode with the message",
].join("\n");
const REWRITTEN_REQUIREMENT = "## Goal\nKeep it short.";

const api = vi.hoisted(() => ({
  getTaskDetail: vi.fn(),
  updateTask: vi.fn(),
  addTaskComment: vi.fn(),
  generateTaskRequirement: vi.fn(),
  generateRequirementDraft: vi.fn(),
  listModels: vi.fn(),
}));
const navigate = vi.hoisted(() => vi.fn());
const blocker = vi.hoisted(() => vi.fn());

vi.mock("../nativeApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../nativeApi")>()),
  ensureNativeApi: () => ({ kanban: api, provider: { listModels: api.listModels } }),
}));
// The detail page only reads these two settings; the real hook also queries the
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
// only needs its timestamp helper.
vi.mock("./Sidebar", () => ({ formatRelativeTime: () => "just now" }));

/** What the board file holds right now; the detail query always re-reads it. */
let storedRequirement = REQUIREMENT;
let storedComments: KanbanComment[] = [];
/** The header title as the board holds it, so a save is visible to the next poll. */
let storedTitle = "Mode switcher";

function detailFixture(): KanbanTaskDetail {
  return {
    projectId: PROJECT_ID,
    projectTitle: "PeakCode",
    boardFilePath: "/tmp/peakcode/.kanban/board.json",
    workspaceRoot: "/tmp/peakcode",
    task: {
      taskId: TASK_ID,
      title: storedTitle,
      description: storedRequirement,
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
    },
    comments: storedComments,
  };
}

function boardFixture(): KanbanBoard {
  return {
    projectId: PROJECT_ID,
    projectTitle: "PeakCode",
    workspaceRoot: "/tmp/peakcode",
    boardFilePath: "/tmp/peakcode/.kanban/board.json",
    columns: [{ key: "todo", name: "To do", dot: "#9CA3AF" }],
    tasks: [],
    updatedAt: null,
  };
}

async function mountDetail(description: string = REQUIREMENT, comments: KanbanComment[] = []) {
  storedRequirement = description;
  storedComments = comments;
  storedTitle = "Mode switcher";
  api.getTaskDetail.mockImplementation(async () => detailFixture());
  api.updateTask.mockImplementation(async (input: KanbanUpdateTaskInput) => {
    if (typeof input.description === "string") {
      storedRequirement = input.description;
    }
    if (typeof input.title === "string") {
      storedTitle = input.title;
    }
    return boardFixture();
  });
  api.listModels.mockResolvedValue({ models: [] });

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const screen = await render(
    <QueryClientProvider client={client}>
      <I18nProvider language="en">
        <KanbanTaskDetailView projectId={PROJECT_ID} taskId={TASK_ID} />
      </I18nProvider>
    </QueryClientProvider>,
  );
  await expect.element(page.getByRole("button", { name: "Edit" })).toBeVisible();
  // The client comes back too, so a test can drive the board poll by hand.
  return Object.assign(screen, { client });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

it("reads the whole requirement as text and rewrites it only on request", async () => {
  const screen = await mountDetail();

  const requirement = screen.container.querySelector<HTMLElement>(
    '[data-kanban-requirement="read"]',
  );
  expect(requirement).not.toBeNull();
  expect(requirement?.textContent).toContain("Send the selected mode with the message");
  // Read-only by default: the brief is text, not an editor.
  expect(requirement?.querySelector("textarea")).toBeNull();
  expect(screen.container.querySelectorAll("textarea")).toHaveLength(1);

  await page.getByRole("button", { name: "Edit" }).click();
  const editor = page.getByRole("textbox", { name: "Requirements", exact: true });
  await expect.element(editor).toBeVisible();
  await editor.fill(REWRITTEN_REQUIREMENT);
  await page.getByRole("button", { name: "Save requirements" }).click();

  // A rewrite patches the requirement alone.
  await expect
    .poll(() => api.updateTask.mock.calls[0]?.[0])
    .toEqual({
      projectId: PROJECT_ID,
      taskId: TASK_ID,
      description: REWRITTEN_REQUIREMENT,
    });
  // …and the section goes back to read-only, showing what was stored.
  await expect.element(page.getByText("Keep it short.")).toBeVisible();
  await expect.element(editor).not.toBeInTheDocument();
});

it("leaves the requirement out of header saves", async () => {
  await mountDetail();

  await page.getByRole("textbox", { name: "Task title", exact: true }).fill("Mode switcher v2");
  await page.getByRole("button", { name: "Save" }).click();

  await expect
    .poll(() => api.updateTask.mock.calls[0]?.[0])
    .toEqual({
      projectId: PROJECT_ID,
      taskId: TASK_ID,
      title: "Mode switcher v2",
      status: "todo",
      priority: "medium",
      agentProvider: "pi",
      agentModel: "",
    });
});

it("keeps a task that has no requirement in the read view too", async () => {
  const screen = await mountDetail("");

  const requirement = screen.container.querySelector<HTMLElement>(
    '[data-kanban-requirement="read"]',
  );
  expect(requirement?.textContent).toContain("No requirements yet");
  expect(requirement?.querySelector("textarea")).toBeNull();
});

it("rewrites the stored brief from read mode", async () => {
  const rewritten = "## Goal\nRewritten by the agent";
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  api.generateTaskRequirement.mockImplementation(async () => {
    storedRequirement = rewritten;
    const detail = detailFixture();
    return { ...detail, task: { ...detail.task, description: rewritten } };
  });
  await mountDetail();

  await page.getByRole("button", { name: "Generate" }).click();

  await expect
    .poll(() => api.generateTaskRequirement.mock.calls[0]?.[0])
    .toEqual({
      projectId: PROJECT_ID,
      taskId: TASK_ID,
    });
  await expect.element(page.getByText("Rewritten by the agent")).toBeVisible();
  confirm.mockRestore();
});

it("drafts from the requirement being written and pastes the brief back", async () => {
  const brief = "## Goal\nMode switcher.\n\n## Acceptance\n- [ ] One mode at a time";
  api.generateRequirementDraft.mockResolvedValue({ requirement: brief });
  await mountDetail();

  await page.getByRole("button", { name: "Edit" }).click();
  const editor = page.getByRole("textbox", { name: "Requirements", exact: true });
  await editor.fill("Add a mode switcher to the composer");

  // Generating works while the requirement is being written; it refines what is
  // in the editor instead of forcing a save first.
  const generate = page.getByRole("button", { name: "Generate" });
  await expect.element(generate).toBeEnabled();
  await generate.click();

  await expect
    .poll(() => api.generateRequirementDraft.mock.calls[0]?.[0])
    .toEqual({
      projectId: PROJECT_ID,
      title: "Mode switcher",
      notes: "Add a mode switcher to the composer",
      agentProvider: "pi",
    });
  await expect.element(editor).toHaveValue(brief);
  // The brief stays in the editor until it is saved: nothing was stored for you.
  expect(api.updateTask).not.toHaveBeenCalled();
  expect(api.generateTaskRequirement).not.toHaveBeenCalled();
});

it("keeps an edit in the header while the board polls underneath it", async () => {
  const screen = await mountDetail();
  const title = page.getByRole("textbox", { name: "Task title", exact: true });

  await title.fill("Mode switcher v2");

  // The agent moved the card and commented on it, so the next poll brings a different
  // task back. That used to re-seed the form and revert the title mid-edit.
  api.getTaskDetail.mockImplementation(async () => {
    const detail = detailFixture();
    return { ...detail, task: { ...detail.task, status: "in_progress" } };
  });
  await screen.client.invalidateQueries({ queryKey: ["kanban"] });
  await expect.poll(() => api.getTaskDetail.mock.calls.length).toBeGreaterThan(1);

  await expect.element(title).toHaveValue("Mode switcher v2");

  // Saving stays possible, and it is the saved values the board then holds.
  await page.getByRole("button", { name: "Save" }).click();
  await expect
    .poll(() => api.updateTask.mock.calls.at(-1)?.[0])
    .toEqual({
      projectId: PROJECT_ID,
      taskId: TASK_ID,
      title: "Mode switcher v2",
      status: "todo",
      priority: "medium",
      agentProvider: "pi",
      agentModel: "",
    });

  // An untouched form does follow the board, though: the agent's own move shows up.
  api.getTaskDetail.mockImplementation(async () => {
    const detail = detailFixture();
    return { ...detail, task: { ...detail.task, status: "done" } };
  });
  await screen.client.invalidateQueries({ queryKey: ["kanban"] });
  await expect
    .element(page.getByRole("combobox", { name: "Status", exact: true }))
    .toHaveTextContent("Done");
});

it("arms the leave guard while an edit is unsaved and drops it once saved", async () => {
  await mountDetail();

  // Clean page: nothing to lose, so the guard is off.
  expect(blocker.mock.calls.at(-1)?.[0]?.disabled).toBe(true);

  await page.getByRole("textbox", { name: "Task title", exact: true }).fill("Mode switcher v2");
  const guard = blocker.mock.calls.at(-1)?.[0];
  expect(guard?.disabled).toBe(false);
  expect(guard?.enableBeforeUnload).toBe(true);

  await page.getByRole("button", { name: "Save" }).click();
  await expect.poll(() => api.updateTask.mock.calls.length).toBeGreaterThan(0);
  await expect.poll(() => blocker.mock.calls.at(-1)?.[0]?.disabled).toBe(true);
});

it("explains a failed run instead of only quoting the provider", async () => {
  await mountDetail(REQUIREMENT, [
    {
      commentId: "c_failed",
      author: "agent",
      kind: "status",
      statusCode: "failed",
      body:
        "Error code: 403 - {'error': {'message': 'key not allowed to access model. This key can " +
        "only access models=[\\'deepseek-v4-flash\\']. Tried to access deepseek-v4.1', " +
        "'type': 'key_model_access_denied', 'code': '403'}}",
      createdAt: "2026-09-16T09:00:00Z",
    },
  ]);

  // What to do about it reads first…
  await expect.element(page.getByText(/not allowed for the configured key/)).toBeVisible();
  // …and the provider's own text stays underneath as the evidence.
  await expect.element(page.getByText(/key_model_access_denied/)).toBeVisible();
});
