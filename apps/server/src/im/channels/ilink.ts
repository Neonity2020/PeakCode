import { randomBytes } from "node:crypto";

import type { ImChannelStatus, ImWechatChannelSettings } from "@peakcode/contracts";

import { errorMessageOf, offStatus, splitTextOnNewlines, type ImInboundMessage } from "./types.ts";

/**
 * Personal-WeChat bridge (ilinkai.weixin.qq.com).
 *
 * Unlike the WeCom / official-account channels this one needs no public address: the
 * agent dials out and long-polls for messages. Logging in is a three-step handshake —
 * fetch a QR code, poll until the phone confirms, then keep polling `getupdates` with a
 * persisted cursor. The token that comes back from the handshake is the long-lived
 * credential, and answers must carry the sender's `context_token` (learned from their
 * last message) or WeChat refuses to deliver them.
 */

export const DEFAULT_ILINK_BASE_URL = "https://ilinkai.weixin.qq.com";
const QR_BOT_TYPE = "3";

const MESSAGE_TYPE_BOT = 2;
const ITEM_TEXT = 1;
const ITEM_IMAGE = 2;
const ITEM_VOICE = 3;
const ITEM_FILE = 4;
const ITEM_VIDEO = 5;
const MESSAGE_STATE_FINISH = 2;

/** The session died; only a fresh QR scan can bring the channel back. */
const ERRCODE_SESSION_EXPIRED = -14;

/** The first poll is short so the UI can leave "connecting" within seconds. */
const FIRST_POLL_MS = 5_000;
/** How many failures in a row before the channel admits it is broken. */
const MAX_CONSECUTIVE_FAILURES = 3;
const DEFAULT_LONGPOLL_MS = 35_000;
const LONGPOLL_EXTRA_MS = 5_000;
const RECONNECT_MIN_MS = 3_000;
const RECONNECT_MAX_MS = 60_000;
const SEND_LIMIT = 2_000;

export interface IlinkQrCode {
  readonly qrcode: string;
  /** The WeChat deep link; it has to be rendered as an image before anyone can scan it. */
  readonly deepLink: string;
}

export interface IlinkQrPollResult {
  readonly status: "wait" | "scanned" | "confirmed" | "expired";
  readonly botToken?: string;
  readonly botId?: string;
  readonly baseUrl?: string;
}

interface IlinkMessageItem {
  readonly type?: number;
  readonly text_item?: { readonly text?: string };
  readonly voice_item?: { readonly text?: string };
  readonly file_item?: { readonly file_name?: string };
}

interface IlinkMessage {
  readonly message_id?: string | number;
  readonly seq?: number;
  readonly from_user_id?: string;
  readonly message_type?: number;
  readonly context_token?: string;
  readonly create_time_ms?: number;
  readonly client_id?: string;
  readonly item_list?: ReadonlyArray<IlinkMessageItem>;
}

/** Version stamp the iLink endpoints expect on every call. */
const ilinkBaseInfo = () => ({ channel_version: "0.1.0" });

/**
 * Whether a poll that produced no response still proves the channel works.
 *
 * A long poll that lives out its window is the *healthy* case: it proves TCP/TLS and the
 * bot token are fine and simply had nothing to deliver. Only a request that dies early is
 * a real failure — which is what lets the UI say "connected" without waiting for someone
 * to send a message first.
 */
export function isHealthyLongPollExit(input: {
  readonly timedOut: boolean;
  readonly elapsedMs: number;
  readonly windowMs: number;
}): boolean {
  if (input.timedOut) return true;
  const floor = Math.max(input.windowMs * 0.5, 3_000);
  return input.elapsedMs >= floor;
}

/** `X-WECHAT-UIN`: a random uint32 rendered as a string and then base64-encoded. */
function randomUin(): string {
  return Buffer.from(String(randomBytes(4).readUInt32BE(0)), "utf8").toString("base64");
}

/** The text of a message, with voice transcription when available and placeholders otherwise. */
export function extractIlinkText(items: ReadonlyArray<IlinkMessageItem> | undefined): string {
  const parts: Array<string> = [];
  for (const item of items ?? []) {
    if (item.type === ITEM_TEXT && item.text_item?.text) parts.push(item.text_item.text);
    else if (item.type === ITEM_VOICE)
      parts.push(item.voice_item?.text ? item.voice_item.text : "（语音，未转写）");
    else if (item.type === ITEM_IMAGE) parts.push("（图片，暂不支持下载）");
    else if (item.type === ITEM_FILE)
      parts.push(`（文件：${item.file_item?.file_name ?? "未命名"}，暂不支持下载）`);
    else if (item.type === ITEM_VIDEO) parts.push("（视频，暂不支持下载）");
  }
  return parts.join("\n").trim();
}

/** De-duplication key: message ids when present, otherwise the sender's seq/time pair. */
export function ilinkDedupKey(message: IlinkMessage): string {
  if (message.message_id !== undefined) return `mid:${message.message_id}`;
  if (message.seq !== undefined) return `seq:${message.seq}`;
  return `fb:${message.from_user_id}:${message.create_time_ms}:${message.client_id}`;
}

/** Step one: ask for a scannable code. Needs no credentials. */
export async function fetchIlinkQrCode(baseUrl: string): Promise<IlinkQrCode> {
  const url = `${baseUrl || DEFAULT_ILINK_BASE_URL}/ilink/bot/get_bot_qrcode?bot_type=${QR_BOT_TYPE}`;
  const response = await fetch(url, { method: "POST", signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`取二维码失败：HTTP ${response.status}`);
  const data = (await response.json()) as { qrcode?: string; qrcode_img_content?: string };
  if (!data.qrcode) throw new Error(`取二维码失败：${JSON.stringify(data).slice(0, 200)}`);
  return { qrcode: data.qrcode, deepLink: data.qrcode_img_content ?? "" };
}

/**
 * Step two: poll until the phone scans. The server side long-polls (~35s), so a timeout
 * means "still waiting", not an error — the caller simply asks again.
 */
export async function pollIlinkQrStatus(
  qrcode: string,
  baseUrl: string,
): Promise<IlinkQrPollResult> {
  let data: {
    status?: string;
    bot_token?: string;
    ilink_bot_id?: string | number;
    baseurl?: string;
  };
  try {
    const response = await fetch(
      `${baseUrl || DEFAULT_ILINK_BASE_URL}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`,
      { headers: { "iLink-App-ClientVersion": "1" }, signal: AbortSignal.timeout(35_000) },
    );
    if (!response.ok) throw new Error(`轮询失败：HTTP ${response.status}`);
    data = (await response.json()) as typeof data;
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      return { status: "wait" };
    }
    throw error;
  }

  if (data.status === "confirmed" && data.bot_token && data.ilink_bot_id !== undefined) {
    return {
      status: "confirmed",
      botToken: data.bot_token,
      botId: String(data.ilink_bot_id).replace(/[^a-zA-Z0-9@._-]/g, ""),
      baseUrl: data.baseurl ?? "",
    };
  }
  const status = data.status;
  return {
    status: status === "scanned" || status === "expired" ? status : "wait",
  };
}

export interface IlinkConnectionOptions {
  readonly getSettings: () => ImWechatChannelSettings;
  /** The cursor moved; the caller persists it so a restart does not replay messages. */
  readonly onCursor: (cursor: string) => void;
  readonly onMessage: (message: ImInboundMessage) => Promise<void>;
  readonly log?: (level: "info" | "warn" | "error", text: string) => void;
}

interface IlinkConnection {
  readonly start: (force?: boolean) => Promise<ImChannelStatus>;
  readonly stop: () => Promise<void>;
  readonly status: () => ImChannelStatus;
}

/** The long-polling connection the personal-WeChat channel runs on. */
export function createIlinkConnection(options: IlinkConnectionOptions): IlinkConnection {
  const log = options.log ?? (() => {});
  const uin = randomUin();

  let stopping = false;
  let state: ImChannelStatus["state"] = "off";
  let lastError = "";
  let cursor = "";
  let longPollMs = DEFAULT_LONGPOLL_MS;
  let cancelSleep: (() => void) | null = null;
  let loopRunning = false;

  /** sender -> the context token their last message carried (required to answer). */
  const contextTokens = new Map<string, string>();
  const seen = new Map<string, number>();

  const markSeen = (key: string) => {
    const now = Date.now();
    if (seen.size > 1_000) {
      for (const [entry, at] of seen) if (now - at > 30 * 60 * 1000) seen.delete(entry);
    }
    seen.set(key, now);
  };

  const headers = () => ({
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    Authorization: `Bearer ${options.getSettings().botToken}`,
    "X-WECHAT-UIN": uin,
  });

  const apiPost = async (endpoint: string, body: unknown, timeoutMs?: number) => {
    const base = options.getSettings().baseUrl || DEFAULT_ILINK_BASE_URL;
    const response = await fetch(`${base.replace(/\/$/, "")}/${endpoint}`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
      ...(timeoutMs === undefined ? {} : { signal: AbortSignal.timeout(timeoutMs) }),
    });
    const text = await response.text();
    try {
      return JSON.parse(text) as {
        ret?: number;
        errcode?: number;
        errmsg?: string;
        longpolling_timeout_ms?: number;
        get_updates_buf?: string;
        msgs?: ReadonlyArray<IlinkMessage>;
      };
    } catch {
      throw new Error(`${endpoint} 返回的不是 JSON：${text.slice(0, 200)}`);
    }
  };

  const sendOnce = async (userId: string, contextToken: string, text: string) => {
    const result = await apiPost(
      "ilink/bot/sendmessage",
      {
        msg: {
          to_user_id: userId,
          context_token: contextToken,
          item_list: [{ type: ITEM_TEXT, text_item: { text } }],
          message_type: MESSAGE_TYPE_BOT,
          message_state: MESSAGE_STATE_FINISH,
          client_id: String(randomBytes(4).readUInt32BE(0)),
        },
        base_info: ilinkBaseInfo(),
      },
      20_000,
    );
    if (result.ret !== undefined && result.ret !== 0) {
      throw new Error(
        `发送失败 ret=${result.ret} errcode=${result.errcode ?? ""} ${result.errmsg ?? ""}`,
      );
    }
  };

  /** Answer a user; only possible once they have written to the bot at least once. */
  const send = async (userId: string, text: string) => {
    const contextToken = contextTokens.get(userId);
    if (!contextToken) throw new Error("没有该用户的 context_token（需对方先发一条消息）");
    for (const chunk of splitTextOnNewlines(text, SEND_LIMIT)) {
      await sendOnce(userId, contextToken, chunk);
    }
  };

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      cancelSleep = () => {
        clearTimeout(timer);
        resolve();
      };
    });

  const handleMessage = async (message: IlinkMessage) => {
    if (message.message_type === MESSAGE_TYPE_BOT) return;
    const userId = message.from_user_id;
    if (!userId) return;
    const key = ilinkDedupKey(message);
    if (seen.has(key)) return;
    markSeen(key);
    if (message.context_token) contextTokens.set(userId, message.context_token);
    const text = extractIlinkText(message.item_list);
    if (!text) return;
    await options.onMessage({
      channel: "wechat",
      peerId: userId,
      peerScope: "",
      peerLabel: userId,
      text,
      reply: { reply: (answer) => send(userId, answer) },
    });
  };

  const pollLoop = async () => {
    let backoff = RECONNECT_MIN_MS;
    let consecutiveFailures = 0;
    // The first poll asks for a short answer: a quiet account would otherwise keep the UI
    // on "connecting" for the whole long-poll window before anything is known.
    let firstPoll = true;
    const markHealthy = () => {
      state = "connected";
      lastError = "";
      consecutiveFailures = 0;
      backoff = RECONNECT_MIN_MS;
    };
    // The stop flag is flipped by `stop()` on another task, so it is checked at the top of
    // each pass rather than as a loop condition.
    for (;;) {
      if (stopping) break;
      const startedAt = Date.now();
      const windowMs = firstPoll
        ? Math.min(FIRST_POLL_MS, longPollMs + LONGPOLL_EXTRA_MS)
        : longPollMs + LONGPOLL_EXTRA_MS;
      firstPoll = false;
      try {
        const result = await apiPost(
          "ilink/bot/getupdates",
          { get_updates_buf: cursor, base_info: ilinkBaseInfo() },
          windowMs,
        );

        if (result.longpolling_timeout_ms) longPollMs = result.longpolling_timeout_ms;

        if (result.ret === ERRCODE_SESSION_EXPIRED) {
          state = "failed";
          lastError = "微信登录态已失效（-14），需要重新扫码";
          log("warn", lastError);
          break;
        }
        if (result.ret !== undefined && result.ret !== 0) {
          consecutiveFailures += 1;
          lastError = `getupdates ret=${result.ret}（已连续失败 ${consecutiveFailures} 次）`;
          // A wrong token or a suspended account keeps answering with the same ret;
          // saying "connecting" forever would hide that, so the channel admits it is broken.
          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            state = "failed";
            log("warn", lastError);
            break;
          }
          log("warn", lastError);
          await sleep(backoff);
          backoff = Math.min(backoff * 2, RECONNECT_MAX_MS);
          continue;
        }

        markHealthy();

        if (result.get_updates_buf && result.get_updates_buf !== cursor) {
          cursor = result.get_updates_buf;
          try {
            options.onCursor(cursor);
          } catch {
            // A failed cursor write costs a replay; it must not stop message intake.
          }
        }
        for (const message of result.msgs ?? []) {
          try {
            await handleMessage(message);
          } catch (error) {
            log("error", `处理消息出错: ${errorMessageOf(error)}`);
          }
        }
      } catch (error) {
        if (stopping) break;
        // A long poll ends in two shapes: our own timeout, or the server closing the
        // connection (which surfaces as a generic fetch failure). How long the request
        // lived is the only reliable discriminator.
        const elapsed = Date.now() - startedAt;
        const timedOut =
          error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
        if (isHealthyLongPollExit({ timedOut, elapsedMs: elapsed, windowMs })) {
          markHealthy();
          continue;
        }

        consecutiveFailures += 1;
        lastError = `轮询出错（${elapsed}ms）: ${errorMessageOf(error)}（已连续失败 ${consecutiveFailures} 次）`;
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          state = "failed";
          log("error", lastError);
          break;
        }
        log("error", lastError);
        await sleep(backoff);
        backoff = Math.min(backoff * 2, RECONNECT_MAX_MS);
      }
    }
    loopRunning = false;
    if (state !== "failed") state = "off";
  };

  const status = (): ImChannelStatus => {
    const settings = options.getSettings();
    return {
      id: "wechat",
      configured: Boolean(settings.botToken && settings.botId),
      state,
      ...(settings.botId ? { detail: settings.botId } : {}),
      ...(lastError ? { error: lastError } : {}),
    };
  };

  const start = async (force = false): Promise<ImChannelStatus> => {
    const settings = options.getSettings();
    if (!settings.botToken || !settings.botId) {
      state = "off";
      return status();
    }
    if (loopRunning && !force) return status();
    if (loopRunning) await stop();

    stopping = false;
    seen.clear();
    contextTokens.clear();
    cursor = settings.cursor;
    state = "connecting";
    lastError = "";
    loopRunning = true;
    pollLoop().catch((error) => {
      loopRunning = false;
      state = "failed";
      lastError = errorMessageOf(error);
      log("error", `轮询循环退出: ${lastError}`);
    });
    return status();
  };

  const stop = async (): Promise<void> => {
    stopping = true;
    if (cancelSleep) {
      cancelSleep();
      cancelSleep = null;
    }
    loopRunning = false;
    state = "off";
    contextTokens.clear();
    seen.clear();
  };

  return { start, stop, status };
}

/** Status helper for the "nothing configured yet" case the settings screen shows. */
export const ilinkOffStatus = (): ImChannelStatus => offStatus("wechat");
