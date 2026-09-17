import { Schema } from "effect";
import { IsoDateTime, ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas";
import { ProviderInteractionMode } from "./orchestration";

export const AutomationId = TrimmedNonEmptyString.pipe(Schema.brand("AutomationId"));
export type AutomationId = typeof AutomationId.Type;

export const AutomationRunId = TrimmedNonEmptyString.pipe(Schema.brand("AutomationRunId"));
export type AutomationRunId = typeof AutomationRunId.Type;

/**
 * How a plan repeats. A one-off runs at `at` and then switches itself off; daily
 * and weekly repeat at a wall-clock time in the plan's timezone.
 */
export const AUTOMATION_SCHEDULE_KINDS = ["once", "daily", "weekly"] as const;
export const AutomationScheduleKind = Schema.Literals(AUTOMATION_SCHEDULE_KINDS);
export type AutomationScheduleKind = typeof AutomationScheduleKind.Type;

const HourOfDay = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 23 }));
const MinuteOfHour = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 59 }));
/** 0 = Sunday … 6 = Saturday, matching `Date.prototype.getDay()`. */
const WeekdayIndex = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 6 }));

export const AutomationOnceSchedule = Schema.Struct({
  kind: Schema.Literal("once"),
  /** ISO instant of the single run. */
  at: IsoDateTime,
});

export const AutomationDailySchedule = Schema.Struct({
  kind: Schema.Literal("daily"),
  hour: HourOfDay,
  minute: MinuteOfHour,
});

export const AutomationWeeklySchedule = Schema.Struct({
  kind: Schema.Literal("weekly"),
  hour: HourOfDay,
  minute: MinuteOfHour,
  /** Weekdays the plan repeats on; an empty list never fires. */
  daysOfWeek: Schema.Array(WeekdayIndex),
});

export const AutomationSchedule = Schema.Union([
  AutomationOnceSchedule,
  AutomationDailySchedule,
  AutomationWeeklySchedule,
]);
export type AutomationSchedule = typeof AutomationSchedule.Type;

/**
 * What a run's turn does: work directly (`default`), propose a plan without
 * touching the workspace (`plan`), or drive itself toward an acceptance
 * criterion (`goal`). Mirrors the composer's interaction modes.
 */
export const AutomationMode = ProviderInteractionMode;
export type AutomationMode = typeof AutomationMode.Type;

export const AUTOMATION_RUN_STATUSES = ["running", "succeeded", "failed", "interrupted"] as const;
export const AutomationRunStatus = Schema.Literals(AUTOMATION_RUN_STATUSES);
export type AutomationRunStatus = typeof AutomationRunStatus.Type;

export const AUTOMATION_RUN_TRIGGERS = ["scheduled", "manual"] as const;
export const AutomationRunTrigger = Schema.Literals(AUTOMATION_RUN_TRIGGERS);
export type AutomationRunTrigger = typeof AutomationRunTrigger.Type;

/**
 * A scheduled task: a plan, one instruction, and the workspace (project) it runs
 * in. Every run opens a real thread there, so the user can read the result and
 * keep asking follow-up questions in it.
 */
export const Automation = Schema.Struct({
  automationId: AutomationId,
  /** The workspace the runs happen in. */
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  /**
   * What the run should do, in the user's words. This is the message the agent
   * receives, so it has to stand on its own — nobody is around to clarify it.
   */
  instructions: TrimmedNonEmptyString,
  schedule: AutomationSchedule,
  /** IANA timezone the schedule's wall-clock times are read in. */
  timezone: Schema.String,
  mode: AutomationMode,
  isEnabled: Schema.Boolean,
  /** Next planned instant; null while paused or for a spent one-off. */
  nextRunAt: Schema.NullOr(IsoDateTime),
  lastRunAt: Schema.NullOr(IsoDateTime),
  /** Status of the most recent run, for the list card. */
  lastRunStatus: Schema.NullOr(AutomationRunStatus),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Automation = typeof Automation.Type;

/** One execution of an automation: the thread it ran in, and how it ended. */
export const AutomationRun = Schema.Struct({
  runId: AutomationRunId,
  automationId: AutomationId,
  trigger: AutomationRunTrigger,
  status: AutomationRunStatus,
  /** The conversation this run opened, once it was dispatched. */
  threadId: Schema.NullOr(ThreadId),
  /** First characters of the run's last assistant message. */
  summary: Schema.NullOr(Schema.String),
  errorMessage: Schema.NullOr(Schema.String),
  startedAt: IsoDateTime,
  finishedAt: Schema.NullOr(IsoDateTime),
});
export type AutomationRun = typeof AutomationRun.Type;

/** A workspace the user can point an automation at. */
export const AutomationWorkspace = Schema.Struct({
  projectId: ProjectId,
  projectTitle: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
});
export type AutomationWorkspace = typeof AutomationWorkspace.Type;

export const CreateAutomationInput = Schema.Struct({
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  instructions: TrimmedNonEmptyString,
  schedule: AutomationSchedule,
  /** Defaults to the server's timezone when absent. */
  timezone: Schema.optional(Schema.String),
  mode: Schema.optional(AutomationMode),
  isEnabled: Schema.optional(Schema.Boolean),
});
export type CreateAutomationInput = typeof CreateAutomationInput.Type;

export const UpdateAutomationInput = Schema.Struct({
  automationId: AutomationId,
  /** Moving an automation to another workspace. */
  projectId: Schema.optional(ProjectId),
  title: Schema.optional(TrimmedNonEmptyString),
  instructions: Schema.optional(TrimmedNonEmptyString),
  schedule: Schema.optional(AutomationSchedule),
  timezone: Schema.optional(Schema.String),
  mode: Schema.optional(AutomationMode),
  isEnabled: Schema.optional(Schema.Boolean),
});
export type UpdateAutomationInput = typeof UpdateAutomationInput.Type;

export const DeleteAutomationInput = Schema.Struct({
  automationId: AutomationId,
});
export type DeleteAutomationInput = typeof DeleteAutomationInput.Type;

export const ListAutomationsInput = Schema.Struct({
  /** Omit to list automations across every workspace. */
  projectId: Schema.optional(ProjectId),
});
export type ListAutomationsInput = typeof ListAutomationsInput.Type;

export const GetAutomationInput = Schema.Struct({
  automationId: AutomationId,
});
export type GetAutomationInput = typeof GetAutomationInput.Type;

/** Run an automation now, without waiting for its plan. */
export const RunAutomationInput = Schema.Struct({
  automationId: AutomationId,
});
export type RunAutomationInput = typeof RunAutomationInput.Type;

export const ListAutomationRunsInput = Schema.Struct({
  automationId: AutomationId,
  limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))),
});
export type ListAutomationRunsInput = typeof ListAutomationRunsInput.Type;
