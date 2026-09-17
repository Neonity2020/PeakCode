import type { ImChannelStatus, ImQqChannelSettings } from "@peakcode/contracts";

import { errorMessageOf, splitTextOnNewlines, type ImInboundMessage } from "./types.ts";

/**
 * QQ official bot (WebSocket long connection, no public address needed).
 *
 * Platform setup (q.qq.com): create a bot app, copy its AppID/AppSecret, enable
 * "消息列表" for private messages and group @-mentions, and publish to leave the sandbox.
 *
 * Protocol notes: the token is minted at bots.qq.com (2h, refreshed 5 min early), the
 * gateway address comes from `/gateway/bot`, and the auth header is `QQBot <token>` —
 * not `Bearer`.
 */

const QQ_TOKEN_URL = "https://bots.qq.com/app/getAppAccessToken";
const QQ_API = "https://api.sgroup.qq.com";
/** PUBLIC_MESSAGES: private messages plus group @-mentions. */
const INTENTS = 1 << 25;
const MESSAGE_LIMIT = 4_500;
const RECONNECT_DELAYS_MS = [2_000, 5_000, 10_000, 20_000, 30_000, 60_000];

const OP_DISPATCH = 0;
const OP_HEARTBEAT = 1;
const OP_IDENTIFY = 2;
const OP_RESUME = 6;
const OP_RECONNECT = 7;
const OP_INVALID_SESSION = 9;
const OP_HELLO = 10;

interface QqDispatchPayload {
  readonly op?: number;
  readonly s?: number | null;
  readonly t?: string;
  readonly d?: {
    readonly id?: string;
    readonly content?: string;
    readonly group_openid?: string;
    readonly author?: {
      readonly user_openid?: string;
      readonly id?: string;
      readonly username?: string;
    };
    readonly user?: { readonly username?: string };
    readonly session_id?: string;
    readonly heartbeat_interval?: number;
  };
}

export interface QqAdapterOptions {
  readonly getSettings: () => ImQqChannelSettings;
  readonly onMessage: (message: ImInboundMessage) => Promise<void>;
  readonly log?: (level: "info" | "warn" | "error", text: string) => void;
}

export interface QqAdapter {
  readonly start: (force?: boolean) => Promise<ImChannelStatus>;
  readonly stop: () => Promise<void>;
  readonly status: () => ImChannelStatus;
  /** Mint a token on demand — the connectivity check behind "测试并连接". */
  readonly probe: () => Promise<void>;
}

/** Strip the `<@!123>` mention markers QQ puts in front of group messages. */
export function stripQqMention(text: string): string {
  return String(text ?? "")
    .replace(/<@!?\d+>/g, "")
    .trim();
}

export function createQqAdapter(options: QqAdapterOptions): QqAdapter {
  const log = options.log ?? (() => {});
  let socket: WebSocket | null = null;
  let token: { value: string; expireAt: number; forApp: string } | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let attempts = 0;
  let lastSeq: number | null = null;
  let sessionId = "";
  let state: ImChannelStatus["state"] = "off";
  let lastError = "";
  let closedByUs = false;
  /** Passive replies allow a few messages per incoming id; the seq must increment. */
  const replySeq = new Map<string, number>();
  const seen = new Set<string>();

  const isConfigured = () => {
    const settings = options.getSettings();
    return Boolean(settings.appId && settings.appSecret);
  };

  const getToken = async (fresh = false): Promise<string> => {
    const { appId, appSecret } = options.getSettings();
    if (!appId || !appSecret) throw new Error("未配置 QQ AppID / AppSecret");
    if (!fresh && token && token.forApp === appId && Date.now() < token.expireAt)
      return token.value;
    const response = await fetch(QQ_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appId: String(appId), clientSecret: String(appSecret) }),
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await response.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number | string;
      message?: string;
      msg?: string;
    };
    if (!data.access_token) {
      throw new Error(
        `获取 QQ token 失败：${data.message ?? data.msg ?? JSON.stringify(data).slice(0, 200)}`,
      );
    }
    token = {
      value: data.access_token,
      expireAt: Date.now() + (Math.max(60, Number(data.expires_in) || 7_200) - 300) * 1000,
      forApp: appId,
    };
    return token.value;
  };

  const api = async (method: "GET" | "POST", path: string, body?: unknown) => {
    const bearer = await getToken();
    const response = await fetch(`${QQ_API}${path}`, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `QQBot ${bearer}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await response.text();
    let data: { code?: number; message?: string; url?: string } = {};
    try {
      data = text ? (JSON.parse(text) as typeof data) : {};
    } catch {
      data = { message: text };
    }
    if (!response.ok || (data.code && data.code !== 0)) {
      throw new Error(
        `QQ 接口 ${path} 失败 ${response.status}：${data.message ?? text.slice(0, 200)}`,
      );
    }
    return data;
  };

  /**
   * Answer a message. Passive replies (which carry the message id) do not consume the
   * bot's active-push quota, but their window is 5 minutes / 5 messages — an agent turn
   * can outlive that, so a refused passive reply falls back to an active one instead of
   * dropping the answer.
   */
  const send = async (
    chatType: "c2c" | "group",
    openid: string,
    text: string,
    messageId?: string,
  ) => {
    const endpoint =
      chatType === "c2c" ? `/v2/users/${openid}/messages` : `/v2/groups/${openid}/messages`;
    for (const part of splitTextOnNewlines(text, MESSAGE_LIMIT)) {
      const body: Record<string, unknown> = { content: part, msg_type: 0 };
      if (messageId) {
        const next = (replySeq.get(messageId) ?? 0) + 1;
        replySeq.set(messageId, next);
        body.msg_id = messageId;
        body.msg_seq = next;
      }
      try {
        await api("POST", endpoint, body);
      } catch (error) {
        if (!messageId) throw error;
        log("warn", `被动回复失败（${errorMessageOf(error).slice(0, 120)}），改用主动消息`);
        await api("POST", endpoint, { content: part, msg_type: 0 });
      }
    }
  };

  const handleDispatch = async (payload: QqDispatchPayload) => {
    const type = payload.t;
    const data = payload.d;
    if (!data) return;
    if (type !== "C2C_MESSAGE_CREATE" && type !== "GROUP_AT_MESSAGE_CREATE") return;
    const messageId = data.id;
    if (!messageId || seen.has(messageId)) return;
    seen.add(messageId);
    if (seen.size > 2_000) seen.clear();

    const text = stripQqMention(data.content ?? "");
    if (!text) return;
    const isDirect = type === "C2C_MESSAGE_CREATE";
    const openid = isDirect ? (data.author?.user_openid ?? data.author?.id) : data.group_openid;
    if (!openid) return;
    const senderName = (data.author?.username ?? "").trim() || "QQ 用户";
    const chatType = isDirect ? "c2c" : "group";

    await options.onMessage({
      channel: "qq",
      peerId: openid,
      peerScope: chatType,
      peerLabel: isDirect ? senderName : "QQ 群",
      text,
      reply: { reply: (answer) => send(chatType, openid, answer, messageId) },
    });
  };

  const stopHeartbeat = () => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  };

  const scheduleReconnect = () => {
    if (closedByUs || reconnectTimer) return;
    const delay = RECONNECT_DELAYS_MS[Math.min(attempts, RECONNECT_DELAYS_MS.length - 1)]!;
    attempts += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect().catch((error) => {
        lastError = errorMessageOf(error);
        log("warn", `重连失败：${lastError}`);
        scheduleReconnect();
      });
    }, delay);
  };

  const connect = async () => {
    closedByUs = false;
    state = "connecting";
    const freshToken = await getToken(true);
    const gateway = await api("GET", "/gateway/bot");
    if (!gateway.url) throw new Error("未取到 QQ 网关地址");

    const sock = new WebSocket(gateway.url);
    socket = sock;

    sock.addEventListener("open", () => log("info", "WebSocket 已连接，等待鉴权"));
    sock.addEventListener("error", () => {
      lastError = "WebSocket 错误";
    });
    sock.addEventListener("close", () => {
      stopHeartbeat();
      if (socket === sock) {
        socket = null;
        state = closedByUs ? "off" : "connecting";
        if (!closedByUs) scheduleReconnect();
      }
    });
    sock.addEventListener("message", (event: MessageEvent) => {
      void (async () => {
        let payload: QqDispatchPayload;
        try {
          payload = JSON.parse(
            typeof event.data === "string" ? event.data : String(event.data),
          ) as QqDispatchPayload;
        } catch {
          return;
        }
        if (payload.s !== null && payload.s !== undefined) lastSeq = payload.s;

        if (payload.op === OP_HELLO) {
          const interval = payload.d?.heartbeat_interval ?? 41_250;
          stopHeartbeat();
          heartbeatTimer = setInterval(() => {
            try {
              sock.send(JSON.stringify({ op: OP_HEARTBEAT, d: lastSeq }));
            } catch {
              // The socket is going away; 'close' drives the reconnect.
            }
          }, interval);
          const auth = `QQBot ${freshToken}`;
          sock.send(
            JSON.stringify(
              sessionId
                ? { op: OP_RESUME, d: { token: auth, session_id: sessionId, seq: lastSeq } }
                : { op: OP_IDENTIFY, d: { token: auth, intents: INTENTS, shard: [0, 1] } },
            ),
          );
          return;
        }
        if (payload.op === OP_DISPATCH) {
          if (payload.t === "READY") {
            sessionId = payload.d?.session_id ?? "";
            state = "connected";
            attempts = 0;
            lastError = "";
            log("info", `已就绪：${payload.d?.user?.username ?? "机器人"}`);
            return;
          }
          if (payload.t === "RESUMED") {
            state = "connected";
            attempts = 0;
            return;
          }
          try {
            await handleDispatch(payload);
          } catch (error) {
            log("error", `处理消息出错：${errorMessageOf(error)}`);
          }
          return;
        }
        if (payload.op === OP_RECONNECT || payload.op === OP_INVALID_SESSION) {
          if (payload.op === OP_INVALID_SESSION) sessionId = "";
          socket?.close();
        }
      })();
    });
  };

  const status = (): ImChannelStatus => ({
    id: "qq",
    configured: isConfigured(),
    state,
    ...(lastError ? { error: lastError } : {}),
  });

  const start = async (force = false): Promise<ImChannelStatus> => {
    if (!isConfigured()) {
      state = "off";
      lastError = "未配置 AppID / AppSecret";
      return status();
    }
    if (!force && socket && state !== "failed") return status();
    await stop();
    attempts = 0;
    sessionId = "";
    try {
      await connect();
    } catch (error) {
      state = "failed";
      lastError = errorMessageOf(error);
    }
    return status();
  };

  const stop = async () => {
    closedByUs = true;
    stopHeartbeat();
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    if (socket) {
      try {
        socket.close();
      } catch {
        // Already gone.
      }
      socket = null;
    }
    state = "off";
  };

  return { start, stop, status, probe: async () => void (await getToken(true)) };
}
