import { Effect, Scope, ServiceMap } from "effect";

/**
 * AutomationRunReactor - closes the loop on dispatched runs.
 *
 * `AutomationService` only claims a run: it opens the thread, sends the instruction and
 * records that the run started. How the run ended is a fact the orchestration events carry
 * (the turn finished, the session errored, the user stopped it), so this reactor listens for
 * those and writes the outcome — plus the run's closing message as a summary — onto the run
 * record.
 *
 * @module AutomationRunReactor
 */
export interface AutomationRunReactorShape {
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  readonly drain: Effect.Effect<void>;
}

export class AutomationRunReactor extends ServiceMap.Service<
  AutomationRunReactor,
  AutomationRunReactorShape
>()("t3/automation/Services/AutomationRunReactor") {}
