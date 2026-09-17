import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { DEFAULT_SERVER_SETTINGS, ServerSettings, ServerSettingsPatch } from "@peakcode/contracts";

import { applyServerSettingsPatch } from "./serverSettings";

/** Decode from an arbitrary shape, which is what an older settings file looks like. */
const decodeSettings = (input: unknown): ServerSettings =>
  Schema.decodeUnknownSync(ServerSettings)(input);
const decodePatch = (input: unknown): ServerSettingsPatch =>
  Schema.decodeUnknownSync(ServerSettingsPatch)(input);

describe("IM settings defaults", () => {
  it("fills in every channel section so the settings screen always has a shape to render", () => {
    const im = DEFAULT_SERVER_SETTINGS.im;
    expect(im.defaultProjectId).toBe("");
    expect(im.sessionIdleHours).toBe(12);
    // Unattended runs stay behind the approval gate unless someone opts out.
    expect(im.runtimeMode).toBe("approval-required");
    expect(im.wechat).toEqual({ botToken: "", botId: "", baseUrl: "", cursor: "" });
    expect(im.feishu).toEqual({ domain: "feishu", appId: "", appSecret: "" });
    expect(im.qq).toEqual({ appId: "", appSecret: "" });
    expect(im.webhooks).toEqual({
      wecomUrl: "",
      dingtalkUrl: "",
      dingtalkSecret: "",
      secret: "",
    });
  });

  it("upgrades a settings file written before channels existed", () => {
    const legacy = decodeSettings({
      enableAssistantStreaming: true,
      providers: { pi: { enabled: true, binaryPath: "pi" } },
    });
    expect(legacy.im.feishu.domain).toBe("feishu");
    expect(legacy.im.sessionIdleHours).toBe(12);
  });
});

describe("IM settings patches", () => {
  it("merges only the fields the panel wrote, leaving sibling credentials alone", () => {
    const current = decodeSettings({
      im: {
        feishu: { appId: "cli_1", appSecret: "secret" },
        sessionIdleHours: 6,
      },
    });

    const next = applyServerSettingsPatch(
      current,
      decodePatch({ im: { feishu: { appId: "cli_2" }, wechat: { botToken: "t", botId: "b" } } }),
    );

    expect(next.im.feishu.appId).toBe("cli_2");
    expect(next.im.feishu.appSecret).toBe("secret");
    expect(next.im.wechat.botToken).toBe("t");
    expect(next.im.sessionIdleHours).toBe(6);
  });

  it("keeps the cursor separable from the credentials it belongs to", () => {
    const current = decodeSettings({
      im: { wechat: { botToken: "t", botId: "b", baseUrl: "https://base" } },
    });
    const next = applyServerSettingsPatch(
      current,
      decodePatch({ im: { wechat: { cursor: "c1" } } }),
    );
    expect(next.im.wechat).toEqual({
      botToken: "t",
      botId: "b",
      baseUrl: "https://base",
      cursor: "c1",
    });
  });
});
