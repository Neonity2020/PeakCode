import { AutomationId, ProjectId, type Automation } from "@peakcode/contracts";
import { assert, it } from "@effect/vitest";
import { Effect, Layer, Option, Stream } from "effect";

import { isAutomationDueNow } from "./AutomationService.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { AutomationRepository } from "../../persistence/Services/Automations.ts";
import { AutomationService } from "../Services/AutomationService.ts";
import { AutomationServiceLive } from "./AutomationService.ts";

const makeAutomation = (overrides: Partial<Automation> = {}): Automation => ({
  automationId: AutomationId.makeUnsafe("automation-daily"),
  projectId: ProjectId.makeUnsafe("project-1"),
  title: "Daily briefing",
  description: "",
  prompt: "Summarize the project.",
  scriptId: null,
  scriptName: null,
  scriptCommand: null,
  scheduleType: "cron",
  cronExpression: "0 8 * * 1-5",
  timezone: "UTC",
  isEnabled: true,
  templateId: null,
  createdAt: "2026-06-22T00:00:00.000Z",
  updatedAt: "2026-06-22T00:00:00.000Z",
  lastRunAt: null,
  ...overrides,
});

it("matches common five-field cron schedules", () => {
  assert.strictEqual(
    isAutomationDueNow(makeAutomation(), new Date("2026-06-22T08:00:00.000Z")),
    true,
  );
  assert.strictEqual(
    isAutomationDueNow(makeAutomation(), new Date("2026-06-22T08:01:00.000Z")),
    false,
  );
});

it("does not run disabled, manual, or already-run automations", () => {
  const now = new Date("2026-06-22T08:00:00.000Z");
  assert.strictEqual(isAutomationDueNow(makeAutomation({ isEnabled: false }), now), false);
  assert.strictEqual(
    isAutomationDueNow(makeAutomation({ scheduleType: "manual", cronExpression: null }), now),
    false,
  );
  assert.strictEqual(
    isAutomationDueNow(makeAutomation({ lastRunAt: "2026-06-22T08:00:10.000Z" }), now),
    false,
  );
});

const schedulerLayer = it.layer(
  AutomationServiceLive.pipe(
    Layer.provide(
      Layer.succeed(
        AutomationRepository,
        AutomationRepository.of({
          getById: () => Effect.die("not used"),
          listByProjectId: () => Effect.succeed([]),
          listEnabledCron: () => Effect.succeed([]),
          create: () => Effect.die("not used"),
          update: () => Effect.die("not used"),
          delete: () => Effect.void,
          listRuns: () => Effect.succeed([]),
          createRun: () => Effect.die("not used"),
          updateRun: () => Effect.void,
          updateLastRunAt: () => Effect.void,
        }),
      ),
    ),
    Layer.provide(
      Layer.succeed(
        OrchestrationEngineService,
        OrchestrationEngineService.of({
          readEvents: () => Stream.empty,
          getReadModel: () => Effect.die("not used"),
          dispatch: () => Effect.die("not used"),
          repairState: () => Effect.die("not used"),
          streamDomainEvents: Stream.empty,
        }),
      ),
    ),
    Layer.provide(
      Layer.succeed(
        ProjectionSnapshotQuery,
        ProjectionSnapshotQuery.of({
          getCommandReadModel: () => Effect.die("not used"),
          getSnapshot: () => Effect.die("not used"),
          getCounts: () => Effect.die("not used"),
          getSnapshotSequence: () => Effect.die("not used"),
          getShellSnapshot: () => Effect.die("not used"),
          getActiveProjectByWorkspaceRoot: () => Effect.succeed(Option.none()),
          getProjectShellById: () => Effect.succeed(Option.none()),
          getFirstActiveThreadIdByProjectId: () => Effect.succeed(Option.none()),
          getThreadCheckpointContext: () => Effect.succeed(Option.none()),
          getFullThreadDiffContext: () => Effect.succeed(Option.none()),
          getThreadShellById: () => Effect.succeed(Option.none()),
          findSyntheticSubagentParentThread: () => Effect.succeed(Option.none()),
          getThreadDetailById: () => Effect.succeed(Option.none()),
          getThreadDetailSnapshotById: () => Effect.succeed(Option.none()),
        }),
      ),
    ),
  ),
);

schedulerLayer("AutomationService scheduler", (it) => {
  it.effect("starts and stops without due automations", () =>
    Effect.gen(function* () {
      const service = yield* AutomationService;
      yield* service.startScheduler();
      yield* service.stopScheduler();
    }),
  );
});
