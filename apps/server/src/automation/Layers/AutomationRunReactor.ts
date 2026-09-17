import { makeDrainableWorker } from "@peakcode/shared/DrainableWorker";
import { Cause, Effect, Layer, Stream } from "effect";

import type { OrchestrationEvent } from "@peakcode/contracts";

import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { turnOutcomeForEvent } from "../../orchestration/turnOutcome.ts";
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
 * The reading of "the turn is over" is shared with the IM bridge, so every feature that
 * dispatches a run agrees on what "finished" means.
 */
export function automationRunOutcomeForEvent(
  event: OrchestrationEvent,
): AutomationRunOutcomeInput | null {
  return turnOutcomeForEvent(event);
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
