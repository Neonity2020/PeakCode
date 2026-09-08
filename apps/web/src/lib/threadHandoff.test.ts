import { type ModelSelection } from "@peakcode/contracts";
import { describe, expect, it } from "vitest";
import {
  resolveAvailableHandoffTargetProviders,
  resolveThreadHandoffTitle,
  resolveThreadHandoffModelSelection,
} from "./threadHandoff";

describe("threadHandoff", () => {
  it("lists no alternative handoff targets when only Pi is available", () => {
    expect(resolveAvailableHandoffTargetProviders("pi")).toEqual([]);
  });

  it("preserves the source thread title for the created handoff thread", () => {
    expect(resolveThreadHandoffTitle({ title: "General Greeting" })).toBe("General Greeting");
    expect(resolveThreadHandoffTitle({ title: "  Debug   Pi handoff  " })).toBe("Debug Pi handoff");
  });

  it("prefers sticky model selection for the chosen handoff target", () => {
    const stickySelection = {
      provider: "pi",
      model: "pi-coder-xl",
    } satisfies ModelSelection;

    expect(
      resolveThreadHandoffModelSelection({
        sourceThread: {
          modelSelection: {
            provider: "pi",
            model: "pi-coder-m",
          },
        },
        targetProvider: "pi",
        projectDefaultModelSelection: {
          provider: "pi",
          model: "pi-coder-l",
        },
        stickyModelSelectionByProvider: {
          pi: stickySelection,
        },
      }),
    ).toEqual(stickySelection);
  });

  it("falls back to the project default when no sticky selection exists", () => {
    expect(
      resolveThreadHandoffModelSelection({
        sourceThread: {
          modelSelection: {
            provider: "pi",
            model: "pi-coder-m",
          },
        },
        targetProvider: "pi",
        projectDefaultModelSelection: {
          provider: "pi",
          model: "pi-coder-l",
        },
        stickyModelSelectionByProvider: {},
      }),
    ).toEqual({
      provider: "pi",
      model: "pi-coder-l",
    });
  });

  it("throws when no compatible model can be resolved for Pi", () => {
    expect(() =>
      resolveThreadHandoffModelSelection({
        sourceThread: {
          modelSelection: {
            provider: "pi",
            model: "pi-coder-m",
          },
        },
        targetProvider: "pi",
        projectDefaultModelSelection: null,
        stickyModelSelectionByProvider: {},
      }),
    ).toThrow("Select a Pi model before handing off to Pi.");
  });
});
