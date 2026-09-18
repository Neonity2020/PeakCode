// FILE: KanbanTaskDetailView.tsx
// Purpose: Full-page view of one kanban task: its requirement, the agent run it
//          was handed to, and the comment stream that tracks it (agent notices,
//          the agent's own messages, and human comments with insert/interrupt).
//          The requirement reads as text by default; rewriting it takes an
//          explicit edit action, and follow-ups belong in the comments.
// Layer: Component
// Exports: KanbanTaskDetailView

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  KANBAN_AGENT_PROVIDERS,
  KANBAN_TASK_STATUSES,
  type KanbanAgentProvider,
  type KanbanAgentRunStatus,
  type KanbanComment,
  type KanbanCommentAction,
  type KanbanTask,
  type KanbanTaskId,
  type KanbanTaskPriority,
  type KanbanTaskStatus,
  type ProjectId,
} from "@peakcode/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { useAppSettings } from "../appSettings";
import { useMessages } from "../i18n/I18nContext";
import { providerModelsQueryOptions } from "../lib/providerDiscoveryReactQuery";
import { generationFailureReasonText } from "../lib/kanbanGenerationFailure";
import { buildLocalImageUrl } from "../lib/localImageUrls";
import {
  useKanbanAddTaskCommentMutation,
  useKanbanDeleteTaskMutation,
  useKanbanGenerateRequirementDraftMutation,
  useKanbanGenerateTaskRequirementMutation,
  useKanbanTaskDetailQuery,
  useKanbanUpdateTaskMutation,
} from "../lib/kanbanReactQuery";
import { persistKanbanProjectId } from "../kanbanUiState";
import { ArrowLeftIcon, LoaderIcon, SparklesIcon, SquarePenIcon, Trash2 } from "../lib/icons";
import {
  KANBAN_PRIORITY_CLASS,
  KANBAN_RUN_STATUS_CLASS,
  kanbanProjectCode,
  kanbanRunStatusLabel,
  kanbanStatusLabel,
  kanbanTaskCode,
} from "../lib/kanbanPresentation";
import { cn } from "../lib/utils";
import { isElectron } from "../env";
import { useLeadingColumnTrafficLightGutterClassName } from "../hooks/useDesktopTopBarGutter";
import ChatMarkdown from "./ChatMarkdown";
import {
  KanbanPriorityMeter,
  KanbanRunStatusMarker,
  KanbanStatusGlyph,
} from "./KanbanPresentation";
import { KanbanTaskAttachments } from "./KanbanTaskAttachments";
import { formatRelativeTime } from "./Sidebar";
import { SidebarInset } from "./ui/sidebar";

const PROVIDER_LABELS: Record<string, string> = { pi: "Pi" };

const providerLabel = (provider: string): string => PROVIDER_LABELS[provider] ?? provider;

/**
 * Editor state for the task fields the detail page can change. The requirement
 * is deliberately absent: it is the brief the task was handed to the agent with,
 * so it changes through its own edit action instead of the header form.
 */
interface TaskDraft {
  readonly title: string;
  readonly status: KanbanTaskStatus;
  readonly priority: KanbanTaskPriority;
  readonly agentProvider: KanbanAgentProvider;
  readonly agentModel: string;
}

function draftFromTask(task: KanbanTask): TaskDraft {
  return {
    title: task.title,
    status: task.status,
    priority: task.priority,
    agentProvider: task.agentProvider,
    agentModel: task.agentModel,
  };
}

export function KanbanTaskDetailView(props: { projectId: ProjectId | null; taskId: KanbanTaskId }) {
  const messages = useMessages();
  const navigate = useNavigate();
  const { projectId, taskId } = props;
  // The kanban surface replaces the workspace sidebar, so this page's own header
  // owns the window's left edge and has to clear the desktop traffic lights.
  const leadingColumnGutter = useLeadingColumnTrafficLightGutterClassName();

  const detailQuery = useKanbanTaskDetailQuery(projectId, taskId);
  const detail = detailQuery.data ?? null;
  const updateTask = useKanbanUpdateTaskMutation();
  const deleteTask = useKanbanDeleteTaskMutation();
  const addComment = useKanbanAddTaskCommentMutation();
  const generateRequirement = useKanbanGenerateTaskRequirementMutation();
  const generateRequirementDraft = useKanbanGenerateRequirementDraftMutation();

  const [draft, setDraft] = useState<TaskDraft | null>(null);
  /** `null` keeps the requirement read-only; a string is an in-flight rewrite. */
  const [requirementDraft, setRequirementDraft] = useState<string | null>(null);
  const [commentBody, setCommentBody] = useState("");
  const { settings } = useAppSettings();
  const agentModelsQuery = useQuery(
    providerModelsQueryOptions({
      provider: draft?.agentProvider === "pi" ? "pi" : "pi",
      binaryPath: settings.piBinaryPath || null,
      agentDir: settings.piAgentDir || null,
      enabled: draft !== null,
    }),
  );

  useEffect(() => {
    if (!projectId) return;
    persistKanbanProjectId(projectId);
  }, [projectId]);

  // The board is the source of truth; a save while polling must not fight it.
  useEffect(() => {
    if (!detail) return;
    setDraft(draftFromTask(detail.task));
  }, [detail]);

  const modelOptions = useMemo(() => {
    if (!draft) return [];
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
  }, [agentModelsQuery.data, draft]);

  const saveDraft = useCallback(() => {
    if (!projectId || !detail || !draft) return;
    const title = draft.title.trim();
    if (title.length === 0) return;
    updateTask.mutate({
      projectId,
      taskId: detail.task.taskId,
      title,
      status: draft.status,
      priority: draft.priority,
      agentProvider: draft.agentProvider,
      agentModel: draft.agentModel,
    });
  }, [detail, draft, projectId, updateTask]);

  const startRequirementEdit = useCallback(() => {
    if (!detail) return;
    setRequirementDraft(detail.task.description);
  }, [detail]);

  const saveRequirement = useCallback(() => {
    if (!projectId || !detail || requirementDraft === null) return;
    updateTask.mutate(
      { projectId, taskId: detail.task.taskId, description: requirementDraft.trim() },
      { onSuccess: () => setRequirementDraft(null) },
    );
  }, [detail, projectId, requirementDraft, updateTask]);

  const runStatus: KanbanAgentRunStatus | null = detail?.task.agentRunStatus ?? null;
  const runIsActive = runStatus === "running" && Boolean(detail?.task.agentThreadId);

  const sendComment = useCallback(
    (action: KanbanCommentAction) => {
      if (!projectId || !detail) return;
      const body = commentBody.trim();
      // Interrupting needs no text; steering and plain comments do.
      if (body.length === 0 && action !== "interrupt") return;
      addComment.mutate({ projectId, taskId: detail.task.taskId, body, action });
      if (body.length > 0) setCommentBody("");
    },
    [addComment, commentBody, detail, projectId],
  );

  const onCommentKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        sendComment("comment");
      }
    },
    [sendComment],
  );

  const onGenerateRequirement = useCallback(() => {
    if (!projectId || !detail) return;
    const title = detail.task.title.trim();
    if (title.length === 0) return;

    // While the requirement is being written, the agent refines the text in the
    // editor and the brief is pasted back into it, so it can be reviewed before
    // it replaces anything. Read mode rewrites the stored brief directly.
    if (requirementDraft !== null) {
      void generateRequirementDraft
        .mutateAsync({
          projectId,
          title,
          ...(requirementDraft.trim().length > 0 ? { notes: requirementDraft } : {}),
          agentProvider: detail.task.agentProvider,
          ...(detail.task.agentModel.length > 0 ? { agentModel: detail.task.agentModel } : {}),
        })
        .then((generated) =>
          // An editor closed or saved while the agent worked wins over a late brief.
          setRequirementDraft((previous) => (previous === null ? previous : generated.requirement)),
        )
        .catch(() => {
          // The mutation already reported the failure; the draft keeps its text.
        });
      return;
    }

    if (
      detail.task.description.trim().length > 0 &&
      !window.confirm(messages.kanban.detail.generateRequirementConfirm)
    ) {
      return;
    }
    generateRequirement.mutate({ projectId, taskId: detail.task.taskId });
  }, [
    detail,
    generateRequirement,
    generateRequirementDraft,
    messages,
    projectId,
    requirementDraft,
  ]);

  const requirementTitle = detail?.task.title.trim() ?? "";

  const commentStatusLabel = useCallback(
    (comment: KanbanComment): string => {
      switch (comment.statusCode) {
        case "started":
          return messages.kanban.detail.statusStarted;
        case "done":
          return messages.kanban.detail.statusDone;
        case "failed":
          return messages.kanban.detail.statusFailed;
        case "interrupted":
          return messages.kanban.detail.statusInterrupted;
        case "steered":
          return messages.kanban.detail.statusSteered;
        default:
          return comment.body;
      }
    },
    [messages],
  );

  const renderComment = (comment: KanbanComment) => {
    const isStatus = comment.kind === "status";
    const isAgent = comment.author === "agent";
    return (
      <article
        key={comment.commentId}
        data-kanban-comment={comment.kind}
        className={cn(
          "rounded-xl border px-3.5 py-3",
          isStatus
            ? "border-border/40 bg-muted/20 text-muted-foreground"
            : "border-border/50 bg-card/60",
        )}
      >
        <header className="flex items-center gap-2 text-[11.5px]">
          <span
            className={cn(
              "inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-medium text-white/95",
              isAgent ? "bg-info/80" : "bg-foreground/70",
            )}
          >
            {isAgent ? "A" : "U"}
          </span>
          <span className="font-medium text-foreground/80">
            {isAgent ? messages.kanban.detail.authorAgent : messages.kanban.detail.authorUser}
          </span>
          <span className="text-muted-foreground/60" title={comment.createdAt}>
            {formatRelativeTime(comment.createdAt)}
          </span>
          {isStatus ? (
            <span className="ml-auto text-[10.5px] tracking-wider text-muted-foreground/50 uppercase">
              {messages.kanban.agentRun}
            </span>
          ) : null}
        </header>
        <p
          className={cn(
            "mt-2 text-[13px] leading-relaxed whitespace-pre-wrap",
            isStatus ? "text-muted-foreground/85" : "text-foreground/90",
          )}
        >
          {isStatus ? commentStatusLabel(comment) : comment.body}
        </p>
        {isStatus && comment.body.length > 0 ? (
          <>
            {/* The provider's own words are the evidence, not the explanation. */}
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground/85">
              {generationFailureReasonText(messages, comment.body)}
            </p>
            <p className="mt-1 font-mono text-[11.5px] leading-relaxed break-words text-muted-foreground/60">
              {comment.body}
            </p>
          </>
        ) : null}
      </article>
    );
  };

  const renderHeader = () => (
    <header
      className={cn(
        "flex shrink-0 flex-col gap-3 border-b border-border/60 px-6 py-4",
        isElectron && "drag-region",
        leadingColumnGutter,
      )}
    >
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void navigate({ to: "/kanban" })}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border/60 bg-background/60 px-2.5 text-[12px] text-foreground/80 transition-colors hover:bg-accent/40"
        >
          <ArrowLeftIcon className="size-3.5" />
          {messages.kanban.detail.back}
        </button>
        <span className="truncate text-[12px] text-muted-foreground/70">
          {detail?.projectTitle ?? ""}
        </span>
        {detail ? (
          <span
            className="shrink-0 rounded bg-muted/60 px-1.5 py-px font-mono text-[10px] leading-4 text-muted-foreground/70"
            title={messages.kanban.taskId}
            data-kanban-task-code
          >
            {kanbanTaskCode(detail.task.taskId, kanbanProjectCode(detail.projectTitle))}
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          {detail ? (
            <span
              className={cn(
                "inline-flex items-center gap-1.5 text-[12px]",
                runStatus ? KANBAN_RUN_STATUS_CLASS[runStatus] : "text-muted-foreground/70",
              )}
            >
              {runStatus ? <KanbanRunStatusMarker status={runStatus} /> : null}
              {messages.kanban.agentRun} · {kanbanRunStatusLabel(messages, runStatus)}
            </span>
          ) : null}
          {detail?.task.agentThreadId ? (
            <button
              type="button"
              onClick={() =>
                void navigate({
                  to: "/$threadId",
                  params: { threadId: detail.task.agentThreadId! },
                })
              }
              className="inline-flex h-8 items-center rounded-md border border-border/60 bg-background/60 px-2.5 text-[12px] text-foreground/80 transition-colors hover:bg-accent/40"
            >
              {messages.kanban.openThread}
            </button>
          ) : null}
          {runIsActive ? (
            <button
              type="button"
              onClick={() => sendComment("interrupt")}
              disabled={addComment.isPending}
              className="inline-flex h-8 items-center rounded-md border border-destructive/40 px-2.5 text-[12px] text-destructive transition-colors hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {messages.kanban.detail.interruptRun}
            </button>
          ) : null}
        </div>
      </div>

      {draft && detail ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            saveDraft();
          }}
        >
          <input
            value={draft.title}
            aria-label={messages.kanban.taskTitle}
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            className="h-10 rounded-md border border-border/60 bg-background/60 px-3 text-[16px] font-medium text-foreground outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
          />
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2">
              <span className="text-[11px] font-medium tracking-wider text-muted-foreground/70 uppercase">
                {messages.kanban.status}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <KanbanStatusGlyph status={draft.status} />
                <select
                  value={draft.status}
                  aria-label={messages.kanban.status}
                  onChange={(event) =>
                    setDraft({ ...draft, status: event.target.value as KanbanTaskStatus })
                  }
                  className="h-8 rounded-md border border-border/60 bg-background/60 px-2 text-[12.5px] text-foreground outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
                >
                  {KANBAN_TASK_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {kanbanStatusLabel(messages, status)}
                    </option>
                  ))}
                </select>
              </span>
            </label>
            <div className="inline-flex rounded-md bg-[var(--color-background-elevated-secondary)] p-0.5">
              {(["high", "medium", "low"] as const).map((priority) => (
                <button
                  key={priority}
                  type="button"
                  onClick={() => setDraft({ ...draft, priority })}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-[11.5px] font-medium transition-colors",
                    draft.priority === priority
                      ? cn("shadow-xs", KANBAN_PRIORITY_CLASS[priority])
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <KanbanPriorityMeter priority={priority} />
                  {messages.kanban.priorities[priority]}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2">
              <span className="text-[11px] font-medium tracking-wider text-muted-foreground/70 uppercase">
                {messages.kanban.agent}
              </span>
              <select
                value={draft.agentProvider}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    agentProvider: event.target.value as KanbanAgentProvider,
                    agentModel: "",
                  })
                }
                className="h-8 rounded-md border border-border/60 bg-background/60 px-2 text-[12.5px] text-foreground outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
              >
                {KANBAN_AGENT_PROVIDERS.map((provider) => (
                  <option key={provider} value={provider}>
                    {providerLabel(provider)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2">
              <span className="text-[11px] font-medium tracking-wider text-muted-foreground/70 uppercase">
                {messages.kanban.agentModel}
              </span>
              <select
                value={draft.agentModel}
                onChange={(event) => setDraft({ ...draft, agentModel: event.target.value })}
                className="h-8 max-w-[260px] rounded-md border border-border/60 bg-background/60 px-2 text-[12.5px] text-foreground outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="">{messages.kanban.defaultModel}</option>
                {modelOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="submit"
                disabled={updateTask.isPending || draft.title.trim().length === 0}
                className="inline-flex h-8 items-center rounded-md bg-foreground/90 px-3 text-[12px] font-medium text-background transition-colors hover:bg-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                {messages.kanban.save}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!projectId) return;
                  if (!window.confirm(messages.kanban.deleteTaskConfirm)) return;
                  deleteTask.mutate(
                    { projectId, taskId: detail.task.taskId },
                    { onSuccess: () => void navigate({ to: "/kanban" }) },
                  );
                }}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-destructive/40 px-2.5 text-[12px] text-destructive transition-colors hover:bg-destructive/10"
              >
                <Trash2 className="size-3.5" />
                {messages.kanban.deleteTask}
              </button>
            </div>
          </div>
        </form>
      ) : null}
    </header>
  );

  const renderBody = () => {
    if (detailQuery.isPending) {
      return (
        <div className="flex items-center gap-2 text-[13px] text-muted-foreground/80">
          <LoaderIcon className="size-4 animate-spin" />
          {messages.kanban.detail.loading}
        </div>
      );
    }
    if (detailQuery.isError || !detail) {
      return (
        <p className="text-[13px] text-destructive">
          {messages.kanban.detail.notFound}
          {detailQuery.error ? ` · ${detailQuery.error.message}` : ""}
        </p>
      );
    }

    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <section className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <h2 className="text-[12px] font-medium tracking-wider text-muted-foreground/70 uppercase">
              {messages.kanban.detail.requirement}
            </h2>
            <div className="ml-auto flex items-center gap-2">
              {requirementDraft === null ? (
                <button
                  type="button"
                  onClick={startRequirementEdit}
                  className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-border/60 bg-background/60 px-2.5 text-[12px] text-foreground/80 transition-colors hover:bg-accent/40"
                >
                  <SquarePenIcon className="size-3.5" />
                  {messages.kanban.detail.editRequirement}
                </button>
              ) : null}
              <button
                type="button"
                onClick={onGenerateRequirement}
                disabled={
                  generateRequirement.isPending ||
                  generateRequirementDraft.isPending ||
                  requirementTitle.length === 0
                }
                title={messages.kanban.detail.generateRequirementHint}
                className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-border/60 bg-background/60 px-2.5 text-[12px] text-foreground/80 transition-colors hover:bg-accent/40 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {generateRequirement.isPending || generateRequirementDraft.isPending ? (
                  <LoaderIcon className="size-3.5 animate-spin" />
                ) : (
                  <SparklesIcon className="size-3.5" />
                )}
                {generateRequirement.isPending || generateRequirementDraft.isPending
                  ? messages.kanban.detail.generatingRequirement
                  : messages.kanban.detail.generateRequirement}
              </button>
            </div>
          </div>
          {requirementDraft === null ? (
            <>
              <div
                data-kanban-requirement="read"
                className="rounded-xl border border-border/60 bg-background/60 px-3.5 py-3"
              >
                {detail.task.description.trim().length > 0 ? (
                  <ChatMarkdown
                    text={detail.task.description}
                    cwd={detail.workspaceRoot}
                    className="text-[13px] leading-relaxed"
                  />
                ) : (
                  <p className="text-[12.5px] text-muted-foreground/60">
                    {messages.kanban.detail.requirementEmpty}
                  </p>
                )}
              </div>
              {detail.task.attachments.length > 0 ? (
                <KanbanTaskAttachments
                  items={detail.task.attachments.map((attachment) => ({
                    key: attachment.attachmentId,
                    src: buildLocalImageUrl({
                      src: attachment.relativePath,
                      cwd: detail.workspaceRoot,
                    }),
                    name: attachment.name,
                  }))}
                />
              ) : null}
              <p className="text-[11.5px] text-muted-foreground/55">
                {messages.kanban.detail.requirementAppendHint}
              </p>
            </>
          ) : (
            <div className="flex flex-col gap-2" data-kanban-requirement="edit">
              <textarea
                autoFocus
                rows={10}
                value={requirementDraft}
                aria-label={messages.kanban.detail.requirement}
                placeholder={messages.kanban.taskDescriptionPlaceholder}
                onChange={(event) => setRequirementDraft(event.target.value)}
                data-kanban-requirement-editor
                className="resize-y rounded-xl border border-border/60 bg-background/60 px-3.5 py-3 text-[13px] leading-relaxed text-foreground outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
              />
              <div className="flex items-center gap-2">
                <span className="flex-1 text-[11.5px] text-muted-foreground/55">
                  {messages.kanban.detail.requirementEditHint}
                </span>
                <button
                  type="button"
                  onClick={() => setRequirementDraft(null)}
                  className="inline-flex h-8 items-center rounded-md border border-border/60 bg-background/60 px-3 text-[12px] text-foreground/80 transition-colors hover:bg-accent/40"
                >
                  {messages.kanban.cancel}
                </button>
                <button
                  type="button"
                  onClick={saveRequirement}
                  disabled={updateTask.isPending}
                  className="inline-flex h-8 items-center rounded-md bg-foreground/90 px-3 text-[12px] font-medium text-background transition-colors hover:bg-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {messages.kanban.detail.saveRequirement}
                </button>
              </div>
            </div>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-[12px] font-medium tracking-wider text-muted-foreground/70 uppercase">
            {messages.kanban.detail.comments}
            <span className="ml-2 text-muted-foreground/50">
              {messages.kanban.detail.commentCount(detail.comments.length)}
            </span>
          </h2>
          {detail.comments.length === 0 ? (
            <p className="text-[12.5px] text-muted-foreground/70">
              {messages.kanban.detail.noComments}
            </p>
          ) : (
            <div className="flex flex-col gap-2.5">{detail.comments.map(renderComment)}</div>
          )}
        </section>

        <section className="flex flex-col gap-2 rounded-xl border border-border/50 bg-card/40 p-3.5">
          <textarea
            rows={3}
            value={commentBody}
            aria-label={messages.kanban.detail.comments}
            placeholder={messages.kanban.detail.commentPlaceholder}
            onChange={(event) => setCommentBody(event.target.value)}
            onKeyDown={onCommentKeyDown}
            className="resize-y rounded-md border border-border/60 bg-background/60 px-3 py-2 text-[13px] leading-relaxed text-foreground outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
          />
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground/50">⌘↵</span>
            <span
              className="flex-1 text-[11.5px] text-muted-foreground/60"
              title={messages.kanban.detail.steerUnavailable}
            >
              {runIsActive ? "" : messages.kanban.detail.steerUnavailable}
            </span>
            <button
              type="button"
              disabled={!runIsActive || commentBody.trim().length === 0 || addComment.isPending}
              onClick={() => sendComment("steer")}
              title={messages.kanban.detail.steerUnavailable}
              className="inline-flex h-8 items-center rounded-md border border-border/60 bg-background/60 px-3 text-[12px] text-foreground/80 transition-colors hover:bg-accent/40 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {messages.kanban.detail.steerComment}
            </button>
            <button
              type="button"
              disabled={commentBody.trim().length === 0 || addComment.isPending}
              onClick={() => sendComment("comment")}
              className="inline-flex h-8 items-center rounded-md bg-foreground/90 px-3 text-[12px] font-medium text-background transition-colors hover:bg-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              {messages.kanban.detail.sendComment}
            </button>
          </div>
        </section>
      </div>
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
