// FILE: subAgents.ts
// Purpose: Contracts for the "Sub-agents" settings surface and the multi-agent mode.
// A sub-agent is a named worker the orchestrator can delegate to through the `task`
// tool: its own system prompt, its own tool allowlist, and — the point of the whole
// feature — its own model, so a heavy planner can drive cheap search workers.
// Layer: Shared contracts
// Exports: sub-agent definition/snapshot schemas, CRUD input/result schemas.

import { Schema } from "effect";

import { TrimmedNonEmptyString } from "./baseSchemas";

/**
 * A worker the orchestrator may delegate to.
 *
 * `id` is the stable handle the model passes as `task.subagent`; `name` is only for the
 * settings list. An empty `model` means "inherit the session's model" — the UI shows that
 * as 继承默认, and it is the default so adding a sub-agent never silently changes which
 * model is billed.
 */
export const SubAgentDefinition = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  /** Shown in Settings and injected into the orchestrator's roster. */
  description: Schema.String,
  /**
   * Extra instructions prepended to every task this worker receives. Empty means the
   * worker runs with only the delegation prompt.
   */
  systemPrompt: Schema.String,
  /**
   * Tool names this worker may use. Empty means "the full agent tool set"; `explore`-style
   * read-only workers list the read tools explicitly.
   */
  tools: Schema.Array(Schema.String),
  /**
   * Model slug (as listed by the provider). Empty string = inherit the orchestrator's
   * model. Kept nullable so the client can round-trip "继承默认" without a magic value.
   */
  model: Schema.NullOr(Schema.String),
  /** Disabled workers stay in the list but are not offered to the orchestrator. */
  enabled: Schema.Boolean,
});
export type SubAgentDefinition = typeof SubAgentDefinition.Type;

/** What the Settings panel and the orchestrator roster read. */
export const SubAgentsSnapshot = Schema.Struct({
  subAgents: Schema.Array(SubAgentDefinition),
});
export type SubAgentsSnapshot = typeof SubAgentsSnapshot.Type;

export const SubAgentsListInput = Schema.Struct({});
export type SubAgentsListInput = typeof SubAgentsListInput.Type;

export const SubAgentsSavedInput = SubAgentsSnapshot;
export type SubAgentsSavedInput = typeof SubAgentsSavedInput.Type;

/** Upsert by `id`: create when the id is new, replace when it already exists. */
export const SubAgentsSaveInput = Schema.Struct({
  subAgent: SubAgentDefinition,
});
export type SubAgentsSaveInput = typeof SubAgentsSaveInput.Type;

export const SubAgentsDeleteInput = Schema.Struct({
  id: TrimmedNonEmptyString,
});
export type SubAgentsDeleteInput = typeof SubAgentsDeleteInput.Type;
