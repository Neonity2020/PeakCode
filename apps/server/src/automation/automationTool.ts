/**
 * The bridge that lets the agent schedule work from a conversation.
 *
 * When someone says "every morning, summarise what changed here", the model calls the
 * toolkit's `schedule_task` tool. The toolkit only declares that tool — it has no idea what
 * an automation is and never touches Effect services — so the host (this module) supplies
 * the implementation and translates tool arguments into `AutomationService` calls.
 *
 * The host is installed once at server startup, the same way the toolkit's store and log
 * sink are. That keeps the provider layer free of an automation dependency: `PiAdapter`
 * only asks for the tool's callback, never for the service behind it.
 */
import { Effect, Option } from "effect";

import {
  errorResult,
  textResult,
  type ScheduleTaskToolParams,
  type ToolOutcome,
} from "@peakcode/agent-toolkit/agent-tools";
import { describeSchedule } from "@peakcode/shared/automationSchedule";

import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { AutomationService } from "./Services/AutomationService.ts";
import {
  AutomationId,
  type Automation,
  type AutomationMode,
  type AutomationSchedule,
  type ProjectId,
  type ThreadId,
} from "@peakcode/contracts";

export interface AutomationToolHost {
  /** Run one `schedule_task` tool call for the thread it was made in. */
  readonly scheduleTask: (input: {
    readonly threadId: ThreadId;
    readonly params: ScheduleTaskToolParams;
  }) => Promise<ToolOutcome>;
}

let installedHost: AutomationToolHost | null = null;

/** Install the host the tool callback resolves against. Called once per server start. */
export function setAutomationToolHost(host: AutomationToolHost | null): void {
  installedHost = host;
}

/**
 * Schedule a task from the conversation the call was made in.
 *
 * Wired as the toolkit's `onScheduleTask` callback. When no host is installed (a session
 * started outside the server program, or a test), the model is told rather than left
 * guessing why nothing happened.
 */
export function scheduleTaskFromConversation(input: {
  readonly threadId: ThreadId;
  readonly params: ScheduleTaskToolParams;
}): Promise<ToolOutcome> {
  if (installedHost === null) {
    return Promise.resolve(errorResult("Scheduled tasks are not available in this session."));
  }
  return installedHost.scheduleTask(input);
}

const MODES: ReadonlyArray<AutomationMode> = ["default", "plan", "goal"];

const isAutomationMode = (value: string): value is AutomationMode =>
  (MODES as ReadonlyArray<string>).includes(value);

/**
 * Tool arguments → the schedule the contracts accept, or a sentence explaining what the
 * model still has to tell us. Returning text instead of throwing keeps the message in front
 * of the model, which is the only thing that can fix the call.
 */
export function scheduleFromToolParams(
  params: ScheduleTaskToolParams,
): AutomationSchedule | string {
  const kind = params.schedule_kind?.trim();

  if (kind === "once") {
    const at = params.at?.trim();
    if (!at) return "A one-off task needs `at` (the ISO time it should run at).";
    if (!Number.isFinite(Date.parse(at))) return `\`at\` is not a readable time: ${at}`;
    return { kind: "once", at: new Date(at).toISOString() };
  }

  if (kind === "daily" || kind === "weekly") {
    const hour = params.hour;
    const minute = params.minute ?? 0;
    if (hour === undefined || !Number.isInteger(hour) || hour < 0 || hour > 23) {
      return "Daily and weekly tasks need `hour`, between 0 and 23 in the task's timezone.";
    }
    if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
      return "`minute` must be between 0 and 59.";
    }
    if (kind === "daily") return { kind: "daily", hour, minute };
    const days = (params.days_of_week ?? []).filter(
      (day) => Number.isInteger(day) && day >= 0 && day <= 6,
    );
    if (days.length === 0) return "A weekly task needs `days_of_week` (0=Sunday … 6=Saturday).";
    return { kind: "weekly", hour, minute, daysOfWeek: [...new Set(days)].toSorted() };
  }

  return "`schedule_kind` must be once, daily or weekly.";
}

const planLine = (automation: Automation): string =>
  `${describeSchedule(automation.schedule)} (${automation.timezone})`;

const nextRunLine = (automation: Automation): string =>
  automation.nextRunAt === null ? "no next run" : `next run ${automation.nextRunAt}`;

export const makeAutomationToolHost = Effect.gen(function* () {
  const automationService = yield* AutomationService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;

  /** The workspace a conversation lives in — what "here" means to the user. */
  const projectIdOfThread = (threadId: ThreadId) =>
    projectionSnapshotQuery.getThreadShellById(threadId).pipe(
      Effect.map((shell) => Option.map(shell, (value) => value.projectId)),
      Effect.orElseSucceed(() => Option.none<ProjectId>()),
    );

  const workspaceRootOf = (projectId: ProjectId) =>
    projectionSnapshotQuery.getProjectShellById(projectId).pipe(
      Effect.map((project) => Option.map(project, (value) => value.workspaceRoot)),
      Effect.orElseSucceed(() => Option.none<string>()),
    );

  const createTask = (input: {
    readonly threadId: ThreadId;
    readonly params: ScheduleTaskToolParams;
  }) =>
    Effect.gen(function* () {
      const title = input.params.title?.trim();
      const instructions = input.params.instructions?.trim();
      if (!title) return errorResult("Creating a task needs a `title`.");
      if (!instructions) return errorResult("Creating a task needs `instructions`.");

      const schedule = scheduleFromToolParams(input.params);
      if (typeof schedule === "string") return errorResult(schedule);

      const requestedMode = input.params.mode?.trim();
      if (
        requestedMode !== undefined &&
        requestedMode.length > 0 &&
        !isAutomationMode(requestedMode)
      ) {
        return errorResult("`mode` must be default, plan or goal.");
      }
      const mode: AutomationMode =
        requestedMode === undefined || requestedMode.length === 0
          ? "default"
          : (requestedMode as AutomationMode);

      const requestedProjectId = input.params.project_id?.trim();
      const projectId =
        requestedProjectId !== undefined && requestedProjectId.length > 0
          ? (requestedProjectId as ProjectId)
          : Option.getOrNull(yield* projectIdOfThread(input.threadId));
      if (projectId === null) {
        return errorResult(
          "This conversation is not attached to a workspace, so there is nowhere to run the task. " +
            "Pass `project_id`, or schedule it from a project conversation.",
        );
      }

      const automation = yield* automationService.create({
        projectId,
        title,
        instructions,
        schedule,
        ...(input.params.timezone === undefined ? {} : { timezone: input.params.timezone }),
        mode,
      });

      const workspaceRoot = Option.getOrNull(yield* workspaceRootOf(automation.projectId));
      return textResult(
        [
          `Scheduled "${automation.title}" (${automation.automationId}).`,
          `Plan: ${planLine(automation)} — ${nextRunLine(automation)}.`,
          `Workspace: ${workspaceRoot ?? automation.projectId}`,
          `Mode: ${automation.mode}`,
          "Every run opens its own conversation in that workspace; the run history lives under Automations.",
        ].join("\n"),
      );
    });

  const listTasks = () =>
    Effect.gen(function* () {
      const automations = yield* automationService.list({});
      if (automations.length === 0) return textResult("No scheduled tasks yet.");
      const lines = automations.map(
        (automation) =>
          `- ${automation.title} — ${automation.isEnabled ? "enabled" : "paused"} — ${planLine(
            automation,
          )} — ${nextRunLine(automation)} — mode ${automation.mode} — id ${automation.automationId}`,
      );
      return textResult(`${automations.length} scheduled task(s):\n${lines.join("\n")}`);
    });

  const setEnabled = (automationId: string, enabled: boolean) =>
    Effect.gen(function* () {
      const automation = yield* automationService.update({
        automationId: AutomationId.makeUnsafe(automationId),
        isEnabled: enabled,
      });
      return textResult(
        `"${automation.title}" is now ${enabled ? "enabled" : "paused"} — ${nextRunLine(
          automation,
        )}.`,
      );
    });

  return {
    scheduleTask: ({ threadId, params }) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const op = params.op?.trim();
          if (op === "create") return yield* createTask({ threadId, params });
          if (op === "list") return yield* listTasks();
          if (op === "set_enabled") {
            const automationId = params.automation_id?.trim();
            if (!automationId) return errorResult("`set_enabled` needs an `automation_id`.");
            if (typeof params.enabled !== "boolean") {
              return errorResult("`set_enabled` needs `enabled` (true or false).");
            }
            return yield* setEnabled(automationId, params.enabled);
          }
          return errorResult("`op` must be create, list or set_enabled.");
        }).pipe(
          Effect.catch((cause) =>
            Effect.succeed(errorResult(cause instanceof Error ? cause.message : String(cause))),
          ),
        ),
      ),
  } satisfies AutomationToolHost;
});
