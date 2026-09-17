/**
 * The agent's `schedule_task` bridge: how tool arguments become a plan, and what the model
 * is told back. These are the cases the model gets wrong in practice (a weekly plan with no
 * weekdays, a one-off with no time), so each one has to come back as something it can fix.
 */
import { Effect, Layer, Option } from "effect";
import { describe, expect, test } from "vitest";

import {
  ProjectId,
  ThreadId,
  type Automation,
  type AutomationSchedule,
  type CreateAutomationInput,
} from "@peakcode/contracts";

import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { AutomationService } from "./Services/AutomationService.ts";
import { makeAutomationToolHost, scheduleFromToolParams } from "./automationTool.ts";

const THREAD_ID = ThreadId.makeUnsafe("thread_1");
const PROJECT_ID = ProjectId.makeUnsafe("project_1");

const textOf = (outcome: { content: { text: string }[] }) => outcome.content[0]!.text;

describe("scheduleFromToolParams", () => {
  test("reads a once plan from an ISO instant", () => {
    expect(
      scheduleFromToolParams({ op: "create", schedule_kind: "once", at: "2026-05-01T09:00:00Z" }),
    ).toEqual({ kind: "once", at: "2026-05-01T09:00:00.000Z" });
  });

  test("asks for the missing time instead of scheduling at midnight", () => {
    expect(scheduleFromToolParams({ op: "create", schedule_kind: "once" })).toContain("`at`");
    expect(
      scheduleFromToolParams({ op: "create", schedule_kind: "once", at: "tomorrow-ish" }),
    ).toContain("not a readable time");
    expect(scheduleFromToolParams({ op: "create", schedule_kind: "daily" })).toContain("`hour`");
    expect(scheduleFromToolParams({ op: "create", schedule_kind: "daily", hour: 25 })).toContain(
      "`hour`",
    );
    expect(scheduleFromToolParams({ op: "create", schedule_kind: "weekly", hour: 9 })).toContain(
      "days_of_week",
    );
  });

  test("defaults the minute and normalises the weekdays", () => {
    expect(scheduleFromToolParams({ op: "create", schedule_kind: "daily", hour: 7 })).toEqual({
      kind: "daily",
      hour: 7,
      minute: 0,
    });
    expect(
      scheduleFromToolParams({
        op: "create",
        schedule_kind: "weekly",
        hour: 18,
        minute: 30,
        days_of_week: [5, 1, 1, 9],
      }),
    ).toEqual({ kind: "weekly", hour: 18, minute: 30, daysOfWeek: [1, 5] });
  });

  test("rejects an unknown plan kind", () => {
    expect(scheduleFromToolParams({ op: "create", schedule_kind: "hourly" })).toContain(
      "once, daily or weekly",
    );
  });
});

interface StubState {
  readonly created: Array<CreateAutomationInput>;
  readonly updates: Array<{
    readonly automationId: string;
    readonly isEnabled?: boolean | undefined;
  }>;
  readonly automations: Array<Automation>;
}

const makeHost = (state: StubState) => {
  const automationService = AutomationService.of({
    getById: () => Effect.die("not used"),
    list: () => Effect.succeed(state.automations),
    create: (input: CreateAutomationInput) => {
      state.created.push(input);
      const automation = {
        automationId: "automation_1",
        projectId: input.projectId,
        title: input.title,
        instructions: input.instructions,
        schedule: input.schedule,
        timezone: input.timezone ?? "Asia/Shanghai",
        mode: input.mode ?? "default",
        isEnabled: true,
        nextRunAt: "2026-05-02T01:00:00.000Z",
        lastRunAt: null,
        lastRunStatus: null,
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-01T00:00:00.000Z",
      } as Automation;
      return Effect.succeed(automation);
    },
    update: (input) => {
      state.updates.push({ automationId: input.automationId, isEnabled: input.isEnabled });
      const existing = state.automations[0]!;
      return Effect.succeed({ ...existing, isEnabled: input.isEnabled ?? existing.isEnabled });
    },
    delete: () => Effect.void,
    run: () => Effect.die("not used"),
    listRuns: () => Effect.succeed([]),
    recordRunOutcome: () => Effect.void,
    releaseStaleRuns: Effect.void,
    runDue: () => Effect.void,
    startScheduler: () => Effect.void,
    stopScheduler: () => Effect.void,
  });

  const projection = ProjectionSnapshotQuery.of({
    getCommandReadModel: () => Effect.die("not used"),
    getSnapshot: () => Effect.die("not used"),
    getCounts: () => Effect.die("not used"),
    getSnapshotSequence: () => Effect.die("not used"),
    getShellSnapshot: () => Effect.die("not used"),
    getActiveProjectByWorkspaceRoot: () => Effect.succeed(Option.none()),
    getProjectShellById: () =>
      Effect.succeed(
        Option.some({
          workspaceRoot: "/tmp/peakcode",
          title: "PeakCode",
        } as never),
      ),
    getFirstActiveThreadIdByProjectId: () => Effect.succeed(Option.none()),
    getThreadCheckpointContext: () => Effect.succeed(Option.none()),
    getFullThreadDiffContext: () => Effect.succeed(Option.none()),
    getThreadShellById: () =>
      Effect.succeed(Option.some({ id: THREAD_ID, projectId: PROJECT_ID } as never)),
    findSyntheticSubagentParentThread: () => Effect.succeed(Option.none()),
    getThreadDetailById: () => Effect.succeed(Option.none()),
    getThreadDetailSnapshotById: () => Effect.succeed(Option.none()),
  });

  return Effect.runPromise(
    makeAutomationToolHost.pipe(
      Effect.provide(
        Layer.merge(
          Layer.succeed(AutomationService, automationService),
          Layer.succeed(ProjectionSnapshotQuery, projection),
        ),
      ),
    ),
  );
};

const emptyState = (): StubState => ({ created: [], updates: [], automations: [] });

describe("the schedule_task host", () => {
  test("creates the task in the workspace the conversation lives in", async () => {
    const state = emptyState();
    const host = await makeHost(state);

    const outcome = await host.scheduleTask({
      threadId: THREAD_ID,
      params: {
        op: "create",
        title: "Morning briefing",
        instructions: "Summarise yesterday's commits into reports/daily.md.",
        schedule_kind: "daily",
        hour: 9,
        minute: 0,
      },
    });

    expect(state.created).toHaveLength(1);
    expect(state.created[0]).toMatchObject({
      projectId: PROJECT_ID,
      title: "Morning briefing",
      schedule: { kind: "daily", hour: 9, minute: 0 } satisfies AutomationSchedule,
      mode: "default",
    });
    // The reply has to carry the id and the next instant: the user asks "when will I see it".
    expect(textOf(outcome)).toContain("Morning briefing");
    expect(textOf(outcome)).toContain("automation_1");
    expect(textOf(outcome)).toContain("2026-05-02T01:00:00.000Z");
    expect(textOf(outcome)).toContain("/tmp/peakcode");
  });

  test("reports an unusable request without creating anything", async () => {
    const state = emptyState();
    const host = await makeHost(state);

    const noTitle = await host.scheduleTask({
      threadId: THREAD_ID,
      params: { op: "create", instructions: "Do something." },
    });
    const noSchedule = await host.scheduleTask({
      threadId: THREAD_ID,
      params: { op: "create", title: "X", instructions: "Do something.", schedule_kind: "hourly" },
    });
    const unknownOp = await host.scheduleTask({ threadId: THREAD_ID, params: { op: "delete" } });

    expect(state.created).toHaveLength(0);
    expect(textOf(noTitle)).toContain("title");
    expect(textOf(noSchedule)).toContain("once, daily or weekly");
    expect(textOf(unknownOp)).toContain("op");
  });

  test("pauses a task by id", async () => {
    const state = emptyState();
    state.automations.push({
      automationId: "automation_1",
      title: "Morning briefing",
      isEnabled: true,
      nextRunAt: null,
    } as Automation);
    const host = await makeHost(state);

    const outcome = await host.scheduleTask({
      threadId: THREAD_ID,
      params: { op: "set_enabled", automation_id: "automation_1", enabled: false },
    });

    expect(state.updates).toEqual([{ automationId: "automation_1", isEnabled: false }]);
    expect(textOf(outcome)).toContain("paused");
  });

  test("lists what is scheduled when there is nothing yet", async () => {
    const host = await makeHost(emptyState());
    const outcome = await host.scheduleTask({ threadId: THREAD_ID, params: { op: "list" } });
    expect(textOf(outcome)).toContain("No scheduled tasks");
  });
});
