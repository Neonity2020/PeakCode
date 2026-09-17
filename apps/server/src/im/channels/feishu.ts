import type { ImChannelStatus, ImFeishuChannelSettings } from "@peakcode/contracts";

import type { ImInboundMessage } from "./types.ts";
import { errorMessageOf, splitTextOnNewlines } from "./types.ts";

/**
 * Feishu / Lark bot (long connection, no public address needed).
 *
 * Setup on the open platform: create a custom app, add the bot capability, grant
 * `im:message` + `im:message:send_as_bot`, subscribe to `im.message.receive_v1` over the
 * *long connection*, and publish a version so the scopes take effect. The same code
 * drives both domains — Feishu (open.feishu.cn) for China and Lark (open.larksuite.com)
 * internationally — so the settings screen asks which one an app belongs to.
 *
 * Answers go out as interactive cards: plain text messages do not render Markdown, and
 * an agent's answer is usually structured. A card the API rejects falls back to text so
 * the reply is never lost.
 */

const API_HOSTS = {
  feishu: "https://open.feishu.cn",
  lark: "https://open.larksuite.com",
} as const;

const TOKEN_TTL_SKEW_MS = 5 * 60 * 1000;
const MESSAGE_LIMIT = 3_500;

type FeishuDomain = keyof typeof API_HOSTS;

interface FeishuMessageEvent {
  readonly message_id?: string;
  readonly chat_id?: string;
  readonly message_type?: string;
  readonly content?: string;
}

export interface FeishuBotInfo {
  readonly name: string;
}

export interface FeishuAdapterOptions {
  readonly getSettings: () => ImFeishuChannelSettings;
  readonly onMessage: (message: ImInboundMessage) => Promise<void>;
  readonly log?: (level: "info" | "warn" | "error", text: string) => void;
}

export interface FeishuAdapter {
  readonly start: (force?: boolean) => Promise<ImChannelStatus>;
  readonly stop: () => Promise<void>;
  readonly status: () => ImChannelStatus;
  /** Validate the credentials and return the bot's own name. */
  readonly probe: () => Promise<FeishuBotInfo>;
}

const hostFor = (domain: FeishuDomain): string => API_HOSTS[domain] ?? API_HOSTS.feishu;

/** First non-empty line with Markdown furniture stripped, used as the card summary. */
export function feishuCardSummary(text: string): string | undefined {
  return text
    .split("\n")
    .map((line) => line.replace(/[#*`|>-]/g, "").trim())
    .find(Boolean);
}

/** The interactive card an answer is delivered in. */
export function buildFeishuAnswerCard(text: string): Record<string, unknown> {
  const summary = feishuCardSummary(text);
  return {
    schema: "2.0",
    config: {
      update_multi: true,
      enable_forward: true,
      width_mode: "fill",
      ...(summary ? { summary: { content: summary.slice(0, 40) } } : {}),
    },
    body: {
      direction: "vertical",
      vertical_spacing: "medium",
      elements: [{ tag: "markdown", content: text }],
    },
  };
}

/** Text of a Feishu message event, with the bot mention placeholders removed. */
export function feishuMessageText(message: FeishuMessageEvent): string {
  if (message.message_type !== "text") return "";
  try {
    const parsed = JSON.parse(message.content ?? "{}") as { text?: string };
    return (parsed.text ?? "").replace(/@_user_\d+/g, "").trim();
  } catch {
    return "";
  }
}

export function createFeishuAdapter(options: FeishuAdapterOptions): FeishuAdapter {
  const log = options.log ?? (() => {});
  type LarkSdk = typeof import("@larksuiteoapi/node-sdk");
  let client: InstanceType<LarkSdk["WSClient"]> | null = null;
  let startedWith = "";
  let state: ImChannelStatus["state"] = "off";
  let lastError = "";
  let botName = "";
  let token: { value: string; expireAt: number; forApp: string; domain: FeishuDomain } | null =
    null;
  /** Feishu retries deliveries, so the same message id must not start a second turn. */
  const handled = new Set<string>();

  const isConfigured = () => {
    const settings = options.getSettings();
    return Boolean(settings.appId && settings.appSecret);
  };

  const currentDomain = (): FeishuDomain =>
    options.getSettings().domain === "lark" ? "lark" : "feishu";

  const getToken = async (fresh = false): Promise<string> => {
    const { appId, appSecret } = options.getSettings();
    const domain = currentDomain();
    if (!appId || !appSecret) throw new Error("未配置飞书 App ID / App Secret");
    if (
      !fresh &&
      token &&
      token.forApp === appId &&
      token.domain === domain &&
      Date.now() < token.expireAt
    ) {
      return token.value;
    }
    const response = await fetch(
      `${hostFor(domain)}/open-apis/auth/v3/tenant_access_token/internal`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    const data = (await response.json()) as {
      code?: number;
      msg?: string;
      tenant_access_token?: string;
      expire?: number;
    };
    if (data.code !== 0 || !data.tenant_access_token) {
      throw new Error(`获取飞书 token 失败: ${data.msg ?? ""}（code ${data.code ?? "?"}）`);
    }
    token = {
      value: data.tenant_access_token,
      expireAt: Date.now() + Math.max(60, data.expire ?? 7200) * 1000 - TOKEN_TTL_SKEW_MS,
      forApp: appId,
      domain,
    };
    return token.value;
  };

  const sendMessage = async (
    chatId: string,
    msgType: string,
    content: Record<string, unknown>,
    accessToken?: string,
  ) => {
    const bearer = accessToken ?? (await getToken());
    const response = await fetch(
      `${hostFor(currentDomain())}/open-apis/im/v1/messages?receive_id_type=chat_id`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearer}` },
        body: JSON.stringify({
          receive_id: chatId,
          msg_type: msgType,
          content: JSON.stringify(content),
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    return (await response.json()) as {
      code?: number;
      msg?: string;
      data?: { message_id?: string };
    };
  };

  const reply = async (chatId: string, text: string) => {
    for (const chunk of splitTextOnNewlines(text, MESSAGE_LIMIT)) {
      const card = await sendMessage(chatId, "interactive", buildFeishuAnswerCard(chunk));
      if (card.code !== 0) {
        // Cards are sometimes refused for individual Markdown constructs; the answer
        // still has to arrive, so it goes out as plain text instead.
        log("warn", `卡片发送失败(code ${card.code ?? "?"}: ${card.msg ?? ""})，降级纯文本`);
        const plain = await sendMessage(chatId, "text", { text: chunk });
        if (plain.code !== 0) {
          throw new Error(`飞书发送失败 code ${plain.code ?? "?"}: ${plain.msg ?? ""}`);
        }
      }
    }
  };

  const ack = async (chatId: string, queued: boolean): Promise<string | null> => {
    const text = queued ? "⏳ 收到，前面还有任务在跑，排队中…" : "⏳ 收到，正在做了…";
    const result = await sendMessage(chatId, "text", { text });
    return result.code === 0 ? (result.data?.message_id ?? null) : null;
  };

  const recallAck = async (messageId: string) => {
    try {
      const bearer = await getToken();
      await fetch(`${hostFor(currentDomain())}/open-apis/im/v1/messages/${messageId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${bearer}` },
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      log("warn", `撤回状态消息失败: ${errorMessageOf(error)}`);
    }
  };

  const handleEventMessage = async (message: FeishuMessageEvent) => {
    const messageId = message.message_id;
    const chatId = message.chat_id;
    if (!chatId) return;
    if (messageId) {
      if (handled.has(messageId)) return;
      handled.add(messageId);
      if (handled.size > 2_000) handled.clear();
    }
    const text = feishuMessageText(message);
    if (!text) {
      // Anything else (image/file/audio) is not consumed yet; say so instead of
      // silently dropping it, because the sender is waiting for a reaction.
      if (message.message_type && message.message_type !== "text") {
        await reply(chatId, "（暂不支持图片/文件消息，请用文字描述你要做的事。）");
      }
      return;
    }

    await options.onMessage({
      channel: "feishu",
      peerId: chatId,
      peerScope: "",
      peerLabel: chatId,
      text,
      reply: {
        reply: (answer) => reply(chatId, answer),
        ack: (queued) => ack(chatId, queued),
        recallAck,
      },
    });
  };

  /** Live state straight from the SDK, so a dropped socket is not reported as up. */
  const connectionState = (): ImChannelStatus["state"] => {
    if (!client) return state;
    try {
      const raw = client.getConnectionStatus().state;
      if (raw === "connected") return "connected";
      if (raw === "failed") return "failed";
      return "connecting";
    } catch {
      return state;
    }
  };

  const status = (): ImChannelStatus => ({
    id: "feishu",
    configured: isConfigured(),
    state: connectionState(),
    ...(botName ? { detail: botName } : {}),
    ...(lastError ? { error: lastError } : {}),
  });

  const probe = async (): Promise<FeishuBotInfo> => {
    const accessToken = await getToken(true);
    try {
      const response = await fetch(`${hostFor(currentDomain())}/open-apis/bot/v3/info`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(15_000),
      });
      const data = (await response.json()) as { bot?: { app_name?: string } };
      return { name: data.bot?.app_name ?? "" };
    } catch {
      return { name: "" };
    }
  };

  const stop = async () => {
    if (client) {
      try {
        client.close();
      } catch {
        // Closing a socket that already died is not an error worth reporting.
      }
    }
    client = null;
    startedWith = "";
    state = "off";
  };

  const start = async (force = false): Promise<ImChannelStatus> => {
    const settings = options.getSettings();
    if (!settings.appId || !settings.appSecret) {
      state = "off";
      lastError = "未配置 App ID / App Secret";
      return status();
    }
    const identity = `${settings.domain}:${settings.appId}:${settings.appSecret}`;
    if (!force && client && startedWith === identity) return status();
    if (client) await stop();

    // Validate before dialling: bad credentials belong in the settings screen, not in a
    // silent reconnect loop inside the SDK.
    try {
      await getToken(true);
    } catch (error) {
      state = "failed";
      lastError = errorMessageOf(error);
      return status();
    }

    state = "connecting";
    lastError = "";
    try {
      const lark = await import("@larksuiteoapi/node-sdk");
      const wsClient = new lark.WSClient({
        appId: settings.appId,
        appSecret: settings.appSecret,
        domain: hostFor(currentDomain()),
        loggerLevel: lark.LoggerLevel.error,
        onError: (error) => {
          lastError = errorMessageOf(error);
          state = "failed";
          log("error", `长连接错误: ${lastError}`);
        },
        onReconnecting: () => {
          state = "connecting";
          log("warn", "飞书长连接断开，正在重连");
        },
        onReconnected: () => {
          state = "connected";
          lastError = "";
        },
      });
      const eventDispatcher = new lark.EventDispatcher({ loggerLevel: lark.LoggerLevel.error });
      eventDispatcher.register({
        "im.message.receive_v1": async (data) => {
          try {
            // The dispatcher hands over the whole payload; only the message matters here.
            const message = (data as { message?: FeishuMessageEvent }).message;
            if (message) await handleEventMessage(message);
          } catch (error) {
            log("error", `处理消息出错: ${errorMessageOf(error)}`);
          }
        },
      });
      await wsClient.start({ eventDispatcher });
      client = wsClient;
      startedWith = identity;
      state = "connected";
      botName = (await probe()).name;
      log("info", "飞书长连接已启动");
    } catch (error) {
      state = "failed";
      lastError = errorMessageOf(error);
      log("error", `长连接启动失败: ${lastError}`);
    }
    return status();
  };

  return { start, stop, status, probe };
}
