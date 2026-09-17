// FILE: automationForm.test.ts
// Purpose: Pins the editor's form ↔ schedule conversions, including the cases the UI does
//          not produce but a user can type (an empty weekday row, an unparsable one-off).
// Layer: Web logic tests

import { ProjectId, type Automation } from "@peakcode/contracts";
import { describe, expect, test } from "vitest";

import {
  defaultAutomationForm,
  formFromAutomation,
  scheduleFromForm,
  toDateTimeLocalValue,
} from "./automationForm";

const workspaceId = ProjectId.makeUnsafe("project-1");

const automationOf = (overrides: Partial<Automation> = {}): Automation =>
  ({
    automationId: "automation-1",
    projectId: workspaceId,
    title: "Daily briefing",
    instructions: "Summarise the day.",
    schedule: { kind: "daily", hour: 9, minute: 30 },
    timezone: "Asia/Shanghai",
    mode: "default",
    isEnabled: true,
    nextRunAt: null,
    lastRunAt: null,
    lastRunStatus: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  }) as Automation;

describe("defaultAutomationForm", () => {
  test("starts on work days at 09:00 with the workspace it was given", () => {
    const form = defaultAutomationForm({
      workspaceId,
      timezone: "Asia/Shanghai",
      now: new Date("2026-05-01T08:00:00.000Z"),
    });

    expect(form.kind).toBe("daily");
    expect(form.hour).toBe(9);
    expect(form.minute).toBe(0);
    expect(form.timezone).toBe("Asia/Shanghai");
    expect(form.mode).toBe("default");
    expect(form.workspaceId).toBe(workspaceId);
    expect([...form.daysOfWeek]).toEqual([1, 2, 3, 4, 5]);
    expect(form.title).toBe("");
    expect(form.instructions).toBe("");
  });
});

describe("formFromAutomation", () => {
  test("reads a daily plan back into the form", () => {
    const form = formFromAutomation(automationOf());
    expect(form.kind).toBe("daily");
    expect(form.hour).toBe(9);
    expect(form.minute).toBe(30);
    expect(form.title).toBe("Daily briefing");
    expect(form.timezone).toBe("Asia/Shanghai");
  });

  test("keeps the weekdays of a weekly plan", () => {
    const form = formFromAutomation(
      automationOf({ schedule: { kind: "weekly", hour: 18, minute: 0, daysOfWeek: [0, 5] } }),
    );
    expect(form.kind).toBe("weekly");
    expect([...form.daysOfWeek].toSorted()).toEqual([0, 5]);
    expect(form.hour).toBe(18);
  });

  test("converts a one-off into the browser's local wall clock", () => {
    const at = "2026-05-01T06:30:00.000Z";
    const form = formFromAutomation(automationOf({ schedule: { kind: "once", at } }));
    expect(form.kind).toBe("once");
    expect(form.atLocal).toBe(toDateTimeLocalValue(new Date(at)));
    // The round trip lands on exactly the same instant.
    expect(scheduleFromForm(form)).toEqual({ kind: "once", at });
  });

  test("carries the mode through", () => {
    expect(formFromAutomation(automationOf({ mode: "plan" })).mode).toBe("plan");
  });
});

describe("scheduleFromForm", () => {
  test("daily and weekly plans drop the fields they do not use", () => {
    const base = defaultAutomationForm({ workspaceId, timezone: "UTC" });
    expect(scheduleFromForm({ ...base, kind: "daily", hour: 7, minute: 15 })).toEqual({
      kind: "daily",
      hour: 7,
      minute: 15,
    });
    expect(
      scheduleFromForm({ ...base, kind: "weekly", hour: 7, minute: 15, daysOfWeek: [3, 1, 3] }),
    ).toEqual({ kind: "weekly", hour: 7, minute: 15, daysOfWeek: [1, 3] });
  });

  test("a weekly plan with no weekday selected is sent as-is for the server to reject", () => {
    const base = defaultAutomationForm({ workspaceId, timezone: "UTC" });
    expect(scheduleFromForm({ ...base, kind: "weekly", daysOfWeek: [] })).toEqual({
      kind: "weekly",
      hour: 9,
      minute: 0,
      daysOfWeek: [],
    });
  });

  test("a one-off keeps whatever the user typed when it cannot be parsed", () => {
    const base = defaultAutomationForm({ workspaceId, timezone: "UTC" });
    expect(scheduleFromForm({ ...base, kind: "once", atLocal: "" })).toEqual({
      kind: "once",
      at: "",
    });
  });
});
