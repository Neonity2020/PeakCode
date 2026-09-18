// FILE: usageStatistics.ts
// Purpose: Build the numbers behind Settings → 使用统计 from every local coding
// agent's own session records: this app's Pi sessions, and the other tools the user
// runs on the same machine (Claude Code, Codex, ZCode, WorkBuddy, OpenCode, ccmr,
// Grok, DeepSeek Harness).
//
// Nothing here is persisted: local logs are the source of truth, they are read
// through a per-file cache, and the folded result is what gets held in memory.
// See usageCollectors.ts for the per-tool formats and usageAggregate.ts for the
// folding that keeps a long-lived process bounded.

import type {
  ServerGetUsageSessionDetailInput,
  ServerGetUsageSessionDetailResult,
  ServerGetUsageStatisticsInput,
  ServerUsageStatisticsResult,
  ServerUsageStatisticsSource,
} from "@peakcode/contracts";
import { Effect } from "effect";

import {
  collectUsageInto,
  createUsageFileCache,
  usageSourceCatalog,
  USAGE_WINDOW_DAYS,
  type UsageSourceId,
} from "./usageCollectors.ts";
import {
  localDateKey,
  UsageAccumulator,
  type UsageDayModelRow,
  type UsageSessionSlice,
} from "./usageAggregate.ts";

/** How long a folded scan is reused before the next request re-reads changed files. */
const STATISTICS_CACHE_TTL_MS = 30_000;
const ONE_DAY_MS = 24 * 60 * 60 * 1_000;
/** Sessions listed in the drill-down table. */
const MAX_LISTED_SESSIONS = 25;
const USAGE_STATISTICS_SOURCE = "local-agent-logs";

interface CachedScan {
  expiresAtMs: number;
  accumulator: UsageAccumulator;
  activeSources: ReadonlySet<UsageSourceId>;
  pending: Promise<CachedScan> | null;
}

let scanCache: CachedScan | null = null;
const fileCache = createUsageFileCache();

function dayNumberOf(dateKey: string): number {
  const [year, month, day] = dateKey.split("-").map((part) => Number.parseInt(part, 10));
  return Math.floor(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1) / ONE_DAY_MS);
}

function computeStreaks(
  activeDayNumbers: ReadonlyArray<number>,
  nowMs: number,
): { currentStreakDays: number; longestStreakDays: number } {
  const sortedDays = [...new Set(activeDayNumbers)].toSorted((left, right) => left - right);
  if (sortedDays.length === 0) {
    return { currentStreakDays: 0, longestStreakDays: 0 };
  }

  let longestStreakDays = 1;
  let runLength = 1;
  for (let index = 1; index < sortedDays.length; index += 1) {
    runLength = sortedDays[index] === (sortedDays[index - 1] ?? 0) + 1 ? runLength + 1 : 1;
    longestStreakDays = Math.max(longestStreakDays, runLength);
  }

  // A streak stays alive while today has not been missed yet, so an untouched
  // "today" continues yesterday's run instead of resetting it to zero.
  const todayNumber = dayNumberOf(localDateKey(nowMs));
  const activeDays = new Set(sortedDays);
  let cursor = activeDays.has(todayNumber)
    ? todayNumber
    : activeDays.has(todayNumber - 1)
      ? todayNumber - 1
      : null;
  let currentStreakDays = 0;
  while (cursor !== null && activeDays.has(cursor)) {
    currentStreakDays += 1;
    cursor -= 1;
  }

  return { currentStreakDays, longestStreakDays };
}

export interface BuildUsageStatisticsInput {
  readonly dayRows: ReadonlyArray<UsageDayModelRow>;
  readonly sessions: ReadonlyArray<UsageSessionSlice>;
  readonly activeSources: ReadonlySet<UsageSourceId>;
  readonly nowMs: number;
  /** Restrict every aggregate to one tool; the source list always covers all of them. */
  readonly sourceFilter?: UsageSourceId | undefined;
  readonly windowDays?: number | undefined;
}

interface SourceTotals {
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  responses: number;
  readonly models: Map<string, number>;
  lastUsedMs: number;
}

/**
 * Fold the per-day rows into the panel's snapshot. Rows are already grouped by
 * (day, tool, model), so this is one pass plus the derived totals — the heavy work
 * happened during collection.
 */
export function buildUsageStatistics(
  input: BuildUsageStatisticsInput,
): ServerUsageStatisticsResult {
  const filteredRows = input.sourceFilter
    ? input.dayRows.filter((row) => row.source === input.sourceFilter)
    : input.dayRows;
  const filteredSessions = input.sourceFilter
    ? input.sessions.filter((session) => session.source === input.sourceFilter)
    : input.sessions;

  const sourceTotals = new Map<UsageSourceId, SourceTotals>();
  const dayTotals = new Map<
    string,
    {
      tokens: number;
      responses: number;
      readonly bySource: Map<
        UsageSourceId,
        { tokens: number; responses: number; models: Map<string, number> }
      >;
    }
  >();
  const modelTotals = new Map<
    string,
    { tokens: number; responses: number; readonly sources: Set<UsageSourceId>; lastUsedMs: number }
  >();

  let tokens = 0;
  let responses = 0;
  let activeDays = 0;

  for (const source of usageSourceCatalog()) {
    sourceTotals.set(source.id, {
      tokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
      responses: 0,
      models: new Map(),
      lastUsedMs: 0,
    });
  }

  // The tool breakdown is deliberately unfiltered: picking one tool must not erase
  // the numbers that let the user pick a different one.
  for (const row of input.dayRows) {
    const totals = sourceTotals.get(row.source);
    if (!totals) {
      continue;
    }
    const timestampMs = Date.parse(`${row.date}T12:00:00`);
    totals.tokens += row.tokens;
    totals.inputTokens += row.inputTokens;
    totals.outputTokens += row.outputTokens;
    totals.cacheReadTokens += row.cacheReadTokens;
    totals.cacheWriteTokens += row.cacheWriteTokens;
    totals.reasoningTokens += row.reasoningTokens;
    totals.responses += row.responses;
    totals.lastUsedMs = Math.max(totals.lastUsedMs, timestampMs);
    totals.models.set(row.model, (totals.models.get(row.model) ?? 0) + row.tokens);
  }

  for (const row of filteredRows) {
    const timestampMs = Date.parse(`${row.date}T12:00:00`);
    tokens += row.tokens;
    responses += row.responses;

    const day = dayTotals.get(row.date) ?? { tokens: 0, responses: 0, bySource: new Map() };
    day.tokens += row.tokens;
    day.responses += row.responses;
    const daySource = day.bySource.get(row.source) ?? {
      tokens: 0,
      responses: 0,
      models: new Map<string, number>(),
    };
    daySource.tokens += row.tokens;
    daySource.responses += row.responses;
    daySource.models.set(row.model, (daySource.models.get(row.model) ?? 0) + row.tokens);
    day.bySource.set(row.source, daySource);
    dayTotals.set(row.date, day);

    const model = modelTotals.get(row.model) ?? {
      tokens: 0,
      responses: 0,
      sources: new Set<UsageSourceId>(),
      lastUsedMs: 0,
    };
    model.tokens += row.tokens;
    model.responses += row.responses;
    model.sources.add(row.source);
    model.lastUsedMs = Math.max(model.lastUsedMs, timestampMs);
    modelTotals.set(row.model, model);
  }

  activeDays = dayTotals.size;
  const orderedDays = [...dayTotals.entries()].toSorted(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );

  let peakDay: string | null = null;
  let peakDayTokens = 0;
  const days = orderedDays.map(([date, day]) => {
    if (day.tokens > peakDayTokens) {
      peakDay = date;
      peakDayTokens = day.tokens;
    }
    return {
      date,
      tokens: day.tokens,
      responses: day.responses,
      bySource: [...day.bySource.entries()]
        .map(([source, slice]) => ({
          source,
          tokens: slice.tokens,
          responses: slice.responses,
          models: [...slice.models.entries()]
            .map(([model, modelTokens]) => ({ model, tokens: modelTokens }))
            .toSorted(
              (left, right) => right.tokens - left.tokens || (left.model < right.model ? -1 : 1),
            ),
        }))
        .toSorted(
          (left, right) => right.tokens - left.tokens || (left.source < right.source ? -1 : 1),
        ),
    };
  });

  let longestChatMs = 0;
  let earliestAtMs: number | null = null;
  let latestAtMs: number | null = null;
  let sessionCount = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let reasoningTokens = 0;

  for (const session of filteredSessions) {
    if (session.responses === 0) {
      continue;
    }
    sessionCount += 1;
    longestChatMs = Math.max(longestChatMs, session.endedAtMs - session.startedAtMs);
    earliestAtMs =
      earliestAtMs === null ? session.startedAtMs : Math.min(earliestAtMs, session.startedAtMs);
    latestAtMs = latestAtMs === null ? session.endedAtMs : Math.max(latestAtMs, session.endedAtMs);
  }

  for (const row of filteredRows) {
    inputTokens += row.inputTokens;
    outputTokens += row.outputTokens;
    cacheReadTokens += row.cacheReadTokens;
    cacheWriteTokens += row.cacheWriteTokens;
    reasoningTokens += row.reasoningTokens;
  }

  const streaks = computeStreaks(
    orderedDays.map(([date]) => dayNumberOf(date)),
    input.nowMs,
  );

  const sources: ServerUsageStatisticsSource[] = usageSourceCatalog().map((source) => {
    const totals = sourceTotals.get(source.id);
    const sessionSlice = input.sessions.filter((session) => session.source === source.id);
    return {
      id: source.id,
      label: source.label,
      roots: [...source.roots],
      active: input.activeSources.has(source.id),
      tokens: totals?.tokens ?? 0,
      responses: totals?.responses ?? 0,
      sessions: sessionSlice.filter((session) => session.responses > 0).length,
      models: totals ? totals.models.size : 0,
      lastUsedAt:
        totals && totals.lastUsedMs > 0 ? new Date(totals.lastUsedMs).toISOString() : null,
    };
  });

  const sessions = filteredSessions
    .filter((session) => session.responses > 0)
    .toSorted((left, right) => right.endedAtMs - left.endedAtMs)
    .slice(0, MAX_LISTED_SESSIONS)
    .map((session) => ({
      source: session.source,
      sessionId: session.sessionId,
      project: session.project,
      startedAt: new Date(session.startedAtMs).toISOString(),
      endedAt: new Date(session.endedAtMs).toISOString(),
      tokens: session.tokens,
      responses: session.responses,
      models: session.modelTokens.slice(0, 4).map((entry) => entry.model),
      hasRequestDetail: session.requests !== null,
    }));

  return {
    generatedAt: new Date(input.nowMs).toISOString(),
    source: USAGE_STATISTICS_SOURCE,
    windowDays: input.windowDays ?? USAGE_WINDOW_DAYS,
    earliestAt: earliestAtMs === null ? null : new Date(earliestAtMs).toISOString(),
    latestAt: latestAtMs === null ? null : new Date(latestAtMs).toISOString(),
    totals: {
      tokens,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      reasoningTokens,
      peakDayTokens,
      peakDay,
      longestChatMs,
      currentStreakDays: streaks.currentStreakDays,
      longestStreakDays: streaks.longestStreakDays,
      activeDays,
      sessions: sessionCount,
      responses,
    },
    sources,
    days,
    models: [...modelTotals.entries()]
      .map(([model, totals]) => ({
        model,
        tokens: totals.tokens,
        responses: totals.responses,
        sources: [...totals.sources].toSorted(),
        lastUsedAt: new Date(totals.lastUsedMs > 0 ? totals.lastUsedMs : input.nowMs).toISOString(),
      }))
      .toSorted((left, right) => right.tokens - left.tokens || (left.model < right.model ? -1 : 1)),
    sessions,
  };
}

async function scanUsage(input: {
  readonly nowMs: number;
  readonly refresh: boolean;
  readonly windowDays: number;
}): Promise<CachedScan> {
  const existing = scanCache;
  if (!input.refresh && existing && existing.expiresAtMs > input.nowMs) {
    return existing;
  }
  if (!input.refresh && existing?.pending) {
    return existing.pending;
  }

  const pending = (async (): Promise<CachedScan> => {
    const accumulator = new UsageAccumulator();
    const { activeSources } = await collectUsageInto({
      accumulator,
      nowMs: input.nowMs,
      cache: fileCache,
      windowDays: input.windowDays,
    });
    accumulator.prune({ nowMs: input.nowMs });

    const scan: CachedScan = {
      expiresAtMs: Date.now() + STATISTICS_CACHE_TTL_MS,
      accumulator,
      activeSources,
      pending: null,
    };
    scanCache = scan;
    return scan;
  })();

  scanCache = {
    expiresAtMs: existing?.expiresAtMs ?? 0,
    accumulator: existing?.accumulator ?? new UsageAccumulator(),
    activeSources: existing?.activeSources ?? new Set(),
    pending,
  };
  return pending;
}

export const getUsageStatistics = Effect.fn(function* (input: ServerGetUsageStatisticsInput) {
  const nowMs = Date.now();
  const windowDays = input.windowDays ?? USAGE_WINDOW_DAYS;
  const scan = yield* Effect.tryPromise({
    try: () => scanUsage({ nowMs, refresh: input.refresh === true, windowDays }),
    catch: (cause) => new Error(`Failed to read local usage logs: ${String(cause)}`),
  });

  return buildUsageStatistics({
    dayRows: scan.accumulator.dayRows(),
    sessions: scan.accumulator.sessionSlices(),
    activeSources: scan.activeSources,
    nowMs,
    sourceFilter: input.source,
    windowDays,
  });
});

export const getUsageSessionDetail = Effect.fn(function* (input: ServerGetUsageSessionDetailInput) {
  const nowMs = Date.now();
  const scan = yield* Effect.tryPromise({
    try: () =>
      scanUsage({ nowMs, refresh: false, windowDays: input.windowDays ?? USAGE_WINDOW_DAYS }),
    catch: (cause) => new Error(`Failed to read local usage logs: ${String(cause)}`),
  });

  const session = scan.accumulator
    .sessionSlices()
    .find((slice) => slice.source === input.source && slice.sessionId === input.sessionId);

  return {
    source: input.source,
    sessionId: input.sessionId,
    project: session?.project ?? null,
    tokens: session?.tokens ?? 0,
    responses: session?.responses ?? 0,
    droppedRequests: session?.droppedRequests ?? 0,
    requests: (session?.requests ?? []).map((request, index) => ({
      sequence: (session?.droppedRequests ?? 0) + index + 1,
      timestamp: new Date(request.timestampMs).toISOString(),
      model: request.model,
      tokens: request.tokens,
      inputTokens: request.inputTokens,
      outputTokens: request.outputTokens,
      cacheReadTokens: request.cacheReadTokens,
      cacheWriteTokens: request.cacheWriteTokens,
    })),
  } satisfies ServerGetUsageSessionDetailResult;
});
