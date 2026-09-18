// FILE: usageAggregate.ts
// Purpose: Fold the normalized token-event stream into the shapes the statistics
// page renders — per day × tool × model, per session, and per model — while
// keeping the memory a long-lived process holds bounded.
//
// Why folding instead of keeping events: a heavy machine produces requests by the
// million (one local tool here logged 50k requests in two weeks), and holding every
// event for a year would cost hundreds of megabytes. Contributions are therefore
// folded as they are read, each file's contribution is what gets cached, and only
// the most recently active sessions keep their request log for drill-down.

import type { UsageEvent, UsageSourceId } from "./usageCollectors.ts";

/** Request rows kept per session before the older ones are dropped from the detail view. */
const MAX_SESSION_REQUESTS = 120;
/** Sessions whose request log stays available for drill-down; older ones keep their totals. */
const MAX_TRACKED_SESSIONS = 400;
/** How long a session may sit idle before its request log is released. */
const SESSION_REQUEST_TTL_MS = 14 * 24 * 60 * 60 * 1_000;

export interface UsageRequestRow {
  readonly timestampMs: number;
  readonly model: string;
  readonly tokens: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
}

export interface UsageDayModelRow {
  readonly date: string;
  readonly source: UsageSourceId;
  readonly model: string;
  readonly responses: number;
  readonly tokens: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly reasoningTokens: number;
}

export interface UsageSessionSlice {
  readonly source: UsageSourceId;
  readonly sessionId: string;
  readonly project: string | null;
  readonly startedAtMs: number;
  readonly endedAtMs: number;
  readonly responses: number;
  readonly tokens: number;
  readonly modelTokens: ReadonlyArray<{ model: string; tokens: number }>;
  /** null once the session aged out of drill-down retention. */
  readonly requests: ReadonlyArray<UsageRequestRow> | null;
  readonly droppedRequests: number;
}

export interface UsageContribution {
  readonly days: ReadonlyArray<UsageDayModelRow>;
  readonly sessions: ReadonlyArray<UsageSessionSlice>;
}

interface MutableSession {
  source: UsageSourceId;
  sessionId: string;
  project: string | null;
  startedAtMs: number;
  endedAtMs: number;
  responses: number;
  tokens: number;
  modelTokens: Map<string, number>;
  requests: UsageRequestRow[] | null;
  droppedRequests: number;
}

function padTwo(value: number): string {
  return String(value).padStart(2, "0");
}

/** Calendar day of a timestamp in the server's local timezone, as `YYYY-MM-DD`. */
export function localDateKey(timestampMs: number): string {
  const date = new Date(timestampMs);
  return `${date.getFullYear()}-${padTwo(date.getMonth() + 1)}-${padTwo(date.getDate())}`;
}

function dayModelKey(date: string, source: UsageSourceId, model: string): string {
  return `${date}\u0000${source}\u0000${model}`;
}

function sessionKey(source: UsageSourceId, sessionId: string): string {
  return `${source}\u0000${sessionId}`;
}

/**
 * Collects folded rows. `add` is called once per request and never retains the
 * event itself; `merge` folds a cached file contribution back in.
 */
export class UsageAccumulator {
  private readonly dayModels = new Map<string, UsageDayModelRow>();
  private readonly sessions = new Map<string, MutableSession>();

  add(event: UsageEvent, options?: { readonly fallbackSessionId?: string | null }): void {
    const sessionId = event.sessionId ?? options?.fallbackSessionId ?? null;
    const date = localDateKey(event.timestampMs);
    const key = dayModelKey(date, event.source, event.model);
    const existing = this.dayModels.get(key);
    if (existing) {
      this.dayModels.set(key, {
        ...existing,
        responses: existing.responses + 1,
        tokens: existing.tokens + event.totalTokens,
        inputTokens: existing.inputTokens + event.inputTokens,
        outputTokens: existing.outputTokens + event.outputTokens,
        cacheReadTokens: existing.cacheReadTokens + event.cacheReadTokens,
        cacheWriteTokens: existing.cacheWriteTokens + event.cacheWriteTokens,
        reasoningTokens: existing.reasoningTokens + event.reasoningTokens,
      });
    } else {
      this.dayModels.set(key, {
        date,
        source: event.source,
        model: event.model,
        responses: 1,
        tokens: event.totalTokens,
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
        cacheReadTokens: event.cacheReadTokens,
        cacheWriteTokens: event.cacheWriteTokens,
        reasoningTokens: event.reasoningTokens,
      });
    }

    if (sessionId === null) {
      return;
    }

    const session = this.sessions.get(sessionKey(event.source, sessionId));
    if (session) {
      session.project ??= event.project;
      session.startedAtMs = Math.min(session.startedAtMs, event.timestampMs);
      session.endedAtMs = Math.max(session.endedAtMs, event.timestampMs);
      session.responses += 1;
      session.tokens += event.totalTokens;
      session.modelTokens.set(
        event.model,
        (session.modelTokens.get(event.model) ?? 0) + event.totalTokens,
      );
      if (session.requests) {
        if (session.requests.length >= MAX_SESSION_REQUESTS) {
          session.requests.shift();
          session.droppedRequests += 1;
        }
        session.requests.push({
          timestampMs: event.timestampMs,
          model: event.model,
          tokens: event.totalTokens,
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
          cacheReadTokens: event.cacheReadTokens,
          cacheWriteTokens: event.cacheWriteTokens,
        });
      } else {
        session.droppedRequests += 1;
      }
      return;
    }

    this.sessions.set(sessionKey(event.source, sessionId), {
      source: event.source,
      sessionId,
      project: event.project,
      startedAtMs: event.timestampMs,
      endedAtMs: event.timestampMs,
      responses: 1,
      tokens: event.totalTokens,
      modelTokens: new Map([[event.model, event.totalTokens]]),
      requests: [
        {
          timestampMs: event.timestampMs,
          model: event.model,
          tokens: event.totalTokens,
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
          cacheReadTokens: event.cacheReadTokens,
          cacheWriteTokens: event.cacheWriteTokens,
        },
      ],
      droppedRequests: 0,
    });
  }

  merge(contribution: UsageContribution): void {
    for (const row of contribution.days) {
      const key = dayModelKey(row.date, row.source, row.model);
      const existing = this.dayModels.get(key);
      if (!existing) {
        this.dayModels.set(key, row);
        continue;
      }
      this.dayModels.set(key, {
        ...existing,
        responses: existing.responses + row.responses,
        tokens: existing.tokens + row.tokens,
        inputTokens: existing.inputTokens + row.inputTokens,
        outputTokens: existing.outputTokens + row.outputTokens,
        cacheReadTokens: existing.cacheReadTokens + row.cacheReadTokens,
        cacheWriteTokens: existing.cacheWriteTokens + row.cacheWriteTokens,
        reasoningTokens: existing.reasoningTokens + row.reasoningTokens,
      });
    }

    for (const slice of contribution.sessions) {
      const key = sessionKey(slice.source, slice.sessionId);
      const existing = this.sessions.get(key);
      if (!existing) {
        this.sessions.set(key, {
          source: slice.source,
          sessionId: slice.sessionId,
          project: slice.project,
          startedAtMs: slice.startedAtMs,
          endedAtMs: slice.endedAtMs,
          responses: slice.responses,
          tokens: slice.tokens,
          modelTokens: new Map(slice.modelTokens.map((entry) => [entry.model, entry.tokens])),
          requests: slice.requests === null ? null : [...slice.requests],
          droppedRequests: slice.droppedRequests,
        });
        continue;
      }

      existing.project ??= slice.project;
      existing.startedAtMs = Math.min(existing.startedAtMs, slice.startedAtMs);
      existing.endedAtMs = Math.max(existing.endedAtMs, slice.endedAtMs);
      existing.responses += slice.responses;
      existing.tokens += slice.tokens;
      for (const entry of slice.modelTokens) {
        existing.modelTokens.set(
          entry.model,
          (existing.modelTokens.get(entry.model) ?? 0) + entry.tokens,
        );
      }
      existing.droppedRequests += slice.droppedRequests;
      if (existing.requests === null || slice.requests === null) {
        existing.requests = null;
        continue;
      }
      for (const request of slice.requests) {
        if (existing.requests.length >= MAX_SESSION_REQUESTS) {
          existing.requests.shift();
          existing.droppedRequests += 1;
        }
        existing.requests.push(request);
      }
    }
  }

  /** Release the request logs of sessions that last ran before `idleCutoffMs`. */
  releaseIdleRequestLogs(idleCutoffMs: number): void {
    for (const session of this.sessions.values()) {
      if (session.requests !== null && session.endedAtMs < idleCutoffMs) {
        session.droppedRequests += session.requests.length;
        session.requests = null;
      }
    }
  }

  /** Keep request logs for at most the `limit` most recently active sessions. */
  capTrackedSessions(limit: number): void {
    const tracked = [...this.sessions.values()]
      .filter((session) => session.requests !== null)
      .toSorted((left, right) => right.endedAtMs - left.endedAtMs);
    for (const session of tracked.slice(limit)) {
      session.droppedRequests += session.requests?.length ?? 0;
      session.requests = null;
    }
  }

  /** Release whatever is no longer worth holding for a long-lived process. */
  prune(input: { readonly nowMs: number }): void {
    this.releaseIdleRequestLogs(input.nowMs - SESSION_REQUEST_TTL_MS);
    this.capTrackedSessions(MAX_TRACKED_SESSIONS);
  }

  /** Freeze into a structure that can be cached per file and merged again later. */
  toContribution(): UsageContribution {
    return {
      days: [...this.dayModels.values()],
      sessions: [...this.sessions.values()].map((session) => ({
        source: session.source,
        sessionId: session.sessionId,
        project: session.project,
        startedAtMs: session.startedAtMs,
        endedAtMs: session.endedAtMs,
        responses: session.responses,
        tokens: session.tokens,
        modelTokens: [...session.modelTokens.entries()]
          .map(([model, tokens]) => ({ model, tokens }))
          .toSorted(
            (left, right) => right.tokens - left.tokens || (left.model < right.model ? -1 : 1),
          ),
        requests: session.requests === null ? null : [...session.requests],
        droppedRequests: session.droppedRequests,
      })),
    };
  }

  dayRows(): ReadonlyArray<UsageDayModelRow> {
    return [...this.dayModels.values()];
  }

  sessionSlices(): ReadonlyArray<UsageSessionSlice> {
    return this.toContribution().sessions;
  }
}

/**
 * Fold one file's events into a cacheable contribution without touching shared
 * state. Only the recency cap applies here: whether a session is idle is a
 * whole-machine question the caller answers once, not per file.
 */
export function contributionFromEvents(
  events: ReadonlyArray<UsageEvent>,
  options?: { readonly fallbackSessionId?: string | null },
): UsageContribution {
  const accumulator = new UsageAccumulator();
  for (const event of events) {
    accumulator.add(event, options);
  }
  accumulator.capTrackedSessions(MAX_TRACKED_SESSIONS);
  return accumulator.toContribution();
}
