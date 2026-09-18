// FILE: KanbanTaskCard.tsx
// Purpose: One task as the board draws it — the title, the line of provenance
//          under it, and the pills that carry what the column cannot say, plus
//          the row the list view draws from the same fields.
// Layer: Component
// Exports: KanbanTaskCard, KanbanTaskRow

import type { DragEvent, KeyboardEvent } from "react";

import type { KanbanTask, KanbanTaskStatus } from "@peakcode/contracts";

import { useMessages, useLanguage } from "../i18n/I18nContext";
import { CalendarIcon, MessageCircleIcon, PaperclipIcon } from "../lib/icons";
import {
  kanbanRunStatusLabel,
  kanbanStampLabel,
  kanbanStatusLabel,
  kanbanTaskCode,
} from "../lib/kanbanPresentation";
import { cn } from "../lib/utils";
import { formatRelativeTime } from "./Sidebar.statusBadges";
import {
  KanbanAgentChip,
  KanbanAssigneeAvatar,
  KanbanPill,
  KanbanPriorityMeter,
  KanbanRunStatusMarker,
  KanbanStatusBadge,
} from "./KanbanPresentation";

interface TaskCardProps {
  readonly task: KanbanTask;
  readonly projectCode: string;
  readonly statusAccent: string;
  readonly isDragging: boolean;
  readonly onOpen: (task: KanbanTask) => void;
  readonly onDragStart: (task: KanbanTask, event: DragEvent<HTMLElement>) => void;
  readonly onDragEnd: () => void;
}

/** Shared "open on click / Enter" wiring so the card and the list row behave alike. */
function openHandlers(task: KanbanTask, onOpen: (task: KanbanTask) => void) {
  return {
    onClick: () => onOpen(task),
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      onOpen(task);
    },
  };
}

/** The card footer: priority, who holds it, and when it last moved. */
function TaskCardPills(props: { readonly task: KanbanTask }) {
  const messages = useMessages();
  const language = useLanguage();
  const { task } = props;
  // The provenance line already carries the creation date, so the pill is the
  // *last move* — the thing that tells you whether a card is still alive.
  const stamp = task.updatedAt;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <KanbanPill
        icon={<KanbanPriorityMeter priority={task.priority} className="size-3" />}
        title={`${messages.kanban.priority} · ${messages.kanban.priorities[task.priority]}`}
      >
        {messages.kanban.priorities[task.priority]}
      </KanbanPill>
      <KanbanPill
        icon={
          <KanbanAssigneeAvatar
            name={task.assignee}
            emptyTitle={messages.kanban.unassigned}
            className="size-3.5"
          />
        }
        title={`${messages.kanban.assignee} · ${task.assignee.trim() || messages.kanban.unassigned}`}
      >
        {task.assignee.trim() || messages.kanban.unassigned}
      </KanbanPill>
      {stamp ? (
        <KanbanPill
          icon={<CalendarIcon className="size-3" />}
          title={`${messages.kanban.updatedLabel} ${stamp}`}
        >
          {formatRelativeTime(stamp) || kanbanStampLabel(stamp, language)}
        </KanbanPill>
      ) : null}
    </div>
  );
}

export function KanbanTaskCard(props: TaskCardProps) {
  const messages = useMessages();
  const language = useLanguage();
  const { task } = props;
  const comments = task.comments.length;
  const attachments = task.attachments.length;
  return (
    <article
      data-kanban-card
      draggable
      onDragStart={(event) => props.onDragStart(task, event)}
      onDragEnd={props.onDragEnd}
      role="button"
      tabIndex={0}
      {...openHandlers(task, props.onOpen)}
      className={cn(
        "group cursor-pointer rounded-[14px] border border-border/70 bg-[var(--color-background-panel)] px-3.5 py-3 transition-[border-color,box-shadow,opacity]",
        "shadow-[0_1px_2px_color-mix(in_srgb,var(--color-border-heavy)_28%,transparent)]",
        "hover:border-border-heavy hover:shadow-[0_2px_6px_color-mix(in_srgb,var(--color-border-heavy)_34%,transparent)]",
        props.isDragging && "opacity-40",
      )}
    >
      <div className="flex items-start gap-2">
        {/* The mark in the reference's card corner is the board's own status
            badge: the column already says it, and the badge keeps the colour
            readable once a card is dragged out of its column. */}
        <KanbanStatusBadge
          status={task.status}
          color={props.statusAccent}
          className="mt-px"
          title={kanbanStatusLabel(messages, task.status)}
        />
        <h3 className="min-w-0 flex-1 text-[13px] leading-snug font-medium break-words text-foreground">
          {task.title}
        </h3>
        {task.agentRunStatus ? (
          <KanbanRunStatusMarker
            status={task.agentRunStatus}
            className="mt-0.5"
            title={`${messages.kanban.agentRun} · ${kanbanRunStatusLabel(messages, task.agentRunStatus)}`}
          />
        ) : null}
      </div>
      {/* One line by construction: the title already wraps above it, so the
          provenance row clips the model name rather than stacking. */}
      <div className="mt-1 flex min-w-0 items-center gap-1.5 overflow-hidden pl-6 text-[11.5px] leading-4 text-muted-foreground/85">
        <span
          data-kanban-task-code
          className="shrink-0 font-mono text-[10.5px] text-muted-foreground/70"
        >
          {kanbanTaskCode(task.taskId, props.projectCode)}
        </span>
        {task.createdAt ? (
          <>
            <span className="shrink-0 text-muted-foreground/40" aria-hidden>
              ·
            </span>
            <span className="shrink-0">
              {messages.kanban.createdLabel} {kanbanStampLabel(task.createdAt, language)}
            </span>
          </>
        ) : null}
        {task.pipeline.trim() ? (
          <>
            <span className="shrink-0 text-muted-foreground/40" aria-hidden>
              ·
            </span>
            <span className="truncate">{task.pipeline.trim()}</span>
          </>
        ) : null}
        <KanbanAgentChip
          provider={task.agentProvider}
          model={task.agentModel}
          className="ml-auto min-w-0 shrink"
          title={`${messages.kanban.agent} · ${task.agentModel.length > 0 ? task.agentModel : messages.kanban.defaultModel}`}
        />
        {comments > 0 ? (
          <span
            className="inline-flex shrink-0 items-center gap-1 text-muted-foreground/70"
            title={messages.kanban.detail.commentCount(comments)}
            data-kanban-comment-count={comments}
          >
            <MessageCircleIcon className="size-3" />
            {comments}
          </span>
        ) : null}
        {attachments > 0 ? (
          <span
            className="inline-flex shrink-0 items-center gap-1 text-muted-foreground/70"
            title={messages.kanban.taskImages}
            data-kanban-attachment-count={attachments}
          >
            <PaperclipIcon className="size-3" />
            {attachments}
          </span>
        ) : null}
      </div>
      <div className="mt-2.5">
        <TaskCardPills task={task} />
      </div>
    </article>
  );
}

/** List-view row: the same fields on one line, for scanning a whole column set. */
export function KanbanTaskRow(props: {
  readonly task: KanbanTask;
  readonly projectCode: string;
  readonly statusAccent: string;
  readonly status: KanbanTaskStatus;
  readonly onOpen: (task: KanbanTask) => void;
}) {
  const messages = useMessages();
  const language = useLanguage();
  const { task } = props;
  return (
    <article
      data-kanban-row
      role="button"
      tabIndex={0}
      {...openHandlers(task, props.onOpen)}
      className={cn(
        "flex cursor-pointer items-center gap-3 rounded-xl border border-transparent px-3 py-2 transition-colors",
        "hover:border-border/70 hover:bg-[var(--color-background-panel)]",
      )}
    >
      <KanbanStatusBadge
        status={props.status}
        color={props.statusAccent}
        className="size-3.5"
        title={kanbanStatusLabel(messages, props.status)}
      />
      <span
        className="shrink-0 font-mono text-[10.5px] text-muted-foreground/70"
        title={messages.kanban.taskId}
        data-kanban-task-code
      >
        {kanbanTaskCode(task.taskId, props.projectCode)}
      </span>
      <span className="min-w-0 flex-1 truncate text-[12.5px] text-foreground">{task.title}</span>
      {/* Fixed-width trailing cells: the counters and badges line up down the list. */}
      <span className="flex w-9 shrink-0 justify-end">
        {task.comments.length > 0 ? (
          <span
            className="inline-flex items-center gap-0.5 text-[10.5px] text-muted-foreground/70"
            title={messages.kanban.detail.commentCount(task.comments.length)}
          >
            <MessageCircleIcon className="size-3" />
            {task.comments.length}
          </span>
        ) : null}
      </span>
      <span className="flex w-9 shrink-0 justify-end">
        {task.attachments.length > 0 ? (
          <span
            className="inline-flex items-center gap-0.5 text-[10.5px] text-muted-foreground/70"
            title={messages.kanban.taskImages}
          >
            <PaperclipIcon className="size-3" />
            {task.attachments.length}
          </span>
        ) : null}
      </span>
      <KanbanPill
        icon={<KanbanPriorityMeter priority={task.priority} className="size-3" />}
        className="shrink-0"
        title={`${messages.kanban.priority} · ${messages.kanban.priorities[task.priority]}`}
      >
        {messages.kanban.priorities[task.priority]}
      </KanbanPill>
      <KanbanAgentChip
        provider={task.agentProvider}
        model={task.agentModel}
        className="w-[104px] shrink-0"
        title={`${messages.kanban.agent} · ${task.agentModel.length > 0 ? task.agentModel : messages.kanban.defaultModel}`}
      />
      <span className="flex w-3.5 shrink-0 justify-center">
        {task.agentRunStatus ? (
          <KanbanRunStatusMarker
            status={task.agentRunStatus}
            title={`${messages.kanban.agentRun} · ${kanbanRunStatusLabel(messages, task.agentRunStatus)}`}
          />
        ) : null}
      </span>
      <KanbanAssigneeAvatar name={task.assignee} emptyTitle={messages.kanban.unassigned} />
      <span
        className="w-[54px] shrink-0 text-right text-[10.5px] text-muted-foreground/60"
        title={task.updatedAt ? `${messages.kanban.updatedLabel} ${task.updatedAt}` : undefined}
      >
        {task.updatedAt ? kanbanStampLabel(task.updatedAt, language) : ""}
      </span>
    </article>
  );
}
