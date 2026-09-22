/**
 * The delegation payload is a contract with two consumers, so what matters here is not the shape
 * but the *reading* of it: the same decoders the web sidebar and transcript use are run over the
 * built item. If this test passes, a Multi-Agent turn's workers can be drawn without the UI
 * knowing anything about how they were executed.
 */
import { describe, expect, it } from "vitest";

import {
  buildSubagentDelegationItem,
  delegationProgressMessage,
  delegationSettleMessage,
  type PiDelegatedWorker,
} from "./piSubagentDelegation.ts";
import {
  collectSubagentProviderThreadIds,
  decodeSubagentAgentStates,
  decodeSubagentReceiverAgents,
  extractSubagentIdentityHints,
  resolveSubagentIdentityFromDirectory,
  buildSubagentIdentityDirectory,
} from "@peakcode/shared/subagents";

function worker(overrides: Partial<PiDelegatedWorker> = {}): PiDelegatedWorker {
  return {
    providerThreadId: "explore-11111111",
    workerId: "explore",
    name: "Explore",
    description: "map the parser",
    status: "running",
    ...overrides,
  };
}

describe("buildSubagentDelegationItem", () => {
  it("publishes each worker's live progress so the card can draw it without the child thread", () => {
    // The card used to read a worker's steps only from its child thread, a second subscription
    // over a second fetch. When that had not landed, a worker 167 tool calls deep rendered as
    // "waiting for its first step" — indistinguishable from a worker that never started.
    const item = buildSubagentDelegationItem({
      workers: [
        worker({
          progress: {
            steps: 12,
            lastStep: "grep applyOrchestrationEventsHotPath",
            lastStepAt: "2026-09-22T10:00:07.000Z",
            startedAt: "2026-09-22T10:00:00.000Z",
          },
        }),
      ],
      settled: false,
    });

    const states = decodeSubagentAgentStates(item);
    expect(states["explore-11111111"]?.steps).toBe(12);
    expect(states["explore-11111111"]?.lastStep).toBe("grep applyOrchestrationEventsHotPath");
    expect(states["explore-11111111"]?.lastStepAt).toBe("2026-09-22T10:00:07.000Z");
    expect(states["explore-11111111"]?.startedAt).toBe("2026-09-22T10:00:00.000Z");
  });

  it("publishes the worker's recent steps, oldest first, as its expandable record", () => {
    // The card expands a node into this list, so it has to arrive in order and survive decoding:
    // "it made 15 calls" is not the same answer as "here is what they were".
    const item = buildSubagentDelegationItem({
      workers: [
        worker({
          progress: {
            steps: 15,
            recentSteps: [
              { id: "call-1", title: "read_file" },
              { id: "call-2", title: "list_dir" },
              // The same tool twice: two entries, not one, because the ids differ.
              { id: "call-3", title: "read_file" },
            ],
          },
        }),
      ],
      settled: false,
    });

    expect(decodeSubagentAgentStates(item)["explore-11111111"]?.recentSteps).toEqual([
      { id: "call-1", title: "read_file" },
      { id: "call-2", title: "list_dir" },
      { id: "call-3", title: "read_file" },
    ]);
  });

  it("omits progress for a worker that has not started anything yet", () => {
    const item = buildSubagentDelegationItem({ workers: [worker()], settled: false });
    const states = decodeSubagentAgentStates(item);
    expect(states["explore-11111111"]?.steps).toBeUndefined();
    expect(states["explore-11111111"]?.lastStep).toBeUndefined();
  });

  it("exposes every worker of the delegation with name, role and task", () => {
    const item = buildSubagentDelegationItem({
      workers: [
        worker(),
        worker({
          providerThreadId: "general-22222222",
          workerId: "general",
          name: "General",
          description: "fix the loader",
          status: "completed",
        }),
      ],
      settled: false,
    });

    expect(item.tool).toBe("spawnAgent");
    expect(item.status).toBe("inProgress");
    expect(item.receiverThreadIds).toEqual(["explore-11111111", "general-22222222"]);

    const receiverThreadIds = collectSubagentProviderThreadIds(item);
    expect(receiverThreadIds).toEqual(["explore-11111111", "general-22222222"]);

    const agents = decodeSubagentReceiverAgents(item, receiverThreadIds);
    expect(agents.map((agent) => [agent.nickname, agent.role, agent.prompt])).toEqual([
      ["Explore", "explore", "map the parser"],
      ["General", "general", "fix the loader"],
    ]);
  });

  it("reports an inherited model as requested but a bound model as the worker's own", () => {
    // Load-bearing: the ingestion pins the child thread's model selection to any model that is
    // not marked as merely requested. A worker that inherits the orchestrator's model must show
    // it without being pinned to it.
    const item = buildSubagentDelegationItem({
      workers: [
        worker(),
        worker({
          providerThreadId: "general-22222222",
          workerId: "general",
          name: "General",
          model: "openai/gpt-5-mini",
        }),
      ],
      inheritedModel: "deepseek/deepseek-chat",
      settled: false,
    });

    const agents = decodeSubagentReceiverAgents(item, collectSubagentProviderThreadIds(item));
    expect(agents[0]?.model).toBe("deepseek/deepseek-chat");
    expect(agents[0]?.modelIsRequestedHint).toBe(true);
    expect(agents[1]?.model).toBe("openai/gpt-5-mini");
    // The decoder omits the flag for a worker's own model, which is what marks it as real.
    expect(agents[1]?.modelIsRequestedHint).not.toBe(true);
  });

  it("carries each worker's live status and latest line for the card rows", () => {
    const item = buildSubagentDelegationItem({
      workers: [
        worker({ message: "map the parser" }),
        worker({
          providerThreadId: "general-22222222",
          workerId: "general",
          name: "General",
          status: "failed",
          message: "9 steps · tool crashed",
        }),
      ],
      settled: true,
    });

    expect(decodeSubagentAgentStates(item)).toMatchObject({
      "explore-11111111": { status: "running", message: "map the parser" },
      "general-22222222": { status: "failed", message: "9 steps · tool crashed" },
    });
  });

  it("gives the sidebar one resolvable identity per worker thread", () => {
    const item = buildSubagentDelegationItem({
      workers: [
        worker(),
        worker({
          providerThreadId: "general-22222222",
          workerId: "general",
          name: "General",
        }),
      ],
      settled: true,
    });

    const directory = buildSubagentIdentityDirectory(extractSubagentIdentityHints(item));
    expect(
      resolveSubagentIdentityFromDirectory(directory, { providerThreadId: "general-22222222" }),
    ).toMatchObject({ nickname: "General", role: "general" });
  });

  it("does not put a model on the agent states", () => {
    // Agent-state entries are also read as identity hints and that path has no "requested"
    // flag, so a model there would be applied to the child thread.
    const item = buildSubagentDelegationItem({
      workers: [worker()],
      inheritedModel: "deepseek/deepseek-chat",
      settled: false,
    });
    const states = item.agentStates as Record<string, Record<string, unknown>>;
    expect(states["explore-11111111"]).not.toHaveProperty("model");
    expect(states["explore-11111111"]).not.toHaveProperty("requestedModel");
  });

  it("states how many workers are done, and closes when the last one lands", () => {
    const running = buildSubagentDelegationItem({
      workers: [worker(), worker({ providerThreadId: "b", status: "completed" })],
      settled: false,
    });
    expect(running.message).toBe("1/2 finished");
    expect(running.status).toBe("inProgress");

    const settled = buildSubagentDelegationItem({
      workers: [
        worker({ status: "completed" }),
        worker({ providerThreadId: "b", status: "failed" }),
      ],
      settled: true,
    });
    expect(settled.message).toBe("2/2 finished");
    expect(settled.status).toBe("completed");
  });
});

describe("stopped workers", () => {
  it("closes the card and reports stopped rather than failed", () => {
    // A worker the user ended did not break: calling it "failed" would misreport the run.
    const item = buildSubagentDelegationItem({
      workers: [
        worker({ status: "completed" }),
        worker({ providerThreadId: "general-22222222", status: "stopped", message: "Stopped." }),
      ],
      settled: true,
    });

    expect(item.message).toBe("2/2 finished");
    expect(item.status).toBe("completed");
    expect(decodeSubagentAgentStates(item)["general-22222222"]).toMatchObject({
      status: "stopped",
      message: "Stopped.",
    });
  });
});

describe("delegationProgressMessage", () => {
  it("has nothing to say about a delegation with no workers", () => {
    expect(delegationProgressMessage([])).toBeNull();
  });
});

describe("delegationSettleMessage", () => {
  it("keeps the worker's size and the head of its conclusion on one line", () => {
    expect(
      delegationSettleMessage({ steps: 12, answer: "\n\nFound 3 call sites.\nMore detail." }),
    ).toBe("12 steps · Found 3 call sites.");
  });

  it("falls back to whichever half it has", () => {
    expect(delegationSettleMessage({ steps: 0, answer: "Done." })).toBe("Done.");
    expect(delegationSettleMessage({ steps: 4 })).toBe("4 steps");
    expect(delegationSettleMessage({})).toBeUndefined();
  });

  it("caps a long conclusion instead of pushing a wall of text into the card", () => {
    const message = delegationSettleMessage({ answer: "x".repeat(400) })!;
    expect(message.length).toBeLessThanOrEqual(160);
    expect(message.endsWith("...")).toBe(true);
  });
});
