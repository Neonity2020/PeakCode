import { Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";
import {
  Automation,
  AutomationId,
  AutomationRun,
  AutomationRunId,
  CreateAutomationInput,
  DeleteAutomationInput,
  GetAutomationInput,
  ListAutomationRunsInput,
  ListAutomationsInput,
  RunAutomationInput,
  ThreadId,
  UpdateAutomationInput,
} from "@peakcode/contracts";

export const GetAutomationInputSchema = GetAutomationInput;
export type GetAutomationInputSchema = typeof GetAutomationInputSchema.Type;

export const ListAutomationsInputSchema = ListAutomationsInput;
export type ListAutomationsInputSchema = typeof ListAutomationsInputSchema.Type;

export const CreateAutomationInputSchema = CreateAutomationInput;
export type CreateAutomationInputSchema = typeof CreateAutomationInputSchema.Type;

export const UpdateAutomationInputSchema = UpdateAutomationInput;
export type UpdateAutomationInputSchema = typeof UpdateAutomationInputSchema.Type;

export const DeleteAutomationInputSchema = DeleteAutomationInput;
export type DeleteAutomationInputSchema = typeof DeleteAutomationInputSchema.Type;

export const RunAutomationInputSchema = RunAutomationInput;
export type RunAutomationInputSchema = typeof RunAutomationInputSchema.Type;

export const ListAutomationRunsInputSchema = ListAutomationRunsInput;
export type ListAutomationRunsInputSchema = typeof ListAutomationRunsInputSchema.Type;

/**
 * AutomationRepositoryShape - Service API for automation persistence.
 */
export interface AutomationRepositoryShape {
  /**
   * Get an automation by id.
   */
  readonly getById: (
    input: GetAutomationInputSchema,
  ) => Effect.Effect<Automation, ProjectionRepositoryError>;

  /**
   * List automations for a project.
   */
  readonly listByProjectId: (
    input: ListAutomationsInputSchema,
  ) => Effect.Effect<ReadonlyArray<Automation>, ProjectionRepositoryError>;

  /**
   * List enabled cron automations for scheduler evaluation.
   */
  readonly listEnabledCron: () => Effect.Effect<
    ReadonlyArray<Automation>,
    ProjectionRepositoryError
  >;

  /**
   * Create a new automation.
   */
  readonly create: (
    input: CreateAutomationInputSchema,
  ) => Effect.Effect<Automation, ProjectionRepositoryError>;

  /**
   * Update an automation.
   */
  readonly update: (
    input: UpdateAutomationInputSchema,
  ) => Effect.Effect<Automation, ProjectionRepositoryError>;

  /**
   * Delete an automation.
   */
  readonly delete: (
    input: DeleteAutomationInputSchema,
  ) => Effect.Effect<void, ProjectionRepositoryError>;

  /**
   * Get automation runs.
   */
  readonly listRuns: (
    input: ListAutomationRunsInputSchema,
  ) => Effect.Effect<ReadonlyArray<AutomationRun>, ProjectionRepositoryError>;

  /**
   * Create an automation run.
   */
  readonly createRun: (
    automationId: AutomationId,
    status: "pending" | "running",
  ) => Effect.Effect<AutomationRun, ProjectionRepositoryError>;

  /**
   * Update an automation run status.
   */
  readonly updateRun: (
    runId: AutomationRunId,
    status: "completed" | "failed" | "cancelled",
    options?: { errorMessage?: string; threadId?: ThreadId; resultSummary?: string },
  ) => Effect.Effect<void, ProjectionRepositoryError>;

  /**
   * Update automation last run timestamp.
   */
  readonly updateLastRunAt: (
    automationId: AutomationId,
    lastRunAt: string,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

/**
 * AutomationRepository - Service tag for automation persistence.
 */
export class AutomationRepository extends ServiceMap.Service<
  AutomationRepository,
  AutomationRepositoryShape
>()("t3/persistence/Services/Automations/AutomationRepository") {}
