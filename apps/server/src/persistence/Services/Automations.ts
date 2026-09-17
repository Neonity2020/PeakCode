import { ServiceMap } from "effect";
import type { Effect, Option } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";
import {
  Automation,
  AutomationId,
  AutomationMode,
  AutomationRun,
  AutomationRunId,
  AutomationRunStatus,
  AutomationRunTrigger,
  AutomationSchedule,
  ProjectId,
  ThreadId,
} from "@peakcode/contracts";

/** A whole automation row: the plan plus the state the scheduler reads. */
export interface AutomationWrite {
  readonly automationId: AutomationId;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly instructions: string;
  readonly schedule: AutomationSchedule;
  readonly timezone: string;
  readonly mode: AutomationMode;
  readonly isEnabled: boolean;
  /** Next planned instant, or null while paused / spent. */
  readonly nextRunAt: string | null;
  readonly lastRunAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Scheduling state written after a run (or when a stale trigger is skipped). */
export interface AutomationScheduleStateWrite {
  readonly automationId: AutomationId;
  readonly nextRunAt: string | null;
  readonly isEnabled?: boolean;
  readonly lastRunAt?: string | null;
  readonly updatedAt: string;
}

export interface FinishAutomationRunWrite {
  readonly runId: AutomationRunId;
  readonly status: Exclude<AutomationRunStatus, "running">;
  readonly summary?: string | null;
  readonly errorMessage?: string | null;
}

/**
 * AutomationRepositoryShape - persistence for automations and their runs.
 */
export interface AutomationRepositoryShape {
  readonly getById: (input: {
    readonly automationId: AutomationId;
  }) => Effect.Effect<Automation, ProjectionRepositoryError>;

  /** Automations across every workspace, or just one when `projectId` is set. */
  readonly list: (input: {
    readonly projectId?: ProjectId | undefined;
  }) => Effect.Effect<ReadonlyArray<Automation>, ProjectionRepositoryError>;

  /** Enabled automations whose planned instant has arrived. */
  readonly listDue: (
    now: string,
  ) => Effect.Effect<ReadonlyArray<Automation>, ProjectionRepositoryError>;

  readonly create: (input: AutomationWrite) => Effect.Effect<Automation, ProjectionRepositoryError>;

  readonly update: (input: AutomationWrite) => Effect.Effect<Automation, ProjectionRepositoryError>;

  readonly delete: (input: {
    readonly automationId: AutomationId;
  }) => Effect.Effect<void, ProjectionRepositoryError>;

  readonly listRuns: (input: {
    readonly automationId: AutomationId;
    readonly limit: number;
  }) => Effect.Effect<ReadonlyArray<AutomationRun>, ProjectionRepositoryError>;

  /** Open a run row. The thread is attached separately, before dispatch. */
  readonly createRun: (input: {
    readonly automationId: AutomationId;
    readonly trigger: AutomationRunTrigger;
  }) => Effect.Effect<AutomationRun, ProjectionRepositoryError>;

  /** Record the conversation a run opened, so a crash cannot double-dispatch it. */
  readonly attachRunThread: (input: {
    readonly runId: AutomationRunId;
    readonly threadId: ThreadId;
  }) => Effect.Effect<void, ProjectionRepositoryError>;

  /** The run still marked running for an automation, if any. */
  readonly runningRunForAutomation: (
    automationId: AutomationId,
  ) => Effect.Effect<Option.Option<AutomationRun>, ProjectionRepositoryError>;

  /** The run still marked running for a conversation — how outcomes find their run. */
  readonly runningRunForThread: (
    threadId: ThreadId,
  ) => Effect.Effect<Option.Option<AutomationRun>, ProjectionRepositoryError>;

  readonly finishRun: (
    input: FinishAutomationRunWrite,
  ) => Effect.Effect<void, ProjectionRepositoryError>;

  /**
   * Close every run left open. Called once at startup, when nothing can be running any
   * more, so a crash mid-run cannot leave a task "in flight" forever.
   */
  readonly finishRunningRuns: (input: {
    readonly status: Exclude<AutomationRunStatus, "running">;
    readonly errorMessage: string;
  }) => Effect.Effect<void, ProjectionRepositoryError>;

  readonly saveScheduleState: (
    input: AutomationScheduleStateWrite,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

/**
 * AutomationRepository - Service tag for automation persistence.
 */
export class AutomationRepository extends ServiceMap.Service<
  AutomationRepository,
  AutomationRepositoryShape
>()("t3/persistence/Services/Automations/AutomationRepository") {}
