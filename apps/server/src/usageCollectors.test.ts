import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, test } from "vitest";

import {
  isAppHostedTranscriptForTest,
  parseClaudeTranscript,
  parseCodexRollout,
  parseDshTranscript,
  parseGrokTranscript,
  parsePiTranscript,
  parseWorkBuddyTranscript,
  readOpencodeEvents,
  readZcodeEvents,
} from "./usageCollectors";

/**
 * 本地多源用量采集。
 *
 * 三件事必须被钉住：
 * 1. **两种 token 口径不能混** —— Anthropic 系的 input 不含缓存，OpenAI 系的 input 含缓存，
 *    直接相加会把缓存读的 token 重复计一遍；
 * 2. **同一请求被写成多行时不能重复计** —— Claude Code 一个 assistant 消息可能按内容块写成
 *    多行、Codex 的 token_count 是累计值，都要还原成"每个请求一次"；
 * 3. **没有用量记录的文件不产生事件** —— 解析失败、字段缺失都不能退化成 0 token 事件。

 * 夹具里的字段名与字段结构都取自各工具真实写出的记录（本机 6 个工具的实际样本），
 * 不是臆造的格式。
 */

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(nodePath.join(tmpdir(), "peakcode-usage-"));
  tempDirs.push(dir);
  return dir;
}

/** One assistant line whose content-block group shares a message id. */
function claudeBlockLine(outputTokens: number): string {
  return JSON.stringify({
    type: "assistant",
    sessionId: "s-1",
    timestamp: "2026-09-10T02:01:09.914Z",
    message: {
      id: "msg_shared",
      model: "claude-sonnet-4-6",
      usage: { input_tokens: 100, output_tokens: outputTokens },
    },
  });
}

/** Codex's cumulative token snapshot, which the parser turns back into per-turn deltas. */
function codexTokenCountLine(input: number, output: number, timestamp: string): string {
  return JSON.stringify({
    timestamp,
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        total_token_usage: {
          input_tokens: input,
          cached_input_tokens: 0,
          output_tokens: output,
          reasoning_output_tokens: 0,
        },
      },
    },
  });
}

/** WorkBuddy attaches usage to whichever record carried the request. */
function workBuddyRecord(id: string, inputTokens: number, outputTokens: number): string {
  return JSON.stringify({
    type: "function_call",
    id,
    sessionId: "wb-session",
    cwd: "/Users/a/WorkBuddy/2026-09-04-task",
    timestamp: 1_788_493_392_934,
    message: { usage: { input_tokens: inputTokens, output_tokens: outputTokens } },
    providerData: { model: "glm-5.3-flash", traceId: "trace-1" },
  });
}

/** A Pi transcript header, which is all the ownership decision needs to read. */
function piTranscriptIn(cwd: string): string {
  return JSON.stringify({
    type: "session",
    id: "pi-session",
    timestamp: "2026-09-18T05:49:34.134Z",
    cwd,
  });
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("parseClaudeTranscript", () => {
  test("keeps cache reads and writes out of the input count", () => {
    const transcript = [
      JSON.stringify({
        type: "assistant",
        sessionId: "s-1",
        cwd: "/Users/a/ai/OmniStudio",
        timestamp: "2026-09-10T02:01:09.914Z",
        message: {
          id: "msg_1",
          model: "claude-sonnet-4-6",
          usage: {
            input_tokens: 24_022,
            cache_creation_input_tokens: 500,
            cache_read_input_tokens: 1_000,
            output_tokens: 98,
          },
        },
      }),
    ].join("\n");

    const [event] = parseClaudeTranscript(transcript, "claude-code");

    expect(event).toMatchObject({
      source: "claude-code",
      model: "claude-sonnet-4-6",
      sessionId: "s-1",
      project: "OmniStudio",
      inputTokens: 24_022,
      cacheReadTokens: 1_000,
      cacheWriteTokens: 500,
      outputTokens: 98,
    });
    expect(event?.totalTokens).toBe(24_022 + 1_000 + 500 + 98);
  });

  test("collapses a message's content-block lines and keeps the biggest output", () => {
    const events = parseClaudeTranscript(
      [claudeBlockLine(0), claudeBlockLine(0), claudeBlockLine(412)].join("\n"),
      "claude-code",
    );

    // Only the final block carries the real output; counting each line would drop it.
    expect(events).toHaveLength(1);
    expect(events[0]?.outputTokens).toBe(412);
  });

  test("skips synthetic models and records without usage", () => {
    const transcript = [
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-09-10T02:01:09.914Z",
        message: { id: "m1", model: "<synthetic>", usage: { input_tokens: 5, output_tokens: 5 } },
      }),
      JSON.stringify({ type: "user", timestamp: "2026-09-10T02:01:09.914Z", message: {} }),
      "not json at all",
    ].join("\n");

    expect(parseClaudeTranscript(transcript, "claude-code")).toEqual([]);
  });

  test("tags ccmr records with the gateway's own source id", () => {
    const transcript = JSON.stringify({
      type: "assistant",
      timestamp: "2026-09-10T02:01:09.914Z",
      message: { id: "m1", model: "glm-5.3", usage: { input_tokens: 10, output_tokens: 2 } },
    });

    expect(parseClaudeTranscript(transcript, "ccmr")[0]?.source).toBe("ccmr");
  });
});

describe("parseCodexRollout", () => {
  const sessionMeta = JSON.stringify({
    timestamp: "2026-09-11T04:11:45.246Z",
    type: "session_meta",
    payload: { session_id: "01a08eaa", cwd: "/Users/a/ai/OmniStudio/apps/studio" },
  });
  const turnContext = JSON.stringify({
    timestamp: "2026-09-11T04:11:45.500Z",
    type: "turn_context",
    payload: { model: "deepseek-flash" },
  });

  test("prefers exact per-turn usage records", () => {
    const rollout = [
      sessionMeta,
      turnContext,
      JSON.stringify({
        timestamp: "2026-09-11T04:11:46.000Z",
        type: "token_usage_record",
        payload: {
          session_id: "01a08eaa",
          usage: {
            input_tokens: 4_809,
            cached_input_tokens: 800,
            output_tokens: 2,
            reasoning_output_tokens: 0,
          },
        },
      }),
    ].join("\n");

    const events = parseCodexRollout(rollout);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      source: "codex",
      model: "deepseek-flash",
      project: "studio",
      // Codex reports input inclusive of cache, so the cached part moves out of it.
      inputTokens: 4_009,
      cacheReadTokens: 800,
      outputTokens: 2,
    });
  });

  test("differences the cumulative counter when per-turn records are absent", () => {
    const events = parseCodexRollout(
      [
        sessionMeta,
        codexTokenCountLine(1_000, 100, "2026-09-11T04:11:46.000Z"),
        codexTokenCountLine(3_000, 250, "2026-09-11T04:12:46.000Z"),
      ].join("\n"),
    );

    // The first snapshot only establishes the baseline; summing the totals instead of
    // their deltas would count the same conversation again on every refresh.
    expect(events.map((event) => event.totalTokens)).toEqual([1_100, 2_150]);
    expect(events[1]).toMatchObject({ inputTokens: 2_000, outputTokens: 150 });
  });
});

describe("parsePiTranscript", () => {
  test("reads per-message usage and the session's workspace", () => {
    const transcript = [
      JSON.stringify({
        type: "session",
        id: "pi-session",
        timestamp: "2026-09-18T05:49:34.134Z",
        cwd: "/Users/a/.peakcode/workspace",
      }),
      JSON.stringify({
        type: "message",
        timestamp: "2026-09-18T05:50:00.000Z",
        message: {
          role: "assistant",
          model: "deepseek-v4.1",
          usage: { input: 3_666, output: 102, cacheRead: 4_000, cacheWrite: 0, reasoning: 40 },
        },
      }),
      JSON.stringify({
        type: "message",
        timestamp: "2026-09-18T05:50:01.000Z",
        message: { role: "user", content: "hi" },
      }),
    ].join("\n");

    const events = parsePiTranscript(transcript);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      source: "pi",
      model: "deepseek-v4.1",
      sessionId: "pi-session",
      project: "workspace",
      // reasoning is already inside output, so it must not be added again.
      totalTokens: 3_666 + 4_000 + 102,
    });
  });
});

describe("parseWorkBuddyTranscript", () => {
  test("reads usage off whichever record carried the request, once per id", () => {
    const events = parseWorkBuddyTranscript(
      [workBuddyRecord("a", 30_324, 188), workBuddyRecord("b", 100, 10)].join("\n"),
    );

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      source: "workbuddy",
      model: "glm-5.3-flash",
      project: "2026-09-04-task",
      // WorkBuddy also reports input inclusive of cache.
      inputTokens: 30_324,
      outputTokens: 188,
    });
    expect(events[0]?.timestampMs).toBe(1_788_493_392_934);
  });
});

describe("parseGrokTranscript", () => {
  test("splits a completed turn's usage per model", () => {
    const transcript = JSON.stringify({
      timestamp: 1_788_000_000,
      params: {
        sessionId: "grok-session",
        update: {
          sessionUpdate: "turn_completed",
          usage: {
            inputTokens: 1_000,
            cachedReadTokens: 400,
            outputTokens: 50,
            modelUsage: {
              "grok-4.6-build": { inputTokens: 1_000, cachedReadTokens: 400, outputTokens: 50 },
            },
          },
        },
      },
    });

    const events = parseGrokTranscript(transcript);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      source: "grok",
      model: "grok-4.6-build",
      sessionId: "grok-session",
      inputTokens: 600,
      cacheReadTokens: 400,
      outputTokens: 50,
    });
  });

  test("ignores updates that are not a completed turn", () => {
    const transcript = JSON.stringify({
      timestamp: 1_788_000_000,
      params: {
        sessionId: "s",
        update: { sessionUpdate: "tool_call", usage: { inputTokens: 10 } },
      },
    });

    expect(parseGrokTranscript(transcript)).toEqual([]);
  });
});

describe("parseDshTranscript", () => {
  test("reads the v3 assistant message usage", () => {
    const transcript = [
      JSON.stringify({ type: "session", cwd: "/Users/a/proj" }),
      JSON.stringify({
        type: "assistant/message",
        time: "2026-09-10T02:00:00.000Z",
        data: {
          message: { source: { model: "deepseek-v4-pro" } },
          usage: {
            inputTokens: 500,
            cacheReadTokens: 200,
            cacheWriteTokens: 0,
            outputTokens: 60,
            reasoningTokens: 10,
          },
        },
      }),
    ].join("\n");

    const events = parseDshTranscript(transcript);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      source: "dsh",
      model: "deepseek-v4-pro",
      project: "proj",
      inputTokens: 500,
      cacheReadTokens: 200,
      outputTokens: 60,
      totalTokens: 760,
    });
  });
});

describe("Peak Code attribution", () => {
  const scope = {
    projectRoots: ["/Users/tester/Git/PeakCode", "/Users/tester"],
    worktreesRoot: "/Users/tester/.peakcode/worktrees",
  };

  test("claims a transcript recorded in one of the app's projects", async () => {
    await expect(
      isAppHostedTranscriptForTest({
        path: "/Users/tester/.pi/agent/sessions/--Users-tester-Git-PeakCode--/a.jsonl",
        contents: piTranscriptIn("/Users/tester/Git/PeakCode"),
        appScope: scope,
      }),
    ).resolves.toBe(true);
  });

  test("claims a transcript that ran in a worktree the app manages", async () => {
    await expect(
      isAppHostedTranscriptForTest({
        path: "/Users/tester/.pi/agent/sessions/--Users-tester-.peakcode-worktrees-PeakCode-pr84--/a.jsonl",
        contents: piTranscriptIn("/Users/tester/.peakcode/worktrees/PeakCode/pr84"),
        appScope: scope,
      }),
    ).resolves.toBe(true);
  });

  test("claims a transcript the app spawned even if its project was deleted", async () => {
    await expect(
      isAppHostedTranscriptForTest({
        path: "/Users/tester/.pi/agent/sessions/--Users-tester-old--/a.jsonl",
        contents: piTranscriptIn("/Users/tester/old"),
        appScope: {
          ...scope,
          sessionFiles: new Set(["/Users/tester/.pi/agent/sessions/--Users-tester-old--/a.jsonl"]),
        },
      }),
    ).resolves.toBe(true);
  });

  test("leaves another app's Pi session to the Pi row", async () => {
    // A home-rooted project must match exactly: `~/` is a prefix of everything else
    // on the machine, so prefix matching here would claim every tool's sessions.
    await expect(
      isAppHostedTranscriptForTest({
        path: "/Users/tester/.pi/agent/sessions/--Users-tester-Git-KylinWork--/a.jsonl",
        contents: piTranscriptIn("/Users/tester/Git/KylinWork"),
        appScope: scope,
      }),
    ).resolves.toBe(false);
    await expect(
      isAppHostedTranscriptForTest({
        path: "/Users/tester/.pi/agent/sessions/--private-tmp--/a.jsonl",
        contents: piTranscriptIn("/private/tmp"),
        appScope: scope,
      }),
    ).resolves.toBe(false);
  });

  test("keeps the app's own sessions when the transcript has no workspace header", async () => {
    await expect(
      isAppHostedTranscriptForTest({
        path: "/Users/tester/.pi/agent/sessions/--Users-tester--/a.jsonl",
        contents: '{"type":"message","message":{"role":"user"}}',
        appScope: scope,
      }),
    ).resolves.toBe(false);
  });
});

describe("readZcodeEvents", () => {
  test("reads per-request rows and resolves each session's workspace", () => {
    const dir = makeTempDir();
    const databasePath = nodePath.join(dir, "db.sqlite");
    const database = new DatabaseSync(databasePath);
    database.exec(`
      CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT NOT NULL);
      CREATE TABLE model_usage (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, model_id TEXT NOT NULL, started_at INTEGER NOT NULL,
        input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, reasoning_tokens INTEGER NOT NULL,
        cache_creation_input_tokens INTEGER NOT NULL, cache_read_input_tokens INTEGER NOT NULL
      );
    `);
    database
      .prepare("INSERT INTO session (id, directory) VALUES (?, ?)")
      .run("sess-1", "/Users/a/Git/PeakCode");
    const insert = database.prepare("INSERT INTO model_usage VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    insert.run("u1", "sess-1", "deepseek-v4.1", 1_789_000_000_000, 29_385, 131, 40, 0, 1_000);
    insert.run("u2", "sess-1", "deepseek-v4", 1_700_000_000_000, 10, 1, 0, 0, 0);
    database.close();

    const events = readZcodeEvents({ databasePath, windowStartMs: 1_788_000_000_000 });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      source: "zcode",
      model: "deepseek-v4.1",
      sessionId: "sess-1",
      project: "PeakCode",
      // ZCode reports input inclusive of cache.
      inputTokens: 28_385,
      cacheReadTokens: 1_000,
      outputTokens: 131,
    });
  });

  test("returns nothing for a database without the expected tables", () => {
    const dir = makeTempDir();
    const databasePath = nodePath.join(dir, "empty.sqlite");
    new DatabaseSync(databasePath).close();

    expect(readZcodeEvents({ databasePath, windowStartMs: 0 })).toEqual([]);
  });
});

describe("readOpencodeEvents", () => {
  test("reads assistant messages and skips the user rows", () => {
    const dir = makeTempDir();
    const databasePath = nodePath.join(dir, "opencode.db");
    const database = new DatabaseSync(databasePath);
    database.exec(`
      CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT NOT NULL);
      CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, data TEXT NOT NULL);
    `);
    database
      .prepare("INSERT INTO session (id, directory) VALUES (?, ?)")
      .run("oc-1", "/Users/a/ai/OmniStudio");
    const insert = database.prepare("INSERT INTO message VALUES (?, ?, ?, ?)");
    insert.run(
      "m1",
      "oc-1",
      1_789_000_000_000,
      JSON.stringify({
        role: "assistant",
        modelID: "glm-4.7-free",
        tokens: { input: 532, output: 115, reasoning: 76, cache: { read: 11_294, write: 0 } },
        time: { created: 1_789_000_000_000 },
      }),
    );
    insert.run("m2", "oc-1", 1_789_000_001_000, JSON.stringify({ role: "user", text: "hi" }));
    database.close();

    const events = readOpencodeEvents({ databasePath, windowStartMs: 1_788_000_000_000 });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      source: "opencode",
      model: "glm-4.7-free",
      project: "OmniStudio",
      inputTokens: 532,
      cacheReadTokens: 11_294,
      outputTokens: 115,
      totalTokens: 532 + 11_294 + 115,
    });
  });
});
