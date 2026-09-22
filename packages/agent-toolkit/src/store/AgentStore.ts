import type {
  AgentArtifactInput,
  AgentArtifactRecord,
  AgentGoalRecord,
  AgentPermissionInput,
  AgentPermissionRecord,
  AgentPermissionScope,
  AgentPlanRecord,
  AgentTodoInput,
  AgentTodoRecord,
} from "./records.ts";

/**
 * Settings the agent toolkit reads or writes. Declared as a closed union so a host
 * application can validate/reject unknown keys instead of silently storing typos.
 */
export type AgentSettingKey =
  | "AGENT_APPROVAL_MODE"
  | "AGENT_COMPACT_MODE"
  | "AGENT_AUTHORIZED_FOLDERS"
  | "AGENT_GOAL_MAX_CONTINUATIONS"
  | "AGENT_GOAL_TOKEN_BUDGET"
  | "AGENT_HOOKS"
  | "AGENT_NOTIFY_COMMAND"
  | "AGENT_PERMISSION_RULES"
  | "AGENT_PROJECT_DOC"
  | "AGENT_PROJECT_DOC_MAX_BYTES"
  | "AGENT_SANDBOX_BACKEND"
  | "AGENT_SANDBOX_MODE"
  | "AGENT_SANDBOX_NETWORK"
  | "AGENT_DISABLED_SKILLS"
  | "AGENT_SUBAGENTS"
  | "AGENT_SKILL_PACKS"
  | "AGENT_SKILL_WORKFLOW"
  | "AGENT_SNAPSHOTS"
  | "AGENT_SNAPSHOT_GC_MB"
  | "AGENT_SNAPSHOT_GC_TURNS"
  | "SERVER_CTX_SIZE"
  | "SKILLS_CENTRAL_PATH"
  | "WEB_SEARCH_ENABLED";

/**
 * Everything the toolkit needs to persist. The original OmniStudio modules talked to
 * drizzle/SQLite directly; the port routes the same reads and writes through this port
 * so the toolkit can run against SQLite, a host app's own tables, or memory in tests.
 */
export interface AgentStore {
  getSetting(key: AgentSettingKey): string | undefined;
  setSettings(values: Partial<Record<AgentSettingKey, string>>): void;

  listTodos(conversationId: number): AgentTodoRecord[];
  /** Full overwrite, matching `todo_write`'s semantics. Returns the stored rows. */
  replaceTodos(conversationId: number, todos: readonly AgentTodoInput[]): AgentTodoRecord[];
  clearTodos(conversationId: number): void;

  getGoal(conversationId: number): AgentGoalRecord | null;
  /** One goal per conversation: the row is replaced wholesale. */
  upsertGoal(goal: AgentGoalRecord): AgentGoalRecord;
  clearGoal(conversationId: number): void;

  listArtifacts(conversationId: number): AgentArtifactRecord[];
  getArtifact(id: number): AgentArtifactRecord | null;
  /** Most recent record for an absolute path within a conversation, used to dedupe rewrites. */
  findArtifactByPath(conversationId: number, absPath: string): AgentArtifactRecord | null;
  insertArtifact(input: AgentArtifactInput): AgentArtifactRecord;
  updateArtifact(
    id: number,
    patch: Partial<Pick<AgentArtifactRecord, "size" | "createdAt" | "tool" | "messageId">>,
  ): void;
  deleteArtifact(id: number): void;

  getPlan(conversationId: number): AgentPlanRecord | null;
  upsertPlan(plan: AgentPlanRecord): AgentPlanRecord;
  clearPlan(conversationId: number): void;

  listPermissions(scope: AgentPermissionScope, scopeRef: string): AgentPermissionRecord[];
  /** Every stored rule, oldest first. Used by the settings panel's rule list. */
  listAllPermissions(): AgentPermissionRecord[];
  insertPermission(input: AgentPermissionInput): AgentPermissionRecord;
  deletePermission(id: number): void;
  clearPermissions(scope: AgentPermissionScope, scopeRef: string): void;
}

interface SettingsKeyMap {
  [key: string]: string | undefined;
}

/** In-memory `AgentStore`. Deterministic and dependency-free; used as the default and in tests. */
export function createInMemoryAgentStore(): AgentStore {
  const settings: SettingsKeyMap = {};
  const todos = new Map<number, AgentTodoRecord[]>();
  const goals = new Map<number, AgentGoalRecord>();
  const artifacts = new Map<number, AgentArtifactRecord>();
  const plans = new Map<number, AgentPlanRecord>();
  const permissions = new Map<number, AgentPermissionRecord>();

  let todoSeq = 0;
  let artifactSeq = 0;
  let permissionSeq = 0;

  return {
    getSetting: (key) => settings[key],
    setSettings: (values) => {
      for (const [key, value] of Object.entries(values)) {
        if (value !== undefined) settings[key] = value;
      }
    },

    listTodos: (conversationId) => [...(todos.get(conversationId) ?? [])],

    replaceTodos: (conversationId, items) => {
      const now = Date.now();
      const rows = items.map((item, index) => {
        todoSeq += 1;
        return {
          id: todoSeq,
          conversationId,
          seq: index,
          content: item.content,
          status: item.status ?? "pending",
          priority: item.priority ?? "medium",
          createdAt: now,
          updatedAt: now,
        } satisfies AgentTodoRecord;
      });
      todos.set(conversationId, rows);
      return rows;
    },

    clearTodos: (conversationId) => {
      todos.delete(conversationId);
    },

    getGoal: (conversationId) => goals.get(conversationId) ?? null,

    upsertGoal: (goal) => {
      goals.set(goal.conversationId, goal);
      return goal;
    },

    clearGoal: (conversationId) => {
      goals.delete(conversationId);
    },

    listArtifacts: (conversationId) =>
      [...artifacts.values()]
        .filter((row) => row.conversationId === conversationId)
        .sort((left, right) => right.createdAt - left.createdAt || right.id - left.id),

    getArtifact: (id) => artifacts.get(id) ?? null,

    findArtifactByPath: (conversationId, absPath) => {
      let found: AgentArtifactRecord | null = null;
      for (const row of artifacts.values()) {
        if (row.conversationId !== conversationId || row.absPath !== absPath) continue;
        if (!found || row.id > found.id) found = row;
      }
      return found;
    },

    insertArtifact: (input) => {
      artifactSeq += 1;
      const row = {
        id: artifactSeq,
        conversationId: input.conversationId,
        messageId: input.messageId ?? null,
        path: input.path,
        absPath: input.absPath,
        title: input.title,
        kind: input.kind,
        size: input.size ?? null,
        tool: input.tool ?? null,
        createdAt: Date.now(),
      } satisfies AgentArtifactRecord;
      artifacts.set(row.id, row);
      return row;
    },

    updateArtifact: (id, patch) => {
      const row = artifacts.get(id);
      if (row) artifacts.set(id, { ...row, ...patch });
    },

    deleteArtifact: (id) => {
      artifacts.delete(id);
    },

    getPlan: (conversationId) => plans.get(conversationId) ?? null,

    upsertPlan: (plan) => {
      plans.set(plan.conversationId, plan);
      return plan;
    },

    clearPlan: (conversationId) => {
      plans.delete(conversationId);
    },

    listPermissions: (scope, scopeRef) =>
      [...permissions.values()]
        .filter((row) => row.scope === scope && row.scopeRef === scopeRef)
        .sort((left, right) => left.id - right.id),

    listAllPermissions: () => [...permissions.values()].sort((left, right) => left.id - right.id),

    insertPermission: (input) => {
      permissionSeq += 1;
      const row = {
        id: permissionSeq,
        scope: input.scope,
        scopeRef: input.scopeRef,
        permission: input.permission,
        pattern: input.pattern,
        action: input.action,
        createdAt: Date.now(),
      } satisfies AgentPermissionRecord;
      permissions.set(row.id, row);
      return row;
    },

    deletePermission: (id) => {
      permissions.delete(id);
    },

    clearPermissions: (scope, scopeRef) => {
      for (const [id, row] of permissions) {
        if (row.scope === scope && row.scopeRef === scopeRef) permissions.delete(id);
      }
    },
  };
}

let activeStore: AgentStore = createInMemoryAgentStore();

/** The store every toolkit module reads through. Replaced by hosts and by tests. */
export function agentStore(): AgentStore {
  return activeStore;
}

/**
 * Point the toolkit at a store. Returns the previous store so a test can restore it —
 * the modules intentionally read a module-level binding, matching the original design.
 */
export function setAgentStore(store: AgentStore): AgentStore {
  const previous = activeStore;
  activeStore = store;
  return previous;
}
