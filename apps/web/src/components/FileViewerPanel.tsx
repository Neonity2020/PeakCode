// FILE: FileViewerPanel.tsx
// Purpose: Right-hand workspace file preview — tab strip, breadcrumb, and content view.
// Layer: Workspace files UI
// Exports: FileViewerPanel

import type { ProjectReadFileResult, ThreadId } from "@peakcode/contracts";
import { useQuery } from "@tanstack/react-query";
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";

import ChatMarkdown from "./ChatMarkdown";
import { DiffPanelShell, type DiffPanelMode } from "./DiffPanelShell";
import { FileEntryIcon } from "./chat/FileEntryIcon";
import { resolveFilePreviewKind } from "./FileViewerPanel.logic";
import { toastManager } from "./ui/toast";
import { openInPreferredEditor } from "~/editorPreferences";
import { useFilesExplorerStore } from "~/filesExplorerStore";
import { WorkspaceChangedStatusBadge } from "./files/WorkspaceFileRow";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { useMessages } from "~/i18n/I18nContext";
import { useTheme } from "~/hooks/useTheme";
import { useThreadWorkspaceContext } from "~/hooks/useThreadWorkspaceContext";
import { buildLocalImageUrl } from "~/lib/localImageUrls";
import {
  projectChangedFilesQueryOptions,
  projectReadFileQueryOptions,
} from "~/lib/projectReactQuery";
import { basenameOfWorkspacePath, joinWorkspacePath } from "~/lib/workspaceFileTree";
import { readNativeApi } from "~/nativeApi";
import {
  CopyIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  FolderOpenIcon,
  LoaderIcon,
  PlusIcon,
  TextWrapIcon,
  XIcon,
} from "~/lib/icons";
import { cn } from "~/lib/utils";

// The shiki bundle is heavy; mount it only once a text file is actually open.
const WorkspaceTextFile = lazy(() => import("./WorkspaceTextFile"));

const EMPTY_EXPLORER_STATE: { openFilePaths: string[]; activeFilePath: string | null } = {
  openFilePaths: [],
  activeFilePath: null,
};

export default function FileViewerPanel(props: {
  mode: DiffPanelMode;
  threadId: ThreadId;
  onClosePanel: () => void;
}) {
  const { threadId } = props;
  const messages = useMessages();
  const { resolvedTheme } = useTheme();
  const { cwd, pending, projectName } = useThreadWorkspaceContext(threadId);
  const explorerState = useFilesExplorerStore(
    (store) => store.stateByThreadId[threadId] ?? EMPTY_EXPLORER_STATE,
  );
  const openSidebar = useFilesExplorerStore((store) => store.openSidebar);
  const closeFile = useFilesExplorerStore((store) => store.closeFile);
  const setActiveFile = useFilesExplorerStore((store) => store.setActiveFile);
  const [wordWrap, setWordWrap] = useState(false);
  const [markdownSourceVisible, setMarkdownSourceVisible] = useState(false);
  const { copyToClipboard } = useCopyToClipboard();

  const activeFilePath = explorerState.activeFilePath;
  const readFileQuery = useQuery(
    projectReadFileQueryOptions({ cwd, relativePath: activeFilePath }),
  );
  const rootLabel = projectName ?? messages.sidebar.files.showFiles;

  const handleCopyPath = useCallback(
    (absolute: boolean) => {
      if (!activeFilePath) return;
      const target = absolute && cwd ? joinWorkspacePath(cwd, activeFilePath) : activeFilePath;
      copyToClipboard(target);
      toastManager.add({
        type: "success",
        title: absolute
          ? messages.sidebar.files.copyAbsolutePath
          : messages.sidebar.files.copyRelativePath,
        description: target,
        timeout: 2000,
      });
    },
    [activeFilePath, copyToClipboard, cwd, messages.sidebar.files],
  );

  const handleOpenInEditor = useCallback(async () => {
    const api = readNativeApi();
    if (!api || !cwd || !activeFilePath) {
      return;
    }
    try {
      await openInPreferredEditor(api, joinWorkspacePath(cwd, activeFilePath));
    } catch (error) {
      toastManager.add({
        type: "error",
        title: messages.sidebar.files.openInEditorFailed,
        ...(error instanceof Error ? { description: error.message } : {}),
        timeout: 3000,
      });
    }
  }, [activeFilePath, cwd, messages.sidebar.files.openInEditorFailed]);

  const changedFilesQuery = useQuery(
    projectChangedFilesQueryOptions({ cwd, refetchInterval: false }),
  );
  const activeFileStatus = useMemo(() => {
    if (!activeFilePath) {
      return undefined;
    }
    return changedFilesQuery.data?.files.find((file) => file.path === activeFilePath)?.status;
  }, [activeFilePath, changedFilesQuery.data]);
  const previewKind = activeFilePath ? resolveFilePreviewKind(activeFilePath) : "code";
  const showMarkdownPreview = previewKind === "markdown" && !markdownSourceVisible;
  const fileResult = readFileQuery.data;
  const hasTextContents = fileResult?.kind === "text" && fileResult.contents.length > 0;

  return (
    <DiffPanelShell
      mode={props.mode}
      header={
        <FileViewerHeader
          activeFilePath={activeFilePath}
          openFilePaths={explorerState.openFilePaths}
          cwd={cwd}
          onSelectTab={(path) => {
            setActiveFile(threadId, path);
          }}
          onCloseTab={(path) => {
            closeFile(threadId, path);
          }}
          onBrowseFiles={() => {
            if (!cwd) {
              return;
            }
            openSidebar({ rootPath: cwd, label: rootLabel });
          }}
          onClosePanel={props.onClosePanel}
          onCopyPath={handleCopyPath}
        />
      }
    >
      {!cwd ? (
        <PanelPlaceholder
          label={
            pending
              ? messages.sidebar.files.workspacePending
              : messages.sidebar.files.workspaceUnavailable
          }
        />
      ) : !activeFilePath ? (
        <PanelPlaceholder label={messages.sidebar.files.noResults} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex min-w-0 items-center gap-1.5 border-b border-border/60 px-3 py-1.5">
            <FileEntryIcon
              pathValue={activeFilePath}
              kind="file"
              theme={resolvedTheme}
              className="size-3.5"
            />
            <span className="min-w-0 flex-1 truncate font-system-ui text-[length:var(--app-font-size-ui,12px)] text-muted-foreground/60">
              <span className="text-muted-foreground/70">{rootLabel}</span>
              <span className="px-1 text-muted-foreground/35">/</span>
              <span className="text-foreground/85">{activeFilePath}</span>
            </span>
            {activeFileStatus ? <WorkspaceChangedStatusBadge status={activeFileStatus} /> : null}
            <FileViewerToolbar
              lineCount={countFileLines(fileResult)}
              canToggleMarkdown={previewKind === "markdown"}
              markdownSourceVisible={markdownSourceVisible}
              onToggleMarkdownSource={() => {
                setMarkdownSourceVisible((current) => !current);
              }}
              wordWrap={wordWrap}
              onToggleWordWrap={() => {
                setWordWrap((current) => !current);
              }}
              onCopyPath={handleCopyPath}
              onOpenInEditor={() => {
                void handleOpenInEditor();
              }}
            />
          </div>

          {cwd !== null && activeFilePath !== null && readFileQuery.isPending ? (
            <PanelLoading label={messages.sidebar.files.viewer.loading} />
          ) : readFileQuery.isError ? (
            <PanelPlaceholder
              label={resolveReadFailureLabel({
                error: readFileQuery.error,
                missingLabel: messages.sidebar.files.viewer.fileMissing,
                failedLabel: messages.sidebar.files.viewer.loadFailed,
              })}
            />
          ) : fileResult?.kind === "too-large" ? (
            <PanelPlaceholder label={messages.sidebar.files.viewer.tooLarge} />
          ) : fileResult?.kind === "binary" ? (
            <PanelPlaceholder label={messages.sidebar.files.viewer.binary} />
          ) : fileResult?.kind === "text" && fileResult.contents.length === 0 ? (
            <PanelPlaceholder label={messages.sidebar.files.viewer.empty} />
          ) : previewKind === "image" ? (
            <WorkspaceImagePreview cwd={cwd} relativePath={activeFilePath} />
          ) : hasTextContents && showMarkdownPreview ? (
            <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
              <ChatMarkdown
                text={fileResult.contents}
                cwd={cwd}
                className="text-sm leading-relaxed"
              />
            </div>
          ) : hasTextContents ? (
            <Suspense fallback={<PanelLoading label={messages.sidebar.files.viewer.loading} />}>
              <WorkspaceTextFile
                filePath={activeFilePath}
                contents={fileResult.contents}
                wordWrap={wordWrap}
                theme={resolvedTheme}
              />
            </Suspense>
          ) : null}
        </div>
      )}
    </DiffPanelShell>
  );
}

function countFileLines(result: ProjectReadFileResult | undefined): number | null {
  if (result?.kind !== "text" || result.contents.length === 0) {
    return null;
  }
  return result.contents.split("\n").length;
}

function resolveReadFailureLabel(input: {
  error: unknown;
  missingLabel: string;
  failedLabel: string;
}): string {
  const message = input.error instanceof Error ? input.error.message : "";
  // The server surfaces ENOENT through its wrapped error message; treat it as a missing file.
  return /ENOENT|no such file|not found/i.test(message) ? input.missingLabel : input.failedLabel;
}

function PanelPlaceholder(props: { label: string }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center">
      <p className="max-w-[36ch] font-system-ui text-[length:var(--app-font-size-ui,12px)] text-muted-foreground/55">
        {props.label}
      </p>
    </div>
  );
}

function PanelLoading(props: { label: string }) {
  return (
    <div
      className="flex min-h-0 flex-1 items-center justify-center gap-2 text-muted-foreground/55"
      role="status"
      aria-live="polite"
    >
      <LoaderIcon className="size-4 animate-spin" />
      <span className="font-system-ui text-[length:var(--app-font-size-ui,12px)]">
        {props.label}
      </span>
    </div>
  );
}

function FileViewerHeader(props: {
  activeFilePath: string | null;
  openFilePaths: readonly string[];
  cwd: string | null;
  onSelectTab: (path: string) => void;
  onCloseTab: (path: string) => void;
  onBrowseFiles: () => void;
  onClosePanel: () => void;
  onCopyPath: (absolute: boolean) => void;
}) {
  const messages = useMessages();
  const { resolvedTheme } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (menuContainerRef.current?.contains(event.target as Node)) {
        return;
      }
      setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  return (
    <>
      <div className="relative flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
        {props.openFilePaths.map((filePath) => {
          const isActive = filePath === props.activeFilePath;
          return (
            <div
              key={filePath}
              data-active={isActive ? "true" : undefined}
              className={cn(
                "group/tab flex min-w-0 shrink-0 items-center gap-1 rounded-md py-0.5 pl-1.5 pr-1 transition-colors",
                isActive
                  ? "bg-[var(--color-background-button-secondary)] text-foreground/95"
                  : "text-muted-foreground/70 hover:bg-[var(--color-background-button-secondary-hover)]",
              )}
            >
              <button
                type="button"
                className="flex min-w-0 items-center gap-1.5"
                title={filePath}
                onClick={() => {
                  props.onSelectTab(filePath);
                }}
              >
                <FileEntryIcon
                  pathValue={filePath}
                  kind="file"
                  theme={resolvedTheme}
                  className="size-3.5"
                />
                <span className="max-w-[10rem] truncate font-system-ui text-[length:var(--app-font-size-ui,12px)]">
                  {basenameOfWorkspacePath(filePath)}
                </span>
              </button>
              <button
                type="button"
                aria-label={messages.sidebar.files.viewer.closeTab}
                className="inline-flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground/45 opacity-0 transition-opacity hover:text-foreground/80 group-hover/tab:opacity-100 data-[active=true]:opacity-100"
                data-active={isActive ? "true" : undefined}
                onClick={() => {
                  props.onCloseTab(filePath);
                }}
              >
                <XIcon className="size-3" />
              </button>
            </div>
          );
        })}
        <button
          type="button"
          aria-label={messages.sidebar.files.viewer.browseFiles}
          title={messages.sidebar.files.viewer.browseFiles}
          className="sidebar-icon-button ml-0.5 shrink-0"
          onClick={props.onBrowseFiles}
        >
          <PlusIcon className="size-3.5" />
        </button>
      </div>
      <div ref={menuContainerRef} className="relative flex shrink-0 items-center gap-1">
        <button
          type="button"
          aria-label={messages.sidebar.files.showFiles}
          className="sidebar-icon-button"
          onClick={() => {
            setMenuOpen((current) => !current);
          }}
        >
          <EllipsisIcon className="size-3.5" />
        </button>
        {menuOpen ? (
          <FileViewerMenu
            cwd={props.cwd}
            filePath={props.activeFilePath}
            onClose={() => {
              setMenuOpen(false);
            }}
            onBrowseFiles={props.onBrowseFiles}
            onCopyPath={props.onCopyPath}
          />
        ) : null}
        <button
          type="button"
          aria-label={messages.sidebar.files.viewer.closePanel}
          className="sidebar-icon-button"
          onClick={props.onClosePanel}
        >
          <XIcon className="size-3.5" />
        </button>
      </div>
    </>
  );
}

function FileViewerMenu(props: {
  cwd: string | null;
  filePath: string | null;
  onClose: () => void;
  onBrowseFiles: () => void;
  onCopyPath: (absolute: boolean) => void;
}) {
  const messages = useMessages();

  return (
    <div
      role="menu"
      className="absolute right-0 top-[calc(100%+4px)] z-50 min-w-[12rem] rounded-lg border border-border bg-popover p-1 shadow-md"
    >
      <button
        type="button"
        role="menuitem"
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left font-system-ui text-[length:var(--app-font-size-ui,12px)] hover:bg-[var(--color-background-button-secondary-hover)]"
        onClick={props.onBrowseFiles}
      >
        <FolderOpenIcon className="size-3.5 text-muted-foreground/60" />
        {messages.sidebar.files.showFiles}
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={props.filePath === null}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left font-system-ui text-[length:var(--app-font-size-ui,12px)] hover:bg-[var(--color-background-button-secondary-hover)] disabled:opacity-50"
        onClick={() => {
          props.onCopyPath(false);
          props.onClose();
        }}
      >
        <CopyIcon className="size-3.5 text-muted-foreground/60" />
        {messages.sidebar.files.copyRelativePath}
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={!props.cwd || props.filePath === null}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left font-system-ui text-[length:var(--app-font-size-ui,12px)] hover:bg-[var(--color-background-button-secondary-hover)] disabled:opacity-50"
        onClick={() => {
          props.onCopyPath(true);
          props.onClose();
        }}
      >
        <CopyIcon className="size-3.5 text-muted-foreground/60" />
        {messages.sidebar.files.copyAbsolutePath}
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={!props.cwd || props.filePath === null}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left font-system-ui text-[length:var(--app-font-size-ui,12px)] hover:bg-[var(--color-background-button-secondary-hover)] disabled:opacity-50"
        onClick={() => {
          const api = readNativeApi();
          if (!api || !props.cwd || !props.filePath) return;
          void api.shell
            .showInFolder(joinWorkspacePath(props.cwd, props.filePath))
            .catch((error: unknown) => {
              toastManager.add({
                type: "error",
                title: messages.sidebar.files.revealInFileManagerFailed,
                ...(error instanceof Error ? { description: error.message } : {}),
                timeout: 3000,
              });
            });
          props.onClose();
        }}
      >
        <ExternalLinkIcon className="size-3.5 text-muted-foreground/60" />
        {messages.sidebar.files.revealInFileManager}
      </button>
    </div>
  );
}

function FileViewerToolbar(props: {
  lineCount: number | null;
  canToggleMarkdown: boolean;
  markdownSourceVisible: boolean;
  onToggleMarkdownSource: () => void;
  wordWrap: boolean;
  onToggleWordWrap: () => void;
  onCopyPath: (absolute: boolean) => void;
  onOpenInEditor: () => void;
}) {
  const messages = useMessages();

  return (
    <div className="flex shrink-0 items-center gap-0.5 text-muted-foreground/50">
      {props.lineCount !== null ? (
        <span className="pr-1.5 font-system-ui text-[length:var(--app-font-size-ui,11px)]">
          {messages.sidebar.files.viewer.lineCount(props.lineCount)}
        </span>
      ) : null}
      {props.canToggleMarkdown ? (
        <button
          type="button"
          data-active={props.markdownSourceVisible ? "true" : undefined}
          className="rounded-sm px-1.5 py-0.5 font-system-ui text-[length:var(--app-font-size-ui,11px)] transition-colors hover:bg-[var(--color-background-button-secondary-hover)] hover:text-foreground/80"
          onClick={props.onToggleMarkdownSource}
        >
          {props.markdownSourceVisible
            ? messages.sidebar.files.viewer.previewMode
            : messages.sidebar.files.viewer.sourceMode}
        </button>
      ) : null}
      <button
        type="button"
        aria-label={messages.sidebar.files.viewer.wrapLines}
        title={messages.sidebar.files.viewer.wrapLines}
        data-active={props.wordWrap ? "true" : undefined}
        className={cn("sidebar-icon-button", props.wordWrap && "text-foreground/85")}
        onClick={props.onToggleWordWrap}
      >
        <TextWrapIcon className="size-3.5" />
      </button>
      <button
        type="button"
        aria-label={messages.sidebar.files.copyRelativePath}
        title={messages.sidebar.files.copyRelativePath}
        className="sidebar-icon-button"
        onClick={() => {
          props.onCopyPath(false);
        }}
      >
        <CopyIcon className="size-3.5" />
      </button>
      <button
        type="button"
        aria-label={messages.sidebar.files.openInEditor}
        title={messages.sidebar.files.openInEditor}
        className="sidebar-icon-button"
        onClick={props.onOpenInEditor}
      >
        <ExternalLinkIcon className="size-3.5" />
      </button>
    </div>
  );
}

function WorkspaceImagePreview(props: { cwd: string; relativePath: string }) {
  const messages = useMessages();
  const src = useMemo(
    () =>
      buildLocalImageUrl({
        src: joinWorkspacePath(props.cwd, props.relativePath),
        cwd: props.cwd,
      }),
    [props.cwd, props.relativePath],
  );
  const [failed, setFailed] = useState(false);

  if (failed) {
    return <PanelPlaceholder label={messages.sidebar.files.viewer.loadFailed} />;
  }

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-6">
      <img
        src={src}
        alt={props.relativePath}
        className="max-h-full max-w-full object-contain"
        onError={() => {
          setFailed(true);
        }}
      />
    </div>
  );
}
