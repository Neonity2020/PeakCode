// FILE: DirectoryTreeBrowser.tsx
// Purpose: Render a lazy, recursive local browser rooted at a caller-provided path.
// Layer: Chat/home filesystem UI helper
// Exports: DirectoryTreeBrowser for inline and popover-based local file/folder navigation.

import type { ProjectFileSystemEntry } from "@peakcode/contracts";
import type { ReactNode } from "react";
import { memo, useMemo } from "react";
import { ChevronDownIcon, ChevronRightIcon, FileIcon, FolderIcon } from "~/lib/icons";
import { joinWorkspacePath } from "~/lib/workspaceFileTree";
import { useWorkspaceFileTree } from "~/hooks/useWorkspaceFileTree";
import { cn } from "~/lib/utils";

interface DirectoryTreeBrowserProps {
  rootPath: string | null;
  emptyLabel?: string;
  unavailableLabel?: string;
  loadingLabel?: string;
  className?: string;
  includeFiles?: boolean;
  query?: string;
  onSelectEntry: (absolutePath: string, entry: ProjectFileSystemEntry) => Promise<void> | void;
}

export const DirectoryTreeBrowser = memo(function DirectoryTreeBrowser({
  rootPath,
  emptyLabel = "No folders found",
  unavailableLabel = "Home directory unavailable.",
  loadingLabel = "Loading folders…",
  className,
  includeFiles = false,
  query = "",
  onSelectEntry,
}: DirectoryTreeBrowserProps) {
  const { entriesByParent, expandedPaths, loadingPaths, errorMessage, toggleDirectory } =
    useWorkspaceFileTree({ rootPath, includeFiles });
  const rootEntries = useMemo(() => entriesByParent[""] ?? [], [entriesByParent]);

  const renderedTree = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const renderEntries = (
      entries: readonly ProjectFileSystemEntry[],
      depth: number,
    ): ReactNode[] =>
      entries.flatMap((entry) => {
        const expanded = expandedPaths.has(entry.path);
        const children = entriesByParent[entry.path] ?? [];
        const isLoadingChildren = loadingPaths.has(entry.path);
        const isDirectory = entry.kind === "directory";
        const matchesSelf =
          normalizedQuery.length === 0 ||
          entry.name.toLowerCase().includes(normalizedQuery) ||
          entry.path.toLowerCase().includes(normalizedQuery);
        const renderedChildren =
          isDirectory && expanded && children.length > 0 ? renderEntries(children, depth + 1) : [];

        if (!matchesSelf && renderedChildren.length === 0) {
          return [];
        }

        return [
          <div
            key={entry.path}
            className="flex min-w-0 items-center gap-1 rounded-lg px-2 py-1 text-sm transition-colors hover:bg-[var(--color-background-button-secondary-hover)]"
            style={{ paddingLeft: `${8 + depth * 16}px` }}
          >
            <button
              type="button"
              aria-label={expanded ? `Collapse ${entry.name}` : `Expand ${entry.name}`}
              className={cn(
                "inline-flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-[var(--color-background-button-secondary)] hover:text-foreground",
                (!isDirectory || !entry.hasChildren) && "opacity-35",
              )}
              onClick={() => {
                if (isDirectory && entry.hasChildren) {
                  toggleDirectory(entry.path, { hasChildren: entry.hasChildren });
                }
              }}
            >
              {isDirectory && entry.hasChildren ? (
                expanded ? (
                  <ChevronDownIcon className="size-3.5" />
                ) : (
                  <ChevronRightIcon className="size-3.5" />
                )
              ) : null}
            </button>
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-1 text-left"
              onClick={() => {
                if (!rootPath) return;
                void onSelectEntry(joinWorkspacePath(rootPath, entry.path), entry);
              }}
            >
              {isDirectory ? (
                <FolderIcon className="size-4 shrink-0 text-muted-foreground/70" />
              ) : (
                <FileIcon className="size-4 shrink-0 text-muted-foreground/60" />
              )}
              <span className="truncate text-foreground/95">{entry.name}</span>
            </button>
            {isDirectory && isLoadingChildren ? (
              <span className="shrink-0 text-[11px] text-muted-foreground/45">Loading…</span>
            ) : null}
          </div>,
          ...renderedChildren,
        ];
      });

    return renderEntries(rootEntries, 0);
  }, [
    entriesByParent,
    expandedPaths,
    loadingPaths,
    onSelectEntry,
    query,
    rootEntries,
    rootPath,
    toggleDirectory,
  ]);

  return (
    <div className={className}>
      {!rootPath ? (
        <div className="px-2 py-8 text-center text-sm text-muted-foreground/60">
          {unavailableLabel}
        </div>
      ) : loadingPaths.has("") && rootEntries.length === 0 ? (
        <div className="px-2 py-8 text-center text-sm text-muted-foreground/60">{loadingLabel}</div>
      ) : renderedTree.length > 0 ? (
        renderedTree
      ) : (
        <div className="px-2 py-8 text-center text-sm text-muted-foreground/60">{emptyLabel}</div>
      )}
      {errorMessage ? <div className="px-2 pt-2 text-xs text-red-400">{errorMessage}</div> : null}
    </div>
  );
});
