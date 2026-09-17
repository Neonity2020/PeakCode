import { afterEach, describe, expect, it, vi } from "vitest";

const dispatchCommand = vi.fn<(command: unknown) => Promise<void>>();

vi.mock("../nativeApi", () => ({
  readNativeApi: () => ({
    orchestration: {
      dispatchCommand,
    },
  }),
}));

import { useStore } from "../store";
import type { Project } from "../types";
import {
  DEFAULT_WORKSPACE_PROJECT_TITLE,
  ensureDefaultWorkspaceProject,
  findDefaultWorkspaceProject,
  isDefaultWorkspaceProject,
  prewarmDefaultWorkspaceProject,
  resolveDefaultWorkspaceRoot,
} from "./defaultWorkspace";

const HOME_DIR = "/Users/tester";
const DEFAULT_WORKSPACE_ROOT = "/Users/tester/.peakcode/workspace";

const initialStoreState = useStore.getState();

function makeProject(overrides: Partial<Project> & Pick<Project, "id" | "cwd">): Project {
  return {
    kind: "project",
    name: "Workspace",
    remoteName: "Workspace",
    folderName: "workspace",
    localName: null,
    defaultModelSelection: null,
    expanded: true,
    scripts: [],
    ...overrides,
  } as Project;
}

function setProjects(projects: readonly Project[], threadProjectIds: readonly string[] = []): void {
  const threadIds = threadProjectIds.map((projectId, index) => `thread-${index}-${projectId}`);
  useStore.setState({
    ...initialStoreState,
    projects: [...projects],
    threadIds: threadIds as never,
    threadShellById: Object.fromEntries(
      threadIds.map((threadId, index) => [
        threadId,
        {
          id: threadId,
          projectId: threadProjectIds[index],
          title: "Legacy chat",
          createdAt: "2026-09-01T00:00:00.000Z",
        },
      ]),
    ) as never,
    threadsHydrated: true,
  });
}

afterEach(() => {
  dispatchCommand.mockReset();
  useStore.setState(initialStoreState, true);
});

describe("resolveDefaultWorkspaceRoot", () => {
  it("nests the workspace inside the app home directory", () => {
    expect(resolveDefaultWorkspaceRoot(HOME_DIR)).toBe(DEFAULT_WORKSPACE_ROOT);
  });

  it("tolerates trailing separators and windows-style homes", () => {
    expect(resolveDefaultWorkspaceRoot("/Users/tester/")).toBe(DEFAULT_WORKSPACE_ROOT);
    expect(resolveDefaultWorkspaceRoot("C:\\Users\\tester\\")).toBe(
      "C:\\Users\\tester\\.peakcode\\workspace",
    );
  });

  it("returns null without a home directory", () => {
    expect(resolveDefaultWorkspaceRoot(null)).toBeNull();
    expect(resolveDefaultWorkspaceRoot("   ")).toBeNull();
  });
});

describe("default workspace project lookup", () => {
  it("matches the project rooted at the default workspace regardless of trailing slashes", () => {
    const workspaceProject = makeProject({
      id: "project-workspace" as never,
      cwd: `${DEFAULT_WORKSPACE_ROOT}/`,
    });

    expect(isDefaultWorkspaceProject(workspaceProject, HOME_DIR)).toBe(true);
    expect(
      isDefaultWorkspaceProject(makeProject({ id: "p" as never, cwd: "/tmp/other" }), HOME_DIR),
    ).toBe(false);
    expect(findDefaultWorkspaceProject([workspaceProject], HOME_DIR)?.id).toBe("project-workspace");
  });
});

describe("ensureDefaultWorkspaceProject", () => {
  it("reuses an existing project rooted at the default workspace", async () => {
    setProjects([makeProject({ id: "project-workspace" as never, cwd: DEFAULT_WORKSPACE_ROOT })]);

    await expect(ensureDefaultWorkspaceProject(HOME_DIR)).resolves.toBe("project-workspace");
    expect(dispatchCommand).not.toHaveBeenCalled();
  });

  it("creates the workspace folder when no project owns it yet", async () => {
    dispatchCommand.mockResolvedValue(undefined);
    setProjects([]);

    await expect(ensureDefaultWorkspaceProject(HOME_DIR)).resolves.toEqual(expect.any(String));
    expect(dispatchCommand).toHaveBeenCalledTimes(1);
    expect(dispatchCommand.mock.calls[0]?.[0]).toMatchObject({
      type: "project.create",
      kind: "project",
      title: DEFAULT_WORKSPACE_PROJECT_TITLE,
      workspaceRoot: DEFAULT_WORKSPACE_ROOT,
      createWorkspaceRootIfMissing: true,
    });
  });

  it("adopts the legacy chat container instead of creating a second project", async () => {
    dispatchCommand.mockResolvedValue(undefined);
    setProjects([
      makeProject({
        id: "project-legacy-chat" as never,
        kind: "chat",
        cwd: HOME_DIR,
        name: "Home",
      }),
    ]);

    await expect(ensureDefaultWorkspaceProject(HOME_DIR)).resolves.toBe("project-legacy-chat");
    expect(dispatchCommand).toHaveBeenCalledTimes(1);
    expect(dispatchCommand.mock.calls[0]?.[0]).toMatchObject({
      type: "project.meta.update",
      projectId: "project-legacy-chat",
      kind: "project",
      title: DEFAULT_WORKSPACE_PROJECT_TITLE,
      workspaceRoot: DEFAULT_WORKSPACE_ROOT,
    });
  });

  it("adopts the legacy container that still holds chats and prunes the empty leftovers", async () => {
    dispatchCommand.mockResolvedValue(undefined);
    setProjects(
      [
        makeProject({
          id: "project-empty-home" as never,
          kind: "chat",
          cwd: HOME_DIR,
          name: "Home",
        }),
        makeProject({
          id: "project-chat-in-use" as never,
          kind: "chat",
          cwd: HOME_DIR,
          name: "Home",
        }),
        makeProject({
          id: "project-app" as never,
          cwd: "/Users/tester/Code/app",
        }),
      ],
      ["project-chat-in-use"],
    );

    await expect(ensureDefaultWorkspaceProject(HOME_DIR)).resolves.toBe("project-chat-in-use");

    const dispatchedCommands = dispatchCommand.mock.calls.map((call) => call[0]);
    expect(dispatchedCommands).toEqual([
      expect.objectContaining({
        type: "project.meta.update",
        projectId: "project-chat-in-use",
        workspaceRoot: DEFAULT_WORKSPACE_ROOT,
      }),
      expect.objectContaining({ type: "project.delete", projectId: "project-empty-home" }),
    ]);
  });

  it("keeps legacy containers that still hold chats out of the delete path", async () => {
    dispatchCommand.mockResolvedValue(undefined);
    setProjects(
      [
        makeProject({
          id: "project-legacy-chat" as never,
          kind: "chat",
          cwd: HOME_DIR,
          name: "Home",
        }),
        makeProject({
          id: "project-second-chat" as never,
          kind: "chat",
          cwd: HOME_DIR,
          name: "分析当前项目",
        }),
      ],
      ["project-legacy-chat", "project-second-chat"],
    );

    await expect(ensureDefaultWorkspaceProject(HOME_DIR)).resolves.toEqual(expect.any(String));
    expect(dispatchCommand).toHaveBeenCalledTimes(1);
    expect(dispatchCommand.mock.calls[0]?.[0]).toMatchObject({ type: "project.meta.update" });
  });

  it("does not create a workspace on startup when the user already has projects", async () => {
    dispatchCommand.mockResolvedValue(undefined);
    setProjects([makeProject({ id: "project-app" as never, cwd: "/Users/tester/Code/app" })]);

    prewarmDefaultWorkspaceProject(HOME_DIR, useStore.getState().projects);

    expect(dispatchCommand).not.toHaveBeenCalled();
  });

  it("seeds the default workspace on startup for first-run installs", async () => {
    dispatchCommand.mockResolvedValue(undefined);
    setProjects([]);

    prewarmDefaultWorkspaceProject(HOME_DIR, useStore.getState().projects);
    await vi.waitFor(() => expect(dispatchCommand).toHaveBeenCalledTimes(1));

    expect(dispatchCommand.mock.calls[0]?.[0]).toMatchObject({ type: "project.create" });
  });
});
