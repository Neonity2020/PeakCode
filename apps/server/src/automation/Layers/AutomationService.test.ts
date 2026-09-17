/**
 * Scheduled-task service tests.
 *
 * The interesting parts are not the CRUD but the edges around unattended runs: which
 * instant a plan fires at, what happens to a trigger the server slept through, and how a
 * run is closed once its conversation reports back.
 */
import { assert, it } from "@effect/vitest";
import { Cause, Effect, Exit, Layer, Option, Stream } from "effect";
import { beforeEach, describe, expect, test } from "vitest";

import {
  ProjectId,
  ThreadId,
  type Automation,
  type AutomationRun,
  type ModelSelection,
  type OrchestrationProjectShell,
  type OrchestrationThread,
  type OrchestrationThreadShell,
} from "@peakcode/contracts";
import { clearGoal, createGoal, setGoalStatus } from "@peakcode/agent-toolkit/agent-goals";

import { PersistenceSqlError } from "../../persistence/Errors.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import {
  AutomationRepository,
  type AutomationWrite,
} from "../../persistence/Services/Automations.ts";
import { ProviderDiscoveryService } from "../../provider/Services/ProviderDiscoveryService.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { AutomationService } from "../Services/AutomationService.ts";
import { AutomationServiceLive, validateSchedule } from "./AutomationService.ts";
import { threadConversationKey } from "../../agentToolkit.ts";

const PROJECT_ID = ProjectId.makeUnsafe("project-1");
const SHANGHAI = "Asia/Shanghai";
/** What the discovery stub reports; a run with no workspace default must use it. */
const TEST_MODEL_SLUG = "anthropic/claude-sonnet-4-6";

const project = {
  id: PROJECT_ID,
  kind: "project",
  title: "Peak Code",
  workspaceRoot: "/tmp/peakcode",
  defaultModelSelection: null,
  scripts: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
} as unknown as OrchestrationProjectShell;

/** The only parts of a thread detail the automation service reads. */
interface FakeThreadDetail {
  readonly messages: ReadonlyArray<{ readonly role: string; readonly text: string }>;
  readonly session: { readonly lastError: string | null } | null;
}

interface FakeState {
  readonly automations: Map<string, Automation>;
  readonly runs: Array<AutomationRun>;
  readonly commands: Array<Record<string, unknown>>;
  projectExists: boolean;
  threadDetail: Option.Option<FakeThreadDetail>;
}

const makeState = (): FakeState => ({
  automations: new Map(),
  runs: [],
  commands: [],
  projectExists: true,
  threadDetail: Option.none(),
});

/** The stored records are immutable (they come out of a schema), so tests replace them. */
const patchAutomation = (
  state: FakeState,
  automationId: string,
  patch: Partial<Automation>,
): void => {
  const existing = state.automations.get(automationId);
  if (existing) state.automations.set(automationId, { ...existing, ...patch });
};

const patchRun = (
  state: FakeState,
  runId: AutomationRun["runId"],
  patch: Partial<AutomationRun>,
): void => {
  const index = state.runs.findIndex((candidate) => candidate.runId === runId);
  const existing = state.runs[index];
  if (existing) state.runs[index] = { ...existing, ...patch };
};

const makeRepositoryLayer = (state: FakeState) =>
  Layer.succeed(
    AutomationRepository,
    AutomationRepository.of({
      getById: ({ automationId }) => {
        const automation = state.automations.get(automationId);
        return automation === undefined
          ? Effect.fail(
              new PersistenceSqlError({
                operation: "test.getById",
                detail: `Automation '${automationId}' was not found.`,
              }),
            )
          : Effect.succeed(automation);
      },
      list: ({ projectId }) =>
        Effect.succeed(
          [...state.automations.values()].filter(
            (automation) => projectId === undefined || automation.projectId === projectId,
          ),
        ),
      listDue: (now) =>
        Effect.succeed(
          [...state.automations.values()].filter(
            (automation) =>
              automation.isEnabled && automation.nextRunAt !== null && automation.nextRunAt <= now,
          ),
        ),
      create: (input: AutomationWrite) => {
        const automation: Automation = { ...input, lastRunStatus: null };
        state.automations.set(automation.automationId, automation);
        return Effect.succeed(automation);
      },
      update: (input: AutomationWrite) => {
        const automation: Automation = {
          ...input,
          lastRunStatus: state.automations.get(input.automationId)?.lastRunStatus ?? null,
        };
        state.automations.set(automation.automationId, automation);
        return Effect.succeed(automation);
      },
      delete: ({ automationId }) => {
        state.automations.delete(automationId);
        return Effect.void;
      },
      listRuns: ({ automationId, limit }) =>
        Effect.succeed(
          state.runs.filter((run) => run.automationId === automationId).slice(0, limit),
        ),
      createRun: ({ automationId, trigger }) => {
        const run: AutomationRun = {
          runId: `run_${state.runs.length + 1}` as AutomationRun["runId"],
          automationId,
          trigger,
          status: "running",
          threadId: null,
          summary: null,
          errorMessage: null,
          startedAt: new Date().toISOString(),
          finishedAt: null,
        };
        state.runs.push(run);
        return Effect.succeed(run);
      },
      attachRunThread: ({ runId, threadId }) => {
        patchRun(state, runId, { threadId });
        return Effect.void;
      },
      runningRunForAutomation: (automationId) =>
        Effect.succeed(
          Option.fromNullishOr(
            state.runs.find((run) => run.automationId === automationId && run.status === "running"),
          ),
        ),
      runningRunForThread: (threadId) =>
        Effect.succeed(
          Option.fromNullishOr(
            state.runs.find((run) => run.threadId === threadId && run.status === "running"),
          ),
        ),
      finishRun: ({ runId, status, summary, errorMessage }) => {
        patchRun(state, runId, {
          status,
          summary: summary ?? null,
          errorMessage: errorMessage ?? null,
          finishedAt: new Date().toISOString(),
        });
        return Effect.void;
      },
      finishRunningRuns: ({ status, errorMessage }) => {
        for (const run of [...state.runs].toReversed()) {
          if (run.status !== "running") continue;
          patchRun(state, run.runId, {
            status,
            errorMessage,
            finishedAt: new Date().toISOString(),
          });
        }
        return Effect.void;
      },
      saveScheduleState: ({ automationId, nextRunAt, isEnabled, lastRunAt }) => {
        patchAutomation(state, automationId, {
          nextRunAt,
          ...(isEnabled === undefined ? {} : { isEnabled }),
          ...(lastRunAt === undefined || lastRunAt === null ? {} : { lastRunAt }),
        });
        return Effect.void;
      },
    }),
  );

const makeOrchestrationLayer = (state: FakeState) =>
  Layer.succeed(
    OrchestrationEngineService,
    OrchestrationEngineService.of({
      readEvents: () => Stream.empty,
      getReadModel: () => Effect.die("not used"),
      dispatch: (command) => {
        state.commands.push(command as unknown as Record<string, unknown>);
        return Effect.succeed({ sequence: state.commands.length });
      },
      repairState: () => Effect.die("not used"),
      streamDomainEvents: Stream.empty,
    }),
  );

const makeProjectionLayer = (state: FakeState) =>
  Layer.succeed(
    ProjectionSnapshotQuery,
    ProjectionSnapshotQuery.of({
      getCommandReadModel: () => Effect.die("not used"),
      getSnapshot: () => Effect.die("not used"),
      getCounts: () => Effect.die("not used"),
      getSnapshotSequence: () => Effect.die("not used"),
      getShellSnapshot: () => Effect.die("not used"),
      getActiveProjectByWorkspaceRoot: () => Effect.succeed(Option.none()),
      getProjectShellById: () =>
        Effect.succeed(state.projectExists ? Option.some(project) : Option.none()),
      getFirstActiveThreadIdByProjectId: () => Effect.succeed(Option.none()),
      getThreadCheckpointContext: () => Effect.succeed(Option.none()),
      getFullThreadDiffContext: () => Effect.succeed(Option.none()),
      getThreadShellById: () =>
        Effect.succeed(
          Option.some({
            id: ThreadId.makeUnsafe("thread-1"),
            projectId: PROJECT_ID,
          } as unknown as OrchestrationThreadShell),
        ),
      findSyntheticSubagentParentThread: () => Effect.succeed(Option.none()),
      getThreadDetailById: () =>
        Effect.succeed(
          Option.map(state.threadDetail, (detail) => detail as unknown as OrchestrationThread),
        ),
      getThreadDetailSnapshotById: () => Effect.succeed(Option.none()),
    }),
  );

const makeLayer = (state: FakeState) =>
  AutomationServiceLive.pipe(
    Layer.provide(makeRepositoryLayer(state)),
    Layer.provide(makeOrchestrationLayer(state)),
    Layer.provide(makeProjectionLayer(state)),
    // No default model is configured here, so the discovery stub below decides.
    Layer.provide(ServerSettingsService.layerTest()),
    // A scheduled run resolves a model with nobody to ask: the stub reports one so the
    // dispatch carries a real slug instead of dying on the fallback.
    Layer.provide(
      ProviderDiscoveryService.layerTest({ models: [{ slug: TEST_MODEL_SLUG, name: "Test" }] }),
    ),
  );

const dailyAt = (hour: number, minute: number) => ({ kind: "daily" as const, hour, minute });

const utcHourOf = (timestamp: string | null): number | null =>
  timestamp === null ? null : new Date(timestamp).getUTCHours();

describe("validateSchedule", () => {
  const now = Date.parse("2026-05-01T00:00:00.000Z");

  test("a one-off must be in the future", () => {
    expect(validateSchedule({ kind: "once", at: "2026-05-02T00:00:00.000Z" }, now)).toBeNull();
    expect(validateSchedule({ kind: "once", at: "2026-04-30T00:00:00.000Z" }, now)).toContain(
      "future",
    );
    expect(validateSchedule({ kind: "once", at: "nonsense" }, now)).toContain("could not be read");
  });

  test("a weekly plan needs at least one weekday", () => {
    expect(validateSchedule({ kind: "weekly", hour: 9, minute: 0, daysOfWeek: [] }, now)).toContain(
      "weekday",
    );
    expect(
      validateSchedule({ kind: "weekly", hour: 9, minute: 0, daysOfWeek: [1] }, now),
    ).toBeNull();
  });

  test("daily plans are always valid", () => {
    expect(validateSchedule(dailyAt(9, 0), now)).toBeNull();
  });
});

describe("AutomationService", () => {
  let state: FakeState;

  beforeEach(() => {
    state = makeState();
  });

  const withService = <A, E>(effect: Effect.Effect<A, E, AutomationService>) =>
    effect.pipe(Effect.provide(makeLayer(state)));

  test("create stores the next instant of a daily plan in its timezone", async () => {
    const automation = await Effect.runPromise(
      withService(
        Effect.gen(function* () {
          const service = yield* AutomationService;
          return yield* service.create({
            projectId: PROJECT_ID,
            title: "Morning briefing",
            instructions: "Summarise yesterday's commits.",
            schedule: dailyAt(9, 0),
            timezone: SHANGHAI,
          });
        }),
      ),
    );

    assert.strictEqual(automation.timezone, SHANGHAI);
    assert.strictEqual(automation.mode, "default");
    assert.isTrue(automation.isEnabled);
    // 09:00 in Shanghai is 01:00 UTC, and the stored instant is always in the future.
    assert.strictEqual(utcHourOf(automation.nextRunAt), 1);
    assert.isAbove(Date.parse(automation.nextRunAt!), Date.now());
  });

  test("create reports an unusable workspace instead of writing a broken row", async () => {
    state.projectExists = false;
    const exit = await Effect.runPromiseExit(
      withService(
        Effect.gen(function* () {
          const service = yield* AutomationService;
          return yield* service.create({
            projectId: PROJECT_ID,
            title: "Nowhere",
            instructions: "Do something.",
            schedule: dailyAt(9, 0),
          });
        }),
      ),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.pretty(exit.cause)).toContain("no longer exists");
    }
    assert.strictEqual(state.automations.size, 0);
  });

  test("create rejects a one-off in the past", async () => {
    const exit = await Effect.runPromiseExit(
      withService(
        Effect.gen(function* () {
          const service = yield* AutomationService;
          return yield* service.create({
            projectId: PROJECT_ID,
            title: "Yesterday",
            instructions: "Too late.",
            schedule: { kind: "once", at: "2020-01-01T00:00:00.000Z" },
          });
        }),
      ),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    assert.strictEqual(state.automations.size, 0);
  });

  it.effect("run dispatches a thread and a turn with the task's own instructions", () =>
    Effect.gen(function* () {
      const service = yield* AutomationService;
      const created = yield* service.create({
        projectId: PROJECT_ID,
        title: "Weekly review",
        instructions: "Review the week and write reports/week.md.",
        schedule: { kind: "weekly", hour: 18, minute: 0, daysOfWeek: [5] },
        mode: "plan",
      });

      const run = yield* service.run({ automationId: created.automationId });

      assert.strictEqual(run.status, "running");
      assert.strictEqual(state.commands.length, 2);
      const [create, turn] = state.commands as [Record<string, unknown>, Record<string, unknown>];
      assert.strictEqual(create.type, "thread.create");
      assert.strictEqual(create.projectId, PROJECT_ID);
      assert.strictEqual(create.title, "自动化：Weekly review");
      assert.strictEqual(create.interactionMode, "plan");
      assert.strictEqual(create.runtimeMode, "approval-required");
      // No workspace default, so the run takes the model the provider offers — the old
      // behaviour dispatched a constant `pi/default` slug that no install has.
      assert.deepStrictEqual(create.modelSelection, { provider: "pi", model: TEST_MODEL_SLUG });
      assert.strictEqual(turn.type, "thread.turn.start");
      assert.strictEqual(turn.threadId, create.threadId);
      assert.strictEqual(
        (turn.message as { text: string }).text,
        "Review the week and write reports/week.md.",
      );

      // The run points at the conversation it opened, and the plan moved on.
      assert.strictEqual(state.runs[0]!.threadId, run.threadId);
      const automation = state.automations.get(created.automationId)!;
      assert.notStrictEqual(automation.lastRunAt, null);
      assert.isAbove(Date.parse(automation.nextRunAt!), Date.now());
    }).pipe(withService),
  );

  it.effect("run refuses to start a second run of the same task", () =>
    Effect.gen(function* () {
      const service = yield* AutomationService;
      const created = yield* service.create({
        projectId: PROJECT_ID,
        title: "Long running",
        instructions: "Take your time.",
        schedule: dailyAt(3, 0),
      });

      yield* service.run({ automationId: created.automationId });
      const second = yield* service.run({ automationId: created.automationId }).pipe(Effect.exit);

      assert.isTrue(Exit.isFailure(second));
      assert.strictEqual(state.runs.length, 1);
      assert.strictEqual(state.commands.length, 2);
    }).pipe(withService),
  );

  it.effect("a one-off switches itself off once it has run", () =>
    Effect.gen(function* () {
      const service = yield* AutomationService;
      const created = yield* service.create({
        projectId: PROJECT_ID,
        title: "One shot",
        instructions: "Do it once.",
        schedule: { kind: "once", at: new Date(Date.now() + 60_000).toISOString() },
      });

      yield* service.run({ automationId: created.automationId });

      const automation = state.automations.get(created.automationId)!;
      assert.isFalse(automation.isEnabled);
      assert.strictEqual(automation.nextRunAt, null);
    }).pipe(withService),
  );

  it.effect("the sweep runs what is due and rolls a stale trigger forward", () =>
    Effect.gen(function* () {
      const service = yield* AutomationService;
      const due = yield* service.create({
        projectId: PROJECT_ID,
        title: "Due now",
        instructions: "Run me.",
        schedule: dailyAt(9, 0),
      });
      const stale = yield* service.create({
        projectId: PROJECT_ID,
        title: "Missed yesterday",
        instructions: "Skip me.",
        schedule: dailyAt(9, 0),
      });

      const now = Date.now();
      patchAutomation(state, due.automationId, {
        nextRunAt: new Date(now - 60_000).toISOString(),
      });
      patchAutomation(state, stale.automationId, {
        nextRunAt: new Date(now - 8 * 60 * 60 * 1000).toISOString(),
      });

      yield* service.runDue(now);

      assert.strictEqual(state.runs.length, 1);
      assert.strictEqual(state.runs[0]!.automationId, due.automationId);
      assert.strictEqual(state.runs[0]!.trigger, "scheduled");
      assert.isAbove(Date.parse(state.automations.get(stale.automationId)!.nextRunAt!), now);
    }).pipe(withService),
  );

  it.effect("recordRunOutcome closes the run with the conversation's closing message", () =>
    Effect.gen(function* () {
      const service = yield* AutomationService;
      const created = yield* service.create({
        projectId: PROJECT_ID,
        title: "Briefing",
        instructions: "Summarise.",
        schedule: dailyAt(9, 0),
      });
      const run = yield* service.run({ automationId: created.automationId });

      state.threadDetail = Option.some({
        messages: [
          { role: "user", text: "Summarise." },
          { role: "assistant", text: "Earlier answer." },
          { role: "assistant", text: "All clear: 3 commits, nothing blocked." },
        ],
        session: null,
      });

      yield* service.recordRunOutcome({ threadId: run.threadId!, outcome: "succeeded" });

      const stored = state.runs[0]!;
      assert.strictEqual(stored.status, "succeeded");
      assert.strictEqual(stored.summary, "All clear: 3 commits, nothing blocked.");
      assert.notStrictEqual(stored.finishedAt, null);
    }).pipe(withService),
  );

  it.effect("recordRunOutcome reports the session error for a failed run", () =>
    Effect.gen(function* () {
      const service = yield* AutomationService;
      const created = yield* service.create({
        projectId: PROJECT_ID,
        title: "Briefing",
        instructions: "Summarise.",
        schedule: dailyAt(9, 0),
      });
      const run = yield* service.run({ automationId: created.automationId });

      state.threadDetail = Option.some({
        messages: [],
        session: { lastError: "Provider exited with code 1" },
      });

      yield* service.recordRunOutcome({ threadId: run.threadId!, outcome: "failed" });

      const stored = state.runs[0]!;
      assert.strictEqual(stored.status, "failed");
      assert.strictEqual(stored.errorMessage, "Provider exited with code 1");
    }).pipe(withService),
  );

  it.effect("a goal run stays open while the goal still has turns to go", () =>
    Effect.gen(function* () {
      const service = yield* AutomationService;
      const created = yield* service.create({
        projectId: PROJECT_ID,
        title: "Goal task",
        instructions: "Get it done.",
        schedule: dailyAt(9, 0),
        mode: "goal",
      });
      const run = yield* service.run({ automationId: created.automationId });
      const threadId = run.threadId!;
      const conversationId = threadConversationKey(threadId);

      clearGoal(conversationId);
      createGoal(conversationId, { objective: "Finish the export", acceptance: "CSV opens" });
      state.threadDetail = Option.some({ messages: [], session: null });

      yield* service.recordRunOutcome({ threadId, outcome: "succeeded" });
      assert.strictEqual(state.runs[0]!.status, "running");

      // The goal is settled: now the turn boundary really is the end of the run.
      setGoalStatus(conversationId, "complete", "CSV verified");
      yield* service.recordRunOutcome({ threadId, outcome: "succeeded" });
      assert.strictEqual(state.runs[0]!.status, "succeeded");
      clearGoal(conversationId);
    }).pipe(withService),
  );

  it.effect("releaseStaleRuns closes runs left open by a shutdown", () =>
    Effect.gen(function* () {
      const service = yield* AutomationService;
      const created = yield* service.create({
        projectId: PROJECT_ID,
        title: "Interrupted",
        instructions: "Whatever.",
        schedule: dailyAt(9, 0),
      });
      yield* service.run({ automationId: created.automationId });

      yield* service.releaseStaleRuns;

      assert.strictEqual(state.runs[0]!.status, "interrupted");
      assert.match(state.runs[0]!.errorMessage!, /server stopped/);
    }).pipe(withService),
  );

  it.effect("startScheduler and stopScheduler are idempotent", () =>
    Effect.gen(function* () {
      const service = yield* AutomationService;
      yield* service.startScheduler();
      yield* service.startScheduler();
      yield* service.stopScheduler();
      yield* service.stopScheduler();
    }).pipe(withService),
  );

  it.effect("update recomputes the next instant and pauses cleanly", () =>
    Effect.gen(function* () {
      const service = yield* AutomationService;
      const created = yield* service.create({
        projectId: PROJECT_ID,
        title: "Reschedule me",
        instructions: "Work.",
        schedule: dailyAt(9, 0),
        timezone: SHANGHAI,
      });

      const moved = yield* service.update({
        automationId: created.automationId,
        schedule: dailyAt(23, 30),
      });
      const paused = yield* service.update({
        automationId: created.automationId,
        isEnabled: false,
      });
      const resumed = yield* service.update({
        automationId: created.automationId,
        isEnabled: true,
      });

      assert.strictEqual(utcHourOf(moved.nextRunAt), 15);
      assert.strictEqual(paused.nextRunAt, null);
      assert.isFalse(paused.isEnabled);
      assert.strictEqual(utcHourOf(resumed.nextRunAt), 15);
    }).pipe(withService),
  );

  it.effect("listRuns returns the automation's runs up to the limit", () =>
    Effect.gen(function* () {
      const service = yield* AutomationService;
      const created = yield* service.create({
        projectId: PROJECT_ID,
        title: "History",
        instructions: "Work.",
        schedule: dailyAt(9, 0),
      });
      yield* service.run({ automationId: created.automationId });
      patchRun(state, state.runs[0]!.runId, { status: "succeeded" });

      const runs = yield* service.listRuns({ automationId: created.automationId, limit: 5 });
      assert.strictEqual(runs.length, 1);
      assert.strictEqual(runs[0]!.status, "succeeded");
    }).pipe(withService),
  );

  it.effect("delete removes the task and list can span workspaces", () =>
    Effect.gen(function* () {
      const service = yield* AutomationService;
      const first = yield* service.create({
        projectId: PROJECT_ID,
        title: "One",
        instructions: "Work.",
        schedule: dailyAt(9, 0),
      });
      yield* service.create({
        projectId: PROJECT_ID,
        title: "Two",
        instructions: "Work.",
        schedule: dailyAt(10, 0),
      });

      assert.strictEqual((yield* service.list({})).length, 2);
      assert.strictEqual(
        (yield* service.list({ projectId: ProjectId.makeUnsafe("elsewhere") })).length,
        0,
      );

      yield* service.delete({ automationId: first.automationId });
      assert.strictEqual((yield* service.list({})).length, 1);
    }).pipe(withService),
  );
});
