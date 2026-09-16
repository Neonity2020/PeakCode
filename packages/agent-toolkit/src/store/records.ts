/**
 * Persisted rows owned by the agent toolkit.
 *
 * These mirror OmniStudio's `agent_*` SQLite tables one-for-one. They are declared
 * here rather than derived from a schema builder so the toolkit can be backed by
 * any store (SQLite, in-memory, a host application's own persistence) without
 * dragging an ORM into the dependency graph.
 */

export type AgentTodoStatus = "pending" | "in_progress" | "completed" | "cancelled";
export type AgentTodoPriority = "high" | "medium" | "low";

export interface AgentTodoRecord {
  id: number;
  conversationId: number;
  /** Display order within the checklist. */
  seq: number;
  content: string;
  status: AgentTodoStatus;
  priority: AgentTodoPriority;
  createdAt: number;
  updatedAt: number;
}

export type AgentGoalStatus = "active" | "paused" | "budget-limited" | "complete" | "dropped";

export interface AgentGoalRecord {
  conversationId: number;
  objective: string;
  acceptance: string | null;
  status: AgentGoalStatus;
  tokenBudget: number | null;
  tokensUsed: number;
  secondsUsed: number;
  continuations: number;
  outcome: string | null;
  createdAt: number;
  updatedAt: number;
}

export type AgentArtifactKind =
  | "markdown"
  | "code"
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "html"
  | "text"
  | "other";

export interface AgentArtifactRecord {
  id: number;
  conversationId: number;
  messageId: number | null;
  /** Workspace-relative path (absolute for media produced outside the workspace). */
  path: string;
  absPath: string;
  title: string;
  kind: AgentArtifactKind;
  size: number | null;
  /** Tool that produced the artifact (write_file / edit_file / …). */
  tool: string | null;
  createdAt: number;
}

export interface AgentPlanRecord {
  conversationId: number;
  content: string;
  messageId: number | null;
  filePath: string | null;
  approvedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export type AgentPermissionScope = "session" | "workspace";
export type AgentPermissionAction = "allow" | "ask" | "deny";

export interface AgentPermissionRecord {
  id: number;
  scope: AgentPermissionScope;
  /** Session id (stringified) or absolute workspace path. */
  scopeRef: string;
  /** bash / edit / webfetch / external_directory / mcp / doom_loop … */
  permission: string;
  /** Glob-ish pattern: `*` any run, `?` one char; a trailing " *" is optional. */
  pattern: string;
  action: AgentPermissionAction;
  createdAt: number;
}

/**
 * Inputs accepted by the store's write paths. The `id`/timestamps are assigned by
 * the store, matching how the original tables relied on autoincrement + defaults.
 */
export interface AgentTodoInput {
  content: string;
  status?: AgentTodoStatus;
  priority?: AgentTodoPriority;
}

export interface AgentArtifactInput {
  conversationId: number;
  messageId?: number | null;
  path: string;
  absPath: string;
  title: string;
  kind: AgentArtifactKind;
  size?: number | null;
  tool?: string | null;
}

export interface AgentPermissionInput {
  scope: AgentPermissionScope;
  scopeRef: string;
  permission: string;
  pattern: string;
  action: AgentPermissionAction;
}
