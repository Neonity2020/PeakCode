// FILE: kanbanPresentation.ts
// Purpose: Pure presentation lookups for kanban surfaces — the colour and label
//          a status / priority / run state maps to, and the short codes and
//          paths shown on cards. The glyphs themselves live next to them in
//          components/KanbanPresentation.tsx.
// Layer: Web presentation helpers
// Exports: KANBAN_STATUS_ACCENT, KANBAN_STATUS_ORDER, KANBAN_PRIORITY_CLASS,
//          KANBAN_RUN_STATUS_CLASS, KANBAN_PRIORITY_BAR_COUNT,
//          KANBAN_PRIORITY_ACCENT_CLASS, kanbanStatusLabel, kanbanRunStatusLabel,
//          kanbanColumnAccent, kanbanTaskCode, kanbanProjectCode,
//          kanbanAvatarColor, shortModelName, shortWorkspacePath

import type {
  KanbanTaskPriority,
  KanbanTaskStatus,
  KanbanAgentRunStatus,
} from "@peakcode/contracts";
import { KANBAN_TASK_STATUSES } from "@peakcode/contracts";

import type { Messages } from "../i18n/messages";

/** Board columns carry their own dot; these are the colours used without one. */
export const KANBAN_STATUS_ACCENT: Record<KanbanTaskStatus, string> = {
  todo: "#9CA3AF",
  in_progress: "#3B82F6",
  done: "#22C55E",
  blocked: "#EF4444",
  archived: "#6B7280",
};

/** Column order the board falls back to when a board file stores no columns. */
export const KANBAN_STATUS_ORDER: ReadonlyArray<KanbanTaskStatus> = KANBAN_TASK_STATUSES;

export const KANBAN_PRIORITY_CLASS: Record<KanbanTaskPriority, string> = {
  high: "bg-destructive/12 text-destructive",
  medium: "bg-warning/15 text-warning",
  low: "bg-muted text-muted-foreground",
};

export const KANBAN_RUN_STATUS_CLASS: Record<KanbanAgentRunStatus, string> = {
  running: "text-info",
  done: "text-success",
  failed: "text-destructive",
  interrupted: "text-muted-foreground",
};

/** Bars lit in the priority meter, low to high. */
export const KANBAN_PRIORITY_BAR_COUNT: Record<KanbanTaskPriority, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

export const KANBAN_PRIORITY_ACCENT_CLASS: Record<KanbanTaskPriority, string> = {
  high: "text-destructive",
  medium: "text-warning",
  low: "text-muted-foreground/70",
};

const AVATAR_COLORS = ["#F59E0B", "#3B82F6", "#10B981", "#8B5CF6", "#EF4444", "#0EA5E9", "#F97316"];

export function kanbanStatusLabel(messages: Messages, status: KanbanTaskStatus): string {
  return status === "in_progress"
    ? messages.kanban.columns.inProgress
    : messages.kanban.columns[status];
}

export function kanbanRunStatusLabel(
  messages: Messages,
  status: KanbanAgentRunStatus | null,
): string {
  switch (status) {
    case "running":
      return messages.kanban.agentRunRunning;
    case "done":
      return messages.kanban.agentRunDone;
    case "failed":
      return messages.kanban.agentRunFailed;
    case "interrupted":
      return messages.kanban.agentRunInterrupted;
    default:
      return messages.kanban.agentRunUnknown;
  }
}

/** Column colour: whatever the board stores, falling back to the status palette. */
export function kanbanColumnAccent(status: KanbanTaskStatus, dot?: string | null): string {
  const stored = dot?.trim();
  return stored && stored.length > 0 ? stored : KANBAN_STATUS_ACCENT[status];
}

/**
 * Short work-item code shown on cards: `t_29b8116000` on the PeakCode board reads
 * as `PC-29B8`. Derived from the id, never stored — the raw id stays the identity.
 */
export function kanbanTaskCode(taskId: string, projectCode: string): string {
  const compact = taskId
    .replace(/^(t|task|kanban)_/i, "")
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 4)
    .toUpperCase();
  const prefix = projectCode.trim().toUpperCase();
  if (compact.length === 0) return prefix;
  return prefix.length > 0 ? `${prefix}-${compact}` : compact;
}

/** Project initials for task codes: `PeakCode` → `PC`; CJK titles keep their first characters. */
export function kanbanProjectCode(title: string): string {
  const words = title
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s·_\-/]+/)
    .filter((word) => word.length > 0);
  const initials = words
    .map((word) => (/^[a-z0-9]/i.test(word) ? word[0]! : ""))
    .join("")
    .toUpperCase();
  if (initials.length >= 2) return initials.slice(0, 3);
  const compact = title.trim().replace(/\s+/g, "").slice(0, 2).toUpperCase();
  return compact.length > 0 ? compact : "?";
}

export function kanbanAvatarColor(name: string): string {
  let sum = 0;
  for (let index = 0; index < name.length; index += 1) {
    sum += name.charCodeAt(index);
  }
  return AVATAR_COLORS[sum % AVATAR_COLORS.length]!;
}

/** `claude-sonnet-4` out of `anthropic/claude-sonnet-4`, for chip-sized labels. */
export function shortModelName(model: string): string {
  const trimmed = model.trim();
  if (trimmed.length === 0) return "";
  return trimmed.split("/").findLast((part) => part.length > 0) ?? trimmed;
}

/** `~`-shortened path for display; the full path stays in the title attribute. */
export function shortWorkspacePath(value: string): string {
  const match = /^\/Users\/[^/]+\/(.*)$/.exec(value);
  return match ? `~/${match[1]}` : value;
}
