import crypto from "node:crypto";
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
import { classifyPiTurnFailure } from "../piTurnFailure.ts";
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
    const modelRuntimes = new Map<string, Promise<ModelRuntime>>();
    const ownsNativeEventLogger = options?.nativeEventLogger === undefined;
    const nativeEventLogger =
      options?.nativeEventLogger ??
      (options?.nativeEventLogPath !== undefined
        ? yield* makeEventNdjsonLogger(options.nativeEventLogPath, { stream: "native" })
        : undefined);

    /**
     * One model/auth runtime per agent dir, shared by every session bound to it.
     *
     * `ModelRuntime.create` is async, so the cache holds the pending promise: two sessions
     * starting at once must not build (and then disagree over) separate credential stores.
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

    const getModelRuntime = (agentDir: string): Promise<ModelRuntime> => {
      const existing = modelRuntimes.get(agentDir);
      if (existing) return existing;
      const created = ModelRuntime.create({
        authPath: path.join(agentDir, "auth.json"),
        modelsPath: path.join(agentDir, "models.json"),
      }).catch((cause: unknown) => {
        // A failed build must not be cached, or the dir stays broken until restart.
        modelRuntimes.delete(agentDir);
        throw cause;
      });
      modelRuntimes.set(agentDir, created);
      return created;
    };

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
      // Answer every in-flight prompt with "cancel" before tearing down: the tool-call
      // handler is awaiting these promises, and the timers would otherwise outlive the
      // session and fire into a disposed runtime.
      for (const requestId of [...context.pendingApprovals.keys()]) {
        settleApproval(context, requestId, "cancel");
      }
      context.pendingQuestions.clear();
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
        const toolkitTools = buildThreadToolkitTools({
          cwd,
          conversationId: toolkitConversationId,
          callbacks: {
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
            try: () => context.runtime.session.abort(),
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
