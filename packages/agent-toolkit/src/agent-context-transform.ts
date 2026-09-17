/**
 * 上下文压缩流水线（收网 → 去重 → 摘要 → 裁剪）。
 *
 * 这是 agent 能在小窗口上跑长任务的关键：本地模型 8k 窗口，几轮工具调用就溢出了。
 * 四步的**顺序本身就是正确性的一部分**，每一步解决的是前一步处理不了的问题：
 *
 * 0. **收网**（`rewind`，零成本）：打点之后的探索过程整段换成模型自己写的结论。
 *    不做摘要，所以没有"摘要写歪"的漂移风险。
 * 1. **去重**（零成本）：同一个文件被读三四遍，旧副本的信息已被最新一次完整读取覆盖。
 * 2. **摘要**（一次模型调用）：把旧历史交给模型压成结构化摘要，多花一次推理换"长任务不断片"。
 * 3. **裁剪**（永不失败）：真压不下去时的兜底，把中间历史换成一句"已省略 N 条"。
 *
 * 两条硬约束：
 * - 收网**不是流水线的终点**。曾经在这里直接 return，于是收网过的会话从此走不到
 *   后面几步 —— 历史重新涨过窗口时没有任何兜底，而收网那一刻又刚好把旧摘要作废了，
 *   表现为"这个会话越用越卡"，没有报错也没有日志。
 * - 摘要失败**绝不能让这一轮发不出去**：任何异常 / 超时都退回确定性裁剪。
 */
import type { Api, Model } from "@earendil-works/pi-ai";

import {
  compactMessages,
  estimateMessagesTokens,
  pruneSupersededReads,
} from "./agent-compaction.ts";
import { applyRewind, checkpointReminderText, type RewindState } from "./agent-checkpoint.ts";
import { recordAgentEvent } from "./agent-events.ts";
import { findSummaryCut, summarizeHistory, summaryMessageText } from "./agent-summary.ts";
import type { CompleteSimpleLike } from "./pi-compat.ts";
import { logEvent } from "./runtime/log.ts";
import { getSetting } from "./runtime/settings.ts";

export type CompactionHost = {
  workspace: string;
  summary: { text: string; coveredCount: number; tokensBefore: number } | null;
  compactedDropped: number;
  /** 探索打点 / 收网的状态（子智能体不参与，传 null）。 */
  checkpoint?:
    | { goal: string; atMessageCount: number; atSnapshotId: string | null; startedAt: number }
    | null
    | undefined;
  rewind?: RewindState | null | undefined;
};

/** 摘要这一步需要的模型（0.85 的 `Models` / 0.74 的 `completeSimple` 都满足）。 */
export type CompactionModels = {
  models: CompleteSimpleLike;
  model: Model<Api>;
};

/**
 * 宿主可选的"记忆召回"：把这段历史里提到的事从记忆库捞回来，一起喂给摘要模型。
 * 不喂的话，记忆就只存在于压缩之前 —— 摘要是模型写的，它没看过记忆库。
 */
export type CompactionRecallHook = (query: string) => Promise<string | null>;

export type ContextTransformOptions = {
  /** 摘要用的模型；不给就只有确定性裁剪（省一次推理调用）。 */
  compactionModels?: CompactionModels | null | undefined;
  /** 摘要是否启用（设置 `AGENT_COMPACT_MODE` = "trim" 时关掉）。 */
  summaryEnabled?: boolean | undefined;
  /** 记录轨迹时挂在哪条助手消息上。 */
  messageId?: number | null | undefined;
  recall?: CompactionRecallHook | null | undefined;
};

const DEFAULT_CONTEXT_WINDOW = 8_192;

/** 上下文预算：窗口的 60%（下限 256，但不能高过窗口本身的 60%）。 */
export function contextBudgetTokens(contextWindow: number): number {
  return Math.max(256, Math.floor(contextWindow * 0.6));
}

/**
 * 造一个 `transformContext`。
 *
 * 导出主要是为了单测：这个函数的**全部内容就是几步的顺序**，而顺序错了在界面上看不出来，
 * 只在长会话里慢慢表现为"越来越卡"或"模型忘了刚做的事"。
 */
export function makeContextTransform(
  host: CompactionHost,
  conversationId: number,
  options: ContextTransformOptions = {},
): (messages: unknown[], signal?: AbortSignal) => Promise<unknown[]> {
  return async (messages, signal) => {
    const contextWindow = Number(getSetting("SERVER_CTX_SIZE")) || DEFAULT_CONTEXT_WINDOW;
    const budget = contextBudgetTokens(contextWindow);
    // 摘要要保留的"最近上下文"：窗口的 1/4。8k 窗口下约 2k tokens，
    // 够放下最近一两轮的来龙去脉，又不至于让摘要区域小到没意义。
    const keepRecent = Math.max(128, Math.floor(contextWindow * 0.25));

    const record = (toolName: string, output: string) => {
      recordAgentEvent({
        conversationId,
        messageId: options.messageId ?? null,
        kind: "status",
        toolName,
        output,
      });
    };

    // ── 0. 收网 ─────────────────────────────────────────────────────
    let base: unknown[] = messages;
    if (host.rewind) {
      if (!host.rewind.logged) {
        host.rewind.logged = true;
        record(
          "rewind",
          `探索收网：打点之后的中间过程已由结论替代（保留 ${host.rewind.at} 条 + 新内容）。`,
        );
      }
      base = applyRewind(base, host.rewind);
    }

    // ── 1. 去重 ─────────────────────────────────────────────────────
    const pruned = pruneSupersededReads(
      base as { role?: string; content?: unknown }[],
      (path) => `（已省略：${path} 在这次之前被读取的结果，后来又被完整读过，已由最新一次取代。）`,
    );
    const current = pruned.messages;
    if (pruned.pruned > 0) {
      record(
        "prune",
        `上下文去重：省略 ${pruned.pruned} 条被重复读取取代的工具结果（约省 ${pruned.tokensSaved} tokens）。`,
      );
    }

    // 会话上记着的摘要如果比当前消息还长，说明这批消息被换过了（重新生成 / 换模型），作废。
    if (host.summary && host.summary.coveredCount > current.length) host.summary = null;

    // ── 2. 摘要 ─────────────────────────────────────────────────────
    const summaryEnabled = options.summaryEnabled ?? getSetting("AGENT_COMPACT_MODE") !== "trim";
    const compactionModels = options.compactionModels ?? null;
    if (summaryEnabled && compactionModels) {
      const effective = host.summary
        ? [summaryMessage(host.summary), ...current.slice(host.summary.coveredCount)]
        : current;
      if (estimateMessagesTokens(effective as never) > budget) {
        const covered = host.summary?.coveredCount ?? 0;
        const cut = findSummaryCut(
          current,
          keepRecent,
          (slice) => estimateMessagesTokens(slice as never),
          2,
        );
        if (cut !== null && cut > covered) {
          const query = lastUserText(current.slice(covered, cut)) ?? "";
          const recalled =
            query && options.recall ? await options.recall(query).catch(() => null) : null;
          const outcome = await summarizeHistory({
            messages: current,
            from: covered,
            cut,
            models: compactionModels.models,
            model: compactionModels.model,
            previousSummary: host.summary?.text ?? null,
            recalled,
            signal,
            maxTokens: Math.min(2048, Math.max(512, Math.floor(contextWindow * 0.2))),
          });
          if (outcome.ok) {
            host.summary = {
              text: outcome.summary,
              coveredCount: outcome.coveredCount,
              tokensBefore: outcome.tokensBefore,
            };
            record(
              "compact",
              `上下文摘要：前 ${outcome.coveredCount} 条历史（约 ${outcome.tokensBefore} tokens）已压缩成摘要` +
                `${covered > 0 ? "（在已有摘要上续写）" : ""}。`,
            );
          } else {
            // 摘要是"锦上添花"：失败就退回确定性裁剪，这一轮必须照常发出去。
            logEvent({
              level: "warn",
              source: "agent",
              event: "agent.compact.summary_failed",
              message: `摘要式压缩失败，退回确定性裁剪：${outcome.reason}`,
              detail: { conversationId },
            });
            record("compact", `摘要式压缩失败（${outcome.reason}），本轮改用确定性裁剪。`);
          }
        }
      }
    }
    const withMemo: { role?: string; content?: unknown }[] =
      host.summary && summaryEnabled
        ? [summaryMessage(host.summary), ...current.slice(host.summary.coveredCount)]
        : current;

    // ── 3. 兜底裁剪（永不失败）──────────────────────────────────────
    const trimmed = compactMessages(withMemo as never[], budget, (dropped) => ({
      role: "user",
      content: [
        {
          type: "text",
          text:
            `（上下文自动压缩：为节省窗口，已省略中间 ${dropped} 条历史消息，` +
            "只保留任务陈述与最近的进展。需要细节时请重新读取文件或重新执行命令。）",
        },
      ],
      timestamp: Date.now(),
    }));
    if (trimmed.dropped > 0) {
      host.compactedDropped += trimmed.dropped;
      record(
        "compact",
        `上下文压缩：省略 ${trimmed.dropped} 条历史消息（约 ${trimmed.tokensBefore} → ${trimmed.tokensAfter} tokens，` +
          `上下文预算 ${budget}）。`,
      );
    }

    // 打点还开着就每轮提醒一次：模型很容易探索完就直接去干别的，把中间过程一直挂在窗口里。
    if (host.checkpoint) {
      return [
        ...trimmed.messages,
        {
          role: "user",
          content: [{ type: "text", text: checkpointReminderText(host.checkpoint.goal) }],
          timestamp: Date.now(),
        },
      ];
    }
    return trimmed.messages;
  };
}

/** 摘要在实际上下文里的那条消息（已有摘要时每轮都要放回去）。 */
function summaryMessage(summary: { text: string; coveredCount: number }): {
  role: "user";
  content: { type: "text"; text: string }[];
  timestamp: number;
} {
  return {
    role: "user",
    content: [
      { type: "text", text: summaryMessageText(summary.text, summary.coveredCount, "auto") },
    ],
    timestamp: Date.now(),
  };
}

/** 一段历史里最后一条用户消息的正文（摘要召回用它当关键词）。 */
export function lastUserText(messages: { role?: string; content?: unknown }[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== "user") continue;
    const content = message.content;
    if (typeof content === "string") return content.slice(0, 500);
    if (Array.isArray(content)) {
      const text = content
        .map((block) => (block as { type?: string; text?: string })?.text ?? "")
        .filter(Boolean)
        .join("\n");
      if (text.trim()) return text.slice(0, 500);
    }
  }
  return null;
}
