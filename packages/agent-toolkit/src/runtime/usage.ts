/** Token accounting channels, mirroring the original usage ledger's vocabulary. */
export type UsageChannel =
  | "chat"
  | "agent"
  | "gateway"
  | "image"
  | "video"
  | "ocr"
  | "translate"
  | "embedding"
  | "rerank";

export interface TokenUsage {
  input?: number | null;
  output?: number | null;
  cacheRead?: number | null;
  cacheWrite?: number | null;
  reasoning?: number | null;
}

export interface TokenUsageEvent {
  channel: UsageChannel;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number | undefined;
  reasoningTokens: number | undefined;
}

export type TokenUsageSink = (event: TokenUsageEvent) => void;

const defaultSink: TokenUsageSink = () => {};

let sink: TokenUsageSink = defaultSink;

/**
 * Install the host's usage ledger. Model-based compaction reports the tokens its
 * summarisation call spent through here; without a sink the call is simply unaccounted.
 */
export function setTokenUsageSink(next: TokenUsageSink | null): void {
  sink = next ?? defaultSink;
}

/** Record one upstream LLM request. Zero-usage calls are dropped, as in the original. */
export function recordTokenUsage(input: {
  channel: UsageChannel;
  model: string;
  usage?: TokenUsage | null;
}): void {
  const inputTokens = input.usage?.input ?? 0;
  const outputTokens = input.usage?.output ?? 0;
  if (inputTokens === 0 && outputTokens === 0) return;
  try {
    sink({
      channel: input.channel,
      model: input.model,
      inputTokens,
      outputTokens,
      cachedTokens: input.usage?.cacheRead ?? undefined,
      reasoningTokens: input.usage?.reasoning ?? undefined,
    });
  } catch {
    // Accounting failures must not fail the turn.
  }
}
