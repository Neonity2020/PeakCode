// FILE: mobile/RemoteControlApp.tsx
// Purpose: The phone's own page: what this computer is working on, and the conversation you
//          opened from it. Nothing from the desktop shell is here on purpose — no sidebar,
//          no split panes, no terminal, no kanban — because the phone is a remote control
//          for the machine, not a second desktop.
// Layer: Mobile view
// Depends on: useDeviceSnapshot, useConversation, h5Tasks, i18n.

import type { OrchestrationProjectShell, OrchestrationThreadShell } from "@peakcode/contracts";
import { useEffect, useMemo, useRef, useState } from "react";

import { useMessages } from "../i18n";
import type { Messages } from "../i18n/messages";
import { cn } from "../lib/utils";
import {
  formatTaskAge,
  isVisibleTask,
  isVisibleWorkspace,
  resolveTaskStatus,
  resolveTaskTimeBucket,
  taskActivityAt,
  type TaskStatus,
} from "./h5Tasks";
import { resolvePhoneReplyModel, useReplyModelDefaults } from "./useReplyModel";
import type { DeviceConnection } from "./useDeviceSnapshot";
import { useDeviceSnapshot } from "./useDeviceSnapshot";
import { useConversation } from "./useConversation";

type RemoteMessages = Messages["remoteControl"];

const STATUS_TONE: Record<TaskStatus, string> = {
  running: "border-border bg-foreground/5 text-foreground/89",
  waiting: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  completed: "border-emerald-600/30 bg-emerald-600/12 text-emerald-700 dark:text-emerald-300",
  failed: "border-destructive/40 bg-destructive/10 text-destructive",
  interrupted: "border-border bg-foreground/5 text-muted-foreground",
  idle: "border-border bg-foreground/5 text-muted-foreground",
};

const SPINNER_STATUSES = new Set<TaskStatus>(["running"]);

function StatusChip({ status, t }: { readonly status: TaskStatus; readonly t: RemoteMessages }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        STATUS_TONE[status],
      )}
    >
      {SPINNER_STATUSES.has(status) ? (
        <span className="inline-block size-2.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
      ) : null}
      {t.status[status]}
    </span>
  );
}

function ConnectionLine({
  connection,
  t,
}: {
  readonly connection: DeviceConnection;
  readonly t: RemoteMessages;
}) {
  return (
    <p className="text-[13px] text-muted-foreground">
      {connection === "connected"
        ? t.connected
        : connection === "connecting"
          ? t.connecting
          : t.disconnected}
    </p>
  );
}

function TaskRow({
  thread,
  projectName,
  now,
  onOpen,
  t,
}: {
  readonly thread: OrchestrationThreadShell;
  readonly projectName: string;
  readonly now: number;
  readonly onOpen: () => void;
  readonly t: RemoteMessages;
}) {
  const status = resolveTaskStatus({
    latestTurn: thread.latestTurn,
    session: thread.session,
    hasPendingApprovals: thread.hasPendingApprovals,
    hasPendingUserInput: thread.hasPendingUserInput,
  });
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 rounded-xl border border-[color:var(--color-border-light)] bg-[var(--color-background-panel)] px-3.5 py-3 text-left transition-colors active:bg-[var(--sidebar-accent)]"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-[15px] font-medium text-foreground">{thread.title}</span>
        <span className="truncate text-[13px] text-muted-foreground">
          {projectName} · {formatTaskAge(taskActivityAt(thread), now)}
        </span>
      </span>
      <StatusChip status={status} t={t} />
    </button>
  );
}

/** Exported for the render test: this list is the whole page's vocabulary, so it is pinned. */
export function TaskListScreen({
  connection,
  projects,
  threads,
  highlightedProjectId,
  refresh,
  refreshing,
  onOpenThread,
}: {
  readonly connection: DeviceConnection;
  readonly projects: ReadonlyArray<OrchestrationProjectShell>;
  readonly threads: ReadonlyArray<OrchestrationThreadShell>;
  readonly highlightedProjectId: string | null;
  readonly refresh: () => void;
  readonly refreshing: boolean;
  readonly onOpenThread: (threadId: string) => void;
}) {
  const t = useMessages().remoteControl;
  const now = Date.now();
  const projectNameById = useMemo(
    () => new Map(projects.map((project) => [project.id, project.title])),
    [projects],
  );
  const workspaces = projects.filter(isVisibleWorkspace);
  const tasks = useMemo(
    () =>
      threads
        .filter(isVisibleTask)
        .toSorted((left, right) => taskActivityAt(right).localeCompare(taskActivityAt(left))),
    [threads],
  );

  const buckets = useMemo(() => {
    const groups: Array<{
      key: "today" | "yesterday" | "earlier";
      label: string;
      items: OrchestrationThreadShell[];
    }> = [
      { key: "today", label: t.bucket.today, items: [] },
      { key: "yesterday", label: t.bucket.yesterday, items: [] },
      { key: "earlier", label: t.bucket.earlier, items: [] },
    ];
    for (const thread of tasks) {
      const bucket = resolveTaskTimeBucket(taskActivityAt(thread), now);
      groups.find((group) => group.key === bucket)?.items.push(thread);
    }
    return groups.filter((group) => group.items.length > 0);
  }, [now, t.bucket.earlier, t.bucket.today, t.bucket.yesterday, tasks]);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col">
      <header className="flex items-start gap-3 bg-[var(--color-background-panel)] px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h1 className="text-[19px] font-semibold text-foreground">{t.title}</h1>
          <ConnectionLine connection={connection} t={t} />
        </div>
        <button
          type="button"
          aria-label={t.refresh}
          onClick={refresh}
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors active:bg-[var(--sidebar-accent)]"
        >
          <RefreshIcon className={refreshing ? "animate-spin" : undefined} />
        </button>
      </header>

      <div className="flex flex-1 flex-col gap-5 px-4 py-4">
        <p className="rounded-xl bg-foreground/5 px-3.5 py-3 text-[13px] leading-relaxed text-muted-foreground">
          {connection === "connected" ? t.notice : t.disconnectedHint}
        </p>

        <section className="flex flex-col gap-3 [padding-bottom:max(1rem,env(safe-area-inset-bottom))]">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-[16px] font-semibold text-foreground">{t.sectionTitle}</h2>
          </div>
          <p className="-mt-2 text-[13px] text-muted-foreground">
            {t.counts(String(workspaces.length), String(tasks.length))}
          </p>

          {buckets.length === 0 ? (
            connection === "connected" ? (
              <p className="rounded-xl border border-dashed border-border px-3.5 py-6 text-center text-[13px] text-muted-foreground">
                {t.empty}
              </p>
            ) : (
              // The hint above already explains why; this is the thing to do about it.
              <button
                type="button"
                onClick={refresh}
                className="rounded-xl border border-dashed border-border px-3.5 py-6 text-center text-[13px] font-medium text-foreground"
              >
                {t.retry}
              </button>
            )
          ) : (
            buckets.map((group) => (
              <div key={group.key} className="flex flex-col gap-2">
                <span className="px-1 text-[13px] text-muted-foreground">{group.label}</span>
                <ul className="flex flex-col gap-2">
                  {group.items.map((thread) => (
                    <li key={thread.id} className="relative">
                      {thread.projectId === highlightedProjectId ? (
                        <span className="absolute top-1/2 -left-2 size-1.5 -translate-y-1/2 rounded-full bg-sky-500" />
                      ) : null}
                      <TaskRow
                        thread={thread}
                        projectName={projectNameById.get(thread.projectId) ?? ""}
                        now={now}
                        onOpen={() => onOpenThread(thread.id)}
                        t={t}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </section>
      </div>
    </div>
  );
}

function ConversationScreen({
  threadId,
  onBack,
}: {
  readonly threadId: string;
  readonly onBack: () => void;
}) {
  const t = useMessages().remoteControl;
  const conversation = useConversation(threadId);
  const replyModelDefaults = useReplyModelDefaults();
  const replyModel = resolvePhoneReplyModel(conversation.modelSelection, replyModelDefaults);
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [conversation.messages.length, conversation.running]);

  const canSend = draft.trim().length > 0 && !conversation.sending;

  return (
    <div className="mx-auto flex h-dvh w-full max-w-[560px] flex-col">
      <header className="flex items-center gap-2 border-b border-[color:var(--color-border-light)] bg-[var(--color-background-panel)] px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3">
        <button
          type="button"
          aria-label={t.back}
          onClick={onBack}
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors active:bg-[var(--sidebar-accent)]"
        >
          <BackIcon />
        </button>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[15px] font-medium text-foreground">
            {conversation.title.length > 0 ? conversation.title : t.title}
          </span>
          <span className="truncate text-[12px] text-muted-foreground">
            {conversation.status === "unavailable"
              ? t.disconnected
              : conversation.running
                ? t.status.running
                : t.connected}
            {replyModel === null ? null : ` · ${replyModel.model}`}
          </span>
        </div>
      </header>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
        {conversation.messages.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-muted-foreground">{t.noMessages}</p>
        ) : (
          conversation.messages.map((message) => (
            <article
              key={message.id}
              className={cn(
                "max-w-[86%] rounded-2xl px-3.5 py-2.5 text-[14px] leading-relaxed whitespace-pre-wrap",
                message.role === "user"
                  ? "self-end bg-[var(--color-text-foreground)] text-[var(--color-background-panel)]"
                  : "self-start bg-[var(--color-background-panel)] text-foreground",
                message.role === "user" ? "" : "border border-[color:var(--color-border-light)]",
              )}
            >
              {message.text}
              {message.streaming ? (
                <span className="ms-1 inline-block size-1.5 animate-pulse rounded-full bg-current align-middle" />
              ) : null}
            </article>
          ))
        )}
        {conversation.running && conversation.lastActivitySummary !== null ? (
          <p className="self-start text-[12px] text-muted-foreground">
            {conversation.lastActivitySummary}
          </p>
        ) : null}
        {conversation.error !== null ? (
          <p className="self-start text-[12px] text-destructive">{conversation.error}</p>
        ) : null}
        <div ref={bottomRef} />
      </div>

      {conversation.pendingApproval !== null ? (
        <div className="mx-4 mb-2 flex flex-col gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3.5 py-3">
          <span className="text-[13px] font-medium text-foreground">{t.approvalTitle}</span>
          <span className="text-[12px] break-words text-muted-foreground">
            {conversation.pendingApproval.detail ?? conversation.pendingApproval.summary}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void conversation.respondToApproval("accept")}
              className="rounded-lg bg-[var(--color-text-foreground)] px-3 py-1.5 text-[13px] font-medium text-[var(--color-background-panel)]"
            >
              {t.approve}
            </button>
            <button
              type="button"
              onClick={() => void conversation.respondToApproval("decline")}
              className="rounded-lg border border-border px-3 py-1.5 text-[13px] font-medium text-foreground"
            >
              {t.deny}
            </button>
          </div>
        </div>
      ) : null}

      <form
        className="flex items-end gap-2 border-t border-[color:var(--color-border-light)] bg-[var(--color-background-panel)] px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSend) return;
          const text = draft;
          setDraft("");
          // The thread's model stands unless the provider no longer serves it.
          void conversation.send(text, replyModel);
        }}
      >
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={t.composerPlaceholder}
          rows={1}
          className="max-h-32 min-h-10 flex-1 resize-none rounded-xl border border-[color:var(--color-border)] bg-[var(--color-background-control-opaque)] px-3 py-2.5 text-[14px] text-foreground outline-none"
        />
        {conversation.running ? (
          <button
            type="button"
            onClick={() => void conversation.stop()}
            className="h-10 shrink-0 rounded-xl border border-border px-3 text-[13px] font-medium text-foreground"
          >
            {t.stop}
          </button>
        ) : null}
        <button
          type="submit"
          disabled={!canSend}
          className="h-10 shrink-0 rounded-xl bg-[var(--color-text-foreground)] px-4 text-[13px] font-medium text-[var(--color-background-panel)] disabled:opacity-40"
        >
          {conversation.sending ? t.sending : t.send}
        </button>
      </form>
    </div>
  );
}

export function RemoteControlApp({
  initialThreadId,
  highlightedProjectId,
}: {
  readonly initialThreadId: string | null;
  readonly highlightedProjectId: string | null;
}) {
  const device = useDeviceSnapshot();
  const [openThreadId, setOpenThreadId] = useState<string | null>(initialThreadId);

  if (openThreadId !== null) {
    return <ConversationScreen threadId={openThreadId} onBack={() => setOpenThreadId(null)} />;
  }

  return (
    <TaskListScreen
      connection={device.connection}
      projects={device.projects}
      threads={device.threads}
      highlightedProjectId={highlightedProjectId}
      refresh={device.refresh}
      refreshing={device.refreshing}
      onOpenThread={setOpenThreadId}
    />
  );
}

function RefreshIcon({ className }: { readonly className?: string | undefined }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("size-4.5", className)}
      aria-hidden
    >
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

function BackIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-5"
      aria-hidden
    >
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}
