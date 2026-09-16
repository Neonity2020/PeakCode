import { type Effect, ServiceMap, type Scope } from "effect";

/**
 * GoalContinuationReactor - keeps a Goal-mode thread moving after a turn ends.
 *
 * See `Layers/GoalContinuationReactor.ts` for the loop and its brakes.
 */
export interface GoalContinuationReactorShape {
  readonly start: Effect.Effect<void, never, Scope.Scope>;
  /** Wait for in-flight work to finish. Used by tests and by shutdown. */
  readonly drain: Effect.Effect<void>;
}

export class GoalContinuationReactor extends ServiceMap.Service<
  GoalContinuationReactor,
  GoalContinuationReactorShape
>()("t3/orchestration/GoalContinuationReactor") {}
