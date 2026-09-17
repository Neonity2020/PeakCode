import { AutomationId, ProjectId, ThreadId } from "@peakcode/contracts";
import { assert, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";

import { AutomationRepository, type AutomationWrite } from "../Services/Automations.ts";
import { ProjectionProjectRepository } from "../Services/ProjectionProjects.ts";
import { AutomationRepositoryLive } from "./Automations.ts";
import { ProjectionProjectRepositoryLive } from "./ProjectionProjects.ts";
import { SqlitePersistenceMemory } from "./Sqlite.ts";

const layer = it.layer(
  Layer.mergeAll(
    AutomationRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
    ProjectionProjectRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
    SqlitePersistenceMemory,
  ),
);

const PROJECT_ID = ProjectId.makeUnsafe("project-automations");
const OTHER_PROJECT_ID = ProjectId.makeUnsafe("project-other");
const NOW = "2026-06-22T00:00:00.000Z";

const writeOf = (
  automationId: string,
  overrides: Partial<AutomationWrite> = {},
): AutomationWrite => ({
  automationId: AutomationId.makeUnsafe(automationId),
  projectId: PROJECT_ID,
  title: "Morning briefing",
  instructions: "Summarise yesterday's commits.",
  schedule: { kind: "daily", hour: 9, minute: 0 },
  timezone: "Asia/Shanghai",
  mode: "default",
  isEnabled: true,
  nextRunAt: "2026-06-23T01:00:00.000Z",
  lastRunAt: null,
  createdAt: NOW,
  updatedAt: NOW,
  ...overrides,
});

/**
 * The layer's database is shared by every test in this file, so each one works in its own
 * workspace and cleans up the tasks it created.
 */
const seedWorkspace = (projectId: ProjectId, workspaceRoot: string) =>
  Effect.gen(function* () {
    const projects = yield* ProjectionProjectRepository;
    yield* projects.upsert({
      projectId,
      kind: "project",
      title: "Automation Project",
      workspaceRoot,
      defaultModelSelection: null,
      scripts: [],
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
    });
  });

const clearAutomations = (projectId: ProjectId) =>
  Effect.gen(function* () {
    const automations = yield* AutomationRepository;
    const existing = yield* automations.list({ projectId });
    yield* Effect.forEach(
      existing,
      (automation) => automations.delete({ automationId: automation.automationId }),
      { discard: true },
    );
  });

layer("AutomationRepository", (it) => {
  it.effect("round-trips a task's plan and scheduling state", () =>
    Effect.gen(function* () {
      const automations = yield* AutomationRepository;
      yield* seedWorkspace(PROJECT_ID, "/tmp/project-automations");

      const created = yield* automations.create(writeOf("automation-1"));
      assert.strictEqual(created.title, "Morning briefing");
      assert.deepStrictEqual(created.schedule, { kind: "daily", hour: 9, minute: 0 });
      assert.strictEqual(created.lastRunStatus, null);

      const read = yield* automations.getById({
        automationId: AutomationId.makeUnsafe("automation-1"),
      });
      assert.deepStrictEqual(read.schedule, { kind: "daily", hour: 9, minute: 0 });
      assert.strictEqual(read.nextRunAt, "2026-06-23T01:00:00.000Z");
      assert.isTrue(read.isEnabled);
    }),
  );

  it.effect("lists across workspaces and filters by one", () =>
    Effect.gen(function* () {
      const automations = yield* AutomationRepository;
      yield* seedWorkspace(PROJECT_ID, "/tmp/project-automations");

      yield* seedWorkspace(OTHER_PROJECT_ID, "/tmp/project-other");
      yield* clearAutomations(PROJECT_ID);
      yield* clearAutomations(OTHER_PROJECT_ID);
      yield* automations.create(writeOf("automation-a"));
      yield* automations.create(writeOf("automation-b", { title: "Second" }));
      yield* automations.create(
        writeOf("automation-c", { projectId: OTHER_PROJECT_ID, title: "Elsewhere" }),
      );

      const scoped = yield* automations.list({ projectId: PROJECT_ID });
      const elsewhere = yield* automations.list({ projectId: OTHER_PROJECT_ID });
      assert.deepStrictEqual(scoped.map((automation) => automation.title).toSorted(), [
        "Morning briefing",
        "Second",
      ]);
      assert.deepStrictEqual(
        elsewhere.map((automation) => automation.title),
        ["Elsewhere"],
      );
    }),
  );

  it.effect("only offers due, enabled tasks to the scheduler", () =>
    Effect.gen(function* () {
      const automations = yield* AutomationRepository;
      yield* seedWorkspace(PROJECT_ID, "/tmp/project-automations");

      yield* automations.create(
        writeOf("automation-due", { nextRunAt: "2026-06-22T01:00:00.000Z" }),
      );
      yield* automations.create(
        writeOf("automation-later", { nextRunAt: "2026-06-24T01:00:00.000Z" }),
      );
      yield* automations.create(
        writeOf("automation-paused", { nextRunAt: null, isEnabled: false }),
      );

      const due = yield* automations.listDue("2026-06-22T02:00:00.000Z");
      assert.deepStrictEqual(
        due.map((automation) => automation.automationId),
        ["automation-due"],
      );
    }),
  );

  it.effect("keeps one running run per task and per conversation", () =>
    Effect.gen(function* () {
      const automations = yield* AutomationRepository;
      yield* seedWorkspace(PROJECT_ID, "/tmp/project-automations");
      const automationId = AutomationId.makeUnsafe("automation-2");
      const threadId = ThreadId.makeUnsafe("thread-1");
      yield* automations.create(writeOf("automation-2"));

      const run = yield* automations.createRun({ automationId, trigger: "scheduled" });
      assert.strictEqual(run.status, "running");
      assert.isTrue(
        Option.isNone(yield* automations.runningRunForThread(threadId)),
        "a run without a thread cannot be found by thread",
      );

      yield* automations.attachRunThread({ runId: run.runId, threadId });
      const found = yield* automations.runningRunForThread(threadId);
      assert.isTrue(Option.isSome(found));
      assert.strictEqual(Option.getOrThrow(found).runId, run.runId);

      const byTask = yield* automations.runningRunForAutomation(automationId);
      assert.strictEqual(Option.getOrThrow(byTask).threadId, threadId);

      yield* automations.finishRun({
        runId: run.runId,
        status: "succeeded",
        summary: "All clear.",
      });

      assert.isTrue(Option.isNone(yield* automations.runningRunForThread(threadId)));
      const runs = yield* automations.listRuns({ automationId, limit: 10 });
      assert.strictEqual(runs[0]!.status, "succeeded");
      assert.strictEqual(runs[0]!.summary, "All clear.");
      assert.notStrictEqual(runs[0]!.finishedAt, null);

      // The newest run's status rides along on the task, which is what the list card shows.
      const automation = yield* automations.getById({ automationId });
      assert.strictEqual(automation.lastRunStatus, "succeeded");
    }),
  );

  it.effect("releaseStaleRuns closes everything still marked running", () =>
    Effect.gen(function* () {
      const automations = yield* AutomationRepository;
      yield* seedWorkspace(PROJECT_ID, "/tmp/project-automations");
      const automationId = AutomationId.makeUnsafe("automation-3");
      yield* automations.create(writeOf("automation-3"));
      yield* automations.createRun({ automationId, trigger: "manual" });

      yield* automations.finishRunningRuns({
        status: "interrupted",
        errorMessage: "The server stopped while this run was in flight.",
      });

      const runs = yield* automations.listRuns({ automationId, limit: 10 });
      assert.strictEqual(runs[0]!.status, "interrupted");
      assert.notStrictEqual(runs[0]!.finishedAt, null);
      assert.isTrue(Option.isNone(yield* automations.runningRunForAutomation(automationId)));
    }),
  );

  it.effect("saveScheduleState moves the plan without touching the instructions", () =>
    Effect.gen(function* () {
      const automations = yield* AutomationRepository;
      yield* seedWorkspace(PROJECT_ID, "/tmp/project-automations");
      const automationId = AutomationId.makeUnsafe("automation-4");
      yield* automations.create(writeOf("automation-4"));

      yield* automations.saveScheduleState({
        automationId,
        nextRunAt: null,
        isEnabled: false,
        lastRunAt: "2026-06-22T09:00:00.000Z",
        updatedAt: "2026-06-22T09:00:00.000Z",
      });

      const automation = yield* automations.getById({ automationId });
      assert.strictEqual(automation.nextRunAt, null);
      assert.strictEqual(automation.lastRunAt, "2026-06-22T09:00:00.000Z");
      assert.isFalse(automation.isEnabled);
      assert.strictEqual(automation.instructions, "Summarise yesterday's commits.");
    }),
  );

  it.effect("deleting a task takes its runs with it", () =>
    Effect.gen(function* () {
      const automations = yield* AutomationRepository;
      yield* seedWorkspace(PROJECT_ID, "/tmp/project-automations");
      yield* clearAutomations(PROJECT_ID);
      const automationId = AutomationId.makeUnsafe("automation-5");
      yield* automations.create(writeOf("automation-5"));
      yield* automations.createRun({ automationId, trigger: "manual" });

      yield* automations.delete({ automationId });

      assert.strictEqual((yield* automations.list({ projectId: PROJECT_ID })).length, 0);
      assert.strictEqual((yield* automations.listRuns({ automationId, limit: 10 })).length, 0);
    }),
  );
});
