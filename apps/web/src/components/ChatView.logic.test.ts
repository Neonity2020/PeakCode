import { ProjectId, ThreadId, TurnId, type ModelSlug } from "@peakcode/contracts";
import { describe, expect, it } from "vitest";

import {
  appendVoiceTranscriptToPrompt,
  filterSidechatTranscriptMessages,
  type LocalDispatchSnapshot,
  deriveComposerSendState,
  deriveComposerVoiceState,
  describeVoiceRecordingStartError,
  hasServerAcknowledgedLocalDispatch,
  isVoiceAuthExpiredMessage,
  resolveActiveThreadTitle,
  resolveCommittedProviderModel,
  sanitizeVoiceErrorMessage,
  buildExpiredTerminalContextToastCopy,
  shouldAutoDeleteTerminalThreadOnLastClose,
  shouldConsumePendingCustomBinaryConfirmation,
  shouldShowComposerModelBootstrapSkeleton,
  shouldStartActiveTurnLayoutGrace,
  shouldRenderTerminalWorkspace,
  enrichSubagentWorkEntries,
} from "./ChatView.logic";
import type { Thread } from "../types";
import type { WorkLogEntry } from "../session-logic";

describe("voice helpers", () => {
  it("keeps manual titles visible for empty default-workspace chats", () => {
    expect(
      resolveActiveThreadTitle({
        title: "Roadmap scratchpad",
        subagentTitle: null,
        isDefaultWorkspace: true,
        isEmpty: true,
      }),
    ).toBe("Roadmap scratchpad");
  });

  it("maps untouched empty default-workspace chats to the friendly header label", () => {
    expect(
      resolveActiveThreadTitle({
        title: "New thread",
        subagentTitle: null,
        isDefaultWorkspace: true,
        isEmpty: true,
      }),
    ).toBe("New Chat");
  });

  it("prefers the resolved subagent label when present", () => {
    expect(
      resolveActiveThreadTitle({
        title: "Ignored raw title",
        subagentTitle: "Reviewer / Fix follow-up",
        isDefaultWorkspace: false,
        isEmpty: false,
      }),
    ).toBe("Reviewer / Fix follow-up");
  });

  it("hides fork-imported transcript rows only for sidechats", () => {
    const messages = [
      {
        id: "message-imported" as never,
        role: "assistant",
        text: "Previous context",
        turnId: null,
        streaming: false,
        source: "fork-import",
        createdAt: "2026-05-02T10:00:00.000Z",
        completedAt: "2026-05-02T10:00:00.000Z",
      },
      {
        id: "message-native" as never,
        role: "user",
        text: "Fresh side question",
        turnId: null,
        streaming: false,
        source: "native",
        createdAt: "2026-05-02T10:01:00.000Z",
        completedAt: "2026-05-02T10:01:00.000Z",
      },
    ] as const;

    expect(filterSidechatTranscriptMessages(messages, true).map((message) => message.id)).toEqual([
      "message-native",
    ]);
    expect(filterSidechatTranscriptMessages(messages, false).map((message) => message.id)).toEqual([
      "message-imported",
      "message-native",
    ]);
  });

  it("appends a transcript to the existing prompt without disturbing spacing", () => {
    expect(appendVoiceTranscriptToPrompt("Hello there   ", "  next line  ")).toBe(
      "Hello there\nnext line",
    );
  });

  it("returns null when the transcript is empty", () => {
    expect(appendVoiceTranscriptToPrompt("Hello", "   ")).toBeNull();
  });

  it("sanitizes inline stack traces from voice errors", () => {
    expect(
      sanitizeVoiceErrorMessage(
        "Your ChatGPT login has expired. Sign in again. at file:///Users/test/app.mjs:12:3",
      ),
    ).toBe("Your ChatGPT login has expired. Sign in again.");
  });

  it("strips desktop bridge wrappers from voice errors", () => {
    expect(
      sanitizeVoiceErrorMessage(
        "Error invoking remote method 'desktop:server-transcribe-voice': Error: The transcription response did not include any text.",
      ),
    ).toBe("The transcription response did not include any text.");
  });

  it("detects auth-expired copy in sanitized voice errors", () => {
    expect(isVoiceAuthExpiredMessage("Sign in again to ChatGPT")).toBe(true);
    expect(isVoiceAuthExpiredMessage("The microphone could not be opened.")).toBe(false);
  });

  it("maps microphone permission errors to clearer copy", () => {
    const error = new Error("Permission denied");
    error.name = "NotAllowedError";

    expect(describeVoiceRecordingStartError(error)).toContain("Microphone access was denied");
  });

  it("derives voice-note availability from provider auth and runtime state", () => {
    expect(
      deriveComposerVoiceState({
        authStatus: "authenticated",
        voiceTranscriptionAvailable: true,
        isRecording: false,
        isTranscribing: false,
      }),
    ).toEqual({
      canRenderVoiceNotes: true,
      canStartVoiceNotes: true,
      showVoiceNotesControl: true,
    });

    expect(
      deriveComposerVoiceState({
        authStatus: "unauthenticated",
        voiceTranscriptionAvailable: true,
        isRecording: true,
        isTranscribing: false,
      }),
    ).toEqual({
      canRenderVoiceNotes: false,
      canStartVoiceNotes: false,
      showVoiceNotesControl: true,
    });
  });
});

describe("shouldShowComposerModelBootstrapSkeleton", () => {
  it("shows a skeleton while a provider requires runtime-discovered models", () => {
    expect(
      shouldShowComposerModelBootstrapSkeleton({
        selectedProvider: "pi",
        selectedModel: "auto",
        persistedModelSelection: null,
        draftModelSelection: null,
        providerModelsLoading: true,
        requiresDiscoveredModels: true,
      }),
    ).toBe(true);
  });

  it("hides the skeleton for a provider requiring discovered models after loading completes", () => {
    expect(
      shouldShowComposerModelBootstrapSkeleton({
        selectedProvider: "pi",
        selectedModel: "auto",
        persistedModelSelection: null,
        draftModelSelection: null,
        providerModelsLoading: false,
        requiresDiscoveredModels: true,
      }),
    ).toBe(false);
  });

  it("shows a skeleton while provider discovery is still resolving a persisted thread model", () => {
    expect(
      shouldShowComposerModelBootstrapSkeleton({
        selectedProvider: "pi",
        selectedModel: "pi-coder-xl",
        persistedModelSelection: {
          provider: "pi",
          model: "pi-coder-m",
        },
        draftModelSelection: null,
        providerModelsLoading: true,
      }),
    ).toBe(true);
  });

  it("hides the skeleton once the persisted thread model is already selected", () => {
    expect(
      shouldShowComposerModelBootstrapSkeleton({
        selectedProvider: "pi",
        selectedModel: "pi-coder-m",
        persistedModelSelection: {
          provider: "pi",
          model: "pi-coder-m",
        },
        draftModelSelection: null,
        providerModelsLoading: true,
      }),
    ).toBe(false);
  });

  it("prefers an explicit draft selection over persisted thread state", () => {
    expect(
      shouldShowComposerModelBootstrapSkeleton({
        selectedProvider: "pi",
        selectedModel: "pi-coder-2",
        persistedModelSelection: {
          provider: "pi",
          model: "pi-coder-m",
        },
        draftModelSelection: {
          provider: "pi",
          model: "pi-coder-2",
        },
        providerModelsLoading: true,
      }),
    ).toBe(false);
  });
});

describe("resolveCommittedProviderModel", () => {
  it("preserves the exact runtime-discovered slug when the picker selected it", () => {
    expect(
      resolveCommittedProviderModel({
        selectedModel: "pi-coder-fast-1-0825" as ModelSlug,
        availableOptions: [
          {
            slug: "pi-coder-fast-1-0825" as ModelSlug,
            name: "Pi Coder Fast 1 0825",
          },
        ],
        fallback: () => "pi-coder-build-0.1",
      }),
    ).toBe("pi-coder-fast-1-0825");
  });

  it("falls back to static alias resolution when the selected slug is not in the options", () => {
    expect(
      resolveCommittedProviderModel({
        selectedModel: "code-fast" as ModelSlug,
        availableOptions: [],
        fallback: () => "pi-coder-build-0.1",
      }),
    ).toBe("pi-coder-build-0.1");
  });
});

describe("shouldConsumePendingCustomBinaryConfirmation", () => {
  it("still processes a pending path for a session that was already checked", () => {
    expect(
      shouldConsumePendingCustomBinaryConfirmation({
        sessionAlreadyChecked: true,
        pendingCustomBinaryPath: "/custom/bin/opencode",
      }),
    ).toBe(true);
  });

  it("skips already checked sessions when there is no pending path to confirm", () => {
    expect(
      shouldConsumePendingCustomBinaryConfirmation({
        sessionAlreadyChecked: true,
        pendingCustomBinaryPath: null,
      }),
    ).toBe(false);
  });
});

describe("deriveComposerSendState", () => {
  it("treats expired terminal pills as non-sendable content", () => {
    const state = deriveComposerSendState({
      prompt: "\uFFFC",
      imageCount: 0,
      assistantSelectionCount: 0,
      terminalContexts: [
        {
          id: "ctx-expired",
          threadId: ThreadId.makeUnsafe("thread-1"),
          terminalId: "default",
          terminalLabel: "Terminal 1",
          lineStart: 4,
          lineEnd: 4,
          text: "",
          createdAt: "2026-03-17T12:52:29.000Z",
        },
      ],
    });

    expect(state.trimmedPrompt).toBe("");
    expect(state.sendableTerminalContexts).toEqual([]);
    expect(state.expiredTerminalContextCount).toBe(1);
    expect(state.hasSendableContent).toBe(false);
  });

  it("keeps text sendable while excluding expired terminal pills", () => {
    const state = deriveComposerSendState({
      prompt: `yoo \uFFFC waddup`,
      imageCount: 0,
      assistantSelectionCount: 0,
      terminalContexts: [
        {
          id: "ctx-expired",
          threadId: ThreadId.makeUnsafe("thread-1"),
          terminalId: "default",
          terminalLabel: "Terminal 1",
          lineStart: 4,
          lineEnd: 4,
          text: "",
          createdAt: "2026-03-17T12:52:29.000Z",
        },
      ],
    });

    expect(state.trimmedPrompt).toBe("yoo  waddup");
    expect(state.expiredTerminalContextCount).toBe(1);
    expect(state.hasSendableContent).toBe(true);
  });

  it("treats assistant selections as sendable content", () => {
    const state = deriveComposerSendState({
      prompt: "",
      imageCount: 0,
      assistantSelectionCount: 1,
      terminalContexts: [],
    });

    expect(state.hasSendableContent).toBe(true);
  });
});

describe("buildExpiredTerminalContextToastCopy", () => {
  it("formats clear empty-state guidance", () => {
    expect(buildExpiredTerminalContextToastCopy(1, "empty")).toEqual({
      title: "Expired terminal context won't be sent",
      description: "Remove it or re-add it to include terminal output.",
    });
  });

  it("formats omission guidance for sent messages", () => {
    expect(buildExpiredTerminalContextToastCopy(2, "omitted")).toEqual({
      title: "Expired terminal contexts omitted from message",
      description: "Re-add it if you want that terminal output included.",
    });
  });
});

describe("shouldRenderTerminalWorkspace", () => {
  it("requires an active project to render workspace mode", () => {
    expect(
      shouldRenderTerminalWorkspace({
        activeProjectExists: false,
        presentationMode: "workspace",
        terminalOpen: true,
      }),
    ).toBe(false);
  });

  it("renders only for an open workspace terminal", () => {
    expect(
      shouldRenderTerminalWorkspace({
        activeProjectExists: true,
        presentationMode: "workspace",
        terminalOpen: true,
      }),
    ).toBe(true);
    expect(
      shouldRenderTerminalWorkspace({
        activeProjectExists: true,
        presentationMode: "drawer",
        terminalOpen: true,
      }),
    ).toBe(false);
  });
});

describe("shouldStartActiveTurnLayoutGrace", () => {
  it("starts the grace window when a live turn just became settled", () => {
    expect(
      shouldStartActiveTurnLayoutGrace({
        previousTurnLayoutLive: true,
        currentTurnLayoutLive: false,
        latestTurnStartedAt: "2026-04-13T00:00:00.000Z",
      }),
    ).toBe(true);
  });

  it("does not start the grace window for already-idle threads", () => {
    expect(
      shouldStartActiveTurnLayoutGrace({
        previousTurnLayoutLive: false,
        currentTurnLayoutLive: false,
        latestTurnStartedAt: "2026-04-13T00:00:00.000Z",
      }),
    ).toBe(false);
  });

  it("does not start the grace window while work is still live", () => {
    expect(
      shouldStartActiveTurnLayoutGrace({
        previousTurnLayoutLive: true,
        currentTurnLayoutLive: true,
        latestTurnStartedAt: "2026-04-13T00:00:00.000Z",
      }),
    ).toBe(false);
  });

  it("does not start the grace window when the turn never started", () => {
    expect(
      shouldStartActiveTurnLayoutGrace({
        previousTurnLayoutLive: true,
        currentTurnLayoutLive: false,
        latestTurnStartedAt: null,
      }),
    ).toBe(false);
  });
});

describe("hasServerAcknowledgedLocalDispatch", () => {
  const localDispatch: LocalDispatchSnapshot = {
    startedAt: "2026-04-13T00:00:00.000Z",
    preparingWorktree: false,
    latestTurnTurnId: null,
    latestTurnRequestedAt: null,
    latestTurnStartedAt: null,
    latestTurnCompletedAt: null,
    sessionOrchestrationStatus: "ready",
    sessionUpdatedAt: "2026-04-13T00:00:00.000Z",
  };
  const firstTurnLocalDispatch: LocalDispatchSnapshot = {
    startedAt: "2026-04-13T00:00:00.000Z",
    preparingWorktree: false,
    latestTurnTurnId: null,
    latestTurnRequestedAt: null,
    latestTurnStartedAt: null,
    latestTurnCompletedAt: null,
    sessionOrchestrationStatus: null,
    sessionUpdatedAt: null,
  };

  it("stays pending until the server-side thread/session snapshot changes", () => {
    expect(
      hasServerAcknowledgedLocalDispatch({
        localDispatch,
        phase: "ready",
        latestTurn: null,
        session: {
          provider: "pi",
          status: "ready",
          orchestrationStatus: "ready",
          createdAt: "2026-04-13T00:00:00.000Z",
          updatedAt: "2026-04-13T00:00:00.000Z",
        },
        hasPendingApproval: false,
        hasPendingUserInput: false,
        threadError: null,
      }),
    ).toBe(false);
  });

  it("acknowledges the local send once the latest turn snapshot changes", () => {
    expect(
      hasServerAcknowledgedLocalDispatch({
        localDispatch,
        phase: "ready",
        latestTurn: {
          turnId: "turn-1" as never,
          state: "running",
          requestedAt: "2026-04-13T00:00:01.000Z",
          startedAt: null,
          completedAt: null,
          assistantMessageId: null,
          sourceProposedPlan: undefined,
        },
        session: {
          provider: "pi",
          status: "ready",
          orchestrationStatus: "ready",
          createdAt: "2026-04-13T00:00:00.000Z",
          updatedAt: "2026-04-13T00:00:01.000Z",
        },
        hasPendingApproval: false,
        hasPendingUserInput: false,
        threadError: null,
      }),
    ).toBe(true);
  });

  it("keeps the first-turn optimistic timer alive through a null-to-ready session bootstrap", () => {
    expect(
      hasServerAcknowledgedLocalDispatch({
        localDispatch: firstTurnLocalDispatch,
        phase: "ready",
        latestTurn: null,
        session: {
          provider: "pi",
          status: "ready",
          orchestrationStatus: "ready",
          createdAt: "2026-04-13T00:00:00.000Z",
          updatedAt: "2026-04-13T00:00:01.000Z",
        },
        hasPendingApproval: false,
        hasPendingUserInput: false,
        threadError: null,
      }),
    ).toBe(false);
  });

  it("still acknowledges non-ready session transitions without a latest turn snapshot", () => {
    expect(
      hasServerAcknowledgedLocalDispatch({
        localDispatch: firstTurnLocalDispatch,
        phase: "disconnected",
        latestTurn: null,
        session: null,
        hasPendingApproval: false,
        hasPendingUserInput: false,
        threadError: "provider failed",
      }),
    ).toBe(true);
  });
});

describe("shouldAutoDeleteTerminalThreadOnLastClose", () => {
  it("deletes untouched terminal-first placeholder threads when the last terminal closes", () => {
    expect(
      shouldAutoDeleteTerminalThreadOnLastClose({
        isLastTerminal: true,
        isServerThread: true,
        terminalEntryPoint: "terminal",
        thread: {
          title: "New terminal",
          messages: [],
          latestTurn: null,
          session: null,
          activities: [],
          proposedPlans: [],
        },
      }),
    ).toBe(true);
  });

  it("keeps non-placeholder or already-used threads", () => {
    expect(
      shouldAutoDeleteTerminalThreadOnLastClose({
        isLastTerminal: true,
        isServerThread: true,
        terminalEntryPoint: "terminal",
        thread: {
          title: "Manual rename",
          messages: [],
          latestTurn: null,
          session: null,
          activities: [],
          proposedPlans: [],
        },
      }),
    ).toBe(false);

    expect(
      shouldAutoDeleteTerminalThreadOnLastClose({
        isLastTerminal: true,
        isServerThread: true,
        terminalEntryPoint: "terminal",
        thread: {
          title: "New terminal",
          messages: [
            {
              id: "msg-1" as never,
              role: "user",
              text: "hello",
              createdAt: "2026-04-06T12:00:00.000Z",
              streaming: false,
            },
          ],
          latestTurn: null,
          session: null,
          activities: [],
          proposedPlans: [],
        },
      }),
    ).toBe(false);
  });
});

describe("enrichSubagentWorkEntries", () => {
  const PARENT_ID = ThreadId.makeUnsafe("thread-parent");
  const CHILD_ID = ThreadId.makeUnsafe("subagent:thread-parent:explore-1a2b3c4d");

  /** The child thread as the server's worker-event stream leaves it: a live pi session plus steps. */
  function childThread(overrides: Partial<Thread> = {}): Thread {
    return {
      id: CHILD_ID,
      codexThreadId: null,
      projectId: ProjectId.makeUnsafe("project-1"),
      title: "Explore [explore] · map the parser",
      modelSelection: { provider: "pi", model: "qwen3.8-27b" },
      runtimeMode: "full-access",
      interactionMode: "multi",
      session: {
        status: "running",
        activeTurnId: TurnId.makeUnsafe("subagent-turn-1"),
      } as never,
      messages: [],
      proposedPlans: [],
      error: null,
      createdAt: "2026-09-22T10:00:00.000Z",
      latestTurn: null,
      parentThreadId: PARENT_ID,
      subagentAgentId: "explore",
      subagentNickname: "Explore",
      subagentRole: "explore",
      activities: [
        {
          id: "step-1",
          createdAt: "2026-09-22T10:00:01.000Z",
          kind: "tool.completed",
          tone: "tool",
          summary: "Read src/parser.ts",
          payload: {
            itemType: "dynamic_tool_call",
            title: "Read src/parser.ts",
            data: { toolCallId: "call-1", toolName: "read" },
          },
          turnId: TurnId.makeUnsafe("subagent-turn-1"),
        },
        {
          id: "step-2",
          createdAt: "2026-09-22T10:00:04.000Z",
          kind: "tool.completed",
          tone: "tool",
          summary: "grep parse",
          payload: {
            itemType: "dynamic_tool_call",
            title: "grep parse",
            data: { toolCallId: "call-2", toolName: "grep" },
          },
          turnId: TurnId.makeUnsafe("subagent-turn-1"),
        },
      ] as never,
      turnDiffSummaries: [],
      ...overrides,
    } as unknown as Thread;
  }

  function entry(rawStatus: string): WorkLogEntry {
    return {
      id: "collab-1",
      createdAt: "2026-09-22T10:00:01.000Z",
      label: "2 subagents",
      tone: "tool",
      itemType: "collab_agent_tool_call",
      subagents: [
        {
          threadId: "explore-1a2b3c4d",
          providerThreadId: "explore-1a2b3c4d",
          agentId: "explore",
          nickname: "Explore",
          role: "explore",
          model: "qwen3.8-27b",
          prompt: "map the parser",
          rawStatus,
        },
      ],
    };
  }

  it("joins a worker to its child thread and pulls its progress off it", () => {
    const [enriched] = enrichSubagentWorkEntries([entry("running")], [childThread()], PARENT_ID);
    const subagent = enriched?.subagents?.[0];

    expect(subagent?.resolvedThreadId).toBe(CHILD_ID);
    expect(subagent?.steps).toBe(2);
    expect(subagent?.elapsedMs).toBe(3000);
    expect(subagent?.latestStep).toBe("grep parse");
    expect(subagent?.isActive).toBe(true);
  });

  it("stops calling a worker busy once the turn that dispatched it is over", () => {
    // What the user sees otherwise: six agents labelled "Running" forever after the turn was
    // interrupted, with no way to tell that nothing is running any more.
    const [enriched] = enrichSubagentWorkEntries([entry("running")], [childThread()], PARENT_ID, {
      dispatchedTurnSettled: true,
    });
    const subagent = enriched?.subagents?.[0];

    expect(subagent?.statusLabel).toBe("Interrupted");
    expect(subagent?.isActive).toBeFalsy();
  });

  it("still reports a worker as running while its turn is live", () => {
    const [enriched] = enrichSubagentWorkEntries([entry("running")], [childThread()], PARENT_ID, {
      dispatchedTurnSettled: false,
    });
    expect(enriched?.subagents?.[0]?.statusLabel).toBe("Running");
    expect(enriched?.subagents?.[0]?.isActive).toBe(true);
  });

  it("leaves a settled worker alone when the turn is over", () => {
    // Only a lingering "running" is a lie; "completed" was true before the turn ended and stays
    // true after.
    const [enriched] = enrichSubagentWorkEntries(
      [entry("completed")],
      [childThread({ session: null })],
      PARENT_ID,
      { dispatchedTurnSettled: true },
    );
    expect(enriched?.subagents?.[0]?.statusLabel).toBe("Completed");
  });

  it('never lets a quiet child thread turn a still-running worker into "Idle"', () => {
    // The payload is the producer's own account of the run and it says "running". A child thread
    // whose session is not live derives "Idle", and letting that label win made a worker that was
    // still making tool calls read as stopped — the one thing the user must never have to guess.
    const [enriched] = enrichSubagentWorkEntries(
      [entry("running")],
      [childThread({ session: { status: "interrupted", activeTurnId: null } as never })],
      PARENT_ID,
    );
    const subagent = enriched?.subagents?.[0];

    expect(subagent?.statusLabel).not.toBe("Idle");
    expect(subagent?.statusLabel).toBe("Running");
    expect(subagent?.isActive).toBe(true);
  });

  it("measures a worker from its dispatch time before its first step has been recorded", () => {
    // A worker dispatched ten minutes ago with no steps recorded yet showed no duration at all,
    // which reads exactly like a worker that never started.
    const dispatched = entry("running");
    dispatched.subagents![0]!.startedAt = new Date(Date.now() - 10 * 60_000).toISOString();

    const [enriched] = enrichSubagentWorkEntries(
      [dispatched],
      [childThread({ session: null, activities: [] as never })],
      PARENT_ID,
    );
    expect(enriched?.subagents?.[0]?.elapsedMs).toBeGreaterThan(9 * 60_000);
  });

  it("keeps a finished worker finished even though its child thread is merely idle", () => {
    // The thread only knows whether the worker is live, never that the run ended. Without this
    // the row would flip from "Completed" to "Idle" the moment the turn closed.
    const [enriched] = enrichSubagentWorkEntries(
      [entry("completed")],
      [childThread({ session: null })],
      PARENT_ID,
    );
    const subagent = enriched?.subagents?.[0];

    expect(subagent?.statusLabel).toBe("Completed");
    expect(subagent?.isActive).toBeFalsy();
  });

  it("never hands a fresh worker an older same-handle run's progress", () => {
    // `subagentAgentId` is the worker handle, not a run identity: dispatching `explore` again in
    // a later turn produces a child thread that looks exactly like the earlier one. Matching the
    // first candidate showed the new worker the *old* run's step count, elapsed time and "Idle"
    // state — the card described a run that had already finished.
    const olderRun = childThread({
      id: ThreadId.makeUnsafe("subagent:thread-parent:explore-older"),
    });
    const secondOlderRun = childThread({
      id: ThreadId.makeUnsafe("subagent:thread-parent:explore-oldest"),
    });
    const fresh = entry("running");
    fresh.subagents![0]!.threadId = "explore-not-hydrated-yet";
    fresh.subagents![0]!.providerThreadId = "explore-not-hydrated-yet";

    const [enriched] = enrichSubagentWorkEntries([fresh], [olderRun, secondOlderRun], PARENT_ID);
    const subagent = enriched?.subagents?.[0];

    // A gap (no steps yet) is acceptable; a wrong answer is not.
    expect(subagent?.resolvedThreadId).toBeUndefined();
    expect(subagent?.steps).toBeUndefined();
    expect(subagent?.latestStep).toBeUndefined();
    expect(subagent?.statusLabel).not.toBe("Idle");
  });

  it("still falls back to a lone same-handle child thread", () => {
    // The fallback is for payloads that carry no usable id at all; with exactly one candidate
    // there is nothing to confuse it with.
    const only = childThread();
    const unmatched = entry("running");
    unmatched.subagents![0]!.threadId = "explore-unknown-run";
    unmatched.subagents![0]!.providerThreadId = "explore-unknown-run";

    const [enriched] = enrichSubagentWorkEntries([unmatched], [only], PARENT_ID);
    expect(enriched?.subagents?.[0]?.resolvedThreadId).toBe(CHILD_ID);
    expect(enriched?.subagents?.[0]?.steps).toBe(2);
  });
});
