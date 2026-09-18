// FILE: usageStatistics.ts
// Purpose: Pure derive/format helpers behind settings → 使用统计: compact token
//          counts, durations, the activity heatmap grid, the per-model trend
//          series, and donut geometry. Kept apart from the panel so the maths can
//          be tested without a browser.
// Layer: Shared runtime utility (web)

import type { Language } from "~/i18n";
import type {
  ServerUsageStatisticsDay,
  ServerUsageStatisticsModel,
  ServerUsageStatisticsSource,
  ServerUsageStatisticsSourceId,
} from "@peakcode/contracts";

/** Series colours handed out in rank order, so a model keeps its colour across the page. */
export const USAGE_MODEL_COLORS = [
  "#3B82F6",
  "#22C55E",
  "#A855F7",
  "#EF4444",
  "#F59E0B",
  "#14B8A6",
  "#EC4899",
  "#6366F1",
] as const;

/** Tool colours, assigned by the order the server lists tools in. */
export const USAGE_SOURCE_COLORS: Record<string, string> = {
  "claude-code": "#D97757",
  codex: "#10B981",
  zcode: "#3B82F6",
  workbuddy: "#F59E0B",
  pi: "#8B5CF6",
  opencode: "#06B6D4",
  ccmr: "#14B8A6",
  grok: "#64748B",
  dsh: "#4F46E5",
};

export function usageSourceColor(sourceId: string): string {
  return USAGE_SOURCE_COLORS[sourceId] ?? "#94A3B8";
}

/** Heatmap ramp: index 0 is an empty day, 4 the busiest. */
export const HEATMAP_LEVEL_COLORS = [
  "rgba(148, 163, 184, 0.16)",
  "rgba(59, 130, 246, 0.26)",
  "rgba(59, 130, 246, 0.5)",
  "rgba(59, 130, 246, 0.74)",
  "rgba(59, 130, 246, 1)",
] as const;

export type HeatmapMode = "daily" | "weekly" | "cumulative";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const HEATMAP_WEEKS = 53;

function localeFor(language: Language): string {
  return language === "zh" ? "zh-CN" : "en-US";
}

function parseDateKey(dateKey: string): Date {
  const [year, month, day] = dateKey.split("-").map((part) => Number.parseInt(part, 10));
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1);
}

/** Local `YYYY-MM-DD` for a timestamp — the same calendar day the server buckets by. */
export function localDateKey(timestampMs: number): string {
  const date = new Date(timestampMs);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Token counts read as `1.1亿` / `110.6M`: exact under a thousand, compact above,
 * because a five-card row has no space for twelve digits.
 */
export function formatTokenCount(tokens: number, language: Language): string {
  const rounded = Math.max(0, Math.round(tokens));
  const formatter =
    rounded < 1_000
      ? new Intl.NumberFormat(localeFor(language), { maximumFractionDigits: 0 })
      : new Intl.NumberFormat(localeFor(language), {
          notation: "compact",
          maximumFractionDigits: 1,
        });
  return formatter.format(rounded);
}

/** Plain grouped integer, for counts that are not token amounts. */
export function formatCount(value: number, language: Language): string {
  return new Intl.NumberFormat(localeFor(language)).format(Math.max(0, Math.round(value)));
}

export function formatStreakDays(days: number, language: Language): string {
  const value = Math.max(0, Math.round(days));
  const counted = formatCount(value, language);
  return language === "zh" ? `${counted} 天` : `${counted} ${value === 1 ? "day" : "days"}`;
}

/**
 * Longest-conversation duration, dropping empty leading units: `3天15小时35分`.
 * Seconds are never shown — a stats card cares about magnitude, not precision.
 */
export function formatDuration(durationMs: number, language: Language): string {
  const totalMinutes = Math.max(0, Math.floor(durationMs / 60_000));
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes - days * 60 * 24) / 60);
  const minutes = totalMinutes - days * 60 * 24 - hours * 60;

  const parts: string[] = [];
  if (days > 0) {
    parts.push(language === "zh" ? `${days}天` : `${days}d`);
  }
  if (hours > 0 || days > 0) {
    parts.push(language === "zh" ? `${hours}小时` : `${hours}h`);
  }
  parts.push(language === "zh" ? `${minutes}分` : `${minutes}m`);

  return parts.join(language === "zh" ? "" : " ");
}

/** Share of total, as rendered in the model list: `98%`, `1.3%`, `<0.1%`. */
export function formatSharePercent(share: number, language: Language): string {
  if (!Number.isFinite(share) || share <= 0) {
    return language === "zh" ? "0%" : "0%";
  }
  const percent = share * 100;
  if (percent < 0.1) {
    return "<0.1%";
  }
  const rounded = percent >= 10 ? percent.toFixed(0) : percent.toFixed(1);
  return `${rounded.replace(/\.0$/u, "")}%`;
}

export function formatDayLabel(dateKey: string, language: Language): string {
  const date = parseDateKey(dateKey);
  if (language === "zh") {
    // Intl renders zh dates as `9/12`; the axis reads better as `9月12日`.
    return `${date.getMonth() + 1}月${date.getDate()}日`;
  }
  return new Intl.DateTimeFormat(localeFor(language), { month: "short", day: "numeric" }).format(
    date,
  );
}

export function formatMonthLabel(dateKey: string, language: Language): string {
  return new Intl.DateTimeFormat(localeFor(language), { month: "short" }).format(
    parseDateKey(dateKey),
  );
}

export function formatFullDate(dateKey: string, language: Language): string {
  return new Intl.DateTimeFormat(localeFor(language), {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(parseDateKey(dateKey));
}

export interface UsageTrendSeries {
  readonly model: string;
  readonly color: string;
  readonly points: ReadonlyArray<number>;
}

/** A labelled x-axis position; days between ticks are simply absent. */
export interface UsageTrendTick {
  readonly date: string;
  readonly index: number;
  readonly label: string;
}

export interface UsageTrend {
  readonly dates: ReadonlyArray<string>;
  readonly ticks: ReadonlyArray<UsageTrendTick>;
  readonly series: ReadonlyArray<UsageTrendSeries>;
  readonly maxTokens: number;
}

/** Most series the chart draws before the lines stop being tellable apart. */
export const TREND_SERIES_LIMIT = 4;

/**
 * Dense daily series for the trailing window: one point per calendar day for the
 * top models, so a gap in usage renders as a dip to zero instead of a straight
 * line across the gap.
 */
export function buildUsageTrend(input: {
  readonly days: ReadonlyArray<ServerUsageStatisticsDay>;
  readonly models: ReadonlyArray<ServerUsageStatisticsModel>;
  readonly rangeDays: number;
  readonly nowMs: number;
  readonly language: Language;
}): UsageTrend {
  const rangeDays = Math.max(1, Math.floor(input.rangeDays));
  const endDate = parseDateKey(localDateKey(input.nowMs));
  const dates: string[] = [];
  for (let offset = rangeDays - 1; offset >= 0; offset -= 1) {
    dates.push(
      localDateKey(
        new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate() - offset).getTime(),
      ),
    );
  }

  const indexByDate = new Map(dates.map((date, index) => [date, index]));
  // Models that never spent a token are skipped before the limit is applied, so the
  // legend lists the models that actually ran instead of flat zero lines.
  const drawnModels = input.models.filter((model) => model.tokens > 0);
  const tokensByModel = drawnModels.slice(0, TREND_SERIES_LIMIT).map((model) => ({
    model: model.model,
    color: usageModelColor(input.models, model.model),
    points: Array.from({ length: dates.length }, () => 0),
  }));
  const pointByModel = new Map(tokensByModel.map((entry) => [entry.model, entry.points]));

  for (const day of input.days) {
    const index = indexByDate.get(day.date);
    if (index === undefined) {
      continue;
    }
    for (const slice of day.bySource) {
      for (const dayModel of slice.models) {
        const points = pointByModel.get(dayModel.model);
        if (points) {
          points[index] = (points[index] ?? 0) + dayModel.tokens;
        }
      }
    }
  }

  const maxTokens = tokensByModel.reduce(
    (max, entry) => entry.points.reduce((innerMax, value) => Math.max(innerMax, value), max),
    0,
  );
  const tickStep = dates.length <= 8 ? 1 : Math.ceil(dates.length / 8);
  const ticks: UsageTrendTick[] = [];
  dates.forEach((date, index) => {
    const isLast = index === dates.length - 1;
    // The last day is always labelled so the window's end is explicit, and a tick
    // that would sit on top of it is dropped rather than drawn overlapping.
    if (!isLast && (index % tickStep !== 0 || index + tickStep > dates.length - 1)) {
      return;
    }
    ticks.push({ date, index, label: formatDayLabel(date, input.language) });
  });

  return { dates, ticks, series: tokensByModel, maxTokens };
}

/** Colour for a model, fixed by its rank in the usage list so every view agrees. */
export function usageModelColor(
  models: ReadonlyArray<ServerUsageStatisticsModel>,
  model: string,
): string {
  const index = models.findIndex((entry) => entry.model === model);
  const paletteIndex = index < 0 ? models.length : index;
  return USAGE_MODEL_COLORS[paletteIndex % USAGE_MODEL_COLORS.length] ?? USAGE_MODEL_COLORS[0];
}

export interface HeatmapCell {
  readonly dateKey: string;
  readonly tokens: number;
  readonly responses: number;
  /** Mode-specific aggregate this cell was coloured by (day, week, or running total). */
  readonly aggregate: number;
  readonly level: number;
  /** Days after today are rendered as placeholders so the last column stays square. */
  readonly future: boolean;
}

export interface UsageHeatmap {
  readonly weeks: ReadonlyArray<ReadonlyArray<HeatmapCell>>;
  readonly monthLabels: ReadonlyArray<{ label: string; column: number }>;
  readonly mode: HeatmapMode;
}

function quantileLevels(values: ReadonlyArray<number>): (value: number) => number {
  const positive = values.filter((value) => value > 0).toSorted((left, right) => left - right);
  if (positive.length === 0) {
    return () => 0;
  }
  const at = (fraction: number) =>
    positive[Math.min(positive.length - 1, Math.floor(positive.length * fraction))] ?? 0;
  const thresholds = [at(0.25), at(0.5), at(0.75), positive[positive.length - 1] ?? 0];

  return (value) => {
    if (value <= 0) {
      return 0;
    }
    // Busiest days are rare by definition, so the ramp is by rank, not by value:
    // a linear scale would leave every ordinary day looking empty.
    if (value <= thresholds[0]!) return 1;
    if (value <= thresholds[1]!) return 2;
    if (value <= thresholds[2]!) return 3;
    return 4;
  };
}

/**
 * Calendar heatmap of the trailing year, one column per week starting Sunday.
 * Days without usage stay in the grid as level 0 so gaps are visible.
 */
export function buildUsageHeatmap(input: {
  readonly days: ReadonlyArray<ServerUsageStatisticsDay>;
  readonly mode: HeatmapMode;
  readonly nowMs: number;
  readonly language: Language;
  readonly weeks?: number;
}): UsageHeatmap {
  const weekCount = Math.max(1, Math.floor(input.weeks ?? HEATMAP_WEEKS));
  const todayKey = localDateKey(input.nowMs);
  const today = parseDateKey(todayKey);
  const byDate = new Map(input.days.map((day) => [day.date, day]));

  // Walk back to the Sunday that opens the first column.
  const gridStart = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() - today.getDay() - (weekCount - 1) * 7,
  );

  const dates: string[] = [];
  for (let index = 0; index < weekCount * 7; index += 1) {
    dates.push(
      localDateKey(
        new Date(
          gridStart.getFullYear(),
          gridStart.getMonth(),
          gridStart.getDate() + index,
        ).getTime(),
      ),
    );
  }

  const dailyTokens = dates.map((date) => byDate.get(date)?.tokens ?? 0);
  const weeklyTotals: number[] = [];
  for (let week = 0; week < weekCount; week += 1) {
    weeklyTotals.push(
      dailyTokens.slice(week * 7, week * 7 + 7).reduce((sum, value) => sum + value, 0),
    );
  }

  const cumulative: number[] = [];
  dailyTokens.reduce((running, value) => {
    const next = running + value;
    cumulative.push(next);
    return next;
  }, 0);

  const aggregateFor = (index: number): number => {
    switch (input.mode) {
      case "weekly":
        return weeklyTotals[Math.floor(index / 7)] ?? 0;
      case "cumulative":
        return cumulative[index] ?? 0;
      case "daily":
        return dailyTokens[index] ?? 0;
    }
  };

  const levelFor = quantileLevels(dates.map((_, index) => aggregateFor(index)));
  const weeks: HeatmapCell[][] = [];
  const monthLabels: { label: string; column: number }[] = [];

  for (let week = 0; week < weekCount; week += 1) {
    const column: HeatmapCell[] = [];
    for (let weekday = 0; weekday < 7; weekday += 1) {
      const index = week * 7 + weekday;
      const dateKey = dates[index]!;
      const day = byDate.get(dateKey);
      const aggregate = aggregateFor(index);
      const future = dateKey > todayKey;
      column.push({
        dateKey,
        tokens: day?.tokens ?? 0,
        responses: day?.responses ?? 0,
        aggregate,
        level: future ? 0 : levelFor(aggregate),
        future,
      });
    }
    weeks.push(column);

    const firstDayOfColumn = dates[week * 7]!;
    const previousMonth = weeks.length > 1 ? dates[(week - 1) * 7]!.slice(0, 7) : null;
    if (firstDayOfColumn.slice(0, 7) !== previousMonth) {
      monthLabels.push({
        label: formatMonthLabel(firstDayOfColumn, input.language),
        column: week,
      });
    }
  }

  return { weeks, monthLabels, mode: input.mode };
}

export interface DonutSegment {
  readonly model: string;
  readonly color: string;
  readonly tokens: number;
  readonly share: number;
  readonly dashArray: string;
  readonly dashOffset: number;
}

export interface UsageDonut {
  readonly segments: ReadonlyArray<DonutSegment>;
  /** Models folded into the trailing "other" slice. */
  readonly otherModels: ReadonlyArray<ServerUsageStatisticsModel>;
  readonly totalTokens: number;
}

/** Largest number of model slices shown individually before the rest are grouped. */
export const DONUT_SEGMENT_LIMIT = 5;

/**
 * Donut geometry for the model split. Zero-token models are dropped — they add a
 * legend row that says nothing — and everything past the limit becomes one slice.
 */
export function buildUsageDonut(input: {
  readonly models: ReadonlyArray<ServerUsageStatisticsModel>;
  readonly circumference: number;
  readonly limit?: number;
  readonly gapPx?: number;
}): UsageDonut {
  const limit = Math.max(1, Math.floor(input.limit ?? DONUT_SEGMENT_LIMIT));
  const gapPx = Math.max(0, input.gapPx ?? 2);
  const ranked = input.models.filter((model) => model.tokens > 0);
  const totalTokens = ranked.reduce((sum, model) => sum + model.tokens, 0);
  if (totalTokens <= 0) {
    return { segments: [], otherModels: [], totalTokens: 0 };
  }

  const leading = ranked.slice(0, limit);
  const trailing = ranked.slice(limit);
  const slices = [
    ...leading.map((model) => ({
      model: model.model,
      color: usageModelColor(input.models, model.model),
      tokens: model.tokens,
    })),
    ...(trailing.length > 0
      ? [
          {
            model: "__other__",
            color: "#94A3B8",
            tokens: trailing.reduce((sum, model) => sum + model.tokens, 0),
          },
        ]
      : []),
  ];

  let consumedShare = 0;
  const segments = slices.map((slice) => {
    const share = slice.tokens / totalTokens;
    const lengthPx = Math.max(0.5, share * input.circumference - gapPx);
    const segment = {
      model: slice.model,
      color: slice.color,
      tokens: slice.tokens,
      share,
      dashArray: `${lengthPx} ${Math.max(0, input.circumference - lengthPx)}`,
      dashOffset: consumedShare === 0 ? 0 : -consumedShare * input.circumference,
    };
    consumedShare += share;
    return segment;
  });

  return { segments, otherModels: trailing, totalTokens };
}

/**
 * Catmull-Rom through the points, emitted as cubic Béziers, so the trend reads as
 * a curve while still passing exactly through every day it plots.
 */
export function buildSmoothPath(
  points: ReadonlyArray<{ readonly x: number; readonly y: number }>,
): string {
  if (points.length === 0) {
    return "";
  }
  const first = points[0]!;
  if (points.length === 1) {
    return `M ${first.x} ${first.y}`;
  }

  const at = (index: number) => points[Math.min(points.length - 1, Math.max(0, index))] ?? first;

  let path = `M ${first.x} ${first.y}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = at(index - 1);
    const current = at(index);
    const next = at(index + 1);
    const afterNext = at(index + 2);
    const controlOne = {
      x: current.x + (next.x - previous.x) / 6,
      y: current.y + (next.y - previous.y) / 6,
    };
    const controlTwo = {
      x: next.x - (afterNext.x - current.x) / 6,
      y: next.y - (afterNext.y - current.y) / 6,
    };
    path += ` C ${controlOne.x} ${controlOne.y}, ${controlTwo.x} ${controlTwo.y}, ${next.x} ${next.y}`;
  }

  return path;
}

/** Milliseconds in a day, exported so callers can label ranges without re-deriving it. */
export const USAGE_DAY_MS = ONE_DAY_MS;

export interface UsageSourceRow {
  readonly id: ServerUsageStatisticsSourceId;
  readonly label: string;
  readonly color: string;
  readonly tokens: number;
  /** Share of every tool's tokens on this machine, not of the current filter. */
  readonly share: number;
  readonly responses: number;
  readonly sessions: number;
  readonly models: number;
  readonly active: boolean;
  readonly lastUsedAt: string | null;
  readonly roots: ReadonlyArray<string>;
}

/**
 * Tool breakdown rows for the whole machine, so selecting one tool never changes
 * what the others appear to have spent. Inactive tools are kept with zeroed numbers
 * — "installed but unused" and "not installed" are different answers.
 */
export function buildUsageSourceRows(
  sources: ReadonlyArray<ServerUsageStatisticsSource>,
): ReadonlyArray<UsageSourceRow> {
  const machineTokens = sources.reduce((sum, source) => sum + source.tokens, 0);
  return sources
    .map((source) => ({
      id: source.id,
      label: source.label,
      color: usageSourceColor(source.id),
      tokens: source.tokens,
      share: machineTokens > 0 ? source.tokens / machineTokens : 0,
      responses: source.responses,
      sessions: source.sessions,
      models: source.models,
      active: source.active,
      lastUsedAt: source.lastUsedAt,
      roots: source.roots,
    }))
    .toSorted(
      (left, right) =>
        right.tokens - left.tokens ||
        Number(right.active) - Number(left.active) ||
        (left.id < right.id ? -1 : 1),
    );
}

/** Wide-bar geometry for the tool list: share of the busiest tool, so bars stay comparable. */
export function buildUsageSourceBars(rows: ReadonlyArray<UsageSourceRow>): ReadonlyArray<number> {
  const busiest = rows.reduce((max, row) => Math.max(max, row.tokens), 0);
  return rows.map((row) => (busiest > 0 ? row.tokens / busiest : 0));
}

export function formatDateTime(iso: string, language: Language): string {
  return new Intl.DateTimeFormat(localeFor(language), {
    month: language === "zh" ? "numeric" : "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function formatClockTime(iso: string, language: Language): string {
  return new Intl.DateTimeFormat(localeFor(language), {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(iso));
}
