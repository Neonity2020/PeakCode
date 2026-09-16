// FILE: activityRows.ts
// Purpose: Collapse transcript work entries into the compact per-step activity
//          rows the transcript renders (one row per thinking run, per read run,
//          per command) so the stream reads as a step log instead of one line
//          per provider event.
// Layer: Web chat presentation helpers
// Exports: deriveActivityRows, classifyWorkEntry, activity row types

import type { WorkLogEntry } from "../../session-logic";

export type ActivityRowKind = "thinking" | "read" | "command" | "other";

export interface ActivityReadCounts {
  /** Searches (grep/glob/web search) inside one read run. */
  readonly searchCount: number;
  /** File reads inside one read run. */
  readonly fileCount: number;
}

export type ActivityRow =
  | {
      readonly kind: "thinking";
      readonly id: string;
      readonly createdAt: string;
      /** Thinking time, or null when nothing follows the run to measure against. */
      readonly durationMs: number | null;
      readonly entries: ReadonlyArray<WorkLogEntry>;
    }
  | {
      readonly kind: "read";
      readonly id: string;
      readonly createdAt: string;
      readonly counts: ActivityReadCounts;
      readonly entries: ReadonlyArray<WorkLogEntry>;
    }
  | {
      readonly kind: "command";
      readonly id: string;
      readonly createdAt: string;
      /** Shell command as shown in the row. */
      readonly command: string;
      /** Full command including any shell wrapper, revealed on hover. */
      readonly rawCommand: string;
      readonly entries: ReadonlyArray<WorkLogEntry>;
    }
  | {
      readonly kind: "other";
      readonly id: string;
      readonly createdAt: string;
      readonly entries: ReadonlyArray<WorkLogEntry>;
    };

const SEARCH_TOOL_PATTERN = /(search|grep|glob|find)/i;

/** Item types that keep their own richer row instead of collapsing into a step. */
const DEDICATED_ROW_ITEM_TYPES: ReadonlySet<string> = new Set([
  "file_change",
  "mcp_tool_call",
  "dynamic_tool_call",
  "collab_agent_tool_call",
  "image_view",
  "image_generation",
]);

function isCommandWorkEntry(entry: WorkLogEntry): boolean {
  return (
    entry.itemType === "command_execution" ||
    entry.requestKind === "command" ||
    Boolean(entry.command ?? entry.rawCommand)
  );
}

function isSearchWorkEntry(entry: WorkLogEntry): boolean {
  if (entry.itemType === "web_search") return true;
  return SEARCH_TOOL_PATTERN.test(entry.toolName ?? "");
}

function isReadWorkEntry(entry: WorkLogEntry): boolean {
  if (entry.requestKind === "file-read") return true;
  return entry.itemType === "web_search";
}

/**
 * Which activity class an entry belongs to. Commands win over reads so a shell
 * call that touches files still reads as a terminal step, and MCP / dynamic /
 * agent tool calls keep their own row rather than folding into a read count.
 */
export function classifyWorkEntry(entry: WorkLogEntry): ActivityRowKind {
  if (entry.tone === "thinking") return "thinking";
  if (isCommandWorkEntry(entry)) return "command";
  if (entry.itemType && DEDICATED_ROW_ITEM_TYPES.has(entry.itemType)) return "other";
  if (isReadWorkEntry(entry)) return "read";
  return "other";
}

function readCountsOf(entries: ReadonlyArray<WorkLogEntry>): ActivityReadCounts {
  let searchCount = 0;
  let fileCount = 0;
  for (const entry of entries) {
    if (isSearchWorkEntry(entry)) {
      searchCount += 1;
    } else {
      fileCount += 1;
    }
  }
  // A read run is only classified as such when some signal matched; keep the
  // counts honest instead of reporting "0 搜索, 0 文件".
  if (searchCount === 0 && fileCount === 0) {
    return { searchCount: 0, fileCount: entries.length };
  }
  return { searchCount, fileCount };
}

function commandTextOf(row: ReadonlyArray<WorkLogEntry>): string | null {
  for (const entry of row) {
    const command = entry.command ?? entry.rawCommand;
    if (command && command.trim().length > 0) {
      return command.trim();
    }
  }
  return null;
}

/** The unwrapped shell invocation, used for the hover tooltip. */
function rawCommandTextOf(row: ReadonlyArray<WorkLogEntry>): string | null {
  for (const entry of row) {
    const command = entry.rawCommand ?? entry.command;
    if (command && command.trim().length > 0) {
      return command.trim();
    }
  }
  return null;
}

function durationBetween(startIso: string, endIso: string | null): number | null {
  if (!endIso) return null;
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return end - start;
}

/**
 * Groups consecutive entries into activity rows.
 *
 * Thinking and read runs collapse into a single row each (the reference stream
 * shows "思考 · 持续了 4 秒" and "查阅 · 2 搜索, 1 文件"); commands and everything
 * else keep one row per entry so each command stays readable. `endAt` bounds the
 * duration of a trailing thinking run — pass the following assistant message's
 * timestamp when the rows are attached to a reply.
 */
export function deriveActivityRows(
  entries: ReadonlyArray<WorkLogEntry>,
  options?: { readonly endAt?: string | null },
): ActivityRow[] {
  const rows: ActivityRow[] = [];
  let currentKind: ActivityRowKind | null = null;
  let currentEntries: WorkLogEntry[] = [];
  // A thinking row is emitted once the next step (or the batch end) is known,
  // because that timestamp is what its duration is measured against.
  let pendingThinking: WorkLogEntry[] | null = null;

  const emitThinking = (endIso: string | null) => {
    if (!pendingThinking) return;
    const first = pendingThinking[0]!;
    rows.push({
      kind: "thinking",
      id: first.id,
      createdAt: first.createdAt,
      durationMs: durationBetween(first.createdAt, endIso),
      entries: pendingThinking,
    });
    pendingThinking = null;
  };

  const flush = () => {
    const first = currentEntries[0];
    if (!first || currentKind === null) {
      currentEntries = [];
      currentKind = null;
      return;
    }
    if (currentKind === "thinking") {
      emitThinking(first.createdAt);
      pendingThinking = currentEntries;
    } else if (currentKind === "read") {
      emitThinking(first.createdAt);
      rows.push({
        kind: "read",
        id: first.id,
        createdAt: first.createdAt,
        counts: readCountsOf(currentEntries),
        entries: currentEntries,
      });
    } else if (currentKind === "command") {
      emitThinking(first.createdAt);
      const command = commandTextOf(currentEntries) ?? first.label;
      rows.push({
        kind: "command",
        id: first.id,
        createdAt: first.createdAt,
        command,
        rawCommand: rawCommandTextOf(currentEntries) ?? command,
        entries: currentEntries,
      });
    } else {
      emitThinking(first.createdAt);
      rows.push({
        kind: "other",
        id: first.id,
        createdAt: first.createdAt,
        entries: currentEntries,
      });
    }
    currentEntries = [];
    currentKind = null;
  };

  for (const entry of entries) {
    const kind = classifyWorkEntry(entry);
    // Only thinking and read runs merge; commands and fallback rows stay 1:1.
    const merges = kind === "thinking" || kind === "read";
    if (currentKind !== null && (!merges || kind !== currentKind)) {
      flush();
    }
    currentKind = kind;
    currentEntries.push(entry);
    if (!merges) {
      flush();
    }
  }
  flush();
  emitThinking(options?.endAt ?? null);

  return rows;
}
