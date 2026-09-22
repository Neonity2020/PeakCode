/**
 * The invariant under test: what a thread *claims* is what counts, and the claim is only honoured
 * while a live provider session actually runs it.
 *
 * The case that motivated it is the child thread of a delegated worker. It has no provider
 * binding of its own — its session is written by runtime events alone — so a binding-driven sweep
 * walked past it and it sat at "running" across restarts, with nothing to press to end it.
 */
import { ProjectId, ThreadId, TurnId } from "@peakcode/contracts";
import { describe, expect, it } from "vitest";

import { selectAbandonedTurnThreads } from "./abandonedTurn.ts";

const PARENT = ThreadId.makeUnsafe("thread-parent");
const CHILD = ThreadId.makeUnsafe("subagent:thread-parent:explore-1a2b3c4d");
const PROJECT = ProjectId.makeUnsafe("project-1");

function session(
  status: "running" | "ready" | "interrupted" | "stopped",
  activeTurn: string | null,
) {
  return {
    threadId: PARENT,
    status,
    providerName: "pi",
    runtimeMode: "full-access" as const,
    activeTurnId: activeTurn === null ? null : TurnId.makeUnsafe(activeTurn),
    lastError: null,
    updatedAt: "2026-09-22T10:00:00.000Z",
  };
}

function thread(
  id: ThreadId,
  threadSession: ReturnType<typeof session> | null,
  parentThreadId: ThreadId | null = null,
) {
  return { id, session: threadSession, parentThreadId } as never;
}

function liveSession(threadId: ThreadId, status: "running" | "ready") {
  return {
    threadId,
    provider: "pi" as const,
    status,
    runtimeMode: "full-access" as const,
    cwd: "/tmp",
    createdAt: "2026-09-22T10:00:00.000Z",
    updatedAt: "2026-09-22T10:00:00.000Z",
  };
}

describe("selectAbandonedTurnThreads", () => {
  it("picks up a child thread whose session claims a turn, even with no provider binding", () => {
    const selected = selectAbandonedTurnThreads({
      threads: [thread(PARENT, session("ready", null)), thread(CHILD, session("running", "t-1"))],
      liveSessionsByThread: new Map(),
    });
    expect(selected).toEqual([CHILD]);
  });

  it("leaves a thread alone while a live session is actually running its turn", () => {
    const selected = selectAbandonedTurnThreads({
      threads: [thread(CHILD, session("running", "t-1"))],
      liveSessionsByThread: new Map([[CHILD, liveSession(CHILD, "running")]]),
    });
    expect(selected).toEqual([]);
  });

  it("ignores threads with nothing in flight", () => {
    const selected = selectAbandonedTurnThreads({
      threads: [
        thread(PARENT, null),
        thread(CHILD, session("interrupted", null)),
        thread(ThreadId.makeUnsafe("thread-3"), session("stopped", "t-2")),
      ],
      liveSessionsByThread: new Map(),
    });
    expect(selected).toEqual([]);
  });

  /**
   * The regression that made every healthy delegation look interrupted.
   *
   * A worker's session is created inside the adapter, so the provider directory never lists it and
   * "no live session runs this turn" was true of every worker at all times. The sweep therefore
   * ended every live worker's turn on each pass — five minutes into a run, the card read "Idle"
   * while the worker kept making tool calls, and the worker's thread was marked interrupted while
   * it was still working.
   */
  it("leaves a live worker alone while its orchestrator's turn is still running", () => {
    const selected = selectAbandonedTurnThreads({
      threads: [
        thread(PARENT, session("running", "t-parent")),
        thread(CHILD, session("running", "t-worker"), PARENT),
      ],
      // Only the orchestrator has a session the directory knows about; that one is alive.
      liveSessionsByThread: new Map([[PARENT, liveSession(PARENT, "running")]]),
    });
    expect(selected).toEqual([]);
  });

  it("settles the workers too once the orchestrator's turn is gone", () => {
    const selected = selectAbandonedTurnThreads({
      threads: [
        thread(PARENT, session("running", "t-parent")),
        thread(CHILD, session("running", "t-worker"), PARENT),
      ],
      // The process that owned the parent turn is gone: the parent is abandoned, and a worker
      // cannot outlive the turn that dispatched it.
      liveSessionsByThread: new Map(),
    });
    expect(selected).toEqual([PARENT, CHILD]);
  });

  it("settles a worker whose parent claims nothing even when the parent itself is idle", () => {
    const selected = selectAbandonedTurnThreads({
      threads: [
        thread(PARENT, session("ready", null)),
        thread(CHILD, session("running", "t-worker"), PARENT),
      ],
      liveSessionsByThread: new Map(),
    });
    expect(selected).toEqual([CHILD]);
  });
});
