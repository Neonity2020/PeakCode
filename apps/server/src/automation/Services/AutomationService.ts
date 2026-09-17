import { Effect, ServiceMap } from "effect";

import {
  Automation,
  AutomationRun,
  CreateAutomationInput,
  DeleteAutomationInput,
  GetAutomationInput,
  ListAutomationRunsInput,
  ListAutomationsInput,
  RunAutomationInput,
  ThreadId,
  UpdateAutomationInput,
} from "@peakcode/contracts";

/** How a run ended, as reported by the reactor watching the orchestration events. */
export type AutomationRunOutcome = Exclude<AutomationRun["status"], "running">;

export interface AutomationRunOutcomeInput {
  readonly threadId: ThreadId;
  readonly outcome: AutomationRunOutcome;
}

/**
 * AutomationServiceShape - scheduled tasks that run a chat turn on a plan.
 *
 * A run always opens a real thread in the automation's workspace and sends it the
 * automation's instructions, so the user can read the transcript afterwards or keep
 * asking questions in it. The run's outcome is written by `recordRunOutcome` once the
 * orchestration events say the turn is over — the dispatch itself only claims the run.
 */
export interface AutomationServiceShape {
  readonly getById: (input: GetAutomationInput) => Effect.Effect<Automation, Error>;

  /** Every automation, or the ones of a single workspace when `projectId` is set. */
  readonly list: (input: ListAutomationsInput) => Effect.Effect<ReadonlyArray<Automation>, Error>;

  readonly create: (input: CreateAutomationInput) => Effect.Effect<Automation, Error>;

  readonly update: (input: UpdateAutomationInput) => Effect.Effect<Automation, Error>;

  readonly delete: (input: DeleteAutomationInput) => Effect.Effect<void, Error>;

  /** Run now, ignoring the plan. */
  readonly run: (input: RunAutomationInput) => Effect.Effect<AutomationRun, Error>;

  readonly listRuns: (
    input: ListAutomationRunsInput,
  ) => Effect.Effect<ReadonlyArray<AutomationRun>, Error>;

  /** Close the loop for a dispatched run (reactor callback; never fails). */
  readonly recordRunOutcome: (input: AutomationRunOutcomeInput) => Effect.Effect<void, never>;

  /** Mark runs left behind by a shutdown as interrupted (reactor startup; never fails). */
  readonly releaseStaleRuns: Effect.Effect<void, never>;

  /**
   * Sweep every task that is due right now — the scheduler's own tick, exposed so callers
   * (tests, diagnostics) can drive it deterministically instead of waiting on the clock.
   */
  readonly runDue: (now?: number) => Effect.Effect<void, Error>;

  readonly startScheduler: () => Effect.Effect<void, Error>;
  readonly stopScheduler: () => Effect.Effect<void, Error>;
}

/**
 * AutomationService - Service tag for scheduled tasks.
 */
export class AutomationService extends ServiceMap.Service<
  AutomationService,
  AutomationServiceShape
>()("t3/services/AutomationService") {}
