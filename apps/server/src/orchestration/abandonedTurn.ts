// FILE: abandonedTurn.ts
// Purpose: End a turn that no process owns any more.
// Layer: Orchestration support
// Exports: sessionClaimsActiveTurn, providerSessionRunsTurn, abandonedTurnSession, abandonedTurnId

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
