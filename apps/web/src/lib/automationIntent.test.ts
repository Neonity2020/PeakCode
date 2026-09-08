import { describe, expect, it } from "vitest";

import { detectCreateAutomationIntent } from "./automationIntent";

describe("detectCreateAutomationIntent", () => {
  it("parses Chinese daily scheduled task requests", () => {
    const intent = detectCreateAutomationIntent(
      "帮我创建个定时任务，每天上午10点抓取AI相关的新闻。",
    );

    expect(intent).toEqual({
      title: "抓取AI相关的新闻",
      description: "",
      prompt: "抓取AI相关的新闻",
      scheduleType: "cron",
      cronExpression: "0 10 * * *",
      templateId: null,
    });
  });

  it("does not intercept ordinary chat", () => {
    expect(detectCreateAutomationIntent("帮我解释一下这个函数")).toBeNull();
  });
});
