// FILE: mobile/h5Tasks.ts
// Purpose: How the phone page reads a thread: what state its task is in, and how to say
//          when it last moved. Pure functions, so the phone's list can pin them in tests
//          without a browser.
// Layer: Mobile view support
// Depends on: orchestration contracts only.
// Exports: resolveTaskStatus, resolveTaskTimeBucket, formatTaskAge

import type {
  OrchestrationLatestTurn,
  OrchestrationProjectShell,
  OrchestrationSession,
  OrchestrationThreadShell,
} from "@peakcode/contracts";

/** What the status chip in the task list shows. */
export const TASK_STATUSES = [
  "running",
  "waiting",
  "completed",
  "failed",
  "interrupted",
  "idle",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/**
 * The state of one task, from the thread's own signals.
 *
 * A question waiting for a person outranks everything: the run is parked until it is
 * answered, and the phone is one of the places it can be answered from.
 */
export function resolveTaskStatus(input: {
  readonly latestTurn: OrchestrationLatestTurn | null;
  readonly session: OrchestrationSession | null;
  readonly hasPendingApprovals?: boolean | null | undefined;
  readonly hasPendingUserInput?: boolean | null | undefined;
}): TaskStatus {
  if (input.hasPendingApprovals === true || input.hasPendingUserInput === true) return "waiting";
  const turnState = input.latestTurn?.state ?? null;
  if (turnState === "running") return "running";
  if (turnState === "error") return "failed";
  if (turnState === "interrupted") return "interrupted";
  const sessionStatus = input.session?.status ?? null;
  if (sessionStatus === "starting" || sessionStatus === "running") return "running";
  if (turnState === "completed") return "completed";
  return "idle";
}

/** A task is worth showing when it has done something; empty drafts are desktop clutter. */
export function isVisibleTask(thread: OrchestrationThreadShell): boolean {
  return (
    thread.archivedAt === null &&
    thread.parentThreadId === null &&
    (thread.latestTurn !== null || thread.latestUserMessageAt !== null)
  );
}

export type TaskTimeBucket = "today" | "yesterday" | "earlier";

/** Which day-group a task belongs to, in the phone's own timezone. */
export function resolveTaskTimeBucket(isoTimestamp: string, now: number): TaskTimeBucket {
  const at = Date.parse(isoTimestamp);
  if (!Number.isFinite(at)) return "earlier";
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  if (at >= startOfToday.getTime()) return "today";
  if (at >= startOfToday.getTime() - 24 * 60 * 60 * 1000) return "yesterday";
  return "earlier";
}

/**
 * A short "how long ago" label, in the compact form a phone list has room for.
 *
 * The desktop's formatter is not reused: it lives in the sidebar module with the whole
 * chat surface behind it, and this page deliberately keeps none of that on the phone.
 */
export function formatTaskAge(isoTimestamp: string, now: number): string {
  const at = Date.parse(isoTimestamp);
  if (!Number.isFinite(at)) return "";
  const elapsedMs = Math.max(0, now - at);
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "昨天";
  if (days < 30) return `${days} 天`;
  const months = Math.floor(days / 30);
  return months < 12 ? `${months} 个月` : `${Math.floor(months / 12)} 年`;
}

/** The moment a task last did something, which is what the list sorts and labels by. */
export function taskActivityAt(thread: OrchestrationThreadShell): string {
  return thread.latestUserMessageAt ?? thread.latestTurn?.completedAt ?? thread.updatedAt;
}

/** Workspaces worth listing: the phone shows where work happens, not chat scratch space. */
export function isVisibleWorkspace(project: OrchestrationProjectShell): boolean {
  return project.kind !== "chat";
}
