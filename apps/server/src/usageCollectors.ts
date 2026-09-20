// FILE: usageCollectors.ts
// Purpose: Read every local coding agent's own session records and normalize them
// into one token-event stream, so Settings → 使用统计 can report what the whole
// machine spent instead of only what this app spent.
//
// Each tool keeps its own format and its own idea of what "input tokens" means, so
// every parser here does the same two jobs: pull (timestamp, model, session, tokens)
// out of one record, and convert that tool's convention into ours —
// `inputTokens` **excludes** cache reads, `cacheReadTokens`/`cacheWriteTokens` are
// counted separately, and `totalTokens` is their sum plus output. Anthropic-style
// logs already report it that way; OpenAI-style logs roll the cache into `input`,
// so those subtract it out.

import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { execFile as execFileCallback } from "node:child_process";
import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import nodePath from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";

import {
  contributionFromEvents,
  localDateKey,
  type UsageAccumulator,
  type UsageContribution,
} from "./usageAggregate.ts";

const execFile = promisify(execFileCallback);

/** How far back records are read. The heatmap shows a year, so the window covers it. */
export const USAGE_WINDOW_DAYS = 400;
/** A single session file larger than this is skipped rather than read into memory. */
const MAX_SESSION_FILE_BYTES = 128 * 1024 * 1024;
const MAX_ARCHIVE_DEPTH = 6;
const MAX_ARCHIVE_FILES = 20_000;

export type UsageSourceId =
  | "peakcode"
  | "claude-code"
  | "codex"
  | "zcode"
  | "workbuddy"
  | "pi"
  | "opencode"
  | "ccmr"
  | "grok"
  | "dsh";

/** One model response, normalized across every tool. */
export interface UsageEvent {
  readonly timestampMs: number;
  readonly source: UsageSourceId;
  readonly model: string;
  readonly sessionId: string | null;
  /** Workspace the session ran in, as a bare directory name. */
  readonly project: string | null;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly reasoningTokens: number;
  readonly totalTokens: number;
}

export interface UsageSourceDescriptor {
  readonly id: UsageSourceId;
  readonly label: string;
  /** Where the tool keeps its records; the UI names these when nothing was found. */
  readonly roots: ReadonlyArray<string>;
}

interface JsonlSourceDescriptor extends UsageSourceDescriptor {
  readonly kind: "jsonl";
  /** Parser for one file of this tool's transcript. */
  readonly parse: (contents: string) => ReadonlyArray<UsageEvent>;
  /** Snapshots arrive compressed; the file is piped through this binary first. */
  readonly decompress?: "zstd";
  /**
   * Pi is what this app runs, so its transcripts are split between "PeakCode" (the
   * sessions this app spawned) and "Pi" (everything else). Set on the Pi source.
   */
  readonly attributeToApp?: boolean;
  /** Reads the workspace a transcript belongs to, for that split. */
  readonly readWorkspace?: (contents: string) => string | null;
}

interface SqliteSourceDescriptor extends UsageSourceDescriptor {
  readonly kind: "sqlite";
  readonly read: (input: {
    readonly databasePath: string;
    readonly windowStartMs: number;
  }) => ReadonlyArray<UsageEvent>;
}

type SourceDescriptor = JsonlSourceDescriptor | SqliteSourceDescriptor;

function homePath(...segments: ReadonlyArray<string>): string {
  return nodePath.join(os.homedir(), ...segments);
}

function opencodeDatabasePaths(): ReadonlyArray<string> {
  const bases = [process.env.XDG_DATA_HOME, homePath(".local", "share"), process.env.LOCALAPPDATA];
  return [
    ...new Set(
      bases
        .filter((base): base is string => typeof base === "string" && base.trim().length > 0)
        .map((base) => nodePath.join(base, "opencode", "opencode.db")),
    ),
  ];
}

// ── record helpers ──────────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function parseTimestampMs(value: unknown): number | null {
  if (typeof value === "number") {
    // Seconds, milliseconds, or microseconds — whichever the tool happened to write.
    if (!Number.isFinite(value) || value <= 0) {
      return null;
    }
    if (value < 1e11) return Math.round(value * 1_000);
    if (value > 1e14) return Math.round(value / 1_000);
    return Math.round(value);
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function projectNameFromDirectory(directory: string | null): string | null {
  if (!directory) {
    return null;
  }
  const normalized = directory.replace(/[\\/]+$/u, "");
  const name = nodePath.basename(normalized);
  return name.length > 0 ? name : null;
}

/** Walk a JSONL text into records, skipping lines that are not complete JSON. */
function forEachRecord(contents: string, visit: (record: Record<string, unknown>) => void): void {
  for (const line of contents.split(/\r?\n/u)) {
    if (line.length === 0 || line.charCodeAt(0) !== 0x7b) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const record = asRecord(parsed);
    if (record) {
      visit(record);
    }
  }
}

/**
 * Build an event with both token conventions reconciled. `inputIncludesCache` is
 * how OpenAI-shaped logs report it: `input` counts cache reads already, and a naive
 * sum would bill those tokens twice.
 */
function makeEvent(input: {
  readonly timestampMs: number;
  readonly source: UsageSourceId;
  readonly model: string | null;
  readonly sessionId: string | null;
  readonly project: string | null;
  readonly inputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
  readonly inputIncludesCache: boolean;
}): UsageEvent | null {
  if (input.timestampMs <= 0) {
    return null;
  }

  const cacheReadTokens = Math.max(0, input.cacheReadTokens);
  const cacheWriteTokens = Math.max(0, input.cacheWriteTokens);
  const inputTokens = input.inputIncludesCache
    ? Math.max(0, input.inputTokens - Math.min(cacheReadTokens, input.inputTokens))
    : Math.max(0, input.inputTokens);
  const outputTokens = Math.max(0, input.outputTokens);
  const totalTokens = inputTokens + cacheReadTokens + cacheWriteTokens + outputTokens;
  if (totalTokens <= 0) {
    return null;
  }

  return {
    timestampMs: input.timestampMs,
    source: input.source,
    model: input.model ?? "unknown",
    sessionId: input.sessionId,
    project: input.project,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    reasoningTokens: Math.max(0, input.reasoningTokens),
    totalTokens,
  };
}

// ── Claude Code / ccmr ──────────────────────────────────────────────────────

/**
 * Claude Code writes one line per assistant content block, so a message with tool
 * calls appears several times; only the final line of the group carries the real
 * `output_tokens`. Records are therefore merged by message id, keeping the largest
 * output seen — without that, most output tokens are lost.
 */
export function parseClaudeTranscript(
  contents: string,
  source: UsageSourceId,
): ReadonlyArray<UsageEvent> {
  const events = new Map<string, UsageEvent>();
  let index = 0;

  forEachRecord(contents, (record) => {
    if (asString(record.type) !== "assistant") {
      return;
    }
    const message = asRecord(record.message);
    const usage = asRecord(message?.usage);
    if (!message || !usage) {
      return;
    }

    const model = asString(message.model);
    if (model === "<synthetic>") {
      return;
    }

    const projectDirectory = asString(record.cwd);
    const event = makeEvent({
      timestampMs: parseTimestampMs(record.timestamp) ?? 0,
      source,
      model,
      sessionId: asString(record.sessionId) ?? asString(record.session_id),
      project: projectNameFromDirectory(projectDirectory),
      inputTokens: asNumber(usage.input_tokens),
      cacheReadTokens: asNumber(usage.cache_read_input_tokens),
      cacheWriteTokens: asNumber(usage.cache_creation_input_tokens),
      outputTokens: asNumber(usage.output_tokens),
      reasoningTokens: asNumber(asRecord(usage.output_tokens_details)?.thinking_tokens),
      inputIncludesCache: false,
    });
    if (!event) {
      return;
    }

    const key = asString(message.id) ?? asString(record.requestId) ?? `line-${index}`;
    index += 1;
    const existing = events.get(key);
    if (!existing || event.outputTokens > existing.outputTokens) {
      events.set(key, event);
    }
  });

  return [...events.values()];
}

// ── Codex ───────────────────────────────────────────────────────────────────

/**
 * Codex rollouts carry either `token_usage_record` (exact per-turn usage) or
 * `event_msg`/`token_count` (a **cumulative** session counter). Per-turn records
 * win when present; otherwise the cumulative counter is differenced, which is what
 * keeps a resumed session from being counted twice.
 */
export function parseCodexRollout(contents: string): ReadonlyArray<UsageEvent> {
  const perTurn: UsageEvent[] = [];
  const cumulative: UsageEvent[] = [];
  let previous = { input: 0, cached: 0, cacheWrite: 0, output: 0, reasoning: 0 };
  let model: string | null = null;
  let project: string | null = null;
  let sessionId: string | null = null;

  forEachRecord(contents, (record) => {
    const payload = asRecord(record.payload) ?? {};
    const recordType = asString(record.type);
    const payloadType = asString(payload.type);

    if (recordType === "session_meta" || payloadType === "session_meta") {
      sessionId = asString(payload.session_id) ?? asString(payload.id) ?? sessionId;
      project = projectNameFromDirectory(asString(payload.cwd)) ?? project;
      return;
    }
    if (recordType === "turn_context") {
      model = asString(payload.model) ?? model;
      return;
    }
    if (payloadType === "thread_settings_applied") {
      model = asString(asRecord(payload.thread_settings)?.model) ?? model;
      return;
    }

    if (recordType === "token_usage_record") {
      const usage = asRecord(payload.usage);
      if (!usage) {
        return;
      }
      const event = makeEvent({
        timestampMs: parseTimestampMs(record.timestamp) ?? 0,
        source: "codex",
        model,
        sessionId: asString(payload.session_id) ?? sessionId,
        project,
        inputTokens: asNumber(usage.input_tokens),
        cacheReadTokens: asNumber(usage.cached_input_tokens),
        cacheWriteTokens: asNumber(usage.cache_write_input_tokens),
        outputTokens: asNumber(usage.output_tokens),
        reasoningTokens: asNumber(usage.reasoning_output_tokens),
        inputIncludesCache: true,
      });
      if (event) {
        perTurn.push(event);
      }
      return;
    }

    if (payloadType !== "token_count") {
      return;
    }
    const total = asRecord(asRecord(payload.info)?.total_token_usage);
    if (!total) {
      return;
    }

    const current = {
      input: asNumber(total.input_tokens),
      cached: asNumber(total.cached_input_tokens),
      cacheWrite: asNumber(total.cache_write_input_tokens),
      output: asNumber(total.output_tokens),
      reasoning: asNumber(total.reasoning_output_tokens),
    };
    const delta = {
      input: Math.max(0, current.input - previous.input),
      cached: Math.max(0, current.cached - previous.cached),
      cacheWrite: Math.max(0, current.cacheWrite - previous.cacheWrite),
      output: Math.max(0, current.output - previous.output),
      reasoning: Math.max(0, current.reasoning - previous.reasoning),
    };
    previous = current;

    const event = makeEvent({
      timestampMs: parseTimestampMs(record.timestamp) ?? 0,
      source: "codex",
      model,
      sessionId,
      project,
      inputTokens: delta.input,
      cacheReadTokens: delta.cached,
      cacheWriteTokens: delta.cacheWrite,
      outputTokens: delta.output,
      reasoningTokens: delta.reasoning,
      inputIncludesCache: true,
    });
    if (event) {
      cumulative.push(event);
    }
  });

  return perTurn.length > 0 ? perTurn : cumulative;
}

// ── Pi ──────────────────────────────────────────────────────────────────────

/** Pi JSONL: a `session` header plus one `message` record per turn. */
export function parsePiTranscript(contents: string): ReadonlyArray<UsageEvent> {
  const events: UsageEvent[] = [];
  let project: string | null = null;
  let sessionId: string | null = null;
  let currentModel: string | null = null;

  forEachRecord(contents, (record) => {
    const recordType = asString(record.type);

    if (recordType === "session") {
      sessionId ??= asString(record.id);
      project ??= projectNameFromDirectory(asString(record.cwd));
      return;
    }
    if (recordType === "model_change") {
      currentModel = asString(record.modelId) ?? currentModel;
      return;
    }
    if (recordType !== "message") {
      return;
    }

    const message = asRecord(record.message);
    const usage = asRecord(message?.usage);
    if (!message || message.role !== "assistant" || !usage) {
      return;
    }

    const event = makeEvent({
      timestampMs: parseTimestampMs(record.timestamp) ?? parseTimestampMs(message.timestamp) ?? 0,
      source: "pi",
      model: asString(message.model) ?? currentModel,
      sessionId,
      project,
      inputTokens: asNumber(usage.input ?? usage.inputTokens),
      cacheReadTokens: asNumber(usage.cacheRead ?? usage.cache_read),
      cacheWriteTokens: asNumber(usage.cacheWrite ?? usage.cache_write),
      outputTokens: asNumber(usage.output ?? usage.outputTokens),
      reasoningTokens: asNumber(usage.reasoning),
      inputIncludesCache: false,
    });
    if (event) {
      events.push(event);
    }
  });

  return events;
}

/**
 * The workspace a Pi transcript was recorded in. Only the first line is read —
 * the `session` header carries `cwd` — so deciding ownership of a file is cheap.
 */
export function readPiTranscriptWorkspace(contents: string): string | null {
  const newline = contents.indexOf("\n");
  const firstLine = newline === -1 ? contents : contents.slice(0, newline);
  if (!firstLine.trimStart().startsWith("{")) {
    return null;
  }
  try {
    const record = asRecord(JSON.parse(firstLine));
    return record && asString(record.type) === "session" ? asString(record.cwd) : null;
  } catch {
    return null;
  }
}

// ── WorkBuddy ───────────────────────────────────────────────────────────────

/**
 * WorkBuddy attaches usage to whichever record carried the request — usually a
 * `function_call`, sometimes a `message` — and repeats the same `id` nowhere, so
 * the record id is the dedup key.
 */
export function parseWorkBuddyTranscript(contents: string): ReadonlyArray<UsageEvent> {
  const events = new Map<string, UsageEvent>();

  forEachRecord(contents, (record) => {
    const message = asRecord(record.message);
    const usage = asRecord(message?.usage);
    if (!usage) {
      return;
    }

    const providerData = asRecord(record.providerData);
    const directory = asString(record.cwd);
    const event = makeEvent({
      timestampMs: parseTimestampMs(record.timestamp) ?? 0,
      source: "workbuddy",
      model: asString(providerData?.model ?? providerData?.requestModelId),
      sessionId: asString(record.sessionId) ?? asString(record.session_id),
      project: projectNameFromDirectory(directory),
      inputTokens: asNumber(usage.input_tokens),
      cacheReadTokens: asNumber(usage.cache_read_input_tokens),
      cacheWriteTokens: asNumber(usage.cache_creation_input_tokens),
      outputTokens: asNumber(usage.output_tokens),
      reasoningTokens: asNumber(usage.reasoning_tokens),
      inputIncludesCache: true,
    });
    if (!event) {
      return;
    }

    const key = asString(record.id) ?? `${event.timestampMs}-${events.size}`;
    if (!events.has(key)) {
      events.set(key, event);
    }
  });

  return [...events.values()];
}

// ── Grok Build ──────────────────────────────────────────────────────────────

/**
 * Grok writes one `updates.jsonl` per session; a completed turn reports its usage,
 * optionally split per model. `inputTokens` includes cached reads here.
 */
export function parseGrokTranscript(contents: string): ReadonlyArray<UsageEvent> {
  const events: UsageEvent[] = [];

  forEachRecord(contents, (record) => {
    const params = asRecord(record.params);
    const update = asRecord(params?.update);
    if (!params || !update || asString(update.sessionUpdate) !== "turn_completed") {
      return;
    }

    const usage = asRecord(update.usage);
    if (!usage) {
      return;
    }
    const timestampMs =
      parseTimestampMs(record.timestamp) ?? parseTimestampMs(update.timestamp) ?? 0;
    const sessionId = asString(params.sessionId);
    const modelUsage = asRecord(usage.modelUsage);
    const perModel = modelUsage
      ? Object.entries(modelUsage).map(([model, entry]) => ({
          model,
          usage: asRecord(entry) ?? {},
        }))
      : [{ model: "grok", usage }];

    for (const entry of perModel) {
      const event = makeEvent({
        timestampMs,
        source: "grok",
        model: entry.model,
        sessionId,
        project: null,
        inputTokens: asNumber(entry.usage.inputTokens ?? entry.usage.input_tokens),
        cacheReadTokens: asNumber(entry.usage.cachedReadTokens ?? entry.usage.cached_read_tokens),
        cacheWriteTokens: asNumber(
          entry.usage.cacheCreationTokens ?? entry.usage.cache_creation_tokens,
        ),
        outputTokens: asNumber(entry.usage.outputTokens ?? entry.usage.output_tokens),
        reasoningTokens: asNumber(entry.usage.reasoningTokens ?? entry.usage.reasoning_tokens),
        inputIncludesCache: true,
      });
      if (event) {
        events.push(event);
      }
    }
  });

  return events;
}

// ── DeepSeek Harness ────────────────────────────────────────────────────────

/** dsh snapshots are zstd-compressed JSONL; the decompressed text is parsed here. */
export function parseDshTranscript(contents: string): ReadonlyArray<UsageEvent> {
  const events: UsageEvent[] = [];
  let project: string | null = null;
  let model: string | null = null;

  forEachRecord(contents, (record) => {
    const recordType = asString(record.type);

    if (recordType === "session") {
      project = projectNameFromDirectory(asString(record.cwd)) ?? project;
      return;
    }
    if (recordType === "request/header") {
      const config = asRecord(asRecord(record.data)?.header);
      model = asString(asRecord(config?.config)?.model) ?? model;
      return;
    }

    const data = asRecord(record.data);
    const usage =
      recordType === "assistant/message"
        ? asRecord(data?.usage)
        : recordType === "assistant/chunk" && asString(asRecord(data?.chunk)?.type) === "usage"
          ? asRecord(asRecord(data?.chunk)?.usage)
          : null;
    if (!usage) {
      return;
    }

    const event = makeEvent({
      timestampMs: parseTimestampMs(record.time) ?? parseTimestampMs(record.timestamp) ?? 0,
      source: "dsh",
      model: asString(asRecord(asRecord(data?.message)?.source)?.model) ?? model,
      sessionId: asString(record.sessionId),
      project,
      inputTokens: asNumber(usage.inputTokens ?? usage.input_tokens),
      cacheReadTokens: asNumber(usage.cacheReadTokens ?? usage.cache_read_tokens),
      cacheWriteTokens: asNumber(usage.cacheWriteTokens ?? usage.cache_write_tokens),
      outputTokens: asNumber(usage.outputTokens ?? usage.output_tokens),
      reasoningTokens: asNumber(usage.reasoningTokens ?? usage.reasoning_tokens),
      inputIncludesCache: false,
    });
    if (event) {
      events.push(event);
    }
  });

  return events;
}

// ── SQLite sources ──────────────────────────────────────────────────────────

function openReadOnlyDatabase(databasePath: string): DatabaseSync | null {
  try {
    return new DatabaseSync(databasePath, { readOnly: true });
  } catch {
    return null;
  }
}

function queryRows(
  databasePath: string,
  run: (database: DatabaseSync) => ReadonlyArray<Record<string, unknown>>,
): ReadonlyArray<Record<string, unknown>> {
  const database = openReadOnlyDatabase(databasePath);
  if (!database) {
    return [];
  }
  try {
    return run(database);
  } catch {
    // A schema this version does not recognize is treated as "nothing to report".
    return [];
  } finally {
    database.close();
  }
}

/** ZCode keeps one `model_usage` row per request, with a namespace per session. */
export function readZcodeEvents(input: {
  readonly databasePath: string;
  readonly windowStartMs: number;
}): ReadonlyArray<UsageEvent> {
  const projects = new Map<string, string | null>();
  const rows = queryRows(input.databasePath, (database) => {
    const sessionRows = database
      .prepare("SELECT id, directory FROM session")
      .all() as ReadonlyArray<Record<string, unknown>>;
    for (const row of sessionRows) {
      const id = asString(row.id);
      if (id) {
        projects.set(id, projectNameFromDirectory(asString(row.directory)));
      }
    }

    return database
      .prepare(
        `SELECT id, session_id, model_id, started_at, input_tokens, output_tokens,
                reasoning_tokens, cache_creation_input_tokens, cache_read_input_tokens
         FROM model_usage
         WHERE started_at >= ?
         ORDER BY started_at ASC`,
      )
      .all(input.windowStartMs) as ReadonlyArray<Record<string, unknown>>;
  });

  const events: UsageEvent[] = [];
  for (const row of rows) {
    const sessionId = asString(row.session_id);
    const event = makeEvent({
      timestampMs: parseTimestampMs(row.started_at) ?? 0,
      source: "zcode",
      model: asString(row.model_id),
      sessionId,
      project: sessionId ? (projects.get(sessionId) ?? null) : null,
      inputTokens: asNumber(row.input_tokens),
      cacheReadTokens: asNumber(row.cache_read_input_tokens),
      cacheWriteTokens: asNumber(row.cache_creation_input_tokens),
      outputTokens: asNumber(row.output_tokens),
      reasoningTokens: asNumber(row.reasoning_tokens),
      inputIncludesCache: true,
    });
    if (event) {
      events.push(event);
    }
  }

  return events;
}

/** OpenCode stores each assistant message as JSON inside the `message` table. */
export function readOpencodeEvents(input: {
  readonly databasePath: string;
  readonly windowStartMs: number;
}): ReadonlyArray<UsageEvent> {
  const projects = new Map<string, string | null>();
  const rows = queryRows(input.databasePath, (database) => {
    const sessionRows = database
      .prepare("SELECT id, directory FROM session")
      .all() as ReadonlyArray<Record<string, unknown>>;
    for (const row of sessionRows) {
      const id = asString(row.id);
      if (id) {
        projects.set(id, projectNameFromDirectory(asString(row.directory)));
      }
    }

    return database
      .prepare(
        `SELECT id, session_id, time_created, data FROM message
         WHERE data LIKE '%"tokens"%' AND time_created >= ?
         ORDER BY time_created ASC`,
      )
      .all(input.windowStartMs) as ReadonlyArray<Record<string, unknown>>;
  });

  const events: UsageEvent[] = [];
  for (const row of rows) {
    const rawData = asString(row.data);
    if (!rawData) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawData);
    } catch {
      continue;
    }

    const data = asRecord(parsed);
    const tokens = asRecord(data?.tokens);
    if (!data || data.role !== "assistant" || !tokens) {
      continue;
    }

    const sessionId = asString(row.session_id);
    const cache = asRecord(tokens.cache);
    const event = makeEvent({
      timestampMs:
        parseTimestampMs(asRecord(data.time)?.created) ?? parseTimestampMs(row.time_created) ?? 0,
      source: "opencode",
      model: asString(data.modelID),
      sessionId,
      project: sessionId ? (projects.get(sessionId) ?? null) : null,
      inputTokens: asNumber(tokens.input),
      cacheReadTokens: asNumber(cache?.read),
      cacheWriteTokens: asNumber(cache?.write),
      outputTokens: asNumber(tokens.output),
      reasoningTokens: asNumber(tokens.reasoning),
      inputIncludesCache: false,
    });
    if (event) {
      events.push(event);
    }
  }

  return events;
}

// ── registry ────────────────────────────────────────────────────────────────

/**
 * Every tool this app can account for, in the order the UI lists them. `roots` is
 * what the panel names when a tool was never used, so it doubles as documentation
 * of where each tool keeps its records.
 */
export function describeUsageSources(): ReadonlyArray<SourceDescriptor> {
  const claudeRoots = [homePath(".claude", "projects")];
  const ccmrRoots = [homePath(".claude-gateway", "projects")];

  return [
    {
      // Not a tool of its own: this app's Pi sessions, split out so its own spend is
      // visible next to the other agents rather than buried inside Pi's total.
      id: "peakcode",
      label: "Peak Code",
      kind: "jsonl",
      roots: [nodePath.join(getAgentDir(), "sessions")],
      parse: parsePiTranscript,
    },
    {
      id: "claude-code",
      label: "Claude Code",
      kind: "jsonl",
      roots: claudeRoots,
      parse: (contents) => parseClaudeTranscript(contents, "claude-code"),
    },
    {
      id: "codex",
      label: "Codex",
      kind: "jsonl",
      roots: [homePath(".codex", "sessions"), homePath(".codex", "archived_sessions")],
      parse: parseCodexRollout,
    },
    {
      id: "zcode",
      label: "ZCode",
      kind: "sqlite",
      roots: [homePath(".zcode", "cli", "db", "db.sqlite")],
      read: readZcodeEvents,
    },
    {
      id: "workbuddy",
      label: "WorkBuddy",
      kind: "jsonl",
      roots: [homePath(".WorkBuddy", "projects")],
      parse: parseWorkBuddyTranscript,
    },
    {
      id: "pi",
      label: "Pi",
      kind: "jsonl",
      roots: [nodePath.join(getAgentDir(), "sessions")],
      parse: parsePiTranscript,
      attributeToApp: true,
      readWorkspace: readPiTranscriptWorkspace,
    },
    {
      id: "opencode",
      label: "OpenCode",
      kind: "sqlite",
      roots: opencodeDatabasePaths(),
      read: readOpencodeEvents,
    },
    {
      id: "ccmr",
      label: "ccmr",
      kind: "jsonl",
      roots: ccmrRoots,
      parse: (contents) => parseClaudeTranscript(contents, "ccmr"),
    },
    {
      id: "grok",
      label: "Grok Build",
      kind: "jsonl",
      roots: [homePath(".grok", "sessions")],
      parse: parseGrokTranscript,
    },
    {
      id: "dsh",
      label: "DeepSeek Harness",
      kind: "jsonl",
      roots: [homePath(".dsh", "sessions")],
      parse: parseDshTranscript,
      decompress: "zstd",
    },
  ];
}

/** Public view of the registry: id, label and roots, with the parsers stripped. */
export function usageSourceCatalog(): ReadonlyArray<UsageSourceDescriptor> {
  return describeUsageSources().map(({ id, label, roots }) => ({ id, label, roots }));
}

// ── file walking with a per-file cache ──────────────────────────────────────

export interface UsageFileCache {
  readonly files: Map<string, { size: number; mtimeMs: number; contribution: UsageContribution }>;
  readonly directories: Map<string, ReadonlyArray<string>>;
}

export function createUsageFileCache(): UsageFileCache {
  return { files: new Map(), directories: new Map() };
}

async function listFiles(input: {
  readonly directory: string;
  readonly depth: number;
  readonly extensions: ReadonlyArray<string>;
  readonly cache: UsageFileCache;
  readonly files: string[];
}): Promise<void> {
  const cached = input.cache.directories.get(input.directory);
  if (cached) {
    input.files.push(...cached);
    return;
  }

  let entries: ReadonlyArray<Dirent>;
  try {
    entries = await fs.readdir(input.directory, { withFileTypes: true });
  } catch {
    return;
  }

  const found: string[] = [];
  for (const entry of entries) {
    const entryPath = nodePath.join(input.directory, entry.name);
    if (entry.isFile()) {
      if (input.extensions.some((extension) => entry.name.endsWith(extension))) {
        found.push(entryPath);
      }
      continue;
    }
    if (entry.isDirectory() && input.depth < MAX_ARCHIVE_DEPTH) {
      await listFiles({
        directory: entryPath,
        depth: input.depth + 1,
        extensions: input.extensions,
        cache: input.cache,
        files: found,
      });
    }
  }

  // Cached so a refresh of an unchanged tree costs one readdir per directory, not a walk.
  input.cache.directories.set(input.directory, found);
  input.files.push(...found);
}

/** zstd lives outside the default PATH when the desktop app is launched from Finder. */
const ZSTD_CANDIDATES = ["zstd", "/opt/homebrew/bin/zstd", "/usr/local/bin/zstd", "/usr/bin/zstd"];

let zstdBinaryPromise: Promise<string | null> | null = null;

async function resolveZstdBinary(): Promise<string | null> {
  zstdBinaryPromise ??= (async () => {
    for (const candidate of ZSTD_CANDIDATES) {
      const resolved = candidate.includes("/") ? candidate : null;
      try {
        if (resolved) {
          await fs.access(resolved, fs.constants.X_OK);
          return resolved;
        }
        const which = await execFile("which", [candidate]);
        const found = which.stdout.trim();
        if (found.length > 0) {
          return found;
        }
      } catch {
        // Try the next candidate.
      }
    }
    return null;
  })();
  return zstdBinaryPromise;
}

async function decompressZstd(path: string): Promise<string | null> {
  const binary = await resolveZstdBinary();
  if (!binary) {
    return null;
  }
  try {
    const { stdout } = await execFile(binary, ["-dc", path], {
      maxBuffer: MAX_SESSION_FILE_BYTES,
    });
    return stdout;
  } catch {
    // A truncated or multi-frame snapshot this build cannot read contributes nothing.
    return null;
  }
}

async function readJsonlFile(input: {
  readonly path: string;
  readonly parse: (contents: string) => ReadonlyArray<UsageEvent>;
  readonly decompress?: "zstd" | undefined;
  readonly cache: UsageFileCache;
}): Promise<UsageContribution> {
  const empty: UsageContribution = { days: [], sessions: [] };
  let stats: { size: number; mtimeMs: number };
  try {
    const stat = await fs.stat(input.path);
    stats = { size: stat.size, mtimeMs: stat.mtimeMs };
  } catch {
    return empty;
  }
  if (stats.size > MAX_SESSION_FILE_BYTES) {
    return empty;
  }

  const cached = input.cache.files.get(input.path);
  if (cached && cached.size === stats.size && cached.mtimeMs === stats.mtimeMs) {
    return cached.contribution;
  }

  let contents: string | null;
  if (input.decompress === "zstd") {
    contents = await decompressZstd(input.path);
    if (contents === null) {
      return empty;
    }
  } else {
    try {
      contents = await fs.readFile(input.path, "utf8");
    } catch {
      return empty;
    }
  }

  const contribution = contributionFromEvents(input.parse(contents), {
    // A record that never named its session still belongs to this transcript.
    fallbackSessionId: nodePath.basename(input.path, nodePath.extname(input.path)),
  });
  input.cache.files.set(input.path, { ...stats, contribution });
  return contribution;
}

async function mapWithConcurrency<T, R>(
  items: ReadonlyArray<T>,
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<ReadonlyArray<R>> {
  const results: R[] = [];
  let nextIndex = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      const item = items[index];
      if (item === undefined) {
        continue;
      }
      results[index] = await run(item);
    }
  });

  await Promise.all(workers);
  return results;
}

/** The app's own footprint, needed to tell its Pi sessions from the rest. */
export interface AppUsageScope {
  /** Absolute project roots; a Pi transcript recorded in one of them is this app's. */
  readonly projectRoots: ReadonlyArray<string>;
  /** Managed worktrees directory; anything under it is this app's. */
  readonly worktreesRoot?: string | null | undefined;
  /** Transcript paths this app spawned, from its recorded resume cursors. */
  readonly sessionFiles?: ReadonlySet<string> | undefined;
}

function normalizeDirectory(value: string): string {
  return value.replace(/[\\/]+$/u, "");
}

/**
 * Whether a Pi transcript belongs to this app: spawned by it, or run in its projects.
 * Exported for tests, which pin the two rules that keep the Peak Code row honest.
 */
export async function isAppHostedTranscriptForTest(input: {
  readonly path: string;
  readonly contents: string;
  readonly appScope: AppUsageScope;
}): Promise<boolean> {
  const workspace = readPiTranscriptWorkspace(input.contents);
  if (input.appScope.sessionFiles?.has(input.path)) {
    return true;
  }
  if (!workspace) {
    return false;
  }
  return matchesAppWorkspace({ workspace, appScope: input.appScope });
}

function matchesAppWorkspace(input: {
  readonly workspace: string;
  readonly appScope: AppUsageScope;
}): boolean {
  const normalized = normalizeDirectory(input.workspace);
  if (input.appScope.projectRoots.some((root) => normalizeDirectory(root) === normalized)) {
    return true;
  }
  const worktreesRoot = input.appScope.worktreesRoot?.trim()
    ? normalizeDirectory(input.appScope.worktreesRoot.trim())
    : "";
  return (
    worktreesRoot.length > 0 &&
    (normalized === worktreesRoot || normalized.startsWith(`${worktreesRoot}/`))
  );
}

async function isAppHostedTranscript(input: {
  readonly path: string;
  readonly source: JsonlSourceDescriptor;
  readonly cache: UsageFileCache;
  readonly appScope: AppUsageScope | undefined;
}): Promise<boolean> {
  const scope = input.appScope;
  if (!scope) {
    return false;
  }
  if (scope.sessionFiles?.has(input.path)) {
    return true;
  }

  let contents: string;
  try {
    contents = await fs.readFile(input.path, "utf8");
  } catch {
    return false;
  }
  const workspace = input.source.readWorkspace?.(contents) ?? null;
  return workspace ? matchesAppWorkspace({ workspace, appScope: scope }) : false;
}

/** Re-stamp a folded contribution with the source it is really attributed to. */
function retagContribution(
  contribution: UsageContribution,
  source: UsageSourceId,
): UsageContribution {
  return {
    days: contribution.days.map((row) => (row.source === source ? row : { ...row, source })),
    sessions: contribution.sessions.map((session) =>
      session.source === source ? session : { ...session, source },
    ),
  };
}

export interface CollectUsageResult {
  /** Sources whose records were found, so the UI can tell "unused" from "not installed". */
  readonly activeSources: ReadonlySet<UsageSourceId>;
}

/**
 * Read every tool's records inside the window and fold them into `accumulator`.
 * Unchanged files come back from the cache as their folded contribution, so a
 * refresh only pays for what actually changed.
 */
export async function collectUsageInto(input: {
  readonly accumulator: UsageAccumulator;
  readonly nowMs: number;
  readonly cache: UsageFileCache;
  readonly windowDays?: number;
  /** What "this app's own work" means: its projects, its worktrees, its sessions. */
  readonly appScope?: AppUsageScope | undefined;
}): Promise<CollectUsageResult> {
  const windowStartMs =
    input.nowMs - (input.windowDays ?? USAGE_WINDOW_DAYS) * 24 * 60 * 60 * 1_000;
  const windowStartDateKey = localDateKey(windowStartMs);
  const activeSources = new Set<UsageSourceId>();
  // Transcripts the Pi pass recognized as this app's own, merged under "peakcode".
  const appContributions: UsageContribution[] = [];

  for (const source of describeUsageSources()) {
    // Peak Code's numbers come from the Pi pass below, which knows which transcripts
    // this app ran. Reading the same archive twice would only double-count.
    if (source.id === "peakcode") {
      continue;
    }
    const contributions: UsageContribution[] = [];

    if (source.kind === "sqlite") {
      for (const databasePath of source.roots) {
        const events = source.read({ databasePath, windowStartMs });
        if (events.length === 0) {
          continue;
        }
        contributions.push(contributionFromEvents(events));
      }
    } else {
      const candidates: string[] = [];
      for (const root of source.roots) {
        await listFiles({
          directory: root,
          depth: 0,
          extensions: source.decompress === "zstd" ? [".zst", ".zstd"] : [".jsonl"],
          cache: input.cache,
          files: candidates,
        });
      }

      const usable: string[] = [];
      for (const candidate of candidates.slice(0, MAX_ARCHIVE_FILES)) {
        const cached = input.cache.files.get(candidate);
        if (cached) {
          if (cached.mtimeMs >= windowStartMs) {
            usable.push(candidate);
          }
          continue;
        }
        try {
          const stat = await fs.stat(candidate);
          // A file untouched for longer than the window cannot hold a record inside it.
          if (stat.mtimeMs >= windowStartMs) {
            usable.push(candidate);
          }
        } catch {
          // Vanished between listing and stat.
        }
      }

      const perFile = await mapWithConcurrency(usable, 8, async (path) => {
        const contribution = await readJsonlFile({
          path,
          parse: source.parse,
          decompress: source.decompress,
          cache: input.cache,
        });
        const hostedByApp = source.attributeToApp
          ? await isAppHostedTranscript({
              path,
              source,
              cache: input.cache,
              appScope: input.appScope,
            })
          : false;
        return { contribution, hostedByApp };
      });
      for (const entry of perFile) {
        if (entry.hostedByApp) {
          appContributions.push(entry.contribution);
        } else {
          contributions.push(entry.contribution);
        }
      }
    }

    let sawRecord = false;
    for (const contribution of contributions) {
      // The window is applied to the folded rows, so a cached old file contributes nothing.
      const days = contribution.days.filter((row) => row.date >= windowStartDateKey);
      if (days.length === 0 && contribution.sessions.length === 0) {
        continue;
      }
      sawRecord = sawRecord || days.length > 0;
      input.accumulator.merge({ days, sessions: contribution.sessions });
    }
    if (sawRecord) {
      activeSources.add(source.id);
    }
  }

  let sawAppRecord = false;
  for (const contribution of appContributions) {
    const days = contribution.days.filter((row) => row.date >= windowStartDateKey);
    if (days.length === 0 && contribution.sessions.length === 0) {
      continue;
    }
    sawAppRecord = sawAppRecord || days.length > 0;
    input.accumulator.merge(
      retagContribution({ days, sessions: contribution.sessions }, "peakcode"),
    );
  }
  if (sawAppRecord) {
    activeSources.add("peakcode");
  }

  return { activeSources };
}
