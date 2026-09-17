import { describe, expect, it } from "vitest";

import {
  DEFAULT_ILINK_BASE_URL,
  extractIlinkText,
  ilinkDedupKey,
  isHealthyLongPollExit,
} from "./ilink.ts";
import { splitTextOnNewlines } from "./types.ts";

describe("extractIlinkText", () => {
  it("keeps text items and uses the voice transcription when there is one", () => {
    expect(
      extractIlinkText([
        { type: 1, text_item: { text: "帮我看下这个报错" } },
        { type: 3, voice_item: { text: "帮我总结一下" } },
      ]),
    ).toBe("帮我看下这个报错\n帮我总结一下");
  });

  it("reports attachments it cannot fetch instead of dropping the message", () => {
    expect(
      extractIlinkText([
        { type: 2 },
        { type: 4, file_item: { file_name: "报告.xlsx" } },
        { type: 5 },
      ]),
    ).toBe("（图片，暂不支持下载）\n（文件：报告.xlsx，暂不支持下载）\n（视频，暂不支持下载）");
  });

  it("returns empty text for a message with nothing readable", () => {
    expect(extractIlinkText(undefined)).toBe("");
    expect(extractIlinkText([{ type: 99 }])).toBe("");
  });
});

describe("ilinkDedupKey", () => {
  it("prefers the message id, then the sequence, then the sender/time/client triple", () => {
    expect(ilinkDedupKey({ message_id: 42, seq: 7 })).toBe("mid:42");
    expect(ilinkDedupKey({ seq: 7 })).toBe("seq:7");
    expect(ilinkDedupKey({ from_user_id: "u1", create_time_ms: 100, client_id: "c9" })).toBe(
      "fb:u1:100:c9",
    );
  });
});

describe("splitTextOnNewlines", () => {
  it("leaves short text alone", () => {
    expect(splitTextOnNewlines("你好", 10)).toEqual(["你好"]);
  });

  it("breaks on a newline when one is close enough to the limit", () => {
    expect(splitTextOnNewlines("aaaa\nbbbbbb", 6)).toEqual(["aaaa", "bbbbbb"]);
  });

  it("hard-splits a single long line and never exceeds the limit", () => {
    const parts = splitTextOnNewlines("x".repeat(25), 10);
    expect(parts).toEqual(["x".repeat(10), "x".repeat(10), "x".repeat(5)]);
    expect(parts.every((part) => part.length <= 10)).toBe(true);
  });

  it("returns one empty chunk for empty text, so the caller always has something to send", () => {
    expect(splitTextOnNewlines("", 10)).toEqual([""]);
  });
});

describe("ilink defaults", () => {
  it("points at the public iLink host", () => {
    expect(DEFAULT_ILINK_BASE_URL).toBe("https://ilinkai.weixin.qq.com");
  });
});

describe("isHealthyLongPollExit", () => {
  it("treats our own timeout as a healthy idle poll", () => {
    expect(isHealthyLongPollExit({ timedOut: true, elapsedMs: 40, windowMs: 40_000 })).toBe(true);
  });

  it("counts a request that survived at least half its window as a healthy idle poll", () => {
    // The server closing an idle long poll surfaces as a generic fetch failure, so how
    // long the request lived is the discriminator.
    expect(isHealthyLongPollExit({ timedOut: false, elapsedMs: 30_000, windowMs: 40_000 })).toBe(
      true,
    );
    expect(isHealthyLongPollExit({ timedOut: false, elapsedMs: 20_000, windowMs: 40_000 })).toBe(
      true,
    );
  });

  it("treats a request that died early as a real failure", () => {
    expect(isHealthyLongPollExit({ timedOut: false, elapsedMs: 300, windowMs: 40_000 })).toBe(
      false,
    );
    expect(isHealthyLongPollExit({ timedOut: false, elapsedMs: 15_000, windowMs: 40_000 })).toBe(
      false,
    );
  });

  it("uses the 3s floor for the short first poll", () => {
    expect(isHealthyLongPollExit({ timedOut: false, elapsedMs: 3_100, windowMs: 5_000 })).toBe(
      true,
    );
    expect(isHealthyLongPollExit({ timedOut: false, elapsedMs: 2_900, windowMs: 5_000 })).toBe(
      false,
    );
  });
});
