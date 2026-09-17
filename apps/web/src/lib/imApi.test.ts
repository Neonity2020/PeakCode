import { afterEach, describe, expect, it, vi } from "vitest";

import { ThreadId } from "@peakcode/contracts";

import { imApi, imApiErrorMessage } from "./imApi";

/**
 * The IM bridge's HTTP contract, as the settings panel uses it. These run in the node test
 * environment, where `resolveWsHttpUrl` returns the path unchanged (no `window`), which is
 * the part worth pinning: path, method, body and the error the UI puts in a toast.
 */

const response = (payload: unknown, ok = true, status = 200) => ({
  ok,
  status,
  json: async () => payload,
});

const fetchMock = (payload: unknown = {}) =>
  vi.fn(async (_url: string, _init?: RequestInit) => response(payload));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("imApi", () => {
  it("reads status and conversations with a plain GET", async () => {
    const fetch = fetchMock({ channels: [] });
    vi.stubGlobal("fetch", fetch);

    await expect(imApi.getStatus()).resolves.toEqual({ channels: [] });
    await imApi.listConversations();

    expect(fetch.mock.calls.map((call) => call[0])).toEqual([
      "/api/im/status",
      "/api/im/conversations",
    ]);
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      method: "GET",
      credentials: "same-origin",
    });
  });

  it("posts a channel's fields as JSON with the right content type", async () => {
    const fetch = fetchMock({ ok: true });
    vi.stubGlobal("fetch", fetch);

    await imApi.testChannel("wecom");

    const [path, init] = fetch.mock.calls[0] ?? [];
    expect(path).toBe("/api/im/test");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({ channel: "wecom" }));
    expect(init?.headers).toEqual({ "Content-Type": "application/json" });
  });

  it("sends the phone hand-off with the conversation it should carry", async () => {
    const fetch = fetchMock({ url: "https://x/pair#token=t" });
    vi.stubGlobal("fetch", fetch);

    await imApi.createMobileLink({ threadId: ThreadId.makeUnsafe("thread_1") });
    await imApi.createMobileLink();

    expect(fetch.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ threadId: "thread_1" }));
    // Called with nothing, the route still mints a link for the workspace at large.
    expect(fetch.mock.calls[1]?.[1]?.body).toBe("{}");
  });

  it("escapes the QR code it polls for, because the code is not URL-safe", async () => {
    const fetch = fetchMock({ status: "wait" });
    vi.stubGlobal("fetch", fetch);

    await imApi.pollWechatQrStatus("abc+/=def&x");

    expect(fetch.mock.calls[0]?.[0]).toBe(
      "/api/im/wechat/qrcode-status?qrcode=abc%2B%2F%3Ddef%26x",
    );
  });

  it("hits the write routes the panel's buttons use", async () => {
    const fetch = fetchMock({});
    vi.stubGlobal("fetch", fetch);

    await imApi.forgetConversation("wechat:peer");
    await imApi.createWechatQrCode();
    await imApi.disconnectWechat();
    await imApi.startRemoteAccess();
    await imApi.stopRemoteAccess();

    expect(fetch.mock.calls.map((call) => [call[0], call[1]?.method])).toEqual([
      ["/api/im/conversations/forget", "POST"],
      ["/api/im/wechat/qrcode", "POST"],
      ["/api/im/wechat/disconnect", "POST"],
      ["/api/im/remote-access/start", "POST"],
      ["/api/im/remote-access/stop", "POST"],
    ]);
    expect(fetch.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ conversationKey: "wechat:peer" }));
  });

  it("surfaces the server's own error text, which is what the toast shows", async () => {
    const fetch = vi.fn(async () => response({ error: "secret 不正确" }, false, 403));
    vi.stubGlobal("fetch", fetch);

    await expect(imApi.startRemoteAccess()).rejects.toThrow("secret 不正确");
  });

  it("falls back to the status code when the error body is not JSON", async () => {
    const fetch = vi.fn(async () => ({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error("not json");
      },
    }));
    vi.stubGlobal("fetch", fetch);

    await expect(imApi.getStatus()).rejects.toThrow("IM request failed with status 502");
  });

  it("reads an error's message without trusting its shape", () => {
    expect(imApiErrorMessage(new Error("boom"))).toBe("boom");
    expect(imApiErrorMessage("boom")).toBe("boom");
    // Anything that is not an Error is stringified as-is — this client always throws Errors
    // itself, so the lossy case only appears if a caller passes something exotic.
    expect(imApiErrorMessage({ message: "boom" })).toBe("[object Object]");
  });
});
