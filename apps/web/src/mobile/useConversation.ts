// FILE: mobile/useConversation.ts
// Purpose: One task's conversation for the phone: its messages as they stream, the question
//          it is waiting on, and the three things the phone can do about it (send, stop,
//          answer). The desktop's timeline machinery is not involved — a phone shows text.
// Layer: Mobile data
// Depends on: the WS native API (`orchestration.subscribeThread` + dispatchCommand).
// Exports: useConversation, pendingApprovalOf, type ConversationMessage

import { ThreadId } from "@peakcode/contracts";
import type {
  ApprovalRequestId,
  ModelSelection,
  OrchestrationEvent,
  OrchestrationMessage,
  OrchestrationThread,
  OrchestrationThreadActivity,
  ProviderApprovalDecision,
  ProviderInteractionMode,
  RuntimeMode,
} from "@peakcode/contracts";

import { useCallback, useEffect, useRef, useState } from "react";

import { newCommandId, newMessageId } from "../lib/utils";
import { readNativeApi } from "../nativeApi";

export type ConversationMessage = Pick<
  OrchestrationMessage,
  "id" | "role" | "text" | "streaming" | "createdAt" | "updatedAt"
>;

export interface PendingApproval {
  readonly requestId: ApprovalRequestId;
  readonly summary: string;
  readonly detail: string | null;
}

export interface ConversationState {
  readonly status: "loading" | "ready" | "unavailable";
  readonly title: string;
  readonly messages: ReadonlyArray<ConversationMessage>;
  readonly pendingApproval: PendingApproval | null;
  readonly running: boolean;
  readonly lastActivitySummary: string | null;
  readonly sending: boolean;
  readonly error: string | null;
  /** The thread's own model, which a reply keeps whenever the provider still serves it. */
  readonly modelSelection: ModelSelection | null;
  /** The thread's own execution settings; a reply must not change what the desktop chose. */
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
}

export interface ConversationActions {
  /** `replyModelSelection` names the model only when the thread's own is unavailable. */
  readonly send: (text: string, replyModelSelection?: ModelSelection | null) => Promise<void>;
  readonly stop: () => Promise<void>;
  readonly respondToApproval: (decision: ProviderApprovalDecision) => Promise<void>;
}

/** The question this conversation is parked on, if any. */
export function pendingApprovalOf(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): PendingApproval | null {
  const resolved = new Set<string>();
  let pending: PendingApproval | null = null;
  for (const activity of activities) {
    const payload = activity.payload as { requestId?: unknown; detail?: unknown } | null;
    const requestId = payload?.requestId;
    if (typeof requestId !== "string" || requestId.length === 0) continue;
    if (activity.kind === "approval.resolved") {
      resolved.add(requestId);
      if (pending?.requestId === requestId) pending = null;
      continue;
    }
    if (activity.kind !== "approval.requested") continue;
    pending = {
      requestId: requestId as ApprovalRequestId,
      summary: activity.summary,
      detail: typeof payload?.detail === "string" ? payload.detail : null,
    };
  }
  return pending === null || resolved.has(pending.requestId) ? null : pending;
}

function upsertMessage(
  messages: ReadonlyArray<ConversationMessage>,
  message: ConversationMessage,
): ReadonlyArray<ConversationMessage> {
  const index = messages.findIndex((candidate) => candidate.id === message.id);
  if (index === -1) return [...messages, message];
  const next = messages.slice();
  next[index] = message;
  return next;
}

/**
 * Fold one thread event into what the phone is showing.
 *
 * Only the events a phone can render are handled: messages, the session's running state,
 * and activities (which carry the approval question). Everything else — diffs, plans,
 * checkpoints, subagent plumbing — belongs to the desktop and is ignored here.
 */
export function applyConversationEvent(
  state: ConversationState,
  event: OrchestrationEvent,
): ConversationState {
  switch (event.type) {
    case "thread.message-sent": {
      if (event.payload.role === "system") return state;
      return {
        ...state,
        messages: upsertMessage(state.messages, {
          id: event.payload.messageId,
          role: event.payload.role,
          text: event.payload.text,
          streaming: event.payload.streaming,
          createdAt: event.payload.createdAt,
          updatedAt: event.occurredAt,
        }),
      };
    }
    case "thread.session-set": {
      const status = event.payload.session.status;
      const running = status === "starting" || status === "running";
      const lastError = event.payload.session.lastError;
      return {
        ...state,
        running: running || state.running,
        error: lastError ?? state.error,
      };
    }
    case "thread.activity-appended": {
      const activity = event.payload.activity;
      if (activity.tone === "error") return { ...state, error: activity.summary };
      return {
        ...state,
        lastActivitySummary: activity.summary,
        running: activity.kind === "turn.completed" ? false : state.running,
      };
    }
    case "thread.meta-updated":
      return event.payload.title === undefined ? state : { ...state, title: event.payload.title };
    case "thread.runtime-mode-set":
      return { ...state, runtimeMode: event.payload.runtimeMode };
    case "thread.interaction-mode-set":
      return { ...state, interactionMode: event.payload.interactionMode };
    case "thread.turn-start-requested":
      return { ...state, running: true, error: null };
    default:
      return state;
  }
}

function conversationFromThread(thread: OrchestrationThread): ConversationState {
  const status = thread.session?.status ?? null;
  return {
    status: "ready",
    title: thread.title,
    messages: thread.messages
      .filter((message) => message.role !== "system")
      .map((message) => ({
        id: message.id,
        role: message.role,
        text: message.text,
        streaming: message.streaming,
        createdAt: message.createdAt,
        updatedAt: message.updatedAt,
      })),
    pendingApproval: pendingApprovalOf(thread.activities),
    running:
      thread.latestTurn?.state === "running" || status === "starting" || status === "running",
    lastActivitySummary: null,
    sending: false,
    error: thread.session?.lastError ?? null,
    modelSelection: thread.modelSelection,
    runtimeMode: thread.runtimeMode,
    interactionMode: thread.interactionMode,
  };
}

const EMPTY_CONVERSATION: ConversationState = {
  status: "loading",
  title: "",
  messages: [],
  pendingApproval: null,
  running: false,
  lastActivitySummary: null,
  sending: false,
  error: null,
  modelSelection: null,
  runtimeMode: "approval-required",
  interactionMode: "default",
};

/**
 * Follow one conversation on the phone.
 *
 * The stream carries the whole thread first and events afterwards, so a reconnect or a
 * return from the background re-reads the truth instead of replaying a diff.
 */
export function useConversation(threadId: string | null): ConversationState & ConversationActions {
  const [state, setState] = useState<ConversationState>(EMPTY_CONVERSATION);
  const threadIdRef = useRef<string | null>(null);

  useEffect(() => {
    threadIdRef.current = threadId;
    if (threadId === null) {
      setState(EMPTY_CONVERSATION);
      return;
    }
    const api = readNativeApi();
    if (!api) {
      setState({ ...EMPTY_CONVERSATION, status: "unavailable" });
      return;
    }

    setState(EMPTY_CONVERSATION);
    const unsubscribe = api.orchestration.onThreadEvent((item) => {
      if (item.kind === "snapshot") {
        if (item.snapshot.thread.id !== threadId) return;
        setState(conversationFromThread(item.snapshot.thread));
        return;
      }
      if (item.event.aggregateId !== threadId) return;
      setState((current) => applyConversationEvent(current, item.event));
    });

    void api.orchestration
      .subscribeThread({ threadId: ThreadId.makeUnsafe(threadId) })
      .catch(() => {
        if (threadIdRef.current === threadId) {
          setState({ ...EMPTY_CONVERSATION, status: "unavailable" });
        }
      });

    return () => {
      unsubscribe();
      void api.orchestration
        .unsubscribeThread({ threadId: ThreadId.makeUnsafe(threadId) })
        .catch(() => {});
    };
  }, [threadId]);

  const reportFailure = useCallback((error: unknown) => {
    setState((current) => ({
      ...current,
      error: error instanceof Error ? error.message : String(error),
    }));
  }, []);

  const send = useCallback(
    async (text: string, replyModelSelection?: ModelSelection | null) => {
      const api = readNativeApi();
      const target = threadIdRef.current;
      if (!api || target === null || text.trim().length === 0) return;
      setState((current) => ({ ...current, sending: true, error: null }));
      try {
        await api.orchestration.dispatchCommand({
          type: "thread.turn.start",
          commandId: newCommandId(),
          threadId: ThreadId.makeUnsafe(target),
          message: {
            messageId: newMessageId(),
            role: "user",
            text,
            attachments: [],
          },
          // The desktop already decided how this thread runs; a reply from the phone must
          // not change that — the model is only named when the thread's own is gone.
          ...(replyModelSelection === undefined || replyModelSelection === null
            ? {}
            : { modelSelection: replyModelSelection }),
          runtimeMode: state.runtimeMode,
          interactionMode: state.interactionMode,
          assistantDeliveryMode: "streaming",
          createdAt: new Date().toISOString(),
        });
      } catch (error) {
        reportFailure(error);
      } finally {
        setState((current) => ({ ...current, sending: false }));
      }
    },
    [reportFailure, state.interactionMode, state.runtimeMode],
  );

  const stop = useCallback(async () => {
    const api = readNativeApi();
    const target = threadIdRef.current;
    if (!api || target === null) return;
    try {
      await api.orchestration.dispatchCommand({
        type: "thread.turn.interrupt",
        commandId: newCommandId(),
        threadId: ThreadId.makeUnsafe(target),
        createdAt: new Date().toISOString(),
      });
    } catch (error) {
      reportFailure(error);
    }
  }, [reportFailure]);

  const respondToApproval = useCallback(
    async (decision: ProviderApprovalDecision) => {
      const api = readNativeApi();
      const target = threadIdRef.current;
      const requestId = state.pendingApproval?.requestId;
      if (!api || target === null || requestId === undefined) return;
      // Answering is the phone's only say in a paused run, so clear the prompt right away
      // and let the stream's `approval.resolved` activity confirm it.
      setState((current) => ({ ...current, pendingApproval: null }));
      try {
        await api.orchestration.dispatchCommand({
          type: "thread.approval.respond",
          commandId: newCommandId(),
          threadId: ThreadId.makeUnsafe(target),
          requestId,
          decision,
          createdAt: new Date().toISOString(),
        });
      } catch (error) {
        reportFailure(error);
      }
    },
    [reportFailure, state.pendingApproval],
  );

  return { ...state, send, stop, respondToApproval };
}
