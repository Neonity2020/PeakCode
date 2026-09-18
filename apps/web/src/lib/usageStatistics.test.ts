import { describe, expect, it } from "vitest";

import {
  buildSmoothPath,
  buildUsageSourceBars,
  buildUsageSourceRows,
  buildUsageDonut,
  buildUsageHeatmap,
  buildUsageTrend,
  formatDayLabel,
  formatDuration,
  formatSharePercent,
  formatStreakDays,
  formatTokenCount,
  formatDateTime,
  localDateKey,
  usageModelColor,
  usageSourceColor,
  USAGE_MODEL_COLORS,
  type HeatmapMode,
} from "./usageStatistics";
import type {
  ServerUsageStatisticsDay,
  ServerUsageStatisticsModel,
  ServerUsageStatisticsSource,
  ServerUsageStatisticsSourceId,
} from "@peakcode/contracts";

function localTime(day: number, hour = 12): number {
  return new Date(2026, 8, day, hour, 0, 0, 0).getTime();
}

function statisticsDay(input: {
  date: string;
  tokens: number;
  responses?: number;
  source?: ServerUsageStatisticsSourceId;
  models?: ReadonlyArray<{ model: string; tokens: number }>;
}): ServerUsageStatisticsDay {
  const models = [...(input.models ?? [])];
  return {
    date: input.date,
    tokens: input.tokens,
    responses: input.responses ?? 1,
    bySource:
      models.length === 0
        ? []
        : [
            {
              source: input.source ?? "pi",
              tokens: models.reduce((sum, model) => sum + model.tokens, 0),
              responses: input.responses ?? 1,
              models,
            },
          ],
  };
}

function modelUsage(input: {
  model: string;
  tokens: number;
  source?: ServerUsageStatisticsSourceId;
}): ServerUsageStatisticsModel {
  return {
    model: input.model,
    tokens: input.tokens,
    responses: 1,
    sources: [input.source ?? "pi"],
    lastUsedAt: new Date(localTime(18)).toISOString(),
  };
}

describe("usage statistic formatting", () => {
  it("keeps exact counts below a thousand and compacts above", () => {
    expect(formatTokenCount(950, "en")).toBe("950");
    expect(formatTokenCount(26_400, "en")).toBe("26.4K");
    expect(formatTokenCount(110_585_991, "en")).toBe("110.6M");
    expect(formatTokenCount(26_400, "zh")).toBe("2.6万");
    expect(formatTokenCount(110_585_991, "zh")).toBe("1.1亿");
  });

  it("formats streak lengths per language", () => {
    expect(formatStreakDays(12, "zh")).toBe("12 天");
    expect(formatStreakDays(12, "en")).toBe("12 days");
    expect(formatStreakDays(1, "en")).toBe("1 day");
  });

  it("formats session timestamps per language", () => {
    const iso = new Date(2026, 8, 18, 14, 30).toISOString();
    expect(formatDateTime(iso, "zh")).toMatch(/9\/18|9月18日/);
    expect(formatDateTime(iso, "en")).toContain("Sep 18");
  });

  it("labels axis days per language", () => {
    expect(formatDayLabel("2026-09-12", "zh")).toBe("9月12日");
    expect(formatDayLabel("2026-09-12", "en")).toBe("Sep 12");
  });

  it("drops empty leading duration units", () => {
    expect(
      formatDuration(3 * 24 * 60 * 60 * 1_000 + 15 * 60 * 60 * 1_000 + 35 * 60 * 1_000, "zh"),
    ).toBe("3天15小时35分");
    expect(formatDuration(45 * 60 * 1_000, "en")).toBe("45m");
    expect(formatDuration(2 * 60 * 60 * 1_000, "en")).toBe("2h 0m");
    expect(formatDuration(0, "zh")).toBe("0分");
  });

  it("renders shares the way the model list reads", () => {
    expect(formatSharePercent(0.98, "zh")).toBe("98%");
    expect(formatSharePercent(0.013, "zh")).toBe("1.3%");
    expect(formatSharePercent(0.0004, "zh")).toBe("<0.1%");
    expect(formatSharePercent(0, "zh")).toBe("0%");
  });
});

describe("buildUsageSourceRows", () => {
  const sources: ReadonlyArray<ServerUsageStatisticsSource> = [
    {
      id: "zcode",
      label: "ZCode",
      roots: ["/Users/tester/.zcode/cli/db/db.sqlite"],
      active: true,
      tokens: 750,
      responses: 30,
      sessions: 4,
      models: 3,
      lastUsedAt: new Date(localTime(18, 11)).toISOString(),
    },
    {
      id: "pi",
      label: "Pi",
      roots: ["/Users/tester/.pi/agent/sessions"],
      active: true,
      tokens: 250,
      responses: 10,
      sessions: 2,
      models: 2,
      lastUsedAt: new Date(localTime(17, 11)).toISOString(),
    },
    {
      id: "grok",
      label: "Grok Build",
      roots: ["/Users/tester/.grok/sessions"],
      active: false,
      tokens: 0,
      responses: 0,
      sessions: 0,
      models: 0,
      lastUsedAt: null,
    },
  ];

  it("shares each tool against the whole machine, whatever the filter is", () => {
    const rows = buildUsageSourceRows(sources);

    expect(rows.map((row) => row.id)).toEqual(["zcode", "pi", "grok"]);
    expect(rows[0]?.share).toBeCloseTo(0.75, 5);
    expect(rows[1]?.share).toBeCloseTo(0.25, 5);
  });

  it("keeps tools that produced nothing, with the logs path they were looked for in", () => {
    const grok = buildUsageSourceRows(sources).find((row) => row.id === "grok");

    expect(grok?.active).toBe(false);
    expect(grok?.roots).toEqual(["/Users/tester/.grok/sessions"]);
    expect(grok?.lastUsedAt).toBeNull();
  });

  it("sizes bars against the busiest tool so they stay comparable", () => {
    const bars = buildUsageSourceBars(buildUsageSourceRows(sources));

    expect(bars[0]).toBeCloseTo(1, 5);
    expect(bars[1]).toBeCloseTo(1 / 3, 5);
    expect(bars[2]).toBe(0);
  });

  it("gives every tool a stable colour", () => {
    const rows = buildUsageSourceRows(sources);

    expect(rows.map((row) => row.color)).toEqual([
      usageSourceColor("zcode"),
      usageSourceColor("pi"),
      usageSourceColor("grok"),
    ]);
  });
});

describe("buildUsageTrend", () => {
  const models = [
    modelUsage({ model: "deepseek-v4.1", tokens: 900 }),
    modelUsage({ model: "deepseek-v4", tokens: 100 }),
    modelUsage({ model: "idle-model", tokens: 0 }),
  ];

  it("fills every calendar day in the window so a gap dips to zero", () => {
    const trend = buildUsageTrend({
      days: [
        statisticsDay({
          date: localDateKey(localTime(17)),
          tokens: 500,
          models: [{ model: "deepseek-v4.1", tokens: 500 }],
        }),
      ],
      models,
      rangeDays: 7,
      nowMs: localTime(18, 20),
      language: "zh",
    });

    expect(trend.dates).toHaveLength(7);
    expect(trend.dates.at(-1)).toBe(localDateKey(localTime(18)));
    expect(trend.series[0]?.points).toEqual([0, 0, 0, 0, 0, 500, 0]);
  });

  it("sums same-day responses and caps the number of drawn series", () => {
    const manyModels = Array.from({ length: 6 }, (_, index) =>
      modelUsage({ model: `model-${index}`, tokens: 100 - index }),
    );
    const trend = buildUsageTrend({
      days: [
        statisticsDay({
          date: localDateKey(localTime(18)),
          tokens: 60,
          models: [
            { model: "model-0", tokens: 10 },
            { model: "model-0", tokens: 5 },
          ],
        }),
      ],
      models: manyModels,
      rangeDays: 3,
      nowMs: localTime(18, 20),
      language: "en",
    });

    expect(trend.series).toHaveLength(4);
    expect(trend.series[0]?.points.at(-1)).toBe(15);
    expect(trend.maxTokens).toBe(15);
  });

  it("leaves models that never spent a token out of the legend", () => {
    const trend = buildUsageTrend({
      days: [
        statisticsDay({
          date: localDateKey(localTime(18)),
          tokens: 10,
          models: [{ model: "deepseek-v4.1", tokens: 10 }],
        }),
      ],
      models: [
        modelUsage({ model: "deepseek-v4.1", tokens: 10 }),
        modelUsage({ model: "idle-model", tokens: 0 }),
      ],
      rangeDays: 7,
      nowMs: localTime(18, 20),
      language: "en",
    });

    expect(trend.series.map((series) => series.model)).toEqual(["deepseek-v4.1"]);
  });

  it("labels every day on a short range and thins the ticks on a long one", () => {
    const short = buildUsageTrend({
      days: [],
      models,
      rangeDays: 7,
      nowMs: localTime(18, 20),
      language: "en",
    });
    expect(short.ticks).toHaveLength(7);
    expect(short.ticks.map((tick) => tick.label)).toEqual([
      "Sep 12",
      "Sep 13",
      "Sep 14",
      "Sep 15",
      "Sep 16",
      "Sep 17",
      "Sep 18",
    ]);

    const long = buildUsageTrend({
      days: [],
      models,
      rangeDays: 30,
      nowMs: localTime(18, 20),
      language: "en",
    });
    expect(long.ticks.length).toBeLessThan(30);
    // The window's end is always labelled, and no tick sits on top of another.
    expect(long.ticks.at(-1)?.index).toBe(29);
    const gaps = long.ticks
      .slice(1)
      .map((tick, index) => tick.index - (long.ticks[index]?.index ?? 0));
    expect(Math.min(...gaps)).toBeGreaterThan(1);
  });

  it("keeps a model's colour stable across pages by rank", () => {
    expect(usageModelColor(models, "deepseek-v4.1")).toBe(USAGE_MODEL_COLORS[0]);
    expect(usageModelColor(models, "deepseek-v4")).toBe(USAGE_MODEL_COLORS[1]);
  });
});

describe("buildUsageHeatmap", () => {
  const days = [
    statisticsDay({ date: "2026-09-16", tokens: 1_000, responses: 3 }),
    statisticsDay({ date: "2026-09-17", tokens: 10_000, responses: 9 }),
    statisticsDay({ date: "2026-09-18", tokens: 100, responses: 1 }),
  ];

  it("lays out a year of weeks ending on today's column", () => {
    const heatmap = buildUsageHeatmap({
      days,
      mode: "daily",
      nowMs: localTime(18, 20),
      language: "zh",
    });

    expect(heatmap.weeks).toHaveLength(53);
    for (const week of heatmap.weeks) {
      expect(week).toHaveLength(7);
    }

    const today = localDateKey(localTime(18));
    const todayColumn = heatmap.weeks.at(-1)!;
    expect(todayColumn.some((cell) => cell.dateKey === today)).toBe(true);
    // Days after today are placeholders, so the grid stays a rectangle.
    expect(todayColumn.some((cell) => cell.future)).toBe(true);
    expect(heatmap.monthLabels.length).toBeGreaterThan(6);
    expect(heatmap.monthLabels[0]?.column).toBe(0);
  });

  it("keeps days without usage in the grid at level zero", () => {
    const heatmap = buildUsageHeatmap({
      days,
      mode: "daily",
      nowMs: localTime(18, 20),
      language: "zh",
    });
    const cells = heatmap.weeks.flat();
    const empty = cells.find((cell) => cell.dateKey === "2026-09-01");

    expect(empty?.tokens).toBe(0);
    expect(empty?.level).toBe(0);
  });

  it("ramps the busiest days to the top level instead of by raw magnitude", () => {
    const heatmap = buildUsageHeatmap({
      days: [
        ...days,
        statisticsDay({ date: "2026-09-15", tokens: 5_000 }),
        statisticsDay({ date: "2026-09-14", tokens: 2_000 }),
        statisticsDay({ date: "2026-09-13", tokens: 3_000 }),
      ],
      mode: "daily",
      nowMs: localTime(18, 20),
      language: "zh",
    });
    const levelOf = (dateKey: string) =>
      heatmap.weeks.flat().find((cell) => cell.dateKey === dateKey)?.level;

    const levels = ["2026-09-13", "2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17"].map(
      levelOf,
    );
    expect(new Set(levels).size).toBeGreaterThan(1);
    expect(levelOf("2026-09-17")).toBe(4);
  });

  it("colours a weekly view by the week's total and a cumulative view by the running total", () => {
    const weekly: HeatmapMode = "weekly";
    const heatmap = buildUsageHeatmap({
      days,
      mode: weekly,
      nowMs: localTime(18, 20),
      language: "zh",
    });
    const lastWeek = heatmap.weeks.at(-1)!;
    const weekTotal = lastWeek.reduce((sum, cell) => sum + cell.tokens, 0);
    expect(lastWeek.every((cell) => cell.aggregate === weekTotal)).toBe(true);

    const cumulative = buildUsageHeatmap({
      days,
      mode: "cumulative",
      nowMs: localTime(18, 20),
      language: "zh",
    });
    const cumulativeCells = cumulative.weeks.flat().filter((cell) => !cell.future);
    const firstAggregate = cumulativeCells[0]?.aggregate ?? 0;
    const lastAggregate = cumulativeCells.at(-1)?.aggregate ?? 0;
    expect(lastAggregate).toBe(11_100);
    expect(lastAggregate).toBeGreaterThanOrEqual(firstAggregate);
  });
});

describe("buildUsageDonut", () => {
  const models = [
    modelUsage({ model: "deepseek-v4.1", tokens: 980 }),
    modelUsage({ model: "deepseek-v4", tokens: 13 }),
    modelUsage({ model: "deepseek-v4-flash", tokens: 4 }),
    modelUsage({ model: "qwen3.8-flash", tokens: 3 }),
    modelUsage({ model: "idle-model", tokens: 0 }),
  ];

  it("drops zero-token models and sizes slices by share", () => {
    const donut = buildUsageDonut({ models, circumference: 100 });

    expect(donut.totalTokens).toBe(1_000);
    expect(donut.segments.map((segment) => segment.model)).toEqual([
      "deepseek-v4.1",
      "deepseek-v4",
      "deepseek-v4-flash",
      "qwen3.8-flash",
    ]);
    expect(donut.segments[0]?.share).toBeCloseTo(0.98, 5);
    expect(donut.otherModels).toEqual([]);
  });

  it("groups everything past the limit into one trailing slice", () => {
    const donut = buildUsageDonut({ models, circumference: 100, limit: 2 });

    expect(donut.segments.map((segment) => segment.model)).toEqual([
      "deepseek-v4.1",
      "deepseek-v4",
      "__other__",
    ]);
    expect(donut.otherModels.map((model) => model.model)).toEqual([
      "deepseek-v4-flash",
      "qwen3.8-flash",
    ]);
    expect(donut.segments.at(-1)?.share).toBeCloseTo(0.007, 5);
  });

  it("walks each slice's dash offset past the ones before it", () => {
    const donut = buildUsageDonut({ models, circumference: 1_000 });

    expect(donut.segments[0]?.dashOffset).toBe(0);
    expect(donut.segments[1]?.dashOffset).toBeCloseTo(-980, 5);
    expect(donut.segments[2]?.dashOffset).toBeCloseTo(-993, 5);
  });

  it("returns no slices for an archive with no usage", () => {
    const donut = buildUsageDonut({
      models: [modelUsage({ model: "idle", tokens: 0 })],
      circumference: 100,
    });

    expect(donut.segments).toEqual([]);
    expect(donut.totalTokens).toBe(0);
  });
});

describe("buildSmoothPath", () => {
  it("passes through every point it plots", () => {
    const path = buildSmoothPath([
      { x: 0, y: 10 },
      { x: 10, y: 0 },
      { x: 20, y: 5 },
    ]);

    expect(path.startsWith("M 0 10")).toBe(true);
    expect(path).toContain("C ");
    expect(path.endsWith("20 5")).toBe(true);
  });

  it("degrades gracefully for empty and single-point series", () => {
    expect(buildSmoothPath([])).toBe("");
    expect(buildSmoothPath([{ x: 4, y: 7 }])).toBe("M 4 7");
  });
});
