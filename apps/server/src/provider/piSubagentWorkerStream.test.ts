/**
 * The stream's whole job is the payload it forwards: the child thread the card links to only
 * gets populated if every event carries *both* refs. So these tests assert identity on each
 * forwarded event, not just that something was emitted.
 */
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { ThreadId } from "@peakcode/contracts";
import { describe, expect, it } from "vitest";

import { makeSubagentStream } from "./piSubagentWorkerStream.ts";
import type { ProviderRuntimeEvent } from "@peakcode/contracts";

const threadId = ThreadId.makeUnsafe("thread-parent");

function collect() {
  const events: ProviderRuntimeEvent[] = [];
  const stream = makeSubagentStream({
    provider: "pi",
    threadId,
    providerThreadId: "explore-1a2b3c4d",
    providerParentThreadId: "parent-session-1",
    emit: (event) => events.push(event),
  });
  return { events, stream };
}

function workerRefs(event: ProviderRuntimeEvent) {
  const refs = (event as { providerRefs?: Record<string, string> }).providerRefs;
  return [refs?.providerThreadId, refs?.providerParentThreadId];
}

describe("makeSubagentStream", () => {
  it("routes every forwarded event into the worker's child thread", () => {
    const { events, stream } = collect();
    stream.handle({ type: "turn_start" } as AgentSessionEvent);
    stream.handle({
      type: "tool_execution_start",
      toolCallId: "call-1",
      toolName: "read",
      args: { path: "/tmp/a.ts" },
    } as unknown as AgentSessionEvent);
    stream.handle({
      type: "tool_execution_end",
      toolCallId: "call-1",
      toolName: "read",
      result: { ok: true },
      isError: false,
    } as unknown as AgentSessionEvent);
    stream.finish();

    expect(events.map((event) => event.type)).toEqual([
      "turn.started",
      "item.started",
      "item.completed",
      "turn.completed",
    ]);
    for (const event of events) {
      expect(event.threadId).toBe(threadId);
      expect(workerRefs(event)).toEqual(["explore-1a2b3c4d", "parent-session-1"]);
    }
    // Without a turn id the child thread's session status cannot settle.
    for (const event of events) {
      expect((event as { turnId?: string }).turnId).toBeTruthy();
    }
  });

  it("makes a worker's tool call readable as a step", () => {
    const { events, stream } = collect();
    stream.handle({ type: "turn_start" } as AgentSessionEvent);
    stream.handle({
      type: "tool_execution_start",
      toolCallId: "call-1",
      toolName: "bash",
      args: { command: "bun run test" },
    } as unknown as AgentSessionEvent);

    const started = events.at(-1);
    expect(started?.type).toBe("item.started");
    const payload = (started as { payload?: Record<string, unknown> }).payload;
    expect(payload?.itemType).toBe("command_execution");
    expect(payload?.title).toBe("bun run test");
  });

  it("streams the worker's assistant text so the thread is not just tool rows", () => {
    const { events, stream } = collect();
    stream.handle({ type: "turn_start" } as AgentSessionEvent);
    stream.handle({
      type: "message_update",
      message: { role: "assistant" },
      assistantMessageEvent: { type: "text_delta", delta: "Found ", contentIndex: 0 },
    } as unknown as AgentSessionEvent);
    stream.handle({
      type: "message_update",
      message: { role: "assistant" },
      assistantMessageEvent: { type: "text_delta", delta: "3 call sites.", contentIndex: 0 },
    } as unknown as AgentSessionEvent);

    expect(events.map((event) => event.type)).toEqual([
      "turn.started",
      "item.started",
      "content.delta",
      "content.delta",
    ]);
    // One assistant item for the whole turn: two `item.started`s would open two messages.
    expect(events.filter((event) => event.type === "item.started")).toHaveLength(1);
  });

  it("keeps the worker's private reasoning out of its thread", () => {
    const { events, stream } = collect();
    stream.handle({ type: "turn_start" } as AgentSessionEvent);
    stream.handle({
      type: "message_update",
      message: { role: "assistant" },
      assistantMessageEvent: { type: "thinking_delta", delta: "hmm", contentIndex: 0 },
    } as unknown as AgentSessionEvent);
    expect(events.map((event) => event.type)).toEqual(["turn.started"]);
  });

  it("closes the turn once, however often it is told to", () => {
    // A second `turn.completed` would reopen a settled child thread.
    const { events, stream } = collect();
    stream.handle({ type: "turn_start" } as AgentSessionEvent);
    stream.finish();
    stream.finish();
    expect(events.filter((event) => event.type === "turn.completed")).toHaveLength(1);
  });

  it("keeps one turn across pi's per-round turn_start, and does not end it early", () => {
    // pi restarts a "turn" for every model round inside one prompt. Minting an id per event split
    // a single worker into several turns and left the child thread with no latest turn; closing on
    // `agent_end` ended the turn while the worker was still working.
    const { events, stream } = collect();
    stream.handle({ type: "turn_start" } as AgentSessionEvent);
    stream.handle({
      type: "tool_execution_start",
      toolCallId: "call-1",
      toolName: "read",
      args: {},
    } as unknown as AgentSessionEvent);
    stream.handle({ type: "turn_start" } as AgentSessionEvent);
    stream.handle({ type: "agent_end" } as unknown as AgentSessionEvent);
    stream.handle({
      type: "tool_execution_start",
      toolCallId: "call-2",
      toolName: "read",
      args: {},
    } as unknown as AgentSessionEvent);
    stream.finish();

    expect(events.filter((event) => event.type === "turn.started")).toHaveLength(1);
    expect(events.filter((event) => event.type === "turn.completed")).toHaveLength(1);
    // Every event belongs to the one turn, so the child thread sees a single run.
    const turnIds = new Set(events.map((event) => (event as { turnId?: string }).turnId));
    expect(turnIds.size).toBe(1);
    expect(events.filter((event) => event.type === "item.started")).toHaveLength(2);
  });
});
