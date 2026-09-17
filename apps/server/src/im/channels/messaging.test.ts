import { describe, expect, it } from "vitest";

import { buildFeishuAnswerCard, feishuCardSummary, feishuMessageText } from "./feishu.ts";
import { stripQqMention } from "./qq.ts";

describe("feishuCardSummary", () => {
  it("uses the first meaningful line, with Markdown furniture stripped", () => {
    expect(feishuCardSummary("## 结论\n\n内容")).toBe("结论");
    expect(feishuCardSummary("```\ncode\n```")).toBe("code");
  });

  it("is undefined for text with nothing to summarise", () => {
    expect(feishuCardSummary("\n\n")).toBeUndefined();
  });
});

describe("buildFeishuAnswerCard", () => {
  it("renders the answer as a markdown card with a summary", () => {
    const card = buildFeishuAnswerCard("## 结论\n完成") as {
      schema: string;
      config: { summary?: { content: string } };
      body: { elements: ReadonlyArray<{ tag: string; content: string }> };
    };
    expect(card.schema).toBe("2.0");
    expect(card.config.summary?.content).toBe("结论");
    expect(card.body.elements[0]).toEqual({ tag: "markdown", content: "## 结论\n完成" });
  });

  it("omits the summary when the text has no heading", () => {
    const card = buildFeishuAnswerCard("\n\n") as { config: { summary?: unknown } };
    expect(card.config.summary).toBeUndefined();
  });
});

describe("feishuMessageText", () => {
  it("reads text messages and removes the bot mention placeholder", () => {
    expect(
      feishuMessageText({
        message_type: "text",
        content: JSON.stringify({ text: "@_user_1 帮我部署" }),
      }),
    ).toBe("帮我部署");
  });

  it("ignores non-text messages and malformed content", () => {
    expect(feishuMessageText({ message_type: "image", content: "{}" })).toBe("");
    expect(feishuMessageText({ message_type: "text", content: "not json" })).toBe("");
  });
});

describe("stripQqMention", () => {
  it("removes the group @-mention markers QQ injects", () => {
    expect(stripQqMention("<@!12345> 跑一下测试")).toBe("跑一下测试");
    expect(stripQqMention("  <@123>  ")).toBe("");
  });
});
