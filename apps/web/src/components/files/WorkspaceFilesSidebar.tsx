// FILE: WorkspaceFilesSidebar.tsx
// Purpose: Sidebar content for the workspace file explorer — header, search, and the
//          tree / changed-files / search-results list.
// Layer: Workspace files UI
// Exports: WorkspaceFilesSidebar

import type { ProjectChangedFile, ProjectFileSystemEntry, ThreadId } from "@peakcode/contracts";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { WorkspaceFileRow } from "./WorkspaceFileRow";
import { type FilesExplorerSidebarTarget, useFilesExplorerStore } from "~/filesExplorerStore";
import { useSingleChatPanelStore } from "~/singleChatPanelStore";
import { useMessages } from "~/i18n/I18nContext";
import { useTheme } from "~/hooks/useTheme";
import { useWorkspaceFileTree } from "~/hooks/useWorkspaceFileTree";
import {
  projectChangedFilesQueryOptions,
  projectSearchEntriesQueryOptions,
} from "~/lib/projectReactQuery";
import {
  buildChangedDecoration,
  buildVisibleWorkspaceTreeRows,
  describeWorkspaceRelativePath,
  filterEntriesByPathQuery,
  resolveDirectoriesToExpand,
} from "~/lib/workspaceFileTree";
import {
  ArrowLeftIcon,
  FilterIcon,
  LoaderIcon,
  RefreshCwIcon,
  SearchIcon,
  XIcon,
} from "~/lib/icons";
import { cn } from "~/lib/utils";

const WORKSPACE_SEARCH_RESULT_LIMIT = 120;
// Stable fallback so memo dependencies stay referentially equal before the first fetch lands.
const EMPTY_CHANGED_FILES: readonly ProjectChangedFile[] = [];

export function WorkspaceFilesSidebar(props: {
  target: FilesExplorerSidebarTarget;
  /**
   * Chat that owns the preview panel. Null only on routes with no chat (the terminal
   * workspace), where the tree still browses but a file click cannot open the panel.
   */
  hostThreadId: ThreadId | null;
  onClose: () => void;
}) {
  const messages = useMessages();
  const { resolvedTheme } = useTheme();
  const { rootPath: cwd, label } = props.target;
  const closeSidebar = props.onClose;
  const changedOnly = useFilesExplorerStore((store) => store.sidebarChangedOnly);
  const setChangedOnly = useFilesExplorerStore((store) => store.setSidebarChangedOnly);
  const openFile = useFilesExplorerStore((store) => store.openFile);
  const setThreadPanelState = useSingleChatPanelStore((store) => store.setThreadPanelState);
  const activeFilePath = useFilesExplorerStore((store) =>
    props.hostThreadId ? (store.stateByThreadId[props.hostThreadId]?.activeFilePath ?? null) : null,
  );
  const [query, setQuery] = useState("");
  const tree = useWorkspaceFileTree({ rootPath: cwd, includeFiles: true });
  // Pulled out of the tree object so the reveal effect depends on two stable callbacks
  // instead of the object literal the hook returns on every render.
  const { expandedPaths: treeExpandedPaths, toggleDirectory: toggleTreeDirectory } = tree;
  const listRef = useRef<HTMLDivElement>(null);

  const changedFilesQuery = useQuery(projectChangedFilesQueryOptions({ cwd }));
  const changedFiles = changedFilesQuery.data?.files ?? EMPTY_CHANGED_FILES;
  const decoration = useMemo(() => buildChangedDecoration(changedFiles), [changedFiles]);
  const changedStatusByPath = useMemo(
    () => new Map(changedFiles.map((file) => [file.path, file.status] as const)),
    [changedFiles],
  );

  const searchQuery = useQuery(
    projectSearchEntriesQueryOptions({
      cwd,
      query,
      limit: WORKSPACE_SEARCH_RESULT_LIMIT,
      enabled: !changedOnly && query.trim().length > 0,
    }),
  );

  const visibleRows = useMemo(
    () =>
      buildVisibleWorkspaceTreeRows({
        entriesByParent: tree.entriesByParent,
        expandedPaths: tree.expandedPaths,
      }),
    [tree.entriesByParent, tree.expandedPaths],
  );

  const searchResultRows = useMemo((): ProjectFileSystemEntry[] => {
    const entries = searchQuery.data?.entries ?? [];
    // Rows render the parent directory from the path itself, so the entry only needs the
    // fields the tree row reads.
    return entries.map((entry) => ({
      path: entry.path,
      name: describeWorkspaceRelativePath(entry.path).name,
      kind: entry.kind,
    }));
  }, [searchQuery.data]);

  const changedRows = useMemo(
    () => filterEntriesByPathQuery(changedFiles, query),
    [changedFiles, query],
  );

  const openFileInPanel = useCallback(
    (relativePath: string) => {
      const hostThreadId = props.hostThreadId;
      if (!hostThreadId) {
        return;
      }
      openFile(hostThreadId, relativePath);
      // Picking a file is also the gesture that opens the preview panel beside the chat.
      setThreadPanelState(hostThreadId, {
        panel: "files",
        hasOpenedPanel: true,
        lastOpenPanel: "files",
      });
    },
    [openFile, props.hostThreadId, setThreadPanelState],
  );

  const handleSelectEntry = useCallback(
    (entry: ProjectFileSystemEntry) => {
      if (entry.kind === "directory") {
        tree.toggleDirectory(entry.path, toHasChildrenOption(entry.hasChildren));
        return;
      }
      openFileInPanel(entry.path);
    },
    [openFileInPanel, tree],
  );

  const handleSelectFlatPath = useCallback(
    (relativePath: string) => {
      openFileInPanel(relativePath);
    },
    [openFileInPanel],
  );

  // Reveal the file being previewed however it was opened — a search result, the changed
  // list, a deep link, or a restored tab. Expansion runs once per newly active file so
  // collapsing a directory afterwards is not undone; the scroll keeps retrying because the
  // row only exists after the levels above it have loaded.
  const lastRevealedPathRef = useRef<string | null>(null);
  // A new root builds a fresh tree, so a reveal recorded against the previous one no longer
  // applies.
  useEffect(() => {
    lastRevealedPathRef.current = null;
  }, [cwd]);
  useEffect(() => {
    if (!activeFilePath || !cwd) {
      return;
    }
    if (lastRevealedPathRef.current !== activeFilePath) {
      lastRevealedPathRef.current = activeFilePath;
      for (const ancestor of resolveDirectoriesToExpand({
        relativePath: activeFilePath,
        expandedPaths: treeExpandedPaths,
      })) {
        toggleTreeDirectory(ancestor);
      }
    }
    const row = listRef.current?.querySelector(`[data-file-row="${CSS.escape(activeFilePath)}"]`);
    row?.scrollIntoView({ block: "nearest" });
  }, [
    activeFilePath,
    changedOnly,
    cwd,
    query,
    treeExpandedPaths,
    toggleTreeDirectory,
    visibleRows.length,
  ]);

  const isTreeLoading = tree.isRootLoading && visibleRows.length === 0;
  const showSearchResults = !changedOnly && query.trim().length > 0;
  const emptyLabel =
    showSearchResults || changedOnly
      ? messages.sidebar.files.noResults
      : messages.sidebar.files.emptyDirectory;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-1.5 pt-1 pb-1.5">
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left font-system-ui text-[length:var(--app-font-size-ui,12px)] text-muted-foreground/75 transition-colors hover:bg-[var(--sidebar-accent)] hover:text-foreground/95"
          onClick={closeSidebar}
        >
          <ArrowLeftIcon className="size-3.5" />
          {messages.sidebar.files.backToTasks}
        </button>
      </div>

      <div className="px-2 pb-1.5">
        <label className="flex items-center gap-1.5 rounded-md border border-[color:var(--color-border-light)] px-2 py-1 focus-within:border-[color:var(--color-border)]">
          <SearchIcon className="size-3.5 shrink-0 text-muted-foreground/45" />
          <input
            value={query}
            aria-label={messages.sidebar.files.searchLabel}
            placeholder={messages.sidebar.files.searchPlaceholder}
            className="min-w-0 flex-1 bg-transparent font-system-ui text-[length:var(--app-font-size-ui,12px)] text-foreground/90 outline-none placeholder:text-muted-foreground/40"
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
          {query.length > 0 ? (
            <button
              type="button"
              aria-label={messages.sidebar.files.clearSearch}
              className="sidebar-icon-button"
              onClick={() => {
                setQuery("");
              }}
            >
              <XIcon className="size-3" />
            </button>
          ) : null}
        </label>
      </div>

      <div className="flex items-center gap-1 px-2.5 pb-1">
        <span className="min-w-0 flex-1 truncate font-system-ui text-[length:var(--app-font-size-ui,12px)] text-muted-foreground/58">
          {label}
        </span>
        {changedFilesQuery.isFetching && changedFiles.length > 0 ? (
          <LoaderIcon className="size-3 shrink-0 animate-spin text-muted-foreground/40" />
        ) : null}
        <button
          type="button"
          aria-label={
            changedOnly ? messages.sidebar.files.showAll : messages.sidebar.files.changedOnly
          }
          title={changedOnly ? messages.sidebar.files.showAll : messages.sidebar.files.changedOnly}
          data-active={changedOnly ? "true" : undefined}
          className={cn("sidebar-icon-button", changedOnly && "text-foreground/85")}
          onClick={() => {
            setChangedOnly(!changedOnly);
          }}
        >
          <FilterIcon className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label={messages.sidebar.files.refresh}
          title={messages.sidebar.files.refresh}
          className="sidebar-icon-button"
          onClick={() => {
            tree.refresh();
            void changedFilesQuery.refetch();
          }}
        >
          <RefreshCwIcon className="size-3.5" />
        </button>
      </div>

      {changedOnly ? (
        <div className="px-2.5 pb-1 font-system-ui text-[length:var(--app-font-size-ui,10px)] text-muted-foreground/45">
          {messages.sidebar.files.changedFilesCount(changedRows.length)}
        </div>
      ) : null}

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {changedOnly || showSearchResults ? (
          changedOnly ? (
            changedRows.length > 0 ? (
              changedRows.map((file) => (
                <FlatChangedFileRow
                  key={file.path}
                  file={file}
                  theme={resolvedTheme}
                  isActive={file.path === activeFilePath}
                  onSelect={handleSelectFlatPath}
                />
              ))
            ) : (
              <SidebarPlaceholder label={emptyLabel} />
            )
          ) : searchResultRows.length > 0 ? (
            searchResultRows.map((entry) => (
              <WorkspaceFileRow
                key={entry.path}
                entry={entry}
                depth={0}
                theme={resolvedTheme}
                isActive={entry.path === activeFilePath}
                subtitle={describeWorkspaceRelativePath(entry.path).parentPath}
                changedStatus={changedStatusByPath.get(entry.path)}
                onSelect={(selected) => {
                  handleSelectFlatPath(selected.path);
                }}
              />
            ))
          ) : searchQuery.isPending ? (
            <SidebarPlaceholder label={messages.sidebar.files.searching} />
          ) : (
            <SidebarPlaceholder label={emptyLabel} />
          )
        ) : isTreeLoading ? (
          <SidebarPlaceholder label={messages.sidebar.files.loadingDirectory} />
        ) : visibleRows.length > 0 ? (
          visibleRows.map((row) => (
            <WorkspaceFileRow
              key={row.entry.path}
              entry={row.entry}
              depth={row.depth}
              theme={resolvedTheme}
              isExpanded={tree.expandedPaths.has(row.entry.path)}
              isLoading={tree.loadingPaths.has(row.entry.path)}
              isActive={row.entry.path === activeFilePath}
              changedStatus={
                row.entry.kind === "file" ? changedStatusByPath.get(row.entry.path) : undefined
              }
              hasChanges={
                row.entry.kind === "directory" && decoration.changedDirectories.has(row.entry.path)
              }
              onToggle={(entry) => {
                tree.toggleDirectory(entry.path, toHasChildrenOption(entry.hasChildren));
              }}
              onSelect={handleSelectEntry}
            />
          ))
        ) : (
          <SidebarPlaceholder label={emptyLabel} />
        )}
        {tree.errorMessage ? (
          <div className="px-2 pt-2 font-system-ui text-[11px] text-red-400">
            {messages.sidebar.files.readFailed}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function FlatChangedFileRow(props: {
  file: ProjectChangedFile;
  theme: "light" | "dark";
  isActive: boolean;
  onSelect: (relativePath: string) => void;
}) {
  const description = describeWorkspaceRelativePath(props.file.path);
  return (
    <WorkspaceFileRow
      entry={{ path: props.file.path, name: description.name, kind: "file" }}
      depth={0}
      theme={props.theme}
      isActive={props.isActive}
      subtitle={description.parentPath}
      statusBadge={props.file.status}
      onSelect={() => {
        props.onSelect(props.file.path);
      }}
    />
  );
}

function toHasChildrenOption(hasChildren: boolean | undefined): { hasChildren?: boolean } {
  return hasChildren === undefined ? {} : { hasChildren };
}

function SidebarPlaceholder(props: { label: string }) {
  return (
    <div className="px-3 py-8 text-center font-system-ui text-[length:var(--app-font-size-ui,12px)] text-muted-foreground/50">
      {props.label}
    </div>
  );
}
