import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { Effect, Layer, Option, Schema, Struct } from "effect";
import * as SchemaGetter from "effect/SchemaGetter";

import { PersistenceSqlError, toPersistenceSqlError } from "../Errors.ts";
import {
  AutomationRepository,
  type AutomationRepositoryShape,
  type AutomationWrite,
} from "../Services/Automations.ts";
import {
  Automation,
  AutomationId,
  AutomationRun,
  AutomationRunId,
  AutomationSchedule,
  ProjectId,
  ThreadId,
} from "@peakcode/contracts";

const SqliteBoolean = Schema.Number.pipe(
  Schema.decodeTo(Schema.Boolean, {
    decode: SchemaGetter.transform((value) => value !== 0),
    encode: SchemaGetter.transform((value) => (value ? 1 : 0)),
  }),
);

const AutomationDbRow = Automation.mapFields(
  Struct.assign({
    schedule: Schema.fromJsonString(AutomationSchedule),
    isEnabled: SqliteBoolean,
  }),
);
type AutomationDbRow = typeof AutomationDbRow.Type;

const automationNotFound = (automationId: AutomationId) =>
  new PersistenceSqlError({
    operation: "AutomationRepository.getById:notFound",
    detail: `Automation '${automationId}' was not found.`,
  });

/**
 * Every automation read, with the newest run's status riding along so a list card
 * can show how the last run went without a second round trip.
 */
const automationColumns = (sql: SqlClient.SqlClient) => sql`
  automation_id AS "automationId",
  project_id AS "projectId",
  title,
  instructions,
  schedule_json AS "schedule",
  timezone,
  mode,
  is_enabled AS "isEnabled",
  next_run_at AS "nextRunAt",
  last_run_at AS "lastRunAt",
  created_at AS "createdAt",
  updated_at AS "updatedAt",
  (
    SELECT runs.status
    FROM automation_runs AS runs
    WHERE runs.automation_id = automations.automation_id
    ORDER BY runs.started_at DESC, runs.run_id DESC
    LIMIT 1
  ) AS "lastRunStatus"
`;

const runColumns = (sql: SqlClient.SqlClient) => sql`
  run_id AS "runId",
  automation_id AS "automationId",
  trigger,
  status,
  thread_id AS "threadId",
  summary,
  error_message AS "errorMessage",
  started_at AS "startedAt",
  finished_at AS "finishedAt"
`;

/** What the service writes, shaped as the entity the payloads carry. */
const recordFor = (input: AutomationWrite): Automation => ({
  ...input,
  lastRunStatus: null,
});

const makeAutomationRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const getAutomationByIdOption = SqlSchema.findOneOption({
    Request: Schema.Struct({ automationId: AutomationId }),
    Result: AutomationDbRow,
    execute: ({ automationId }) => sql`
      SELECT ${automationColumns(sql)}
      FROM automations
      WHERE automation_id = ${automationId}
    `,
  });

  const listAutomationRows = SqlSchema.findAll({
    Request: Schema.Struct({ projectId: Schema.NullOr(ProjectId) }),
    Result: AutomationDbRow,
    execute: ({ projectId }) => sql`
      SELECT ${automationColumns(sql)}
      FROM automations
      WHERE ${projectId === null ? sql`1 = 1` : sql`project_id = ${projectId}`}
      ORDER BY created_at DESC, automation_id ASC
    `,
  });

  const listDueRows = SqlSchema.findAll({
    Request: Schema.Struct({ now: Schema.String }),
    Result: AutomationDbRow,
    execute: ({ now }) => sql`
      SELECT ${automationColumns(sql)}
      FROM automations
      WHERE is_enabled = 1
        AND next_run_at IS NOT NULL
        AND next_run_at <= ${now}
      ORDER BY next_run_at ASC, automation_id ASC
    `,
  });

  const insertAutomationRow = SqlSchema.void({
    Request: Automation,
    execute: (row) => sql`
      INSERT INTO automations (
        automation_id,
        project_id,
        title,
        instructions,
        schedule_json,
        timezone,
        mode,
        is_enabled,
        next_run_at,
        last_run_at,
        created_at,
        updated_at
      )
      VALUES (
        ${row.automationId},
        ${row.projectId},
        ${row.title},
        ${row.instructions},
        ${JSON.stringify(row.schedule)},
        ${row.timezone},
        ${row.mode},
        ${row.isEnabled ? 1 : 0},
        ${row.nextRunAt},
        ${row.lastRunAt},
        ${row.createdAt},
        ${row.updatedAt}
      )
    `,
  });

  const updateAutomationRow = SqlSchema.void({
    Request: Automation,
    execute: (row) => sql`
      UPDATE automations
      SET
        project_id = ${row.projectId},
        title = ${row.title},
        instructions = ${row.instructions},
        schedule_json = ${JSON.stringify(row.schedule)},
        timezone = ${row.timezone},
        mode = ${row.mode},
        is_enabled = ${row.isEnabled ? 1 : 0},
        next_run_at = ${row.nextRunAt},
        last_run_at = ${row.lastRunAt},
        updated_at = ${row.updatedAt}
      WHERE automation_id = ${row.automationId}
    `,
  });

  const insertRunRow = SqlSchema.void({
    Request: AutomationRun,
    execute: (row) => sql`
      INSERT INTO automation_runs (
        run_id,
        automation_id,
        trigger,
        status,
        thread_id,
        summary,
        error_message,
        started_at,
        finished_at
      )
      VALUES (
        ${row.runId},
        ${row.automationId},
        ${row.trigger},
        ${row.status},
        ${row.threadId},
        ${row.summary},
        ${row.errorMessage},
        ${row.startedAt},
        ${row.finishedAt}
      )
    `,
  });

  const runningRunForAutomationOption = SqlSchema.findOneOption({
    Request: Schema.Struct({ automationId: AutomationId }),
    Result: AutomationRun,
    execute: ({ automationId }) => sql`
      SELECT ${runColumns(sql)}
      FROM automation_runs
      WHERE automation_id = ${automationId}
        AND status = 'running'
      ORDER BY started_at DESC, run_id ASC
      LIMIT 1
    `,
  });

  const runningRunForThreadOption = SqlSchema.findOneOption({
    Request: Schema.Struct({ threadId: ThreadId }),
    Result: AutomationRun,
    execute: ({ threadId }) => sql`
      SELECT ${runColumns(sql)}
      FROM automation_runs
      WHERE thread_id = ${threadId}
        AND status = 'running'
      ORDER BY started_at DESC, run_id ASC
      LIMIT 1
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

  const list: AutomationRepositoryShape["list"] = (input) =>
    listAutomationRows({ projectId: input.projectId ?? null }).pipe(
      Effect.mapError(toPersistenceSqlError("AutomationRepository.list:query")),
    );

  const listDue: AutomationRepositoryShape["listDue"] = (now) =>
    listDueRows({ now }).pipe(
      Effect.mapError(toPersistenceSqlError("AutomationRepository.listDue:query")),
    );

  const create: AutomationRepositoryShape["create"] = (input) =>
    Effect.gen(function* () {
      const automation = recordFor(input);
      yield* insertAutomationRow(automation).pipe(
        Effect.mapError(toPersistenceSqlError("AutomationRepository.create:query")),
      );
      return automation;
    });

  const update: AutomationRepositoryShape["update"] = (input) =>
    Effect.gen(function* () {
      const automation = recordFor(input);
      yield* updateAutomationRow(automation).pipe(
        Effect.mapError(toPersistenceSqlError("AutomationRepository.update:query")),
      );
      return yield* getAutomationById({ automationId: automation.automationId });
    });

  const deleteById: AutomationRepositoryShape["delete"] = ({ automationId }) =>
    sql`
      DELETE FROM automations
      WHERE automation_id = ${automationId}
    `.pipe(Effect.mapError(toPersistenceSqlError("AutomationRepository.delete:query")));

  const listRuns: AutomationRepositoryShape["listRuns"] = (input) =>
    SqlSchema.findAll({
      Request: Schema.Struct({ automationId: AutomationId, limit: Schema.Number }),
      Result: AutomationRun,
      execute: ({ automationId, limit }) => sql`
        SELECT ${runColumns(sql)}
        FROM automation_runs
        WHERE automation_id = ${automationId}
        ORDER BY started_at DESC, run_id ASC
        LIMIT ${limit}
      `,
    })(input).pipe(Effect.mapError(toPersistenceSqlError("AutomationRepository.listRuns:query")));

  const createRun: AutomationRepositoryShape["createRun"] = ({ automationId, trigger }) =>
    Effect.gen(function* () {
      const run = {
        runId: AutomationRunId.makeUnsafe(`run_${crypto.randomUUID()}`),
        automationId,
        trigger,
        status: "running" as const,
        threadId: null,
        summary: null,
        errorMessage: null,
        startedAt: new Date().toISOString(),
        finishedAt: null,
      } satisfies AutomationRun;

      yield* insertRunRow(run).pipe(
        Effect.mapError(toPersistenceSqlError("AutomationRepository.createRun:query")),
      );
      return run;
    });

  const attachRunThread: AutomationRepositoryShape["attachRunThread"] = ({ runId, threadId }) =>
    sql`
      UPDATE automation_runs
      SET thread_id = ${threadId}
      WHERE run_id = ${runId}
    `.pipe(Effect.mapError(toPersistenceSqlError("AutomationRepository.attachRunThread:query")));

  const runningRunForAutomation: AutomationRepositoryShape["runningRunForAutomation"] = (
    automationId,
  ) =>
    runningRunForAutomationOption({ automationId }).pipe(
      Effect.mapError(toPersistenceSqlError("AutomationRepository.runningRunForAutomation:query")),
    );

  const runningRunForThread: AutomationRepositoryShape["runningRunForThread"] = (threadId) =>
    runningRunForThreadOption({ threadId }).pipe(
      Effect.mapError(toPersistenceSqlError("AutomationRepository.runningRunForThread:query")),
    );

  const finishRun: AutomationRepositoryShape["finishRun"] = (input) =>
    sql`
      UPDATE automation_runs
      SET
        status = ${input.status},
        summary = ${input.summary ?? null},
        error_message = ${input.errorMessage ?? null},
        finished_at = ${new Date().toISOString()}
      WHERE run_id = ${input.runId}
    `.pipe(Effect.mapError(toPersistenceSqlError("AutomationRepository.finishRun:query")));

  const finishRunningRuns: AutomationRepositoryShape["finishRunningRuns"] = (input) =>
    sql`
      UPDATE automation_runs
      SET
        status = ${input.status},
        error_message = ${input.errorMessage},
        finished_at = ${new Date().toISOString()}
      WHERE status = 'running'
    `.pipe(Effect.mapError(toPersistenceSqlError("AutomationRepository.finishRunningRuns:query")));

  const saveScheduleState: AutomationRepositoryShape["saveScheduleState"] = (input) =>
    sql`
      UPDATE automations
      SET
        next_run_at = ${input.nextRunAt},
        last_run_at = COALESCE(${input.lastRunAt ?? null}, last_run_at),
        is_enabled = COALESCE(${input.isEnabled === undefined ? null : input.isEnabled ? 1 : 0}, is_enabled),
        updated_at = ${input.updatedAt}
      WHERE automation_id = ${input.automationId}
    `.pipe(Effect.mapError(toPersistenceSqlError("AutomationRepository.saveScheduleState:query")));

  return AutomationRepository.of({
    getById: getAutomationById,
    list,
    listDue,
    create,
    update,
    delete: deleteById,
    listRuns,
    createRun,
    attachRunThread,
    runningRunForAutomation,
    runningRunForThread,
    finishRun,
    finishRunningRuns,
    saveScheduleState,
  } satisfies AutomationRepositoryShape);
});

export const AutomationRepositoryLive = Layer.effect(
  AutomationRepository,
  makeAutomationRepository,
);
