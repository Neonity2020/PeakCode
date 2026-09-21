import { ThreadId, TurnId, type OrchestrationThreadShell } from "@peakcode/contracts";
import { Effect, Exit, Layer, Option, Scope, Stream } from "effect";
import { describe, expect, it, vi } from "vitest";

import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine";
import type { OrchestrationEngineShape } from "../../orchestration/Services/OrchestrationEngine";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery";
import {
  ProviderSessionDirectory,
  type ProviderSessionDirectoryShape,
} from "../Services/ProviderSessionDirectory";
import { ProviderSessionReaper } from "../Services/ProviderSessionReaper";
import { ProviderService, type ProviderServiceShape } from "../Services/ProviderService";
import { makeProviderSessionReaperLive } from "./ProviderSessionReaper";

const unsupported = () => Effect.die(new Error("Unsupported test call")) as never;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for predicate");
    await sleep(10);
  }
}

interface DispatchedCommand {
  readonly type: string;
  readonly [key: string]: unknown;
}

function makeThreadShell(input: {
  readonly threadId: ThreadId;
  readonly activeTurnId: TurnId | null;
}): OrchestrationThreadShell {
  return {
    id: input.threadId,
    session: input.activeTurnId
      ? {
          threadId: input.threadId,
          status: "running",
          providerName: "pi",
          runtimeMode: "full-access",
          activeTurnId: input.activeTurnId,
          lastError: null,
          updatedAt: "2026-01-01T00:00:00.000Z",
        }
      : null,
  } as unknown as OrchestrationThreadShell;
}

/**
 * Start the reaper's first sweep and wait for it to finish.
 *
 * The sweep runs in a forked fiber, so there is nothing to await directly: tests either wait
 * for the effect they expect (`awaitSettled`) or give the fiber a beat and assert nothing
 * happened (`runUntilIdle`).
 */
async function withReaper(
  input: {
    readonly threadShell: OrchestrationThreadShell;
    readonly directory: ProviderSessionDirectoryShape;
    readonly providerService: ProviderServiceShape;
    readonly dispatched: DispatchedCommand[];
  },
  body: () => Promise<void>,
): Promise<void> {
  const scope = await Effect.runPromise(Scope.make());
  try {
    await Effect.gen(function* () {
      const reaper = yield* ProviderSessionReaper;
      yield* Scope.provide(reaper.start(), scope);
    }).pipe(
      Effect.provide(
        makeProviderSessionReaperLive({
          inactivityThresholdMs: 1,
          sweepIntervalMs: 60_000,
        }).pipe(
          Layer.provide(Layer.succeed(ProviderSessionDirectory, input.directory)),
          Layer.provide(Layer.succeed(ProviderService, input.providerService)),
          Layer.provide(
            Layer.succeed(OrchestrationEngineService, {
              readEvents: () => Stream.empty,
              getReadModel: () => unsupported(),
              repairState: () => unsupported(),
              streamDomainEvents: Stream.empty,
              dispatch: (command: unknown) =>
                Effect.sync(() => {
                  input.dispatched.push(command as DispatchedCommand);
                  return { sequence: 1 };
                }),
            } as unknown as OrchestrationEngineShape),
          ),
          Layer.provide(
            Layer.succeed(ProjectionSnapshotQuery, {
              getSnapshot: () => unsupported(),
              getCommandReadModel: () => unsupported(),
              getCounts: () => unsupported(),
              getSnapshotSequence: () => unsupported(),
              getShellSnapshot: () => unsupported(),
              getActiveProjectByWorkspaceRoot: () => unsupported(),
              getProjectShellById: () => unsupported(),
              getFirstActiveThreadIdByProjectId: () => unsupported(),
              getThreadCheckpointContext: () => unsupported(),
              getFullThreadDiffContext: () => unsupported(),
              getThreadShellById: () => Effect.succeed(Option.some(input.threadShell)),
              findSyntheticSubagentParentThread: () => unsupported(),
              getThreadDetailById: () => unsupported(),
              getThreadDetailSnapshotById: () => unsupported(),
            }),
          ),
        ),
      ),
      Effect.runPromise,
    );
    await body();
  } finally {
    await Effect.runPromise(Scope.close(scope, Exit.void));
  }
}

function makeProviderService(input: {
  readonly stopSession?: ProviderServiceShape["stopSession"];
  readonly stopRuntimeSession?: NonNullable<ProviderServiceShape["stopRuntimeSession"]>;
  readonly listSessions?: ProviderServiceShape["listSessions"];
}): ProviderServiceShape {
  return {
    startSession: () => unsupported(),
    sendTurn: () => unsupported(),
    steerTurn: () => unsupported(),
    startReview: () => unsupported(),
    interruptTurn: () => unsupported(),
    abandonTurn: () => unsupported(),
    respondToRequest: () => unsupported(),
    respondToUserInput: () => unsupported(),
    stopSession: input.stopSession ?? (() => Effect.void),
    ...(input.stopRuntimeSession ? { stopRuntimeSession: input.stopRuntimeSession } : {}),
    listSessions: input.listSessions ?? (() => Effect.succeed([])),
    getCapabilities: () => unsupported(),
    rollbackConversation: () => unsupported(),
    compactThread: () => unsupported(),
    streamEvents: Stream.empty,
  };
}

function makeDirectory(threadId: ThreadId): ProviderSessionDirectoryShape {
  return {
    upsert: () => Effect.void,
    getProvider: () => unsupported(),
    getBinding: () => unsupported(),
    remove: () => Effect.void,
    listThreadIds: () => Effect.succeed([]),
    listBindings: () =>
      Effect.succeed([
        {
          threadId,
          provider: "pi",
          status: "running",
          lastSeenAt: "2026-01-01T00:00:00.000Z",
        },
      ]),
  };
}

describe("ProviderSessionReaperLive", () => {
  it("stops stale sessions without active turns, keeping the persisted binding", async () => {
    const threadId = ThreadId.makeUnsafe("thread-reaper-stale");
    const stopRuntimeSession = vi.fn<NonNullable<ProviderServiceShape["stopRuntimeSession"]>>(
      () => Effect.void,
    );
    const dispatched: DispatchedCommand[] = [];

    await withReaper(
      {
        threadShell: makeThreadShell({ threadId, activeTurnId: null }),
        directory: makeDirectory(threadId),
        providerService: makeProviderService({
          stopRuntimeSession,
          stopSession: () => {
            throw new Error("the reaper must not delete the persisted provider binding");
          },
        }),
        dispatched,
      },
      async () => {
        await waitFor(() => stopRuntimeSession.mock.calls.length === 1);
        await sleep(20);
      },
    );

    // Reclaiming the runtime is the job; deleting the binding would also delete the provider
    // resume cursor, and the next message would start a conversation with no memory.
    expect(stopRuntimeSession).toHaveBeenCalledWith({ threadId });
    expect(dispatched).toEqual([]);
  });

  it("settles a turn the projection still calls running when no session is live", async () => {
    // What a restart after a killed turn leaves behind: the persisted projection still claims
    // the turn is in flight while the process that owned it is gone. Nothing will ever emit
    // its terminal event, so the reaper has to close it — otherwise the thread reads as
    // running forever and a stop has nothing left to abort.
    const threadId = ThreadId.makeUnsafe("thread-reaper-abandoned");
    const turnId = TurnId.makeUnsafe("turn-reaper-abandoned");
    const dispatched: DispatchedCommand[] = [];
    const stopRuntimeSession = vi.fn(() => Effect.void);

    await withReaper(
      {
        threadShell: makeThreadShell({ threadId, activeTurnId: turnId }),
        directory: makeDirectory(threadId),
        providerService: makeProviderService({ stopRuntimeSession }),
        dispatched,
      },
      async () => {
        await waitFor(
          () => dispatched.filter((command) => command.type === "thread.session.set").length === 1,
        );
      },
    );

    const sessionSet = dispatched.find((command) => command.type === "thread.session.set");
    expect(sessionSet?.session).toMatchObject({
      threadId,
      status: "interrupted",
      activeTurnId: null,
    });
    const activity = dispatched.find((command) => command.type === "thread.activity.append");
    expect(activity?.activity).toMatchObject({
      kind: "provider.turn.abandoned",
      tone: "info",
      turnId,
    });
    // There was no runtime left to reclaim, and the binding must survive so the next message
    // resumes the same conversation.
    expect(stopRuntimeSession).not.toHaveBeenCalled();
  });

  it("settles a turn the projection still calls running when the live session has no turn", async () => {
    // The provider's view is the live truth: a session that reports ready has nothing in
    // flight, so a projected claim to the contrary is stale even though the session is up.
    const threadId = ThreadId.makeUnsafe("thread-reaper-idle-session");
    const turnId = TurnId.makeUnsafe("turn-reaper-idle-session");
    const dispatched: DispatchedCommand[] = [];
    const stopRuntimeSession = vi.fn(() => Effect.void);

    await withReaper(
      {
        threadShell: makeThreadShell({ threadId, activeTurnId: turnId }),
        directory: makeDirectory(threadId),
        providerService: makeProviderService({
          stopRuntimeSession,
          listSessions: () =>
            Effect.succeed([
              {
                provider: "pi",
                status: "ready",
                runtimeMode: "full-access",
                threadId,
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
              },
            ]),
        }),
        dispatched,
      },
      async () => {
        await waitFor(
          () => dispatched.filter((command) => command.type === "thread.session.set").length === 1,
        );
      },
    );

    expect(
      dispatched.find((command) => command.type === "thread.session.set")?.session,
    ).toMatchObject({ threadId, status: "interrupted", activeTurnId: null });
    expect(stopRuntimeSession).not.toHaveBeenCalled();
  });

  it("leaves a running turn alone while its provider session is live", async () => {
    const threadId = ThreadId.makeUnsafe("thread-reaper-live");
    const turnId = TurnId.makeUnsafe("turn-reaper-live");
    const dispatched: DispatchedCommand[] = [];
    const stopRuntimeSession = vi.fn(() => Effect.void);

    await withReaper(
      {
        threadShell: makeThreadShell({ threadId, activeTurnId: turnId }),
        directory: makeDirectory(threadId),
        providerService: makeProviderService({
          stopRuntimeSession,
          listSessions: () =>
            Effect.succeed([
              {
                provider: "pi",
                status: "running",
                runtimeMode: "full-access",
                threadId,
                activeTurnId: turnId,
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
              },
            ]),
        }),
        dispatched,
      },
      async () => {
        await sleep(100);
      },
    );

    expect(dispatched).toEqual([]);
    expect(stopRuntimeSession).not.toHaveBeenCalled();
  });
});
