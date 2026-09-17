/**
 * 自愈逻辑与内核契约的对接测试。
 *
 * 前面那些用例只验证了判据与文案，这里分两段钉住真正依赖的行为：
 *
 * 1. **空回合自愈**（`createTurnRecovery`）：钩子的判定与提醒预算。它跑在一个
 *    仿内核循环的假宿主上，因为 `shouldStopAfterTurn` 挂在哪儿本身就是版本相关的
 *    （见 `agent-retry.ts` 里 `TurnRecoveryHost` 的说明）。
 * 2. **失败重发（内核契约）**：用假模型流真跑一遍 `Agent`，验证"摘掉末尾那条失败的空壳
 *    助手消息之后 `agent.continue()` 能正常发起下一次请求"。这条是 pi-agent-core 0.74
 *    就有的公开行为，不需要版本适配 —— 所以它必须在这层被钉住。
 */
import { Agent, type ShouldStopAfterTurnContext } from "@earendil-works/pi-agent-core";
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type AssistantMessageEvent,
  type Model,
} from "@earendil-works/pi-ai";
import { describe, expect, test } from "vitest";

import {
  createTurnRecovery,
  dropTrailingFailures,
  isRetryableTurnFailure,
  type TurnRecoveryHost,
} from "../agent-retry.ts";

const MODEL = {
  id: "fake",
  name: "fake",
  api: "openai-completions",
  provider: "omni-studio",
  baseUrl: "http://127.0.0.1:1",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 8192,
  maxTokens: 1024,
} as unknown as Model<string>;

/** 一轮的剧本：要么答一段正文，要么以某个错误结束。 */
type Script = { text: string } | { error: string };

function message(input: Script, text: string): AssistantMessage {
  const failed = "error" in input;
  return {
    role: "assistant",
    content: failed ? [] : [{ type: "text", text }],
    api: "openai-completions",
    provider: "omni-studio",
    model: "fake",
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, total: 2 } as never,
    stopReason: failed ? "error" : "stop",
    errorMessage: failed ? input.error : undefined,
    timestamp: Date.now(),
  } as AssistantMessage;
}

/** 假 streamFn：按剧本依次返回，调用次数记在 calls 里。 */
function fakeStream(
  scripts: Script[],
  calls: { count: number },
  sink: AssistantMessage[],
): unknown {
  return () => {
    const script = scripts[Math.min(calls.count, scripts.length - 1)]!;
    calls.count += 1;
    const stream = createAssistantMessageEventStream();
    const final = message(script, "text" in script ? script.text : "");
    sink.push(final);
    const done: AssistantMessageEvent =
      "error" in script
        ? { type: "error", reason: "error", error: final }
        : { type: "done", reason: "stop", message: final };
    queueMicrotask(() => {
      stream.push({ type: "start", partial: final });
      stream.push(done);
    });
    return stream as never;
  };
}

const buildAgent = (scripts: Script[], calls: { count: number }, sink: AssistantMessage[]) =>
  new Agent({
    streamFn: fakeStream(scripts, calls, sink) as never,
    initialState: { model: MODEL, systemPrompt: "你是测试用助手", tools: [], messages: [] },
  });

describe("空回合自愈", () => {
  /**
   * 仿内核循环：跑一条剧本直到钩子说要停。返回实际跑了几轮与排队进去的消息。
   *
   * 与 pi 的循环契约一致：每轮产出一条助手消息 → 问 `shouldStopAfterTurn`
   * → 返回 false 时把 `followUp` 排进来的消息当作下一轮的输入。
   */
  const runLoop = (
    scripts: Script[],
    opts: { steps?: () => number; maxSteps?: number; budget: number },
  ) => {
    const queued: string[] = [];
    const nudges: number[] = [];
    const host: TurnRecoveryHost = { followUp: (message) => queued.push(JSON.stringify(message)) };
    const hook = createTurnRecovery(host, {
      steps: opts.steps ?? (() => 0),
      maxSteps: opts.maxSteps ?? 10,
      budget: opts.budget,
      onNudge: (attempt) => nudges.push(attempt),
    });

    let rounds = 0;
    for (;;) {
      const script = scripts[Math.min(rounds, scripts.length - 1)]!;
      rounds += 1;
      const assistant = message(script, "text" in script ? script.text : "");
      const stop = hook({
        message: assistant,
        toolResults: [],
        context: { messages: [] },
        newMessages: [],
      } as unknown as ShouldStopAfterTurnContext);
      if (stop) break;
      // 钩子没排新消息 = 没有"下一轮"可跑，循环自然结束。
      if (queued.length < rounds) break;
    }
    return { rounds, nudges, queued };
  };

  test("空回合会注入提醒并继续，直到模型真的给出结论", () => {
    const { rounds, nudges, queued } = runLoop([{ text: "" }, { text: "这次答了" }], { budget: 2 });

    expect(rounds).toBe(2);
    expect(nudges).toEqual([1]);
    // 提醒是作为 harness 消息排进去的（模型下一轮才看得见），并且标注了不是用户发言。
    expect(queued.join("")).toContain("系统消息，不是用户发言");
  });

  test("一路空到底：提醒用完就放手（不会无限要它说话）", () => {
    const { rounds, nudges } = runLoop([{ text: "" }], { budget: 2 });

    expect(nudges).toEqual([1, 2]);
    expect(rounds).toBe(3); // 首轮 + 两次提醒
  });

  test("预算为 0（用户关掉自愈）时一次都不提醒", () => {
    const { rounds, nudges } = runLoop([{ text: "" }], { budget: 0 });

    expect(nudges).toEqual([]);
    expect(rounds).toBe(1);
  });

  test("步数到顶优先于提醒：先停，不再多跑一轮", () => {
    const { rounds, nudges } = runLoop([{ text: "" }], { steps: () => 5, maxSteps: 5, budget: 2 });

    expect(nudges).toEqual([]);
    expect(rounds).toBe(1);
  });

  test("有正文的回合不算空回合：不提醒", () => {
    const { rounds, nudges } = runLoop([{ text: "说完了" }], { budget: 2 });

    expect(nudges).toEqual([]);
    expect(rounds).toBe(1);
  });
});

describe("失败重发（内核契约）", () => {
  test("错误回合之后：摘掉空壳 + continue() 能接着跑出结论", async () => {
    const calls = { count: 0 };
    const sink: AssistantMessage[] = [];
    const agent = buildAgent(
      [{ error: "503 Service Unavailable" }, { text: "重试之后答上了" }],
      calls,
      sink,
    );

    await agent.prompt("做点事");
    const failed = agent.state.messages[agent.state.messages.length - 1]!;
    expect(isRetryableTurnFailure(failed as never)).toBe(true);

    // 这就是 runAgentTurn 里做的两步：摘掉失败消息 → continue()。
    agent.state.messages = dropTrailingFailures(agent.state.messages as never[]) as never;
    expect(agent.state.messages.some((item) => item.role === "assistant")).toBe(false);
    await agent.continue();

    expect(calls.count).toBe(2);
    const last = agent.state.messages[agent.state.messages.length - 1] as { content?: unknown };
    expect(JSON.stringify(last.content)).toContain("重试之后答上了");
  });

  test("不摘就直接 continue()：内核会拒绝（说明这一步不是多余的）", async () => {
    const calls = { count: 0 };
    const agent = buildAgent([{ error: "503 Service Unavailable" }], calls, []);
    await agent.prompt("做点事");
    await expect(agent.continue()).rejects.toThrow(/assistant/i);
  });
});
