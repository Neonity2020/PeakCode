import { makeDrainableWorker } from "@peakcode/shared/DrainableWorker";
import { Cause, Effect, Layer, Stream } from "effect";

import type { OrchestrationEvent } from "@peakcode/contracts";

import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { runOutcomeForCheckpointStatus } from "../boardDocument.ts";
import { KanbanRunReactor, type KanbanRunReactorShape } from "../Services/KanbanRunReactor.ts";
import { KanbanService, type KanbanTaskRunOutcome } from "../Services/KanbanService.ts";

/** What the worker needs from the terminal event that triggered it. */
export interface KanbanRunOutcomeInput {
  readonly threadId: Extract<
    OrchestrationEvent,
    { type: "thread.turn-diff-completed" }
  >["payload"]["threadId"];
  readonly runStatus: KanbanTaskRunOutcome;
  readonly eventType: OrchestrationEvent["type"];
}

/**
 * The outcome a domain event represents, or null when the event is not a
 * terminal signal for a dispatched task run.
 */
export function kanbanRunOutcomeForEvent(event: OrchestrationEvent): KanbanRunOutcomeInput | null {
  if (event.type === "thread.turn-diff-completed") {
    return {
      threadId: event.payload.threadId,
      runStatus: runOutcomeForCheckpointStatus(event.payload.status),
      eventType: event.type,
    };
  }
  // A turn that failed before it could produce a checkpoint only surfaces as an
  // errored session, so that counts as the run's outcome too.
  if (event.type === "thread.session-set" && event.payload.session.status === "error") {
    return {
      threadId: event.payload.threadId,
      runStatus: "failed",
      eventType: event.type,
    };
  }
  // Stopping the session mid-run ends the task's run as well.
  if (
    event.type === "thread.session-set" &&
    event.payload.session.status === "stopped" &&
    event.payload.session.activeTurnId === null
  ) {
    return {
      threadId: event.payload.threadId,
      runStatus: "interrupted",
      eventType: event.type,
    };
  }
  return null;
}

const make = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const kanbanService = yield* KanbanService;

  const processSafely = (input: KanbanRunOutcomeInput) =>
    kanbanService
      .recordTaskRunOutcome({ threadId: input.threadId, runStatus: input.runStatus })
      .pipe(
        Effect.catchCause((cause) => {
          if (Cause.hasInterruptsOnly(cause)) {
            return Effect.failCause(cause);
          }
          return Effect.logWarning("kanban run reactor failed to record a task run outcome", {
            eventType: input.eventType,
            threadId: input.threadId,
            cause: Cause.pretty(cause),
          });
        }),
      );

  const worker = yield* makeDrainableWorker(processSafely);

  const start: KanbanRunReactorShape["start"] = Effect.fn(function* () {
    // Nothing is running yet at startup, so any task still marked 执行中 was left
    // behind by the last shutdown and has to be released before new work starts.
    yield* kanbanService.releaseStaleTaskRuns().pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("kanban run reactor failed to release stale task runs", {
          cause: Cause.pretty(cause),
        }),
      ),
    );

    yield* Effect.forkScoped(
      Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) => {
        const input = kanbanRunOutcomeForEvent(event);
        if (input === null) {
          return Effect.void;
        }
        return worker.enqueue(input);
      }),
    );
  });

  return {
    start,
    drain: worker.drain,
  } satisfies KanbanRunReactorShape;
});

export const KanbanRunReactorLive = Layer.effect(KanbanRunReactor, make);
