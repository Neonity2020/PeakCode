import { Effect, Scope, ServiceMap } from "effect";

/**
 * KanbanRunReactor - Watches dispatched task runs and writes their outcome back
 * onto the board.
 *
 * A task moved into 进行中 is dispatched to a thread (see KanbanService); this
 * reactor closes the loop so the card leaves 进行中 on its own: 已完成 when the
 * turn finished, 已阻塞 when it failed, 待开始 when it was interrupted.
 *
 * @module KanbanRunReactor
 */
export interface KanbanRunReactorShape {
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  readonly drain: Effect.Effect<void>;
}

export class KanbanRunReactor extends ServiceMap.Service<KanbanRunReactor, KanbanRunReactorShape>()(
  "t3/kanban/Services/KanbanRunReactor",
) {}
