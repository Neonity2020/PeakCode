import { Cause, Duration, Effect, Layer, Option, Schedule } from "effect";
import { CommandId, EventId, type OrchestrationThreadShell } from "@peakcode/contracts";

import {
  ABANDONED_TURN_ACTIVITY_KIND,
  abandonedTurnId,
  abandonedTurnSession,
  providerSessionRunsTurn,
  sessionClaimsActiveTurn,
} from "../../orchestration/abandonedTurn";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery";
import { ProviderSessionDirectory } from "../Services/ProviderSessionDirectory";
import {
  ProviderSessionReaper,
  type ProviderSessionReaperShape,
} from "../Services/ProviderSessionReaper";
import { ProviderService } from "../Services/ProviderService";

const DEFAULT_INACTIVITY_THRESHOLD_MS = 30 * 60 * 1000;
const DEFAULT_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

const serverCommandId = (tag: string): CommandId =>
  CommandId.makeUnsafe(`server:${tag}:${crypto.randomUUID()}`);

export interface ProviderSessionReaperLiveOptions {
  readonly inactivityThresholdMs?: number;
  readonly sweepIntervalMs?: number;
}

const makeProviderSessionReaper = (options?: ProviderSessionReaperLiveOptions) =>
  Effect.gen(function* () {
    const providerService = yield* ProviderService;
    const directory = yield* ProviderSessionDirectory;
    const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
    const orchestrationEngine = yield* OrchestrationEngineService;

    const inactivityThresholdMs = Math.max(
      1,
      options?.inactivityThresholdMs ?? DEFAULT_INACTIVITY_THRESHOLD_MS,
    );
    const sweepIntervalMs = Math.max(1, options?.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS);

    /**
     * End a turn the projection still reports as running when no provider session is running it.
     *
     * The runtime event that would have cleared the session (`turn.completed`,
     * `turn.aborted`, `session.exited`) is never coming — the process that owned the turn is
     * gone, or that event was lost — so the persisted claim outlives it indefinitely: the
     * thread reads as running, the composer shows a stop button for work nobody is doing, and
     * pressing it has nothing to abort. This is the state a restart or crash leaves behind, and
     * it is what the first sweep at boot finds.
     *
     * The session binding is deliberately left alone: it holds the provider resume state, so
     * the next message continues this conversation instead of starting a blank one.
     */
    const settleAbandonedTurn = (thread: OrchestrationThreadShell, now: string) =>
      Effect.gen(function* () {
        const session = thread.session;
        if (!session) {
          return;
        }
        yield* orchestrationEngine.dispatch({
          type: "thread.session.set",
          commandId: serverCommandId("reaper-abandoned-turn-session"),
          threadId: thread.id,
          session: abandonedTurnSession({ threadId: thread.id, session, now }),
          createdAt: now,
        });
        yield* orchestrationEngine.dispatch({
          type: "thread.activity.append",
          commandId: serverCommandId("reaper-abandoned-turn-activity"),
          threadId: thread.id,
          activity: {
            id: EventId.makeUnsafe(crypto.randomUUID()),
            createdAt: now,
            tone: "info",
            kind: ABANDONED_TURN_ACTIVITY_KIND,
            summary: "Turn interrupted",
            payload: {
              detail:
                "This turn was no longer running (the app was restarted, or its session was stopped), so it has been marked as interrupted. Send a message to continue.",
            },
            turnId: abandonedTurnId(session),
          },
          createdAt: now,
        });
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("provider session reaper failed to settle an abandoned turn", {
            threadId: thread.id,
            cause: Cause.pretty(cause),
          }),
        ),
      );

    const sweep = Effect.gen(function* () {
      const bindings = yield* directory.listBindings();
      const liveSessionsByThread = new Map(
        (yield* providerService.listSessions()).map((session) => [session.threadId, session]),
      );
      const now = Date.now();
      const nowIso = new Date(now).toISOString();

      for (const binding of bindings) {
        const thread = yield* projectionSnapshotQuery
          .getThreadShellById(binding.threadId)
          .pipe(Effect.map(Option.getOrUndefined));

        // No session at all, or one with no turn in flight: either way nothing is running the
        // turn the projection claims, so the claim is stale and only this can clear it.
        if (
          !providerSessionRunsTurn(liveSessionsByThread.get(binding.threadId)) &&
          sessionClaimsActiveTurn(thread?.session)
        ) {
          if (thread) {
            yield* settleAbandonedTurn(thread, nowIso);
          }
          continue;
        }

        if (binding.status === "stopped") continue;
        if (!binding.lastSeenAt) continue;

        const lastSeenMs = Date.parse(binding.lastSeenAt);
        if (Number.isNaN(lastSeenMs)) {
          yield* Effect.logWarning("provider session reaper skipped invalid timestamp", {
            threadId: binding.threadId,
            provider: binding.provider,
            lastSeenAt: binding.lastSeenAt,
          });
          continue;
        }

        const idleDurationMs = now - lastSeenMs;
        if (idleDurationMs < inactivityThresholdMs) continue;

        if (thread?.session?.activeTurnId != null) continue;

        // Free the runtime, keep the resume state. `stopSession` deletes the persisted binding
        // along with the provider's resume cursor, which would make the next message start a
        // conversation with no memory of the thread it belongs to; reclaiming a live runtime is
        // what this reaper is for, and `stopRuntimeSession` is the call that does only that.
        const stopped = providerService.stopRuntimeSession
          ? providerService.stopRuntimeSession({ threadId: binding.threadId })
          : providerService.stopSession({ threadId: binding.threadId });
        yield* stopped.pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("provider session reaper failed to stop stale session", {
              threadId: binding.threadId,
              provider: binding.provider,
              cause: Cause.pretty(cause),
            }),
          ),
        );
      }
    });

    const runSweepSafely = sweep.pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("provider session reaper sweep failed", {
          cause: Cause.pretty(cause),
        }),
      ),
    );

    const start: ProviderSessionReaperShape["start"] = () =>
      Effect.forkScoped(
        runSweepSafely.pipe(Effect.repeat(Schedule.spaced(Duration.millis(sweepIntervalMs)))),
      ).pipe(Effect.asVoid);

    return { start } satisfies ProviderSessionReaperShape;
  });

export const makeProviderSessionReaperLive = (options?: ProviderSessionReaperLiveOptions) =>
  Layer.effect(ProviderSessionReaper, makeProviderSessionReaper(options));

export const ProviderSessionReaperLive = makeProviderSessionReaperLive();
