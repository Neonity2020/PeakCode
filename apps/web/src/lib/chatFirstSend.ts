import type { ModelSelection } from "@peakcode/contracts";
import { workspaceRootsEqual } from "@peakcode/shared/threadWorkspace";

import type { Project } from "../types";

export interface FirstSendProjectTarget {
  targetProjectId: Project["id"];
  targetProjectKind: Project["kind"];
  targetProjectCwd: string;
  targetProjectScripts: Project["scripts"];
  targetProjectDefaultModelSelection: ModelSelection | null;
}

/**
 * The default model a relocated project should carry is resolved at dispatch time
 * (see `resolveProjectDefaultModelSelection`), because Pi reports its models at runtime.
 */
export interface FirstSendProjectCreation {
  workspaceRoot: string;
  title: string;
}

export type FirstSendTargetResolution =
  | { kind: "current"; target: FirstSendProjectTarget }
  | { kind: "existing-project"; target: FirstSendProjectTarget }
  | { kind: "create-project"; creation: FirstSendProjectCreation };

function buildProjectTarget(project: Project): FirstSendProjectTarget {
  return {
    targetProjectId: project.id,
    targetProjectKind: project.kind,
    targetProjectCwd: project.cwd,
    targetProjectScripts: project.kind === "project" ? project.scripts : [],
    targetProjectDefaultModelSelection: project.defaultModelSelection ?? null,
  };
}

function buildProjectTitleFromWorkspaceRoot(workspaceRoot: string): string {
  return workspaceRoot.split(/[/\\]/).findLast((segment) => segment.length > 0) ?? workspaceRoot;
}

/**
 * Threads started in the default workspace can relocate to the folder the user picked below the
 * composer. That relocation is only meaningful before the thread has any provider turn.
 */
export function resolveFirstSendTarget(input: {
  activeProject: Project;
  isFirstMessage: boolean;
  isDefaultWorkspace: boolean;
  projects: readonly Project[];
  selectedWorkspaceRoot: string | null;
}): FirstSendTargetResolution {
  const { activeProject, isFirstMessage, isDefaultWorkspace, projects, selectedWorkspaceRoot } =
    input;

  if (!isFirstMessage || !isDefaultWorkspace || !selectedWorkspaceRoot) {
    return {
      kind: "current",
      target: buildProjectTarget(activeProject),
    };
  }

  const existingProject = projects.find(
    (project) =>
      project.kind === "project" && workspaceRootsEqual(project.cwd, selectedWorkspaceRoot),
  );
  if (existingProject) {
    return {
      kind: "existing-project",
      target: buildProjectTarget(existingProject),
    };
  }

  return {
    kind: "create-project",
    creation: {
      workspaceRoot: selectedWorkspaceRoot,
      title: buildProjectTitleFromWorkspaceRoot(selectedWorkspaceRoot),
    },
  };
}
