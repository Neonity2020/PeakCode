import {
  CommandId,
  EventId,
  ProjectId,
  ThreadId,
  TurnId,
  type OrchestrationEvent,
} from "@peakcode/contracts";
import { describe, expect, it } from "vitest";

import { kanbanRunOutcomeForEvent } from "./KanbanRunReactor";

const THREAD_ID = ThreadId.makeUnsafe("thread_kanban_1");
const TURN_ID = TurnId.makeUnsafe("turn_1");
const NOW = "2026-09-16T04:36:00Z";

function makeEvent(input: {
  sequence: number;
  type: OrchestrationEvent["type"];
  payload: unknown;
}): OrchestrationEvent {
  return {
    sequence: input.sequence,
    eventId: EventId.makeUnsafe(`event-${input.sequence}`),
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

const sessionSet = (status: "ready" | "running" | "error" | "interrupted") =>
  makeEvent({
    sequence: 2,
    type: "thread.session-set",
    payload: {
      threadId: THREAD_ID,
      session: {
        threadId: THREAD_ID,
        status,
        providerName: "pi",
        runtimeMode: "approval-required",
        activeTurnId: status === "running" ? TURN_ID : null,
        lastError: status === "error" ? "boom" : null,
        updatedAt: NOW,
      },
    },
  });

const turnDiffCompleted = (status: "ready" | "missing" | "error") =>
  makeEvent({
    sequence: 3,
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

describe("kanbanRunOutcomeForEvent", () => {
  it("turns a finished checkpoint into the task's outcome", () => {
    expect(kanbanRunOutcomeForEvent(turnDiffCompleted("ready"))).toMatchObject({
      threadId: THREAD_ID,
      runStatus: "done",
    });
    expect(kanbanRunOutcomeForEvent(turnDiffCompleted("error"))).toMatchObject({
      runStatus: "failed",
    });
    expect(kanbanRunOutcomeForEvent(turnDiffCompleted("missing"))).toMatchObject({
      runStatus: "interrupted",
    });
  });

  it("treats an errored session as a failed run", () => {
    expect(kanbanRunOutcomeForEvent(sessionSet("error"))).toMatchObject({
      threadId: THREAD_ID,
      runStatus: "failed",
    });
  });

  it("ignores non-terminal and unrelated events", () => {
    expect(kanbanRunOutcomeForEvent(sessionSet("running"))).toBeNull();
    expect(kanbanRunOutcomeForEvent(sessionSet("ready"))).toBeNull();
    expect(
      kanbanRunOutcomeForEvent(
        makeEvent({
          sequence: 4,
          type: "project.created",
          payload: { projectId: ProjectId.makeUnsafe("project-1") },
        }),
      ),
    ).toBeNull();
  });
});
