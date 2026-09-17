import type { ImChannelId, ImChannelStatus } from "@peakcode/contracts";

/**
 * How a channel answers a message that arrived through it.
 *
 * The reply closure belongs to the inbound message because every channel addresses
 * answers differently: Feishu needs the chat's id, QQ a passive-reply message id, the
 * personal-WeChat bridge the sender's context token. The bridge just holds on to the
 * closure until the agent's turn finishes.
 */
export interface ImReplyHandle {
  readonly reply: (text: string) => Promise<void>;
  /**
   * Post a transient "working on it" notice. The returned handle is handed back to
   * `recallAck` when the answer is ready, so the chat keeps only the result. Channels
   * without a recall API leave this undefined.
   */
  readonly ack?: (queued: boolean) => Promise<string | null>;
  readonly recallAck?: (handle: string) => Promise<void>;
}

/** A message that arrived from a chat and is waiting for an agent turn. */
export interface ImInboundMessage {
  readonly channel: ImChannelId;
  /** Identity of the chat inside the channel (open id, chat id, group id, user id). */
  readonly peerId: string;
  /**
   * Disambiguates chat kinds that share an id space (QQ's `c2c` vs `group`). Empty for
   * channels where the peer id is already unique.
   */
  readonly peerScope: string;
  /** What the settings screen and logs call this chat. */
  readonly peerLabel: string;
  readonly text: string;
  readonly reply: ImReplyHandle;
}

/** A channel's live connection, driven by the bridge as settings change. */
export interface ImChannelAdapter {
  readonly id: ImChannelId;
  /** Connect (or reconnect when `force`) using the current settings. */
  readonly start: (force?: boolean) => Promise<ImChannelStatus>;
  readonly stop: () => Promise<void>;
  readonly status: () => ImChannelStatus;
}

/** Split long text into chunks, preferring to break on a newline. */
export function splitTextOnNewlines(text: string, limit: number): ReadonlyArray<string> {
  const out: Array<string> = [];
  let rest = String(text ?? "");
  while (rest.length > limit) {
    let cut = rest.lastIndexOf("\n", limit);
    if (cut < limit * 0.5) cut = limit;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, "");
  }
  if (rest.length > 0) out.push(rest);
  return out.length > 0 ? out : [""];
}

/** The status a channel reports before anything is configured. */
export function offStatus(
  id: ImChannelId,
  overrides: Partial<Omit<ImChannelStatus, "id">> = {},
): ImChannelStatus {
  return {
    id,
    configured: false,
    state: "off",
    ...overrides,
  };
}

/** Read an error's message without trusting its shape. */
export function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
