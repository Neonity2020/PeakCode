import { describe, expect, it } from "vitest";

import { resolveReplyModelSelection } from "./replyModel";

const offered = ["anthropic/claude-sonnet-4-6", "deepseek/deepseek-v4.1"];

describe("resolveReplyModelSelection", () => {
  it("keeps the thread's own model while the provider still offers it", () => {
    expect(
      resolveReplyModelSelection({
        threadSelection: { provider: "pi", model: "anthropic/claude-sonnet-4-6" },
        defaultSelection: { provider: "pi", model: "deepseek/deepseek-v4.1" },
        offeredSlugs: offered,
      }),
    ).toEqual({ provider: "pi", model: "anthropic/claude-sonnet-4-6" });
  });

  it("substitutes the configured default for a model the endpoint dropped", () => {
    // What the phone hit: the thread kept a slug the gateway stopped serving, and a reply
    // from a phone with no model picker died on it every time.
    expect(
      resolveReplyModelSelection({
        threadSelection: { provider: "pi", model: "deepseek/deepseek-v4-flash" },
        defaultSelection: { provider: "pi", model: "deepseek/deepseek-v4.1" },
        offeredSlugs: offered,
      }),
    ).toEqual({ provider: "pi", model: "deepseek/deepseek-v4.1" });
  });

  it("falls back to the first offered model when the default is stale too", () => {
    expect(
      resolveReplyModelSelection({
        threadSelection: { provider: "pi", model: "gone/one" },
        defaultSelection: { provider: "pi", model: "gone/two" },
        offeredSlugs: offered,
      }),
    ).toEqual({ provider: "pi", model: "anthropic/claude-sonnet-4-6" });
  });

  it("leaves the decision alone when the provider could not be asked", () => {
    expect(
      resolveReplyModelSelection({
        threadSelection: { provider: "pi", model: "deepseek/deepseek-v4-flash" },
        defaultSelection: null,
        offeredSlugs: [],
      }),
    ).toBeNull();
  });

  it("resolves a stored alias onto the offered slug", () => {
    expect(
      resolveReplyModelSelection({
        threadSelection: { provider: "pi", model: "sonnet-4-6" },
        defaultSelection: null,
        offeredSlugs: offered,
      }),
    ).toEqual({ provider: "pi", model: "anthropic/claude-sonnet-4-6" });
  });
});
