import { describe, expect, test } from "vitest";

import { contributionFromEvents, localDateKey, UsageAccumulator } from "./usageAggregate";
import type { UsageEvent, UsageSourceId } from "./usageCollectors";

/**
 * 折叠与保留策略。
 *
 * 三件事必须被钉住：
 * 1. **按 天 × 工具 × 模型 累加** —— 面板的日聚合、工具占比、模型占比都从这一张表出；
 * 2. **会话的请求明细有界** —— 单会话超过上限丢最旧的、空闲或超出跟踪数量的会话释放明细，
 *    否则一个跑了一年的进程会把内存吃光（本机单工具两周就有 5 万个请求）；
 * 3. **文件级贡献可以安全合并** —— 缓存的是折叠结果，合并必须等价于重新全量折叠。
 */

function event(input: {
  timestampMs: number;
  source: UsageSourceId;
  model: string;
  sessionId?: string | null;
  project?: string | null;
  tokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
}): UsageEvent {
  const inputTokens = input.inputTokens ?? 100;
  const outputTokens = input.outputTokens ?? 10;
  const cacheReadTokens = input.cacheReadTokens ?? 0;
  return {
    timestampMs: input.timestampMs,
    source: input.source,
    model: input.model,
    sessionId: input.sessionId === undefined ? "s-1" : input.sessionId,
    project: input.project === undefined ? "PeakCode" : input.project,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    totalTokens: input.tokens ?? inputTokens + outputTokens + cacheReadTokens,
  };
}

function at(day: number, hour = 12): number {
  return new Date(2026, 8, day, hour, 0, 0, 0).getTime();
}

describe("UsageAccumulator", () => {
  test("folds requests into day × tool × model rows", () => {
    const accumulator = new UsageAccumulator();
    accumulator.add(event({ timestampMs: at(18), source: "pi", model: "deepseek-v4.1" }));
    accumulator.add(event({ timestampMs: at(18), source: "pi", model: "deepseek-v4.1" }));
    accumulator.add(
      event({ timestampMs: at(18), source: "zcode", model: "deepseek-v4", inputTokens: 5 }),
    );
    accumulator.add(event({ timestampMs: at(17), source: "pi", model: "deepseek-v4.1" }));

    const rows = accumulator.dayRows();

    expect(rows).toHaveLength(3);
    const sameDay = rows.find((row) => row.date === localDateKey(at(18)) && row.source === "pi");
    expect(sameDay).toMatchObject({ model: "deepseek-v4.1", responses: 2, tokens: 220 });
  });

  test("tracks a session's span, tokens and models", () => {
    const accumulator = new UsageAccumulator();
    accumulator.add(
      event({
        timestampMs: at(18, 9),
        source: "claude-code",
        model: "claude-sonnet-4-6",
        sessionId: "s-9",
        project: "OmniStudio",
      }),
    );
    accumulator.add(
      event({
        timestampMs: at(18, 11),
        source: "claude-code",
        model: "claude-opus-4-6",
        sessionId: "s-9",
        project: "OmniStudio",
        inputTokens: 300,
      }),
    );

    const [session] = accumulator.sessionSlices();

    expect(session).toMatchObject({
      sessionId: "s-9",
      project: "OmniStudio",
      responses: 2,
      startedAtMs: at(18, 9),
      endedAtMs: at(18, 11),
    });
    expect(session?.modelTokens.map((entry) => entry.model)).toEqual([
      "claude-opus-4-6",
      "claude-sonnet-4-6",
    ]);
  });

  test("keeps only the newest requests per session and counts the dropped ones", () => {
    const accumulator = new UsageAccumulator();
    for (let index = 0; index < 130; index += 1) {
      accumulator.add(
        event({ timestampMs: at(18) + index * 1_000, source: "pi", model: "deepseek-v4.1" }),
      );
    }

    const [session] = accumulator.sessionSlices();

    expect(session?.responses).toBe(130);
    expect(session?.requests).toHaveLength(120);
    expect(session?.droppedRequests).toBe(10);
    // The newest request survives; the oldest is the one released.
    expect(session?.requests?.at(-1)?.timestampMs).toBe(at(18) + 129 * 1_000);
    expect(session?.requests?.[0]?.timestampMs).toBe(at(18) + 10 * 1_000);
  });

  test("releases request logs for idle sessions but keeps their totals", () => {
    const accumulator = new UsageAccumulator();
    accumulator.add(event({ timestampMs: at(1), source: "pi", model: "deepseek-v4.1" }));
    accumulator.add(
      event({
        timestampMs: at(18),
        source: "pi",
        model: "deepseek-v4.1",
        sessionId: "recent",
      }),
    );

    accumulator.prune({ nowMs: at(18) + 60_000 });
    const idle = accumulator.sessionSlices().find((session) => session.sessionId === "s-1");
    const recent = accumulator.sessionSlices().find((session) => session.sessionId === "recent");

    expect(idle?.requests).toBeNull();
    expect(idle?.tokens).toBe(110);
    expect(idle?.droppedRequests).toBe(1);
    expect(recent?.requests).not.toBeNull();
  });

  test("caps how many sessions keep a request log", () => {
    const accumulator = new UsageAccumulator();
    for (let index = 0; index < 450; index += 1) {
      accumulator.add(
        event({
          timestampMs: at(18) + index * 1_000,
          source: "pi",
          model: "deepseek-v4.1",
          sessionId: `s-${index}`,
        }),
      );
    }

    accumulator.prune({ nowMs: at(18) + 600_000 });
    const withDetail = accumulator.sessionSlices().filter((session) => session.requests !== null);

    expect(accumulator.sessionSlices()).toHaveLength(450);
    expect(withDetail).toHaveLength(400);
    // The retained ones are the most recently active.
    expect(withDetail.some((session) => session.sessionId === "s-449")).toBe(true);
    expect(withDetail.some((session) => session.sessionId === "s-0")).toBe(false);
  });

  test("merging cached contributions equals folding the events again", () => {
    const events = [
      event({ timestampMs: at(18, 9), source: "pi", model: "deepseek-v4.1" }),
      event({ timestampMs: at(18, 10), source: "pi", model: "deepseek-v4.1", inputTokens: 400 }),
      event({ timestampMs: at(17), source: "zcode", model: "deepseek-v4" }),
    ];

    const direct = new UsageAccumulator();
    events.forEach((entry) => direct.add(entry));

    const merged = new UsageAccumulator();
    merged.merge(contributionFromEvents([events[0]!]));
    merged.merge(contributionFromEvents(events.slice(1)));

    expect(merged.dayRows().toSorted((left, right) => left.tokens - right.tokens)).toEqual(
      direct.dayRows().toSorted((left, right) => left.tokens - right.tokens),
    );
    expect(merged.sessionSlices()).toEqual(direct.sessionSlices());
  });

  test("gives records without a session their file as the session key", () => {
    const accumulator = new UsageAccumulator();
    accumulator.add(
      event({ timestampMs: at(18), source: "grok", model: "grok-4.6", sessionId: null }),
      { fallbackSessionId: "updates" },
    );

    expect(accumulator.sessionSlices()[0]?.sessionId).toBe("updates");
  });
});
