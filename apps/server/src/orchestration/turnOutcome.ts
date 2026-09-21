// FILE: turnOutcome.ts
// Purpose: One reading of "the turn is over" for every feature that dispatches a run
//          and waits for its result (automations, kanban cards, the IM bridge).
// Layer: Orchestration support
// Exports: TurnOutcome, TurnOutcomeEvent, turnOutcomeForEvent

import type { OrchestrationEvent, ThreadId } from "@peakcode/contracts";

/** How a dispatched turn ended. */
export type TurnOutcome = "succeeded" | "failed" | "interrupted";

export interface TurnOutcomeEvent {
  readonly threadId: ThreadId;
  readonly outcome: TurnOutcome;
}

/**
 * The outcome a domain event reports, or null when the event does not end a turn.
 *
 * A dispatched turn is over when its diff is checkpointed (`ready` = finished, `error` =
 * the checkpoint failed, `missing` = nothing to capture, which is what an interrupted
 * turn leaves behind), when its session errored, or when the session was stopped with no
 * turn in flight.
 *
 * A session that merely reports "ready" is deliberately *not* an outcome: a freshly
 * started session announces itself that way too, which would end a run before its first
 * turn ever ran.
 */
export function turnOutcomeForEvent(event: OrchestrationEvent): TurnOutcomeEvent | null {
  if (event.type === "thread.turn-diff-completed") {
    const status = event.payload.status;
    return {
      threadId: event.payload.threadId,
      outcome: status === "ready" ? "succeeded" : status === "error" ? "failed" : "interrupted",
    };
  }
  if (event.type === "thread.session-set" && event.payload.session.status === "error") {
    return { threadId: event.payload.threadId, outcome: "failed" };
  }
  if (
    event.type === "thread.session-set" &&
    event.payload.session.status === "stopped" &&
    event.payload.session.activeTurnId === null
  ) {
    return { threadId: event.payload.threadId, outcome: "interrupted" };
  }
  // An "interrupted" session with no active turn is a turn that was abandoned — nothing was
  // running it any more, so whoever dispatched it is waiting for an outcome that would
  // otherwise never arrive. The `activeTurnId === null` guard matters: the subagent stop path
  // reports `interrupted` while keeping the child's turn to wait for its terminal event.
  if (
    event.type === "thread.session-set" &&
    event.payload.session.status === "interrupted" &&
    event.payload.session.activeTurnId === null
  ) {
    return { threadId: event.payload.threadId, outcome: "interrupted" };
  }
  return null;
}
