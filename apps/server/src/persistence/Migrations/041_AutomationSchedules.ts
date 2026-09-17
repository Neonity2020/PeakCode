import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Rebuilds the automation tables around plans instead of cron expressions.
 *
 * The previous shape stored a five-field cron string, an `auto | manual` discriminator and
 * three script columns that no code path ever wrote. A plan is now either once, daily or
 * weekly, its next instant is stored so the scheduler only ever compares timestamps, and a
 * run records the conversation it opened along with its outcome.
 *
 * The old rows are not converted: cron strings that meant "every day at 09:00" can be read
 * back, but anything else (steps, ranges, month fields) has no equivalent in the new model,
 * and silently rewriting a schedule is worse than dropping it. Both tables are recreated
 * empty.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Runs first: it holds the foreign key into automations.
  yield* sql`DROP TABLE IF EXISTS automation_runs`;
  yield* sql`DROP TABLE IF EXISTS automations`;

  yield* sql`
    CREATE TABLE automations (
      automation_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      instructions TEXT NOT NULL,
      schedule_json TEXT NOT NULL,
      timezone TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'default',
      is_enabled INTEGER NOT NULL DEFAULT 1,
      next_run_at TEXT,
      last_run_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projection_projects(project_id) ON DELETE CASCADE
    )
  `;

  yield* sql`
    CREATE INDEX idx_automations_project_id
    ON automations(project_id)
  `;

  // The scheduler's only query: enabled plans whose instant has arrived.
  yield* sql`
    CREATE INDEX idx_automations_due
    ON automations(is_enabled, next_run_at)
  `;

  yield* sql`
    CREATE TABLE automation_runs (
      run_id TEXT PRIMARY KEY,
      automation_id TEXT NOT NULL,
      trigger TEXT NOT NULL CHECK (trigger IN ('scheduled', 'manual')),
      status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'interrupted')),
      thread_id TEXT,
      summary TEXT,
      error_message TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      -- No foreign key on thread_id: the claim is written *before* the thread is created
      -- (that is what makes a crash between the two harmless), so there would be nothing to
      -- point at. A deleted conversation leaves the run record intact, which is what the
      -- history is for.
      FOREIGN KEY (automation_id) REFERENCES automations(automation_id) ON DELETE CASCADE
    )
  `;

  yield* sql`
    CREATE INDEX idx_automation_runs_automation_id
    ON automation_runs(automation_id, started_at DESC)
  `;

  // Outcome write-back looks a running run up by the conversation it was dispatched into.
  yield* sql`
    CREATE INDEX idx_automation_runs_running_thread
    ON automation_runs(thread_id, status)
  `;
});
