import "../../index.css";

import { describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { SubagentDelegationCard } from "./SubagentDelegationCard";
import type { WorkLogSubagent } from "../../session-logic";

/**
 * The card's per-worker stop.
 *
 * The rule behind it is unit-tested in `lib/subagentProgress.test.ts`; what is worth rendering for
 * is the *wiring*, because the node's body is a button of its own. A stop control nested inside it
 * would be invalid markup and the browser would drop the click, so the card renders the node as a
 * container with the body as the open target — and that is exactly the kind of thing only a real
 * render catches.
 */
const STOP_TITLE = "End this worker; the rest of the turn keeps going";

function worker(overrides: Partial<WorkLogSubagent> = {}): WorkLogSubagent {
  return {
    threadId: "explore-abc12345",
    providerThreadId: "explore-abc12345",
    resolvedThreadId: "subagent:thread-parent:explore-abc12345",
    agentId: "explore",
    nickname: "Explore",
    role: "explore",
    model: "qwen3.8-27b",
    prompt: "map the parser",
    rawStatus: "running",
    statusLabel: "Running",
    isActive: true,
    steps: 12,
    elapsedMs: 65_000,
    latestStep: "grep parser",
    latestStepAt: new Date().toISOString(),
    recentSteps: [
      { id: "call-1", title: "read_file" },
      { id: "call-2", title: "list_dir" },
      { id: "call-3", title: "grep parser" },
    ],
    ...overrides,
  };
}

async function renderCard(subagents: WorkLogSubagent[], onStopWorker?: (id: string) => void) {
  return await render(
    <SubagentDelegationCard
      workEntry={{ id: "collab-1", subagents }}
      chatMetaFontSizePx={12}
      textFontSizePx={13}
      {...(onStopWorker ? { onStopWorker } : {})}
    />,
  );
}

describe("SubagentDelegationCard", () => {
  it("offers a stop on a running worker and reports its delegation id", async () => {
    const onStopWorker = vi.fn();
    const screen = await renderCard([worker()], onStopWorker);

    await page.getByTitle(STOP_TITLE).click();

    expect(onStopWorker).toHaveBeenCalledWith("explore-abc12345");
    await screen.unmount();
  });

  it("does not offer a stop on a worker that already came back", async () => {
    const screen = await renderCard(
      [worker({ statusLabel: "Completed", rawStatus: "completed", isActive: false })],
      vi.fn(),
    );

    expect(screen.container.querySelector("[data-subagent-stop]")).toBeNull();
    await screen.unmount();
  });

  it("expands a worker into its recent steps, in order", async () => {
    // This is the "click in and see what it is doing" surface. It reads the steps the worker's own
    // event stream published on the delegation item, so it works even when the worker's child
    // thread detail has not landed — the case that used to leave the node with nothing behind it.
    const screen = await renderCard([worker()]);

    expect(screen.container.querySelector("[data-subagent-record]")).toBeNull();

    await page.getByTitle("Show this worker's recent steps").click();

    const record = screen.container.querySelector("[data-subagent-record]");
    expect(record?.textContent).toContain("1.read_file");
    expect(record?.textContent).toContain("2.list_dir");
    expect(record?.textContent).toContain("3.grep parser");
    await screen.unmount();
  });

  it("does not offer the record for a worker that has not run anything yet", async () => {
    const screen = await renderCard([worker({ recentSteps: [], latestStep: undefined })]);

    expect(screen.container.querySelector("[data-subagent-record-toggle]")).toBeNull();
    await screen.unmount();
  });

  it("stops only the worker whose row it is", async () => {
    const onStopWorker = vi.fn();
    const screen = await renderCard(
      [
        worker(),
        worker({
          threadId: "general-def67890",
          providerThreadId: "general-def67890",
          resolvedThreadId: "subagent:thread-parent:general-def67890",
          agentId: "general",
          nickname: "General",
          role: "general",
          prompt: "fix the loader",
        }),
      ],
      onStopWorker,
    );

    await page.getByTitle(STOP_TITLE).first().click();

    expect(onStopWorker).toHaveBeenCalledTimes(1);
    expect(onStopWorker).toHaveBeenCalledWith("explore-abc12345");
    await screen.unmount();
  });
});
