/**
 * Scheduled tasks ("automations").
 *
 * A task is a plan plus one instruction plus the workspace it runs in. When the plan comes
 * due, the run opens a real thread in that workspace and sends it the instruction, so the
 * result is a conversation the user can read, continue, or hand to someone else — not a log
 * line. This is OmniStudio's automation model, rebuilt on the orchestration engine.
 *
 * Scheduling is deliberately small: one persisted `next_run_at` per task and a 30-second
 * sweep that compares it against the clock. The schedule math itself lives in
 * `@peakcode/shared/automationSchedule`, so the UI, the agent tool and this sweep all read
 * the same definitions. No job queue: a single-machine server has a handful of tasks at most.
 */
import { randomUUID } from "node:crypto";

import { computeNextRunAt, resolveTimeZone } from "@peakcode/shared/automationSchedule";
import { Cause, Effect, Exit, Layer, Option, Ref } from "effect";

import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { AutomationRepository } from "../../persistence/Services/Automations.ts";
import {
  Automation,
  AutomationId,
  AutomationRun,
  AutomationSchedule,
  CommandId,
  MessageId,
  ThreadId,
  type ModelSelection,
  type OrchestrationProjectShell,
  type OrchestrationThread,
} from "@peakcode/contracts";
import { getGoal, isTerminal, maxGoalContinuations } from "@peakcode/agent-toolkit/agent-goals";
import { threadConversationKey } from "../../agentToolkit.ts";
import { AutomationService, type AutomationServiceShape } from "../Services/AutomationService.ts";

const SCHEDULER_INTERVAL_MS = 30_000;
/**
 * A trigger missed by more than this is rolled forward instead of run: the server was
 * probably not running at the time, and firing yesterday's 09:00 briefing in the evening is
 * worse than skipping it. A one-off task is exempt — it has no next occurrence to roll to.
 */
const STALE_TRIGGER_MS = 6 * 60 * 60 * 1000;
/** How much of the run's closing message the run record keeps. */
const SUMMARY_MAX_LENGTH = 4_000;
const MAX_THREAD_TITLE_LENGTH = 120;
/** A scheduled run is unattended, so the workspace stays behind the approval gate. */
const RUN_RUNTIME_MODE = "approval-required" as const;
const FALLBACK_MODEL_SELECTION: ModelSelection = { provider: "pi", model: "pi/default" };

const newCommandId = () => CommandId.makeUnsafe(`cmd_${randomUUID()}`);
const newThreadId = () => ThreadId.makeUnsafe(`thread_${randomUUID()}`);
const newMessageId = () => MessageId.makeUnsafe(`msg_${randomUUID()}`);

const describeCause = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

/** The message to record for a dispatch that failed or was interrupted. */
const failureMessageOf = (cause: Cause.Cause<unknown>): string => {
  const errors = Cause.prettyErrors(cause);
  return errors.length > 0 ? errors[0]!.message : "The dispatch was interrupted.";
};

/** `computeNextRunAt` speaks milliseconds; the column stores ISO instants. */
const isoStringOf = (timestamp: number | null): string | null =>
  timestamp === null ? null : new Date(timestamp).toISOString();

const runThreadTitle = (automation: Automation): string =>
  `自动化：${automation.title}`.slice(0, MAX_THREAD_TITLE_LENGTH);

/** Reject plans that could never fire, instead of quietly storing a dead task. */
export function validateSchedule(schedule: AutomationSchedule, now: number): string | null {
  if (schedule.kind === "once") {
    const at = Date.parse(schedule.at);
    if (!Number.isFinite(at)) return "The one-off time could not be read.";
    if (at <= now) return "A one-off task needs a time in the future.";
    return null;
  }
  if (schedule.kind === "weekly" && schedule.daysOfWeek.length === 0) {
    return "Pick at least one weekday.";
  }
  return null;
}

/**
 * Whether the agent still has turns left for this thread's goal.
 *
 * A goal-mode run is not over when its first turn ends: the continuation reactor keeps
 * sending turns until the goal is complete, dropped, or out of continuation budget. Closing
 * the run at the first turn boundary would report success for work that is still going.
 */
const goalStillRunning = (threadId: ThreadId): boolean => {
  const goal = getGoal(threadConversationKey(threadId));
  if (goal === null || isTerminal(goal.status)) return false;
  return goal.continuations < maxGoalContinuations();
};

const lastAssistantMessage = (detail: Option.Option<OrchestrationThread>): string | null => {
  if (Option.isNone(detail)) return null;
  const message = [...detail.value.messages]
    .toReversed()
    .find((candidate) => candidate.role === "assistant" && candidate.text.trim().length > 0);
  return message === undefined ? null : message.text.trim().slice(0, SUMMARY_MAX_LENGTH);
};

const sessionErrorOf = (detail: Option.Option<OrchestrationThread>): string | null =>
  Option.isNone(detail) ? null : (detail.value.session?.lastError ?? null);

const makeAutomationService = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const repository = yield* AutomationRepository;

  const schedulerIntervalRef = yield* Ref.make<Option.Option<ReturnType<typeof setInterval>>>(
    Option.none(),
  );
  const schedulerRunningRef = yield* Ref.make(false);
  /** A sweep can outlive its interval while a run starts, so it never re-enters. */
  const sweepingRef = yield* Ref.make(false);

  const repositoryError = (operation: string) => (cause: unknown) =>
    new Error(`${operation}: ${describeCause(cause)}`);

  const requireProject = (projectId: Automation["projectId"]) =>
    projectionSnapshotQuery.getProjectShellById(projectId).pipe(
      Effect.mapError(repositoryError("Failed to read the workspace")),
      Effect.flatMap((projectOption) =>
        Option.match(projectOption, {
          onNone: () =>
            Effect.fail(new Error(`Workspace '${projectId}' no longer exists — pick another one.`)),
          onSome: (project) => Effect.succeed(project),
        }),
      ),
    );

  const getById: AutomationServiceShape["getById"] = (input) =>
    repository.getById(input).pipe(Effect.mapError(repositoryError("Failed to read the task")));

  const list: AutomationServiceShape["list"] = (input) =>
    repository.list(input).pipe(Effect.mapError(repositoryError("Failed to list tasks")));

  const create: AutomationServiceShape["create"] = (input) =>
    Effect.gen(function* () {
      const now = Date.now();
      const invalid = validateSchedule(input.schedule, now);
      if (invalid !== null) return yield* Effect.fail(new Error(invalid));
      // Fails with a readable message when the workspace is gone, instead of letting the
      // insert trip the foreign key.
      yield* requireProject(input.projectId);

      const timestamp = new Date(now).toISOString();
      const timezone = resolveTimeZone(input.timezone);
      const isEnabled = input.isEnabled ?? true;
      return yield* repository
        .create({
          automationId: AutomationId.makeUnsafe(`automation_${randomUUID()}`),
          projectId: input.projectId,
          title: input.title,
          instructions: input.instructions,
          schedule: input.schedule,
          timezone,
          mode: input.mode ?? "default",
          isEnabled,
          nextRunAt: isEnabled
            ? isoStringOf(computeNextRunAt(input.schedule, timezone, now))
            : null,
          lastRunAt: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .pipe(Effect.mapError(repositoryError("Failed to create the task")));
    });

  const update: AutomationServiceShape["update"] = (input) =>
    Effect.gen(function* () {
      const existing = yield* getById({ automationId: input.automationId });
      const now = Date.now();
      const schedule = input.schedule ?? existing.schedule;
      const timezone = resolveTimeZone(input.timezone ?? existing.timezone);
      const isEnabled = input.isEnabled ?? existing.isEnabled;
      const projectId = input.projectId ?? existing.projectId;

      // Validated whenever the plan is (re)written or the task is turned back on: a
      // re-enabled one-off whose instant has passed would otherwise sit there never firing.
      if (input.schedule !== undefined || input.isEnabled === true) {
        const invalid = validateSchedule(schedule, now);
        if (invalid !== null) return yield* Effect.fail(new Error(invalid));
      }
      if (projectId !== existing.projectId) yield* requireProject(projectId);

      return yield* repository
        .update({
          automationId: existing.automationId,
          projectId,
          title: input.title ?? existing.title,
          instructions: input.instructions ?? existing.instructions,
          schedule,
          timezone,
          mode: input.mode ?? existing.mode,
          isEnabled,
          // Rewriting the plan or re-enabling recomputes the next instant; a paused task has
          // none, which is also what keeps it out of the scheduler's query.
          nextRunAt: isEnabled ? isoStringOf(computeNextRunAt(schedule, timezone, now)) : null,
          lastRunAt: existing.lastRunAt,
          createdAt: existing.createdAt,
          updatedAt: new Date(now).toISOString(),
        })
        .pipe(Effect.mapError(repositoryError("Failed to save the task")));
    });

  const deleteAutomation: AutomationServiceShape["delete"] = (input) =>
    repository.delete(input).pipe(Effect.mapError(repositoryError("Failed to delete the task")));

  const listRuns: AutomationServiceShape["listRuns"] = (input) =>
    repository
      .listRuns({ automationId: input.automationId, limit: input.limit ?? 20 })
      .pipe(Effect.mapError(repositoryError("Failed to list runs")));

  const readThreadDetail = (threadId: ThreadId) =>
    projectionSnapshotQuery
      .getThreadDetailById(threadId)
      .pipe(Effect.orElseSucceed(() => Option.none<OrchestrationThread>()));

  /**
   * Open the run's thread and hand it the instruction.
   *
   * The thread lives in the automation's workspace and carries the automation's mode, so a
   * Plan task only proposes and a Goal task keeps itself going. The model selection follows
   * the workspace default, exactly like a new chat opened there by hand.
   */
  const dispatchRun = (
    automation: Automation,
    project: OrchestrationProjectShell,
    threadId: ThreadId,
  ) => {
    const createdAt = new Date().toISOString();
    const modelSelection = project.defaultModelSelection ?? FALLBACK_MODEL_SELECTION;
    return Effect.gen(function* () {
      yield* orchestrationEngine.dispatch({
        type: "thread.create",
        commandId: newCommandId(),
        threadId,
        projectId: automation.projectId,
        title: runThreadTitle(automation),
        modelSelection,
        runtimeMode: RUN_RUNTIME_MODE,
        interactionMode: automation.mode,
        envMode: "local",
        branch: null,
        worktreePath: null,
        createdAt,
      });

      yield* orchestrationEngine.dispatch({
        type: "thread.turn.start",
        commandId: newCommandId(),
        threadId,
        message: {
          messageId: newMessageId(),
          role: "user",
          text: automation.instructions,
          attachments: [],
        },
        modelSelection,
        assistantDeliveryMode: "streaming",
        dispatchMode: "queue",
        runtimeMode: RUN_RUNTIME_MODE,
        interactionMode: automation.mode,
        createdAt,
      });
    }).pipe(
      Effect.mapError((cause) => new Error(`Failed to start the run: ${describeCause(cause)}`)),
    );
  };

  /** Start one run. Manual runs work on a paused task; the plan advances either way. */
  const runAutomation = (automationId: AutomationId, trigger: AutomationRun["trigger"]) =>
    Effect.gen(function* () {
      const automation = yield* getById({ automationId });
      const running = yield* repository
        .runningRunForAutomation(automationId)
        .pipe(Effect.orElseSucceed(() => Option.none()));
      if (Option.isSome(running)) {
        return yield* Effect.fail(new Error(`"${automation.title}" is already running.`));
      }

      const project = yield* requireProject(automation.projectId);
      const run = yield* repository
        .createRun({ automationId, trigger })
        .pipe(Effect.mapError(repositoryError("Failed to open a run")));

      // The claim is persisted before the dispatch. A crash in between leaves a run record
      // pointing at a thread that never started — which the next startup releases — instead
      // of letting the same plan fire twice.
      const threadId = newThreadId();
      yield* repository
        .attachRunThread({ runId: run.runId, threadId })
        .pipe(Effect.mapError(repositoryError("Failed to record the run's thread")));

      const startedAt = new Date().toISOString();
      const dispatchExit = yield* dispatchRun(automation, project, threadId).pipe(Effect.exit);

      // Advance the plan even when the dispatch failed: a task whose model is broken must
      // not retry every 30 seconds for the rest of the day.
      const spent = automation.schedule.kind === "once";
      yield* repository
        .saveScheduleState({
          automationId,
          nextRunAt: spent
            ? null
            : isoStringOf(computeNextRunAt(automation.schedule, automation.timezone, Date.now())),
          lastRunAt: startedAt,
          // A one-off has had its one moment (planned or run by hand): it is spent, and
          // leaving it enabled would fire it a second time on the next start.
          ...(spent ? { isEnabled: false } : {}),
          updatedAt: startedAt,
        })
        .pipe(
          Effect.catch((cause) =>
            Effect.logWarning("failed to advance the automation schedule", {
              automationId,
              cause: describeCause(cause),
            }),
          ),
        );

      if (Exit.isFailure(dispatchExit)) {
        const message = failureMessageOf(dispatchExit.cause);
        yield* repository
          .finishRun({ runId: run.runId, status: "failed", errorMessage: message })
          .pipe(Effect.orElseSucceed(() => undefined));
        return yield* Effect.fail(new Error(message));
      }

      return { ...run, threadId } satisfies AutomationRun;
    });

  const run: AutomationServiceShape["run"] = (input) =>
    runAutomation(input.automationId, "manual").pipe(
      Effect.mapError(repositoryError("Failed to run the task")),
    );

  const recordRunOutcome: AutomationServiceShape["recordRunOutcome"] = (input) =>
    Effect.gen(function* () {
      const running = yield* repository
        .runningRunForThread(input.threadId)
        .pipe(Effect.orElseSucceed(() => Option.none()));
      if (Option.isNone(running)) return;

      // A goal run keeps working past this turn; wait until the goal settles.
      if (input.outcome === "succeeded" && goalStillRunning(input.threadId)) return;

      const detail = yield* readThreadDetail(input.threadId);
      yield* repository
        .finishRun({
          runId: running.value.runId,
          status: input.outcome,
          summary: input.outcome === "succeeded" ? lastAssistantMessage(detail) : null,
          errorMessage: input.outcome === "succeeded" ? null : sessionErrorOf(detail),
        })
        .pipe(
          Effect.catch((cause) =>
            Effect.logWarning("failed to record an automation run outcome", {
              threadId: input.threadId,
              cause: describeCause(cause),
            }),
          ),
        );
    });

  const releaseStaleRuns: AutomationServiceShape["releaseStaleRuns"] = Effect.gen(function* () {
    yield* repository.finishRunningRuns({
      status: "interrupted",
      errorMessage: "The server stopped while this run was in flight.",
    });
  }).pipe(
    Effect.catch((cause) =>
      Effect.logWarning("failed to release stale automation runs", {
        cause: describeCause(cause),
      }),
    ),
  );

  const sweepDue = (now: number) =>
    Effect.gen(function* () {
      const due = yield* repository.listDue(new Date(now).toISOString());
      yield* Effect.forEach(
        due,
        (automation) =>
          Effect.gen(function* () {
            const nextRunAt = automation.nextRunAt;
            if (nextRunAt === null) return;
            if (
              now - Date.parse(nextRunAt) > STALE_TRIGGER_MS &&
              automation.schedule.kind !== "once"
            ) {
              yield* repository
                .saveScheduleState({
                  automationId: automation.automationId,
                  nextRunAt: isoStringOf(
                    computeNextRunAt(automation.schedule, automation.timezone, now),
                  ),
                  lastRunAt: nextRunAt,
                  updatedAt: new Date(now).toISOString(),
                })
                .pipe(Effect.orElseSucceed(() => undefined));
              return;
            }
            yield* runAutomation(automation.automationId, "scheduled").pipe(
              Effect.catch((cause) =>
                Effect.logWarning("scheduled automation run failed to start", {
                  automationId: automation.automationId,
                  cause: describeCause(cause),
                }),
              ),
            );
          }),
        // One at a time: a local model server is the bottleneck these runs share.
        { concurrency: 1, discard: true },
      );
    });

  const runDue: AutomationServiceShape["runDue"] = (now) =>
    sweepDue(now ?? Date.now()).pipe(Effect.mapError(repositoryError("Failed to sweep due tasks")));

  /** The scheduler's own tick, guarded so a slow sweep cannot overlap itself. */
  const sweepOnce = (now: number) =>
    Effect.gen(function* () {
      const sweeping = yield* Ref.get(sweepingRef);
      if (sweeping) return;
      yield* Ref.set(sweepingRef, true);
      yield* sweepDue(now).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("automation sweep failed", { cause: String(cause) }),
        ),
        Effect.ensuring(Ref.set(sweepingRef, false)),
      );
    });

  const startScheduler: AutomationServiceShape["startScheduler"] = () =>
    Effect.gen(function* () {
      const running = yield* Ref.get(schedulerRunningRef);
      if (running) return;
      yield* Ref.set(schedulerRunningRef, true);

      yield* sweepOnce(Date.now());
      const interval = setInterval(() => {
        void Effect.runPromise(sweepOnce(Date.now())).catch(() => undefined);
      }, SCHEDULER_INTERVAL_MS);
      yield* Ref.set(schedulerIntervalRef, Option.some(interval));
    });

  const stopScheduler: AutomationServiceShape["stopScheduler"] = () =>
    Effect.gen(function* () {
      const interval = yield* Ref.getAndSet(schedulerIntervalRef, Option.none());
      if (Option.isSome(interval)) clearInterval(interval.value);
      yield* Ref.set(schedulerRunningRef, false);
    });

  return AutomationService.of({
    getById,
    list,
    create,
    update,
    delete: deleteAutomation,
    run,
    listRuns,
    recordRunOutcome,
    releaseStaleRuns,
    runDue,
    startScheduler,
    stopScheduler,
  } satisfies AutomationServiceShape);
});

export const AutomationServiceLive = Layer.effect(AutomationService, makeAutomationService);
