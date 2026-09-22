import type { AgentStore, AgentSettingKey } from "./AgentStore.ts";
import type {
  AgentArtifactInput,
  AgentArtifactKind,
  AgentArtifactRecord,
  AgentGoalRecord,
  AgentGoalStatus,
  AgentPermissionInput,
  AgentPermissionRecord,
  AgentPermissionScope,
  AgentTodoInput,
  AgentTodoRecord,
  AgentTodoStatus,
  AgentTodoPriority,
  AgentPlanRecord,
} from "./records.ts";

/**
 * Minimal synchronous SQL surface.
 *
 * Deliberately duck-typed rather than importing a driver: `node:sqlite`'s `DatabaseSync`
 * satisfies it as-is, and so does a thin wrapper over `bun:sqlite`. The toolkit stays
 * dependency-free and the host picks the driver.
 */
export interface SyncSqlHandle {
  exec(sql: string): void;
  run(sql: string, params?: readonly SqlValue[]): void;
  all<T>(sql: string, params?: readonly SqlValue[]): T[];
  get<T>(sql: string, params?: readonly SqlValue[]): T | undefined;
  /**
   * Run `fn` inside a single driver transaction.
   *
   * The host implements this with BEGIN/COMMIT/ROLLBACK. If `fn` throws, the transaction
   * must be rolled back and the error rethrown, so a bulk write can never end half-applied.
   * Nested calls may either join the outer transaction (what PeakCode's host does) or use
   * savepoints; the store only ever opens one level.
   */
  transaction<T>(fn: () => T): T;
}

export type SqlValue = string | number | null;

/**
 * Tables owned by the toolkit, one statement per entry.
 *
 * This array is the single source of truth for the toolkit's SQLite schema. `AGENT_TOOLKIT_SCHEMA`
 * joins it so the store can install the schema with a single `exec`; hosts that version their
 * schema (PeakCode's `persistence/Migrations`) replay the exact same statements, so the two can
 * never drift. Statement-per-entry matters because `node:sqlite`'s `prepare` — what a host's
 * Effect SQL client is built on — silently runs only the first statement of a multi-statement
 * string.
 *
 * `IF NOT EXISTS` so the store is usable standalone.
 */
export const AGENT_TOOLKIT_SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS agent_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
)`,

  `CREATE TABLE IF NOT EXISTS agent_todos (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL,
  seq             INTEGER NOT NULL DEFAULT 0,
  content         TEXT    NOT NULL,
  status          TEXT    NOT NULL DEFAULT 'pending',
  priority        TEXT    NOT NULL DEFAULT 'medium',
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_todos_conversation ON agent_todos (conversation_id, seq, id)`,

  `CREATE TABLE IF NOT EXISTS agent_goals (
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
)`,

  `CREATE TABLE IF NOT EXISTS agent_artifacts (
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
)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_artifacts_conversation ON agent_artifacts (conversation_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_artifacts_path ON agent_artifacts (conversation_id, abs_path)`,

  `CREATE TABLE IF NOT EXISTS agent_plans (
  conversation_id INTEGER PRIMARY KEY,
  content         TEXT    NOT NULL,
  message_id      INTEGER,
  file_path       TEXT,
  approved_at     INTEGER,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
)`,

  `CREATE TABLE IF NOT EXISTS agent_permissions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  scope      TEXT NOT NULL,
  scope_ref  TEXT NOT NULL,
  permission TEXT NOT NULL,
  pattern    TEXT NOT NULL,
  action     TEXT NOT NULL,
  created_at INTEGER NOT NULL
)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_permissions_scope ON agent_permissions (scope, scope_ref, id)`,
];

/** The toolkit schema as one script, derived from {@link AGENT_TOOLKIT_SCHEMA_STATEMENTS}. */
export const AGENT_TOOLKIT_SCHEMA = AGENT_TOOLKIT_SCHEMA_STATEMENTS.map(
  (statement) => `${statement};`,
).join("\n\n");

interface TodoRowDb {
  id: number;
  conversation_id: number;
  seq: number;
  content: string;
  status: string;
  priority: string;
  created_at: number;
  updated_at: number;
}

interface GoalRowDb {
  conversation_id: number;
  objective: string;
  acceptance: string | null;
  status: string;
  token_budget: number | null;
  tokens_used: number;
  seconds_used: number;
  continuations: number;
  outcome: string | null;
  created_at: number;
  updated_at: number;
}

interface ArtifactRowDb {
  id: number;
  conversation_id: number;
  message_id: number | null;
  path: string;
  abs_path: string;
  title: string;
  kind: string;
  size: number | null;
  tool: string | null;
  created_at: number;
}

interface PlanRowDb {
  conversation_id: number;
  content: string;
  message_id: number | null;
  file_path: string | null;
  approved_at: number | null;
  created_at: number;
  updated_at: number;
}

interface PermissionRowDb {
  id: number;
  scope: string;
  scope_ref: string;
  permission: string;
  pattern: string;
  action: string;
  created_at: number;
}

const TODO_STATUSES: AgentTodoStatus[] = ["pending", "in_progress", "completed", "cancelled"];
const TODO_PRIORITIES: AgentTodoPriority[] = ["high", "medium", "low"];
const GOAL_STATUSES: AgentGoalStatus[] = [
  "active",
  "paused",
  "budget-limited",
  "complete",
  "dropped",
];
const PERMISSION_SCOPES: AgentPermissionScope[] = ["session", "workspace"];
const PERMISSION_ACTIONS = ["allow", "ask", "deny"] as const;

function oneOf<T extends string>(allowed: readonly T[], value: string, fallback: T): T {
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/**
 * SQLite-backed `AgentStore`.
 *
 * The toolkit reads its state synchronously from deep inside tool execution (settings are
 * consulted while resolving a sandbox profile, todos while rendering progress), so the
 * store stays synchronous — the host supplies a sync driver.
 */
export function createSqliteAgentStore(
  handle: SyncSqlHandle,
  options: { migrate?: boolean } = {},
): AgentStore {
  if (options.migrate !== false) handle.exec(AGENT_TOOLKIT_SCHEMA);

  const toTodo = (row: TodoRowDb): AgentTodoRecord => ({
    id: row.id,
    conversationId: row.conversation_id,
    seq: row.seq,
    content: row.content,
    status: oneOf(TODO_STATUSES, row.status, "pending"),
    priority: oneOf(TODO_PRIORITIES, row.priority, "medium"),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });

  const toGoal = (row: GoalRowDb): AgentGoalRecord => ({
    conversationId: row.conversation_id,
    objective: row.objective,
    acceptance: row.acceptance,
    status: oneOf(GOAL_STATUSES, row.status, "active"),
    tokenBudget: row.token_budget,
    tokensUsed: row.tokens_used,
    secondsUsed: row.seconds_used,
    continuations: row.continuations,
    outcome: row.outcome,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });

  const toArtifact = (row: ArtifactRowDb): AgentArtifactRecord => ({
    id: row.id,
    conversationId: row.conversation_id,
    messageId: row.message_id,
    path: row.path,
    absPath: row.abs_path,
    title: row.title,
    kind: row.kind as AgentArtifactKind,
    size: row.size,
    tool: row.tool,
    createdAt: row.created_at,
  });

  const toPlan = (row: PlanRowDb): AgentPlanRecord => ({
    conversationId: row.conversation_id,
    content: row.content,
    messageId: row.message_id,
    filePath: row.file_path,
    approvedAt: row.approved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });

  const toPermission = (row: PermissionRowDb): AgentPermissionRecord => ({
    id: row.id,
    scope: oneOf(PERMISSION_SCOPES, row.scope, "session"),
    scopeRef: row.scope_ref,
    permission: row.permission,
    pattern: row.pattern,
    action: oneOf(PERMISSION_ACTIONS, row.action, "ask"),
    createdAt: row.created_at,
  });

  return {
    getSetting: (key) =>
      handle.get<{ value: string }>("SELECT value FROM agent_settings WHERE key = ?", [key])?.value,

    setSettings: (values) => {
      // Batch the upserts: one transaction instead of N autocommits (each of which would
      // fsync on a WAL database), and no partially-applied settings map on a mid-way error.
      handle.transaction(() => {
        for (const [key, value] of Object.entries(values)) {
          if (value === undefined) continue;
          handle.run(
            "INSERT INTO agent_settings (key, value) VALUES (?, ?) " +
              "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [key, value],
          );
        }
      });
    },

    listTodos: (conversationId) =>
      handle
        .all<TodoRowDb>(
          "SELECT * FROM agent_todos WHERE conversation_id = ? ORDER BY seq ASC, id ASC",
          [conversationId],
        )
        .map(toTodo),

    replaceTodos: (conversationId, items: readonly AgentTodoInput[]) => {
      const now = Date.now();
      // DELETE + INSERT as one unit: without a transaction an error mid-list would leave
      // the conversation with no todos at all (or a half-written list).
      handle.transaction(() => {
        handle.run("DELETE FROM agent_todos WHERE conversation_id = ?", [conversationId]);
        items.forEach((item, index) => {
          handle.run(
            "INSERT INTO agent_todos (conversation_id, seq, content, status, priority, created_at, updated_at) " +
              "VALUES (?, ?, ?, ?, ?, ?, ?)",
            [
              conversationId,
              index,
              item.content,
              item.status ?? "pending",
              item.priority ?? "medium",
              now,
              now,
            ],
          );
        });
      });
      return handle
        .all<TodoRowDb>(
          "SELECT * FROM agent_todos WHERE conversation_id = ? ORDER BY seq ASC, id ASC",
          [conversationId],
        )
        .map(toTodo);
    },

    clearTodos: (conversationId) => {
      handle.run("DELETE FROM agent_todos WHERE conversation_id = ?", [conversationId]);
    },

    getGoal: (conversationId) => {
      const row = handle.get<GoalRowDb>("SELECT * FROM agent_goals WHERE conversation_id = ?", [
        conversationId,
      ]);
      return row ? toGoal(row) : null;
    },

    upsertGoal: (goal) => {
      handle.run(
        "INSERT INTO agent_goals (conversation_id, objective, acceptance, status, token_budget, tokens_used, seconds_used, continuations, outcome, created_at, updated_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
          "ON CONFLICT(conversation_id) DO UPDATE SET " +
          "objective = excluded.objective, acceptance = excluded.acceptance, status = excluded.status, " +
          "token_budget = excluded.token_budget, tokens_used = excluded.tokens_used, " +
          "seconds_used = excluded.seconds_used, continuations = excluded.continuations, " +
          "outcome = excluded.outcome, updated_at = excluded.updated_at",
        [
          goal.conversationId,
          goal.objective,
          goal.acceptance,
          goal.status,
          goal.tokenBudget,
          goal.tokensUsed,
          goal.secondsUsed,
          goal.continuations,
          goal.outcome,
          goal.createdAt,
          goal.updatedAt,
        ],
      );
      return goal;
    },

    clearGoal: (conversationId) => {
      handle.run("DELETE FROM agent_goals WHERE conversation_id = ?", [conversationId]);
    },

    listArtifacts: (conversationId) =>
      handle
        .all<ArtifactRowDb>(
          "SELECT * FROM agent_artifacts WHERE conversation_id = ? ORDER BY created_at DESC, id DESC",
          [conversationId],
        )
        .map(toArtifact),

    getArtifact: (id) => {
      const row = handle.get<ArtifactRowDb>("SELECT * FROM agent_artifacts WHERE id = ?", [id]);
      return row ? toArtifact(row) : null;
    },

    findArtifactByPath: (conversationId, absPath) => {
      const row = handle.get<ArtifactRowDb>(
        "SELECT * FROM agent_artifacts WHERE conversation_id = ? AND abs_path = ? ORDER BY id DESC LIMIT 1",
        [conversationId, absPath],
      );
      return row ? toArtifact(row) : null;
    },

    insertArtifact: (input: AgentArtifactInput) => {
      const createdAt = Date.now();
      // `RETURNING *` hands back exactly the inserted row, so we neither guess its id nor
      // re-run a SELECT that could race another writer on the same path.
      const row = handle.get<ArtifactRowDb>(
        "INSERT INTO agent_artifacts (conversation_id, message_id, path, abs_path, title, kind, size, tool, created_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *",
        [
          input.conversationId,
          input.messageId ?? null,
          input.path,
          input.absPath,
          input.title,
          input.kind,
          input.size ?? null,
          input.tool ?? null,
          createdAt,
        ],
      );
      if (!row) throw new Error("agent_artifacts insert did not produce a row");
      return toArtifact(row);
    },

    updateArtifact: (id, patch) => {
      const assignments: string[] = [];
      const params: SqlValue[] = [];
      if (patch.size !== undefined) {
        assignments.push("size = ?");
        params.push(patch.size);
      }
      if (patch.createdAt !== undefined) {
        assignments.push("created_at = ?");
        params.push(patch.createdAt);
      }
      if (patch.tool !== undefined) {
        assignments.push("tool = ?");
        params.push(patch.tool);
      }
      if (patch.messageId !== undefined) {
        assignments.push("message_id = ?");
        params.push(patch.messageId);
      }
      if (assignments.length === 0) return;
      params.push(id);
      handle.run(`UPDATE agent_artifacts SET ${assignments.join(", ")} WHERE id = ?`, params);
    },

    deleteArtifact: (id) => {
      handle.run("DELETE FROM agent_artifacts WHERE id = ?", [id]);
    },

    getPlan: (conversationId) => {
      const row = handle.get<PlanRowDb>("SELECT * FROM agent_plans WHERE conversation_id = ?", [
        conversationId,
      ]);
      return row ? toPlan(row) : null;
    },

    upsertPlan: (plan) => {
      handle.run(
        "INSERT INTO agent_plans (conversation_id, content, message_id, file_path, approved_at, created_at, updated_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?) " +
          "ON CONFLICT(conversation_id) DO UPDATE SET " +
          "content = excluded.content, message_id = excluded.message_id, file_path = excluded.file_path, " +
          "approved_at = excluded.approved_at, updated_at = excluded.updated_at",
        [
          plan.conversationId,
          plan.content,
          plan.messageId,
          plan.filePath,
          plan.approvedAt,
          plan.createdAt,
          plan.updatedAt,
        ],
      );
      return plan;
    },

    clearPlan: (conversationId) => {
      handle.run("DELETE FROM agent_plans WHERE conversation_id = ?", [conversationId]);
    },

    listPermissions: (scope, scopeRef) =>
      handle
        .all<PermissionRowDb>(
          "SELECT * FROM agent_permissions WHERE scope = ? AND scope_ref = ? ORDER BY id ASC",
          [scope, scopeRef],
        )
        .map(toPermission),

    listAllPermissions: () =>
      handle
        .all<PermissionRowDb>("SELECT * FROM agent_permissions ORDER BY id ASC")
        .map(toPermission),

    insertPermission: (input: AgentPermissionInput) => {
      const createdAt = Date.now();
      // Was `SELECT ... ORDER BY id DESC LIMIT 1` with no WHERE: under concurrent writers
      // that returns whatever row was inserted last by *any* session, not ours. `RETURNING *`
      // pins the result to this insert.
      const row = handle.get<PermissionRowDb>(
        "INSERT INTO agent_permissions (scope, scope_ref, permission, pattern, action, created_at) " +
          "VALUES (?, ?, ?, ?, ?, ?) RETURNING *",
        [input.scope, input.scopeRef, input.permission, input.pattern, input.action, createdAt],
      );
      if (!row) throw new Error("agent_permissions insert did not produce a row");
      return toPermission(row);
    },

    deletePermission: (id) => {
      handle.run("DELETE FROM agent_permissions WHERE id = ?", [id]);
    },

    clearPermissions: (scope, scopeRef) => {
      handle.run("DELETE FROM agent_permissions WHERE scope = ? AND scope_ref = ?", [
        scope,
        scopeRef,
      ]);
    },
  };
}

/** Setting keys the toolkit recognises — exported so hosts can validate their own writes. */
export type { AgentSettingKey };
