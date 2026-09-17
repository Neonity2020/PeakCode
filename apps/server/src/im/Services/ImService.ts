import type {
  ImChannelId,
  ImConversation,
  ImMobileLink,
  ImMobileLinkInput,
  ImRemoteAccessStatus,
  ImStatusSnapshot,
  ImTestChannelResult,
  ImWechatQrCode,
  ImWechatQrStatus,
} from "@peakcode/contracts";
import type { Effect, Scope } from "effect";
import { ServiceMap } from "effect";

/** A callback query as the HTTP layer receives it (Tencent sends everything as strings). */
export type ImCallbackQuery = Record<string, string | undefined>;

/** A parsed inbound WeChat-side callback. */
export interface ImCallbackMessage {
  readonly fromUser: string;
  readonly msgType: string;
  readonly text: string;
  readonly msgId: string;
}

/**
 * ImServiceShape - the IM bridge.
 *
 * Owns the channel connections, routes inbound chat messages into agent threads, and
 * answers in the chat once the turn is over. The settings screen talks to it for status,
 * the WeChat QR handshake, connectivity probes and the phone hand-off link; the HTTP
 * routes use the callback helpers to verify and decode what Tencent posts.
 */
export interface ImServiceShape {
  /** Connect every configured channel and start watching turn outcomes. */
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;

  readonly status: Effect.Effect<ImStatusSnapshot>;

  /** Chats currently wired to a thread, newest activity first. */
  readonly listConversations: Effect.Effect<ReadonlyArray<ImConversation>>;

  /** Forget a chat so its next message opens a fresh thread. */
  readonly forgetConversation: (conversationKey: string) => Effect.Effect<void, Error>;

  /** Step one of the personal-WeChat login: a scannable code. */
  readonly createWechatQrCode: () => Effect.Effect<ImWechatQrCode, Error>;

  /** Step two: poll the scan. `confirmed` also stores the credentials and connects. */
  readonly pollWechatQrStatus: (qrcode: string) => Effect.Effect<ImWechatQrStatus, Error>;

  /** Forget the personal-WeChat account and stop polling. */
  readonly disconnectWechat: () => Effect.Effect<void, Error>;

  /** Validate a channel's credentials (and reconnect it). */
  readonly testChannel: (channel: ImChannelId) => Effect.Effect<ImTestChannelResult, Error>;

  /**
   * The QR-and-URL hand-off that opens this workspace on a phone. The conversation the
   * desktop is showing travels with it, so the phone lands on it instead of an empty
   * workspace.
   */
  readonly createMobileLink: (input: ImMobileLinkInput) => Effect.Effect<ImMobileLink, Error>;

  /**
   * Publish this server on a Cloudflare quick tunnel and return its status. Refused when
   * the server does not require authentication: the tunnel address is public.
   */
  readonly startRemoteAccess: () => Effect.Effect<ImRemoteAccessStatus, Error>;

  /** Take the public address down again. */
  readonly stopRemoteAccess: () => Effect.Effect<ImRemoteAccessStatus, Error>;

  /** Verify a Tencent URL-setup request and return the plaintext it expects back. */
  readonly verifyWechatCallback: (input: {
    readonly channel: "wecom" | "wechatMp";
    readonly query: ImCallbackQuery;
  }) => Effect.Effect<string, Error>;

  /** Decode a Tencent callback body into text, checking its signature. */
  readonly parseWechatCallback: (input: {
    readonly channel: "wecom" | "wechatMp";
    readonly query: ImCallbackQuery;
    readonly rawBody: string;
  }) => Effect.Effect<ImCallbackMessage, Error>;

  /** Hand a callback message to the bridge (returns as soon as the turn is dispatched). */
  readonly acceptWechatCallbackMessage: (input: {
    readonly channel: "wecom" | "wechatMp";
    readonly message: ImCallbackMessage;
  }) => Effect.Effect<void>;

  /**
   * Run one task from the generic `POST /api/im/task` bridge and wait for its answer.
   * Any tool that can send an HTTP request (a WeChat framework, an iOS shortcut, a
   * scheduled script) can drive the agent this way.
   */
  readonly runWebhookTask: (input: {
    readonly text: string;
    readonly session?: string | undefined;
    readonly secret?: string | undefined;
  }) => Effect.Effect<{ readonly reply: string; readonly threadId: string }, Error>;
}

/**
 * ImService - Service tag for the IM bridge.
 */
export class ImService extends ServiceMap.Service<ImService, ImServiceShape>()(
  "t3/im/Services/ImService",
) {}
