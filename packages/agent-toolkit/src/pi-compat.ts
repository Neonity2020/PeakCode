/**
 * pi 版本兼容层。
 *
 * 原实现基于 `@earendil-works/pi-ai` / `pi-agent-core` 0.85。PeakCode 目前固定在 0.74，
 * 两者之间这些助手少了三样东西。它们都是**纯函数**，所以这里原样移植而不是升级依赖：
 * 升级会牵动 PeakCode 自己的 PiAdapter（1900 行），而这三段代码本身没有任何版本相关性。
 *
 * 1. `isRetryableAssistantError` —— pi-ai 0.85 的瞬时错误分类器（`utils/retry`）；
 * 2. `serializeConversation` —— 把历史渲染成摘要模型读的纯文本
 *    （0.74 里只存在于 `pi-coding-agent` 的 compaction 模块）；
 * 3. `CompleteSimpleLike` —— 0.85 的 `Models.completeSimple` 在 0.74 里是独立的
 *    `completeSimple(model, context, options)` 函数，签名一致，用一个端口把差异挡在宿主侧。
 */
import type {
  AssistantMessage,
  Api,
  Context,
  Model,
  SimpleStreamOptions,
} from "@earendil-works/pi-ai";

/** 0.85 的 `Models.completeSimple` 与 0.74 的顶层 `completeSimple` 共同满足的形状。 */
export interface CompleteSimpleLike {
  completeSimple<TApi extends Api>(
    model: Model<TApi>,
    context: Context,
    options?: SimpleStreamOptions,
  ): Promise<AssistantMessage>;
}

function buildProviderErrorPattern(patterns: string[]): RegExp {
  return new RegExp(patterns.join("|"), "i");
}

/**
 * 非瞬时错误：配额 / 计费 / 订阅上限。
 *
 * 这些再试多少次都一样，属于「该换模型」而不是「该重试」。必须**先**判它，
 * 否则 "429" 之类的通用模式会把额度耗尽也当成限流重试。
 */
const NON_RETRYABLE_PROVIDER_LIMIT_ERROR_PATTERN = buildProviderErrorPattern([
  "GoUsageLimitError",
  "FreeUsageLimitError",
  "Monthly usage limit reached",
  "available balance",
  "insufficient_quota",
  "out of budget",
  "quota exceeded",
  "billing",
]);

/** 瞬时错误：供应商过载、限流、网关 5xx、网络与流中断。 */
const RETRYABLE_PROVIDER_ERROR_PATTERN = buildProviderErrorPattern([
  "overloaded",
  "rate.?limit",
  "too many requests",
  "429",
  "500",
  "502",
  "503",
  "504",
  "524",
  "service.?unavailable",
  "server.?error",
  "internal.?error",
  "provider.?returned.?error",
  "exceeded request buffer limit while retrying upstream",
  "network.?error",
  "connection.?error",
  "connection.?refused",
  "connection.?lost",
  "other side closed",
  "fetch failed",
  "getaddrinfo",
  "ENOTFOUND",
  "EAI_AGAIN",
  "upstream.?connect",
  "reset before headers",
  "socket hang up",
  "socket connection was closed",
  "timed? out",
  "timeout",
  "terminated",
  "websocket.?closed",
  "websocket.?error",
  "ended without",
  "stream ended before message_stop",
  "stream ended before a terminal response event",
  "http2 request did not get a response",
  "retry delay",
  "you can retry your request",
  "try your request again",
  "please retry your request",
  "ResourceExhausted",
]);

/**
 * 这条失败的助手消息看起来是**瞬时**的供应商 / 传输错误吗？
 *
 * 只做分类，不做重试策略：调用方先处理上下文溢出，再套自己的重试预算与退避
 * （见 `agent-retry.ts` 的 `attachTurnRecovery`）。
 */
export function isRetryableAssistantError(
  message: Pick<AssistantMessage, "stopReason"> & { errorMessage?: string | undefined },
): boolean {
  if (message.stopReason !== "error" || !message.errorMessage) return false;
  const errorMessage = message.errorMessage;
  if (NON_RETRYABLE_PROVIDER_LIMIT_ERROR_PATTERN.test(errorMessage)) return false;
  return RETRYABLE_PROVIDER_ERROR_PATTERN.test(errorMessage);
}

type TextBlock = { type: "text"; text: string };
type ThinkingBlock = { type: "thinking"; thinking: string };
type ToolCallBlock = { type: "toolCall"; name: string; arguments: Record<string, unknown> };

/** 内容块只按 `type` 收窄，不假设字段齐全：历史可能来自更早的版本或自定义消息。 */
type ContentBlock = {
  type?: string | undefined;
  text?: unknown;
  thinking?: unknown;
  name?: unknown;
  arguments?: unknown;
};

/** 摘要里的单条工具结果字符上限：摘要是"够用就好"，不需要把全文再送一遍。 */
const TOOL_RESULT_SUMMARY_CHARS = 2_000;

/**
 * 把历史渲染成纯文本，交给摘要模型。
 *
 * 助手消息拆成 thinking / 正文 / 工具调用三段分别标注 —— 只给正文的话，
 * "它查过什么、改过什么"这些决定后续走向的信息全丢了。
 */
export function serializeConversation(messages: readonly unknown[]): string {
  const parts: string[] = [];
  for (const raw of messages) {
    if (typeof raw !== "object" || raw === null) continue;
    const message = raw as { role?: string; content?: unknown };

    if (message.role === "user") {
      const content =
        typeof message.content === "string"
          ? message.content
          : Array.isArray(message.content)
            ? message.content
                .filter((block): block is TextBlock => (block as TextBlock)?.type === "text")
                .map((block) => block.text)
                .join("")
            : "";
      if (content) parts.push(`[User]: ${content}`);
      continue;
    }

    if (message.role === "assistant") {
      const textParts: string[] = [];
      const thinkingParts: string[] = [];
      const toolCalls: string[] = [];
      const blocks = Array.isArray(message.content) ? message.content : [];
      for (const block of blocks) {
        const typed = (typeof block === "object" && block !== null ? block : {}) as ContentBlock;
        if (typed.type === "text" && typeof typed.text === "string") {
          textParts.push(typed.text);
        } else if (typed.type === "thinking" && typeof typed.thinking === "string") {
          thinkingParts.push(typed.thinking);
        } else if (typed.type === "toolCall" && typeof typed.name === "string") {
          const args =
            typeof typed.arguments === "object" && typed.arguments !== null
              ? (typed.arguments as Record<string, unknown>)
              : {};
          const argsStr = Object.entries(args)
            .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
            .join(", ");
          toolCalls.push(`${typed.name}(${argsStr})`);
        }
      }
      if (thinkingParts.length > 0) parts.push(`[Assistant thinking]: ${thinkingParts.join("\n")}`);
      if (textParts.length > 0) parts.push(`[Assistant]: ${textParts.join("\n")}`);
      if (toolCalls.length > 0) parts.push(`[Assistant tool calls]: ${toolCalls.join("; ")}`);
      continue;
    }

    if (message.role === "toolResult") {
      const blocks = Array.isArray(message.content) ? message.content : [];
      const content = blocks
        .filter((block): block is TextBlock => (block as TextBlock)?.type === "text")
        .map((block) => block.text)
        .join("");
      if (content) {
        const clipped =
          content.length > TOOL_RESULT_SUMMARY_CHARS
            ? `${content.slice(0, TOOL_RESULT_SUMMARY_CHARS)}…`
            : content;
        parts.push(`[Tool result]: ${clipped}`);
      }
    }
  }
  return parts.join("\n\n");
}
