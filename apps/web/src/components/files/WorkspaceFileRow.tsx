// FILE: WorkspaceFileRow.tsx
// Purpose: One row in the workspace file explorer — folder/file icon, name, and git
//          decoration. Shared by the tree, search results, and the changed-files list.
// Layer: Workspace files UI
// Exports: WorkspaceFileRow, WorkspaceChangedStatusBadge, WorkspaceChangedDot

import type { ProjectChangedFileStatus, ProjectFileSystemEntry } from "@peakcode/contracts";
import { memo, useCallback, type MouseEvent as ReactMouseEvent } from "react";

import { FileEntryIcon } from "../chat/FileEntryIcon";
import { ChevronDownIcon, ChevronRightIcon, LoaderIcon } from "~/lib/icons";
import { useMessages } from "~/i18n/I18nContext";
import { cn } from "~/lib/utils";

const CHANGED_STATUS_CLASS: Record<ProjectChangedFileStatus, string> = {
  modified: "text-amber-500",
  added: "text-emerald-500",
  renamed: "text-sky-500",
  untracked: "text-emerald-500",
  deleted: "text-red-500",
  conflicted: "text-red-500",
};

const CHANGED_STATUS_LETTER: Record<ProjectChangedFileStatus, string> = {
  modified: "M",
  added: "A",
  renamed: "R",
  untracked: "U",
  deleted: "D",
  conflicted: "C",
};

function useChangedStatusLabel(status: ProjectChangedFileStatus): string {
  const messages = useMessages();
  return {
    modified: messages.sidebar.files.statusModified,
    added: messages.sidebar.files.statusAdded,
    deleted: messages.sidebar.files.statusDeleted,
    renamed: messages.sidebar.files.statusRenamed,
    untracked: messages.sidebar.files.statusUntracked,
    conflicted: messages.sidebar.files.statusConflicted,
  }[status];
}

export function WorkspaceChangedStatusBadge(props: { status: ProjectChangedFileStatus }) {
  const label = useChangedStatusLabel(props.status);
  return (
    <span
      className={cn(
        "shrink-0 font-mono text-[10px] font-medium",
        CHANGED_STATUS_CLASS[props.status],
      )}
      title={label}
      aria-label={label}
    >
      {CHANGED_STATUS_LETTER[props.status]}
    </span>
  );
}

/** Dot used in the tree, where a status letter would be too wide for nested rows. */
export function WorkspaceChangedDot(props: { status: ProjectChangedFileStatus }) {
  const label = useChangedStatusLabel(props.status);
  return (
    <span
      className={cn(
        "size-1.5 shrink-0 rounded-full bg-current",
        CHANGED_STATUS_CLASS[props.status],
      )}
      title={label}
      aria-label={label}
    />
  );
}

export const WorkspaceFileRow = memo(function WorkspaceFileRow(props: {
  entry: ProjectFileSystemEntry;
  depth: number;
  theme: "light" | "dark";
  isExpanded?: boolean;
  isLoading?: boolean;
  isActive?: boolean;
  changedStatus?: ProjectChangedFileStatus | undefined;
  /** Directories only: a descendant of this folder has changes. Rendered without a label. */
  hasChanges?: boolean;
  /** Changed files are listed flat, so they show their parent directory instead of a name. */
  subtitle?: string | undefined;
  statusBadge?: ProjectChangedFileStatus | undefined;
  onToggle?: ((entry: ProjectFileSystemEntry) => void) | undefined;
  onSelect: (entry: ProjectFileSystemEntry) => void;
}) {
  const { entry, depth } = props;
  const isDirectory = entry.kind === "directory";
  const canExpand = isDirectory && entry.hasChildren === true;

  const handleToggle = useCallback(
    (event: ReactMouseEvent) => {
      event.stopPropagation();
      props.onToggle?.(entry);
    },
    [entry, props],
  );

  return (
    <button
      type="button"
      data-file-row={entry.path}
      data-active={props.isActive ? "true" : undefined}
      className={cn(
        "group/file-row flex w-full min-w-0 items-center gap-1 rounded-md py-1 pr-2 text-left transition-colors",
        props.isActive
          ? "bg-[var(--color-background-button-secondary)]"
          : "hover:bg-[var(--color-background-button-secondary-hover)]",
      )}
      style={{ paddingLeft: `${6 + depth * 12}px` }}
      title={entry.path}
      onClick={() => {
        props.onSelect(entry);
      }}
    >
      {isDirectory ? (
        <span
          aria-hidden={!canExpand}
          className={cn(
            "inline-flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground/55",
            canExpand ? "hover:text-foreground/80" : "opacity-0",
          )}
          onClick={canExpand ? handleToggle : undefined}
        >
          {props.isLoading ? (
            <LoaderIcon className="size-3 animate-spin" />
          ) : props.isExpanded ? (
            <ChevronDownIcon className="size-3" />
          ) : (
            <ChevronRightIcon className="size-3" />
          )}
        </span>
      ) : (
        <span aria-hidden="true" className="size-4 shrink-0" />
      )}
      <FileEntryIcon
        pathValue={entry.path}
        kind={entry.kind}
        theme={props.theme}
        className="size-3.5"
      />
      <span className="min-w-0 flex-1 truncate font-system-ui text-[length:var(--app-font-size-ui,12px)] text-foreground/88">
        {entry.name}
      </span>
      {props.subtitle ? (
        <span className="max-w-[45%] shrink-0 truncate font-system-ui text-[length:var(--app-font-size-ui,10px)] text-muted-foreground/45">
          {props.subtitle}
        </span>
      ) : null}
      {props.statusBadge ? (
        <WorkspaceChangedStatusBadge status={props.statusBadge} />
      ) : props.changedStatus ? (
        <WorkspaceChangedDot status={props.changedStatus} />
      ) : props.hasChanges ? (
        <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-amber-500/70" />
      ) : null}
    </button>
  );
});
