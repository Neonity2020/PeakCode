import { Option } from "effect";
import { describe, expect, it } from "vitest";

import type { OrchestrationThread } from "@peakcode/contracts";

import {
  imConversationKey,
  imReplyTextFor,
  imThreadTitle,
  resolveMobileBaseUrl,
} from "./ImService.ts";

describe("imConversationKey", () => {
  it("namespaces a chat by channel, scope and peer", () => {
    expect(imConversationKey({ channel: "feishu", peerId: "chat_1", peerScope: "" })).toBe(
      "feishu:chat_1",
    );
    expect(imConversationKey({ channel: "qq", peerId: "group_9", peerScope: "group" })).toBe(
      "qq:group:group_9",
    );
  });
});

describe("imThreadTitle", () => {
  it("labels the thread with the channel, the peer and the first line", () => {
    expect(
      imThreadTitle({ channel: "wechat", peerLabel: "张工", text: "帮我看下这个报错\n详情…" }),
    ).toBe("微信 · 张工 · 帮我看下这个报错");
  });

  it("falls back to a placeholder when the message has no text line", () => {
    expect(imThreadTitle({ channel: "qq", peerLabel: "", text: "\n  \n" })).toBe("QQ · 新消息");
  });

  it("truncates very long first lines", () => {
    const title = imThreadTitle({ channel: "wechat", peerLabel: "", text: "长".repeat(500) });
    expect(title.length).toBe(120);
  });
});

const threadWith = (input: {
  readonly messages: ReadonlyArray<{ role: "user" | "assistant" | "system"; text: string }>;
  readonly lastError?: string;
}): OrchestrationThread =>
  ({
    messages: input.messages,
    session: input.lastError === undefined ? null : { lastError: input.lastError },
  }) as unknown as OrchestrationThread;

describe("imReplyTextFor", () => {
  it("sends the last assistant message back to the chat", () => {
    expect(
      imReplyTextFor({
        outcome: "succeeded",
        thread: Option.some(
          threadWith({
            messages: [
              { role: "user", text: "跑测试" },
              { role: "assistant", text: "先看看日志" },
              { role: "assistant", text: "全部通过了" },
            ],
          }),
        ),
      }),
    ).toBe("全部通过了");
  });

  it("ignores empty assistant messages", () => {
    expect(
      imReplyTextFor({
        outcome: "succeeded",
        thread: Option.some(
          threadWith({
            messages: [
              { role: "assistant", text: "有内容" },
              { role: "assistant", text: "   " },
            ],
          }),
        ),
      }),
    ).toBe("有内容");
  });

  it("explains an empty turn rather than sending nothing", () => {
    expect(imReplyTextFor({ outcome: "succeeded", thread: Option.none() }).length).toBeGreaterThan(
      0,
    );
  });

  it("reports the session error on failure", () => {
    expect(
      imReplyTextFor({
        outcome: "failed",
        thread: Option.some(threadWith({ messages: [], lastError: "provider unavailable" })),
      }),
    ).toContain("provider unavailable");
  });

  it("says the turn was interrupted", () => {
    expect(imReplyTextFor({ outcome: "interrupted", thread: Option.none() })).toContain("中断");
  });
});

describe("resolveMobileBaseUrl", () => {
  it("refuses a loopback-only server, because no phone could reach it", () => {
    expect(() => resolveMobileBaseUrl({ host: "127.0.0.1", port: 3773 })).toThrow(/监听本机/);
    expect(() => resolveMobileBaseUrl({ host: "localhost", port: 3773 })).toThrow(/监听本机/);
  });

  it("uses an explicit host, bracketing IPv6", () => {
    expect(resolveMobileBaseUrl({ host: "192.168.1.42", port: 3773 })).toBe(
      "http://192.168.1.42:3773",
    );
    expect(resolveMobileBaseUrl({ host: "fd7a::1", port: 3773 })).toBe("http://[fd7a::1]:3773");
  });

  it("picks a LAN address when the server listens on every interface", () => {
    expect(resolveMobileBaseUrl({ host: "0.0.0.0", port: 3773 })).toMatch(/^http:\/\//);
    expect(resolveMobileBaseUrl({ host: undefined, port: 3773 })).toMatch(/^http:\/\//);
  });
});

describe("imReplyTextFor with an unavailable model", () => {
  it("tells the chat what to do instead of relaying the provider's JSON", () => {
    const error =
      '404: {"message":"model_unavailable: 模型 \'deepseek-v4-flash\' 不存在。当前可用：deepseek-v4.1","type":"invalid_request_error"}';
    const text = imReplyTextFor({
      outcome: "failed",
      thread: Option.some({
        session: { lastError: error },
        messages: [],
      } as never),
    });

    expect(text).toContain("模型已经不可用");
    expect(text).toContain("默认模型");
    expect(text).not.toContain("invalid_request_error");
  });

  it("still relays any other failure as before", () => {
    const text = imReplyTextFor({
      outcome: "failed",
      thread: Option.some({ session: { lastError: "boom" }, messages: [] } as never),
    });

    expect(text).toBe("❌ 执行出错：boom（可在 Peak Code 里打开这次对话查看详情）");
  });
});
