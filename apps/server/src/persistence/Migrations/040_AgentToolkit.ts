import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Agent toolkit state: settings, todos, goals, artifacts, plans, permission rules.
 *
 * The toolkit reads this state synchronously from inside tool execution, so it talks to
 * SQLite through its own `node:sqlite` connection rather than through Effect SQL. These
 * table definitions are the single source of truth — the toolkit's `AGENT_TOOLKIT_SCHEMA`
 * constant carries the same DDL (with `IF NOT EXISTS`) so the package also works
 * standalone, and any change has to land in both places.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS agent_settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS agent_todos (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL,
      seq             INTEGER NOT NULL DEFAULT 0,
      content         TEXT    NOT NULL,
      status          TEXT    NOT NULL DEFAULT 'pending',
      priority        TEXT    NOT NULL DEFAULT 'medium',
      created_at      INTEGER NOT NULL,
      updated_at      INTEGER NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_agent_todos_conversation
    ON agent_todos(conversation_id, seq, id)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS agent_goals (
      conversation_id INTEGER PRIMARY KEY,
      objective       TEXT    NOT NULL,
      acceptance      TEXT,
      status          TEXT    NOT NULL DEFAULT 'active',
      token_budget    INTEGER,
      tokens_used     INTEGER NOT NULL DEFAULT 0,
      seconds_used    INTEGER NOT NULL DEFAULT 0,
      continuations   INTEGER NOT NULL DEFAULT 0,
      outcome         TEXT,
      created_at      INTEGER NOT NULL,
      updated_at      INTEGER NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS agent_artifacts (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL,
      message_id      INTEGER,
      path            TEXT    NOT NULL,
      abs_path        TEXT    NOT NULL,
      title           TEXT    NOT NULL,
      kind            TEXT    NOT NULL DEFAULT 'other',
      size            INTEGER,
      tool            TEXT,
      created_at      INTEGER NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_agent_artifacts_conversation
    ON agent_artifacts(conversation_id, created_at DESC)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_agent_artifacts_path
    ON agent_artifacts(conversation_id, abs_path)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS agent_plans (
      conversation_id INTEGER PRIMARY KEY,
      content         TEXT    NOT NULL,
      message_id      INTEGER,
      file_path       TEXT,
      approved_at     INTEGER,
      created_at      INTEGER NOT NULL,
      updated_at      INTEGER NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS agent_permissions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      scope      TEXT NOT NULL,
      scope_ref  TEXT NOT NULL,
      permission TEXT NOT NULL,
      pattern    TEXT NOT NULL,
      action     TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_agent_permissions_scope
    ON agent_permissions(scope, scope_ref, id)
  `;
});
