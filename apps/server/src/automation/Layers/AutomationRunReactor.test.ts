import { CommandId, EventId, ThreadId, TurnId, type OrchestrationEvent } from "@peakcode/contracts";
import { describe, expect, it } from "vitest";

import { automationRunOutcomeForEvent } from "./AutomationRunReactor";

const THREAD_ID = ThreadId.makeUnsafe("thread_automation_1");
const TURN_ID = TurnId.makeUnsafe("turn_1");
const NOW = "2026-09-16T04:36:00Z";

function makeEvent(input: {
  type: OrchestrationEvent["type"];
  payload: unknown;
}): OrchestrationEvent {
  return {
    sequence: 1,
    eventId: EventId.makeUnsafe("event-1"),
    type: input.type,
    aggregateKind: "thread",
    aggregateId: THREAD_ID,
    occurredAt: NOW,
    commandId: CommandId.makeUnsafe("cmd_1"),
    causationEventId: null,
    correlationId: null,
    metadata: {},
    payload: input.payload as never,
  } as OrchestrationEvent;
}

const sessionSet = (
  status: "ready" | "running" | "error" | "stopped",
  activeTurnId: TurnId | null,
) =>
  makeEvent({
    type: "thread.session-set",
    payload: {
      threadId: THREAD_ID,
      session: {
        threadId: THREAD_ID,
        status,
        providerName: "pi",
        runtimeMode: "approval-required",
        activeTurnId,
        lastError: status === "error" ? "boom" : null,
        updatedAt: NOW,
      },
    },
  });

const turnDiffCompleted = (status: "ready" | "missing" | "error") =>
  makeEvent({
    type: "thread.turn-diff-completed",
    payload: {
      threadId: THREAD_ID,
      turnId: TURN_ID,
      checkpointTurnCount: 1,
      checkpointRef: "checkpoint-1",
      status,
      files: [],
      assistantMessageId: null,
      completedAt: NOW,
    },
  });

describe("automationRunOutcomeForEvent", () => {
  it("reads a finished turn as a succeeded run", () => {
    expect(automationRunOutcomeForEvent(turnDiffCompleted("ready"))).toMatchObject({
      threadId: THREAD_ID,
      outcome: "succeeded",
    });
  });

  it("treats a checkpoint failure as a failed run and an absent diff as interrupted", () => {
    expect(automationRunOutcomeForEvent(turnDiffCompleted("error"))?.outcome).toBe("failed");
    expect(automationRunOutcomeForEvent(turnDiffCompleted("missing"))?.outcome).toBe("interrupted");
  });

  it("reads an errored session as a failed run", () => {
    expect(automationRunOutcomeForEvent(sessionSet("error", null))?.outcome).toBe("failed");
  });

  it("reads a stopped session with no turn in flight as interrupted", () => {
    expect(automationRunOutcomeForEvent(sessionSet("stopped", null))?.outcome).toBe("interrupted");
    // The session stopping mid-turn is the interrupt request itself, not the outcome yet.
    expect(automationRunOutcomeForEvent(sessionSet("stopped", TURN_ID))).toBeNull();
  });

  it("ignores a session that merely reports ready", () => {
    // A freshly started session announces "ready" before its first turn runs; treating that
    // as an outcome would close the run before any work happened.
    expect(automationRunOutcomeForEvent(sessionSet("ready", null))).toBeNull();
    expect(automationRunOutcomeForEvent(sessionSet("running", TURN_ID))).toBeNull();
  });

  it("ignores events that have nothing to do with a run ending", () => {
    expect(
      automationRunOutcomeForEvent(
        makeEvent({ type: "thread.meta-updated", payload: { threadId: THREAD_ID } }),
      ),
    ).toBeNull();
  });
});
