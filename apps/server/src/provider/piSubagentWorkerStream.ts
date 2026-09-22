/**
 * PiSubagentWorkerStream - Mirrors a worker session's events into its own child thread.
 *
 * @module PiSubagentWorkerStream
 */

/**
 * Why this module exists.
 *
 * A `task` worker runs in an in-memory session, and by default only its closing answer ever
 * reaches anyone: the transcript got a subagent card, but opening a worker's child thread showed
 * an empty conversation, and "what is it doing right now" had no answer at all.
 *
 * The fix is to stop treating the worker as a black box. Its session emits the same
 * `AgentSessionEvent`s the main session does; forwarding those into the child thread turns that
 * thread into a real transcript — every tool call the worker made, its assistant text, and a turn
 * boundary that lets the thread's status settle. That transcript is what the card's rows open.
 *
 * This is deliberately a *narrower* mapping than the main session's handler, not a copy of it. A
 * worker has no goals, plans, approvals, todos, extensions or user to ask, so the events that
 * matter are just: a turn starts, tools run, text streams, the turn ends. The main handler's
 * other branches have nothing to say here, and reaching for them would mean threading worker
 * identity through code that assumes it is driving a real PeakCode thread.
 *
 * Identity is borrowed from the delegation card: `providerThreadId` is the id the card published
 * for this worker and `providerParentThreadId` is the orchestrator's session id. The
 * orchestration ingestion routes an event carrying both refs into the child thread keyed
 * `subagent:<parentThreadId>:<providerThreadId>` — the same thread the card's rows open.
 */
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import {
  EventId,
  RuntimeItemId,
  TurnId,
  type ProviderKind,
  type ProviderRuntimeEvent,
  type ThreadId,
} from "@peakcode/contracts";

import {
  textFromToolResult,
  toolItemType,
  toolLifecycleData,
  toolTitle,
} from "./piToolPresentation.ts";

/** The ids that bind a worker's events to the child thread the delegation card already created. */
export interface SubagentStreamIdentity {
  readonly provider: ProviderKind;
  /** The local PeakCode thread the delegation ran from (the event's `threadId`). */
  readonly threadId: ThreadId;
  /** The worker's id as published on the delegation card. */
  readonly providerThreadId: string;
  /** The orchestrator's provider session id. */
  readonly providerParentThreadId: string;
}

export interface SubagentStreamOptions extends SubagentStreamIdentity {
  readonly emit: (event: ProviderRuntimeEvent) => void;
  /**
   * Called for every event the worker produces, including the ones this module ignores.
   *
   * It exists so the caller can tell a busy worker from a silent one: anything the session says
   * counts as liveness, even when it is not something the child thread needs to show. A started
   * tool call also carries what it was, which is what the card shows as "doing X right now".
   */
  readonly onActivity?: ((step?: SubagentToolStep) => void) | undefined;
}

/** A tool call the worker just started, as the delegation card reports progress. */
export interface SubagentToolStep {
  readonly toolCallId: string;
  readonly summary: string;
}

export interface SubagentStream {
  /** Feed one worker session event. Wire this to `workerSession.subscribe`. */
  handle(event: AgentSessionEvent): void;
  /**
   * Close the worker's turn. This is the only thing that closes it — `agent_end` arrives once per
   * model round, so treating it as the end would finish the turn while the worker kept working.
   * Safe to call more than once.
   */
  finish(): void;
}

export function makeSubagentStream(options: SubagentStreamOptions): SubagentStream {
  const base = () => ({
    eventId: EventId.makeUnsafe(crypto.randomUUID()),
    provider: options.provider,
    threadId: options.threadId,
    createdAt: new Date().toISOString(),
    providerRefs: {
      providerThreadId: options.providerThreadId,
      providerParentThreadId: options.providerParentThreadId,
    },
  });
  const withTurn = <T extends object>(fields: T) => (turnId ? { ...fields, turnId } : fields);

  /**
   * One turn for the whole worker run.
   *
   * pi emits `turn_start` again for every model round within a single prompt, so minting an id
   * per event split one worker into several turns: the child thread ended up with a row per round
   * and, because nothing ever closed the last one cleanly, no "latest turn" at all — which is
   * what the UI reads to decide what is live. The main session keys a turn to its `sendTurn`
   * instead, and this mirrors that: the first `turn_start` starts the turn, the run ends it.
   */
  let turnId: TurnId | undefined;
  let emittedTurnStarted = false;
  let assistantItemId: RuntimeItemId | undefined;
  let finished = false;
  const activeToolItems = new Map<
    string,
    { itemId: RuntimeItemId; itemType: ReturnType<typeof toolItemType>; args: unknown }
  >();

  const finish = () => {
    if (finished) return;
    finished = true;
    if (assistantItemId) {
      options.emit({
        ...withTurn(base()),
        itemId: assistantItemId,
        type: "item.completed",
        payload: { itemType: "assistant_message", status: "completed", title: "Assistant" },
      } satisfies ProviderRuntimeEvent);
    }
    options.emit({
      ...withTurn(base()),
      type: "turn.completed",
      payload: { state: "completed", stopReason: null },
    } satisfies ProviderRuntimeEvent);
  };

  const handle = (event: AgentSessionEvent) => {
    // `tool_execution_start` reports its own step (with a title) below; everything else is just
    // liveness for the watchdog.
    if (event.type !== "tool_execution_start") options.onActivity?.();
    switch (event.type) {
      case "turn_start": {
        turnId ??= TurnId.makeUnsafe(crypto.randomUUID());
        if (emittedTurnStarted) return;
        emittedTurnStarted = true;
        options.emit({ ...withTurn(base()), type: "turn.started", payload: {} });
        return;
      }
      case "tool_execution_start": {
        const itemId = RuntimeItemId.makeUnsafe(`subagent-tool-${event.toolCallId}`);
        const itemType = toolItemType(event.toolName);
        const title = toolTitle(event.toolName, event.args);
        activeToolItems.set(event.toolCallId, { itemId, itemType, args: event.args });
        // Report progress before the event goes out: the card's "N steps · doing X right now"
        // is what makes a long-running worker readable, and it rides the delegation item rather
        // than the child thread (see `PiDelegationWorkerProgress`).
        options.onActivity?.({ toolCallId: event.toolCallId, summary: title });
        options.emit({
          ...withTurn(base()),
          itemId,
          type: "item.started",
          payload: {
            itemType,
            status: "inProgress",
            title,
            data: toolLifecycleData({
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              args: event.args,
            }),
          },
        } satisfies ProviderRuntimeEvent);
        return;
      }
      case "tool_execution_update": {
        const tracked = activeToolItems.get(event.toolCallId);
        if (!tracked) return;
        const detail = textFromToolResult(event.partialResult);
        options.emit({
          ...withTurn(base()),
          itemId: tracked.itemId,
          type: "item.updated",
          payload: {
            itemType: tracked.itemType,
            status: "inProgress",
            title: toolTitle(event.toolName, tracked.args),
            ...(detail ? { detail } : {}),
            data: toolLifecycleData({
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              args: tracked.args,
              partialResult: event.partialResult,
            }),
          },
        } satisfies ProviderRuntimeEvent);
        return;
      }
      case "tool_execution_end": {
        const tracked = activeToolItems.get(event.toolCallId) ?? {
          itemId: RuntimeItemId.makeUnsafe(`subagent-tool-${event.toolCallId}`),
          itemType: toolItemType(event.toolName),
          args: undefined,
        };
        activeToolItems.delete(event.toolCallId);
        const detail = textFromToolResult(event.result);
        options.emit({
          ...withTurn(base()),
          itemId: tracked.itemId,
          type: "item.completed",
          payload: {
            itemType: tracked.itemType,
            status: event.isError ? "failed" : "completed",
            title: toolTitle(event.toolName, tracked.args),
            ...(detail ? { detail } : {}),
            data: toolLifecycleData({
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              args: tracked.args,
              result: event.result,
              isError: event.isError,
            }),
          },
        } satisfies ProviderRuntimeEvent);
        return;
      }
      case "message_update": {
        if (event.message.role !== "assistant") return;
        const update = event.assistantMessageEvent;
        // Reasoning deltas stay out: the child thread answers "what did this worker actually
        // do", and its private thinking adds volume without answering that.
        if (update.type !== "text_delta") return;
        if (!assistantItemId) {
          assistantItemId = RuntimeItemId.makeUnsafe(`subagent-assistant-${crypto.randomUUID()}`);
          options.emit({
            ...withTurn(base()),
            itemId: assistantItemId,
            type: "item.started",
            payload: { itemType: "assistant_message", status: "inProgress", title: "Assistant" },
          } satisfies ProviderRuntimeEvent);
        }
        options.emit({
          ...withTurn(base()),
          itemId: assistantItemId,
          type: "content.delta",
          payload: {
            streamKind: "assistant_text",
            delta: update.delta,
            contentIndex: update.contentIndex,
          },
        } satisfies ProviderRuntimeEvent);
        return;
      }
      default:
        return;
    }
  };

  return { handle, finish };
}
