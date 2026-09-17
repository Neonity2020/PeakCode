import { createHmac } from "node:crypto";

import type { ImChannelStatus, ImWebhookChannelSettings } from "@peakcode/contracts";

import { errorMessageOf } from "./types.ts";

/**
 * Push-only group robots: WeCom group webhooks and DingTalk custom robots.
 *
 * They cannot receive anything — they are how a finished run announces itself in a
 * team chat (and where a scheduled task's result lands when nobody is watching the UI).
 * DingTalk optionally signs every request with an HMAC over `timestamp\nsecret`.
 */

const PUSH_LIMIT = 2_000;

export interface GroupRobotPusher {
  /** Deliver to every configured robot; failures of one do not stop the others. */
  readonly push: (text: string) => Promise<ReadonlyArray<string>>;
  readonly status: () => ImChannelStatus;
}

export interface GroupRobotTarget {
  readonly url: string;
  readonly secret?: string;
}

/** DingTalk's signed-URL variant: timestamp plus an HMAC-SHA256 over `ts\nsecret`. */
export function signDingtalkUrl(url: string, secret: string, timestamp: number): string {
  const signature = encodeURIComponent(
    createHmac("sha256", secret).update(`${timestamp}\n${secret}`).digest("base64"),
  );
  return `${url}${url.includes("?") ? "&" : "?"}timestamp=${timestamp}&sign=${signature}`;
}

async function postText(url: string, text: string): Promise<void> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ msgtype: "text", text: { content: text.slice(0, PUSH_LIMIT) } }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  // Both robots answer 200 with a body that says whether it actually worked.
  const data = (await response.json().catch(() => ({}))) as { errcode?: number; errmsg?: string };
  if (data.errcode) throw new Error(`${data.errmsg ?? "推送被拒"}（${data.errcode}）`);
}

export function createGroupRobotPusher(options: {
  readonly getSettings: () => ImWebhookChannelSettings;
  readonly log?: (level: "info" | "warn", text: string) => void;
}): GroupRobotPusher {
  const push: GroupRobotPusher["push"] = async (text) => {
    const settings = options.getSettings();
    const delivered: Array<string> = [];
    if (settings.wecomUrl) {
      try {
        await postText(settings.wecomUrl, text);
        delivered.push("企业微信群机器人");
      } catch (error) {
        options.log?.("warn", `企业微信群机器人推送失败：${errorMessageOf(error)}`);
      }
    }
    if (settings.dingtalkUrl) {
      try {
        const url = settings.dingtalkSecret
          ? signDingtalkUrl(settings.dingtalkUrl, settings.dingtalkSecret, Date.now())
          : settings.dingtalkUrl;
        await postText(url, text);
        delivered.push("钉钉群机器人");
      } catch (error) {
        options.log?.("warn", `钉钉群机器人推送失败：${errorMessageOf(error)}`);
      }
    }
    return delivered;
  };

  const status = (): ImChannelStatus => {
    const settings = options.getSettings();
    const targets = [
      settings.wecomUrl ? "企业微信" : null,
      settings.dingtalkUrl ? "钉钉" : null,
    ].filter((target): target is string => target !== null);
    return {
      id: "webhook",
      configured: targets.length > 0,
      state: targets.length > 0 ? "connected" : "off",
      ...(targets.length > 0
        ? {
            detail: `已配置：${targets.join(" / ")}${settings.secret ? "（入站密钥已设置）" : ""}`,
          }
        : {}),
    };
  };

  return { push, status };
}
