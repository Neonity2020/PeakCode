import { describe, expect, it } from "vitest";

import { parseAgentMentionInvocations } from "./agentMentions";

describe("parseAgentMentionInvocations", () => {
  it("parses no invocations for the pi provider, which exposes no agent aliases", () => {
    expect(parseAgentMentionInvocations("Check @spark(find the regression)", "pi")).toEqual([]);
  });

  it("handles balanced nested parentheses without resolving any aliases", () => {
    const parsed = parseAgentMentionInvocations(
      "Please @review(check fn(a, b) and the SQL migration)",
      "pi",
    );

    expect(parsed).toEqual([]);
  });

  it("returns an empty list for plain prompts with no mentions", () => {
    expect(parseAgentMentionInvocations("Just answer directly", "pi")).toEqual([]);
  });
});
