import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import type {
  ImChannelStatus,
  ImWechatMpChannelSettings,
  ImWecomChannelSettings,
} from "@peakcode/contracts";

import type { ImInboundMessage } from "./types.ts";

/**
 * WeChat callback channels: WeCom (企业微信) self-built apps and the official-account (公众号) channel.
 *
 * Unlike every other channel here these cannot dial out — Tencent only calls you, so the
 * server needs a public HTTPS address pointing at `/api/im/wecom/events` or
 * `/api/im/wechat-mp/events`. Both share Tencent's WXBizMsgCrypt scheme (AES-256-CBC with
 * PKCS#7 padding, signature = sha1 of the sorted token/timestamp/nonce/ciphertext).
 *
 * Answers are pushed through the send APIs rather than the callback's passive reply: an
 * agent turn takes minutes, and the callback has five seconds to answer.
 */

const TOKEN_TTL_SKEW_MS = 5 * 60 * 1000;

function aesKeyOf(encodingAesKey: string): Buffer {
  const key = Buffer.from(`${encodingAesKey ?? ""}=`, "base64");
  if (key.length !== 32) throw new Error("EncodingAESKey 不合法（应为 43 位字符）");
  return key;
}

function stripPkcs7(buffer: Buffer): Buffer {
  const pad = buffer[buffer.length - 1] ?? 0;
  if (pad < 1 || pad > 32) return buffer;
  return buffer.subarray(0, buffer.length - pad);
}

function padPkcs7(buffer: Buffer, blockSize = 32): Buffer {
  const pad = blockSize - (buffer.length % blockSize) || blockSize;
  return Buffer.concat([buffer, Buffer.alloc(pad, pad)]);
}

/** Signature of the sorted token/timestamp/nonce/ciphertext quadruple. */
export function msgSignature(
  token: string,
  timestamp: string,
  nonce: string,
  encrypt: string,
): string {
  return createHash("sha1")
    .update([String(token), String(timestamp), String(nonce), String(encrypt)].toSorted().join(""))
    .digest("hex");
}

/** Decrypt a Tencent payload: 16 random bytes, a uint32 length, the message, then the receive id. */
export function decryptMsg(
  encodingAESKey: string,
  encrypted: string,
): { msg: string; receiveId: string } {
  const key = aesKeyOf(encodingAESKey);
  const decipher = createDecipheriv("aes-256-cbc", key, key.subarray(0, 16));
  decipher.setAutoPadding(false);
  const raw = stripPkcs7(
    Buffer.concat([decipher.update(Buffer.from(encrypted, "base64")), decipher.final()]),
  );
  const length = raw.readUInt32BE(16);
  return {
    msg: raw.subarray(20, 20 + length).toString("utf8"),
    receiveId: raw.subarray(20 + length).toString("utf8"),
  };
}

/** Encrypt a passive reply (kept for completeness even though answers are pushed). */
export function encryptMsg(encodingAESKey: string, msg: string, receiveId: string): string {
  const key = aesKeyOf(encodingAESKey);
  const body = Buffer.from(msg, "utf8");
  const lengthBuffer = Buffer.alloc(4);
  lengthBuffer.writeUInt32BE(body.length, 0);
  const full = padPkcs7(
    Buffer.concat([randomBytes(16), lengthBuffer, body, Buffer.from(receiveId ?? "", "utf8")]),
  );
  const cipher = createCipheriv("aes-256-cbc", key, key.subarray(0, 16));
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(full), cipher.final()]).toString("base64");
}

/** Read one field out of Tencent's XML, CDATA or not. */
export function xmlField(xml: string, name: string): string {
  const match = String(xml ?? "").match(
    new RegExp(`<${name}>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))</${name}>`),
  );
  return match ? (match[1] ?? match[2] ?? "").trim() : "";
}

/** Split by UTF-8 byte length — the WeChat APIs limit bytes, and a Chinese character is three. */
export function splitBytes(text: string, maxBytes: number): ReadonlyArray<string> {
  const out: Array<string> = [];
  let current = "";
  let size = 0;
  for (const character of String(text ?? "")) {
    const bytes = Buffer.byteLength(character, "utf8");
    // A character wider than the limit still goes out on its own — but only after the
    // chunk in hand, so it never ships a leading empty message.
    if (size + bytes > maxBytes && current.length > 0) {
      out.push(current);
      current = "";
      size = 0;
    }
    current += character;
    size += bytes;
  }
  if (current) out.push(current);
  return out.length > 0 ? out : [""];
}

/** A parsed inbound callback. */
export interface WechatCallbackMessage {
  readonly fromUser: string;
  readonly msgType: string;
  readonly text: string;
  readonly msgId: string;
}

interface TokenCache {
  value: string;
  expireAt: number;
  key: string;
}

/** access_token cache shared by both callback channels. */
function makeTokenCache(
  fetchToken: () => Promise<{ token: string; expiresIn: number | undefined }>,
) {
  let cache: TokenCache = { value: "", expireAt: 0, key: "" };
  return async (key: string, fresh = false): Promise<string> => {
    if (!fresh && cache.value && cache.key === key && Date.now() < cache.expireAt)
      return cache.value;
    const { token, expiresIn } = await fetchToken();
    cache = {
      value: token,
      expireAt: Date.now() + Math.max(60, expiresIn ?? 7_200) * 1000 - TOKEN_TTL_SKEW_MS,
      key,
    };
    return token;
  };
}

export interface WecomAppChannel {
  readonly id: "wecom";
  readonly verifyUrl: (query: Record<string, string | undefined>) => string;
  readonly parseCallback: (
    query: Record<string, string | undefined>,
    rawBody: string,
  ) => WechatCallbackMessage;
  readonly push: (toUser: string, text: string) => Promise<void>;
  /** Mint an access token without sending anything — the connectivity check. */
  readonly probe: () => Promise<void>;
  readonly status: () => ImChannelStatus;
}

export function createWecomApp(options: {
  readonly getSettings: () => ImWecomChannelSettings;
  readonly log?: (level: "info" | "warn", text: string) => void;
}): WecomAppChannel {
  const getToken = makeTokenCache(async () => {
    const { corpId, secret } = options.getSettings();
    if (!corpId || !secret) throw new Error("未配置企业微信 CorpID / 应用 Secret");
    const response = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(corpId)}&corpsecret=${encodeURIComponent(secret)}`,
      { signal: AbortSignal.timeout(15_000) },
    );
    const data = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
      errcode?: number;
      errmsg?: string;
    };
    if (data.errcode || !data.access_token) {
      throw new Error(`企业微信 token 失败：${data.errmsg ?? ""}（${data.errcode ?? "?"}）`);
    }
    return { token: data.access_token, expiresIn: data.expires_in };
  });

  const push = async (toUser: string, text: string) => {
    const { corpId, secret, agentId } = options.getSettings();
    const bearer = await getToken(`${corpId}:${secret}`);
    for (const part of splitBytes(text, 3_800)) {
      const sendPayload = async (payload: unknown) => {
        const response = await fetch(
          `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${bearer}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(15_000),
          },
        );
        return (await response.json()) as { errcode?: number; errmsg?: string };
      };
      // WeCom renders markdown (headings, bold, links); a refused payload falls back to
      // plain text so the answer still arrives.
      let result = await sendPayload({
        touser: toUser,
        msgtype: "markdown",
        agentid: Number(agentId) || 0,
        markdown: { content: part },
      });
      if (result.errcode) {
        options.log?.("warn", `markdown 消息被拒（${result.errmsg ?? ""}），降级纯文本`);
        for (const fallback of splitBytes(part, 1_800)) {
          result = await sendPayload({
            touser: toUser,
            msgtype: "text",
            agentid: Number(agentId) || 0,
            text: { content: fallback },
          });
          if (result.errcode) {
            throw new Error(`企业微信发送失败：${result.errmsg ?? ""}（${result.errcode}）`);
          }
        }
      }
    }
  };

  const verifyUrl: WecomAppChannel["verifyUrl"] = (query) => {
    const { callbackToken, encodingAesKey } = options.getSettings();
    const { msg_signature: signature, timestamp, nonce, echostr } = query;
    if (msgSignature(callbackToken, timestamp ?? "", nonce ?? "", echostr ?? "") !== signature) {
      throw new Error("签名校验失败");
    }
    return decryptMsg(encodingAesKey, echostr ?? "").msg;
  };

  const parseCallback: WecomAppChannel["parseCallback"] = (query, rawBody) => {
    const { callbackToken, encodingAesKey } = options.getSettings();
    const encrypt = xmlField(rawBody, "Encrypt");
    if (!encrypt) throw new Error("回调体缺少 Encrypt（请把企业微信的加密方式设为安全模式）");
    if (
      msgSignature(callbackToken, query.timestamp ?? "", query.nonce ?? "", encrypt) !==
      query.msg_signature
    ) {
      throw new Error("签名校验失败");
    }
    const xml = decryptMsg(encodingAesKey, encrypt).msg;
    return {
      fromUser: xmlField(xml, "FromUserName"),
      msgType: xmlField(xml, "MsgType"),
      text: xmlField(xml, "Content"),
      msgId: xmlField(xml, "MsgId"),
    };
  };

  const status = (): ImChannelStatus => {
    const { corpId, secret, agentId, callbackToken } = options.getSettings();
    const credentialsReady = Boolean(corpId && secret && agentId);
    const callbackReady = Boolean(callbackToken);
    // The settings screen prints the callback URL itself, so the detail only says which
    // half is missing (credentials push, the token receives).
    const missing = [
      credentialsReady ? null : "缺少 CorpID / Secret / AgentID",
      callbackReady ? null : "缺少回调 Token",
    ].filter((entry): entry is string => entry !== null);
    return {
      id: "wecom",
      configured: credentialsReady && callbackReady,
      state: credentialsReady && callbackReady ? "connected" : "off",
      ...(missing.length > 0 ? { detail: missing.join("；") } : {}),
    };
  };

  const probe = async () => {
    const { corpId, secret } = options.getSettings();
    await getToken(`${corpId}:${secret}`, true);
  };

  return { id: "wecom", verifyUrl, parseCallback, push, probe, status };
}

export interface WechatMpChannel {
  readonly id: "wechatMp";
  readonly verifyUrl: (query: Record<string, string | undefined>) => string;
  readonly parseCallback: (
    query: Record<string, string | undefined>,
    rawBody: string,
  ) => WechatCallbackMessage;
  readonly push: (openId: string, text: string) => Promise<void>;
  /** Mint an access token without sending anything — the connectivity check. */
  readonly probe: () => Promise<void>;
  readonly status: () => ImChannelStatus;
}

export function createWechatMp(options: {
  readonly getSettings: () => ImWechatMpChannelSettings;
  readonly log?: (level: "info" | "warn", text: string) => void;
}): WechatMpChannel {
  const getToken = makeTokenCache(async () => {
    const { appId, appSecret } = options.getSettings();
    if (!appId || !appSecret) throw new Error("未配置公众号 AppID / AppSecret");
    const response = await fetch(
      `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(appId)}&secret=${encodeURIComponent(appSecret)}`,
      { signal: AbortSignal.timeout(15_000) },
    );
    const data = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
      errcode?: number;
      errmsg?: string;
    };
    if (data.errcode || !data.access_token) {
      throw new Error(`公众号 token 失败：${data.errmsg ?? ""}（${data.errcode ?? "?"}）`);
    }
    return { token: data.access_token, expiresIn: data.expires_in };
  });

  /** Customer-service messages: pushable for 48h, and only by a verified account. */
  const push = async (openId: string, text: string) => {
    const { appId, appSecret } = options.getSettings();
    const bearer = await getToken(`${appId}:${appSecret}`);
    for (const part of splitBytes(text, 1_800)) {
      const response = await fetch(
        `https://api.weixin.qq.com/cgi-bin/message/custom/send?access_token=${bearer}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ touser: openId, msgtype: "text", text: { content: part } }),
          signal: AbortSignal.timeout(15_000),
        },
      );
      const data = (await response.json()) as { errcode?: number; errmsg?: string };
      if (data.errcode) {
        if (data.errcode === 48_001) {
          throw new Error(
            "公众号未获得「客服消息」接口权限（48001）：未认证的订阅号无法主动推送，需认证服务号",
          );
        }
        throw new Error(`公众号发送失败：${data.errmsg ?? ""}（${data.errcode}）`);
      }
    }
  };

  const verifyUrl: WechatMpChannel["verifyUrl"] = (query) => {
    const { callbackToken } = options.getSettings();
    const { signature, timestamp, nonce, echostr } = query;
    const computed = createHash("sha1")
      .update([String(callbackToken), String(timestamp), String(nonce)].toSorted().join(""))
      .digest("hex");
    if (computed !== signature) throw new Error("签名校验失败");
    return echostr ?? "";
  };

  const parseCallback: WechatMpChannel["parseCallback"] = (query, rawBody) => {
    const { callbackToken, encodingAesKey } = options.getSettings();
    let xml = String(rawBody ?? "");
    const encrypt = xmlField(xml, "Encrypt");
    if (encrypt) {
      if (!encodingAesKey) throw new Error("收到密文但未配置 EncodingAESKey");
      if (
        msgSignature(callbackToken, query.timestamp ?? "", query.nonce ?? "", encrypt) !==
        query.msg_signature
      ) {
        throw new Error("签名校验失败");
      }
      xml = decryptMsg(encodingAesKey, encrypt).msg;
    }
    return {
      fromUser: xmlField(xml, "FromUserName"),
      msgType: xmlField(xml, "MsgType"),
      text: xmlField(xml, "Content"),
      msgId: xmlField(xml, "MsgId"),
    };
  };

  const status = (): ImChannelStatus => {
    const { appId, appSecret, callbackToken, encodingAesKey } = options.getSettings();
    const configured = Boolean(appId && appSecret && callbackToken);
    return {
      id: "wechatMp",
      configured,
      state: configured ? "connected" : "off",
      detail: encodingAesKey ? "安全模式" : "明文模式",
    };
  };

  const probe = async () => {
    const { appId, appSecret } = options.getSettings();
    await getToken(`${appId}:${appSecret}`, true);
  };

  return { id: "wechatMp", verifyUrl, parseCallback, push, probe, status };
}

/** Turn a parsed callback into the bridge's inbound shape. */
export function wechatInboundMessage(input: {
  readonly channel: "wecom" | "wechatMp";
  readonly fromUser: string;
  readonly text: string;
  readonly reply: ImInboundMessage["reply"];
}): ImInboundMessage {
  return {
    channel: input.channel,
    peerId: input.fromUser,
    peerScope: "",
    peerLabel: input.fromUser,
    text: input.text,
    reply: input.reply,
  };
}
