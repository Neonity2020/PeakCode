import { makeDrainableWorker } from "@peakcode/shared/DrainableWorker";
import { Cause, Effect, Layer, Stream } from "effect";

import type { OrchestrationEvent } from "@peakcode/contracts";

import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { AutomationService } from "../Services/AutomationService.ts";
import {
  AutomationRunReactor,
  type AutomationRunReactorShape,
} from "../Services/AutomationRunReactor.ts";
import type { AutomationRunOutcomeInput } from "../Services/AutomationService.ts";

export const AUTOMATION_RUN_OUTCOME_EVENT_TYPES = [
  "thread.turn-diff-completed",
  "thread.session-set",
] as const;

/**
 * The outcome a domain event reports, or null when the event does not end a run.
 *
 * A dispatched run is over when its turn produced its diff (`ready` = the turn finished,
 * `error` = the checkpoint could not be captured, `missing` = nothing to capture, which is
 * what an interrupted turn leaves behind), when its session errored, or when the session
 * was stopped with no turn in flight.
 *
 * A session that merely reports "ready" is deliberately *not* an outcome: the provider
 * announces a freshly started session that way too, which would end a run before its first
 * turn ever ran. The same mapping drives the kanban run reactor, so both features agree on
 * what "finished" means.
 */
export function automationRunOutcomeForEvent(
  event: OrchestrationEvent,
): AutomationRunOutcomeInput | null {
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
  return null;
}

const make = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const automationService = yield* AutomationService;

  // Runs that are still open when the process starts were cut short by the last shutdown;
  // release them before new work can be claimed.
  const releaseStaleRuns = automationService.releaseStaleRuns;

  const processSafely = (input: AutomationRunOutcomeInput) =>
    automationService.recordRunOutcome(input).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) return Effect.failCause(cause);
        return Effect.logWarning("automation run reactor failed to record a run outcome", {
          threadId: input.threadId,
          outcome: input.outcome,
          cause: Cause.pretty(cause),
        });
      }),
    );

  const worker = yield* makeDrainableWorker(processSafely);

  const start: AutomationRunReactorShape["start"] = Effect.fn(function* () {
    yield* releaseStaleRuns.pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("automation run reactor failed to release stale runs", {
          cause: Cause.pretty(cause),
        }),
      ),
    );

    yield* Effect.forkScoped(
      Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) => {
        const input = automationRunOutcomeForEvent(event);
        return input === null ? Effect.void : worker.enqueue(input);
      }),
    );
  });

  return { start, drain: worker.drain } satisfies AutomationRunReactorShape;
});

export const AutomationRunReactorLive = Layer.effect(AutomationRunReactor, make);
