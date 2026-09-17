import { describe, expect, it } from "vitest";

import type { OrchestrationThreadShell } from "@peakcode/contracts";

import {
  formatTaskAge,
  isVisibleTask,
  resolveTaskStatus,
  resolveTaskTimeBucket,
  taskActivityAt,
} from "./h5Tasks";

const NOW = Date.parse("2026-09-17T15:00:00.000Z");

describe("resolveTaskStatus", () => {
  it("reports a running turn", () => {
    expect(
      resolveTaskStatus({
        latestTurn: { state: "running" } as never,
        session: null,
      }),
    ).toBe("running");
  });

  it("puts a question that needs a person ahead of the turn state", () => {
    // The run is parked until it is answered, which is exactly what the phone is for.
    expect(
      resolveTaskStatus({
        latestTurn: { state: "running" } as never,
        session: null,
        hasPendingApprovals: true,
      }),
    ).toBe("waiting");
    expect(resolveTaskStatus({ latestTurn: null, session: null, hasPendingUserInput: true })).toBe(
      "waiting",
    );
  });

  it("maps finished and failed turns", () => {
    expect(resolveTaskStatus({ latestTurn: { state: "completed" } as never, session: null })).toBe(
      "completed",
    );
    expect(resolveTaskStatus({ latestTurn: { state: "error" } as never, session: null })).toBe(
      "failed",
    );
    expect(
      resolveTaskStatus({ latestTurn: { state: "interrupted" } as never, session: null }),
    ).toBe("interrupted");
  });

  it("treats a starting session as running even before the turn shows up", () => {
    expect(resolveTaskStatus({ latestTurn: null, session: { status: "starting" } as never })).toBe(
      "running",
    );
    expect(resolveTaskStatus({ latestTurn: null, session: null })).toBe("idle");
  });
});

describe("resolveTaskTimeBucket", () => {
  it("splits today, yesterday and anything older", () => {
    expect(resolveTaskTimeBucket("2026-09-17T09:00:00.000Z", NOW)).toBe("today");
    expect(resolveTaskTimeBucket("2026-09-16T09:00:00.000Z", NOW)).toBe("yesterday");
    expect(resolveTaskTimeBucket("2026-09-10T09:00:00.000Z", NOW)).toBe("earlier");
    expect(resolveTaskTimeBucket("not a date", NOW)).toBe("earlier");
  });
});

describe("formatTaskAge", () => {
  it("speaks in the units a phone list has room for", () => {
    const at = (iso: string) => formatTaskAge(iso, NOW);
    expect(at("2026-09-17T14:59:40.000Z")).toBe("刚刚");
    expect(at("2026-09-17T14:35:00.000Z")).toBe("25 分钟");
    expect(at("2026-09-17T12:00:00.000Z")).toBe("3 小时");
    expect(at("2026-09-16T12:00:00.000Z")).toBe("昨天");
    expect(at("2026-09-14T12:00:00.000Z")).toBe("3 天");
    expect(at("2026-07-14T12:00:00.000Z")).toBe("2 个月");
  });
});

describe("isVisibleTask", () => {
  const thread = (overrides: Partial<OrchestrationThreadShell>): OrchestrationThreadShell =>
    ({
      id: "thread-1",
      archivedAt: null,
      parentThreadId: null,
      latestTurn: null,
      latestUserMessageAt: null,
      updatedAt: "2026-09-17T14:00:00.000Z",
      ...overrides,
    }) as OrchestrationThreadShell;

  it("shows tasks that have done something", () => {
    expect(isVisibleTask(thread({ latestTurn: { state: "completed" } as never }))).toBe(true);
    expect(isVisibleTask(thread({ latestUserMessageAt: "2026-09-17T14:00:00.000Z" }))).toBe(true);
  });

  it("hides empty drafts, archived tasks and subagent threads", () => {
    expect(isVisibleTask(thread({}))).toBe(false);
    expect(
      isVisibleTask(
        thread({ latestTurn: { state: "completed" } as never, archivedAt: "2026-09-01T00:00:00Z" }),
      ),
    ).toBe(false);
    expect(
      isVisibleTask(
        thread({
          latestTurn: { state: "completed" } as never,
          parentThreadId: "parent-thread" as never,
        }),
      ),
    ).toBe(false);
  });
});

describe("taskActivityAt", () => {
  it("prefers the last thing the user asked for, then the turn, then the row's clock", () => {
    expect(
      taskActivityAt({
        latestUserMessageAt: "2026-09-17T14:00:00.000Z",
        latestTurn: { completedAt: "2026-09-17T13:00:00.000Z" },
        updatedAt: "2026-09-17T12:00:00.000Z",
      } as never),
    ).toBe("2026-09-17T14:00:00.000Z");
    expect(
      taskActivityAt({
        latestUserMessageAt: null,
        latestTurn: { completedAt: "2026-09-17T13:00:00.000Z" },
        updatedAt: "2026-09-17T12:00:00.000Z",
      } as never),
    ).toBe("2026-09-17T13:00:00.000Z");
    expect(
      taskActivityAt({
        latestUserMessageAt: null,
        latestTurn: null,
        updatedAt: "2026-09-17T12:00:00.000Z",
      } as never),
    ).toBe("2026-09-17T12:00:00.000Z");
  });
});
