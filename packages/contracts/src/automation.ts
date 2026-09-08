import { Schema } from "effect";
import { IsoDateTime, ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas";

export const AutomationId = TrimmedNonEmptyString.pipe(Schema.brand("AutomationId"));
export type AutomationId = typeof AutomationId.Type;

export const AutomationRunId = TrimmedNonEmptyString.pipe(Schema.brand("AutomationRunId"));
export type AutomationRunId = typeof AutomationRunId.Type;

export const AutomationScheduleType = Schema.Literals(["cron", "manual"]);
export type AutomationScheduleType = typeof AutomationScheduleType.Type;

export const AutomationRunStatus = Schema.Literals([
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
]);
export type AutomationRunStatus = typeof AutomationRunStatus.Type;

export const Automation = Schema.Struct({
  automationId: AutomationId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  description: Schema.String,
  prompt: TrimmedNonEmptyString,
  scriptId: Schema.NullOr(Schema.String),
  scriptName: Schema.NullOr(Schema.String),
  scriptCommand: Schema.NullOr(Schema.String),
  scheduleType: AutomationScheduleType,
  cronExpression: Schema.NullOr(Schema.String),
  timezone: Schema.String,
  isEnabled: Schema.Boolean,
  templateId: Schema.NullOr(Schema.String),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  lastRunAt: Schema.NullOr(IsoDateTime),
});
export type Automation = typeof Automation.Type;

export const AutomationRun = Schema.Struct({
  runId: AutomationRunId,
  automationId: AutomationId,
  status: AutomationRunStatus,
  startedAt: IsoDateTime,
  completedAt: Schema.NullOr(IsoDateTime),
  errorMessage: Schema.NullOr(Schema.String),
  threadId: Schema.NullOr(ThreadId),
  resultSummary: Schema.NullOr(Schema.String),
});
export type AutomationRun = typeof AutomationRun.Type;

export const CreateAutomationInput = Schema.Struct({
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  description: Schema.String,
  prompt: TrimmedNonEmptyString,
  scriptId: Schema.optional(Schema.NullOr(Schema.String)),
  scriptName: Schema.optional(Schema.NullOr(Schema.String)),
  scriptCommand: Schema.optional(Schema.NullOr(Schema.String)),
  scheduleType: AutomationScheduleType,
  cronExpression: Schema.NullOr(Schema.String),
  timezone: Schema.String,
  templateId: Schema.NullOr(Schema.String),
});
export type CreateAutomationInput = typeof CreateAutomationInput.Type;

export const UpdateAutomationInput = Schema.Struct({
  automationId: AutomationId,
  title: Schema.optional(TrimmedNonEmptyString),
  description: Schema.optional(Schema.String),
  prompt: Schema.optional(TrimmedNonEmptyString),
  scriptId: Schema.optional(Schema.NullOr(Schema.String)),
  scriptName: Schema.optional(Schema.NullOr(Schema.String)),
  scriptCommand: Schema.optional(Schema.NullOr(Schema.String)),
  scheduleType: Schema.optional(AutomationScheduleType),
  cronExpression: Schema.optional(Schema.NullOr(Schema.String)),
  timezone: Schema.optional(Schema.String),
  isEnabled: Schema.optional(Schema.Boolean),
});
export type UpdateAutomationInput = typeof UpdateAutomationInput.Type;

export const DeleteAutomationInput = Schema.Struct({
  automationId: AutomationId,
});
export type DeleteAutomationInput = typeof DeleteAutomationInput.Type;

export const ListAutomationsInput = Schema.Struct({
  projectId: ProjectId,
});
export type ListAutomationsInput = typeof ListAutomationsInput.Type;

export const GetAutomationInput = Schema.Struct({
  automationId: AutomationId,
});
export type GetAutomationInput = typeof GetAutomationInput.Type;

export const RunAutomationInput = Schema.Struct({
  automationId: AutomationId,
});
export type RunAutomationInput = typeof RunAutomationInput.Type;

export const ListAutomationRunsInput = Schema.Struct({
  automationId: AutomationId,
});
export type ListAutomationRunsInput = typeof ListAutomationRunsInput.Type;

export const AutomationWithRuns = Schema.Struct({
  automation: Automation,
  recentRuns: Schema.Array(AutomationRun),
});
export type AutomationWithRuns = typeof AutomationWithRuns.Type;
