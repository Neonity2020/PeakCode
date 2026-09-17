import type { ProjectId } from "@peakcode/contracts";

import type { Project } from "../types";

type ProjectTargetCandidate = Pick<Project, "id" | "kind">;

function resolveUsableProjectId(
  projects: readonly ProjectTargetCandidate[],
  projectId: ProjectId | null,
): ProjectId | null {
  if (!projectId) {
    return null;
  }

  const project = projects.find(
    (candidate) => candidate.id === projectId && candidate.kind === "project",
  );
  return project?.id ?? null;
}

export function resolveCurrentProjectTargetId(
  projects: readonly ProjectTargetCandidate[],
  focusedProjectId: ProjectId | null,
): ProjectId | null {
  return resolveUsableProjectId(projects, focusedProjectId);
}

export function resolveLatestProjectTargetId(
  projects: readonly ProjectTargetCandidate[],
  latestProjectId: ProjectId | null,
): ProjectId | null {
  return resolveUsableProjectId(projects, latestProjectId);
}
