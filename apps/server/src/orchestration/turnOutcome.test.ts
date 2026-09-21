import { describe, expect, it } from "vitest";
import { CommandId, EventId, ThreadId, TurnId } from "@peakcode/contracts";

import { turnOutcomeForEvent } from "./turnOutcome";

const threadId = ThreadId.makeUnsafe("thread-outcome");

function sessionSetEvent(session: {
  readonly status: "ready" | "running" | "interrupted" | "stopped" | "error";
  readonly activeTurnId: TurnId | null;
}) {
  return {
    eventId: EventId.makeUnsafe("event-1"),
    aggregateKind: "thread" as const,
    aggregateId: threadId,
    streamVersion: 1,
    occurredAt: "2026-01-01T00:00:00.000Z",
    commandId: CommandId.makeUnsafe("command-1"),
    causationEventId: null,
    correlationId: null,
    actorKind: "server" as const,
    sequence: 1,
    metadata: {},
    type: "thread.session-set" as const,
    payload: {
      threadId,
      session: {
        threadId,
        status: session.status,
        providerName: "pi",
        runtimeMode: "full-access" as const,
        activeTurnId: session.activeTurnId,
        lastError: null,
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    },
  };
}

describe("turnOutcomeForEvent", () => {
  it("reads an abandoned turn as interrupted so its dispatcher stops waiting", () => {
    // Nothing is running the turn any more, so no diff and no terminal runtime event are
    // coming: whoever dispatched it (an automation, a kanban card, the IM bridge) would wait
    // for an outcome that never arrives.
    expect(
      turnOutcomeForEvent(sessionSetEvent({ status: "interrupted", activeTurnId: null })),
    ).toEqual({ threadId, outcome: "interrupted" });
  });

  it("leaves an interrupted session with a turn still attached alone", () => {
    // The subagent stop path reports `interrupted` while keeping the child's turn, waiting for
    // its own terminal event to say how it ended.
    expect(
      turnOutcomeForEvent(
        sessionSetEvent({ status: "interrupted", activeTurnId: TurnId.makeUnsafe("turn-1") }),
      ),
    ).toBeNull();
  });

  it("leaves a ready session alone", () => {
    // A freshly started session announces itself as ready, which would end a run before its
    // first turn ever ran.
    expect(
      turnOutcomeForEvent(sessionSetEvent({ status: "ready", activeTurnId: null })),
    ).toBeNull();
  });
});
