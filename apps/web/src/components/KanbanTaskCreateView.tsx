// FILE: KanbanTaskCreateView.tsx
// Purpose: Full-page creation of a kanban task. The board's "New task" action
//          opens this page instead of a small dialog, so the whole form — title,
//          requirements (with agent drafting), priority, status, pipeline,
//          assignee and agent — has room to breathe and cannot be dismissed by a
//          stray backdrop click. Leaving with unsaved fields asks first.
// Layer: Component
// Exports: KanbanTaskCreateView

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
} from "react";
import {
  KANBAN_AGENT_PROVIDERS,
  KANBAN_TASK_STATUSES,
  type KanbanAgentProvider,
  type KanbanTaskPriority,
  type KanbanTaskStatus,
  type KanbanUploadTaskAttachment,
  type ProjectId,
} from "@peakcode/contracts";
import { useBlocker, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { useAppSettings } from "../appSettings";
import { useMessages } from "../i18n/I18nContext";
import { providerModelsQueryOptions } from "../lib/providerDiscoveryReactQuery";
import {
  KANBAN_TASK_MAX_ATTACHMENTS,
  imageFilesFromClipboard,
  readKanbanAttachmentDataUrl,
  revokeKanbanAttachmentPreviews,
  selectKanbanAttachmentFiles,
  toKanbanDraftAttachment,
  type KanbanDraftAttachment,
} from "../lib/kanbanTaskAttachments";
import {
  emptyKanbanTaskDraft,
  isKanbanTaskDraftDirty,
  type KanbanTaskDraft,
} from "../lib/kanbanTaskDraft";
import { kanbanStatusLabel } from "../lib/kanbanPresentation";
import {
  useKanbanBoardQuery,
  useKanbanCreateTaskMutation,
  useKanbanGenerateRequirementDraftMutation,
  useKanbanProjectsQuery,
} from "../lib/kanbanReactQuery";
import { ArrowLeftIcon, LoaderIcon, PaperclipIcon, SparklesIcon } from "../lib/icons";
import { cn } from "../lib/utils";
import { isElectron } from "../env";
import { useLeadingColumnTrafficLightGutterClassName } from "../hooks/useDesktopTopBarGutter";
import { KanbanStatusGlyph } from "./KanbanPresentation";
import { KanbanTaskAttachments } from "./KanbanTaskAttachments";
import { SidebarInset } from "./ui/sidebar";
import { toastManager } from "./ui/toast";

const PROVIDER_LABELS: Record<string, string> = { pi: "Pi" };

const providerLabel = (provider: string): string => PROVIDER_LABELS[provider] ?? provider;

export function KanbanTaskCreateView(props: {
  projectId: ProjectId | null;
  initialStatus: KanbanTaskStatus;
}) {
  const { projectId, initialStatus } = props;
  const messages = useMessages();
  const navigate = useNavigate();
  const { settings } = useAppSettings();
  // The kanban surface replaces the workspace sidebar, so this page's own header
  // owns the window's left edge and has to clear the desktop traffic lights.
  const leadingColumnGutter = useLeadingColumnTrafficLightGutterClassName();

  const projectsQuery = useKanbanProjectsQuery();
  const boardQuery = useKanbanBoardQuery(projectId);
  const board = boardQuery.data ?? null;
  const createTask = useKanbanCreateTaskMutation();
  const generateRequirementDraft = useKanbanGenerateRequirementDraftMutation();

  const [draft, setDraft] = useState<KanbanTaskDraft>(() => emptyKanbanTaskDraft(initialStatus));
  const [attachments, setAttachments] = useState<ReadonlyArray<KanbanDraftAttachment>>([]);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  // Mirrors the state so paste/drop handlers and the unmount cleanup always see
  // the latest list, without re-creating callbacks on every keystroke.
  const attachmentsRef = useRef<ReadonlyArray<KanbanDraftAttachment>>([]);
  const setAttachmentList = useCallback((next: ReadonlyArray<KanbanDraftAttachment>) => {
    attachmentsRef.current = next;
    setAttachments(next);
  }, []);
  useEffect(() => () => revokeKanbanAttachmentPreviews(attachmentsRef.current), []);

  const agentModelsQuery = useQuery(
    providerModelsQueryOptions({
      provider: draft.agentProvider === "pi" ? "pi" : "pi",
      binaryPath: settings.piBinaryPath || null,
      agentDir: settings.piAgentDir || null,
      enabled: projectId !== null,
    }),
  );

  const selectedSummary = useMemo(
    () => projectsQuery.data?.projects.find((project) => project.projectId === projectId) ?? null,
    [projectId, projectsQuery.data],
  );

  /**
   * Models the selected agent is configured with, plus any slug the draft still
   * stores. Same-named models from different upstream providers are qualified so
   * the list stays unambiguous.
   */
  const agentModelOptions = useMemo(() => {
    const models = agentModelsQuery.data?.models ?? [];
    const nameCounts = new Map<string, number>();
    for (const model of models) {
      nameCounts.set(model.name, (nameCounts.get(model.name) ?? 0) + 1);
    }
    const options = models.map((model) => ({
      value: model.slug,
      label:
        (nameCounts.get(model.name) ?? 0) > 1 && model.upstreamProviderName
          ? `${model.name} · ${model.upstreamProviderName}`
          : model.name,
    }));
    if (
      draft.agentModel.length > 0 &&
      !options.some((option) => option.value === draft.agentModel)
    ) {
      options.unshift({ value: draft.agentModel, label: draft.agentModel });
    }
    return options;
  }, [agentModelsQuery.data, draft.agentModel]);

  const defaultModelLabel = useMemo(() => {
    const selection = selectedSummary?.defaultModelSelection ?? null;
    if (!selection) return messages.kanban.defaultModel;
    const match = agentModelOptions.find((option) => option.value === selection.model);
    return messages.kanban.defaultModelWithName(match?.label ?? selection.model);
  }, [agentModelOptions, messages, selectedSummary]);

  /** Board column order, falling back to the standard columns while loading. */
  const columnKeys: ReadonlyArray<KanbanTaskStatus> = useMemo(
    () => board?.columns.map((column) => column.key) ?? KANBAN_TASK_STATUSES,
    [board],
  );

  const columnLabel = useCallback(
    (status: KanbanTaskStatus): string => kanbanStatusLabel(messages, status),
    [messages],
  );

  const dirty = useMemo(
    () => isKanbanTaskDraftDirty(draft, initialStatus) || attachments.length > 0,
    [draft, initialStatus, attachments.length],
  );

  /** Set right before a deliberate navigation so the leave guard stays quiet. */
  const allowLeaveRef = useRef(false);

  const leaveToBoard = useCallback(() => {
    if (dirty && !window.confirm(messages.kanban.unsavedChangesConfirm)) return;
    allowLeaveRef.current = true;
    void navigate({ to: "/kanban" });
  }, [dirty, messages, navigate]);

  // Guard every route change (sidebar, keyboard, history) plus reload/close while
  // the draft holds unsaved input. Cancel/back already asked, and submitting
  // succeeds by returning to the board, so those paths bypass the prompt.
  useBlocker({
    disabled: !dirty,
    enableBeforeUnload: dirty,
    shouldBlockFn: () => {
      if (allowLeaveRef.current) return false;
      return !window.confirm(messages.kanban.unsavedChangesConfirm);
    },
  });

  const addAttachmentFiles = useCallback(
    (files: ReadonlyArray<File>) => {
      const { accepted, rejected } = selectKanbanAttachmentFiles(
        files,
        attachmentsRef.current.length,
      );
      if (rejected.length > 0) {
        toastManager.add({ type: "error", title: messages.kanban.imageRejected });
      }
      if (accepted.length === 0) return;
      setAttachmentList([
        ...attachmentsRef.current,
        ...accepted.map((file) => toKanbanDraftAttachment(file)),
      ]);
    },
    [messages, setAttachmentList],
  );

  const removeAttachment = useCallback(
    (id: string) => {
      revokeKanbanAttachmentPreviews(
        attachmentsRef.current.filter((attachment) => attachment.id === id),
      );
      setAttachmentList(attachmentsRef.current.filter((attachment) => attachment.id !== id));
    },
    [setAttachmentList],
  );

  const onDescriptionPaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const files = imageFilesFromClipboard(event.clipboardData?.items ?? null);
      if (files.length === 0) return;
      event.preventDefault();
      addAttachmentFiles(files);
    },
    [addAttachmentFiles],
  );

  const onDescriptionDrop = useCallback(
    (event: DragEvent<HTMLTextAreaElement>) => {
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length === 0) return;
      event.preventDefault();
      addAttachmentFiles(files);
    },
    [addAttachmentFiles],
  );

  const submitDraft = useCallback(async () => {
    if (!projectId) return;
    const title = draft.title.trim();
    if (title.length === 0) return;

    let uploads: Array<KanbanUploadTaskAttachment> = [];
    if (attachments.length > 0) {
      try {
        uploads = await Promise.all(
          attachments.map(async (attachment) => ({
            name: attachment.name,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes,
            dataUrl: await readKanbanAttachmentDataUrl(attachment.file),
          })),
        );
      } catch (error) {
        toastManager.add({
          type: "error",
          title: error instanceof Error ? error.message : String(error),
        });
        return;
      }
    }

    createTask.mutate(
      {
        projectId,
        title,
        description: draft.description.trim(),
        ...(uploads.length > 0 ? { attachments: uploads } : {}),
        status: draft.status,
        priority: draft.priority,
        pipeline: draft.pipeline.trim(),
        assignee: draft.assignee.trim(),
        agentProvider: draft.agentProvider,
        agentModel: draft.agentModel,
      },
      {
        onSuccess: () => {
          allowLeaveRef.current = true;
          void navigate({ to: "/kanban" });
        },
      },
    );
  }, [attachments, createTask, draft, navigate, projectId]);

  /**
   * Drafts the requirement for the task being written: the title and whatever the
   * user already typed go to the agent, and the brief comes back into the
   * description field for review before the task is created.
   */
  const onGenerateRequirement = useCallback(async () => {
    if (!projectId) return;
    const title = draft.title.trim();
    if (title.length === 0) return;
    const notes = draft.description.trim();
    if (notes.length > 0 && !window.confirm(messages.kanban.detail.generateRequirementConfirm)) {
      return;
    }

    try {
      const generated = await generateRequirementDraft.mutateAsync({
        projectId,
        title,
        ...(notes.length > 0 ? { notes } : {}),
        agentProvider: draft.agentProvider,
        ...(draft.agentModel.length > 0 ? { agentModel: draft.agentModel } : {}),
      });
      // The brief only lands if the title it was drafted from is still there.
      setDraft((previous) =>
        previous.title.trim() === title
          ? { ...previous, description: generated.requirement }
          : previous,
      );
    } catch {
      // The mutation already reported the failure; the draft keeps its text.
    }
  }, [draft, generateRequirementDraft, messages, projectId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        leaveToBoard();
        return;
      }
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        void submitDraft();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [leaveToBoard, submitDraft]);

  const renderHeader = () => (
    <header
      className={cn(
        "flex shrink-0 items-center gap-3 border-b border-border/60 px-6 py-4",
        isElectron && "drag-region",
        leadingColumnGutter,
      )}
    >
      <button
        type="button"
        onClick={leaveToBoard}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border/60 bg-background/60 px-2.5 text-[12px] text-foreground/80 transition-colors hover:bg-accent/40"
      >
        <ArrowLeftIcon className="size-3.5" />
        {messages.kanban.detail.back}
      </button>
      <div className="min-w-0">
        <h1 className="truncate text-[18px] font-semibold text-foreground">
          {messages.kanban.newTask}
        </h1>
        <p className="mt-0.5 truncate text-[12px] text-muted-foreground/80">
          {selectedSummary?.title ?? board?.projectTitle ?? ""}
        </p>
      </div>
    </header>
  );

  const renderBody = () => {
    if (!projectId) {
      return (
        <div className="mx-auto flex w-full max-w-2xl flex-col items-center text-center">
          <p className="text-[13px] text-muted-foreground/85">{messages.kanban.selectProject}</p>
        </div>
      );
    }

    return (
      <form
        className="mx-auto flex w-full max-w-2xl flex-col gap-4"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          void submitDraft();
        }}
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium tracking-wider text-muted-foreground/70 uppercase">
            {messages.kanban.taskTitle}
          </span>
          <input
            autoFocus
            value={draft.title}
            placeholder={messages.kanban.taskTitlePlaceholder}
            onChange={(event) => setDraft((prev) => ({ ...prev, title: event.target.value }))}
            className="h-10 rounded-md border border-border/60 bg-background/60 px-3 text-[14px] text-foreground outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
          />
        </label>

        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium tracking-wider text-muted-foreground/70 uppercase">
            {messages.kanban.taskDescription}
          </span>
          <textarea
            rows={10}
            value={draft.description}
            aria-label={messages.kanban.taskDescription}
            placeholder={messages.kanban.taskDescriptionPlaceholder}
            onChange={(event) => setDraft((prev) => ({ ...prev, description: event.target.value }))}
            onPaste={onDescriptionPaste}
            onDrop={onDescriptionDrop}
            onDragOver={(event) => event.preventDefault()}
            className="resize-y rounded-md border border-border/60 bg-background/60 px-3 py-2.5 text-[13.5px] leading-relaxed text-foreground outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
          />
          {attachments.length > 0 ? (
            <KanbanTaskAttachments
              items={attachments.map((attachment) => ({
                key: attachment.id,
                src: attachment.previewUrl,
                name: attachment.name,
              }))}
              onRemove={removeAttachment}
              removeLabel={messages.kanban.removeImage}
            />
          ) : null}
          <div className="flex items-center gap-2">
            <span className="flex-1 text-[11.5px] leading-relaxed text-muted-foreground/55">
              {messages.kanban.detail.generateRequirementHint}
            </span>
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                addAttachmentFiles(files);
                event.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => imageInputRef.current?.click()}
              disabled={attachments.length >= KANBAN_TASK_MAX_ATTACHMENTS}
              title={messages.kanban.imageHint}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border/60 bg-background/60 px-3 text-[12px] text-foreground/80 transition-colors hover:bg-accent/40 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <PaperclipIcon className="size-3.5" />
              {messages.kanban.addImage}
            </button>
            <button
              type="button"
              onClick={() => void onGenerateRequirement()}
              disabled={generateRequirementDraft.isPending || draft.title.trim().length === 0}
              title={messages.kanban.detail.generateRequirementHint}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border/60 bg-background/60 px-3 text-[12px] text-foreground/80 transition-colors hover:bg-accent/40 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {generateRequirementDraft.isPending ? (
                <LoaderIcon className="size-3.5 animate-spin" />
              ) : (
                <SparklesIcon className="size-3.5" />
              )}
              {generateRequirementDraft.isPending
                ? messages.kanban.detail.generatingRequirement
                : messages.kanban.detail.generateRequirement}
            </button>
          </div>
          <span className="text-[11px] leading-relaxed text-muted-foreground/45">
            {messages.kanban.imageHint}
          </span>
        </div>

        <div className="flex gap-4">
          <div className="flex flex-1 flex-col gap-1.5">
            <span className="text-[11px] font-medium tracking-wider text-muted-foreground/70 uppercase">
              {messages.kanban.priority}
            </span>
            <div className="inline-flex rounded-md bg-[var(--color-background-elevated-secondary)] p-0.5">
              {(["high", "medium", "low"] as const).map((priority: KanbanTaskPriority) => (
                <button
                  key={priority}
                  type="button"
                  onClick={() => setDraft((prev) => ({ ...prev, priority }))}
                  className={cn(
                    "flex-1 rounded-sm px-2 py-1.5 text-[12px] font-medium transition-colors",
                    draft.priority === priority
                      ? "bg-[var(--composer-surface)] text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {messages.kanban.priorities[priority]}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-1 flex-col gap-1.5">
            <span className="text-[11px] font-medium tracking-wider text-muted-foreground/70 uppercase">
              {messages.kanban.status}
            </span>
            <div
              role="radiogroup"
              aria-label={messages.kanban.status}
              className="flex flex-wrap gap-1"
            >
              {columnKeys.map((key) => (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={draft.status === key}
                  onClick={() => setDraft((prev) => ({ ...prev, status: key }))}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12px] transition-colors",
                    draft.status === key
                      ? "border-border bg-[var(--composer-surface)] text-foreground shadow-xs"
                      : "border-transparent bg-[var(--color-background-elevated-secondary)] text-muted-foreground hover:text-foreground",
                  )}
                >
                  <KanbanStatusGlyph status={key} />
                  {columnLabel(key)}
                </button>
              ))}
            </div>
          </div>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium tracking-wider text-muted-foreground/70 uppercase">
            {messages.kanban.pipeline}
          </span>
          <input
            value={draft.pipeline}
            placeholder={messages.kanban.pipelinePlaceholder}
            onChange={(event) => setDraft((prev) => ({ ...prev, pipeline: event.target.value }))}
            className="h-10 rounded-md border border-border/60 bg-background/60 px-3 text-[13px] text-foreground outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium tracking-wider text-muted-foreground/70 uppercase">
            {messages.kanban.assignee}
          </span>
          <input
            value={draft.assignee}
            placeholder={messages.kanban.assigneePlaceholder}
            onChange={(event) => setDraft((prev) => ({ ...prev, assignee: event.target.value }))}
            className="h-10 rounded-md border border-border/60 bg-background/60 px-3 text-[13px] text-foreground outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
          />
        </label>

        <div className="flex gap-4">
          <label className="flex flex-1 flex-col gap-1.5">
            <span className="text-[11px] font-medium tracking-wider text-muted-foreground/70 uppercase">
              {messages.kanban.agent}
            </span>
            <select
              value={draft.agentProvider}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  agentProvider: event.target.value as KanbanAgentProvider,
                  agentModel: "",
                }))
              }
              className="h-10 rounded-md border border-border/60 bg-background/60 px-2.5 text-[13px] text-foreground outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
            >
              {KANBAN_AGENT_PROVIDERS.map((provider) => (
                <option key={provider} value={provider}>
                  {providerLabel(provider)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-[1.4] flex-col gap-1.5">
            <span className="text-[11px] font-medium tracking-wider text-muted-foreground/70 uppercase">
              {messages.kanban.agentModel}
            </span>
            <select
              value={draft.agentModel}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, agentModel: event.target.value }))
              }
              className="h-10 rounded-md border border-border/60 bg-background/60 px-2.5 text-[13px] text-foreground outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="">{defaultModelLabel}</option>
              {agentModelOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <span className="flex-1 text-[11.5px] text-muted-foreground/50">⌘↵</span>
          <button
            type="button"
            onClick={leaveToBoard}
            className="inline-flex h-9 items-center rounded-md border border-border/60 bg-background/60 px-4 text-[12.5px] text-foreground/80 transition-colors hover:bg-accent/40"
          >
            {messages.kanban.cancel}
          </button>
          <button
            type="submit"
            disabled={draft.title.trim().length === 0 || createTask.isPending}
            className="inline-flex h-9 items-center rounded-md bg-foreground/90 px-4 text-[12.5px] font-medium text-background transition-colors hover:bg-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            {messages.kanban.create}
          </button>
        </div>
      </form>
    );
  };

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden isolate">
      <div className="flex h-full min-h-0 flex-col bg-background">
        {renderHeader()}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{renderBody()}</div>
      </div>
    </SidebarInset>
  );
}
