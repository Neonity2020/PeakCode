// FILE: AutomationsView.browser.tsx
// Purpose: Locks in what the automations editor sends: a described job, the workspace it
//          runs in, and the plan — plus that pausing a card keeps the task and just stops
//          its next run.
// Layer: Component browser tests

import "../index.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import type {
  Automation,
  AutomationId,
  CreateAutomationInput,
  ProjectId,
} from "@peakcode/contracts";

import { I18nProvider } from "../i18n";
import { AutomationsView } from "./AutomationsView";

const PROJECT_ID = "p_automations" as ProjectId;
const AUTOMATION_ID = "automation_1" as AutomationId;
const WORKSPACE_ROOT = "/tmp/peakcode";
const TITLE = "Morning briefing";
const INSTRUCTIONS = "Summarise yesterday's commits into reports/daily.md.";

const api = vi.hoisted(() => ({
  list: vi.fn(),
  listRuns: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  run: vi.fn(),
}));
const navigate = vi.hoisted(() => vi.fn());

vi.mock("../nativeApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../nativeApi")>()),
  ensureNativeApi: () => ({ automation: api }),
}));
// The picker reads the sidebar's project store; the view only needs the workspaces.
vi.mock("../store", () => ({
  useStore: (select: (state: { projects: unknown[] }) => unknown) =>
    select({
      projects: [
        {
          id: PROJECT_ID,
          kind: "project",
          name: "PeakCode",
          remoteName: "origin",
          folderName: "peakcode",
          localName: null,
          cwd: WORKSPACE_ROOT,
          defaultModelSelection: null,
          expanded: true,
          scripts: [],
        },
      ],
    }),
}));
vi.mock("../latestProjectStore", () => ({
  useLatestProjectStore: (select: (state: { latestProjectId: ProjectId }) => unknown) =>
    select({ latestProjectId: PROJECT_ID }),
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => navigate,
}));
// The view only needs the sidebar's timestamp helper.
vi.mock("./Sidebar", () => ({ formatRelativeTime: () => "2h" }));

const automationFixture = (overrides: Partial<Automation> = {}): Automation =>
  ({
    automationId: AUTOMATION_ID,
    projectId: PROJECT_ID,
    title: TITLE,
    instructions: INSTRUCTIONS,
    schedule: { kind: "daily", hour: 9, minute: 0 },
    timezone: "UTC",
    mode: "default",
    isEnabled: true,
    nextRunAt: "2026-09-17T09:00:00.000Z",
    lastRunAt: null,
    lastRunStatus: null,
    createdAt: "2026-09-16T00:00:00.000Z",
    updatedAt: "2026-09-16T00:00:00.000Z",
    ...overrides,
  }) as Automation;

const renderView = async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider language="en">
        <AutomationsView />
      </I18nProvider>
    </QueryClientProvider>,
  );
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

it("creates a task from the description, the workspace and the plan the user picked", async () => {
  api.list.mockResolvedValue([]);
  api.create.mockResolvedValue(automationFixture());
  await renderView();

  await page.getByRole("button", { name: "New automation" }).click();
  await expect.element(page.getByRole("textbox", { name: "Task name" })).toBeVisible();

  await page.getByRole("textbox", { name: "Task name" }).fill(TITLE);
  await page.getByRole("textbox", { name: "What should it do?" }).fill(INSTRUCTIONS);

  // A weekly plan at 18:30 on Tuesdays and Thursdays. A weekly plan starts on the work
  // days, so the other three are toggled off and Tuesday/Thursday stay selected.
  await page.getByRole("combobox", { name: "Plan" }).selectOptions("weekly");
  const timeInputs = page.getByRole("spinbutton");
  await timeInputs.nth(0).fill("18");
  await timeInputs.nth(1).fill("30");
  for (const day of ["Mon", "Wed", "Fri"]) {
    await page.getByRole("button", { name: day }).click();
  }
  await page.getByRole("combobox", { name: "Mode" }).selectOptions("plan");

  await page.getByRole("button", { name: "Create" }).click();

  await expect
    .poll(() => api.create.mock.calls[0]?.[0])
    .toEqual({
      projectId: PROJECT_ID,
      title: TITLE,
      instructions: INSTRUCTIONS,
      schedule: { kind: "weekly", hour: 18, minute: 30, daysOfWeek: [2, 4] },
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      mode: "plan",
    } satisfies CreateAutomationInput);
});

it("shows a task's plan, workspace and instructions, and pauses it without deleting it", async () => {
  api.list.mockResolvedValue([automationFixture()]);
  api.listRuns.mockResolvedValue([]);
  api.update.mockResolvedValue(automationFixture({ isEnabled: false }));
  await renderView();

  await expect.element(page.getByText(TITLE)).toBeVisible();
  await expect.element(page.getByText(INSTRUCTIONS)).toBeVisible();
  await expect.element(page.getByText("Every day 09:00")).toBeVisible();
  await expect.element(page.getByText("PeakCode")).toBeVisible();
  await expect.element(page.getByText("No runs yet.")).toBeVisible();

  await page.getByRole("button", { name: "Pause" }).click();

  await expect
    .poll(() => api.update.mock.calls[0]?.[0])
    .toEqual({
      automationId: AUTOMATION_ID,
      isEnabled: false,
    });
});

it("keeps the create button unavailable until a task has a description", async () => {
  api.list.mockResolvedValue([]);
  await renderView();

  await page.getByRole("button", { name: "New automation" }).click();
  const create = page.getByRole("button", { name: "Create" });
  await expect.element(create).toBeDisabled();

  await page.getByRole("textbox", { name: "Task name" }).fill(TITLE);
  await expect.element(create).toBeDisabled();

  await page.getByRole("textbox", { name: "What should it do?" }).fill(INSTRUCTIONS);
  await expect.element(create).toBeEnabled();
});
