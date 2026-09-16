import * as Schema from "effect/Schema";

import { IsoDateTime, ThreadId, TrimmedNonEmptyString } from "./baseSchemas";

/**
 * Goal-mode state, as the UI needs it.
 *
 * The goal itself lives in the agent toolkit's store on the server (`agent_goals`, one row
 * per thread) and is driven by the `goal` tool. This is a read projection for the composer's
 * goal panel, plus the one write the panel offers: pause / resume / complete / drop.
 */
export const AgentGoalStatus = Schema.Literals([
  "active",
  "paused",
  "budget-limited",
  "complete",
  "dropped",
]);
export type AgentGoalStatus = typeof AgentGoalStatus.Type;

export const AgentGoalView = Schema.Struct({
  threadId: ThreadId,
  objective: TrimmedNonEmptyString,
  acceptance: Schema.NullOr(Schema.String),
  status: AgentGoalStatus,
  /** `null` = no token budget set. */
  tokenBudget: Schema.NullOr(Schema.Number),
  tokensUsed: Schema.Number,
  secondsUsed: Schema.Number,
  /** How many turns the harness has added on its own. */
  continuations: Schema.Number,
  /** The cap `continuations` is measured against (`AGENT_GOAL_MAX_CONTINUATIONS`). */
  maxContinuations: Schema.Number,
  outcome: Schema.NullOr(Schema.String),
  updatedAt: IsoDateTime,
});
export type AgentGoalView = typeof AgentGoalView.Type;

export const AgentGoalGetInput = Schema.Struct({ threadId: ThreadId });
export type AgentGoalGetInput = typeof AgentGoalGetInput.Type;

export const AgentGoalGetResult = Schema.Struct({
  goal: Schema.NullOr(AgentGoalView),
});
export type AgentGoalGetResult = typeof AgentGoalGetResult.Type;

/** The states a user can move a goal to from the panel. `budget-limited` is set by the server. */
export const AgentGoalUserStatus = Schema.Literals(["active", "paused", "complete", "dropped"]);
export type AgentGoalUserStatus = typeof AgentGoalUserStatus.Type;

export const AgentGoalSetStatusInput = Schema.Struct({
  threadId: ThreadId,
  status: AgentGoalUserStatus,
  /** Optional closing note; recorded on `complete` / `dropped`. */
  outcome: Schema.optional(Schema.String),
});
export type AgentGoalSetStatusInput = typeof AgentGoalSetStatusInput.Type;

export const AgentGoalSetStatusResult = Schema.Struct({
  goal: Schema.NullOr(AgentGoalView),
});
export type AgentGoalSetStatusResult = typeof AgentGoalSetStatusResult.Type;
