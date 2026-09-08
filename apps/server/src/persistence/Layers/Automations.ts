import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { Effect, Layer, Option, Schema, Struct } from "effect";
import * as SchemaGetter from "effect/SchemaGetter";

import { PersistenceSqlError, toPersistenceSqlError } from "../Errors.ts";
import { AutomationRepository, type AutomationRepositoryShape } from "../Services/Automations.ts";
import {
  Automation,
  AutomationId,
  AutomationRun,
  AutomationRunId,
  CreateAutomationInput,
  DeleteAutomationInput,
  GetAutomationInput,
  ListAutomationRunsInput,
  ListAutomationsInput,
  UpdateAutomationInput,
} from "@peakcode/contracts";

const SqliteBoolean = Schema.Number.pipe(
  Schema.decodeTo(Schema.Boolean, {
    decode: SchemaGetter.transform((value) => value !== 0),
    encode: SchemaGetter.transform((value) => (value ? 1 : 0)),
  }),
);

const AutomationDbRow = Automation.mapFields(
  Struct.assign({
    isEnabled: SqliteBoolean,
  }),
);

const automationNotFound = (automationId: AutomationId) =>
  new PersistenceSqlError({
    operation: "AutomationRepository.getById:notFound",
    detail: `Automation '${automationId}' was not found.`,
  });

const makeAutomationRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const getAutomationByIdOption = SqlSchema.findOneOption({
    Request: GetAutomationInput,
    Result: AutomationDbRow,
    execute: ({ automationId }) =>
      sql`
        SELECT
          automation_id AS "automationId",
          project_id AS "projectId",
          title,
          description,
          prompt,
          script_id AS "scriptId",
          script_name AS "scriptName",
          script_command AS "scriptCommand",
          schedule_type AS "scheduleType",
          cron_expression AS "cronExpression",
          timezone,
          is_enabled AS "isEnabled",
          template_id AS "templateId",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          last_run_at AS "lastRunAt"
        FROM automations
        WHERE automation_id = ${automationId}
      `,
  });

  const listAutomationsByProjectIdRows = SqlSchema.findAll({
    Request: ListAutomationsInput,
    Result: AutomationDbRow,
    execute: ({ projectId }) =>
      sql`
        SELECT
          automation_id AS "automationId",
          project_id AS "projectId",
          title,
          description,
          prompt,
          script_id AS "scriptId",
          script_name AS "scriptName",
          script_command AS "scriptCommand",
          schedule_type AS "scheduleType",
          cron_expression AS "cronExpression",
          timezone,
          is_enabled AS "isEnabled",
          template_id AS "templateId",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          last_run_at AS "lastRunAt"
        FROM automations
        WHERE project_id = ${projectId}
        ORDER BY created_at DESC, automation_id ASC
      `,
  });

  const listEnabledCronRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: AutomationDbRow,
    execute: () =>
      sql`
        SELECT
          automation_id AS "automationId",
          project_id AS "projectId",
          title,
          description,
          prompt,
          script_id AS "scriptId",
          script_name AS "scriptName",
          script_command AS "scriptCommand",
          schedule_type AS "scheduleType",
          cron_expression AS "cronExpression",
          timezone,
          is_enabled AS "isEnabled",
          template_id AS "templateId",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          last_run_at AS "lastRunAt"
        FROM automations
        WHERE is_enabled = 1
          AND schedule_type = 'cron'
          AND cron_expression IS NOT NULL
        ORDER BY created_at ASC, automation_id ASC
      `,
  });

  const insertAutomation = SqlSchema.void({
    Request: AutomationDbRow,
    execute: (automation) =>
      sql`
        INSERT INTO automations (
          automation_id,
          project_id,
          title,
          description,
          prompt,
          script_id,
          script_name,
          script_command,
          schedule_type,
          cron_expression,
          timezone,
          is_enabled,
          template_id,
          created_at,
          updated_at,
          last_run_at
        )
        VALUES (
          ${automation.automationId},
          ${automation.projectId},
          ${automation.title},
          ${automation.description},
          ${automation.prompt},
          ${automation.scriptId},
          ${automation.scriptName},
          ${automation.scriptCommand},
          ${automation.scheduleType},
          ${automation.cronExpression},
          ${automation.timezone},
          ${automation.isEnabled ? 1 : 0},
          ${automation.templateId},
          ${automation.createdAt},
          ${automation.updatedAt},
          ${automation.lastRunAt}
        )
      `,
  });

  const updateAutomationRow = SqlSchema.void({
    Request: AutomationDbRow,
    execute: (automation) =>
      sql`
        UPDATE automations
        SET
          title = ${automation.title},
          description = ${automation.description},
          prompt = ${automation.prompt},
          script_id = ${automation.scriptId},
          script_name = ${automation.scriptName},
          script_command = ${automation.scriptCommand},
          schedule_type = ${automation.scheduleType},
          cron_expression = ${automation.cronExpression},
          timezone = ${automation.timezone},
          is_enabled = ${automation.isEnabled ? 1 : 0},
          template_id = ${automation.templateId},
          updated_at = ${automation.updatedAt},
          last_run_at = ${automation.lastRunAt}
        WHERE automation_id = ${automation.automationId}
      `,
  });

  const deleteAutomationRow = SqlSchema.void({
    Request: DeleteAutomationInput,
    execute: ({ automationId }) =>
      sql`
        DELETE FROM automations
        WHERE automation_id = ${automationId}
      `,
  });

  const listAutomationRunsRows = SqlSchema.findAll({
    Request: ListAutomationRunsInput,
    Result: AutomationRun,
    execute: ({ automationId }) =>
      sql`
        SELECT
          run_id AS "runId",
          automation_id AS "automationId",
          status,
          started_at AS "startedAt",
          completed_at AS "completedAt",
          error_message AS "errorMessage",
          thread_id AS "threadId",
          result_summary AS "resultSummary"
        FROM automation_runs
        WHERE automation_id = ${automationId}
        ORDER BY started_at DESC, run_id ASC
        LIMIT 10
      `,
  });

  const insertRun = SqlSchema.void({
    Request: AutomationRun,
    execute: (run) =>
      sql`
        INSERT INTO automation_runs (
          run_id,
          automation_id,
          status,
          started_at,
          completed_at,
          error_message,
          thread_id,
          result_summary
        )
        VALUES (
          ${run.runId},
          ${run.automationId},
          ${run.status},
          ${run.startedAt},
          ${run.completedAt},
          ${run.errorMessage},
          ${run.threadId},
          ${run.resultSummary}
        )
      `,
  });

  const updateRunRow = SqlSchema.void({
    Request: AutomationRun,
    execute: (run) =>
      sql`
        UPDATE automation_runs
        SET
          status = ${run.status},
          completed_at = ${run.completedAt},
          error_message = ${run.errorMessage},
          thread_id = ${run.threadId},
          result_summary = ${run.resultSummary}
        WHERE run_id = ${run.runId}
      `,
  });

  const getAutomationById: AutomationRepositoryShape["getById"] = (input) =>
    getAutomationByIdOption(input).pipe(
      Effect.mapError(toPersistenceSqlError("AutomationRepository.getById:query")),
      Effect.flatMap((automationOption) =>
        Option.match(automationOption, {
          onNone: () => Effect.fail(automationNotFound(input.automationId)),
          onSome: (automation) => Effect.succeed(automation),
        }),
      ),
    );

  const listByProjectId: AutomationRepositoryShape["listByProjectId"] = (input) =>
    listAutomationsByProjectIdRows(input).pipe(
      Effect.mapError(toPersistenceSqlError("AutomationRepository.listByProjectId:query")),
    );

  const listEnabledCron: AutomationRepositoryShape["listEnabledCron"] = () =>
    listEnabledCronRows(undefined).pipe(
      Effect.mapError(toPersistenceSqlError("AutomationRepository.listEnabledCron:query")),
    );

  const create: AutomationRepositoryShape["create"] = (input) =>
    Effect.gen(function* () {
      const now = new Date().toISOString();
      const automation = {
        automationId: AutomationId.makeUnsafe(
          `automation_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        ),
        projectId: input.projectId,
        title: input.title,
        description: input.description,
        prompt: input.prompt,
        scriptId: input.scriptId ?? null,
        scriptName: input.scriptName ?? null,
        scriptCommand: input.scriptCommand ?? null,
        scheduleType: input.scheduleType,
        cronExpression: input.cronExpression,
        timezone: input.timezone,
        isEnabled: true,
        templateId: input.templateId,
        createdAt: now,
        updatedAt: now,
        lastRunAt: null,
      } satisfies Automation;

      yield* insertAutomation(automation).pipe(
        Effect.mapError(toPersistenceSqlError("AutomationRepository.create:query")),
      );
      return automation;
    });

  const update: AutomationRepositoryShape["update"] = (input) =>
    Effect.gen(function* () {
      const existing = yield* getAutomationById({ automationId: input.automationId });
      const updated = {
        ...existing,
        title: input.title ?? existing.title,
        description: input.description ?? existing.description,
        prompt: input.prompt ?? existing.prompt,
        scriptId: input.scriptId !== undefined ? input.scriptId : existing.scriptId,
        scriptName: input.scriptName !== undefined ? input.scriptName : existing.scriptName,
        scriptCommand:
          input.scriptCommand !== undefined ? input.scriptCommand : existing.scriptCommand,
        scheduleType: input.scheduleType ?? existing.scheduleType,
        cronExpression:
          input.cronExpression !== undefined ? input.cronExpression : existing.cronExpression,
        timezone: input.timezone ?? existing.timezone,
        isEnabled: input.isEnabled ?? existing.isEnabled,
        updatedAt: new Date().toISOString(),
      } satisfies Automation;

      yield* updateAutomationRow(updated).pipe(
        Effect.mapError(toPersistenceSqlError("AutomationRepository.update:query")),
      );
      return updated;
    });

  const deleteById: AutomationRepositoryShape["delete"] = (input) =>
    deleteAutomationRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("AutomationRepository.delete:query")),
    );

  const listRuns: AutomationRepositoryShape["listRuns"] = (input) =>
    listAutomationRunsRows(input).pipe(
      Effect.mapError(toPersistenceSqlError("AutomationRepository.listRuns:query")),
    );

  const createRun: AutomationRepositoryShape["createRun"] = (automationId, status) =>
    Effect.gen(function* () {
      const now = new Date().toISOString();
      const run = {
        runId: AutomationRunId.makeUnsafe(
          `run_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        ),
        automationId,
        status,
        startedAt: now,
        completedAt: null,
        errorMessage: null,
        threadId: null,
        resultSummary: null,
      } satisfies AutomationRun;

      yield* insertRun(run).pipe(
        Effect.mapError(toPersistenceSqlError("AutomationRepository.createRun:query")),
      );
      return run;
    });

  const getRunByIdOption = SqlSchema.findOneOption({
    Request: Schema.Struct({ runId: AutomationRunId }),
    Result: AutomationRun,
    execute: ({ runId }) =>
      sql`
        SELECT
          run_id AS "runId",
          automation_id AS "automationId",
          status,
          started_at AS "startedAt",
          completed_at AS "completedAt",
          error_message AS "errorMessage",
          thread_id AS "threadId",
          result_summary AS "resultSummary"
        FROM automation_runs
        WHERE run_id = ${runId}
      `,
  });

  const updateRun: AutomationRepositoryShape["updateRun"] = (runId, status, options) =>
    Effect.gen(function* () {
      const existingOption = yield* getRunByIdOption({ runId }).pipe(
        Effect.mapError(toPersistenceSqlError("AutomationRepository.updateRun:get")),
      );
      const existing = Option.getOrUndefined(existingOption);
      if (existing === undefined) {
        return yield* new PersistenceSqlError({
          operation: "AutomationRepository.updateRun:notFound",
          detail: `Automation run '${runId}' was not found.`,
        });
      }

      yield* updateRunRow({
        ...existing,
        status,
        completedAt: new Date().toISOString(),
        errorMessage: options?.errorMessage ?? existing.errorMessage,
        threadId: options?.threadId ?? existing.threadId,
        resultSummary: options?.resultSummary ?? existing.resultSummary,
      }).pipe(Effect.mapError(toPersistenceSqlError("AutomationRepository.updateRun:query")));
    });

  const updateLastRunAt: AutomationRepositoryShape["updateLastRunAt"] = (automationId, lastRunAt) =>
    sql`
      UPDATE automations
      SET last_run_at = ${lastRunAt}, updated_at = ${lastRunAt}
      WHERE automation_id = ${automationId}
    `.pipe(Effect.mapError(toPersistenceSqlError("AutomationRepository.updateLastRunAt:query")));

  return AutomationRepository.of({
    getById: getAutomationById,
    listByProjectId,
    listEnabledCron,
    create,
    update,
    delete: deleteById,
    listRuns,
    createRun,
    updateRun,
    updateLastRunAt,
  });
});

export const AutomationRepositoryLive = Layer.effect(
  AutomationRepository,
  makeAutomationRepository,
);
