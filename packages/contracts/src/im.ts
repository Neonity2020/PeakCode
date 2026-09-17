import { Schema } from "effect";

import { IsoDateTime, ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas";

/**
 * IM channels turn a chat app into a remote control for the agent: a message sent
 * from WeChat / Feishu / Lark / QQ opens (or continues) a thread and the answer is
 * sent back into the chat. These schemas describe the channel catalogue, the
 * connection state the settings UI renders, and the QR-code handshake that the
 * personal-WeChat channel logs in with.
 */

/**
 * Channel identity. `wechat` is the personal-account bridge (scan a QR code, then
 * long-poll; no public URL needed), `feishu`/`qq` connect outward over their own
 * long-lived sockets, `wecom`/`wechatMp` are callback channels that need a public
 * HTTPS address, and `webhook` is the inbound HTTP bridge any tool can post to.
 */
export const IM_CHANNEL_IDS = ["wechat", "feishu", "qq", "wecom", "wechatMp", "webhook"] as const;
export const ImChannelId = Schema.Literals(IM_CHANNEL_IDS);
export type ImChannelId = typeof ImChannelId.Type;

/** Connection state of a channel, mirroring the adapter's own lifecycle. */
export const IM_CONNECTION_STATES = ["off", "connecting", "connected", "failed"] as const;
export const ImConnectionState = Schema.Literals(IM_CONNECTION_STATES);
export type ImConnectionState = typeof ImConnectionState.Type;

/**
 * One channel as the settings screen shows it: whether credentials exist, whether
 * the link is up, and a human-readable detail line (a failure reason, the bot's
 * name, or how many chats can be answered).
 */
export const ImChannelStatus = Schema.Struct({
  id: ImChannelId,
  configured: Schema.Boolean,
  state: ImConnectionState,
  /** Adapter-specific extras (bot name, callback path, repliable peers…). */
  detail: Schema.optionalKey(Schema.String),
  error: Schema.optionalKey(Schema.String),
});
export type ImChannelStatus = typeof ImChannelStatus.Type;

/** A message that crossed the bridge, newest-first when listed. */
export const ImLogEntry = Schema.Struct({
  at: IsoDateTime,
  channel: ImChannelId,
  /** `in` = from the chat, `out` = the agent's answer, `error` = delivery failure. */
  direction: Schema.Literals(["in", "out", "error"]),
  text: Schema.String,
  /** Channel-specific peer label (chat id, openid, or user name). */
  peer: Schema.optionalKey(Schema.String),
  threadId: Schema.optionalKey(ThreadId),
});
export type ImLogEntry = typeof ImLogEntry.Type;

/**
 * One chat wired to a thread. The pair (channel, peer) is the bridge's identity for
 * a conversation, so it survives restarts and the agent keeps its context.
 */
export const ImConversation = Schema.Struct({
  conversationKey: TrimmedNonEmptyString,
  channel: ImChannelId,
  peerId: TrimmedNonEmptyString,
  /** Human-readable peer (group name, sender name) for the management list. */
  peerLabel: Schema.String,
  threadId: ThreadId,
  projectId: ProjectId,
  createdAt: IsoDateTime,
  lastMessageAt: IsoDateTime,
});
export type ImConversation = typeof ImConversation.Type;

/**
 * The public door to this workspace.
 *
 * `cloudflare` is a quick tunnel: the server dials out to Cloudflare and gets a
 * `https://*.trycloudflare.com` address that forwards back to the local port, so a phone
 * can reach the H5 app without port forwarding or a public IP. The address is
 * unguessable but public, which is why exposing is only allowed on a server that
 * requires authentication.
 */
export const IM_REMOTE_ACCESS_PROVIDERS = ["cloudflare"] as const;
export const ImRemoteAccessProvider = Schema.Literals(IM_REMOTE_ACCESS_PROVIDERS);
export type ImRemoteAccessProvider = typeof ImRemoteAccessProvider.Type;

export const ImRemoteAccessStatus = Schema.Struct({
  provider: ImRemoteAccessProvider,
  state: ImConnectionState,
  /** The public URL while the tunnel is up; the last assigned one otherwise. */
  url: Schema.String,
  error: Schema.optionalKey(Schema.String),
  /** Whether this server may be exposed at all (it must require authentication). */
  allowed: Schema.Boolean,
  /** Why exposing is refused, when it is. */
  reason: Schema.optionalKey(Schema.String),
});
export type ImRemoteAccessStatus = typeof ImRemoteAccessStatus.Type;

export const ImStatusSnapshot = Schema.Struct({
  channels: Schema.Array(ImChannelStatus),
  /** Most recent bridge traffic, newest first. */
  log: Schema.Array(ImLogEntry),
  /** How long a chat may sit idle before it starts a fresh thread. */
  idleHours: Schema.Number,
  remoteAccess: ImRemoteAccessStatus,
});
export type ImStatusSnapshot = typeof ImStatusSnapshot.Type;

/** Step one of the personal-WeChat handshake: a scannable code plus its source. */
export const ImWechatQrCode = Schema.Struct({
  qrcode: TrimmedNonEmptyString,
  /** `data:image/png;base64,…` — the deep link rendered as an image. */
  image: Schema.String,
  deepLink: Schema.String,
});
export type ImWechatQrCode = typeof ImWechatQrCode.Type;

export const IM_WECHAT_QR_STATES = ["wait", "scanned", "confirmed", "expired"] as const;
export const ImWechatQrState = Schema.Literals(IM_WECHAT_QR_STATES);
export type ImWechatQrState = typeof ImWechatQrState.Type;

/** Step two: the poll result. `confirmed` also reports the channel's new state. */
export const ImWechatQrStatus = Schema.Struct({
  status: ImWechatQrState,
  channel: Schema.optionalKey(ImChannelStatus),
});
export type ImWechatQrStatus = typeof ImWechatQrStatus.Type;

/**
 * A phone hand-off link: the workspace's own URL with a one-time pairing
 * credential, plus that URL rendered as a QR code for the camera to pick up.
 */
export const ImMobileLink = Schema.Struct({
  url: Schema.String,
  /** `data:image/png;base64,…` */
  image: Schema.String,
  expiresAt: IsoDateTime,
});
export type ImMobileLink = typeof ImMobileLink.Type;

/**
 * What the desktop hands over with a phone link: the conversation that is on screen, so
 * the phone opens that one instead of an empty workspace. Either field may be absent — a
 * fresh chat has a project but no thread, and the settings screens have neither.
 */
export const ImMobileLinkInput = Schema.Struct({
  threadId: Schema.optionalKey(ThreadId),
  projectId: Schema.optionalKey(ProjectId),
});
export type ImMobileLinkInput = typeof ImMobileLinkInput.Type;

export const ImTestChannelInput = Schema.Struct({
  channel: ImChannelId,
});
export type ImTestChannelInput = typeof ImTestChannelInput.Type;

export const ImTestChannelResult = Schema.Struct({
  ok: Schema.Boolean,
  /** Bot name or other proof the credentials work. */
  detail: Schema.optionalKey(Schema.String),
  channel: ImChannelStatus,
});
export type ImTestChannelResult = typeof ImTestChannelResult.Type;
