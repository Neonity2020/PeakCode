import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS automations (
      automation_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      prompt TEXT NOT NULL,
      script_id TEXT,
      script_name TEXT,
      script_command TEXT,
      schedule_type TEXT NOT NULL CHECK (schedule_type IN ('cron', 'manual')),
      cron_expression TEXT,
      timezone TEXT NOT NULL DEFAULT 'UTC',
      is_enabled INTEGER NOT NULL DEFAULT 1,
      template_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_run_at TEXT,
      FOREIGN KEY (project_id) REFERENCES projection_projects(project_id) ON DELETE CASCADE
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_automations_project_id
    ON automations(project_id)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_automations_schedule_type
    ON automations(schedule_type)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_automations_is_enabled
    ON automations(is_enabled)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS automation_runs (
      run_id TEXT PRIMARY KEY,
      automation_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
      started_at TEXT NOT NULL,
      completed_at TEXT,
      error_message TEXT,
      thread_id TEXT,
      result_summary TEXT,
      FOREIGN KEY (automation_id) REFERENCES automations(automation_id) ON DELETE CASCADE,
      FOREIGN KEY (thread_id) REFERENCES projection_threads(thread_id) ON DELETE SET NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_automation_runs_automation_id
    ON automation_runs(automation_id)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_automation_runs_status
    ON automation_runs(status)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_automation_runs_started_at
    ON automation_runs(started_at DESC)
  `;
});
