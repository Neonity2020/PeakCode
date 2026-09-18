import { describe, expect, test } from "vitest";

import { localDateKey, UsageAccumulator, type UsageDayModelRow } from "./usageAggregate";
import { buildUsageStatistics, type BuildUsageStatisticsInput } from "./usageStatistics";
import type { UsageEvent, UsageSourceId } from "./usageCollectors";

/**
 * 多源统计聚合。
 *
 * 三件事必须被钉住：
 * 1. **总量与拆分口径一致** —— 每日、工具、模型三条视角加起来必须等于总量；
 * 2. **按工具筛选只影响聚合，不影响工具清单** —— 否则选了一个工具之后，就没法再切回别的；
 * 3. **没装/没用过的工具也要出现在清单里** —— 「未检测到」和「用量为 0」对用户是两件事。
 */

function event(input: {
  timestampMs: number;
  source: UsageSourceId;
  model: string;
  sessionId?: string;
  project?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
}): UsageEvent {
  const inputTokens = input.inputTokens ?? 100;
  const outputTokens = input.outputTokens ?? 10;
  const cacheReadTokens = input.cacheReadTokens ?? 0;
  const cacheWriteTokens = input.cacheWriteTokens ?? 0;
  return {
    timestampMs: input.timestampMs,
    source: input.source,
    model: input.model,
    sessionId: input.sessionId ?? "s-1",
    project: input.project === undefined ? "PeakCode" : input.project,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    reasoningTokens: input.reasoningTokens ?? 0,
    totalTokens: inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens,
  };
}

function at(day: number, hour = 12): number {
  return new Date(2026, 8, day, hour, 0, 0, 0).getTime();
}

function build(
  events: ReadonlyArray<UsageEvent>,
  options?: { readonly nowMs?: number; readonly sourceFilter?: UsageSourceId },
): ReturnType<typeof buildUsageStatistics> {
  const accumulator = new UsageAccumulator();
  events.forEach((entry) => accumulator.add(entry));
  const input: BuildUsageStatisticsInput = {
    dayRows: accumulator.dayRows(),
    sessions: accumulator.sessionSlices(),
    activeSources: new Set(events.map((entry) => entry.source)),
    nowMs: options?.nowMs ?? at(18, 20),
    ...(options?.sourceFilter ? { sourceFilter: options.sourceFilter } : {}),
  };
  return buildUsageStatistics(input);
}

describe("buildUsageStatistics", () => {
  const events = [
    event({ timestampMs: at(17, 10), source: "zcode", model: "deepseek-v4.1", sessionId: "z-1" }),
    event({
      timestampMs: at(17, 11),
      source: "zcode",
      model: "deepseek-v4.1",
      sessionId: "z-1",
      inputTokens: 400,
    }),
    event({
      timestampMs: at(18, 9),
      source: "pi",
      model: "qwen3.8-flash",
      sessionId: "p-1",
      project: "Workspace",
      inputTokens: 50,
      cacheReadTokens: 25,
    }),
    event({
      timestampMs: at(16, 9),
      source: "claude-code",
      model: "claude-sonnet-4-6",
      sessionId: "c-1",
      project: "OmniStudio",
      outputTokens: 30,
    }),
  ];

  test("keeps every view of the totals consistent", () => {
    const statistics = build(events);

    const eventTotal = events.reduce((sum, entry) => sum + entry.totalTokens, 0);
    const dayTotal = statistics.days.reduce((sum, day) => sum + day.tokens, 0);
    const sourceTotal = statistics.sources.reduce((sum, source) => sum + source.tokens, 0);
    const modelTotal = statistics.models.reduce((sum, model) => sum + model.tokens, 0);

    expect(statistics.totals.tokens).toBe(eventTotal);
    expect(dayTotal).toBe(eventTotal);
    expect(sourceTotal).toBe(eventTotal);
    expect(modelTotal).toBe(eventTotal);
    expect(statistics.totals.responses).toBe(4);
    expect(statistics.totals.inputTokens).toBe(100 + 400 + 50 + 100);
    expect(statistics.totals.cacheReadTokens).toBe(25);
    expect(statistics.totals.activeDays).toBe(3);
  });

  test("splits each day by tool and keeps the model breakdown inside it", () => {
    const statistics = build(events);
    const day = statistics.days.find((entry) => entry.date === localDateKey(at(17)));

    expect(day?.bySource).toHaveLength(1);
    expect(day?.bySource[0]).toMatchObject({ source: "zcode", tokens: 520, responses: 2 });
    expect(day?.bySource[0]?.models).toEqual([{ model: "deepseek-v4.1", tokens: 520 }]);
  });

  test("lists every tool, flagging the ones that produced no usage", () => {
    const statistics = build(events);
    const byId = new Map(statistics.sources.map((source) => [source.id, source]));

    expect(statistics.sources.length).toBeGreaterThanOrEqual(9);
    expect(byId.get("zcode")).toMatchObject({ label: "ZCode", active: true, sessions: 1 });
    expect(byId.get("pi")).toMatchObject({ tokens: 85, sessions: 1 });
    // Installed but never used in the window: listed, inactive, with its log path.
    expect(byId.get("grok")?.active).toBe(false);
    expect(byId.get("grok")?.tokens).toBe(0);
    expect(byId.get("grok")?.roots.length).toBeGreaterThan(0);
  });

  test("reports which tools produced a model's tokens", () => {
    const statistics = build([
      ...events,
      event({ timestampMs: at(18, 10), source: "opencode", model: "deepseek-v4.1" }),
    ]);
    const model = statistics.models.find((entry) => entry.model === "deepseek-v4.1");

    expect(model?.sources).toEqual(["opencode", "zcode"]);
  });

  test("filters the aggregates by tool while keeping the whole tool list", () => {
    const statistics = build(events, { sourceFilter: "zcode" });

    expect(statistics.totals.tokens).toBe(520);
    expect(statistics.totals.sessions).toBe(1);
    expect(
      statistics.days.every((day) => day.bySource.every((slice) => slice.source === "zcode")),
    ).toBe(true);
    expect(statistics.models.map((model) => model.model)).toEqual(["deepseek-v4.1"]);
    // The picker still needs every tool, including the ones this filter excludes.
    expect(statistics.sources.some((source) => source.id === "pi" && source.tokens === 85)).toBe(
      true,
    );
    expect(statistics.sessions.every((session) => session.source === "zcode")).toBe(true);
  });

  test("measures the longest conversation and the day it peaked on", () => {
    const statistics = build(events);
    const zcodeSession = statistics.sessions.find((session) => session.sessionId === "z-1");

    expect(zcodeSession?.startedAt).toBe(new Date(at(17, 10)).toISOString());
    expect(zcodeSession?.endedAt).toBe(new Date(at(17, 11)).toISOString());
    expect(statistics.totals.longestChatMs).toBe(60 * 60 * 1_000);
    expect(statistics.totals.peakDay).toBe(localDateKey(at(17)));
    expect(statistics.totals.peakDayTokens).toBe(520);
  });

  test("keeps a streak alive through an idle today and lists sessions newest first", () => {
    const statistics = build(events, { nowMs: at(20) });

    // 16, 17, 18 active; today (20) is untouched but yesterday (19) is missing too.
    expect(statistics.totals.longestStreakDays).toBe(3);
    expect(statistics.totals.currentStreakDays).toBe(0);
    expect(statistics.sessions.map((session) => session.sessionId)).toEqual(["p-1", "z-1", "c-1"]);
  });

  test("reports an all-zero snapshot when no tool has records", () => {
    const accumulator = new UsageAccumulator();
    const statistics = buildUsageStatistics({
      dayRows: accumulator.dayRows(),
      sessions: accumulator.sessionSlices(),
      activeSources: new Set(),
      nowMs: at(18, 20),
    });

    expect(statistics.totals.tokens).toBe(0);
    expect(statistics.totals.sessions).toBe(0);
    expect(statistics.days).toEqual([]);
    expect(statistics.models).toEqual([]);
    expect(statistics.sessions).toEqual([]);
    expect(statistics.sources.every((source) => source.active === false)).toBe(true);
    expect(statistics.totals.peakDay).toBeNull();
  });

  test("marks sessions whose request detail retention released", () => {
    const accumulator = new UsageAccumulator();
    accumulator.add(event({ timestampMs: at(1), source: "pi", model: "deepseek-v4.1" }));
    accumulator.prune({ nowMs: at(18) });
    const rows: ReadonlyArray<UsageDayModelRow> = accumulator.dayRows();

    const statistics = buildUsageStatistics({
      dayRows: rows,
      sessions: accumulator.sessionSlices(),
      activeSources: new Set<UsageSourceId>(["pi"]),
      nowMs: at(18, 20),
    });

    expect(statistics.sessions[0]?.hasRequestDetail).toBe(false);
    expect(statistics.totals.tokens).toBe(110);
  });
});
