// FILE: activityRows.test.ts
// Purpose: Covers how raw work entries collapse into the transcript's step rows.
// Layer: Web chat presentation helper tests

import { describe, expect, it } from "vitest";

import type { WorkLogEntry } from "../../session-logic";
import { classifyWorkEntry, deriveActivityRows } from "./activityRows";

const BASE = Date.parse("2026-09-16T04:36:00.000Z");

const at = (seconds: number) => new Date(BASE + seconds * 1000).toISOString();

const entry = (
  id: string,
  createdAt: string,
  overrides: Partial<WorkLogEntry> = {},
): WorkLogEntry => ({
  id,
  createdAt,
  label: "Tool",
  tone: "tool",
  ...overrides,
});

const thinking = (id: string, seconds: number) =>
  entry(id, at(seconds), { label: "Thinking", tone: "thinking" });

const readFile = (id: string, seconds: number) =>
  entry(id, at(seconds), { label: "Read file", requestKind: "file-read", toolName: "read_file" });

const search = (id: string, seconds: number) =>
  entry(id, at(seconds), { label: "Search", requestKind: "file-read", toolName: "grep" });

const command = (id: string, seconds: number, raw: string) =>
  entry(id, at(seconds), {
    label: "Ran command",
    itemType: "command_execution",
    command: raw,
    rawCommand: `/bin/zsh -lc '${raw}'`,
  });

describe("classifyWorkEntry", () => {
  it("classifies thinking, reads, commands and everything else", () => {
    expect(classifyWorkEntry(thinking("t", 0))).toBe("thinking");
    expect(classifyWorkEntry(readFile("r", 0))).toBe("read");
    expect(classifyWorkEntry(search("s", 0))).toBe("read");
    expect(classifyWorkEntry(entry("w", at(0), { itemType: "web_search" }))).toBe("read");
    expect(classifyWorkEntry(command("c", 0, "ls"))).toBe("command");
    expect(classifyWorkEntry(entry("o", at(0), { label: "MCP call" }))).toBe("other");
  });

  it("keeps a shell call that touches files classified as a command", () => {
    const shellRead = entry("c", at(0), {
      itemType: "command_execution",
      requestKind: "file-read",
      command: "cat foo.ts",
    });

    expect(classifyWorkEntry(shellRead)).toBe("command");
  });

  it("keeps MCP, dynamic and agent tool calls on their own rows", () => {
    expect(
      classifyWorkEntry(
        entry("m", at(0), {
          itemType: "mcp_tool_call",
          toolName: "mcp__codex_apps__slack__search",
        }),
      ),
    ).toBe("other");
    expect(classifyWorkEntry(entry("d", at(0), { itemType: "dynamic_tool_call" }))).toBe("other");
    expect(classifyWorkEntry(entry("a", at(0), { itemType: "collab_agent_tool_call" }))).toBe(
      "other",
    );
    expect(classifyWorkEntry(entry("f", at(0), { itemType: "file_change" }))).toBe("other");
  });
});

describe("deriveActivityRows", () => {
  it("merges a thinking run and measures it against the next step", () => {
    const rows = deriveActivityRows([
      thinking("think-1", 0),
      thinking("think-2", 2),
      search("s", 4),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ kind: "thinking", id: "think-1", durationMs: 4_000 });
    expect(rows[1]).toMatchObject({ kind: "read", counts: { searchCount: 1, fileCount: 0 } });
  });

  it("uses the following message timestamp for a trailing thinking run", () => {
    const rows = deriveActivityRows([thinking("think-1", 0)], { endAt: at(3) });

    expect(rows[0]).toMatchObject({ kind: "thinking", durationMs: 3_000 });
  });

  it("leaves the duration unknown when nothing follows the thinking run", () => {
    const rows = deriveActivityRows([thinking("think-1", 0)]);

    expect(rows[0]).toMatchObject({ kind: "thinking", durationMs: null });
  });

  it("counts searches and file reads inside one read run", () => {
    const rows = deriveActivityRows([
      search("s-1", 0),
      search("s-2", 1),
      readFile("r-1", 2),
      readFile("r-2", 3),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "read", counts: { searchCount: 2, fileCount: 2 } });
    expect(rows[0]?.entries.map((row) => row.id)).toEqual(["s-1", "s-2", "r-1", "r-2"]);
  });

  it("splits read runs that are separated by a command", () => {
    const rows = deriveActivityRows([
      readFile("r-1", 0),
      command("c-1", 1, "bun run test"),
      readFile("r-2", 2),
    ]);

    expect(rows.map((row) => row.kind)).toEqual(["read", "command", "read"]);
  });

  it("keeps one row per command and exposes the raw command for hover", () => {
    const rows = deriveActivityRows([
      command("c-1", 0, "bun fmt:check"),
      command("c-2", 1, "bun typecheck"),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      kind: "command",
      command: "bun fmt:check",
      rawCommand: "/bin/zsh -lc 'bun fmt:check'",
    });
    expect(rows[1]).toMatchObject({ kind: "command", command: "bun typecheck" });
  });

  it("keeps the entry order for mixed thinking, read and command runs", () => {
    const rows = deriveActivityRows([
      thinking("think-1", 0),
      search("s-1", 1),
      readFile("r-1", 2),
      command("c-1", 3, "bun fmt:check"),
      thinking("think-2", 4),
    ]);

    expect(rows.map((row) => row.kind)).toEqual(["thinking", "read", "command", "thinking"]);
    expect(rows[0]).toMatchObject({ kind: "thinking", durationMs: 1_000 });
    expect(rows[3]).toMatchObject({ kind: "thinking", durationMs: null });
  });

  it("returns no rows for an empty entry list", () => {
    expect(deriveActivityRows([])).toEqual([]);
  });
});
