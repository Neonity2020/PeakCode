import crypto from "node:crypto";
import { stat } from "node:fs/promises";
import path from "node:path";

import {
  ModelRuntime,
  type ExtensionError,
  type ExtensionFactory,
  type ToolDefinition,
  SessionManager,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  getAgentDir,
  type AgentSessionEvent,
  type CreateAgentSessionRuntimeFactory,
} from "@earendil-works/pi-coding-agent";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { ImageContent } from "@earendil-works/pi-ai";
import {
  type ChatAttachment,
  EventId,
  type ProviderComposerCapabilities,
  type ProviderListCommandsResult,
  type ProviderListModelsResult,
  type ProviderListPluginsResult,
  type ProviderListSkillsResult,
  type ProviderPluginDescriptor,
  type ProviderPluginMarketplaceDescriptor,
  type ProviderReadPluginResult,
  type ProviderSkillDescriptor,
  type CanonicalRequestType,
  type ProviderApprovalDecision,
  type ProviderUserInputAnswers,
  ProviderItemId,
  type ProviderInteractionMode,
  type ProviderRuntimeEvent,
  RuntimeRequestId,
  type ProviderSession,
  RuntimeItemId,
  ThreadId,
  TurnId,
} from "@peakcode/contracts";
import { Effect, FileSystem, Layer, Queue, Stream } from "effect";

import { buildThreadToolkitTools, threadConversationKey } from "../../agentToolkit";
import { scheduleTaskFromConversation } from "../../automation/automationTool";
import { browserControlConfigured, browserFromConversation } from "../../browser/browserTool";
import { computerControlConfigured, computerFromConversation } from "../../computer/computerTool";
import { commentOnTaskFromConversation, taskFromConversation } from "../../kanban/kanbanTool";
import {
  BUNDLED_PLUGIN_MARKETPLACE,
  BUNDLED_PLUGIN_MARKETPLACE_PATH,
  bundledPluginId,
  listBundledPlugins,
  readBundledPlugin,
} from "@peakcode/agent-toolkit/plugins/registry";
import { centralSkillDir } from "@peakcode/agent-toolkit/skills/central-repo";
import type { BundledPlugin } from "@peakcode/agent-toolkit/plugins/bundled.generated";
import { makeToolkitApprovalExtension } from "../../agentToolkitApprovals";
import {
  activeToolNamesForMode,
  forgetThreadContextWindow,
  handleGoalTool,
  handleWritePlan,
  makeToolkitContextExtension,
  rememberThreadContextWindow,
} from "../../agentToolkitMode";
import type { PermissionReply } from "@peakcode/agent-toolkit/agent-interactions";
import type { BrowserToolParams, ComputerToolParams } from "@peakcode/agent-toolkit/agent-tools";
import { rememberPromptTokens } from "@peakcode/agent-toolkit/agent-context";
import { writeTodos } from "@peakcode/agent-toolkit/agent-todos";
import { resolveAttachmentPath } from "../../attachmentStore.ts";
import { ServerConfig } from "../../config.ts";
import {
  ProviderAdapterRequestError,
  ProviderAdapterSessionClosedError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
} from "../Errors.ts";
import { PiAdapter, type PiAdapterShape } from "../Services/PiAdapter.ts";
import type { ProviderThreadSnapshot } from "../Services/ProviderAdapter.ts";
import { createModelRuntimeCache } from "../modelRuntimeCache.ts";
import { classifyPiTurnFailure } from "../piTurnFailure.ts";
import {
  buildSubagentDelegationItem,
  delegationSettleMessage,
  type PiDelegatedWorker,
  type PiDelegationWorkerStatus,
} from "../piSubagentDelegation.ts";
import { makeSubagentStream, type SubagentStream } from "../piSubagentWorkerStream.ts";
import { makeStallWatchdog, type StallWatchdog } from "../piSubagentWatchdog.ts";
import { extractProposedPlanMarkdown, withProviderPlanModePrompt } from "../planMode.ts";
import { type EventNdjsonLogger, makeEventNdjsonLogger } from "./EventNdjsonLogger.ts";
import {
  DEFAULT_PI_THINKING_LEVEL,
  findModelInRegistry,
  getPiSupportedThinkingOptions,
  declaredPiModels,
  normalizePiThinkingLevel,
  PROVIDER,
  toMessage,
  trimToUndefined,
  withLocalPiModelAdditions,
} from "../piModels.ts";
import {
  type PiSessionContext,
  type PiTrackedToolCall,
  extractResumeSessionFile,
  getSessionFile,
  makeSessionSnapshot,
  normalizeTokenUsage,
} from "../piSessionSnapshot.ts";
import {
  classifyPiRuntimeError,
  isPiReloadCommand,
  runtimeErrorDetail,
} from "../piRuntimeErrors.ts";
import {
  textFromToolResult,
  toolItemType,
  toolLifecycleData,
  toolTitle,
} from "../piToolPresentation.ts";
import { mapMessageHistory } from "../piMessageHistory.ts";

// Re-exported so existing discovery tests keep importing from the adapter entrypoint.
export { getPiSupportedThinkingOptions, withLocalPiModelAdditions } from "../piModels.ts";

const APPROVAL_TIMEOUT_MS = 10 * 60_000;
/** `ask_user` gets the same window: an unanswered question must not block the turn forever. */
const QUESTION_TIMEOUT_MS = 10 * 60_000;
export interface PiAdapterLiveOptions {
  readonly nativeEventLogPath?: string;
  readonly nativeEventLogger?: EventNdjsonLogger;
}

function makeAgentDir(agentDir: string | undefined): string {
  return trimToUndefined(agentDir) ?? getAgentDir();
}

/**
 * The final text of a sub-agent session.
 *
 * A worker's whole value is that its intermediate tool chatter stays in its own context;
 * only the closing answer comes back to the orchestrator. That answer is the last assistant
 * message's text parts — walked newest-first so a trailing empty assistant turn (an aborted
 * or tool-only message) does not shadow the real conclusion.
 */
function subagentFinalText(messages: readonly unknown[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || typeof message !== "object") continue;
    const record = message as { role?: unknown; content?: unknown };
    if (record.role !== "assistant" || !Array.isArray(record.content)) continue;
    const text = record.content
      .flatMap((part) => {
        if (!part || typeof part !== "object") return [];
        const chunk = part as { type?: unknown; text?: unknown };
        return chunk.type === "text" && typeof chunk.text === "string" ? [chunk.text] : [];
      })
      .join("")
      .trim();
    if (text.length > 0) return text;
  }
  return "";
}

/**
 * Tools a worker must never get.
 *
 * `task` would let a worker spawn workers (unbounded fan-out); the interactive tools
 * (`ask_user`, `request_permissions`) have no thread of their own to prompt on; and the
 * per-conversation bookkeeping tools (`goal`, `write_plan`, `checkpoint`, `rewind`) would
 * mutate the orchestrator's turn state from inside a worker.
 */
const SUBAGENT_EXCLUDED_TOOLS = [
  "task",
  "goal",
  "write_plan",
  "ask_user",
  "request_permissions",
  "checkpoint",
  "rewind",
  "browser",
  "computer",
  "schedule_task",
  "kanban_comment",
  "kanban_task",
] as const;

/**
 * Tools whose own lifecycle row is replaced by the delegation card.
 *
 * `task` is the toolkit's delegation tool. Its worker runs in an in-memory session and the
 * interesting part is the *workers* — name, model, status — which the delegation tracker
 * reports. A generic "Delegate to subagent" row beside that card would only duplicate it, worse.
 */
const DELEGATION_TOOL_NAMES: ReadonlySet<string> = new Set(["task"]);

/**
 * How long a worker may say nothing before it is treated as stuck.
 *
 * Generous on purpose: the window measures *silence*, not runtime, so a worker chewing through a
 * large tree or waiting on a slow command keeps resetting it. Ten minutes of nothing at all is
 * not a slow worker, it is a dead one — and it matches the window the approval and question gates
 * already use.
 */
const SUBAGENT_STALL_TIMEOUT_MS = 10 * 60_000;

/** A worker session that is still running, and whether the user asked it to stop. */
interface PiLiveSubagent {
  abort: () => Promise<void>;
  /** Set before aborting, so the run reports "stopped" rather than "failed". */
  stopped: boolean;
  /** Set when the watchdog ended it, so the run reports why rather than a bare failure. */
  stalled: boolean;
  /** Reset on every event the worker produces; fires when it goes quiet for too long. */
  watchdog: StallWatchdog;
}

/**
 * One turn's worth of delegated workers, aggregated into a single transcript card.
 *
 * `itemId` stays fixed for the card's lifetime and `settled` records whether the last worker has
 * come back — together they decide whether a new delegation joins this card or opens a new one.
 */
interface PiDelegationState {
  readonly itemId: RuntimeItemId;
  workers: PiDelegatedWorker[];
  settled: boolean;
}

/**
 * How many tool calls a worker made.
 *
 * The count is the only cheap signal of how much work a sub-agent did — the card shows it next
 * to the conclusion so "3 steps" and "68 steps" are distinguishable at a glance.
 */
function subagentStepCount(messages: readonly unknown[]): number {
  let steps = 0;
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    const content = (message as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part && typeof part === "object" && (part as { type?: unknown }).type === "toolCall") {
        steps += 1;
      }
    }
  }
  return steps;
}

/**
 * The worker's standing instructions.
 *
 * Two things are non-negotiable for a worker and are stated every turn: it cannot ask the
 * user (there is no UI bound to it), and its final message is the *only* thing the
 * orchestrator sees — so "summarise for a reader who saw none of your steps" is the
 * difference between a usable delegation and a useless one.
 */
function makeSubagentPromptExtension(workerPrompt: string | undefined): ExtensionFactory {
  return (pi) => {
    pi.on("before_agent_start", (event) => {
      const sections = [
        "You are a sub-agent, delegated one self-contained sub-task by an orchestrator.",
        "Work only on that sub-task. You cannot ask the user questions.",
        "Your final message is the only thing the orchestrator receives: it never sees your",
        "intermediate steps. End with a concise, self-contained conclusion — what you did, the",
        "evidence (files, commands, outputs), and anything still unresolved or uncertain.",
      ];
      const extra = workerPrompt?.trim();
      if (extra) sections.push(extra);
      return { systemPrompt: `${sections.join("\n")}\n\n${event.systemPrompt}` };
    });
  };
}

/**
 * Identity of the runtime's config files, used to notice provider edits.
 *
 * Two files decide what a runtime can authenticate against: `models.json` (providers and
 * their `$ENV`/`!command` key references) and `auth.json` (stored keys). The settings panel
 * rewrites both wholesale, so modification time plus size changes on every save; a missing
 * file is a revision of its own, since creating one later must refresh a runtime built
 * without it.
 */
async function providerConfigRevision(agentDir: string): Promise<string> {
  const [models, auth] = await Promise.all(
    ["models.json", "auth.json"].map(async (name) => {
      const stats = await stat(path.join(agentDir, name)).catch(() => null);
      return stats === null ? "missing" : `${stats.mtimeMs}:${stats.size}`;
    }),
  );
  return `${models}|${auth}`;
}

function extensionDisplayName(extension: {
  readonly path: string;
  readonly sourceInfo?: { readonly source?: string };
}): string {
  const source = trimToUndefined(extension.sourceInfo?.source);
  if (source) return source;
  const extensionPath = trimToUndefined(extension.path);
  return extensionPath ? path.basename(extensionPath).replace(/\.(?:ts|js)$/u, "") : "extension";
}

const makePiAdapter = (options?: PiAdapterLiveOptions) =>
  Effect.gen(function* () {
    const serverConfig = yield* ServerConfig;
    const fileSystem = yield* FileSystem.FileSystem;
    const runtimeEventQueue = yield* Queue.unbounded<ProviderRuntimeEvent>();
    const sessions = new Map<ThreadId, PiSessionContext>();
    /**
     * The mode the current turn is running in. Kept outside `PiSessionContext` because the
     * context extension and `sendTurn` both read it lazily, and a session outlives any one mode.
     */
    const sessionInteractionModes = new Map<ThreadId, ProviderInteractionMode>();
    const modelRuntimes = createModelRuntimeCache<ModelRuntime>({
      create: (agentDir) =>
        ModelRuntime.create({
          authPath: path.join(agentDir, "auth.json"),
          modelsPath: path.join(agentDir, "models.json"),
        }),
      revision: providerConfigRevision,
      // Offline: the panel's next turn must see the saved provider without a network round
      // trip, and a turn must never depend on the catalogue refresh succeeding.
      refresh: async (runtime) => {
        await runtime.refresh({ allowNetwork: false });
      },
    });
    const ownsNativeEventLogger = options?.nativeEventLogger === undefined;
    const nativeEventLogger =
      options?.nativeEventLogger ??
      (options?.nativeEventLogPath !== undefined
        ? yield* makeEventNdjsonLogger(options.nativeEventLogPath, { stream: "native" })
        : undefined);

    /**
     * One model/auth runtime per agent dir, shared by every session bound to it.
     *
     * The cache holds the pending build promise, so two sessions starting at once cannot
     * build (and then disagree over) separate credential stores. It also re-reads
     * `models.json` when the file changes: the settings panel edits that file, and a
     * runtime that kept its first composition would send every later turn to the
     * superseded endpoint with the superseded key.
     */
    /**
     * Extension failures are otherwise invisible: a throwing handler only produces pi's own
     * `extension_error` notification, which has no listener here. Errors raised before the
     * session context exists (a `session_start` handler throwing while extensions bind) are
     * buffered per thread and drained once the context is registered.
     */
    const pendingExtensionErrors = new Map<ThreadId, ReadonlyArray<ExtensionError>>();

    const reportExtensionError = (threadId: ThreadId, error: ExtensionError) => {
      const context = sessions.get(threadId);
      if (!context) {
        pendingExtensionErrors.set(threadId, [
          ...(pendingExtensionErrors.get(threadId) ?? []),
          error,
        ]);
        return;
      }
      const extensionPath = trimToUndefined(error.extensionPath) ?? "extension";
      offerRuntimeEvent({
        ...makeEventBase(context, { includeTurnId: false }),
        type: "runtime.warning",
        payload: {
          message: `Pi extension "${extensionDisplayName({ path: extensionPath })}" failed while handling ${error.event}: ${error.error}`,
          detail: { extensionPath, event: error.event, error: error.error },
        },
        raw: {
          source: "pi.sdk.event",
          method: "extension/handler-error",
          payload: { extensionPath, event: error.event, error: error.error },
        },
      } satisfies ProviderRuntimeEvent);
    };

    const drainExtensionErrors = (threadId: ThreadId) => {
      const buffered = pendingExtensionErrors.get(threadId);
      if (!buffered || buffered.length === 0) return;
      pendingExtensionErrors.delete(threadId);
      for (const error of buffered) reportExtensionError(threadId, error);
    };

    const getModelRuntime: (agentDir: string) => Promise<ModelRuntime> = (agentDir) =>
      modelRuntimes.get(agentDir);

    const makeEventBase = (
      context: PiSessionContext,
      options?: { readonly includeTurnId?: boolean },
    ) => ({
      eventId: EventId.makeUnsafe(crypto.randomUUID()),
      provider: PROVIDER,
      threadId: context.session.threadId,
      createdAt: new Date().toISOString(),
      ...(options?.includeTurnId !== false && context.activeTurnId
        ? { turnId: context.activeTurnId }
        : {}),
    });

    const offerRuntimeEvent = (event: ProviderRuntimeEvent) => {
      Effect.runPromise(Queue.offer(runtimeEventQueue, event)).catch(() => undefined);
      if (nativeEventLogger && event.raw) {
        Effect.runPromise(nativeEventLogger.write(event.raw, event.threadId)).catch(
          () => undefined,
        );
      }
    };

    /**
     * Per-thread state for the transcript's subagent card.
     *
     * A turn's `task` calls run concurrently — pi executes every tool call of one assistant
     * message in parallel — so the card has to aggregate workers registered by separate
     * `runSubagent` invocations. An entry is reused while workers are still running and replaced
     * once they have all settled, which is what gives each new round of delegation its own card.
     */
    const subagentDelegations = new Map<ThreadId, PiDelegationState>();

    /**
     * Worker sessions that are still running, per orchestrating thread.
     *
     * They need their own register because a worker runs in a *separate* session: aborting the
     * orchestrator's session does not reach it. Without this, stopping a turn left every worker it
     * had dispatched running to completion — the user stopped the work and kept paying for it.
     */
    const liveSubagents = new Map<ThreadId, Map<string, PiLiveSubagent>>();

    const registerLiveSubagent = (
      threadId: ThreadId,
      providerThreadId: string,
      abort: () => Promise<void>,
      onStall: () => void,
    ): PiLiveSubagent => {
      const forThread = liveSubagents.get(threadId) ?? new Map<string, PiLiveSubagent>();
      const entry: PiLiveSubagent = {
        abort,
        stopped: false,
        stalled: false,
        watchdog: makeStallWatchdog({ timeoutMs: SUBAGENT_STALL_TIMEOUT_MS, onStall }),
      };
      forThread.set(providerThreadId, entry);
      liveSubagents.set(threadId, forThread);
      return entry;
    };

    const unregisterLiveSubagent = (threadId: ThreadId, providerThreadId: string): void => {
      const forThread = liveSubagents.get(threadId);
      if (!forThread) return;
      forThread.get(providerThreadId)?.watchdog.stop();
      forThread.delete(providerThreadId);
      if (forThread.size === 0) liveSubagents.delete(threadId);
    };

    /**
     * End every worker a thread still has out, and remember that they were *stopped*.
     *
     * Order matters: the orchestrator's turn is parked inside the `task` call awaiting these very
     * workers, so aborting the orchestrator first would leave it waiting on them (the same trap
     * `cancelPendingInteractions` exists for). Ending the workers releases the tool call.
     */
    const stopLiveSubagents = async (threadId: ThreadId): Promise<void> => {
      const forThread = liveSubagents.get(threadId);
      if (!forThread) return;
      const entries = [...forThread.entries()];
      for (const [, entry] of entries) {
        entry.stopped = true;
        entry.watchdog.stop();
      }
      await Promise.all(entries.map(([, entry]) => entry.abort().catch(() => undefined)));
    };

    /**
     * End one worker, leaving its siblings and the orchestrating turn alone.
     *
     * A delegation of broad workers is precisely the case where this matters: the user can see
     * (now that progress is published on the card) that one of four workers is stuck on a bad
     * sub-task, and killing the whole turn to stop it would throw away the orchestrator's context
     * and the other three workers' results.
     *
     * The run's own path finishes the job: aborting the session rejects the worker's `prompt`,
     * `runSubagent` sees `live.stopped` and returns its "ended before it finished" text, and the
     * settle that already happened here is what the card renders. Reporting the stop *before*
     * the abort is deliberate — the same reason the stall watchdog does it: an abort that never
     * settles must not leave the card claiming the worker is still working.
     */
    const stopSubagent = async (threadId: ThreadId, providerThreadId: string): Promise<boolean> => {
      const live = liveSubagents.get(threadId)?.get(providerThreadId);
      if (!live) return false;
      live.stopped = true;
      live.watchdog.stop();
      settleSubagentDelegation(threadId, {
        providerThreadId,
        status: "stopped",
        message: "Stopped by you.",
      });
      await live.abort().catch(() => undefined);
      return true;
    };

    /**
     * Publish the current delegation state as one `collab_agent_tool_call` item.
     *
     * The item id is stable for the whole delegation, and that is what keeps every update
     * collapsed into a single card on the web side (`deriveToolLifecycleCollapseKey` takes the
     * key from `data.toolCallId`). Without it each update would become another row.
     *
     * No `raw` payload: nothing in the pi SDK produced these events, so there is nothing for the
     * native event log to record.
     */
    const emitSubagentDelegation = (
      ctx: PiSessionContext,
      delegation: PiDelegationState,
      phase: "started" | "updated" | "completed",
    ) => {
      const parentModel = ctx.runtime.session.model;
      const inheritedModel = parentModel ? `${parentModel.provider}/${parentModel.id}` : undefined;
      const item = buildSubagentDelegationItem({
        workers: delegation.workers,
        ...(inheritedModel ? { inheritedModel } : {}),
        settled: delegation.settled,
      });
      const total = delegation.workers.length;
      offerRuntimeEvent({
        ...makeEventBase(ctx),
        itemId: delegation.itemId,
        type:
          phase === "started"
            ? "item.started"
            : phase === "completed"
              ? "item.completed"
              : "item.updated",
        payload: {
          itemType: "collab_agent_tool_call",
          status: delegation.settled ? "completed" : "inProgress",
          title: `${total} subagent${total === 1 ? "" : "s"}`,
          data: { toolCallId: delegation.itemId, item },
        },
      } satisfies ProviderRuntimeEvent);
    };

    /** Record a worker the orchestrator just delegated to, and republish the card. */
    const beginSubagentDelegation = (
      threadId: ThreadId,
      worker: Omit<PiDelegatedWorker, "status" | "message" | "providerThreadId">,
    ): string => {
      const ctx = sessions.get(threadId);
      const providerThreadId = `${worker.workerId}-${crypto.randomUUID().slice(0, 8)}`;
      if (!ctx) return providerThreadId;
      const running = subagentDelegations.get(threadId);
      const delegation: PiDelegationState =
        running && !running.settled
          ? running
          : {
              itemId: RuntimeItemId.makeUnsafe(`pi-delegation-${crypto.randomUUID()}`),
              workers: [],
              settled: false,
            };
      delegation.workers.push({
        ...worker,
        providerThreadId,
        status: "running",
        message: worker.description,
        progress: { startedAt: new Date().toISOString() },
      });
      subagentDelegations.set(threadId, delegation);
      emitSubagentDelegation(ctx, delegation, running && !running.settled ? "updated" : "started");
      return providerThreadId;
    };

    /** Mark one worker settled and republish; the card closes once the last one lands. */
    const settleSubagentDelegation = (
      threadId: ThreadId,
      input: {
        readonly providerThreadId: string;
        readonly status: PiDelegationWorkerStatus;
        readonly message?: string | undefined;
      },
    ): void => {
      const ctx = sessions.get(threadId);
      const delegation = subagentDelegations.get(threadId);
      if (!ctx || !delegation) return;
      const index = delegation.workers.findIndex(
        (worker) => worker.providerThreadId === input.providerThreadId,
      );
      if (index < 0) return;
      delegation.workers[index] = {
        ...delegation.workers[index]!,
        status: input.status,
        ...(input.message ? { message: input.message } : {}),
      };
      delegation.settled = delegation.workers.every((worker) => worker.status !== "running");
      // A settled worker's card must go out immediately — the throttle exists for the per-step
      // stream, and a delayed "done" is the one delay the user would notice.
      subagentProgressEmittedAt.delete(delegation.itemId);
      subagentStepIds.delete(input.providerThreadId);
      emitSubagentDelegation(ctx, delegation, delegation.settled ? "completed" : "updated");
    };

    /**
     * How often a busy worker's progress reaches the card.
     *
     * A worker can start dozens of tool calls per minute, and every republication is an event plus
     * a projected activity row. One every couple of seconds is enough for "it is working and here
     * is what it is doing" — and the card's own per-second "quiet for Ns" ticker covers the rest —
     * while keeping the transcript's write volume proportional to the *turn* rather than to the
     * worker's tool count.
     */
    const SUBAGENT_PROGRESS_EMIT_INTERVAL_MS = 2_000;
    const subagentProgressEmittedAt = new Map<string, number>();
    /** Tool call ids already counted per worker, so a replayed stream cannot inflate "N steps". */
    const subagentStepIds = new Map<string, Set<string>>();
    /**
     * How many of a worker's tool calls its card keeps as an inspectable record.
     *
     * The card shows "15 steps · read_file · 4s ago" live; this is what answers "doing *what*"
     * when the user expands it. A dozen or so is the window that fits, and the full history is
     * still on the worker's child thread — the point here is that inspecting a worker must not
     * depend on that second subscription having landed.
     */
    const SUBAGENT_RECENT_STEPS = 12;

    /**
     * Record a tool call a live worker started, and republish the card (throttled).
     *
     * This is what keeps a long delegation readable: previously a worker's steps were only
     * visible through its child thread's separate subscription, so a worker 167 tool calls deep
     * still rendered as "waiting for its first step" whenever that subscription had not landed.
     */
    const recordSubagentStep = (
      threadId: ThreadId,
      providerThreadId: string,
      step: { readonly toolCallId: string; readonly summary: string },
    ): void => {
      const ctx = sessions.get(threadId);
      const delegation = subagentDelegations.get(threadId);
      if (!ctx || !delegation) return;
      const index = delegation.workers.findIndex(
        (worker) => worker.providerThreadId === providerThreadId,
      );
      if (index < 0) return;
      const worker = delegation.workers[index]!;
      const progress = worker.progress ?? {};
      const seen = subagentStepIds.get(providerThreadId) ?? new Set<string>();
      const recentSteps = [...(progress.recentSteps ?? [])];
      // One entry per distinct tool call, oldest first: the record reads as the sequence of what
      // the worker did, and a repeated *call id* (a replayed stream) must not double it while a
      // repeated *title* (reading two files) legitimately appears twice.
      if (!seen.has(step.toolCallId)) {
        seen.add(step.toolCallId);
        subagentStepIds.set(providerThreadId, seen);
        recentSteps.push({ id: step.toolCallId, title: step.summary });
      }
      delegation.workers[index] = {
        ...worker,
        progress: {
          ...progress,
          steps: seen.size,
          lastStep: step.summary,
          lastStepAt: new Date().toISOString(),
          recentSteps: recentSteps.slice(-SUBAGENT_RECENT_STEPS),
        },
      };

      const now = Date.now();
      const lastEmit = subagentProgressEmittedAt.get(delegation.itemId) ?? 0;
      if (now - lastEmit < SUBAGENT_PROGRESS_EMIT_INTERVAL_MS) return;
      subagentProgressEmittedAt.set(delegation.itemId, now);
      emitSubagentDelegation(ctx, delegation, "updated");
    };

    const offerRuntimeError = (
      context: PiSessionContext,
      input: {
        readonly message: string;
        readonly cause?: unknown;
        readonly method: string;
        readonly messageType?: string;
      },
    ) => {
      offerRuntimeEvent({
        ...makeEventBase(context, { includeTurnId: false }),
        type: "runtime.error",
        payload: {
          message: input.message,
          class: classifyPiRuntimeError(input.message),
          ...(input.cause !== undefined ? { detail: runtimeErrorDetail(input.cause) } : {}),
        },
        raw: {
          source: "pi.sdk.event",
          method: input.method,
          ...(input.messageType ? { messageType: input.messageType } : {}),
          payload: input.cause ?? { message: input.message },
        },
      } satisfies ProviderRuntimeEvent);
    };

    const completePromptRejection = (context: PiSessionContext, turnId: TurnId, cause: unknown) => {
      if (context.activeTurnId !== turnId) {
        return;
      }

      const message = toMessage(cause, "Pi turn failed.");
      const failure = classifyPiTurnFailure(message);
      const completionBase = makeEventBase(context);
      if (failure.state === "failed") {
        offerRuntimeError(context, { message, method: "prompt", cause });
      }
      context.activeTurnId = undefined;
      context.activeAssistantItemId = undefined;
      context.activeReasoningItemId = undefined;
      context.activeToolItems.clear();
      context.session = makeSessionSnapshot(context);
      offerRuntimeEvent({
        ...completionBase,
        type: "turn.completed",
        payload: {
          state: failure.state,
          stopReason: failure.stopReason,
          errorMessage: message,
        },
        raw: { source: "pi.sdk.event", method: "prompt", payload: cause },
      } satisfies ProviderRuntimeEvent);
    };

    const recordItem = (context: PiSessionContext, item: unknown) => {
      const turn = context.activeTurnId
        ? context.turns.find((candidate) => candidate.id === context.activeTurnId)
        : context.turns.at(-1);
      turn?.items.push(item);
    };

    const requireSession = Effect.fn("PiAdapter.requireSession")(function* (threadId: ThreadId) {
      const context = sessions.get(threadId);
      if (!context) {
        return yield* new ProviderAdapterSessionNotFoundError({ provider: PROVIDER, threadId });
      }
      if (context.stopped) {
        return yield* new ProviderAdapterSessionClosedError({ provider: PROVIDER, threadId });
      }
      return context;
    });

    const disposeSessionContext = async (context: PiSessionContext) => {
      context.unsubscribe?.();
      context.unsubscribe = undefined;
      context.stopped = true;
      // A worker outlives the orchestrator's session otherwise: it runs in its own session, on
      // its own model, and nothing else would ever end it.
      await stopLiveSubagents(context.session.threadId);
      // Answer every in-flight prompt with "cancel" before tearing down: the tool-call
      // handler is awaiting these promises, and the timers would otherwise outlive the
      // session and fire into a disposed runtime.
      cancelPendingInteractions(context);
      sessionInteractionModes.delete(context.session.threadId);
      forgetThreadContextWindow(context.session.threadId);
      await context.runtime.dispose();
    };

    const handleMessageUpdate = (
      context: PiSessionContext,
      event: Extract<AgentSessionEvent, { type: "message_update" }>,
    ) => {
      if (event.message.role !== "assistant") return;
      const update = event.assistantMessageEvent;
      if (update.type === "text_delta") {
        if (!context.activeAssistantItemId) {
          context.activeAssistantItemId = RuntimeItemId.makeUnsafe(
            `pi-assistant-${crypto.randomUUID()}`,
          );
          offerRuntimeEvent({
            ...makeEventBase(context),
            itemId: context.activeAssistantItemId,
            type: "item.started",
            payload: { itemType: "assistant_message", status: "inProgress", title: "Assistant" },
            raw: { source: "pi.sdk.event", messageType: event.type, payload: event },
          } satisfies ProviderRuntimeEvent);
        }
        context.activeTurnText += update.delta;
        recordItem(context, { type: "assistant_message", delta: update.delta });
        offerRuntimeEvent({
          ...makeEventBase(context),
          itemId: context.activeAssistantItemId,
          type: "content.delta",
          payload: {
            streamKind: "assistant_text",
            delta: update.delta,
            contentIndex: update.contentIndex,
          },
          raw: { source: "pi.sdk.event", messageType: event.type, payload: event },
        } satisfies ProviderRuntimeEvent);
        return;
      }
      if (update.type === "thinking_delta") {
        if (!context.activeReasoningItemId) {
          context.activeReasoningItemId = RuntimeItemId.makeUnsafe(
            `pi-reasoning-${crypto.randomUUID()}`,
          );
          offerRuntimeEvent({
            ...makeEventBase(context),
            itemId: context.activeReasoningItemId,
            type: "item.started",
            payload: { itemType: "reasoning", status: "inProgress", title: "Reasoning" },
            raw: { source: "pi.sdk.event", messageType: event.type, payload: event },
          } satisfies ProviderRuntimeEvent);
        }
        recordItem(context, { type: "reasoning", delta: update.delta });
        offerRuntimeEvent({
          ...makeEventBase(context),
          itemId: context.activeReasoningItemId,
          type: "content.delta",
          payload: {
            streamKind: "reasoning_text",
            delta: update.delta,
            contentIndex: update.contentIndex,
          },
          raw: { source: "pi.sdk.event", messageType: event.type, payload: event },
        } satisfies ProviderRuntimeEvent);
      }
    };

    const handleSessionEvent = (context: PiSessionContext, event: AgentSessionEvent) => {
      switch (event.type) {
        case "agent_start":
          offerRuntimeEvent({
            ...makeEventBase(context),
            type: "thread.state.changed",
            payload: { state: "active" },
            raw: { source: "pi.sdk.event", messageType: event.type, payload: event },
          } satisfies ProviderRuntimeEvent);
          return;
        case "turn_start":
          offerRuntimeEvent({
            ...makeEventBase(context),
            type: "turn.started",
            payload: {
              ...(context.runtime.session.model
                ? {
                    model: `${context.runtime.session.model.provider}/${context.runtime.session.model.id}`,
                  }
                : {}),
              effort: context.runtime.session.thinkingLevel,
            },
            raw: { source: "pi.sdk.event", messageType: event.type, payload: event },
          } satisfies ProviderRuntimeEvent);
          return;
        case "message_update":
          handleMessageUpdate(context, event);
          return;
        case "tool_execution_start": {
          const itemId = RuntimeItemId.makeUnsafe(`pi-tool-${event.toolCallId}`);
          const tracked: PiTrackedToolCall = {
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            args: event.args,
            itemId,
            itemType: toolItemType(event.toolName),
          };
          context.activeToolItems.set(event.toolCallId, tracked);
          const title = toolTitle(event.toolName, event.args);
          recordItem(context, {
            type: "tool_call",
            status: "started",
            toolName: event.toolName,
            args: event.args,
          });
          // Delegation is reported as one aggregated card instead (see DELEGATION_TOOL_NAMES).
          if (DELEGATION_TOOL_NAMES.has(event.toolName)) return;
          offerRuntimeEvent({
            ...makeEventBase(context),
            itemId,
            providerRefs: { providerItemId: ProviderItemId.makeUnsafe(event.toolCallId) },
            type: "item.started",
            payload: {
              itemType: tracked.itemType,
              status: "inProgress",
              title,
              data: toolLifecycleData({
                toolCallId: event.toolCallId,
                toolName: event.toolName,
                args: event.args,
              }),
            },
            raw: { source: "pi.sdk.event", messageType: event.type, payload: event },
          } satisfies ProviderRuntimeEvent);
          return;
        }
        case "tool_execution_update": {
          const tracked = context.activeToolItems.get(event.toolCallId);
          if (!tracked) return;
          const detail = textFromToolResult(event.partialResult);
          recordItem(context, {
            type: "tool_call",
            status: "updated",
            toolName: event.toolName,
            output: detail,
          });
          if (DELEGATION_TOOL_NAMES.has(event.toolName)) return;
          offerRuntimeEvent({
            ...makeEventBase(context),
            itemId: tracked.itemId,
            providerRefs: { providerItemId: ProviderItemId.makeUnsafe(event.toolCallId) },
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
            raw: { source: "pi.sdk.event", messageType: event.type, payload: event },
          } satisfies ProviderRuntimeEvent);
          return;
        }
        case "tool_execution_end": {
          const tracked = context.activeToolItems.get(event.toolCallId) ?? {
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            args: undefined,
            itemId: RuntimeItemId.makeUnsafe(`pi-tool-${event.toolCallId}`),
            itemType: toolItemType(event.toolName),
          };
          context.activeToolItems.delete(event.toolCallId);
          const detail = textFromToolResult(event.result);
          recordItem(context, {
            type: "tool_call",
            status: event.isError ? "failed" : "completed",
            toolName: event.toolName,
            output: detail,
            result: event.result,
          });
          if (DELEGATION_TOOL_NAMES.has(event.toolName)) return;
          offerRuntimeEvent({
            ...makeEventBase(context),
            itemId: tracked.itemId,
            providerRefs: { providerItemId: ProviderItemId.makeUnsafe(event.toolCallId) },
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
            raw: { source: "pi.sdk.event", messageType: event.type, payload: event },
          } satisfies ProviderRuntimeEvent);
          return;
        }
        case "compaction_start": {
          const itemId = RuntimeItemId.makeUnsafe(`pi-compaction-${crypto.randomUUID()}`);
          offerRuntimeEvent({
            ...makeEventBase(context),
            itemId,
            type: "item.updated",
            payload: {
              itemType: "context_compaction",
              status: "inProgress",
              title: "Compacting context",
            },
            raw: { source: "pi.sdk.event", messageType: event.type, payload: event },
          } satisfies ProviderRuntimeEvent);
          return;
        }
        case "compaction_end": {
          const itemId = RuntimeItemId.makeUnsafe(`pi-compaction-${crypto.randomUUID()}`);
          offerRuntimeEvent({
            ...makeEventBase(context),
            itemId,
            type: "item.completed",
            payload: {
              itemType: "context_compaction",
              status: event.aborted ? "failed" : "completed",
              title: "Context compacted",
              data: event,
            },
            raw: { source: "pi.sdk.event", messageType: event.type, payload: event },
          } satisfies ProviderRuntimeEvent);
          return;
        }
        case "agent_end": {
          const stats = context.runtime.session.getSessionStats();
          const usage = normalizeTokenUsage(stats, context.runtime.session.model?.contextWindow);
          context.lastKnownTokenUsage = usage;
          // Feed the composer's context ring. The window is per model, so it is reported here
          // rather than read from a global setting; the used side prefers the provider's own
          // measurement and only falls back to an estimate when there is none.
          if (usage?.maxTokens !== undefined) {
            rememberThreadContextWindow(context.session.threadId, usage.maxTokens);
          }
          if (usage?.usedTokens !== undefined && usage.usedTokens > 0) {
            rememberPromptTokens(threadConversationKey(context.session.threadId), usage.usedTokens);
          }
          const turnId = context.activeTurnId;
          const errorMessage = context.runtime.session.agent.state.errorMessage;
          const failure = errorMessage ? classifyPiTurnFailure(errorMessage) : undefined;
          const leafId = context.runtime.session.sessionManager.getLeafId();
          const turn = turnId
            ? context.turns.find((candidate) => candidate.id === turnId)
            : undefined;
          if (turn) turn.leafId = leafId;
          if (context.activeAssistantItemId) {
            offerRuntimeEvent({
              ...makeEventBase(context),
              itemId: context.activeAssistantItemId,
              type: "item.completed",
              payload: {
                itemType: "assistant_message",
                status: errorMessage ? "failed" : "completed",
                title: "Assistant",
              },
              raw: { source: "pi.sdk.event", messageType: event.type, payload: event },
            } satisfies ProviderRuntimeEvent);
          }
          if (context.activeReasoningItemId) {
            offerRuntimeEvent({
              ...makeEventBase(context),
              itemId: context.activeReasoningItemId,
              type: "item.completed",
              payload: {
                itemType: "reasoning",
                status: errorMessage ? "failed" : "completed",
                title: "Reasoning",
              },
              raw: { source: "pi.sdk.event", messageType: event.type, payload: event },
            } satisfies ProviderRuntimeEvent);
          }
          if (usage) {
            offerRuntimeEvent({
              ...makeEventBase(context),
              type: "thread.token-usage.updated",
              payload: { usage },
              raw: { source: "pi.sdk.event", messageType: event.type, payload: event },
            } satisfies ProviderRuntimeEvent);
          }
          if (errorMessage && failure?.state === "failed") {
            offerRuntimeError(context, {
              message: errorMessage,
              method: "prompt",
              messageType: event.type,
              cause: event,
            });
          }
          const completionBase = makeEventBase(context);
          // Fallback for a plan written in prose instead of via `write_plan`. Emitted before
          // the turn is cleared so it still carries the turn id the proposed-plan row is keyed on.
          if (sessionInteractionModes.get(context.session.threadId) === "plan") {
            const tagged = extractProposedPlanMarkdown(context.activeTurnText);
            if (tagged) emitProposedPlan(context.session.threadId, tagged);
          }
          context.activeTurnId = undefined;
          context.activeAssistantItemId = undefined;
          context.activeReasoningItemId = undefined;
          context.activeToolItems.clear();
          context.activeTurnText = "";
          context.session = makeSessionSnapshot(context);
          offerRuntimeEvent({
            ...completionBase,
            type: "turn.completed",
            payload:
              errorMessage && failure
                ? {
                    state: failure.state,
                    stopReason: failure.stopReason,
                    errorMessage,
                    usage: stats,
                  }
                : { state: "completed", stopReason: null, usage: stats },
            raw: { source: "pi.sdk.event", messageType: event.type, payload: event },
          } satisfies ProviderRuntimeEvent);
          return;
        }
        default:
          return;
      }
    };

    const createSdkRuntime = async (input: {
      cwd: string;
      agentDir: string;
      sessionManager: SessionManager;
      modelId?: string;
      thinkingLevel?: ThinkingLevel;
      toolkitTools?: ToolDefinition[];
      approvalExtension?: ExtensionFactory;
      contextExtension?: ExtensionFactory;
      onExtensionError?: (error: ExtensionError) => void;
    }) => {
      const modelRuntime = await getModelRuntime(input.agentDir);
      const createRuntime: CreateAgentSessionRuntimeFactory = async ({
        cwd,
        agentDir,
        sessionManager,
        sessionStartEvent,
      }) => {
        const services = await createAgentSessionServices({
          cwd,
          agentDir,
          modelRuntime,
          // The tool-call gate lives here: pi installs these handlers as
          // `agent.beforeToolCall`, so a blocked call never reaches the tool.
          ...(input.approvalExtension
            ? {
                resourceLoaderOptions: {
                  extensionFactories: [
                    input.approvalExtension,
                    ...(input.contextExtension ? [input.contextExtension] : []),
                  ],
                },
              }
            : {}),
        });
        const model = findModelInRegistry(services.modelRuntime, input.modelId);
        if (input.modelId && !model) {
          throw new Error(
            `Pi model '${input.modelId}' is not available. Use a discovered model or a provider-qualified custom model slug like 'openai/gpt-5.5'.`,
          );
        }
        return {
          ...(await createAgentSessionFromServices({
            services,
            sessionManager,
            ...(sessionStartEvent ? { sessionStartEvent } : {}),
            ...(model ? { model } : {}),
            thinkingLevel: input.thinkingLevel ?? DEFAULT_PI_THINKING_LEVEL,
            // Agent-toolkit tools (read_file/glob/grep/apply_patch/todo_write/read_skill/…)
            // ride alongside pi's built-ins. Names do not collide with read/write/edit/bash.
            ...(input.toolkitTools && input.toolkitTools.length > 0
              ? { customTools: input.toolkitTools }
              : {}),
          })),
          services,
          diagnostics: services.diagnostics,
        };
      };
      const runtime = await createAgentSessionRuntime(createRuntime, {
        cwd: input.sessionManager.getCwd(),
        agentDir: input.agentDir,
        sessionManager: input.sessionManager,
      });
      // No UI context is bound on purpose: extensions run against pi's no-op UI (hasUI
      // false), so `ctx.ui.*` calls are inert instead of failing the turn.
      await runtime.session.bindExtensions(
        input.onExtensionError ? { onError: input.onExtensionError } : {},
      );
      return { runtime, modelRuntime: runtime.services.modelRuntime };
    };

    /**
     * Publish a plan the model just wrote, so PeakCode's existing proposed-plan pipeline
     * (ingestion → projection → `ProposedPlanCard`) picks it up. Emitted for the active turn,
     * which is what `proposedPlanIdForTurn` keys the row on — a second write in the same turn
     * updates that row instead of adding another.
     */
    const emitProposedPlan = (threadId: ThreadId, planMarkdown: string) => {
      const context = sessions.get(threadId);
      if (!context) return;
      offerRuntimeEvent({
        ...makeEventBase(context),
        itemId: RuntimeItemId.makeUnsafe(`pi-plan-${context.activeTurnId ?? threadId}`),
        type: "turn.proposed.completed",
        payload: { planMarkdown },
      });
    };

    /**
     * Wake an in-flight approval prompt. Emits `request.resolved` on the way out so the
     * UI's panel clears whether the answer came from the user, a timeout, or a restart.
     */
    const settleApproval = (
      context: PiSessionContext,
      requestId: string,
      decision: ProviderApprovalDecision,
    ): boolean => {
      const pending = context.pendingApprovals.get(requestId);
      if (!pending) return false;
      context.pendingApprovals.delete(requestId);
      clearTimeout(pending.timer);
      offerRuntimeEvent({
        ...makeEventBase(context),
        requestId: RuntimeRequestId.makeUnsafe(requestId),
        type: "request.resolved",
        payload: { requestType: pending.requestType, decision },
      });
      pending.resolve(decision);
      return true;
    };

    /**
     * Raise one approval in the UI and wait for the answer.
     *
     * Runs on the agent loop's thread (the extension handler is awaited by pi before the
     * tool executes), so it must never hang: the timeout is the same 10 minutes the
     * toolkit's own interaction layer uses, and it resolves as `cancel` — an unanswered
     * prompt must not silently become an approval.
     */
    const promptForApproval = async (
      threadId: ThreadId,
      input: {
        requestType: CanonicalRequestType;
        title: string;
        detail: string;
        toolName: string;
      },
    ): Promise<PermissionReply> => {
      const context = sessions.get(threadId);
      if (!context) return "deny";

      const requestId = crypto.randomUUID();
      const decision = await new Promise<ProviderApprovalDecision>((resolve) => {
        const timer = setTimeout(() => {
          settleApproval(context, requestId, "cancel");
        }, APPROVAL_TIMEOUT_MS);
        context.pendingApprovals.set(requestId, {
          requestType: input.requestType,
          resolve,
          timer,
        });
        offerRuntimeEvent({
          ...makeEventBase(context),
          requestId: RuntimeRequestId.makeUnsafe(requestId),
          type: "request.opened",
          payload: {
            requestType: input.requestType,
            detail: `${input.title}｜${input.detail}`,
            args: { toolName: input.toolName },
          },
        });
      });

      if (decision === "accept") return "once";
      if (decision === "acceptForSession") return "session";
      return "deny";
    };

    /** Wake an in-flight `ask_user` prompt and clear it from the panel. */
    const settleQuestion = (
      context: PiSessionContext,
      requestId: string,
      answers: ProviderUserInputAnswers,
    ): boolean => {
      const pending = context.pendingQuestions.get(requestId);
      if (!pending) return false;
      context.pendingQuestions.delete(requestId);
      clearTimeout(pending.timer);
      offerRuntimeEvent({
        ...makeEventBase(context),
        requestId: RuntimeRequestId.makeUnsafe(requestId),
        type: "user-input.resolved",
        payload: { answers },
      });
      pending.resolve(answers);
      return true;
    };

    /**
     * Raise `ask_user` questions and wait for the answers.
     *
     * The toolkit hands questions over as a plain array and expects answers back in the same
     * order; PeakCode's contract keys them by id, so the index is the id and the answers are
     * re-collapsed afterwards. An unanswered set resolves as "no answers" — the toolkit's
     * `ask_user` renders that as "user skipped", which is a legitimate outcome.
     */
    const promptForQuestions = async (
      threadId: ThreadId,
      questions: readonly {
        question: string;
        header?: string | undefined;
        options?: readonly { label: string; description?: string | undefined }[] | undefined;
        multiple?: boolean | undefined;
      }[],
    ): Promise<string[][]> => {
      const context = sessions.get(threadId);
      if (!context) return questions.map(() => []);

      const requestId = crypto.randomUUID();
      const answers = await new Promise<ProviderUserInputAnswers>((resolve) => {
        const timer = setTimeout(() => {
          settleQuestion(context, requestId, {});
        }, QUESTION_TIMEOUT_MS);
        context.pendingQuestions.set(requestId, { resolve, timer });
        offerRuntimeEvent({
          ...makeEventBase(context),
          requestId: RuntimeRequestId.makeUnsafe(requestId),
          type: "user-input.requested",
          payload: {
            questions: questions.map((question, index) => ({
              id: String(index),
              // `header` is required and non-empty in the contract; the toolkit treats it
              // as optional decoration, so fall back to a positional label.
              header: question.header?.trim() || `问题 ${index + 1}`,
              question: question.question,
              options: (question.options ?? []).map((option) => ({
                label: option.label,
                description: option.description?.trim() || option.label,
              })),
              multiSelect: question.multiple ?? false,
            })),
          },
        });
      });

      return questions.map((_, index) => {
        const answer = answers[String(index)];
        if (answer === null || answer === undefined) return [];
        return Array.isArray(answer) ? answer : [answer];
      });
    };

    /**
     * Answer every in-flight interaction gate as "cancelled" so a parked run can end.
     *
     * pi awaits the approval handler (`beforeToolCall`) and `ask_user` directly — neither is
     * raced against the run's abort signal — so a turn waiting on the user only ends once its
     * gate is answered. Aborting such a run without releasing the gates first waits out the
     * 10-minute request timeout, and `ProviderCommandReactor` interrupts on its serial worker,
     * so that wait also stalls every later command for the thread.
     */
    const cancelPendingInteractions = (context: PiSessionContext) => {
      for (const requestId of [...context.pendingApprovals.keys()]) {
        settleApproval(context, requestId, "cancel");
      }
      for (const requestId of [...context.pendingQuestions.keys()]) {
        settleQuestion(context, requestId, {});
      }
    };

    const startSession: PiAdapterShape["startSession"] = (input) =>
      Effect.gen(function* () {
        const cwd = trimToUndefined(input.cwd) ?? serverConfig.cwd;
        const agentDir = makeAgentDir(input.providerOptions?.pi?.agentDir);
        const sessionFile = extractResumeSessionFile(input.resumeCursor);
        const sessionManager = sessionFile
          ? SessionManager.open(sessionFile, undefined, cwd)
          : SessionManager.create(cwd);
        const modelId =
          input.modelSelection?.provider === "pi" ? input.modelSelection.model : undefined;
        const thinkingLevel =
          input.modelSelection?.provider === "pi"
            ? normalizePiThinkingLevel(input.modelSelection.options?.thinkingLevel)
            : undefined;
        const existingContext = sessions.get(input.threadId);
        if (existingContext) {
          sessions.delete(input.threadId);
          yield* Effect.tryPromise({
            try: () => disposeSessionContext(existingContext),
            catch: (cause) =>
              new ProviderAdapterRequestError({
                provider: PROVIDER,
                method: "session/restart",
                detail: toMessage(cause, "Failed to dispose previous Pi session."),
                cause,
              }),
          });
        }
        // The full toolkit catalogue is registered once per session; which subset is live is
        // decided per turn from `interactionMode` (see `activeToolNamesForMode`). Runtime mode
        // is no longer part of this decision: write tools stay available under
        // `approval-required` and every one of them goes through the approval gate below.
        const toolkitConversationId = threadConversationKey(input.threadId);
        // Late-bound: a worker runs with the *same* toolkit catalogue it is itself part of,
        // so the runner cannot be defined before `toolkitTools`. Until it is assigned, `task`
        // reports that delegation is unavailable rather than silently returning nothing.
        let runSubagent:
          | ((opts: {
              description: string;
              prompt: string;
              subagentType: string;
              model?: string | null;
              systemPrompt?: string;
              tools?: readonly string[];
              /** Registry display name, so the delegation card can label the worker. */
              name?: string | undefined;
            }) => Promise<string>)
          | undefined;
        const toolkitTools = buildThreadToolkitTools({
          cwd,
          conversationId: toolkitConversationId,
          callbacks: {
            spawnSubagent: (opts) =>
              runSubagent
                ? runSubagent(opts)
                : Promise.reject(new Error("Subagents are unavailable in this session.")),
            askUser: (questions) => promptForQuestions(input.threadId, questions),
            // The checklist persists to SQLite; PeakCode has no todo panel yet, but a
            // stored checklist still beats the tool refusing to run.
            onTodoWrite: (todos) => {
              writeTodos(toolkitConversationId, todos as never);
            },
            onGoal: (goal) => handleGoalTool(toolkitConversationId, goal),
            onWritePlan: (content) => {
              const written = handleWritePlan(toolkitConversationId, cwd, content);
              if (written.planMarkdown) {
                emitProposedPlan(input.threadId, written.planMarkdown);
              }
              return written.outcome;
            },
            // "Every morning, summarise what changed here" is a scheduling request the model
            // can act on. The host resolves the workspace from this thread, so the task lands
            // where the user was working unless they name another project.
            onScheduleTask: (params) =>
              scheduleTaskFromConversation({ threadId: input.threadId, params }),
            // Registered in every session: whether this thread has a card to report to is
            // the host's call, and it answers either way (see kanbanTool.ts).
            onKanbanComment: (params) =>
              commentOnTaskFromConversation({ threadId: input.threadId, params }),
            // The read side of the same card. Also registered everywhere: a chat that never
            // came from the board gets told so instead of an empty card.
            onKanbanTask: () => taskFromConversation({ threadId: input.threadId }),
            // Only present when this server was started with a browser pipe, which is what
            // the desktop app provides. Without it the tool is not registered at all, so a
            // headless session never sees a verb it could not carry out (see browserTool.ts).
            ...(browserControlConfigured()
              ? {
                  onBrowser: (params: BrowserToolParams) =>
                    browserFromConversation({ threadId: input.threadId, params }),
                }
              : {}),
            // Desktop control is registered on the same terms: the native helper is started by
            // the desktop app, so a server that never found one does not offer the tool.
            ...(computerControlConfigured()
              ? { onComputer: (params: ComputerToolParams) => computerFromConversation(params) }
              : {}),
          },
        });
        const approvalExtension = makeToolkitApprovalExtension({
          cwd,
          conversationId: toolkitConversationId,
          prompt: (prompt) => promptForApproval(input.threadId, prompt),
        });
        const contextExtension = makeToolkitContextExtension({
          conversationId: toolkitConversationId,
          currentMode: () => sessionInteractionModes.get(input.threadId) ?? "default",
        });
        const { runtime, modelRuntime } = yield* Effect.tryPromise({
          try: () =>
            createSdkRuntime({
              cwd,
              agentDir,
              sessionManager,
              toolkitTools,
              approvalExtension,
              contextExtension,
              onExtensionError: (error) => reportExtensionError(input.threadId, error),
              ...(modelId ? { modelId } : {}),
              ...(thinkingLevel ? { thinkingLevel } : {}),
            }),
          catch: (cause) =>
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "session/start",
              detail: toMessage(cause, "Failed to start Pi session."),
              cause,
            }),
        });
        /**
         * Run one delegated sub-task on a worker with its own session and, when the
         * registry binds one, its own model.
         *
         * The worker gets an in-memory session (its transcript is not a PeakCode thread —
         * it is a scratch context whose only output is the returned string), the same
         * approval gate as the parent, and the excluded-tool list so it cannot fan out or
         * touch the orchestrator's turn state. A model that is configured but no longer
         * available fails loudly: silently falling back to the parent's model would bill
         * the caller for a routing decision they did not get.
         */
        runSubagent = async (opts) => {
          const workerModel = opts.model
            ? findModelInRegistry(modelRuntime, opts.model)
            : undefined;
          if (opts.model && !workerModel) {
            throw new Error(
              `Sub-agent model '${opts.model}' is not available. Pick another in Settings → Sub-agents.`,
            );
          }
          // Register before the session is built so the card shows the worker as running from
          // the moment it is dispatched — a worker that fails to start still has to appear, and
          // only then can the row explain why.
          const providerThreadId = beginSubagentDelegation(input.threadId, {
            workerId: opts.subagentType,
            name: opts.name ?? opts.subagentType,
            description: opts.description,
            ...(opts.model ? { model: opts.model } : {}),
          });
          let worker: { dispose: () => void } | undefined;
          let liveSubagent: PiLiveSubagent | undefined;
          let workerStream: SubagentStream | undefined;
          let stopWorkerStream: (() => void) | undefined;
          try {
            const services = await createAgentSessionServices({
              cwd,
              agentDir,
              modelRuntime,
              resourceLoaderOptions: {
                extensionFactories: [
                  approvalExtension,
                  makeSubagentPromptExtension(opts.systemPrompt),
                ],
              },
            });
            const workerToolAllowlist = (opts.tools ?? []).filter(
              (name) => !(SUBAGENT_EXCLUDED_TOOLS as readonly string[]).includes(name),
            );
            const { session: workerSession } = await createAgentSessionFromServices({
              services,
              sessionManager: SessionManager.inMemory(cwd),
              ...(workerModel ? { model: workerModel } : {}),
              thinkingLevel: DEFAULT_PI_THINKING_LEVEL,
              customTools: toolkitTools,
              excludeTools: [...SUBAGENT_EXCLUDED_TOOLS],
              ...(workerToolAllowlist.length > 0 ? { tools: workerToolAllowlist } : {}),
            });
            worker = workerSession;
            const live = registerLiveSubagent(
              input.threadId,
              providerThreadId,
              () => workerSession.abort(),
              () => {
                // Report first, then abort: if the session is wedged enough that `abort` never
                // settles, the card must still stop claiming this worker is working.
                live.stalled = true;
                settleSubagentDelegation(input.threadId, {
                  providerThreadId,
                  status: "failed",
                  message: `No output for ${Math.round(SUBAGENT_STALL_TIMEOUT_MS / 60_000)} minutes — stopped.`,
                });
                void workerSession.abort().catch(() => undefined);
              },
            );
            liveSubagent = live;
            // Mirror the worker's steps into its child thread so the card's rows open something
            // real: without this the thread exists but is empty (see makeSubagentStream).
            const stream = makeSubagentStream({
              provider: PROVIDER,
              threadId: input.threadId,
              providerThreadId,
              providerParentThreadId: runtime.session.sessionId,
              emit: offerRuntimeEvent,
              onActivity: (step) => {
                live.watchdog.touch();
                if (step) recordSubagentStep(input.threadId, providerThreadId, step);
              },
            });
            workerStream = stream;
            stopWorkerStream = workerSession.subscribe((event) => stream.handle(event));
            await workerSession.prompt([opts.description, "", opts.prompt].join("\n"));
            const text = subagentFinalText(workerSession.messages);
            // `agent_end` normally closes the turn; if the run ended without one (an aborted or
            // failed prompt can), the child thread would otherwise stay "running" forever.
            stream.finish();
            if (live.stopped || live.stalled) {
              // The watchdog reported the stall with its own reason; a stop was reported too.
              if (live.stopped) {
                settleSubagentDelegation(input.threadId, {
                  providerThreadId,
                  status: "stopped",
                  message: "Stopped before it finished.",
                });
              }
              return "(subagent ended before it finished)";
            }
            settleSubagentDelegation(input.threadId, {
              providerThreadId,
              status: "completed",
              message: delegationSettleMessage({
                steps: subagentStepCount(workerSession.messages),
                answer: text,
              }),
            });
            return text || "(subagent returned no output)";
          } catch (error) {
            stopWorkerStream?.();
            // An aborted prompt rejects, so the `finish()` in the try body is skipped — close the
            // child thread's turn here or a stopped worker's thread reads as still running.
            workerStream?.finish();
            // A stopped or stalled worker already has its own, more accurate reason on the card.
            if (!liveSubagent?.stopped && !liveSubagent?.stalled) {
              settleSubagentDelegation(input.threadId, {
                providerThreadId,
                status: "failed",
                message: error instanceof Error ? error.message : String(error),
              });
            }
            if (liveSubagent?.stopped || liveSubagent?.stalled) {
              return "(subagent ended before it finished)";
            }
            throw error;
          } finally {
            stopWorkerStream?.();
            unregisterLiveSubagent(input.threadId, providerThreadId);
            worker?.dispose();
          }
        };
        const now = new Date().toISOString();
        const model = runtime.session.model
          ? `${runtime.session.model.provider}/${runtime.session.model.id}`
          : modelId;
        const resumeCursor = getSessionFile(runtime.session);
        const session: ProviderSession = {
          provider: PROVIDER,
          status: "ready",
          runtimeMode: input.runtimeMode,
          cwd,
          threadId: input.threadId,
          createdAt: now,
          updatedAt: now,
          ...(model ? { model } : {}),
          ...(resumeCursor ? { resumeCursor } : {}),
        };
        const context: PiSessionContext = {
          runtime,
          modelRuntime,
          pendingApprovals: new Map(),
          pendingQuestions: new Map(),
          activeTurnText: "",
          session,
          turns: [],
          activeTurnId: undefined,
          activeAssistantItemId: undefined,
          activeReasoningItemId: undefined,
          activeToolItems: new Map(),
          stopped: false,
          lastKnownTokenUsage: undefined,
          unsubscribe: undefined,
        };
        context.unsubscribe = runtime.session.subscribe((event) =>
          handleSessionEvent(context, event),
        );
        sessions.set(input.threadId, context);
        drainExtensionErrors(input.threadId);
        const loadedExtensionsResult = runtime.session.resourceLoader.getExtensions();
        // A package that fails to load is the difference between "no crew tools" and a
        // usable session, so each failure is reported by name instead of being dropped.
        for (const failure of loadedExtensionsResult.errors) {
          offerRuntimeEvent({
            ...makeEventBase(context, { includeTurnId: false }),
            type: "runtime.warning",
            payload: {
              message: `Pi extension "${extensionDisplayName({ path: failure.path })}" failed to load: ${failure.error}`,
              detail: { extensionPath: failure.path, error: failure.error },
            },
            raw: {
              source: "pi.sdk.event",
              method: "extension/load-failed",
              payload: { extensionPath: failure.path, error: failure.error },
            },
          } satisfies ProviderRuntimeEvent);
        }
        const loadedExtensions = loadedExtensionsResult.extensions;
        if (loadedExtensions.length > 0) {
          const extensionNames = loadedExtensions.map(extensionDisplayName);
          offerRuntimeEvent({
            ...makeEventBase(context, { includeTurnId: false }),
            type: "runtime.warning",
            payload: {
              message:
                "Pi extensions are loaded; their tools, commands, and hooks run normally, but Peak Code supplies no Pi extension UI. Extensions that depend on ctx.ui dialogs, widgets, confirmations, or status updates will find them inert (ctx.hasUI is false).",
              detail: {
                extensionCount: loadedExtensions.length,
                extensions: extensionNames,
              },
            },
            raw: {
              source: "pi.sdk.event",
              method: "extension/ui-unsupported-warning",
              payload: { extensionCount: loadedExtensions.length, extensions: extensionNames },
            },
          } satisfies ProviderRuntimeEvent);
        }
        offerRuntimeEvent({
          ...makeEventBase(context),
          type: "session.started",
          payload: { message: "Pi session started", resume: session.resumeCursor },
        } satisfies ProviderRuntimeEvent);
        offerRuntimeEvent({
          ...makeEventBase(context),
          type: "thread.started",
          payload: { providerThreadId: runtime.session.sessionId },
        } satisfies ProviderRuntimeEvent);
        const initialUsage = normalizeTokenUsage(
          runtime.session.getSessionStats(),
          runtime.session.model?.contextWindow,
        );
        context.lastKnownTokenUsage = initialUsage;
        if (initialUsage) {
          offerRuntimeEvent({
            ...makeEventBase(context),
            type: "thread.token-usage.updated",
            payload: { usage: initialUsage },
          } satisfies ProviderRuntimeEvent);
        }
        return session;
      });

    const buildPromptPayload = (input: {
      readonly input?: string | undefined;
      readonly attachments?: ReadonlyArray<ChatAttachment> | undefined;
    }) =>
      Effect.gen(function* () {
        const text = input.input ?? "";
        const images = yield* Effect.forEach(
          input.attachments ?? [],
          (attachment) =>
            Effect.gen(function* () {
              if (attachment.type !== "image" || !attachment.mimeType) return undefined;
              const attachmentPath = resolveAttachmentPath({
                attachmentsDir: serverConfig.attachmentsDir,
                attachment,
              });
              if (!attachmentPath) {
                return yield* new ProviderAdapterValidationError({
                  provider: PROVIDER,
                  operation: "turn/start",
                  issue: `Invalid attachment id '${attachment.id}'.`,
                });
              }
              const bytes = yield* fileSystem.readFile(attachmentPath).pipe(
                Effect.mapError(
                  (cause) =>
                    new ProviderAdapterRequestError({
                      provider: PROVIDER,
                      method: "turn/start",
                      detail: toMessage(cause, "Failed to read attachment file."),
                      cause,
                    }),
                ),
              );
              return {
                type: "image" as const,
                data: Buffer.from(bytes).toString("base64"),
                mimeType: attachment.mimeType,
              };
            }),
          { concurrency: 1 },
        );
        return {
          text,
          images: images.filter((image): image is ImageContent => image !== undefined),
        };
      });

    const sendTurn: PiAdapterShape["sendTurn"] = (input) =>
      Effect.gen(function* () {
        const context = yield* requireSession(input.threadId);
        if (context.activeTurnId) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "sendTurn",
            issue: "A Pi turn is already active for this thread.",
          });
        }
        if (input.modelSelection?.provider === "pi") {
          const model = findModelInRegistry(context.modelRuntime, input.modelSelection.model);
          if (!model) {
            return yield* new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation: "model/set",
              issue: `Pi model '${input.modelSelection.model}' is not available. Use a discovered model or a provider-qualified custom model slug like 'openai/gpt-5.5'.`,
            });
          }
          yield* Effect.tryPromise({
            try: () => context.runtime.session.setModel(model),
            catch: (cause) =>
              new ProviderAdapterRequestError({
                provider: PROVIDER,
                method: "model/set",
                detail: toMessage(cause, "Failed to set Pi model."),
                cause,
              }),
          });
          const thinkingLevel = normalizePiThinkingLevel(
            input.modelSelection.options?.thinkingLevel,
          );
          if (thinkingLevel) {
            context.runtime.session.setThinkingLevel(thinkingLevel);
          }
        }
        // Switch the tool set before the loop starts. `setActiveToolsByName` also rebuilds
        // pi's base system prompt, so plan mode stops advertising tools it cannot use.
        const interactionMode = input.interactionMode ?? "default";
        sessionInteractionModes.set(input.threadId, interactionMode);
        yield* Effect.sync(() => {
          const session = context.runtime.session;
          session.setActiveToolsByName(
            activeToolNamesForMode(
              interactionMode,
              session.getAllTools().map((tool) => tool.name),
            ),
          );
        });

        const rawPayload = yield* buildPromptPayload(input);
        // Tells the model it is in plan mode, and how to present the plan if it decides not
        // to call `write_plan`. Both paths end in the same proposed-plan event, so a model
        // that ignores the tool still produces a plan the user can act on.
        const payload = {
          ...rawPayload,
          text: withProviderPlanModePrompt({
            text: rawPayload.text,
            interactionMode,
          }),
        };
        const turnId = TurnId.makeUnsafe(crypto.randomUUID());
        context.activeTurnId = turnId;
        context.activeTurnText = "";
        context.turns.push({ id: turnId, items: [] });
        context.session = makeSessionSnapshot(context);
        if (payload.images.length === 0 && isPiReloadCommand(payload.text)) {
          offerRuntimeEvent({
            ...makeEventBase(context),
            type: "turn.started",
            payload: {
              ...(context.runtime.session.model
                ? {
                    model: `${context.runtime.session.model.provider}/${context.runtime.session.model.id}`,
                  }
                : {}),
              effort: context.runtime.session.thinkingLevel,
            },
            raw: { source: "pi.sdk.event", method: "reload", payload: { command: payload.text } },
          } satisfies ProviderRuntimeEvent);
          yield* Effect.tryPromise({
            try: () => context.runtime.session.reload(),
            catch: (cause) =>
              new ProviderAdapterRequestError({
                provider: PROVIDER,
                method: "session/reload",
                detail: toMessage(cause, "Failed to reload Pi resources."),
                cause,
              }),
          }).pipe(
            Effect.catch((error) =>
              Effect.gen(function* () {
                const message = error.message;
                offerRuntimeEvent({
                  ...makeEventBase(context),
                  type: "turn.completed",
                  payload: { state: "failed", stopReason: "error", errorMessage: message },
                  raw: { source: "pi.sdk.event", method: "reload", payload: error },
                } satisfies ProviderRuntimeEvent);
                offerRuntimeError(context, {
                  message,
                  method: "session/reload",
                  cause: error,
                });
                context.activeTurnId = undefined;
                context.session = makeSessionSnapshot(context);
                return yield* Effect.fail(error);
              }),
            ),
          );
          offerRuntimeEvent({
            ...makeEventBase(context),
            type: "turn.completed",
            payload: { state: "completed", stopReason: "reload" },
            raw: { source: "pi.sdk.event", method: "reload", payload: { command: payload.text } },
          } satisfies ProviderRuntimeEvent);
          context.activeTurnId = undefined;
          context.session = makeSessionSnapshot(context);
          return {
            threadId: input.threadId,
            turnId,
            resumeCursor: getSessionFile(context.runtime.session),
          };
        }
        void context.runtime.session
          .prompt(payload.text, payload.images.length > 0 ? { images: payload.images } : undefined)
          .catch((cause) => {
            completePromptRejection(context, turnId, cause);
          });
        return {
          threadId: input.threadId,
          turnId,
          resumeCursor: getSessionFile(context.runtime.session),
        };
      });

    const steerTurn: NonNullable<PiAdapterShape["steerTurn"]> = (input) =>
      Effect.gen(function* () {
        const context = yield* requireSession(input.threadId);
        const payload = yield* buildPromptPayload(input);
        const turnId = context.activeTurnId ?? TurnId.makeUnsafe(crypto.randomUUID());
        if (!context.activeTurnId) {
          context.activeTurnId = turnId;
          context.turns.push({ id: turnId, items: [] });
        }
        if (context.runtime.session.isStreaming) {
          yield* Effect.tryPromise({
            try: () => context.runtime.session.steer(payload.text, payload.images),
            catch: (cause) =>
              new ProviderAdapterRequestError({
                provider: PROVIDER,
                method: "turn/steer",
                detail: toMessage(cause, "Failed to steer Pi turn."),
                cause,
              }),
          });
        } else {
          void context.runtime.session
            .prompt(
              payload.text,
              payload.images.length > 0 ? { images: payload.images } : undefined,
            )
            .catch((cause) => {
              completePromptRejection(context, turnId, cause);
            });
        }
        return {
          threadId: input.threadId,
          turnId,
          resumeCursor: getSessionFile(context.runtime.session),
        };
      });

    const interruptTurn: PiAdapterShape["interruptTurn"] = (threadId) =>
      requireSession(threadId).pipe(
        Effect.flatMap((context) =>
          Effect.tryPromise({
            try: async () => {
              // Release the user gates before aborting. `abort()` waits for the run to go
              // idle, and a run parked on an approval or question cannot go idle until that
              // gate is answered — answering it here is what lets the abort land now rather
              // than after the 10-minute timeout.
              cancelPendingInteractions(context);
              // Same argument for delegated workers, and it goes further: the turn is parked
              // inside the `task` call that awaits them, so it cannot go idle until they end.
              // Stopping the turn has to mean stopping the work it started.
              await stopLiveSubagents(threadId);
              return context.runtime.session.abort();
            },
            catch: (cause) =>
              new ProviderAdapterRequestError({
                provider: PROVIDER,
                method: "turn/interrupt",
                detail: toMessage(cause, "Failed to interrupt Pi turn."),
                cause,
              }),
          }),
        ),
        Effect.asVoid,
      );

    const stopSession: PiAdapterShape["stopSession"] = (threadId) =>
      requireSession(threadId).pipe(
        Effect.flatMap((context) =>
          Effect.tryPromise({
            try: () => disposeSessionContext(context),
            catch: (cause) =>
              new ProviderAdapterRequestError({
                provider: PROVIDER,
                method: "session/stop",
                detail: toMessage(cause, "Failed to stop Pi session."),
                cause,
              }),
          }).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                context.stopped = true;
                sessions.delete(threadId);
                offerRuntimeEvent({
                  ...makeEventBase(context),
                  type: "thread.state.changed",
                  payload: { state: "closed", detail: { reason: "stopped" } },
                } satisfies ProviderRuntimeEvent);
                offerRuntimeEvent({
                  ...makeEventBase(context),
                  type: "session.exited",
                  payload: { reason: "stopped", exitKind: "graceful" },
                } satisfies ProviderRuntimeEvent);
              }),
            ),
          ),
        ),
        Effect.asVoid,
      );

    const listSessions: PiAdapterShape["listSessions"] = () =>
      Effect.sync(() => Array.from(sessions.values()).map(makeSessionSnapshot));

    const hasSession: PiAdapterShape["hasSession"] = (threadId) =>
      Effect.sync(() => sessions.has(threadId));

    const snapshotThread = (context: PiSessionContext): ProviderThreadSnapshot => {
      const historyItems = mapMessageHistory(context.runtime.session);
      const activeTurn = context.activeTurnId
        ? context.turns.find((turn) => turn.id === context.activeTurnId)
        : undefined;
      const turns = [
        ...(historyItems.length > 0
          ? [
              {
                id: TurnId.makeUnsafe(`pi-history-${context.runtime.session.sessionId}`),
                items: historyItems,
              },
            ]
          : []),
        ...(activeTurn ? [{ id: activeTurn.id, items: [...activeTurn.items] }] : []),
      ];
      return {
        threadId: context.session.threadId,
        ...(context.session.cwd ? { cwd: context.session.cwd } : {}),
        turns:
          turns.length > 0
            ? turns
            : context.turns.map((turn) => ({ id: turn.id, items: [...turn.items] })),
      };
    };

    const readThread: PiAdapterShape["readThread"] = (threadId) =>
      requireSession(threadId).pipe(Effect.map(snapshotThread));

    const rollbackThread: PiAdapterShape["rollbackThread"] = (threadId, numTurns) =>
      Effect.gen(function* () {
        const context = yield* requireSession(threadId);
        const nextLength = Math.max(0, context.turns.length - Math.max(0, numTurns));
        context.turns.splice(nextLength);
        const leafId = context.turns.at(-1)?.leafId;
        if (leafId) {
          context.runtime.session.sessionManager.branch(leafId);
        } else if (nextLength === 0) {
          context.runtime.session.sessionManager.resetLeaf();
        }
        return snapshotThread(context);
      });

    const compactThread: NonNullable<PiAdapterShape["compactThread"]> = (threadId) =>
      requireSession(threadId).pipe(
        Effect.flatMap((context) =>
          Effect.tryPromise({
            try: () => context.runtime.session.compact(),
            catch: (cause) =>
              new ProviderAdapterRequestError({
                provider: PROVIDER,
                method: "thread/compact",
                detail: toMessage(cause, "Failed to compact Pi thread."),
                cause,
              }),
          }),
        ),
        Effect.asVoid,
      );

    const stopAll: PiAdapterShape["stopAll"] = () =>
      Effect.forEach(Array.from(sessions.keys()), (threadId) => stopSession(threadId), {
        concurrency: "unbounded",
        discard: true,
      }).pipe(Effect.asVoid);

    const listModels: NonNullable<PiAdapterShape["listModels"]> = (input) =>
      Effect.tryPromise({
        try: async () => {
          const agentDir = makeAgentDir(input.agentDir);
          const runtime = await getModelRuntime(agentDir);
          await runtime.refresh();
          const availableModels = await declaredPiModels(
            path.join(agentDir, "models.json"),
            await runtime.getAvailable(),
          );
          const models = withLocalPiModelAdditions(availableModels, availableModels).map(
            (model) => {
              const supportedThinkingOptions = getPiSupportedThinkingOptions(model);
              return {
                slug: `${model.provider}/${model.id}`,
                name: model.name,
                upstreamProviderId: model.provider,
                upstreamProviderName: runtime.getProvider(model.provider)?.name ?? model.provider,
                ...(supportedThinkingOptions.length > 0
                  ? {
                      supportedReasoningEfforts: supportedThinkingOptions.map((option) => ({
                        value: option.value,
                        label: option.label,
                        description: option.description,
                      })),
                      ...(supportedThinkingOptions.some(
                        (option) => option.value === DEFAULT_PI_THINKING_LEVEL,
                      )
                        ? { defaultReasoningEffort: DEFAULT_PI_THINKING_LEVEL }
                        : {}),
                    }
                  : {}),
              };
            },
          );
          return { models, source: "pi.sdk", cached: false } satisfies ProviderListModelsResult;
        },
        catch: (cause) =>
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "model/list",
            detail: toMessage(cause, "Failed to list Pi models."),
            cause,
          }),
      });

    const listSkills: NonNullable<PiAdapterShape["listSkills"]> = (input) =>
      Effect.tryPromise({
        try: async () => {
          const active = input.threadId
            ? sessions.get(ThreadId.makeUnsafe(input.threadId))
            : undefined;
          const loader = active?.runtime.session.resourceLoader;
          if (active && input.forceReload) {
            await active.runtime.session.reload();
          }
          const services = loader
            ? undefined
            : await createAgentSessionServices({
                cwd: input.cwd,
                agentDir: makeAgentDir(input.agentDir),
              });
          if (services && input.forceReload) {
            await services.resourceLoader.reload();
          }
          const result = (loader ?? services!.resourceLoader).getSkills();
          return {
            skills: result.skills.map((skill) => {
              const description = trimToUndefined(skill.description);
              const scope = trimToUndefined(skill.sourceInfo.source);
              return {
                name: skill.name,
                ...(description ? { description } : {}),
                path: skill.filePath,
                enabled: !skill.disableModelInvocation,
                ...(scope ? { scope } : {}),
              };
            }),
            source: "pi.sdk",
            cached: false,
          } satisfies ProviderListSkillsResult;
        },
        catch: (cause) =>
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "skill/list",
            detail: toMessage(cause, "Failed to list Pi skills."),
            cause,
          }),
      });

    const listCommands: NonNullable<PiAdapterShape["listCommands"]> = (input) =>
      Effect.tryPromise({
        try: async () => {
          const active = input.threadId
            ? sessions.get(ThreadId.makeUnsafe(input.threadId))
            : undefined;
          const session = active?.runtime.session;
          const reloadCommand = {
            name: "reload",
            description: "Reload Pi extensions, skills, prompts, themes, tools, and settings",
          };
          if (session) {
            if (input.forceReload) {
              await session.reload();
            }
            const extensionCommands = session.extensionRunner
              .getRegisteredCommands()
              .map((command) => ({
                name: command.invocationName,
                description: trimToUndefined(command.description) ?? "Extension command",
              }));
            const promptCommands = session.promptTemplates.map((template) => ({
              name: template.name,
              description: trimToUndefined(template.description) ?? "Prompt template",
            }));
            const skillCommands = session.resourceLoader.getSkills().skills.map((skill) => ({
              name: `skill:${skill.name}`,
              description: trimToUndefined(skill.description) ?? "Skill",
            }));
            return {
              commands: [reloadCommand, ...extensionCommands, ...promptCommands, ...skillCommands],
              source: "pi.sdk",
              cached: false,
            } satisfies ProviderListCommandsResult;
          }
          const services = await createAgentSessionServices({
            cwd: input.cwd,
            agentDir: makeAgentDir(input.agentDir),
          });
          if (input.forceReload) {
            await services.resourceLoader.reload();
          }
          const promptCommands = services.resourceLoader.getPrompts().prompts.map((template) => ({
            name: template.name,
            description: trimToUndefined(template.description) ?? "Prompt template",
          }));
          const skillCommands = services.resourceLoader.getSkills().skills.map((skill) => ({
            name: `skill:${skill.name}`,
            description: trimToUndefined(skill.description) ?? "Skill",
          }));
          return {
            commands: [reloadCommand, ...promptCommands, ...skillCommands],
            source: "pi.sdk",
            cached: false,
          } satisfies ProviderListCommandsResult;
        },
        catch: (cause) =>
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "command/list",
            detail: toMessage(cause, "Failed to list Pi commands."),
            cause,
          }),
      });

    /**
     * Plugin discovery for the plugins Peak Code ships itself.
     *
     * The provider's own marketplaces have no reader yet, so this reports the bundled
     * marketplace only. It is what lights up the /plugins view and the composer's plugin
     * mentions, both of which are wired to this call and stay empty without it.
     */
    const listPlugins: NonNullable<PiAdapterShape["listPlugins"]> = () =>
      Effect.sync(() => {
        const plugins = listBundledPlugins().map(describeBundledPlugin);
        const marketplace: ProviderPluginMarketplaceDescriptor = {
          name: BUNDLED_PLUGIN_MARKETPLACE,
          path: BUNDLED_PLUGIN_MARKETPLACE_PATH,
          interface: { displayName: BUNDLED_PLUGIN_MARKETPLACE },
          plugins,
        };
        return {
          marketplaces: [marketplace],
          // Nothing to report: the bundled marketplace is compiled in, so it cannot fail to
          // load the way a directory-backed marketplace can.
          marketplaceLoadErrors: [],
          remoteSyncError: null,
          // Everything shipped with the app is featured; there is no marketplace ranking to
          // defer to, and an unfeatured bundled plugin would simply be invisible.
          featuredPluginIds: plugins.map((plugin) => plugin.id),
          source: "peakcode.bundled",
          cached: false,
        } satisfies ProviderListPluginsResult;
      });

    const readPlugin: NonNullable<PiAdapterShape["readPlugin"]> = (input) =>
      Effect.sync(() => {
        const plugin = readBundledPlugin(input.pluginName);
        if (plugin === null) {
          throw new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "plugin/read",
            detail: `No bundled plugin named "${input.pluginName}".`,
          });
        }
        const summary = describeBundledPlugin(plugin);
        return {
          plugin: {
            marketplaceName: BUNDLED_PLUGIN_MARKETPLACE,
            marketplacePath: BUNDLED_PLUGIN_MARKETPLACE_PATH,
            summary,
            ...(plugin.interface.longDescription !== undefined
              ? { description: plugin.interface.longDescription }
              : {}),
            skills: plugin.skills.map((skill) => {
              const dir = centralSkillDir(skill.id);
              return {
                name: skill.id,
                description: skill.description,
                // The installed path, not the payload: this is what the user would open, and
                // a bundled skill is written into the shared library at startup.
                path: dir ?? skill.id,
                enabled: true,
                scope: "bundled",
              } satisfies ProviderSkillDescriptor;
            }),
            // A bundled plugin ships skills, not apps or MCP servers. Reporting empty lists
            // is the honest answer and keeps the detail view from inventing tabs.
            apps: [],
            mcpServers: [],
          },
          source: "peakcode.bundled",
          cached: false,
        } satisfies ProviderReadPluginResult;
      });

    const getComposerCapabilities: NonNullable<PiAdapterShape["getComposerCapabilities"]> = () =>
      Effect.succeed({
        provider: PROVIDER,
        supportsSkillMentions: true,
        supportsSkillDiscovery: true,
        supportsNativeSlashCommandDiscovery: true,
        supportsPluginMentions: true,
        supportsPluginDiscovery: true,
        supportsRuntimeModelList: true,
        supportsThreadCompaction: true,
        supportsThreadImport: false,
      } satisfies ProviderComposerCapabilities);

    yield* Effect.addFinalizer(() =>
      stopAll().pipe(
        Effect.ignore,
        Effect.andThen(
          ownsNativeEventLogger && nativeEventLogger
            ? nativeEventLogger.close().pipe(Effect.ignore)
            : Effect.void,
        ),
        Effect.andThen(Queue.shutdown(runtimeEventQueue)),
      ),
    );

    return {
      provider: PROVIDER,
      capabilities: {
        sessionModelSwitch: "in-session",
        supportsSkillMentions: true,
        supportsSkillDiscovery: true,
        supportsNativeSlashCommandDiscovery: true,
        supportsPluginMentions: true,
        supportsPluginDiscovery: true,
        supportsRuntimeModelList: true,
        supportsTurnSteering: true,
      },
      startSession,
      sendTurn,
      steerTurn,
      interruptTurn,
      stopSubagent: (input) =>
        Effect.tryPromise({
          try: () => stopSubagent(input.threadId, input.providerThreadId),
          catch: (cause) =>
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "subagent/stop",
              detail: toMessage(cause, "Failed to stop the sub-agent."),
              cause,
            }),
        }),
      respondToRequest: (threadId, requestId, decision) =>
        Effect.gen(function* () {
          const context = yield* requireSession(threadId);
          if (settleApproval(context, requestId, decision)) {
            return;
          }
          // A stale answer (the prompt timed out, or the session restarted) has to fail:
          // nothing else clears the panel, and the reactor turns this error into exactly
          // the failure activity the client clears on. Answering quietly leaves the prompt
          // on screen with nothing left that could settle it.
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "request/respond",
            detail: `Unknown pending approval request: ${requestId}.`,
          });
        }),
      respondToUserInput: (threadId, requestId, answers) =>
        Effect.gen(function* () {
          const context = yield* requireSession(threadId);
          if (settleQuestion(context, requestId, answers)) {
            return;
          }
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "user-input/respond",
            detail: `Unknown pending user-input request: ${requestId}.`,
          });
        }),
      stopSession,
      listSessions,
      hasSession,
      readThread,
      rollbackThread,
      compactThread,
      stopAll,
      listModels,
      listSkills,
      listCommands,
      listPlugins,
      readPlugin,
      getComposerCapabilities,
      get streamEvents() {
        return Stream.fromQueue(runtimeEventQueue);
      },
    } satisfies PiAdapterShape;
  });

/**
 * A bundled plugin as plugin discovery describes it.
 *
 * `installed` and `enabled` are both permanently true: a bundled plugin is compiled into the
 * server, so there is no install step to run and no state to be in. `installPolicy` says as
 * much to the UI, which is what keeps an "install" button off a plugin that is already here.
 *
 * Exported for tests: the mapping is the part with a contract on the other side (the web
 * app's plugin browser and its composer mention menu), so it is worth pinning down without
 * standing up the whole adapter layer.
 */
export function describeBundledPlugin(plugin: BundledPlugin): ProviderPluginDescriptor {
  const { interface: surface } = plugin;
  return {
    id: bundledPluginId(plugin.name),
    name: plugin.name,
    source: { type: "local", path: `${BUNDLED_PLUGIN_MARKETPLACE_PATH}/${plugin.name}` },
    installed: true,
    enabled: true,
    installPolicy: "INSTALLED_BY_DEFAULT",
    // Nothing bundled asks the user to sign in. ON_USE rather than ON_INSTALL so the UI does
    // not imply a prompt the user would never see.
    authPolicy: "ON_USE",
    interface: {
      ...(surface.displayName === undefined ? {} : { displayName: surface.displayName }),
      ...(surface.shortDescription === undefined
        ? {}
        : { shortDescription: surface.shortDescription }),
      ...(surface.longDescription === undefined
        ? {}
        : { longDescription: surface.longDescription }),
      ...(surface.developerName === undefined ? {} : { developerName: surface.developerName }),
      ...(surface.category === undefined ? {} : { category: surface.category }),
      ...(surface.capabilities === undefined ? {} : { capabilities: [...surface.capabilities] }),
      ...(surface.websiteUrl === undefined ? {} : { websiteUrl: surface.websiteUrl }),
      ...(surface.privacyPolicyUrl === undefined
        ? {}
        : { privacyPolicyUrl: surface.privacyPolicyUrl }),
      ...(surface.termsOfServiceUrl === undefined
        ? {}
        : { termsOfServiceUrl: surface.termsOfServiceUrl }),
      ...(surface.brandColor === undefined ? {} : { brandColor: surface.brandColor }),
      ...(surface.composerIcon === undefined ? {} : { composerIcon: surface.composerIcon }),
      ...(surface.defaultPrompt === undefined ? {} : { defaultPrompt: [...surface.defaultPrompt] }),
    },
  };
}

export const PiAdapterLive = Layer.effect(PiAdapter, makePiAdapter());
export function makePiAdapterLive(options?: PiAdapterLiveOptions) {
  return Layer.effect(PiAdapter, makePiAdapter(options));
}
