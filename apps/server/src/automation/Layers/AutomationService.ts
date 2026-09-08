import { randomUUID } from "node:crypto";

import { Effect, Layer, Option, Ref } from "effect";

import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { AutomationRepository } from "../../persistence/Services/Automations.ts";
import {
  Automation,
  AutomationId,
  AutomationRun,
  CommandId,
  MessageId,
  ThreadId,
  type ModelSelection,
} from "@peakcode/contracts";
import { AutomationService, type AutomationServiceShape } from "../Services/AutomationService.ts";

const makeId = (prefix: string) => `${prefix}_${randomUUID()}`;

const newCommandId = () => CommandId.makeUnsafe(makeId("cmd"));
const newThreadId = () => ThreadId.makeUnsafe(makeId("thread"));
const newMessageId = () => MessageId.makeUnsafe(makeId("msg"));

const fallbackModelSelection = (): ModelSelection => ({
  provider: "pi",
  model: "pi/default",
});

interface ZonedDateParts {
  readonly minute: number;
  readonly hour: number;
  readonly dayOfMonth: number;
  readonly month: number;
  readonly dayOfWeek: number;
  readonly minuteKey: string;
}

function getZonedDateParts(date: Date, timeZone: string): ZonedDateParts | null {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    const parts = Object.fromEntries(
      formatter.formatToParts(date).map((part) => [part.type, part.value]),
    );
    const year = Number(parts.year);
    const month = Number(parts.month);
    const dayOfMonth = Number(parts.day);
    const hour = Number(parts.hour);
    const minute = Number(parts.minute);
    if (
      !Number.isFinite(year) ||
      !Number.isFinite(month) ||
      !Number.isFinite(dayOfMonth) ||
      !Number.isFinite(hour) ||
      !Number.isFinite(minute)
    ) {
      return null;
    }

    return {
      minute,
      hour,
      dayOfMonth,
      month,
      dayOfWeek: new Date(Date.UTC(year, month - 1, dayOfMonth)).getUTCDay(),
      minuteKey: `${year}-${String(month).padStart(2, "0")}-${String(dayOfMonth).padStart(
        2,
        "0",
      )}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    };
  } catch {
    return null;
  }
}

function expandCronField(field: string, min: number, max: number): Set<number> | null {
  const values = new Set<number>();
  for (const rawPart of field.split(",")) {
    const part = rawPart.trim();
    if (!part) return null;

    const [rangePart, stepPart] = part.split("/");
    const step = stepPart === undefined ? 1 : Number(stepPart);
    if (!Number.isInteger(step) || step < 1) return null;

    let start: number;
    let end: number;
    if (rangePart === "*") {
      start = min;
      end = max;
    } else if (rangePart?.includes("-")) {
      const [rawStart, rawEnd] = rangePart.split("-");
      start = Number(rawStart);
      end = Number(rawEnd);
    } else {
      start = Number(rangePart);
      end = start;
    }

    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < min ||
      end > max ||
      start > end
    ) {
      return null;
    }

    for (let value = start; value <= end; value += step) {
      values.add(value);
    }
  }
  return values;
}

function cronFieldMatches(field: string, value: number, min: number, max: number): boolean {
  return expandCronField(field, min, max)?.has(value) ?? false;
}

function dayOfWeekMatches(field: string, value: number): boolean {
  const expanded = expandCronField(field, 0, 7);
  if (!expanded) return false;
  return expanded.has(value) || (value === 0 && expanded.has(7));
}

export function isAutomationDueNow(automation: Automation, now: Date): boolean {
  if (automation.scheduleType !== "cron" || !automation.cronExpression || !automation.isEnabled) {
    return false;
  }
  const fields = automation.cronExpression.trim().split(/\s+/);
  if (fields.length !== 5) return false;

  const parts = getZonedDateParts(now, automation.timezone || "UTC");
  if (!parts) return false;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  const lastRunParts = automation.lastRunAt
    ? getZonedDateParts(new Date(automation.lastRunAt), automation.timezone || "UTC")
    : null;
  if (lastRunParts?.minuteKey === parts.minuteKey) return false;

  return (
    cronFieldMatches(minute!, parts.minute, 0, 59) &&
    cronFieldMatches(hour!, parts.hour, 0, 23) &&
    cronFieldMatches(dayOfMonth!, parts.dayOfMonth, 1, 31) &&
    cronFieldMatches(month!, parts.month, 1, 12) &&
    dayOfWeekMatches(dayOfWeek!, parts.dayOfWeek)
  );
}

const makeAutomationService = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const repository = yield* AutomationRepository;
  const schedulerIntervalRef = yield* Ref.make<Option.Option<ReturnType<typeof setInterval>>>(
    Option.none(),
  );
  const schedulerRunningRef = yield* Ref.make(false);

  const getById = (input: { readonly automationId: AutomationId }) =>
    repository
      .getById(input)
      .pipe(Effect.mapError((error) => new Error(`Failed to get automation: ${String(error)}`)));

  const listByProjectId: AutomationServiceShape["listByProjectId"] = (input) =>
    repository
      .listByProjectId(input)
      .pipe(Effect.mapError((error) => new Error(`Failed to list automations: ${String(error)}`)));

  const create: AutomationServiceShape["create"] = (input) =>
    repository
      .create(input)
      .pipe(Effect.mapError((error) => new Error(`Failed to create automation: ${String(error)}`)));

  const update: AutomationServiceShape["update"] = (input) =>
    repository
      .update(input)
      .pipe(Effect.mapError((error) => new Error(`Failed to update automation: ${String(error)}`)));

  const deleteAutomation: AutomationServiceShape["delete"] = (input) =>
    repository
      .delete(input)
      .pipe(Effect.mapError((error) => new Error(`Failed to delete automation: ${String(error)}`)));

  const dispatchAutomationRun = (automation: Automation, runRecord: AutomationRun, now: string) =>
    Effect.gen(function* () {
      const projectOption = yield* projectionSnapshotQuery.getProjectShellById(
        automation.projectId,
      );
      const project = Option.getOrUndefined(projectOption);
      if (!project) {
        return yield* Effect.fail(new Error(`Project '${automation.projectId}' was not found.`));
      }

      const threadId = newThreadId();
      const modelSelection = project.defaultModelSelection ?? fallbackModelSelection();

      yield* orchestrationEngine.dispatch({
        type: "thread.create",
        commandId: newCommandId(),
        threadId,
        projectId: automation.projectId,
        title: automation.title,
        modelSelection,
        runtimeMode: "approval-required",
        interactionMode: "default",
        envMode: "local",
        branch: null,
        worktreePath: null,
        createdAt: now,
      });

      // Always dispatch a real assistant turn so the automation runs through the
      // project's active provider session (e.g. Pi) instead of spawning a raw
      // agent shell. The previous scriptCommand branch only imported a
      // static user message and ran a terminal, which never started the agent.
      yield* orchestrationEngine.dispatch({
        type: "thread.turn.start",
        commandId: newCommandId(),
        threadId,
        message: {
          messageId: newMessageId(),
          role: "user",
          text: automation.prompt,
          attachments: [],
        },
        modelSelection,
        assistantDeliveryMode: "streaming",
        dispatchMode: "queue",
        runtimeMode: "approval-required",
        interactionMode: "default",
        createdAt: now,
      });

      yield* repository.updateRun(runRecord.runId, "completed", {
        threadId,
        resultSummary: `Started automation thread ${threadId}`,
      });
      return {
        ...runRecord,
        status: "completed" as const,
        completedAt: new Date().toISOString(),
        threadId,
        resultSummary: `Started automation thread ${threadId}`,
      } satisfies AutomationRun;
    });

  const run: AutomationServiceShape["run"] = (input) =>
    Effect.gen(function* () {
      const automation = yield* repository.getById({ automationId: input.automationId });
      const runRecord = yield* repository.createRun(input.automationId, "running");
      const now = new Date().toISOString();
      yield* repository.updateLastRunAt(input.automationId, now);

      return yield* dispatchAutomationRun(automation, runRecord, now).pipe(
        Effect.catch((error) =>
          repository
            .updateRun(runRecord.runId, "failed", {
              errorMessage: error instanceof Error ? error.message : String(error),
            })
            .pipe(Effect.flatMap(() => Effect.fail(error))),
        ),
      );
    }).pipe(Effect.mapError((error) => new Error(`Failed to run automation: ${String(error)}`)));

  const listRuns: AutomationServiceShape["listRuns"] = (input) =>
    repository
      .listRuns(input)
      .pipe(
        Effect.mapError((error) => new Error(`Failed to list automation runs: ${String(error)}`)),
      );

  const runDueAutomations = (now: Date) =>
    Effect.gen(function* () {
      const automations = yield* repository.listEnabledCron();
      yield* Effect.forEach(
        automations.filter((automation) => isAutomationDueNow(automation, now)),
        (automation) =>
          run({ automationId: automation.automationId }).pipe(
            Effect.catch((error) =>
              Effect.logWarning("scheduled automation run failed", {
                automationId: automation.automationId,
                error,
              }),
            ),
          ),
        { concurrency: 1, discard: true },
      );
    });

  const startScheduler: AutomationServiceShape["startScheduler"] = () =>
    Effect.gen(function* () {
      const isRunning = yield* Ref.get(schedulerRunningRef);
      if (isRunning) return;

      yield* runDueAutomations(new Date()).pipe(
        Effect.catch((error) =>
          Effect.logWarning("initial automation scheduler tick failed", { error }),
        ),
      );

      const interval = setInterval(() => {
        void Effect.runPromise(
          runDueAutomations(new Date()).pipe(
            Effect.catch((error) =>
              Effect.logWarning("automation scheduler tick failed", { error }),
            ),
          ),
        ).catch(() => undefined);
      }, 60 * 1000);

      yield* Ref.set(schedulerIntervalRef, Option.some(interval));
      yield* Ref.set(schedulerRunningRef, true);
    }).pipe(Effect.mapError((error) => new Error(`Failed to start scheduler: ${String(error)}`)));

  const stopScheduler: AutomationServiceShape["stopScheduler"] = () =>
    Effect.gen(function* () {
      const intervalOption = yield* Ref.get(schedulerIntervalRef);
      if (Option.isSome(intervalOption)) {
        clearInterval(intervalOption.value);
      }
      yield* Ref.set(schedulerIntervalRef, Option.none());
      yield* Ref.set(schedulerRunningRef, false);
    }).pipe(Effect.mapError((error) => new Error(`Failed to stop scheduler: ${String(error)}`)));

  return AutomationService.of({
    getById,
    listByProjectId,
    create,
    update,
    delete: deleteAutomation,
    run,
    listRuns,
    startScheduler,
    stopScheduler,
  });
});

export const AutomationServiceLive = Layer.effect(AutomationService, makeAutomationService);
