import { describe, expect, it } from "vitest";

import { decryptMsg, encryptMsg, msgSignature, splitBytes, xmlField } from "./wechatCallback.ts";
import { signDingtalkUrl } from "./webhooks.ts";

/** A valid 43-character EncodingAESKey. */
const AES_KEY = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";

describe("msgSignature", () => {
  it("sorts token, timestamp, nonce and ciphertext before hashing", () => {
    // Same four values, different argument order: the signature must not change.
    expect(msgSignature("b", "a", "d", "c")).toBe(msgSignature("d", "c", "b", "a"));
    expect(msgSignature("b", "a", "d", "c")).toHaveLength(40);
  });
});

describe("WXBizMsgCrypt", () => {
  it("round-trips a message and its receive id", () => {
    const encrypted = encryptMsg(AES_KEY, "<xml>你好</xml>", "wx123");
    expect(decryptMsg(AES_KEY, encrypted)).toEqual({
      msg: "<xml>你好</xml>",
      receiveId: "wx123",
    });
  });

  it("rejects a key that is not 43 characters", () => {
    expect(() => encryptMsg("too-short", "x", "id")).toThrow(/EncodingAESKey/);
    expect(() => decryptMsg("too-short", "AAAA")).toThrow(/EncodingAESKey/);
  });
});

describe("xmlField", () => {
  it("reads CDATA and plain values", () => {
    const xml = "<xml><Content><![CDATA[你好 <b>]]></Content><MsgId>123</MsgId></xml>";
    expect(xmlField(xml, "Content")).toBe("你好 <b>");
    expect(xmlField(xml, "MsgId")).toBe("123");
  });

  it("returns an empty string for a missing field", () => {
    expect(xmlField("<xml></xml>", "Nope")).toBe("");
  });
});

describe("splitBytes", () => {
  it("limits by UTF-8 bytes, not characters", () => {
    const parts = splitBytes("你好世界", 6);
    expect(parts).toEqual(["你好", "世界"]);
    expect(parts.every((part) => Buffer.byteLength(part, "utf8") <= 6)).toBe(true);
  });

  it("keeps a single over-long character in its own chunk instead of dropping it", () => {
    expect(splitBytes("你", 1)).toEqual(["你"]);
  });
});

describe("signDingtalkUrl", () => {
  it("appends timestamp and an encoded signature", () => {
    const url = signDingtalkUrl(
      "https://oapi.dingtalk.com/robot/send?access_token=t",
      "SECRET",
      1_700_000_000_000,
    );
    const parsed = new URL(url);
    expect(parsed.searchParams.get("timestamp")).toBe("1700000000000");
    expect(parsed.searchParams.get("sign")).toBeTruthy();
    expect(parsed.searchParams.get("access_token")).toBe("t");
  });

  it("keeps an existing query string intact", () => {
    const url = signDingtalkUrl("https://example.com/hook?a=1", "SECRET", 1);
    expect(url.startsWith("https://example.com/hook?a=1&timestamp=1")).toBe(true);
  });
});
