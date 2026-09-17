// FILE: storeSelectors.test.ts
// Purpose: Guard the sidebar display selector so every non-archived conversation
// (including subagent sessions) reaches the sidebar thread list.

import { ProjectId, ThreadId } from "@peakcode/contracts";
import { describe, expect, it } from "vitest";

import {
  deriveSidebarProjectData,
  groupSidebarThreadsByProjectId,
  sortThreadsForSidebar,
} from "./components/Sidebar.logic";
import {
  createSidebarDisplayThreadsSelector,
  selectDisplayableSidebarThreads,
} from "./storeSelectors";
import type { AppState } from "./store";
import { DEFAULT_INTERACTION_MODE, type Project, type SidebarThreadSummary } from "./types";

function makeSummary(overrides: Partial<SidebarThreadSummary> = {}): SidebarThreadSummary {
  return {
    id: ThreadId.makeUnsafe("thread-1"),
    projectId: ProjectId.makeUnsafe("project-1"),
    title: "Thread",
    modelSelection: { provider: "pi", model: "gpt-5.4" },
    interactionMode: DEFAULT_INTERACTION_MODE,
    branch: null,
    worktreePath: null,
    session: null,
    createdAt: "2026-03-09T10:00:00.000Z",
    updatedAt: "2026-03-09T10:00:00.000Z",
    latestTurn: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    hasLiveTailWork: false,
    parentThreadId: null,
    archivedAt: null,
    ...overrides,
  };
}

function makeState(summaries: readonly SidebarThreadSummary[]): AppState {
  const sidebarThreadSummaryById = Object.fromEntries(
    summaries.map((summary) => [summary.id, summary]),
  ) as Record<string, SidebarThreadSummary>;
  return {
    threadIds: summaries.map((summary) => summary.id),
    sidebarThreadSummaryById,
  } as unknown as AppState;
}

describe("selectDisplayableSidebarThreads", () => {
  it("keeps root conversations and their subagent sessions", () => {
    const root = makeSummary({ id: ThreadId.makeUnsafe("thread-root") });
    const child = makeSummary({
      id: ThreadId.makeUnsafe("thread-child"),
      parentThreadId: root.id,
      subagentAgentId: "agent-1",
    });

    expect(selectDisplayableSidebarThreads([root, child]).map((thread) => thread.id)).toEqual([
      root.id,
      child.id,
    ]);
  });

  it("still hides archived conversations even when they have children", () => {
    const archivedRoot = makeSummary({
      id: ThreadId.makeUnsafe("thread-archived"),
      archivedAt: "2026-03-09T11:00:00.000Z",
    });
    const liveChild = makeSummary({
      id: ThreadId.makeUnsafe("thread-live-child"),
      parentThreadId: archivedRoot.id,
      subagentAgentId: "agent-1",
    });
    const liveRoot = makeSummary({ id: ThreadId.makeUnsafe("thread-live") });

    expect(
      selectDisplayableSidebarThreads([archivedRoot, liveChild, liveRoot]).map(
        (thread) => thread.id,
      ),
    ).toEqual([liveChild.id, liveRoot.id]);
  });
});

describe("createSidebarDisplayThreadsSelector", () => {
  it("includes subagent sessions so the tree can nest them", () => {
    const root = makeSummary({ id: ThreadId.makeUnsafe("thread-root") });
    const child = makeSummary({
      id: ThreadId.makeUnsafe("thread-child"),
      parentThreadId: root.id,
    });
    const archived = makeSummary({
      id: ThreadId.makeUnsafe("thread-archived"),
      archivedAt: "2026-03-09T11:00:00.000Z",
    });

    const displayThreads = createSidebarDisplayThreadsSelector()(
      makeState([root, child, archived]),
    );

    expect(displayThreads.map((thread) => thread.id)).toEqual([root.id, child.id]);
  });
});

describe("deriveSidebarProjectData with subagent sessions", () => {
  it("nests a subagent session under its parent and reveals it when expanded", () => {
    const project: Pick<Project, "id" | "cwd" | "expanded"> = {
      id: ProjectId.makeUnsafe("project-1"),
      cwd: "/workspace",
      expanded: true,
    };
    const root = makeSummary({
      id: ThreadId.makeUnsafe("thread-root"),
      projectId: project.id,
      createdAt: "2026-03-09T10:00:00.000Z",
      updatedAt: "2026-03-09T10:00:00.000Z",
    });
    const child = makeSummary({
      id: ThreadId.makeUnsafe("thread-child"),
      projectId: project.id,
      parentThreadId: root.id,
      createdAt: "2026-03-09T10:05:00.000Z",
      updatedAt: "2026-03-09T10:05:00.000Z",
    });

    const grouped = groupSidebarThreadsByProjectId([root, child]);
    const sorted = new Map(
      [...grouped].map(([projectId, threads]) => [
        projectId,
        sortThreadsForSidebar(threads, "updated_at"),
      ]),
    );

    const collapsed = deriveSidebarProjectData({
      projects: [project],
      sortedSidebarThreadsByProjectId: sorted,
      pinnedThreadIds: [],
      expandedParentThreadIds: new Set(),
      expandedThreadListProjectCwds: new Set(),
      normalizeProjectCwd: (cwd) => cwd,
      activeSidebarThreadId: undefined,
      previewLimit: 10,
    });
    expect(collapsed.get(project.id)?.visibleEntries.map((entry) => entry.rowId)).toEqual([
      root.id,
    ]);

    const expanded = deriveSidebarProjectData({
      projects: [project],
      sortedSidebarThreadsByProjectId: sorted,
      pinnedThreadIds: [],
      expandedParentThreadIds: new Set([root.id]),
      expandedThreadListProjectCwds: new Set(),
      normalizeProjectCwd: (cwd) => cwd,
      activeSidebarThreadId: undefined,
      previewLimit: 10,
    });
    expect(
      expanded.get(project.id)?.visibleEntries.map((entry) => ({
        rowId: entry.rowId,
        depth: entry.depth,
        parentThreadId: entry.thread.parentThreadId ?? null,
      })),
    ).toEqual([
      { rowId: root.id, depth: 0, parentThreadId: null },
      { rowId: child.id, depth: 1, parentThreadId: root.id },
    ]);
  });
});
