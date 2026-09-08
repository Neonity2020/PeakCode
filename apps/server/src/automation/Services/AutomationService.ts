import { Effect, ServiceMap } from "effect";

import {
  Automation,
  AutomationRun,
  CreateAutomationInput,
  DeleteAutomationInput,
  GetAutomationInput,
  ListAutomationRunsInput,
  ListAutomationsInput,
  RunAutomationInput,
  UpdateAutomationInput,
} from "@peakcode/contracts";

/**
 * AutomationServiceShape - Service API for automation management.
 */
export interface AutomationServiceShape {
  /**
   * Get an automation by id.
   */
  readonly getById: (input: GetAutomationInput) => Effect.Effect<Automation, Error>;

  /**
   * List automations for a project.
   */
  readonly listByProjectId: (
    input: ListAutomationsInput,
  ) => Effect.Effect<ReadonlyArray<Automation>, Error>;

  /**
   * Create a new automation.
   */
  readonly create: (input: CreateAutomationInput) => Effect.Effect<Automation, Error>;

  /**
   * Update an automation.
   */
  readonly update: (input: UpdateAutomationInput) => Effect.Effect<Automation, Error>;

  /**
   * Delete an automation.
   */
  readonly delete: (input: DeleteAutomationInput) => Effect.Effect<void, Error>;

  /**
   * Run an automation manually.
   */
  readonly run: (input: RunAutomationInput) => Effect.Effect<AutomationRun, Error>;

  /**
   * Get automation runs.
   */
  readonly listRuns: (
    input: ListAutomationRunsInput,
  ) => Effect.Effect<ReadonlyArray<AutomationRun>, Error>;

  /**
   * Start the automation scheduler.
   */
  readonly startScheduler: () => Effect.Effect<void, Error>;

  /**
   * Stop the automation scheduler.
   */
  readonly stopScheduler: () => Effect.Effect<void, Error>;
}

/**
 * AutomationService - Service tag for automation management.
 */
export class AutomationService extends ServiceMap.Service<
  AutomationService,
  AutomationServiceShape
>()("t3/services/AutomationService") {}
