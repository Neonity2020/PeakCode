/**
 * Host wiring for `@peakcode/agent-toolkit`.
 *
 * The toolkit is a port of OmniStudio's agent module set (tools, sandbox, snapshots,
 * context compaction, todos/goals/plans, hooks, skills, spilling). It is deliberately
 * free of host assumptions: settings, conversation history, web search and the knowledge
 * base all arrive through ports. This module is where PeakCode supplies them.
 *
 * Two responsibilities, kept in one place so nothing else has to know the toolkit's
 * module-level singletons exist:
 *
 * 1. **Configuration** — data directory, log sink, token-usage sink. Runs once per server
 *    start, derived from `ServerConfig`.
 * 2. **Tool bridging** — turn the toolkit's `AgentTool`s into the `ToolDefinition`s the
 *    pi coding-agent session accepts as `customTools`.
 */
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
  buildAgentTools,
  type BuiltTool,
  type ToolContext,
} from "@peakcode/agent-toolkit/agent-tools";
import { setAgentLogSink } from "@peakcode/agent-toolkit/runtime/log";
import { setAgentDataDir } from "@peakcode/agent-toolkit/runtime/paths";
import {
  agentStore,
  createInMemoryAgentStore,
  setAgentStore,
} from "@peakcode/agent-toolkit/store/AgentStore";
import type { AgentStore } from "@peakcode/agent-toolkit/store/AgentStore";
import { createSqliteAgentStore } from "@peakcode/agent-toolkit/store/sqlite";

export interface ConfigureAgentToolkitOptions {
  /** Server state directory; the toolkit keeps snapshots, spills and plans under it. */
  stateDir: string;
  /** Where toolkit diagnostics go. Defaults to the Effect logger wired up by the caller. */
  log: (input: {
    level?: "debug" | "info" | "warn" | "error";
    event: string;
    message: string;
    detail?: unknown;
  }) => void;
  /** Persistent store. Omit to fall back to the in-memory default. */
  store?: AgentStore | undefined;
}

/**
 * Open the shared `state.sqlite` with a synchronous driver and wrap it as an `AgentStore`.
 *
 * The toolkit reads its state from inside tool execution — `getSetting` while resolving a
 * sandbox profile, todos while rendering progress — so the store has to be synchronous,
 * which rules out the Effect SQL client the rest of the server uses. `node:sqlite` ships
 * with both runtimes this server supports, and a second connection to a WAL database is
 * safe: readers never block the writer, and `busy_timeout` covers the rare two-writer case.
 *
 * Tables come from migration `040_AgentToolkit`. `migrate: false` keeps this connection
 * from racing the migration runner with its own `CREATE TABLE IF NOT EXISTS`.
 *
 * Returns `null` when the file cannot be opened, so a toolkit problem never keeps the
 * server from booting — the caller falls back to the in-memory store.
 */
export function openAgentToolkitStore(dbPath: string): AgentStore | null {
  try {
    const db = new DatabaseSync(dbPath);
    db.exec("PRAGMA busy_timeout = 5000");
    return createSqliteAgentStore(
      {
        exec: (sql) => {
          db.exec(sql);
        },
        run: (sql, params = []) => {
          db.prepare(sql).run(...params);
        },
        all: <T>(sql: string, params: readonly (string | number | null)[] = []) =>
          db.prepare(sql).all(...params) as T[],
        get: <T>(sql: string, params: readonly (string | number | null)[] = []) =>
          db.prepare(sql).get(...params) as T | undefined,
      },
      { migrate: false },
    );
  } catch {
    return null;
  }
}

let configured = false;

/**
 * Point the toolkit at this host. Idempotent: the second call replaces the log/usage
 * sinks (handy in tests) but reuses the store unless one is passed explicitly.
 */
export function configureAgentToolkit(options: ConfigureAgentToolkitOptions): void {
  setAgentDataDir(path.join(options.stateDir, "agent"));
  setAgentLogSink((input) =>
    options.log({
      ...(input.level ? { level: input.level } : {}),
      event: input.event,
      message: input.message,
      ...(input.detail === undefined ? {} : { detail: input.detail }),
    }),
  );
  if (options.store) setAgentStore(options.store);
  else if (!configured) setAgentStore(createInMemoryAgentStore());
  configured = true;
}

/** True once {@link configureAgentToolkit} has run. */
export function isAgentToolkitConfigured(): boolean {
  return configured;
}

/** The active store, for callers that need to read toolkit state (todos, plans, …). */
export function agentToolkitStore(): AgentStore {
  return agentStore();
}

/**
 * Stable numeric key for a thread.
 *
 * The toolkit's per-conversation state (todos, goals, plans, artifacts) is keyed by
 * `number`, a leftover from OmniStudio's autoincrement conversation ids, while PeakCode
 * threads are branded strings. A non-cryptographic 31-bit hash gives a stable, cheap key;
 * collisions only mix two threads' todo lists, and the toolkit is the only writer.
 */
export function threadConversationKey(threadId: string): number {
  let hash = 0;
  for (let index = 0; index < threadId.length; index += 1) {
    hash = (Math.imul(hash, 31) + threadId.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

export interface ThreadToolkitToolsInput {
  /** Session working directory; every relative path the tools resolve is based on it. */
  cwd: string;
  /** The active model accepts image input — gates `view_image`. */
  vision?: boolean | undefined;
  authorizedFolders?: string[] | undefined;
  conversationId?: number | undefined;
  messageId?: number | null | undefined;
  systemPromptTokens?: number | undefined;
  /** Injected by the orchestrator once approvals/questions are routed to the UI. */
  callbacks?:
    | Pick<
        ToolContext,
        | "onTodoWrite"
        | "askUser"
        | "spawnSubagent"
        | "recordArtifact"
        | "escalateSandbox"
        | "onCheckpoint"
        | "onRewind"
        | "onGoal"
        | "onWritePlan"
        | "onScheduleTask"
        | "onKanbanComment"
      >
    | undefined;
}

/**
 * Toolkit tools for one session, shaped for pi's `customTools`.
 *
 * **Always the full set.** Which subset is live is decided per turn by
 * `activeToolNamesForMode`; registering once per session is what lets a mode switch happen
 * without rebuilding the session. Tools whose callbacks were not injected stay in the list
 * and answer "not available in this mode" — that is the toolkit's design, and it keeps the
 * catalogue stable so `setActiveToolsByName` has a consistent registry to pick from.
 */
export function buildThreadToolkitTools(input: ThreadToolkitToolsInput): ToolDefinition[] {
  const ctx: ToolContext = {
    workspace: input.cwd,
    allowShell: true,
    ...(input.vision === undefined ? {} : { vision: input.vision }),
    ...(input.authorizedFolders === undefined
      ? {}
      : { authorizedFolders: input.authorizedFolders }),
    ...(input.conversationId === undefined ? {} : { conversationId: input.conversationId }),
    ...(input.messageId === undefined ? {} : { messageId: input.messageId }),
    ...(input.systemPromptTokens === undefined
      ? {}
      : { systemPromptTokens: input.systemPromptTokens }),
    ...(input.callbacks ?? {}),
  };
  return buildAgentTools(ctx).map(toToolDefinition);
}

/**
 * `BuiltTool` → pi `ToolDefinition`.
 *
 * The two shapes are nearly identical (`name`/`description`/TypeBox `parameters`/
 * `execute`); pi additionally wants a display `label`. Wrapping rather than casting keeps
 * the extra `ExtensionContext` argument from leaking into the toolkit.
 */
function toToolDefinition(tool: BuiltTool): ToolDefinition {
  return defineTool({
    name: tool.name,
    label: tool.label,
    description: tool.description,
    parameters: tool.parameters,
    execute: (toolCallId, params, signal, onUpdate) =>
      tool.execute(toolCallId, params, signal, onUpdate),
  }) as ToolDefinition;
}
