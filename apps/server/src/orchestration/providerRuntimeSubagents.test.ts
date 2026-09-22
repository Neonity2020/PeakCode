/**
 * A child thread's title is the only handle a user has on a worker in the sidebar, so the case
 * worth pinning is the one Multi-Agent mode creates constantly: the same worker dispatched
 * several times in one turn.
 */
import { describe, expect, it } from "vitest";

import { subagentThreadTitle } from "./providerRuntimeSubagents.ts";

describe("subagentThreadTitle", () => {
  it("names the worker by identity and, when it has one, by the task it was given", () => {
    expect(
      subagentThreadTitle({
        nickname: "Explore",
        role: "explore",
        providerThreadId: "explore-1",
        prompt: "map the parser",
      }),
    ).toBe("Explore [explore] · map the parser");
  });

  it("tells same-named workers apart by their task", () => {
    const titles = ["map the parser", "audit the loader"].map((prompt) =>
      subagentThreadTitle({ nickname: "Explore", role: "explore", prompt }),
    );
    expect(new Set(titles).size).toBe(2);
  });

  it("falls back through role, then provider id, then a bare label", () => {
    expect(subagentThreadTitle({ role: "explore" })).toBe("Subagent [explore]");
    expect(subagentThreadTitle({ providerThreadId: "explore-1" })).toBe("Subagent explore-1");
    expect(subagentThreadTitle({})).toBe("Subagent");
    // A whitespace-only task must not leave a dangling separator.
    expect(subagentThreadTitle({ nickname: "Explore", role: "explore", prompt: "   " })).toBe(
      "Explore [explore]",
    );
  });
});
