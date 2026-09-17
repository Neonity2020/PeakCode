// FILE: defaultWorkspace.ts
// Purpose: Resolves and ensures the built-in default workspace project that backs unassigned threads.
// Layer: Web orchestration helper
// Exports: default workspace root resolution, project detection, and ensure/prewarm helpers.

import { type ProjectId } from "@peakcode/contracts";
import { workspaceRootsEqual } from "@peakcode/shared/threadWorkspace";
import type { Project } from "../types";
import { readNativeApi } from "../nativeApi";
import type { AppState } from "../store";
import { useStore } from "../store";
import { getThreadFromState } from "../threadDerivation";
import { newCommandId, newProjectId } from "./utils";

/** App-owned state directory; the default workspace lives inside it so it never litters `$HOME`. */
const APP_HOME_DIRNAME = ".peakcode";
const DEFAULT_WORKSPACE_DIRNAME = "workspace";
export const DEFAULT_WORKSPACE_PROJECT_TITLE = "Workspace";

type DefaultWorkspaceProjectLike = Pick<Project, "cwd" | "kind">;

const pendingDefaultWorkspaceByHomeDir = new Map<string, Promise<ProjectId | null>>();

export function resolveDefaultWorkspaceRoot(homeDir: string | null | undefined): string | null {
  const trimmedHomeDir = homeDir?.trim().replace(/[/\\]+$/, "");
  if (!trimmedHomeDir) {
    return null;
  }
  const separator = trimmedHomeDir.includes("\\") ? "\\" : "/";
  return [trimmedHomeDir, APP_HOME_DIRNAME, DEFAULT_WORKSPACE_DIRNAME].join(separator);
}

export function isDefaultWorkspaceProject(
  project: DefaultWorkspaceProjectLike | null | undefined,
  homeDir: string | null | undefined,
): boolean {
  const workspaceRoot = resolveDefaultWorkspaceRoot(homeDir);
  if (!project || !workspaceRoot || project.kind !== "project") {
    return false;
  }
  return workspaceRootsEqual(project.cwd, workspaceRoot);
}

export function findDefaultWorkspaceProject<T extends DefaultWorkspaceProjectLike>(
  projects: readonly T[],
  homeDir: string | null | undefined,
): T | null {
  const workspaceRoot = resolveDefaultWorkspaceRoot(homeDir);
  if (!workspaceRoot) {
    return null;
  }
  return (
    projects.find(
      (project) => project.kind === "project" && workspaceRootsEqual(project.cwd, workspaceRoot),
    ) ?? null
  );
}

function countThreadsByProjectId(state: AppState): ReadonlyMap<ProjectId, number> {
  const threadCountByProjectId = new Map<ProjectId, number>();
  for (const threadId of state.threadIds ?? []) {
    const thread = getThreadFromState(state, threadId);
    if (!thread) {
      continue;
    }
    threadCountByProjectId.set(
      thread.projectId,
      (threadCountByProjectId.get(thread.projectId) ?? 0) + 1,
    );
  }
  return threadCountByProjectId;
}

/**
 * Legacy unscoped chats lived in hidden containers (`kind: "chat"`, rooted at the home folder),
 * and repeated container creation left more than one behind. The container the user actually
 * chatted in becomes the default workspace; containers that still hold chats stay in the project
 * list as-is, while empty app-created leftovers are removed.
 */
async function migrateLegacyChatContainers(workspaceRoot: string): Promise<ProjectId | null> {
  const api = readNativeApi();
  const state = useStore.getState();
  const legacyContainers = state.projects.filter((project) => project.kind === "chat");
  if (!api || legacyContainers.length === 0) {
    return null;
  }

  const threadCountByProjectId = countThreadsByProjectId(state);
  const threadCountOf = (project: Project) => threadCountByProjectId.get(project.id) ?? 0;
  const [adopted, ...remainingContainers] = legacyContainers.toSorted(
    (left, right) => threadCountOf(right) - threadCountOf(left),
  );
  if (!adopted) {
    return null;
  }

  await api.orchestration.dispatchCommand({
    type: "project.meta.update",
    commandId: newCommandId(),
    projectId: adopted.id,
    kind: "project",
    title: DEFAULT_WORKSPACE_PROJECT_TITLE,
    workspaceRoot,
    createWorkspaceRootIfMissing: true,
  });

  // Deleting a container that only looks empty because threads are not hydrated yet would erase
  // history, so leftovers are only pruned once the shell snapshot is known to be complete.
  if (state.threadsHydrated) {
    await Promise.allSettled(
      remainingContainers
        .filter((container) => threadCountOf(container) === 0)
        .map((container) =>
          api.orchestration.dispatchCommand({
            type: "project.delete",
            commandId: newCommandId(),
            projectId: container.id,
          }),
        ),
    );
  }

  return adopted.id;
}

async function createDefaultWorkspaceProject(workspaceRoot: string): Promise<ProjectId | null> {
  const api = readNativeApi();
  if (!api) {
    return null;
  }

  const projectId = newProjectId();
  await api.orchestration.dispatchCommand({
    type: "project.create",
    commandId: newCommandId(),
    projectId,
    kind: "project",
    title: DEFAULT_WORKSPACE_PROJECT_TITLE,
    workspaceRoot,
    createWorkspaceRootIfMissing: true,
    createdAt: new Date().toISOString(),
  });
  return projectId;
}

async function resolveOrCreateDefaultWorkspaceProject(
  homeDir: string,
  workspaceRoot: string,
): Promise<ProjectId | null> {
  const existing = findDefaultWorkspaceProject(useStore.getState().projects, homeDir);
  if (existing) {
    return existing.id;
  }

  const adoptedWorkspaceId = await migrateLegacyChatContainers(workspaceRoot);
  if (adoptedWorkspaceId) {
    return adoptedWorkspaceId;
  }

  return createDefaultWorkspaceProject(workspaceRoot);
}

export async function ensureDefaultWorkspaceProject(
  homeDir: string | null | undefined,
): Promise<ProjectId | null> {
  const trimmedHomeDir = homeDir?.trim();
  const workspaceRoot = resolveDefaultWorkspaceRoot(homeDir);
  if (!trimmedHomeDir || !workspaceRoot || !readNativeApi()) {
    return null;
  }

  const pendingCreation = pendingDefaultWorkspaceByHomeDir.get(trimmedHomeDir);
  if (pendingCreation) {
    return pendingCreation;
  }

  const creationPromise = resolveOrCreateDefaultWorkspaceProject(trimmedHomeDir, workspaceRoot)
    .catch(() => null)
    .finally(() => {
      pendingDefaultWorkspaceByHomeDir.delete(trimmedHomeDir);
    });
  pendingDefaultWorkspaceByHomeDir.set(trimmedHomeDir, creationPromise);
  return creationPromise;
}

/**
 * Startup warm-up: migrates legacy chat containers, and seeds the workspace for first-run installs
 * so users who already work in their own projects never get a project they did not ask for.
 */
export function prewarmDefaultWorkspaceProject(
  homeDir: string | null | undefined,
  projects: readonly Project[],
): void {
  if (!resolveDefaultWorkspaceRoot(homeDir)) {
    return;
  }
  if (findDefaultWorkspaceProject(projects, homeDir)) {
    return;
  }
  if (projects.some((project) => project.kind === "chat")) {
    void ensureDefaultWorkspaceProject(homeDir);
    return;
  }
  if (projects.length > 0) {
    return;
  }
  void ensureDefaultWorkspaceProject(homeDir);
}
