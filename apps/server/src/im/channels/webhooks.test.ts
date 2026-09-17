import { afterEach, describe, expect, it, vi } from "vitest";

import type { ImWebhookChannelSettings } from "@peakcode/contracts";

import { createGroupRobotPusher } from "./webhooks.ts";

/**
 * The push half of the `webhook` channel: group robots announce a finished run where a
 * team is watching. `signDingtalkUrl` — the signing helper this module exports — is
 * covered in `wechatCallback.test.ts`, where it was first written.
 */

const settings = (overrides: Partial<ImWebhookChannelSettings> = {}): ImWebhookChannelSettings => ({
  wecomUrl: "",
  dingtalkUrl: "",
  dingtalkSecret: "",
  secret: "",
  ...overrides,
});

/** A robot answer: HTTP 200 with a body that says whether it actually worked. */
const robotReply = (body: unknown = { errcode: 0 }, ok = true, status = 200) => ({
  ok,
  status,
  json: async () => body,
});

const fetchMock = () =>
  vi.fn(async (_url: string, _init?: { readonly body?: string }) => robotReply());

const sentBodies = (calls: ReadonlyArray<readonly unknown[]>): ReadonlyArray<unknown> =>
  calls.map(
    (call) => JSON.parse(String((call[1] as { body?: string } | undefined)?.body)) as unknown,
  );

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createGroupRobotPusher", () => {
  it("pushes to every configured robot and reports the ones that took it", async () => {
    const fetch = fetchMock();
    vi.stubGlobal("fetch", fetch);
    const pusher = createGroupRobotPusher({
      getSettings: () =>
        settings({
          wecomUrl: "https://qyapi.example/cgi-bin/webhook/send?key=K",
          dingtalkUrl: "https://oapi.example/robot/send?access_token=T",
          dingtalkSecret: "SECRET",
        }),
    });

    await expect(pusher.push("任务完成")).resolves.toEqual(["企业微信群机器人", "钉钉群机器人"]);

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(sentBodies(fetch.mock.calls)).toEqual([
      { msgtype: "text", text: { content: "任务完成" } },
      { msgtype: "text", text: { content: "任务完成" } },
    ]);
    // The WeCom robot takes the URL as configured; DingTalk's is signed per request.
    expect(fetch.mock.calls[0]?.[0]).toBe("https://qyapi.example/cgi-bin/webhook/send?key=K");
    expect(fetch.mock.calls[1]?.[0]).toContain("access_token=T&timestamp=");
    expect(fetch.mock.calls[1]?.[0]).toContain("sign=");
  });

  it("leaves DingTalk unsigned when no secret is configured", async () => {
    const fetch = fetchMock();
    vi.stubGlobal("fetch", fetch);
    const pusher = createGroupRobotPusher({
      getSettings: () => settings({ dingtalkUrl: "https://oapi.example/robot/send" }),
    });

    await pusher.push("hi");

    expect(fetch.mock.calls[0]?.[0]).toBe("https://oapi.example/robot/send");
  });

  it("keeps pushing to the other robot when one of them fails", async () => {
    const fetch = vi.fn(async (url: string) =>
      url.includes("qyapi") ? robotReply({}, false, 500) : robotReply({ errcode: 0 }),
    );
    vi.stubGlobal("fetch", fetch);
    const log = vi.fn();
    const pusher = createGroupRobotPusher({
      getSettings: () =>
        settings({
          wecomUrl: "https://qyapi.example/send",
          dingtalkUrl: "https://oapi.example/send",
        }),
      log,
    });

    await expect(pusher.push("任务完成")).resolves.toEqual(["钉钉群机器人"]);
    expect(log).toHaveBeenCalledWith("warn", expect.stringContaining("企业微信群机器人推送失败"));
    expect(log).toHaveBeenCalledWith("warn", expect.stringContaining("HTTP 500"));
  });

  it("treats a 200 that carries an errcode as a rejection", async () => {
    const fetch = vi.fn(async () => robotReply({ errcode: 310000, errmsg: "invalid sign" }));
    vi.stubGlobal("fetch", fetch);
    const log = vi.fn();
    const pusher = createGroupRobotPusher({
      getSettings: () => settings({ dingtalkUrl: "https://oapi.example/send" }),
      log,
    });

    // Robots answer 200 whether or not they accepted the message, so the body decides.
    await expect(pusher.push("任务完成")).resolves.toEqual([]);
    expect(log).toHaveBeenCalledWith("warn", expect.stringContaining("invalid sign"));
    expect(log).toHaveBeenCalledWith("warn", expect.stringContaining("310000"));
  });

  it("truncates a long message to what the robots accept", async () => {
    const fetch = fetchMock();
    vi.stubGlobal("fetch", fetch);
    const pusher = createGroupRobotPusher({
      getSettings: () => settings({ wecomUrl: "https://qyapi.example/send" }),
    });

    await pusher.push("x".repeat(5_000));

    const body = sentBodies(fetch.mock.calls)[0] as { text: { content: string } };
    expect(body.text.content).toHaveLength(2_000);
  });

  it("does not call out at all when no robot is configured", async () => {
    const fetch = fetchMock();
    vi.stubGlobal("fetch", fetch);
    const pusher = createGroupRobotPusher({ getSettings: () => settings() });

    await expect(pusher.push("任务完成")).resolves.toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reports its state as configured targets, plus whether inbound is guarded", () => {
    const off = createGroupRobotPusher({ getSettings: () => settings() });
    expect(off.status()).toMatchObject({ id: "webhook", configured: false, state: "off" });

    const on = createGroupRobotPusher({
      getSettings: () => settings({ wecomUrl: "https://qyapi.example/send", secret: "INBOUND" }),
    });
    const status = on.status();
    expect(status).toMatchObject({ id: "webhook", configured: true, state: "connected" });
    expect(status.detail).toContain("企业微信");
    expect(status.detail).not.toContain("钉钉");
    expect(status.detail).toContain("入站密钥已设置");
  });
});
