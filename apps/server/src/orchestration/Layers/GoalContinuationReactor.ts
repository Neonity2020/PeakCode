import { Effect, Layer, Option } from "effect";
import { Stream } from "effect";

import { makeDrainableWorker } from "@peakcode/shared/DrainableWorker";
import {
  addGoalUsage,
  getGoal,
  isTerminal,
  maxGoalContinuations,
  setGoalStatus,
} from "@peakcode/agent-toolkit/agent-goals";
import { CommandId, MessageId, type ProviderRuntimeEvent } from "@peakcode/contracts";

import { threadConversationKey } from "../../agentToolkit.ts";
import { goalContinuationPrompt } from "../../agentToolkitMode.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { ProviderService } from "../../provider/Services/ProviderService.ts";
import {
  GoalContinuationReactor,
  type GoalContinuationReactorShape,
} from "../Services/GoalContinuationReactor.ts";

/**
 * Goal mode's defining behaviour: **the harness keeps the work going, not the user.**
 *
 * Ordinary mode stops when a turn ends. Goal mode watches for a turn ending on a thread that
 * is in goal mode, and if the goal is still open it starts the next turn itself — passing the
 * objective and acceptance criteria back in so the model resumes instead of re-deriving what
 * it was doing.
 *
 * Three brakes, because an autonomous loop that can't stop is worse than one that stops early:
 *
 * 1. **Only a clean finish continues.** `turn.completed` with any other `state` — failed,
 *    interrupted, cancelled — ends the loop. Pressing stop must mean stop; otherwise the
 *    agent would immediately start another turn over the top of the user's interruption.
 * 2. **A continuation budget.** `maxGoalContinuations()` (default 6) bounds how many turns
 *    the harness will add on its own. Hitting it marks the goal `budget-limited`, which is a
 *    visible state in the UI — not a silent stop.
 * 3. **The goal's own token budget.** Checked after every continued turn; exceeding it stops
 *    the loop the same way.
 *
 * Reaching a terminal goal state (`complete` / `dropped`) is the *good* exit: the agent called
 * the `goal` tool with evidence.
 */
const newCommandId = () => CommandId.makeUnsafe(`cmd_${crypto.randomUUID()}`);
const newMessageId = () => MessageId.makeUnsafe(`msg_${crypto.randomUUID()}`);

export const makeGoalContinuationReactor = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const providerService = yield* ProviderService;

  const continueGoal = (event: ProviderRuntimeEvent) =>
    Effect.gen(function* () {
      if (event.type !== "turn.completed") return;
      // An interrupted or failed turn is a full stop, not a pause to be resumed automatically.
      if (event.payload.state !== "completed") return;

      const shellOption = yield* projectionSnapshotQuery.getThreadShellById(event.threadId);
      if (Option.isNone(shellOption)) return;
      const shell = shellOption.value;
      if (shell.interactionMode !== "goal") return;

      const conversationId = threadConversationKey(event.threadId);
      const goal = getGoal(conversationId);
      if (!goal || isTerminal(goal.status)) return;

      const limit = maxGoalContinuations();
      if (goal.continuations >= limit) {
        setGoalStatus(
          conversationId,
          "budget-limited",
          `自动续跑已达上限（${limit} 次）。确认进展后可以再发一条消息让它继续。`,
        );
        return;
      }

      const text = goalContinuationPrompt(conversationId);
      if (!text) return;

      // Charges the turn that just finished and books the continuation in one step, so the
      // counter can never drift from the number of turns actually started.
      const { exceededBudget } = addGoalUsage(conversationId, {
        tokens: 0,
        seconds: 0,
        continuation: true,
      });
      if (exceededBudget) {
        setGoalStatus(conversationId, "budget-limited", "token 预算已用尽。");
        return;
      }

      yield* orchestrationEngine.dispatch({
        type: "thread.turn.start",
        commandId: newCommandId(),
        threadId: event.threadId,
        message: {
          messageId: newMessageId(),
          role: "user",
          text,
          attachments: [],
        },
        modelSelection: shell.modelSelection,
        assistantDeliveryMode: "streaming",
        dispatchMode: "queue",
        runtimeMode: shell.runtimeMode,
        interactionMode: "goal",
        createdAt: new Date().toISOString(),
      });
    });

  const processSafely = (event: ProviderRuntimeEvent) =>
    continueGoal(event).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("goal continuation failed", { cause, threadId: event.threadId }),
      ),
    );

  const worker = yield* makeDrainableWorker(processSafely);

  const start: GoalContinuationReactorShape["start"] = Effect.gen(function* () {
    yield* Effect.forkScoped(
      Stream.runForEach(providerService.streamEvents, (event) => {
        if (event.type !== "turn.completed") return Effect.void;
        return worker.enqueue(event);
      }),
    );
  });

  return {
    start,
    drain: worker.drain,
  } satisfies GoalContinuationReactorShape;
});

export const GoalContinuationReactorLive = Layer.effect(
  GoalContinuationReactor,
  makeGoalContinuationReactor,
);
