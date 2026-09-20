// Render test for the phone page's list: what a paired device sees about this computer.
// It runs at a phone viewport on purpose — this surface only exists at that size.
import { page } from "vitest/browser";

import "../index.css";

import type { OrchestrationProjectShell, OrchestrationThreadShell } from "@peakcode/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { I18nProvider } from "../i18n";
import { RemoteControlApp, TaskListScreen } from "./RemoteControlApp";

const project = (id: string, title: string): OrchestrationProjectShell =>
  ({ id, title, kind: "project" }) as OrchestrationProjectShell;

const thread = (
  id: string,
  title: string,
  projectId: string,
  overrides: Partial<OrchestrationThreadShell> = {},
): OrchestrationThreadShell =>
  ({
    id,
    title,
    projectId,
    archivedAt: null,
    parentThreadId: null,
    latestTurn: null,
    latestUserMessageAt: null,
    session: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    updatedAt: new Date().toISOString(),
    ...overrides,
  }) as OrchestrationThreadShell;

function renderList(
  threads: ReadonlyArray<OrchestrationThreadShell>,
  projects: ReadonlyArray<OrchestrationProjectShell> = [project("p1", "PeakCode")],
) {
  return render(
    <I18nProvider language="zh">
      <TaskListScreen
        connection="connected"
        projects={projects}
        threads={threads}
        highlightedProjectId={null}
        refresh={() => {}}
        refreshing={false}
        onOpenThread={() => {}}
      />
    </I18nProvider>,
  );
}

beforeEach(async () => {
  await page.viewport(390, 844);
});

describe("the phone's task list", () => {
  it("shows the connection, the workspace count and each task's state", async () => {
    const screen = await renderList([
      thread("t1", "GitHub Issues 分类处理", "p1", {
        latestTurn: { state: "running" } as never,
        latestUserMessageAt: new Date().toISOString(),
      }),
      thread("t2", "进程反复启动退出原因排查", "p1", {
        latestTurn: { state: "completed" } as never,
        latestUserMessageAt: new Date().toISOString(),
      }),
      thread("t3", "等待确认的任务", "p1", {
        latestTurn: { state: "running" } as never,
        hasPendingApprovals: true,
        latestUserMessageAt: new Date().toISOString(),
      }),
    ]);

    await expect.element(screen.getByText("Peak Code 远程控制")).toBeVisible();
    await expect.element(screen.getByText("已连接到当前桌面窗口")).toBeVisible();
    await expect.element(screen.getByText("1 个工作区 · 3 个任务")).toBeVisible();
    await expect.element(screen.getByText("GitHub Issues 分类处理")).toBeVisible();
    await expect.element(screen.getByText("运行中", { exact: true })).toBeVisible();
    await expect.element(screen.getByText("已完成", { exact: true })).toBeVisible();
    // A question waiting for a person is what the phone is for; it outranks "running".
    await expect.element(screen.getByText("待确认", { exact: true })).toBeVisible();
    await expect.element(screen.getByText("今天")).toBeVisible();

    await screen.unmount();
  });

  it("hides drafts and archived rows, and explains the link when it is dead", async () => {
    const screen = await renderList([
      thread("draft", "空草稿", "p1"),
      thread("archived", "旧任务", "p1", {
        archivedAt: "2026-09-01T00:00:00.000Z",
        latestTurn: { state: "completed" } as never,
      }),
    ]);

    await expect.element(screen.getByText("这台电脑上还没有任务。")).toBeVisible();
    expect(screen.container.textContent).not.toContain("空草稿");
    expect(screen.container.textContent).not.toContain("旧任务");
    await screen.unmount();

    const offline = await render(
      <I18nProvider language="zh">
        <TaskListScreen
          connection="unavailable"
          projects={[]}
          threads={[]}
          highlightedProjectId={null}
          refresh={() => {}}
          refreshing={false}
          onOpenThread={() => {}}
        />
      </I18nProvider>,
    );
    await expect.element(offline.getByText("未连接")).toBeVisible();
    await expect.element(offline.getByText("重试连接")).toBeVisible();
    await expect
      .element(offline.getByText(/请回到桌面端点击手机图标重新扫码/).first())
      .toBeVisible();
    await offline.unmount();
  });

  it("opens a task when it is tapped", async () => {
    const onOpenThread = vi.fn();
    const screen = await render(
      <I18nProvider language="zh">
        <TaskListScreen
          connection="connected"
          projects={[project("p1", "PeakCode")]}
          threads={[
            thread("t1", "点一下", "p1", {
              latestTurn: { state: "completed" } as never,
              latestUserMessageAt: new Date().toISOString(),
            }),
          ]}
          highlightedProjectId={null}
          refresh={() => {}}
          refreshing={false}
          onOpenThread={onOpenThread}
        />
      </I18nProvider>,
    );

    await screen.getByText("点一下").click();

    expect(onOpenThread).toHaveBeenCalledWith("t1");
    await screen.unmount();
  });
});

// The conversation screen is reached from the list, so its transport and reply-model
// defaults are stubbed to drive the reply box on its own.
vi.mock("./useConversation", () => ({
  useConversation: () => ({
    status: "connected",
    title: "点一下",
    messages: [],
    pendingApproval: null,
    running: false,
    lastActivitySummary: null,
    sending: false,
    error: null,
    modelSelection: null,
    runtimeMode: "approval-required",
    interactionMode: "default",
    send: vi.fn(),
    stop: vi.fn(),
    respondToApproval: vi.fn(),
  }),
}));
vi.mock("./useDeviceSnapshot", () => ({
  useDeviceSnapshot: () => ({
    connection: "connected",
    projects: [{ id: "p1", title: "PeakCode", kind: "project" }],
    threads: [
      {
        id: "t1",
        title: "点一下",
        projectId: "p1",
        archivedAt: null,
        parentThreadId: null,
        latestTurn: { state: "completed" },
        latestUserMessageAt: new Date().toISOString(),
        session: null,
        hasPendingApprovals: false,
        hasPendingUserInput: false,
        updatedAt: new Date().toISOString(),
      },
    ],
    refresh: () => {},
    refreshing: false,
  }),
}));
vi.mock("./useReplyModel", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./useReplyModel")>()),
  useReplyModelDefaults: () => ({ offeredSlugs: [], defaultSelection: null }),
}));

describe("a reply on the phone", () => {
  it("survives leaving the conversation and coming back to it", async () => {
    const screen = await render(
      <I18nProvider language="zh">
        <RemoteControlApp initialThreadId="t1" highlightedProjectId={null} />
      </I18nProvider>,
    );

    await page.getByRole("textbox").fill("先在手机上写一半");
    // Back to the task list — this unmounts the conversation screen…
    await page.getByRole("button", { name: "返回" }).click();
    await expect.element(page.getByRole("textbox")).not.toBeInTheDocument();

    // …and reopening the same task finds the reply still being written.
    await page.getByRole("button", { name: /点一下/ }).click();
    await expect.element(page.getByRole("textbox")).toHaveValue("先在手机上写一半");
    await screen.unmount();
  });
});
