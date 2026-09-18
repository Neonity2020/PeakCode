// FILE: KanbanPresentation.tsx
// Purpose: The kanban glyphs: the per-status dot, the solid status badge the
//          columns are headed by, the priority meter, the agent run marker, the
//          agent / assignee chips, and the pill the card footer is built from.
//          Their colours and short labels come from lib/kanbanPresentation.
// Layer: Component
// Exports: KanbanStatusGlyph, KanbanStatusBadge, KanbanPill,
//          KanbanPriorityMeter, KanbanRunStatusMarker, KanbanAgentChip,
//          KanbanAssigneeAvatar

import type { ReactNode } from "react";

import {
  type KanbanAgentRunStatus,
  type KanbanTaskPriority,
  type KanbanTaskStatus,
  type ProviderKind,
} from "@peakcode/contracts";

import { CheckIcon, CircleAlertIcon, LoaderIcon, PauseIcon, UserCircleIcon } from "../lib/icons";
import {
  KANBAN_PRIORITY_ACCENT_CLASS,
  KANBAN_PRIORITY_BAR_COUNT,
  KANBAN_RUN_STATUS_CLASS,
  KANBAN_STATUS_ACCENT,
  kanbanAvatarColor,
  shortModelName,
} from "../lib/kanbanPresentation";
import { cn } from "../lib/utils";
import { ProviderIcon } from "./ProviderIcon";

/**
 * The dot the board draws per state. Drawn here rather than picked from an icon
 * set so every column reads as one family at 12–14px, in the board's own colour.
 */
export function KanbanStatusGlyph(props: {
  readonly status: KanbanTaskStatus;
  /** Board column colour; omitted means the status palette. */
  readonly color?: string | undefined;
  readonly className?: string;
}) {
  const { status, className } = props;
  const accent = props.color ?? KANBAN_STATUS_ACCENT[status];
  const glyph = (() => {
    switch (status) {
      case "todo":
        return (
          <circle
            cx="7"
            cy="7"
            r="5.4"
            fill="none"
            stroke={accent}
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeDasharray="2.4 2.3"
          />
        );
      case "in_progress":
        return (
          <>
            <circle
              cx="7"
              cy="7"
              r="5.4"
              fill="none"
              stroke={accent}
              strokeOpacity="0.32"
              strokeWidth="1.6"
            />
            <path d="M7 1.6A5.4 5.4 0 0 1 7 12.4Z" fill={accent} />
          </>
        );
      case "done":
        return (
          <>
            <circle cx="7" cy="7" r="6" fill={accent} />
            <path
              d="M4.3 7.2 6.2 9.1 9.8 5.1"
              fill="none"
              stroke="#FFFFFF"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </>
        );
      case "blocked":
        return (
          <>
            <circle cx="7" cy="7" r="5.4" fill="none" stroke={accent} strokeWidth="1.6" />
            <path
              d="M5.2 5.2 8.8 8.8M8.8 5.2 5.2 8.8"
              fill="none"
              stroke={accent}
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </>
        );
      case "archived":
        return (
          <>
            <circle cx="7" cy="7" r="6" fill={accent} fillOpacity="0.85" />
            <path
              d="M4.4 7h5.2"
              fill="none"
              stroke="#FFFFFF"
              strokeWidth="1.7"
              strokeLinecap="round"
            />
          </>
        );
    }
  })();

  return (
    <svg viewBox="0 0 14 14" className={cn("size-3.5 shrink-0", className)} aria-hidden="true">
      {glyph}
    </svg>
  );
}

/**
 * The column-head badge: the status colour as a solid rounded square with the
 * state drawn through it in white. Reads as one family down the column headers,
 * where the dot above is too quiet to carry the colour on its own.
 */
export function KanbanStatusBadge(props: {
  readonly status: KanbanTaskStatus;
  /** Board column colour; omitted means the status palette. */
  readonly color?: string | undefined;
  readonly className?: string;
  readonly title?: string;
}) {
  const accent = props.color ?? KANBAN_STATUS_ACCENT[props.status];
  const glyph = (() => {
    switch (props.status) {
      case "todo":
        return (
          <circle
            cx="8"
            cy="8"
            r="4.1"
            fill="none"
            stroke="#FFFFFF"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeDasharray="2 2.1"
          />
        );
      case "in_progress":
        return (
          <>
            <circle
              cx="8"
              cy="8"
              r="4.1"
              fill="none"
              stroke="#FFFFFF"
              strokeOpacity="0.45"
              strokeWidth="1.5"
            />
            <path d="M8 3.9A4.1 4.1 0 0 1 8 12.1Z" fill="#FFFFFF" />
          </>
        );
      case "done":
        return (
          <path
            d="M5.1 8.3 7 10.2 10.9 5.9"
            fill="none"
            stroke="#FFFFFF"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        );
      case "blocked":
        return (
          <>
            <circle cx="8" cy="8" r="4.1" fill="none" stroke="#FFFFFF" strokeWidth="1.5" />
            <path
              d="M6.3 6.3 9.7 9.7M9.7 6.3 6.3 9.7"
              fill="none"
              stroke="#FFFFFF"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </>
        );
      case "archived":
        return (
          <>
            <rect x="3.5" y="5.3" width="9" height="2.1" rx="1.05" fill="#FFFFFF" />
            <path
              d="M5 8.6v3M8 8.6v3M11 8.6v3"
              stroke="#FFFFFF"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </>
        );
    }
  })();

  return (
    <svg
      viewBox="0 0 16 16"
      className={cn("size-4 shrink-0", props.className)}
      aria-hidden="true"
      data-kanban-status-badge={props.status}
    >
      <rect x="0" y="0" width="16" height="16" rx="4.5" fill={accent} />
      {glyph}
      {props.title ? <title>{props.title}</title> : null}
    </svg>
  );
}

/**
 * The card footer's unit: a hairline-outlined capsule around one fact. `danger`
 * is the same shape in the failure colour, for a date or state that has gone
 * wrong rather than a neutral one.
 */
export function KanbanPill(props: {
  readonly children: ReactNode;
  readonly icon?: ReactNode;
  readonly tone?: "default" | "danger";
  readonly className?: string;
  readonly title?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex min-w-0 items-center gap-1.5 rounded-full border px-2 py-[3px] text-[11.5px] leading-4",
        props.tone === "danger"
          ? "border-destructive/35 text-destructive"
          : "border-border/70 text-muted-foreground",
        props.className,
      )}
      title={props.title}
    >
      {props.icon}
      <span className="truncate">{props.children}</span>
    </span>
  );
}

/** Three bars, lit per priority — the card-sized stand-in for a priority label. */ export function KanbanPriorityMeter(props: {
  readonly priority: KanbanTaskPriority;
  readonly className?: string;
  readonly title?: string;
}) {
  const lit = KANBAN_PRIORITY_BAR_COUNT[props.priority];
  return (
    <svg
      viewBox="0 0 14 14"
      className={cn(
        "size-3.5 shrink-0",
        KANBAN_PRIORITY_ACCENT_CLASS[props.priority],
        props.className,
      )}
      aria-hidden="true"
      data-kanban-priority={props.priority}
    >
      {[0, 1, 2].map((index) => (
        <rect
          key={index}
          x={1.6 + index * 4.2}
          y={9 - index * 3}
          width="2.6"
          height={4 + index * 3}
          rx="1.1"
          fill="currentColor"
          fillOpacity={index < lit ? 1 : 0.22}
        />
      ))}
      {props.title ? <title>{props.title}</title> : null}
    </svg>
  );
}

/** The agent run badge: a spinner while it works, then the outcome. */
export function KanbanRunStatusMarker(props: {
  readonly status: KanbanAgentRunStatus;
  readonly className?: string;
  readonly title?: string;
}) {
  const Icon =
    props.status === "running"
      ? LoaderIcon
      : props.status === "done"
        ? CheckIcon
        : props.status === "interrupted"
          ? PauseIcon
          : CircleAlertIcon;
  return (
    <span
      className={cn("inline-flex shrink-0", KANBAN_RUN_STATUS_CLASS[props.status], props.className)}
      title={props.title}
      data-kanban-agent-run={props.status}
    >
      <Icon className={cn("size-3.5", props.status === "running" && "animate-spin")} />
    </span>
  );
}

/**
 * Which agent a task is handed to. The model name rides along when the task
 * names one; otherwise the provider glyph alone keeps the card quiet.
 */
export function KanbanAgentChip(props: {
  readonly provider: ProviderKind;
  readonly model: string;
  readonly className?: string;
  readonly title?: string;
}) {
  const model = shortModelName(props.model);
  return (
    <span
      className={cn(
        "inline-flex min-w-0 shrink items-center gap-1 text-[10.5px] text-muted-foreground/85",
        props.className,
      )}
      title={props.title}
      data-kanban-agent={props.provider}
    >
      <ProviderIcon provider={props.provider} className="size-3 shrink-0" />
      {model.length > 0 ? <span className="truncate">{model}</span> : null}
    </span>
  );
}

/** Assignee avatar; an unassigned task reads as an outlined placeholder. */
export function KanbanAssigneeAvatar(props: {
  readonly name: string;
  readonly className?: string;
  readonly emptyTitle: string;
}) {
  const name = props.name.trim();
  if (name.length === 0) {
    return (
      <span
        className={cn(
          "inline-flex size-4.5 shrink-0 items-center justify-center rounded-full border border-dashed border-border/70 text-muted-foreground/60",
          props.className,
        )}
        title={props.emptyTitle}
        data-kanban-assignee="empty"
      >
        <UserCircleIcon className="size-3" />
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex size-4.5 shrink-0 items-center justify-center rounded-full text-[9px] font-medium text-white/95",
        props.className,
      )}
      style={{ backgroundColor: kanbanAvatarColor(name) }}
      title={name}
      data-kanban-assignee={name}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}
