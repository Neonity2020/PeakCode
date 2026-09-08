import { ProjectId } from "@peakcode/contracts";
import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { AutomationRepository } from "../Services/Automations.ts";
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

layer("AutomationRepository", (it) => {
  it.effect("creates, updates, and lists automations and runs", () =>
    Effect.gen(function* () {
      const automations = yield* AutomationRepository;
      const projects = yield* ProjectionProjectRepository;
      const projectId = ProjectId.makeUnsafe("project-automations");
      const now = "2026-06-22T00:00:00.000Z";

      yield* projects.upsert({
        projectId,
        kind: "project",
        title: "Automation Project",
        workspaceRoot: "/tmp/project-automations",
        defaultModelSelection: null,
        scripts: [],
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });

      const created = yield* automations.create({
        projectId,
        title: "Daily briefing",
        description: "",
        prompt: "Summarize project activity.",
        scriptId: "daily-briefing",
        scriptName: "Daily briefing",
        scriptCommand: 'codex exec --skip-git-repo-check "Summarize project activity."',
        scheduleType: "cron",
        cronExpression: "0 8 * * 1-5",
        timezone: "UTC",
        templateId: null,
      });

      assert.strictEqual(created.projectId, projectId);
      assert.strictEqual(created.isEnabled, true);
      assert.strictEqual(created.scriptId, "daily-briefing");
      assert.strictEqual(created.scriptName, "Daily briefing");
      assert.strictEqual(
        created.scriptCommand,
        'codex exec --skip-git-repo-check "Summarize project activity."',
      );

      const listed = yield* automations.listByProjectId({ projectId });
      assert.strictEqual(listed.length, 1);
      assert.strictEqual(listed[0]?.automationId, created.automationId);

      const enabledCron = yield* automations.listEnabledCron();
      assert.strictEqual(enabledCron.length, 1);
      assert.strictEqual(enabledCron[0]?.automationId, created.automationId);

      const updated = yield* automations.update({
        automationId: created.automationId,
        title: "Updated briefing",
        scriptCommand: 'codex exec --skip-git-repo-check "Updated briefing."',
        isEnabled: false,
      });
      assert.strictEqual(updated.title, "Updated briefing");
      assert.strictEqual(updated.isEnabled, false);
      assert.strictEqual(
        updated.scriptCommand,
        'codex exec --skip-git-repo-check "Updated briefing."',
      );

      yield* automations.updateLastRunAt(created.automationId, "2026-06-22T08:00:00.000Z");
      const withLastRun = yield* automations.getById({ automationId: created.automationId });
      assert.strictEqual(withLastRun.lastRunAt, "2026-06-22T08:00:00.000Z");

      const run = yield* automations.createRun(created.automationId, "running");
      yield* automations.updateRun(run.runId, "completed", {
        resultSummary: "Started automation thread",
      });

      const runs = yield* automations.listRuns({ automationId: created.automationId });
      assert.strictEqual(runs.length, 1);
      assert.strictEqual(runs[0]?.status, "completed");
      assert.strictEqual(runs[0]?.resultSummary, "Started automation thread");
    }),
  );
});
