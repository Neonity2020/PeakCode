// FILE: subagentProgress.test.ts
// Purpose: Pins the arithmetic the delegation card's worker nodes show.

import type { OrchestrationThreadActivity } from "@peakcode/contracts";
import { describe, expect, it } from "vitest";

import {
  deriveSubagentProgress,
  formatSubagentDuration,
  formatSubagentSilence,
  shouldOfferWorkerStop,
  SUBAGENT_SILENCE_WARN_MS,
} from "./subagentProgress";

/**
 * The shape the orchestration ingestion stores: item fields at the top level and the provider's
 * own tool fields (`toolCallId`, name, args) nested under `data` — which is where
 * `extractToolCallId` looks for the call identity.
 */
function activity(
  kind: OrchestrationThreadActivity["kind"],
  createdAt: string,
  payload: Record<string, unknown>,
  summary = "Tool call",
): OrchestrationThreadActivity {
  return {
    id: `${kind}-${createdAt}`,
    createdAt,
    kind,
    tone: "tool",
    summary,
    payload,
    turnId: null,
  } as OrchestrationThreadActivity;
}

const at = (seconds: number) => `2026-09-22T10:00:${String(seconds).padStart(2, "0")}.000Z`;

describe("deriveSubagentProgress", () => {
  it("counts a tool call once even though it reports start and completion", () => {
    const progress = deriveSubagentProgress([
      activity("tool.started", at(1), {
        itemType: "command_execution",
        data: { toolCallId: "call-1", toolName: "bash" },
      }),
      activity("tool.completed", at(3), {
        itemType: "command_execution",
        data: { toolCallId: "call-1", toolName: "bash" },
      }),
      activity("tool.started", at(4), {
        itemType: "command_execution",
        data: { toolCallId: "call-2", toolName: "bash" },
      }),
      activity("tool.completed", at(9), {
        itemType: "command_execution",
        data: { toolCallId: "call-2", toolName: "bash" },
      }),
    ]);

    expect(progress.steps).toBe(2);
    expect(progress.elapsedMs).toBe(8000);
  });

  it("ignores everything that is not a step the worker took", () => {
    const progress = deriveSubagentProgress([
      activity("turn.started", at(1), {}, "Turn started"),
      activity("message.assistant", at(2), {}, "Assistant"),
      activity("tool.completed", at(5), {
        itemType: "web_search",
        data: { toolCallId: "call-1", toolName: "grep" },
      }),
    ]);

    expect(progress.steps).toBe(1);
  });

  it("reports what the worker is doing right now, readably", () => {
    const progress = deriveSubagentProgress([
      activity(
        "tool.completed",
        at(1),
        {
          itemType: "command_execution",
          title: "bun run test",
          data: { toolCallId: "call-1", toolName: "bash", args: { command: "bun run test" } },
        },
        "bun run test",
      ),
      activity(
        "tool.started",
        at(6),
        {
          itemType: "dynamic_tool_call",
          title: "grep TODO",
          data: { toolCallId: "call-2", toolName: "grep", args: { pattern: "TODO" } },
        },
        "grep TODO",
      ),
    ]);

    expect(progress.latestStep).toBe("grep TODO");
    // The card turns this into "how long ago", which is what separates busy from wedged.
    expect(progress.latestStepAt).toBe(at(6));
  });

  it("has nothing to report before the worker's first step", () => {
    expect(deriveSubagentProgress([])).toEqual({
      steps: 0,
      elapsedMs: null,
      latestStep: null,
      latestStepAt: null,
    });
    expect(deriveSubagentProgress([activity("turn.started", at(1), {})])).toEqual({
      steps: 0,
      elapsedMs: null,
      latestStep: null,
      latestStepAt: null,
    });
  });
});

describe("formatSubagentSilence", () => {
  it("counts up in seconds, then minutes", () => {
    expect(formatSubagentSilence(0)).toBe("0s");
    expect(formatSubagentSilence(12_400)).toBe("12s");
    expect(formatSubagentSilence(90_000)).toBe("1m 30s");
    expect(formatSubagentSilence(3 * 60_000 + 4_000)).toBe("3m 4s");
  });

  it("never goes negative on a clock that disagrees with the server", () => {
    expect(formatSubagentSilence(-5_000)).toBe("0s");
  });

  it("warns only after real silence, not after a single slow tool call", () => {
    // Well under a normal tool call: a worker reading a large file must not look wedged.
    expect(SUBAGENT_SILENCE_WARN_MS).toBeGreaterThan(60_000);
  });
});

describe("formatSubagentDuration", () => {
  it("stays silent under a second and switches to minutes past a minute", () => {
    expect(formatSubagentDuration(null)).toBeNull();
    expect(formatSubagentDuration(940)).toBeNull();
    expect(formatSubagentDuration(12_000)).toBe("12s");
    expect(formatSubagentDuration(68_000)).toBe("1m 8s");
    expect(formatSubagentDuration(6 * 60_000 + 26_000)).toBe("6m 26s");
  });
});

describe("shouldOfferWorkerStop", () => {
  it("offers stop for a worker that is still out", () => {
    expect(
      shouldOfferWorkerStop({
        providerThreadId: "explore-1",
        statusLabel: "Running",
        isActive: true,
      }),
    ).toBe(true);
    // The payload's own word counts too: a worker whose label has not been derived yet is still
    // addressable by its delegation id.
    expect(shouldOfferWorkerStop({ providerThreadId: "explore-1", rawStatus: "running" })).toBe(
      true,
    );
  });

  it("does not offer stop for a worker that already came back", () => {
    for (const statusLabel of ["Completed", "Failed", "Stopped", "Interrupted", "Idle", "Closed"]) {
      expect(
        shouldOfferWorkerStop({ providerThreadId: "explore-1", statusLabel, isActive: false }),
        statusLabel,
      ).toBe(false);
    }
  });

  it("does not offer stop without a delegation id to address", () => {
    // The id is the key the runtime registry holds live workers under; without it there is
    // nothing to stop, however busy the row looks.
    expect(shouldOfferWorkerStop({ statusLabel: "Running", isActive: true })).toBe(false);
  });
});
