// FILE: KanbanTaskCard.tsx
// Purpose: One task as the board draws it — work-item code, priority, title,
//          requirement excerpt, and the footer of state / agent / assignee /
//          activity — plus the row the list view draws from the same fields.
// Layer: Component
// Exports: KanbanTaskCard, KanbanTaskRow

import type { DragEvent, KeyboardEvent } from "react";

import type { KanbanTask } from "@peakcode/contracts";

import { useMessages } from "../i18n/I18nContext";
import { CalendarIcon, MessageCircleIcon, PaperclipIcon } from "../lib/icons";
import { kanbanRunStatusLabel, kanbanStatusLabel, kanbanTaskCode } from "../lib/kanbanPresentation";
import { cn } from "../lib/utils";
import {
  KanbanAgentChip,
  KanbanAssigneeAvatar,
  KanbanPriorityMeter,
  KanbanRunStatusMarker,
  KanbanStatusGlyph,
} from "./KanbanPresentation";
import { formatRelativeTime } from "./Sidebar.statusBadges";

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

/** Work-item code, priority, and the agent's run state: the card's eyebrow row. */
function TaskCardMeta(props: { readonly task: KanbanTask; readonly projectCode: string }) {
  const messages = useMessages();
  const { task } = props;
  return (
    <div className="flex items-center gap-1.5">
      <span
        className="rounded bg-muted/60 px-1 py-px font-mono text-[9.5px] leading-4 text-muted-foreground/70"
        title={messages.kanban.taskId}
        data-kanban-task-code
      >
        {kanbanTaskCode(task.taskId, props.projectCode)}
      </span>
      <KanbanPriorityMeter
        priority={task.priority}
        title={messages.kanban.priorities[task.priority]}
      />
      {task.agentRunStatus ? (
        <KanbanRunStatusMarker
          status={task.agentRunStatus}
          className="ml-auto"
          title={`${messages.kanban.agentRun} · ${kanbanRunStatusLabel(messages, task.agentRunStatus)}`}
        />
      ) : null}
    </div>
  );
}

/** The card footer: where the task stands, then who and which agent holds it. */
function TaskCardFooter(props: {
  readonly task: KanbanTask;
  readonly statusAccent: string;
  readonly className?: string;
}) {
  const messages = useMessages();
  const { task } = props;
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-2 text-[10.5px] text-muted-foreground/80",
        props.className,
      )}
    >
      <span className="inline-flex min-w-0 items-center gap-1">
        <KanbanStatusGlyph status={task.status} color={props.statusAccent} />
        <span className="truncate">{kanbanStatusLabel(messages, task.status)}</span>
      </span>
      {task.comments.length > 0 ? (
        <span
          className="inline-flex shrink-0 items-center gap-0.5 text-muted-foreground/70"
          title={messages.kanban.detail.commentCount(task.comments.length)}
          data-kanban-comment-count={task.comments.length}
        >
          <MessageCircleIcon className="size-3" />
          {task.comments.length}
        </span>
      ) : null}
      {task.attachments.length > 0 ? (
        <span
          className="inline-flex shrink-0 items-center gap-0.5 text-muted-foreground/70"
          title={messages.kanban.taskImages}
          data-kanban-attachment-count={task.attachments.length}
        >
          <PaperclipIcon className="size-3" />
          {task.attachments.length}
        </span>
      ) : null}
      <span className="ml-auto inline-flex min-w-0 shrink items-center gap-1.5">
        <KanbanAgentChip
          provider={task.agentProvider}
          model={task.agentModel}
          className="max-w-[92px]"
          title={`${messages.kanban.agent} · ${task.agentModel.length > 0 ? task.agentModel : messages.kanban.defaultModel}`}
        />
        <KanbanAssigneeAvatar name={task.assignee} emptyTitle={messages.kanban.unassigned} />
        {task.updatedAt ? (
          <span
            className="inline-flex shrink-0 items-center gap-0.5 text-muted-foreground/60"
            title={`${messages.kanban.updatedLabel} ${task.updatedAt}`}
          >
            <CalendarIcon className="size-3" />
            {formatRelativeTime(task.updatedAt)}
          </span>
        ) : null}
      </span>
    </div>
  );
}

export function KanbanTaskCard(props: TaskCardProps) {
  const { task } = props;
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
        "cursor-pointer rounded-xl border border-border/50 bg-card/70 px-3 py-2.5 transition-colors",
        "hover:border-border hover:bg-accent/40",
        props.isDragging && "opacity-50",
      )}
    >
      <TaskCardMeta task={task} projectCode={props.projectCode} />
      <h3 className="mt-1.5 text-[13px] leading-snug font-medium break-words text-foreground">
        {task.title}
      </h3>
      {task.description ? (
        <p
          className="mt-1.5 line-clamp-2 text-[11.5px] leading-relaxed whitespace-pre-wrap text-muted-foreground/85"
          title={task.description}
        >
          {task.description}
        </p>
      ) : null}
      <div className="mt-2 h-px bg-border/40" />
      <TaskCardFooter task={task} statusAccent={props.statusAccent} className="mt-2" />
    </article>
  );
}

/** List-view row: the same fields on one line, for scanning a whole column set. */
export function KanbanTaskRow(props: {
  readonly task: KanbanTask;
  readonly projectCode: string;
  readonly statusAccent: string;
  readonly onOpen: (task: KanbanTask) => void;
}) {
  const messages = useMessages();
  const { task } = props;
  return (
    <article
      data-kanban-row
      role="button"
      tabIndex={0}
      {...openHandlers(task, props.onOpen)}
      className={cn(
        "flex cursor-pointer items-center gap-3 rounded-lg border border-transparent px-3 py-2 transition-colors",
        "hover:border-border/60 hover:bg-accent/40",
      )}
    >
      <span
        className="shrink-0 rounded bg-muted/60 px-1 py-px font-mono text-[9.5px] leading-4 text-muted-foreground/70"
        title={messages.kanban.taskId}
        data-kanban-task-code
      >
        {kanbanTaskCode(task.taskId, props.projectCode)}
      </span>
      <KanbanStatusGlyph status={task.status} color={props.statusAccent} />
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
      <KanbanPriorityMeter
        priority={task.priority}
        title={messages.kanban.priorities[task.priority]}
      />
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
        {task.updatedAt ? formatRelativeTime(task.updatedAt) : ""}
      </span>
    </article>
  );
}
