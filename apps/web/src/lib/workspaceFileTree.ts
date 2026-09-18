// FILE: workspaceFileTree.ts
// Purpose: Pure helpers for the workspace file explorer — path math, tree flattening,
//          git-status decoration, and search-result shaping.
// Layer: Web domain helpers
// Exports: explorer path helpers, tree row builders, git decoration resolvers

import type { ProjectChangedFile, ProjectFileSystemEntry } from "@peakcode/contracts";

export type WorkspaceEntryKind = "file" | "directory";

/** Join a workspace root with a workspace-relative path, keeping the root's separator. */
export function joinWorkspacePath(rootPath: string, relativePath: string): string {
  if (!relativePath) return rootPath;
  const separator = rootPath.includes("\\") ? "\\" : "/";
  const normalizedRoot = rootPath.endsWith(separator) ? rootPath.slice(0, -1) : rootPath;
  const normalizedRelative = relativePath.split(/[\\/]+/).join(separator);
  return `${normalizedRoot}${separator}${normalizedRelative}`;
}

export function basenameOfWorkspacePath(relativePath: string): string {
  const segments = relativePath.split("/");
  return segments.at(-1) ?? relativePath;
}

/** Breadcrumb segments for a workspace-relative path, root label first. */
export function buildWorkspaceBreadcrumb(input: {
  rootLabel: string;
  relativePath: string;
}): string[] {
  const segments = input.relativePath.split("/").filter((segment) => segment.length > 0);
  return [input.rootLabel, ...segments];
}

/**
 * Relative paths that sit at a folder boundary, so directory decorations can be
 * resolved with a single set lookup instead of scanning every changed path.
 */
export function resolveChangedDirectorySet(changedPaths: Iterable<string>): ReadonlySet<string> {
  const directories = new Set<string>();
  for (const changedPath of changedPaths) {
    const segments = changedPath.split("/");
    for (let index = 1; index < segments.length; index += 1) {
      directories.add(segments.slice(0, index).join("/"));
    }
  }
  return directories;
}

export function resolveChangedStatusByPath(
  changedFiles: readonly ProjectChangedFile[],
): ReadonlyMap<string, ProjectChangedFile["status"]> {
  const statusByPath = new Map<string, ProjectChangedFile["status"]>();
  // A path can appear more than once (renamed source plus destination); keep the first
  // report so the decoration stays stable across refetches.
  for (const file of changedFiles) {
    if (!statusByPath.has(file.path)) {
      statusByPath.set(file.path, file.status);
    }
  }
  return statusByPath;
}

export interface WorkspaceChangedDecoration {
  changedPaths: ReadonlySet<string>;
  changedDirectories: ReadonlySet<string>;
}

export const EMPTY_CHANGED_DECORATION: WorkspaceChangedDecoration = {
  changedPaths: new Set<string>(),
  changedDirectories: new Set<string>(),
};

export function buildChangedDecoration(
  changedFiles: readonly ProjectChangedFile[],
): WorkspaceChangedDecoration {
  if (changedFiles.length === 0) {
    return EMPTY_CHANGED_DECORATION;
  }
  const changedPaths = new Set(changedFiles.map((file) => file.path));
  return {
    changedPaths,
    changedDirectories: resolveChangedDirectorySet(changedPaths),
  };
}

export function isWorkspaceEntryChanged(
  entry: ProjectFileSystemEntry,
  decoration: WorkspaceChangedDecoration,
): boolean {
  return entry.kind === "directory"
    ? decoration.changedDirectories.has(entry.path)
    : decoration.changedPaths.has(entry.path);
}

export interface WorkspaceTreeRow {
  entry: ProjectFileSystemEntry;
  depth: number;
}

export interface WorkspaceTreeInput {
  entriesByParent: Record<string, readonly ProjectFileSystemEntry[] | undefined>;
  expandedPaths: ReadonlySet<string>;
}

/**
 * Flatten the lazily-loaded directory map into render order. Only expanded directories
 * contribute children, so the result matches exactly what is visible.
 */
export function buildVisibleWorkspaceTreeRows(input: WorkspaceTreeInput): WorkspaceTreeRow[] {
  const rows: WorkspaceTreeRow[] = [];
  const visited = new Set<string>();

  const appendLevel = (parentPath: string, depth: number): void => {
    const entries = input.entriesByParent[parentPath] ?? [];
    for (const entry of entries) {
      if (visited.has(entry.path)) {
        continue;
      }
      visited.add(entry.path);
      rows.push({ entry, depth });
      if (entry.kind === "directory" && input.expandedPaths.has(entry.path)) {
        appendLevel(entry.path, depth + 1);
      }
    }
  };

  appendLevel("", 0);
  return rows;
}

export function filterEntriesByPathQuery<T extends { path: string }>(
  entries: readonly T[],
  query: string,
): T[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length === 0) {
    return [...entries];
  }
  return entries.filter(
    (entry) =>
      basenameOfWorkspacePath(entry.path).toLowerCase().includes(normalizedQuery) ||
      entry.path.toLowerCase().includes(normalizedQuery),
  );
}

/** Split a workspace-relative path into `{ parentPath, name }` for flat list rendering. */
export function describeWorkspaceRelativePath(relativePath: string): {
  name: string;
  parentPath: string;
} {
  const separatorIndex = relativePath.lastIndexOf("/");
  if (separatorIndex === -1) {
    return { name: relativePath, parentPath: "" };
  }
  return {
    name: relativePath.slice(separatorIndex + 1),
    parentPath: relativePath.slice(0, separatorIndex),
  };
}

/**
 * Collapse the directories on the way to a target path so a deep file can be revealed
 * from a flat list (search results, changed files) in one expansion.
 */
export function resolveAncestorDirectoryPaths(relativePath: string): string[] {
  const segments = relativePath.split("/").filter((segment) => segment.length > 0);
  const ancestors: string[] = [];
  for (let index = 1; index < segments.length; index += 1) {
    ancestors.push(segments.slice(0, index).join("/"));
  }
  return ancestors;
}

/**
 * Directories that still need expanding to reveal `relativePath`. Already-expanded ancestors
 * are excluded so revealing a path never collapses a directory the user opened.
 */
export function resolveDirectoriesToExpand(input: {
  relativePath: string;
  expandedPaths: ReadonlySet<string>;
}): string[] {
  return resolveAncestorDirectoryPaths(input.relativePath).filter(
    (ancestor) => !input.expandedPaths.has(ancestor),
  );
}
