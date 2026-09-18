// FILE: UsageStatsPanel.tsx
// Purpose: Settings → 使用统计. The local token ledger: headline totals, a year of
//          activity, the per-model daily trend, the model split, the tool breakdown
//          across every coding agent on this machine, and a session drill-down all
//          the way to individual requests.
// Layer: Route screen support
// Depends on: server.getUsageStatistics / server.getUsageSessionDetail, the usage
//             maths in lib/usageStatistics

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import type {
  ServerUsageStatisticsDay,
  ServerUsageStatisticsResult,
  ServerUsageStatisticsSession,
  ServerUsageStatisticsSourceId,
} from "@peakcode/contracts";

import { useTranslation, type Language, type Messages } from "../i18n";
import { Loader2Icon, RefreshCwIcon } from "../lib/icons";
import {
  usageSessionDetailQueryOptions,
  usageStatisticsQueryOptions,
} from "../lib/serverReactQuery";
import {
  buildSmoothPath,
  buildUsageDonut,
  buildUsageHeatmap,
  buildUsageSourceBars,
  buildUsageSourceRows,
  buildUsageTrend,
  formatClockTime,
  formatCount,
  formatDateTime,
  formatDuration,
  formatFullDate,
  formatSharePercent,
  formatStreakDays,
  formatTokenCount,
  HEATMAP_LEVEL_COLORS,
  usageModelColor,
  usageSourceColor,
  type HeatmapMode,
  type UsageHeatmap,
  type UsageSourceRow,
} from "../lib/usageStatistics";
import { Button } from "./ui/button";
import { Dialog, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "./ui/dialog";
import { Toggle, ToggleGroup } from "./ui/toggle-group";
import { toastManager } from "./ui/toast";
import { cn } from "../lib/utils";

const CARD_CLASS = "rounded-xl border border-border/70 bg-background";
const CARD_TITLE_CLASS = "text-[13px] font-medium text-foreground";

const TREND_RANGES = [7, 30] as const;
type TrendRange = (typeof TREND_RANGES)[number];

const HEATMAP_MODE_ORDER: ReadonlyArray<HeatmapMode> = ["daily", "weekly", "cumulative"];

const HEATMAP_CELL_PX = 11;
const HEATMAP_GAP_PX = 3;
const HEATMAP_PITCH_PX = HEATMAP_CELL_PX + HEATMAP_GAP_PX;

const TREND_WIDTH = 1200;
const TREND_HEIGHT = 300;
const TREND_PADDING = { top: 16, right: 12, bottom: 30, left: 12 } as const;

const DONUT_SIZE = 216;
const DONUT_STROKE = 32;
const DONUT_RADIUS = (DONUT_SIZE - DONUT_STROKE) / 2;
const DONUT_CIRCUMFERENCE = 2 * Math.PI * DONUT_RADIUS;

type UsageMessages = Messages["settings"]["usage"];

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className={cn(CARD_CLASS, "px-4 py-4")} data-slot="usage-stat-card">
      <div className="truncate text-[19px] leading-7 font-semibold tabular-nums text-foreground">
        {value}
      </div>
      <div className="mt-0.5 truncate text-[11.5px] text-muted-foreground">{label}</div>
      {hint ? (
        <div className="mt-0.5 truncate text-[10.5px] text-muted-foreground/80">{hint}</div>
      ) : null}
    </div>
  );
}

/** Shared chrome for the chart cards: title on the left, controls on the right. */
function StatsCard({
  title,
  description,
  controls,
  children,
  className,
}: {
  title: string;
  description?: string;
  controls?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn(CARD_CLASS, "p-4", className)}>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className={CARD_TITLE_CLASS}>{title}</h3>
          {description ? (
            <p className="mt-0.5 text-[11.5px] text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {controls}
      </header>
      {children}
    </section>
  );
}

/**
 * Tool chips. Only tools that spent something are offered as filters — a chip that
 * filters to zero would be a dead end — while the breakdown card below still lists
 * the tools that produced nothing, with the path it looked in.
 */
function ToolFilter({
  rows,
  selected,
  onSelect,
  language,
  messages,
}: {
  rows: ReadonlyArray<UsageSourceRow>;
  selected: ServerUsageStatisticsSourceId | null;
  onSelect: (source: ServerUsageStatisticsSourceId | null) => void;
  language: Language;
  messages: UsageMessages["filter"];
}) {
  const usable = rows.filter((row) => row.tokens > 0);
  if (usable.length <= 1) {
    return null;
  }

  const chipClass = (active: boolean) =>
    cn(
      "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] transition-colors",
      active
        ? "border-foreground/25 bg-foreground/8 text-foreground"
        : "border-border/70 text-muted-foreground hover:bg-foreground/4 hover:text-foreground",
    );

  return (
    <div className="flex flex-wrap items-center gap-2" data-slot="usage-tool-filter">
      <span className="text-[11.5px] text-muted-foreground">{messages.label}</span>
      <button type="button" className={chipClass(selected === null)} onClick={() => onSelect(null)}>
        {messages.all}
      </button>
      {usable.map((row) => (
        <button
          key={row.id}
          type="button"
          className={chipClass(selected === row.id)}
          onClick={() => onSelect(row.id)}
          data-usage-filter={row.id}
        >
          <span className="size-1.5 rounded-full" style={{ backgroundColor: row.color }} />
          {row.label}
          <span className="tabular-nums opacity-70">{formatTokenCount(row.tokens, language)}</span>
        </button>
      ))}
    </div>
  );
}

function ToolBreakdown({
  rows,
  language,
  selected,
  onSelect,
  messages,
}: {
  rows: ReadonlyArray<UsageSourceRow>;
  language: Language;
  selected: ServerUsageStatisticsSourceId | null;
  onSelect: (source: ServerUsageStatisticsSourceId | null) => void;
  messages: UsageMessages["tools"];
}) {
  const bars = buildUsageSourceBars(rows);

  return (
    <ul className="mt-4 space-y-1" data-slot="usage-tool-list">
      {rows.map((row, index) => (
        <li key={row.id}>
          <button
            type="button"
            className={cn(
              "w-full rounded-lg px-2 py-2 text-left transition-colors",
              selected === row.id ? "bg-foreground/6" : "hover:bg-foreground/4",
              row.tokens === 0 && "cursor-default",
            )}
            onClick={() => onSelect(selected === row.id ? null : row.id)}
            disabled={row.tokens === 0}
            data-usage-tool-row={row.id}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2">
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: row.color }}
                />
                <span className="truncate text-[12.5px] font-medium text-foreground">
                  {row.label}
                </span>
                {row.active ? null : (
                  <span className="shrink-0 rounded-full bg-foreground/6 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {messages.inactive}
                  </span>
                )}
              </span>
              <span className="flex shrink-0 items-baseline gap-3 tabular-nums">
                <span className="text-[12.5px] text-foreground">
                  {formatTokenCount(row.tokens, language)}
                </span>
                <span className="w-10 text-right text-[11.5px] text-muted-foreground">
                  {formatSharePercent(row.share, language)}
                </span>
              </span>
            </div>
            <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-foreground/6">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.round((bars[index] ?? 0) * 100)}%`,
                  backgroundColor: row.color,
                }}
              />
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
              {row.active ? (
                <>
                  <span>{messages.sessions(formatCount(row.sessions, language))}</span>
                  <span>{messages.models(formatCount(row.models, language))}</span>
                  {row.lastUsedAt ? (
                    <span>{messages.lastUsed(formatDateTime(row.lastUsedAt, language))}</span>
                  ) : null}
                </>
              ) : (
                <span className="truncate" title={row.roots.join(", ")}>
                  {row.roots.join(", ")}
                </span>
              )}
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Where the tokens went by kind: input, output, and the two cache directions. */
function TokenMix({
  result,
  language,
  messages,
}: {
  result: ServerUsageStatisticsResult;
  language: Language;
  messages: UsageMessages["mix"];
}) {
  const total = result.totals.tokens;
  if (total <= 0) {
    return null;
  }

  const parts = [
    { label: messages.input, value: result.totals.inputTokens, color: "#3B82F6" },
    { label: messages.output, value: result.totals.outputTokens, color: "#22C55E" },
    { label: messages.cacheRead, value: result.totals.cacheReadTokens, color: "#A855F7" },
    { label: messages.cacheWrite, value: result.totals.cacheWriteTokens, color: "#F59E0B" },
  ].filter((part) => part.value > 0);

  return (
    <div className="mt-4" data-slot="usage-token-mix">
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-foreground/6">
        {parts.map((part) => (
          <div
            key={part.label}
            style={{ width: `${(part.value / total) * 100}%`, backgroundColor: part.color }}
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {parts.map((part) => (
          <span key={part.label} className="flex items-center gap-1.5 text-[11.5px]">
            <span className="size-1.5 rounded-full" style={{ backgroundColor: part.color }} />
            <span className="text-muted-foreground">{part.label}</span>
            <span className="tabular-nums text-foreground">
              {formatTokenCount(part.value, language)}
            </span>
            <span className="tabular-nums text-muted-foreground">
              {formatSharePercent(part.value / total, language)}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

function ActivityHeatmap({
  days,
  mode,
  language,
  messages,
}: {
  days: ReadonlyArray<ServerUsageStatisticsDay>;
  mode: HeatmapMode;
  language: Language;
  messages: UsageMessages["activity"];
}) {
  const [hovered, setHovered] = useState<{ dateKey: string; column: number; row: number } | null>(
    null,
  );
  const heatmap: UsageHeatmap = useMemo(
    () => buildUsageHeatmap({ days, mode, nowMs: Date.now(), language }),
    [days, mode, language],
  );
  const hoveredCell = hovered ? heatmap.weeks[hovered.column]?.[hovered.row] : undefined;

  return (
    <div className="relative mt-4">
      <div className="overflow-x-auto pt-8 pb-1">
        <div className="relative" style={{ width: heatmap.weeks.length * HEATMAP_PITCH_PX }}>
          <div className="absolute top-0 left-0 h-4 w-full">
            {heatmap.monthLabels.map((month) => (
              <span
                key={`${month.label}-${month.column}`}
                className="absolute text-[10.5px] text-muted-foreground"
                style={{ left: month.column * HEATMAP_PITCH_PX }}
              >
                {month.label}
              </span>
            ))}
          </div>

          <div className="flex" style={{ gap: HEATMAP_GAP_PX }}>
            {heatmap.weeks.map((week, column) => (
              <div key={week[0]?.dateKey} className="flex flex-col" style={{ gap: HEATMAP_GAP_PX }}>
                {week.map((cell, row) => (
                  <div
                    key={cell.dateKey}
                    aria-hidden={cell.future}
                    className={cn(
                      "rounded-[2.5px] transition-transform",
                      !cell.future && "hover:scale-110",
                    )}
                    style={{
                      width: HEATMAP_CELL_PX,
                      height: HEATMAP_CELL_PX,
                      backgroundColor: cell.future
                        ? "transparent"
                        : HEATMAP_LEVEL_COLORS[cell.level],
                    }}
                    onMouseEnter={() =>
                      cell.future
                        ? setHovered(null)
                        : setHovered({ dateKey: cell.dateKey, column, row })
                    }
                    onMouseLeave={() => setHovered(null)}
                    data-usage-date={cell.future ? undefined : cell.dateKey}
                    data-usage-level={cell.future ? undefined : cell.level}
                  />
                ))}
              </div>
            ))}
          </div>

          {hovered && hoveredCell ? (
            <div
              className="pointer-events-none absolute z-10 w-max max-w-[220px] rounded-lg border border-border/70 bg-[var(--color-background-elevated-primary-opaque,var(--color-background-panel))] px-2.5 py-1.5 shadow-md"
              style={{
                left: hovered.column * HEATMAP_PITCH_PX + HEATMAP_CELL_PX / 2,
                top: hovered.row * HEATMAP_PITCH_PX - 6,
                transform: "translate(-50%, -100%)",
              }}
              data-slot="usage-heatmap-tooltip"
            >
              <div className="text-[11.5px] font-medium text-foreground">
                {formatFullDate(hoveredCell.dateKey, language)}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {formatTokenCount(hoveredCell.tokens, language)} tokens ·{" "}
                {messages.responses(formatCount(hoveredCell.responses, language))}
              </div>
              {mode === "weekly" ? (
                <div className="text-[11px] text-muted-foreground">
                  {messages.weekTotal(formatTokenCount(hoveredCell.aggregate, language))}
                </div>
              ) : null}
              {mode === "cumulative" ? (
                <div className="text-[11px] text-muted-foreground">
                  {messages.cumulativeTotal(formatTokenCount(hoveredCell.aggregate, language))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function TrendChart({
  result,
  rangeDays,
  language,
  ariaLabel,
}: {
  result: ServerUsageStatisticsResult;
  rangeDays: TrendRange;
  language: Language;
  ariaLabel: string;
}) {
  const trend = useMemo(
    () =>
      buildUsageTrend({
        days: result.days,
        models: result.models,
        rangeDays,
        nowMs: Date.now(),
        language,
      }),
    [result.days, result.models, rangeDays, language],
  );

  const plotWidth = TREND_WIDTH - TREND_PADDING.left - TREND_PADDING.right;
  const plotHeight = TREND_HEIGHT - TREND_PADDING.top - TREND_PADDING.bottom;
  const pointCount = trend.dates.length;
  const ceiling = trend.maxTokens > 0 ? trend.maxTokens : 1;
  const xAt = (index: number) =>
    TREND_PADDING.left + (pointCount <= 1 ? 0 : (index / (pointCount - 1)) * plotWidth);
  const yAt = (value: number) => TREND_PADDING.top + (1 - value / ceiling) * plotHeight;

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        {trend.series.map((series) => (
          <span key={series.model} className="flex min-w-0 items-center gap-1.5">
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: series.color }}
            />
            <span className="truncate text-[12px] text-foreground">{series.model}</span>
          </span>
        ))}
      </div>

      <svg
        viewBox={`0 0 ${TREND_WIDTH} ${TREND_HEIGHT}`}
        className="mt-2 w-full"
        role="img"
        aria-label={ariaLabel}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
          const y = TREND_PADDING.top + fraction * plotHeight;
          return (
            <line
              key={fraction}
              x1={TREND_PADDING.left}
              x2={TREND_WIDTH - TREND_PADDING.right}
              y1={y}
              y2={y}
              className="text-border"
              stroke="currentColor"
              strokeWidth={1}
              strokeDasharray="3 5"
            />
          );
        })}

        {trend.series.map((series) => (
          <path
            key={series.model}
            d={buildSmoothPath(
              series.points.map((value, index) => ({ x: xAt(index), y: yAt(value) })),
            )}
            fill="none"
            stroke={series.color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}

        {trend.ticks.map((tick) => (
          <text
            key={tick.date}
            x={xAt(tick.index)}
            y={TREND_HEIGHT - 8}
            textAnchor={
              tick.index === 0 ? "start" : tick.index === trend.dates.length - 1 ? "end" : "middle"
            }
            className="fill-muted-foreground text-[12px]"
          >
            {tick.label}
          </text>
        ))}
      </svg>
    </div>
  );
}

function ModelBreakdown({
  result,
  language,
  otherLabel,
}: {
  result: ServerUsageStatisticsResult;
  language: Language;
  otherLabel: string;
}) {
  const donut = useMemo(
    () => buildUsageDonut({ models: result.models, circumference: DONUT_CIRCUMFERENCE }),
    [result.models],
  );
  const labelFor = (model: string) => (model === "__other__" ? otherLabel : model);
  const colorFor = (model: string) =>
    model === "__other__" ? "#94A3B8" : usageModelColor(result.models, model);

  if (donut.segments.length === 0) {
    return null;
  }

  return (
    <div className="mt-5 flex flex-col items-center gap-8 md:flex-row">
      <div className="relative shrink-0" style={{ width: DONUT_SIZE, height: DONUT_SIZE }}>
        <svg
          viewBox={`0 0 ${DONUT_SIZE} ${DONUT_SIZE}`}
          width={DONUT_SIZE}
          height={DONUT_SIZE}
          role="img"
          aria-label={`${formatTokenCount(donut.totalTokens, language)} tokens`}
        >
          <circle
            cx={DONUT_SIZE / 2}
            cy={DONUT_SIZE / 2}
            r={DONUT_RADIUS}
            fill="none"
            stroke={HEATMAP_LEVEL_COLORS[0]}
            strokeWidth={DONUT_STROKE}
          />
          {donut.segments.map((segment) => (
            <circle
              key={segment.model}
              cx={DONUT_SIZE / 2}
              cy={DONUT_SIZE / 2}
              r={DONUT_RADIUS}
              fill="none"
              stroke={segment.color}
              strokeWidth={DONUT_STROKE}
              strokeDasharray={segment.dashArray}
              strokeDashoffset={segment.dashOffset}
              transform={`rotate(-90 ${DONUT_SIZE / 2} ${DONUT_SIZE / 2})`}
            />
          ))}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[20px] font-semibold tabular-nums text-foreground">
            {formatTokenCount(donut.totalTokens, language)}
          </span>
          <span className="text-[11px] text-muted-foreground">tokens</span>
        </div>
      </div>

      <ul className="w-full min-w-0 flex-1 divide-y divide-[color:var(--color-border-light)]">
        {donut.segments.map((segment) => (
          <li key={segment.model} className="py-2.5 first:pt-0 last:pb-0">
            <div className="flex items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: colorFor(segment.model) }}
                />
                <span className="truncate text-[13px] font-medium text-foreground">
                  {labelFor(segment.model)}
                </span>
              </div>
              <span className="shrink-0 text-[12.5px] tabular-nums text-muted-foreground">
                {formatSharePercent(segment.share, language)}
              </span>
            </div>
            <div className="mt-0.5 pl-4 text-[12px] text-muted-foreground">
              {formatTokenCount(segment.tokens, language)} tokens
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SessionRequestsDialog({
  session,
  onOpenChange,
  language,
  messages,
}: {
  session: ServerUsageStatisticsSession | null;
  onOpenChange: (open: boolean) => void;
  language: Language;
  messages: UsageMessages["sessions"];
}) {
  const detail = useQuery(
    usageSessionDetailQueryOptions({
      source: session?.source ?? null,
      sessionId: session?.sessionId ?? null,
    }),
  );

  return (
    <Dialog open={session !== null} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-3xl" data-slot="usage-session-dialog">
        <DialogHeader>
          <DialogTitle>{messages.detailTitle}</DialogTitle>
          <p className="text-[12px] text-muted-foreground">
            {[session?.project ?? session?.source, session?.sessionId]
              .filter((part): part is string => typeof part === "string" && part.length > 0)
              .join(" · ")}
          </p>
        </DialogHeader>
        <DialogPanel>
          {detail.isLoading ? (
            <div className="flex items-center gap-2 py-6 text-[12px] text-muted-foreground">
              <Loader2Icon className="size-4 animate-spin" />
            </div>
          ) : null}
          {detail.data && detail.data.requests.length === 0 ? (
            <p className="py-4 text-[12px] text-muted-foreground">{messages.detailEmpty}</p>
          ) : null}
          {detail.data && detail.data.requests.length > 0 ? (
            <div className="max-h-[50vh] overflow-y-auto">
              <table className="w-full border-collapse text-[11.5px]">
                <thead className="sticky top-0 bg-[var(--color-background-panel)]">
                  <tr className="text-left text-muted-foreground">
                    <th className="py-1.5 pr-3 font-medium">#</th>
                    <th className="py-1.5 pr-3 font-medium">{messages.time}</th>
                    <th className="py-1.5 pr-3 font-medium">{messages.model}</th>
                    <th className="py-1.5 pr-3 text-right font-medium">{messages.input}</th>
                    <th className="py-1.5 pr-3 text-right font-medium">{messages.output}</th>
                    <th className="py-1.5 pr-3 text-right font-medium">{messages.cache}</th>
                    <th className="py-1.5 text-right font-medium">{messages.total}</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.data.requests.map((request) => (
                    <tr
                      key={request.sequence}
                      className="border-t border-[color:var(--color-border-light)]"
                    >
                      <td className="py-1.5 pr-3 tabular-nums text-muted-foreground/70">
                        {formatCount(request.sequence, language)}
                      </td>
                      <td className="py-1.5 pr-3 tabular-nums text-muted-foreground">
                        {formatClockTime(request.timestamp, language)}
                      </td>
                      <td className="max-w-[18rem] truncate py-1.5 pr-3 text-foreground">
                        {request.model}
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">
                        {formatCount(request.inputTokens, language)}
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">
                        {formatCount(request.outputTokens, language)}
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-muted-foreground">
                        {formatCount(request.cacheReadTokens, language)} /{" "}
                        {formatCount(request.cacheWriteTokens, language)}
                      </td>
                      <td className="py-1.5 text-right tabular-nums text-foreground">
                        {formatCount(request.tokens, language)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {detail.data.droppedRequests > 0 ? (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  {messages.dropped(formatCount(detail.data.droppedRequests, language))}
                </p>
              ) : null}
            </div>
          ) : null}
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}

function SessionList({
  result,
  language,
  messages,
  onOpenSession,
}: {
  result: ServerUsageStatisticsResult;
  language: Language;
  messages: UsageMessages["sessions"];
  onOpenSession: (session: ServerUsageStatisticsSession) => void;
}) {
  if (result.sessions.length === 0) {
    return null;
  }

  return (
    <ul
      className="mt-4 divide-y divide-[color:var(--color-border-light)]"
      data-slot="usage-sessions"
    >
      {result.sessions.map((session) => {
        const durationMs =
          new Date(session.endedAt).getTime() - new Date(session.startedAt).getTime();
        return (
          <li key={`${session.source}-${session.sessionId}`}>
            <button
              type="button"
              className="w-full px-1 py-2.5 text-left transition-colors hover:bg-foreground/4 disabled:cursor-default disabled:hover:bg-transparent"
              onClick={() => onOpenSession(session)}
              disabled={!session.hasRequestDetail}
              title={session.hasRequestDetail ? messages.detail : messages.unavailable}
              data-usage-session={session.sessionId}
            >
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: usageSourceColor(session.source) }}
                  />
                  <span className="truncate text-[12.5px] font-medium text-foreground">
                    {session.project ?? session.sessionId}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {formatDateTime(session.startedAt, language)}
                  </span>
                </span>
                <span className="flex shrink-0 items-baseline gap-3 tabular-nums">
                  <span className="text-[11px] text-muted-foreground">
                    {messages.requestCount(formatCount(session.responses, language))}
                  </span>
                  <span className="text-[12.5px] text-foreground">
                    {formatTokenCount(session.tokens, language)}
                  </span>
                </span>
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[11px] text-muted-foreground">
                <span>{formatDuration(durationMs, language)}</span>
                <span className="truncate">{session.models.join(", ")}</span>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function EmptyCard({ title, description }: { title: string; description: string }) {
  return (
    <div className={cn(CARD_CLASS, "border-dashed px-5 py-10 text-center")}>
      <h3 className="text-[13px] font-medium text-foreground">{title}</h3>
      <p className="mx-auto mt-1 max-w-md text-[12px] text-muted-foreground">{description}</p>
    </div>
  );
}

export function UsageStatsPanel() {
  const { language, messages } = useTranslation();
  const t = messages.settings.usage;
  const queryClient = useQueryClient();
  const [source, setSource] = useState<ServerUsageStatisticsSourceId | null>(null);
  const [rangeDays, setRangeDays] = useState<TrendRange>(7);
  const [heatmapMode, setHeatmapMode] = useState<HeatmapMode>("daily");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [openSession, setOpenSession] = useState<ServerUsageStatisticsSession | null>(null);

  const query = useQuery(usageStatisticsQueryOptions({ source }));

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      // staleTime 0 keeps the cached-but-fresh snapshot from short-circuiting the
      // request: the whole point of this button is to rescan the logs now.
      await queryClient.fetchQuery({
        ...usageStatisticsQueryOptions({ source, refresh: true }),
        staleTime: 0,
      });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: t.errorTitle,
        description: error instanceof Error ? error.message : t.emptyDescription,
      });
    } finally {
      setIsRefreshing(false);
    }
  };

  const statistics = query.data;
  const sourceRows = useMemo(
    () => (statistics ? buildUsageSourceRows(statistics.sources) : []),
    [statistics],
  );
  const hasUsage = statistics !== undefined && statistics.totals.sessions > 0;
  const selectedLabel = sourceRows.find((row) => row.id === source)?.label ?? t.filter.all;

  return (
    <div className="space-y-5" data-slot="usage-stats-panel">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-foreground/8 px-2 py-0.5 text-[11px] font-medium text-foreground/78">
          {t.badge}
        </span>
        <span className="text-[11.5px] text-muted-foreground">
          {t.scope(formatCount(statistics?.windowDays ?? 400, language))}
        </span>
      </div>

      {query.isError ? (
        <EmptyCard
          title={t.errorTitle}
          description={query.error instanceof Error ? query.error.message : t.emptyDescription}
        />
      ) : null}

      {query.isLoading ? (
        <div
          className={cn(
            CARD_CLASS,
            "flex items-center justify-center gap-2 border-dashed px-5 py-10 text-[12px] text-muted-foreground",
          )}
        >
          <Loader2Icon className="size-4 animate-spin" />
          {t.loading}
        </div>
      ) : null}

      {statistics !== undefined && !hasUsage ? (
        <EmptyCard title={t.emptyTitle} description={t.emptyDescription} />
      ) : null}

      {statistics !== undefined && hasUsage ? (
        <>
          <ToolFilter
            rows={sourceRows}
            selected={source}
            onSelect={setSource}
            language={language}
            messages={t.filter}
          />

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <StatCard
              label={t.stats.cumulativeTokens}
              value={formatTokenCount(statistics.totals.tokens, language)}
              hint={t.activity.responses(formatCount(statistics.totals.responses, language))}
            />
            <StatCard
              label={t.stats.peakTokens}
              value={formatTokenCount(statistics.totals.peakDayTokens, language)}
              {...(statistics.totals.peakDay
                ? { hint: formatFullDate(statistics.totals.peakDay, language) }
                : {})}
            />
            <StatCard
              label={t.stats.longestChat}
              value={formatDuration(statistics.totals.longestChatMs, language)}
            />
            <StatCard
              label={t.stats.currentStreak}
              value={formatStreakDays(statistics.totals.currentStreakDays, language)}
            />
            <StatCard
              label={t.stats.longestStreak}
              value={formatStreakDays(statistics.totals.longestStreakDays, language)}
            />
          </div>

          <StatsCard title={t.tools.title} description={t.tools.description}>
            <ToolBreakdown
              rows={sourceRows}
              language={language}
              selected={source}
              onSelect={setSource}
              messages={t.tools}
            />
          </StatsCard>

          <StatsCard title={t.mix.title}>
            <TokenMix result={statistics} language={language} messages={t.mix} />
          </StatsCard>

          <StatsCard
            title={t.activity.title}
            controls={
              <ToggleGroup
                variant="outline"
                size="xs"
                value={[heatmapMode]}
                onValueChange={(value) => {
                  const next = value[0];
                  if (next === "daily" || next === "weekly" || next === "cumulative") {
                    setHeatmapMode(next);
                  }
                }}
                data-slot="usage-heatmap-modes"
              >
                {HEATMAP_MODE_ORDER.map((mode) => (
                  <Toggle key={mode} value={mode}>
                    {mode === "daily"
                      ? t.activity.daily
                      : mode === "weekly"
                        ? t.activity.weekly
                        : t.activity.cumulative}
                  </Toggle>
                ))}
              </ToggleGroup>
            }
          >
            <ActivityHeatmap
              days={statistics.days}
              mode={heatmapMode}
              language={language}
              messages={t.activity}
            />
          </StatsCard>

          <div className="flex items-center justify-between gap-3">
            <span className={CARD_TITLE_CLASS}>{t.range.label}</span>
            <ToggleGroup
              variant="outline"
              size="xs"
              value={[String(rangeDays)]}
              onValueChange={(value) => {
                const next = Number.parseInt(value[0] ?? "", 10);
                if (TREND_RANGES.includes(next as TrendRange)) {
                  setRangeDays(next as TrendRange);
                }
              }}
              data-slot="usage-range-modes"
            >
              <Toggle value="7">{t.range.last7}</Toggle>
              <Toggle value="30">{t.range.last30}</Toggle>
            </ToggleGroup>
          </div>

          <StatsCard title={`${t.trend.title} · ${selectedLabel}`}>
            <TrendChart
              result={statistics}
              rangeDays={rangeDays}
              language={language}
              ariaLabel={t.trend.title}
            />
          </StatsCard>

          <StatsCard title={t.models.title}>
            <ModelBreakdown result={statistics} language={language} otherLabel={t.models.other} />
          </StatsCard>

          <StatsCard title={t.sessions.title}>
            <SessionList
              result={statistics}
              language={language}
              messages={t.sessions}
              onOpenSession={setOpenSession}
            />
          </StatsCard>

          <div className="flex flex-wrap items-center justify-end gap-3">
            <span className="text-[11.5px] text-muted-foreground">
              {t.generatedAt(formatDateTime(statistics.generatedAt, language))}
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void handleRefresh()}
              disabled={isRefreshing}
            >
              <RefreshCwIcon className={isRefreshing ? "animate-spin" : undefined} />
              {t.refresh}
            </Button>
          </div>
        </>
      ) : null}

      <SessionRequestsDialog
        session={openSession}
        onOpenChange={(open) => (open ? undefined : setOpenSession(null))}
        language={language}
        messages={t.sessions}
      />
    </div>
  );
}
