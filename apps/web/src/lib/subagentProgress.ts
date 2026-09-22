// FILE: subagentProgress.ts
// Purpose: Derives what a delegated worker is doing right now from its child thread's activity.
// Exports: SubagentProgress derivation plus the activity-count helpers behind it.

import type { OrchestrationThreadActivity } from "@peakcode/contracts";

import { asRecord } from "../session-collab.logic";
import {
  extractToolCallId,
  extractWorkLogItemType,
  extractWorkLogRequestKind,
} from "../session-command.logic";
import { deriveReadableToolTitle } from "./toolCallLabel";

/**
 * A worker's live progress, as the delegation card shows it.
 *
 * All three numbers come from the worker's *child thread* rather than from the delegation
 * payload. The payload only carries the states the orchestrator sees (running/completed) and is
 * republished once per transition; the child thread receives every step the worker takes, so it
 * is the only place that can answer "what is it doing right now" without turning each step into
 * another payload update.
 */
export interface SubagentProgress {
  /** Tool calls the worker has started — the "68 steps" in the node's meta line. */
  steps: number;
  /** Wall-clock time from the worker's first recorded step to its last. */
  elapsedMs: number | null;
  /** The readable title of the worker's most recent tool call, e.g. `Read src/foo.ts`. */
  latestStep: string | null;
  /**
   * When that step happened.
   *
   * The card shows how long ago it was, which is the difference between "busy" and "wedged":
   * a worker that has said nothing for minutes while still claiming to run is the state a user
   * has no way to interpret from the outside.
   */
  latestStepAt: string | null;
}

const EMPTY_PROGRESS: SubagentProgress = {
  steps: 0,
  elapsedMs: null,
  latestStep: null,
  latestStepAt: null,
};

function isToolActivity(activity: OrchestrationThreadActivity): boolean {
  return (
    activity.kind === "tool.started" ||
    activity.kind === "tool.updated" ||
    activity.kind === "tool.completed"
  );
}

/**
 * The identity of the tool call an activity belongs to.
 *
 * A worker streams `started` → `updated` → `completed` for one call, so counting activities
 * would triple every step. pi puts the tool call id in `data.toolCallId`; anything without one
 * (older activity shapes, a synthesized tool row) falls back to the activity id, which
 * over-counts rather than under-counts — a step count that lags reality is worse than one that
 * runs slightly high.
 */
function toolCallKey(activity: OrchestrationThreadActivity): string {
  return extractToolCallId(asRecord(activity.payload)) ?? activity.id;
}

export function deriveSubagentProgress(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): SubagentProgress {
  const toolActivities = activities.filter(isToolActivity);
  if (toolActivities.length === 0) {
    return EMPTY_PROGRESS;
  }

  const ordered = [...toolActivities].toSorted((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
  const steps = new Set(ordered.map(toolCallKey)).size;

  const first = ordered[0]!;
  const last = ordered[ordered.length - 1]!;
  const elapsed = Date.parse(last.createdAt) - Date.parse(first.createdAt);

  return {
    steps,
    elapsedMs: Number.isFinite(elapsed) && elapsed > 0 ? elapsed : null,
    latestStep: latestStepTitle(last),
    latestStepAt: last.createdAt,
  };
}

/** The title the transcript itself would show for an activity, or null when it has none. */
function latestStepTitle(activity: OrchestrationThreadActivity): string | null {
  const payload = asRecord(activity.payload);
  const title = typeof payload?.title === "string" ? payload.title : null;
  return (
    deriveReadableToolTitle({
      title,
      fallbackLabel: activity.summary,
      itemType: extractWorkLogItemType(payload),
      requestKind: extractWorkLogRequestKind(payload),
      command: null,
      payload,
      isRunning: activity.kind !== "tool.completed",
    }) ?? null
  );
}

/**
 * Past this much silence a running worker is worth flagging.
 *
 * Not a verdict — the server's watchdog is the one that ends a stuck worker — but the point at
 * which "still working" stops being the safe reading.
 */
export const SUBAGENT_SILENCE_WARN_MS = 90_000;

/** `12s` / `3m 4s` — how long a worker has been quiet. */
export function formatSubagentSilence(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

/** `1m 8s` / `12s` — the compact duration the card's nodes and header use. */
export function formatSubagentDuration(elapsedMs: number | null | undefined): string | null {
  if (elapsedMs === null || elapsedMs === undefined || elapsedMs < 1000) {
    return null;
  }
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

/**
 * Whether a worker's node should offer its own "stop".
 *
 * Only a worker that is still out can be stopped, and only one whose delegation id is known —
 * that id is the key the runtime registry holds live workers under, so without it there is
 * nothing to address. A settled worker is left alone however its run ended: "stop" on something
 * that already finished is the kind of button whose only effect is to make the user doubt the
 * state they can see.
 */
export function shouldOfferWorkerStop(subagent: {
  readonly providerThreadId?: string | undefined;
  readonly statusLabel?: string | undefined;
  readonly rawStatus?: string | undefined;
  readonly isActive?: boolean | undefined;
  readonly steps?: number | undefined;
}): boolean {
  if (!subagent.providerThreadId) return false;
  const label = (subagent.statusLabel ?? subagent.rawStatus ?? "").trim().toLowerCase();
  if (
    label === "completed" ||
    label === "failed" ||
    label === "stopped" ||
    label === "interrupted" ||
    label === "closed" ||
    label === "idle"
  ) {
    return false;
  }
  return subagent.isActive === true || label === "running" || label === "working";
}
