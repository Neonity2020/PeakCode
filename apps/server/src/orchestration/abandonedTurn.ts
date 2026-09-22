// FILE: abandonedTurn.ts
// Purpose: End a turn that no process owns any more.
// Layer: Orchestration support
// Exports: sessionClaimsActiveTurn, providerSessionRunsTurn, abandonedTurnSession, abandonedTurnId,
//          selectAbandonedTurnThreads

import {
  DEFAULT_RUNTIME_MODE,
  type OrchestrationSession,
  type ProviderSession,
  type ThreadId,
  type TurnId,
} from "@peakcode/contracts";

/**
 * Activity kind written when a turn is ended because nothing was left running it.
 *
 * `tone: "error"` would overstate it: a restart or a reaped session is a fact of life, not a
 * failure of the turn. Callers pair the kind with a summary that says what happened.
 */
export const ABANDONED_TURN_ACTIVITY_KIND = "provider.turn.abandoned";

/**
 * Does this projected session still claim a turn is in flight?
 *
 * The projection is the only place a stale claim can live: a provider runtime event that
 * would have cleared it (turn.completed / turn.aborted / session.exited) never arrived, so
 * the row keeps whatever it was last told. `interrupted` counts too — the subagent stop path
 * preserves `activeTurnId` on purpose while it waits for the child's terminal event.
 */
export function sessionClaimsActiveTurn(
  session: OrchestrationSession | null | undefined,
): session is OrchestrationSession {
  if (!session || session.status === "stopped") {
    return false;
  }
  return session.status === "running" || session.activeTurnId !== null;
}

/**
 * Does this live provider session have a turn a stop could actually abort?
 *
 * The adapter is the live truth and the projection is not: a session that says it is ready
 * has no run in flight, so a projected claim to the contrary is stale whatever its age.
 */
export function providerSessionRunsTurn(session: ProviderSession | undefined): boolean {
  if (!session) {
    return false;
  }
  return session.status === "running" || session.activeTurnId !== undefined;
}

/**
 * The session row that ends an abandoned turn.
 *
 * `interrupted` (rather than `ready`) is what the projection reads as "this turn did not
 * finish", so the open turn row gets a `completedAt` and a final `interrupted` state, and the
 * UI stops showing the thread as running. `activeTurnId: null` is the part that actually
 * clears the claim.
 */
export function abandonedTurnSession(input: {
  readonly threadId: ThreadId;
  readonly session: OrchestrationSession | null | undefined;
  readonly now: string;
}): OrchestrationSession {
  return {
    threadId: input.threadId,
    status: "interrupted",
    providerName: input.session?.providerName ?? null,
    runtimeMode: input.session?.runtimeMode ?? DEFAULT_RUNTIME_MODE,
    activeTurnId: null,
    lastError: input.session?.lastError ?? null,
    updatedAt: input.now,
  };
}

/** Turn id to attribute the closing activity to, when the session carried one. */
export function abandonedTurnId(session: OrchestrationSession | null | undefined): TurnId | null {
  return session?.activeTurnId ?? null;
}

/**
 * The threads whose projected session claims a turn that nothing is running.
 *
 * This is deliberately driven by what the *projection* claims, not by the provider-session
 * directory. A thread can carry a live-looking session without ever having had a provider
 * binding of its own: a delegated worker's child thread is written by runtime events alone.
 * Sweeping bindings would therefore walk past exactly the threads that go stale when the process
 * that was reporting on them disappears — which is how a subagent could sit at "running" through
 * every restart, with no way for the user to end it or even tell.
 *
 * The invariant: after a restart nothing may claim to be in flight, and every thread is judged by
 * the same rule — does a live provider session actually run this turn?
 *
 * ## Why a worker is judged by its parent instead
 *
 * A worker runs in its own session that the provider directory never learns about (`runSubagent`
 * creates it inside the adapter), so "no live session runs it" is true of every worker at all
 * times — and this sweep therefore ended every *live* worker's turn on every pass, five minutes
 * into a healthy run. The card then read "Idle" while its worker kept making tool calls for
 * minutes afterwards, and the worker's thread was marked interrupted while it was still working.
 *
 * A delegated worker's liveness is its orchestrator's turn plus the adapter's live-worker
 * registry, and this sweep can see neither. So a child is only abandoned once its parent is:
 * while the parent still claims an active turn, its workers are the parent's business — and when
 * the parent is finally settled (or was never running a turn), the children follow on the same
 * pass, because a worker cannot outlive the turn that dispatched it.
 */
export function selectAbandonedTurnThreads(input: {
  readonly threads: ReadonlyArray<{
    readonly id: ThreadId;
    readonly session: OrchestrationSession | null | undefined;
    readonly parentThreadId?: ThreadId | null | undefined;
  }>;
  readonly liveSessionsByThread: ReadonlyMap<ThreadId, ProviderSession>;
}): ReadonlyArray<ThreadId> {
  const byId = new Map(input.threads.map((thread) => [thread.id, thread] as const));
  const running = (threadId: ThreadId): boolean =>
    providerSessionRunsTurn(input.liveSessionsByThread.get(threadId));

  const memo = new Map<ThreadId, boolean>();
  const isAbandoned = (thread: (typeof input.threads)[number], depth = 0): boolean => {
    const cached = memo.get(thread.id);
    if (cached !== undefined) {
      return cached;
    }
    let result = false;
    if (sessionClaimsActiveTurn(thread.session) && !running(thread.id)) {
      const parentId = thread.parentThreadId ?? null;
      const parent = parentId ? byId.get(parentId) : undefined;
      // Depth guard: the projection's parent links are a forest, but a corrupted link must not
      // be able to hang the sweep.
      result =
        depth > 8 ||
        !parent ||
        !sessionClaimsActiveTurn(parent.session) ||
        isAbandoned(parent, depth + 1);
    }
    memo.set(thread.id, result);
    return result;
  };

  return input.threads.filter((thread) => isAbandoned(thread)).map((thread) => thread.id);
}
