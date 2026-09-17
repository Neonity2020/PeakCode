// FILE: automationForm.ts
// Purpose: The automations editor's form state and its two conversions (form → schedule,
//          automation → form). Pure, so the round trip can be tested without a DOM.
// Layer: Web logic helpers
// Exports: AutomationFormState, defaultAutomationForm, formFromAutomation, scheduleFromForm

import type {
  Automation,
  AutomationMode,
  AutomationSchedule,
  AutomationScheduleKind,
  ProjectId,
} from "@peakcode/contracts";

export interface AutomationFormState {
  readonly title: string;
  readonly instructions: string;
  readonly workspaceId: ProjectId | null;
  readonly kind: AutomationScheduleKind;
  readonly hour: number;
  readonly minute: number;
  readonly daysOfWeek: ReadonlyArray<number>;
  /** `datetime-local` value — local wall clock, only used when the plan is a one-off. */
  readonly atLocal: string;
  readonly timezone: string;
  readonly mode: AutomationMode;
}

const pad = (value: number) => String(value).padStart(2, "0");

/** `Date` → the `datetime-local` format, in the browser's own zone. */
export function toDateTimeLocalValue(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/**
 * A new task's starting point: work days at 09:00, like the original editor — the most
 * common plan by far, and one the user has to change deliberately rather than by accident.
 */
export function defaultAutomationForm(input: {
  readonly workspaceId: ProjectId | null;
  readonly timezone: string;
  readonly now?: Date;
}): AutomationFormState {
  const now = input.now ?? new Date();
  return {
    title: "",
    instructions: "",
    workspaceId: input.workspaceId,
    kind: "daily",
    hour: 9,
    minute: 0,
    daysOfWeek: [1, 2, 3, 4, 5],
    atLocal: toDateTimeLocalValue(new Date(now.getTime() + 60 * 60 * 1000)),
    timezone: input.timezone,
    mode: "default",
  };
}

export function formFromAutomation(automation: Automation): AutomationFormState {
  const schedule = automation.schedule;
  const timing =
    schedule.kind === "once"
      ? { hour: 9, minute: 0, daysOfWeek: [1, 2, 3, 4, 5] }
      : { hour: schedule.hour, minute: schedule.minute, daysOfWeek: [1, 2, 3, 4, 5] };

  return {
    title: automation.title,
    instructions: automation.instructions,
    workspaceId: automation.projectId,
    kind: schedule.kind,
    hour: timing.hour,
    minute: timing.minute,
    daysOfWeek:
      schedule.kind === "weekly" && schedule.daysOfWeek.length > 0
        ? [...schedule.daysOfWeek]
        : timing.daysOfWeek,
    atLocal:
      schedule.kind === "once"
        ? toDateTimeLocalValue(new Date(schedule.at))
        : toDateTimeLocalValue(new Date(Date.now() + 60 * 60 * 1000)),
    timezone: automation.timezone,
    mode: automation.mode,
  };
}

/**
 * The plan the form describes.
 *
 * A weekly plan with no weekday selected is sent as-is: the server rejects it with a
 * message the user can act on, which beats silently turning it into a daily task.
 */
export function scheduleFromForm(form: AutomationFormState): AutomationSchedule {
  if (form.kind === "once") {
    const parsed = new Date(form.atLocal);
    return {
      kind: "once",
      at: Number.isFinite(parsed.getTime()) ? parsed.toISOString() : form.atLocal,
    };
  }
  if (form.kind === "daily") {
    return { kind: "daily", hour: form.hour, minute: form.minute };
  }
  return {
    kind: "weekly",
    hour: form.hour,
    minute: form.minute,
    daysOfWeek: [...new Set(form.daysOfWeek)].toSorted((left, right) => left - right),
  };
}

/** Weekday indexes in the order the chip row shows them (Monday first). */
export const WEEKDAY_ORDER: ReadonlyArray<number> = [1, 2, 3, 4, 5, 6, 0];

export const AUTOMATION_MODES: ReadonlyArray<AutomationMode> = ["default", "plan", "goal"];
