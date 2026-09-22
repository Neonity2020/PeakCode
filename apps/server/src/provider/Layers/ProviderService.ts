/**
 * ProviderServiceLive - Cross-provider orchestration layer.
 *
 * Routes validated transport/API calls to provider adapters through
 * `ProviderAdapterRegistry` and `ProviderSessionDirectory`, and exposes a
 * unified provider event stream for subscribers.
 *
 * It does not implement provider protocol details (adapter concern).
 *
 * @module ProviderServiceLive
 */
import {
  ProviderCompactThreadInput,
  ProviderForkThreadInput,
  ModelSelection,
  NonNegativeInt,
  ThreadId,
  TurnId,
  ProviderInterruptTurnInput,
  ProviderRespondToRequestInput,
  ProviderRespondToUserInputInput,
  ProviderSendTurnInput,
  ProviderStartReviewInput,
  ProviderSteerTurnInput,
  ProviderSessionStartInput,
  ProviderStopSessionInput,
  ProviderStopSubagentInput,
  ProviderStartOptions,
  EventId,
  type ProviderRuntimeEvent,
  type ProviderSession,
} from "@peakcode/contracts";
import {
  Cause,
  Duration,
  Effect,
  Layer,
  Option,
  PubSub,
  Schema,
  SchemaIssue,
  Stream,
} from "effect";

import { ProviderValidationError } from "../Errors.ts";
import { ProviderAdapterRegistry } from "../Services/ProviderAdapterRegistry.ts";
import { ProviderService, type ProviderServiceShape } from "../Services/ProviderService.ts";
import {
  ProviderSessionDirectory,
  type ProviderRuntimeBinding,
  type ProviderSessionDirectoryWriteError,
} from "../Services/ProviderSessionDirectory.ts";
import { type EventNdjsonLogger, makeEventNdjsonLogger } from "./EventNdjsonLogger.ts";
import { AnalyticsService } from "../../telemetry/Services/AnalyticsService.ts";

export interface ProviderServiceLiveOptions {
  readonly canonicalEventLogPath?: string;
  readonly canonicalEventLogger?: EventNdjsonLogger;
  /** Overrides `PEAKCODE_PROVIDER_TURN_STALL_MS`; tests use a short one. */
  readonly turnStallTimeoutMs?: number;
  /** Overrides how long `abandonTurn` waits for the provider to acknowledge a stop. */
  readonly turnAbandonTimeoutMs?: number;
}

const DEFAULT_PROVIDER_RUNTIME_IDLE_STOP_MS = 10 * 60 * 1000;
const PROVIDER_RUNTIME_IDLE_STOP_MS = Number.isFinite(
  Number(process.env.PEAKCODE_PROVIDER_RUNTIME_IDLE_STOP_MS),
)
  ? Math.max(0, Number(process.env.PEAKCODE_PROVIDER_RUNTIME_IDLE_STOP_MS))
  : DEFAULT_PROVIDER_RUNTIME_IDLE_STOP_MS;

/**
 * How long a turn may go without a single provider event before it is treated as wedged.
 *
 * Nothing else bounds this: a request that opens a stream and then goes quiet is under no
 * timeout the provider SDK applies, and a run parked that way never ends on its own — no
 * `turn.completed` is coming, so the thread reads as running forever and the user is left
 * watching a spinner with no way to tell whether any work is happening.
 *
 * It has to clear every wait the runtime can legitimately park on: an approval prompt and an
 * `ask_user` question both time out at ten minutes and announce themselves when they open, the
 * toolkit caps a shell command at two, and pi's own bash tool has no cap at all — which is why
 * this is generous rather than tight. Silence past it means the turn is not progressing.
 */
const DEFAULT_PROVIDER_TURN_STALL_MS = 30 * 60 * 1000;
const PROVIDER_TURN_STALL_MS = Number.isFinite(Number(process.env.PEAKCODE_PROVIDER_TURN_STALL_MS))
  ? Math.max(0, Number(process.env.PEAKCODE_PROVIDER_TURN_STALL_MS))
  : DEFAULT_PROVIDER_TURN_STALL_MS;

/** How long an abandoned turn waits for the provider to acknowledge the stop. */
const TURN_ABANDON_TIMEOUT: Duration.Duration = Duration.seconds(15);

const ProviderTurnAbandonInput = Schema.Struct({
  threadId: ThreadId,
  turnId: Schema.optional(TurnId),
  providerThreadId: Schema.optional(Schema.String),
});

const ProviderRollbackConversationInput = Schema.Struct({
  threadId: ThreadId,
  numTurns: NonNegativeInt,
});

function toValidationError(
  operation: string,
  issue: string,
  cause?: unknown,
): ProviderValidationError {
  return new ProviderValidationError({
    operation,
    issue,
    ...(cause !== undefined ? { cause } : {}),
  });
}

const decodeInputOrValidationError = <S extends Schema.Top>(input: {
  readonly operation: string;
  readonly schema: S;
  readonly payload: unknown;
}) =>
  Schema.decodeUnknownEffect(input.schema)(input.payload).pipe(
    Effect.mapError(
      (schemaError) =>
        new ProviderValidationError({
          operation: input.operation,
          issue: SchemaIssue.makeFormatterDefault()(schemaError.issue),
          cause: schemaError,
        }),
    ),
  );

function toRuntimeStatus(session: ProviderSession): "starting" | "running" | "stopped" | "error" {
  switch (session.status) {
    case "connecting":
      return "starting";
    case "error":
      return "error";
    case "closed":
      return "stopped";
    case "ready":
    case "running":
    default:
      return "running";
  }
}

function toRuntimePayloadFromSession(
  session: ProviderSession,
  extra?: {
    readonly modelSelection?: unknown;
    readonly providerOptions?: unknown;
    readonly lastRuntimeEvent?: string;
    readonly lastRuntimeEventAt?: string;
  },
): Record<string, unknown> {
  return {
    cwd: session.cwd ?? null,
    model: session.model ?? null,
    activeTurnId: session.activeTurnId ?? null,
    lastError: session.lastError ?? null,
    ...(extra?.modelSelection !== undefined ? { modelSelection: extra.modelSelection } : {}),
    ...(extra?.providerOptions !== undefined ? { providerOptions: extra.providerOptions } : {}),
    ...(extra?.lastRuntimeEvent !== undefined ? { lastRuntimeEvent: extra.lastRuntimeEvent } : {}),
    ...(extra?.lastRuntimeEventAt !== undefined
      ? { lastRuntimeEventAt: extra.lastRuntimeEventAt }
      : {}),
  };
}

function readPersistedModelSelection(
  runtimePayload: ProviderRuntimeBinding["runtimePayload"],
): ModelSelection | undefined {
  if (!runtimePayload || typeof runtimePayload !== "object" || Array.isArray(runtimePayload)) {
    return undefined;
  }
  const raw = "modelSelection" in runtimePayload ? runtimePayload.modelSelection : undefined;
  return Schema.is(ModelSelection)(raw) ? raw : undefined;
}

function readPersistedProviderOptions(
  runtimePayload: ProviderRuntimeBinding["runtimePayload"],
): ProviderStartOptions | undefined {
  if (!runtimePayload || typeof runtimePayload !== "object" || Array.isArray(runtimePayload)) {
    return undefined;
  }
  const raw = "providerOptions" in runtimePayload ? runtimePayload.providerOptions : undefined;
  return Schema.is(ProviderStartOptions)(raw) ? raw : undefined;
}

function readPersistedCwd(
  runtimePayload: ProviderRuntimeBinding["runtimePayload"],
): string | undefined {
  if (!runtimePayload || typeof runtimePayload !== "object" || Array.isArray(runtimePayload)) {
    return undefined;
  }
  const rawCwd = "cwd" in runtimePayload ? runtimePayload.cwd : undefined;
  if (typeof rawCwd !== "string") return undefined;
  const trimmed = rawCwd.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function runtimePayloadRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function runtimeStatusForEvent(event: ProviderRuntimeEvent): "running" | "stopped" | "error" {
  switch (event.type) {
    case "session.state.changed":
      switch (event.payload.state) {
        case "stopped":
          return "stopped";
        case "error":
          return "error";
        default:
          return "running";
      }
    case "session.exited":
    case "turn.completed":
    case "turn.aborted":
      // A completed turn can still carry a resume cursor, but it must not keep
      // the desktop app treating the provider process as active after restart.
      return "stopped";
    case "runtime.error":
      return "error";
    default:
      return "running";
  }
}

function runtimeLastErrorForEvent(event: ProviderRuntimeEvent): string | null | undefined {
  switch (event.type) {
    case "runtime.error":
      return event.payload.message;
    case "session.state.changed":
      return event.payload.state === "error" ? (event.payload.reason ?? "Session error") : null;
    case "turn.started":
    case "turn.completed":
    case "turn.aborted":
    case "session.exited":
      return null;
    default:
      return undefined;
  }
}

const makeProviderService = (options?: ProviderServiceLiveOptions) =>
  Effect.gen(function* () {
    const analytics = yield* Effect.service(AnalyticsService);
    const canonicalEventLogger =
      options?.canonicalEventLogger ??
      (options?.canonicalEventLogPath !== undefined
        ? yield* makeEventNdjsonLogger(options.canonicalEventLogPath, {
            stream: "canonical",
          })
        : undefined);

    const registry = yield* ProviderAdapterRegistry;
    const turnStallTimeoutMs = options?.turnStallTimeoutMs ?? PROVIDER_TURN_STALL_MS;
    const turnAbandonTimeout: Duration.Duration = Duration.millis(
      options?.turnAbandonTimeoutMs ?? Duration.toMillis(TURN_ABANDON_TIMEOUT),
    );
    const directory = yield* ProviderSessionDirectory;
    const runtimeEventPubSub = yield* PubSub.unbounded<ProviderRuntimeEvent>();
    const runtimeIdleTimers = new Map<ThreadId, ReturnType<typeof setTimeout>>();
    let stopIdleRuntimeSession: ((threadId: ThreadId) => void) | null = null;

    const clearRuntimeIdleTimer = (threadId: ThreadId) => {
      const timer = runtimeIdleTimers.get(threadId);
      if (!timer) {
        return;
      }
      clearTimeout(timer);
      runtimeIdleTimers.delete(threadId);
    };

    const scheduleRuntimeIdleStop = (threadId: ThreadId) => {
      clearRuntimeIdleTimer(threadId);
      if (PROVIDER_RUNTIME_IDLE_STOP_MS <= 0) {
        return;
      }

      const timer = setTimeout(() => {
        runtimeIdleTimers.delete(threadId);
        stopIdleRuntimeSession?.(threadId);
      }, PROVIDER_RUNTIME_IDLE_STOP_MS);
      timer.unref();
      runtimeIdleTimers.set(threadId, timer);
    };

    const reconcileRuntimeIdleTimer = (event: ProviderRuntimeEvent) => {
      switch (event.type) {
        case "turn.started":
          clearRuntimeIdleTimer(event.threadId);
          return;
        case "session.started":
        case "thread.started":
        case "turn.completed":
        case "turn.aborted":
          scheduleRuntimeIdleStop(event.threadId);
          return;
        case "session.exited":
          clearRuntimeIdleTimer(event.threadId);
          return;
      }
    };

    const publishRuntimeEvent = (event: ProviderRuntimeEvent): Effect.Effect<void> =>
      Effect.succeed(event).pipe(
        Effect.tap((canonicalEvent) =>
          canonicalEventLogger ? canonicalEventLogger.write(canonicalEvent, null) : Effect.void,
        ),
        Effect.flatMap((canonicalEvent) => PubSub.publish(runtimeEventPubSub, canonicalEvent)),
        Effect.asVoid,
      );

    const turnStallWatchdogs = new Map<ThreadId, ReturnType<typeof setTimeout>>();
    /** Turn the watchdog is currently guarding, per thread, so its failure can be attributed. */
    const watchedTurns = new Map<ThreadId, TurnId | undefined>();
    let failStalledTurn: ((threadId: ThreadId) => void) | null = null;

    const clearTurnStallWatchdog = (threadId: ThreadId) => {
      const timer = turnStallWatchdogs.get(threadId);
      if (timer) {
        clearTimeout(timer);
      }
      turnStallWatchdogs.delete(threadId);
      watchedTurns.delete(threadId);
    };

    /**
     * Restart the stall clock. Called for every provider event that is not itself the end of the
     * turn: any of them means the run is still making progress.
     */
    const armTurnStallWatchdog = (threadId: ThreadId, turnId: TurnId | undefined) => {
      clearTurnStallWatchdog(threadId);
      if (turnStallTimeoutMs <= 0) {
        return;
      }

      const timer = setTimeout(() => {
        turnStallWatchdogs.delete(threadId);
        failStalledTurn?.(threadId);
      }, turnStallTimeoutMs);
      timer.unref();
      turnStallWatchdogs.set(threadId, timer);
      watchedTurns.set(threadId, turnId);
    };

    const reconcileTurnStallWatchdog = (event: ProviderRuntimeEvent) => {
      switch (event.type) {
        case "turn.started":
          armTurnStallWatchdog(event.threadId, event.turnId);
          return;
        case "turn.completed":
        case "turn.aborted":
        case "session.exited":
          clearTurnStallWatchdog(event.threadId);
          return;
        case "session.state.changed":
          if (
            event.payload.state === "ready" ||
            event.payload.state === "stopped" ||
            event.payload.state === "error"
          ) {
            clearTurnStallWatchdog(event.threadId);
            return;
          }
          break;
      }

      // Anything else is progress for the turn being watched. Events for a thread with no turn
      // in flight (a session announcing itself, tool output from a subagent) must not start a
      // clock of their own, or a busy thread would look permanently stalled.
      if (watchedTurns.has(event.threadId)) {
        armTurnStallWatchdog(event.threadId, watchedTurns.get(event.threadId));
      }
    };

    const upsertSessionBinding = (
      session: ProviderSession,
      threadId: ThreadId,
      extra?: {
        readonly modelSelection?: unknown;
        readonly providerOptions?: unknown;
        readonly lastRuntimeEvent?: string;
        readonly lastRuntimeEventAt?: string;
      },
    ) =>
      directory.upsert({
        threadId,
        provider: session.provider,
        runtimeMode: session.runtimeMode,
        status: toRuntimeStatus(session),
        ...(session.resumeCursor !== undefined ? { resumeCursor: session.resumeCursor } : {}),
        runtimePayload: toRuntimePayloadFromSession(session, extra),
      });

    const upsertStoppedSessionBinding = (
      session: ProviderSession,
      stoppedAt: string,
    ): Effect.Effect<void, ProviderSessionDirectoryWriteError> =>
      directory.upsert({
        threadId: session.threadId,
        provider: session.provider,
        runtimeMode: session.runtimeMode,
        status: "stopped",
        ...(session.resumeCursor !== undefined ? { resumeCursor: session.resumeCursor } : {}),
        runtimePayload: {
          ...toRuntimePayloadFromSession(session, {
            lastRuntimeEvent: "provider.stopAll",
            lastRuntimeEventAt: stoppedAt,
          }),
          activeTurnId: null,
        },
      });

    const markPersistedThreadStopped = (
      threadId: ThreadId,
      stoppedAt: string,
    ): Effect.Effect<void, ProviderSessionDirectoryWriteError> =>
      directory.getProvider(threadId).pipe(
        Effect.flatMap((provider) =>
          directory.upsert({
            threadId,
            provider,
            status: "stopped",
            runtimePayload: {
              activeTurnId: null,
              lastRuntimeEvent: "provider.stopAll",
              lastRuntimeEventAt: stoppedAt,
            },
          }),
        ),
      );

    const updateSessionBindingFromRuntimeEvent = (
      event: ProviderRuntimeEvent,
    ): Effect.Effect<void> => {
      switch (event.type) {
        case "session.started":
        case "session.state.changed":
        case "thread.started":
        case "turn.started":
        case "turn.completed":
        case "turn.aborted":
        case "session.exited":
        case "runtime.error":
          break;
        default:
          return Effect.void;
      }

      return Effect.gen(function* () {
        const binding = Option.getOrUndefined(yield* directory.getBinding(event.threadId));
        if (!binding) {
          return;
        }

        const activeTurnId =
          event.type === "turn.started"
            ? (event.turnId ?? null)
            : event.type === "turn.completed" ||
                event.type === "turn.aborted" ||
                event.type === "session.exited" ||
                event.type === "runtime.error" ||
                (event.type === "session.state.changed" &&
                  (event.payload.state === "ready" ||
                    event.payload.state === "stopped" ||
                    event.payload.state === "error"))
              ? null
              : (runtimePayloadRecord(binding.runtimePayload).activeTurnId ?? null);
        const lastError = runtimeLastErrorForEvent(event);

        yield* directory.upsert({
          threadId: event.threadId,
          provider: binding.provider,
          ...(binding.adapterKey !== undefined ? { adapterKey: binding.adapterKey } : {}),
          ...(binding.runtimeMode !== undefined ? { runtimeMode: binding.runtimeMode } : {}),
          status: runtimeStatusForEvent(event),
          ...(binding.resumeCursor !== undefined ? { resumeCursor: binding.resumeCursor } : {}),
          runtimePayload: {
            activeTurnId,
            lastRuntimeEvent: event.type,
            lastRuntimeEventAt: event.createdAt,
            ...(lastError !== undefined ? { lastError } : {}),
          },
        });
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("provider.session.runtime_binding_update_failed", {
            threadId: event.threadId,
            eventType: event.type,
            cause: Cause.pretty(cause),
          }),
        ),
      );
    };

    const providers = yield* registry.listProviders();
    const adapters = yield* Effect.forEach(providers, (provider) =>
      registry.getByProvider(provider),
    );
    const processRuntimeEvent = (event: ProviderRuntimeEvent): Effect.Effect<void> =>
      Effect.sync(() => {
        reconcileRuntimeIdleTimer(event);
        reconcileTurnStallWatchdog(event);
      }).pipe(
        Effect.andThen(updateSessionBindingFromRuntimeEvent(event)),
        Effect.andThen(publishRuntimeEvent(event)),
      );

    // Fan provider events straight into the pubsub so Claude's high-volume
    // streams do not pay for an extra queue hop in the hot path.
    yield* Effect.forEach(adapters, (adapter) =>
      Stream.runForEach(adapter.streamEvents, processRuntimeEvent).pipe(Effect.forkScoped),
    ).pipe(Effect.asVoid);

    const recoverSessionForThread = (input: {
      readonly binding: ProviderRuntimeBinding;
      readonly operation: string;
    }) =>
      Effect.gen(function* () {
        const adapter = yield* registry.getByProvider(input.binding.provider);
        const hasResumeCursor =
          input.binding.resumeCursor !== null && input.binding.resumeCursor !== undefined;
        const hasActiveSession = yield* adapter.hasSession(input.binding.threadId);
        if (hasActiveSession) {
          const activeSessions = yield* adapter.listSessions();
          const existing = activeSessions.find(
            (session) => session.threadId === input.binding.threadId,
          );
          if (existing) {
            yield* upsertSessionBinding(existing, input.binding.threadId);
            yield* analytics.record("provider.session.recovered", {
              provider: existing.provider,
              strategy: "adopt-existing",
              hasResumeCursor: existing.resumeCursor !== undefined,
            });
            return { adapter, session: existing } as const;
          }
        }

        if (!hasResumeCursor) {
          return yield* toValidationError(
            input.operation,
            `Cannot recover thread '${input.binding.threadId}' because no provider resume state is persisted.`,
          );
        }

        const persistedCwd = readPersistedCwd(input.binding.runtimePayload);
        const persistedModelSelection = readPersistedModelSelection(input.binding.runtimePayload);
        const persistedProviderOptions = readPersistedProviderOptions(input.binding.runtimePayload);

        const resumed = yield* adapter.startSession({
          threadId: input.binding.threadId,
          provider: input.binding.provider,
          ...(persistedCwd ? { cwd: persistedCwd } : {}),
          ...(persistedModelSelection ? { modelSelection: persistedModelSelection } : {}),
          ...(persistedProviderOptions ? { providerOptions: persistedProviderOptions } : {}),
          ...(hasResumeCursor ? { resumeCursor: input.binding.resumeCursor } : {}),
          runtimeMode: input.binding.runtimeMode ?? "full-access",
        });
        if (resumed.provider !== adapter.provider) {
          return yield* toValidationError(
            input.operation,
            `Adapter/provider mismatch while recovering thread '${input.binding.threadId}'. Expected '${adapter.provider}', received '${resumed.provider}'.`,
          );
        }

        yield* upsertSessionBinding(resumed, input.binding.threadId);
        yield* analytics.record("provider.session.recovered", {
          provider: resumed.provider,
          strategy: "resume-thread",
          hasResumeCursor: resumed.resumeCursor !== undefined,
        });
        return { adapter, session: resumed } as const;
      });

    const resolveRoutableSession = (input: {
      readonly threadId: ThreadId;
      readonly operation: string;
      readonly allowRecovery: boolean;
    }) =>
      Effect.gen(function* () {
        const bindingOption = yield* directory.getBinding(input.threadId);
        const binding = Option.getOrUndefined(bindingOption);
        if (!binding) {
          return yield* toValidationError(
            input.operation,
            `Cannot route thread '${input.threadId}' because no persisted provider binding exists.`,
          );
        }
        const adapter = yield* registry.getByProvider(binding.provider);

        const hasRequestedSession = yield* adapter.hasSession(input.threadId);
        if (hasRequestedSession) {
          return { adapter, threadId: input.threadId, isActive: true } as const;
        }

        if (!input.allowRecovery) {
          return { adapter, threadId: input.threadId, isActive: false } as const;
        }

        const recovered = yield* recoverSessionForThread({ binding, operation: input.operation });
        return { adapter: recovered.adapter, threadId: input.threadId, isActive: true } as const;
      });

    const startSession: ProviderServiceShape["startSession"] = (threadId, rawInput) =>
      Effect.gen(function* () {
        const parsed = yield* decodeInputOrValidationError({
          operation: "ProviderService.startSession",
          schema: ProviderSessionStartInput,
          payload: rawInput,
        });

        const input = {
          ...parsed,
          threadId,
          provider: parsed.provider ?? "pi",
        };
        clearRuntimeIdleTimer(threadId);
        const persistedBinding = Option.getOrUndefined(yield* directory.getBinding(threadId));
        const effectiveResumeCursor =
          input.resumeCursor ??
          (persistedBinding?.provider === input.provider
            ? persistedBinding.resumeCursor
            : undefined);
        const effectiveProviderOptions =
          input.providerOptions ??
          (persistedBinding?.provider === input.provider
            ? readPersistedProviderOptions(persistedBinding.runtimePayload)
            : undefined);
        const adapter = yield* registry.getByProvider(input.provider);
        const session = yield* adapter.startSession({
          ...input,
          ...(effectiveProviderOptions !== undefined
            ? { providerOptions: effectiveProviderOptions }
            : {}),
          ...(effectiveResumeCursor !== undefined ? { resumeCursor: effectiveResumeCursor } : {}),
        });

        if (session.provider !== adapter.provider) {
          return yield* toValidationError(
            "ProviderService.startSession",
            `Adapter/provider mismatch: requested '${adapter.provider}', received '${session.provider}'.`,
          );
        }

        yield* upsertSessionBinding(session, threadId, {
          modelSelection: input.modelSelection,
          providerOptions: effectiveProviderOptions,
        });
        yield* analytics.record("provider.session.started", {
          provider: session.provider,
          runtimeMode: input.runtimeMode,
          hasResumeCursor: session.resumeCursor !== undefined,
          hasCwd: typeof input.cwd === "string" && input.cwd.trim().length > 0,
          hasModel:
            typeof input.modelSelection?.model === "string" &&
            input.modelSelection.model.trim().length > 0,
        });

        return session;
      });

    const forkThread: NonNullable<ProviderServiceShape["forkThread"]> = (rawInput) =>
      Effect.gen(function* () {
        const input = yield* decodeInputOrValidationError({
          operation: "ProviderService.forkThread",
          schema: ProviderForkThreadInput,
          payload: rawInput,
        });

        const sourceBinding = Option.getOrUndefined(
          yield* directory.getBinding(input.sourceThreadId),
        );
        if (!sourceBinding) {
          return null;
        }

        const existingTargetBinding = Option.getOrUndefined(
          yield* directory.getBinding(input.threadId),
        );
        if (existingTargetBinding) {
          return null;
        }

        const effectiveProviderOptions =
          input.providerOptions ?? readPersistedProviderOptions(sourceBinding.runtimePayload);

        const adapter = yield* registry.getByProvider(sourceBinding.provider);
        if (!adapter.forkThread) {
          return null;
        }

        if (
          input.modelSelection !== undefined &&
          input.modelSelection.provider !== adapter.provider
        ) {
          return null;
        }

        const forked = yield* adapter
          .forkThread({
            ...input,
            threadId: input.threadId,
            sourceThreadId: input.sourceThreadId,
            ...(effectiveProviderOptions !== undefined
              ? { providerOptions: effectiveProviderOptions }
              : {}),
            ...(sourceBinding.resumeCursor !== null && sourceBinding.resumeCursor !== undefined
              ? { sourceResumeCursor: sourceBinding.resumeCursor }
              : {}),
            runtimeMode: input.runtimeMode,
          })
          .pipe(
            Effect.catch((error) =>
              Effect.logWarning("provider native fork failed; falling back", {
                sourceThreadId: input.sourceThreadId,
                targetThreadId: input.threadId,
                cause: error instanceof Error ? error.message : String(error),
              }).pipe(Effect.as(null)),
            ),
          );
        if (!forked) {
          return null;
        }

        const forkedSession = (yield* adapter.listSessions()).find(
          (session) => session.threadId === input.threadId,
        );
        if (forkedSession) {
          yield* upsertSessionBinding(forkedSession, input.threadId, {
            ...(input.modelSelection !== undefined ? { modelSelection: input.modelSelection } : {}),
            ...(effectiveProviderOptions !== undefined
              ? { providerOptions: effectiveProviderOptions }
              : {}),
            lastRuntimeEvent: "provider.thread.forked",
            lastRuntimeEventAt: new Date().toISOString(),
          });
        } else {
          yield* directory.upsert({
            threadId: input.threadId,
            provider: adapter.provider,
            runtimeMode: input.runtimeMode,
            status: "stopped",
            ...(forked.resumeCursor !== undefined ? { resumeCursor: forked.resumeCursor } : {}),
            runtimePayload: {
              cwd: input.cwd ?? null,
              model: input.modelSelection?.model ?? null,
              activeTurnId: null,
              lastError: null,
              ...(input.modelSelection !== undefined
                ? { modelSelection: input.modelSelection }
                : {}),
              ...(effectiveProviderOptions !== undefined
                ? { providerOptions: effectiveProviderOptions }
                : {}),
              lastRuntimeEvent: "provider.thread.forked",
              lastRuntimeEventAt: new Date().toISOString(),
            },
          });
        }
        yield* analytics.record("provider.thread.forked", {
          provider: adapter.provider,
        });
        return forked;
      });

    const sendTurn: ProviderServiceShape["sendTurn"] = (rawInput) =>
      Effect.gen(function* () {
        const parsed = yield* decodeInputOrValidationError({
          operation: "ProviderService.sendTurn",
          schema: ProviderSendTurnInput,
          payload: rawInput,
        });

        const input = {
          ...parsed,
          attachments: parsed.attachments ?? [],
        };
        if (!input.input && input.attachments.length === 0) {
          return yield* toValidationError(
            "ProviderService.sendTurn",
            "Either input text or at least one attachment is required",
          );
        }
        const routed = yield* resolveRoutableSession({
          threadId: input.threadId,
          operation: "ProviderService.sendTurn",
          allowRecovery: true,
        });
        const turn = yield* routed.adapter.sendTurn(input);
        yield* directory.upsert({
          threadId: input.threadId,
          provider: routed.adapter.provider,
          status: "running",
          ...(turn.resumeCursor !== undefined ? { resumeCursor: turn.resumeCursor } : {}),
          runtimePayload: {
            ...(input.modelSelection !== undefined ? { modelSelection: input.modelSelection } : {}),
            activeTurnId: turn.turnId,
            lastRuntimeEvent: "provider.sendTurn",
            lastRuntimeEventAt: new Date().toISOString(),
          },
        });
        yield* analytics.record("provider.turn.sent", {
          provider: routed.adapter.provider,
          model: input.modelSelection?.model,
          interactionMode: input.interactionMode,
          attachmentCount: input.attachments.length,
          hasInput: typeof input.input === "string" && input.input.trim().length > 0,
        });
        return turn;
      });

    const steerTurn: ProviderServiceShape["steerTurn"] = (rawInput) =>
      Effect.gen(function* () {
        const parsed = yield* decodeInputOrValidationError({
          operation: "ProviderService.steerTurn",
          schema: ProviderSteerTurnInput,
          payload: rawInput,
        });

        const input = {
          ...parsed,
          attachments: parsed.attachments ?? [],
        };
        if (!input.input && input.attachments.length === 0) {
          return yield* toValidationError(
            "ProviderService.steerTurn",
            "Either input text or at least one attachment is required",
          );
        }
        const routed = yield* resolveRoutableSession({
          threadId: input.threadId,
          operation: "ProviderService.steerTurn",
          allowRecovery: true,
        });
        if (
          !routed.adapter.steerTurn ||
          routed.adapter.capabilities.supportsTurnSteering !== true
        ) {
          return yield* toValidationError(
            "ProviderService.steerTurn",
            `Provider '${routed.adapter.provider}' does not support steering an active turn.`,
          );
        }
        const turn = yield* routed.adapter.steerTurn(input);
        yield* directory.upsert({
          threadId: input.threadId,
          provider: routed.adapter.provider,
          status: "running",
          ...(turn.resumeCursor !== undefined ? { resumeCursor: turn.resumeCursor } : {}),
          runtimePayload: {
            ...(input.modelSelection !== undefined ? { modelSelection: input.modelSelection } : {}),
            activeTurnId: turn.turnId,
            lastRuntimeEvent: "provider.steerTurn",
            lastRuntimeEventAt: new Date().toISOString(),
          },
        });
        yield* analytics.record("provider.turn.steered", {
          provider: routed.adapter.provider,
          model: input.modelSelection?.model,
          interactionMode: input.interactionMode,
          attachmentCount: input.attachments.length,
          hasInput: typeof input.input === "string" && input.input.trim().length > 0,
        });
        return turn;
      });

    const startReview: ProviderServiceShape["startReview"] = (rawInput) =>
      Effect.gen(function* () {
        const input = yield* decodeInputOrValidationError({
          operation: "ProviderService.startReview",
          schema: ProviderStartReviewInput,
          payload: rawInput,
        });

        const routed = yield* resolveRoutableSession({
          threadId: input.threadId,
          operation: "ProviderService.startReview",
          allowRecovery: true,
        });
        if (!routed.adapter.startReview) {
          return yield* toValidationError(
            "ProviderService.startReview",
            `Provider '${routed.adapter.provider}' does not support native review.`,
          );
        }

        const turn = yield* routed.adapter.startReview(input);
        yield* directory.upsert({
          threadId: input.threadId,
          provider: routed.adapter.provider,
          status: "running",
          ...(turn.resumeCursor !== undefined ? { resumeCursor: turn.resumeCursor } : {}),
          runtimePayload: {
            activeTurnId: turn.turnId,
            lastRuntimeEvent: "provider.startReview",
            lastRuntimeEventAt: new Date().toISOString(),
          },
        });
        yield* analytics.record("provider.review.started", {
          provider: routed.adapter.provider,
          target: input.target.type,
        });
        return turn;
      });

    /**
     * Stop a turn, and free the runtime when the provider will not.
     *
     * `interruptTurn` is a request: a run wedged on a request that ignores the abort signal —
     * or on a tool that does — accepts it and then never settles. Waiting longer does not help,
     * and leaving the runtime in place is worse than it sounds: the next message would be
     * steered *into* the wedged run instead of starting a turn. Stopping the session ends that
     * run and keeps the persisted resume state, so the conversation continues on the next
     * message rather than starting over.
     */
    const abandonTurn: ProviderServiceShape["abandonTurn"] = (rawInput) =>
      Effect.gen(function* () {
        const input = yield* decodeInputOrValidationError({
          operation: "ProviderService.abandonTurn",
          schema: ProviderTurnAbandonInput,
          payload: rawInput,
        });
        const binding = Option.getOrUndefined(yield* directory.getBinding(input.threadId));
        if (!binding) {
          return "idle" as const;
        }
        const adapter = yield* registry.getByProvider(binding.provider);
        if (!(yield* adapter.hasSession(input.threadId))) {
          return "idle" as const;
        }

        const acknowledged = yield* adapter
          .interruptTurn(input.threadId, input.turnId, input.providerThreadId)
          .pipe(
            Effect.timeoutOption(turnAbandonTimeout),
            Effect.catchCause((cause) =>
              Effect.logWarning("provider refused to interrupt a turn", {
                threadId: input.threadId,
                cause: Cause.pretty(cause),
              }).pipe(Effect.as(Option.none<void>())),
            ),
          );
        if (Option.isSome(acknowledged)) {
          yield* analytics.record("provider.turn.interrupted", { provider: adapter.provider });
          return "stopped" as const;
        }

        yield* Effect.logWarning("provider turn did not stop in time; stopping its session", {
          threadId: input.threadId,
          turnId: input.turnId,
          timeoutMs: Duration.toMillis(turnAbandonTimeout),
        });
        yield* adapter.stopSession(input.threadId).pipe(
          Effect.timeoutOption(turnAbandonTimeout),
          Effect.catchCause((cause) =>
            Effect.logWarning("failed to stop the session of an abandoned turn", {
              threadId: input.threadId,
              cause: Cause.pretty(cause),
            }),
          ),
        );
        yield* analytics.record("provider.turn.abandoned", { provider: adapter.provider });
        return "freed" as const;
      });

    /**
     * The provider went quiet in the middle of a turn.
     *
     * Report the turn as failed — that is what every consumer already understands, so the
     * thread leaves "running", the user gets the reason, and anything waiting on the turn's
     * outcome stops waiting — and then let go of the runtime that is holding it.
     */
    const handleStalledTurn = (threadId: ThreadId) =>
      Effect.gen(function* () {
        const turnId = watchedTurns.get(threadId);
        const binding = Option.getOrUndefined(yield* directory.getBinding(threadId));
        clearTurnStallWatchdog(threadId);
        if (!binding) {
          return;
        }

        const message = `No activity from the provider for ${Math.max(
          1,
          Math.round(turnStallTimeoutMs / 60_000),
        )} minutes, so this turn was stopped. The provider request may still be hanging; send a message to continue.`;
        const base = {
          provider: binding.provider,
          threadId,
          createdAt: new Date().toISOString(),
          ...(turnId !== undefined ? { turnId } : {}),
        };

        yield* Effect.logWarning("provider turn stalled; failing it", {
          threadId,
          turnId,
          stallMs: turnStallTimeoutMs,
        });
        yield* publishRuntimeEvent({
          ...base,
          eventId: EventId.makeUnsafe(crypto.randomUUID()),
          type: "turn.completed",
          payload: { state: "failed", stopReason: "stalled", errorMessage: message },
        } satisfies ProviderRuntimeEvent);
        yield* publishRuntimeEvent({
          ...base,
          eventId: EventId.makeUnsafe(crypto.randomUUID()),
          type: "runtime.error",
          payload: {
            message,
            class: "transport_error",
            detail: { stallMs: turnStallTimeoutMs },
          },
        } satisfies ProviderRuntimeEvent);

        // Last, so the failure above is what the turn is remembered by; this is what lets the
        // next message start a turn instead of steering into the wedged one.
        yield* abandonTurn({
          threadId,
          ...(turnId !== undefined ? { turnId } : {}),
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("failed to release the runtime of a stalled turn", {
              threadId,
              cause: Cause.pretty(cause),
            }),
          ),
        );
      });

    failStalledTurn = (threadId) => {
      void Effect.runPromise(
        handleStalledTurn(threadId).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("provider turn stall watchdog failed", {
              threadId,
              cause: Cause.pretty(cause),
            }),
          ),
        ),
      );
    };

    const interruptTurn: ProviderServiceShape["interruptTurn"] = (rawInput) =>
      Effect.gen(function* () {
        const input = yield* decodeInputOrValidationError({
          operation: "ProviderService.interruptTurn",
          schema: ProviderInterruptTurnInput,
          payload: rawInput,
        });
        const routed = yield* resolveRoutableSession({
          threadId: input.threadId,
          operation: "ProviderService.interruptTurn",
          // A stop must not resurrect a session. Recovery starts a *fresh* runtime and then
          // aborts that: it reports success while the turn it was asked to stop runs on, and
          // it hides the fact the caller needs — there is no live session, so nothing here can
          // end the turn. Whether that means "the turn is already over" is a question only the
          // caller can answer (see `ProviderCommandReactor`, which closes the abandoned turn).
          allowRecovery: false,
        });
        if (!routed.isActive) {
          yield* Effect.logInfo("provider interrupt skipped: no live session", {
            threadId: input.threadId,
          });
          return;
        }
        yield* routed.adapter.interruptTurn(routed.threadId, input.turnId, input.providerThreadId);
        yield* analytics.record("provider.turn.interrupted", {
          provider: routed.adapter.provider,
        });
      });

    const stopSubagent: ProviderServiceShape["stopSubagent"] = (rawInput) =>
      Effect.gen(function* () {
        const input = yield* decodeInputOrValidationError({
          operation: "ProviderService.stopSubagent",
          schema: ProviderStopSubagentInput,
          payload: rawInput,
        });
        const routed = yield* resolveRoutableSession({
          threadId: input.threadId,
          operation: "ProviderService.stopSubagent",
          // Same rule as a turn stop: a worker can only be stopped by the session that owns it,
          // and recovering one here would abort a fresh runtime while the real worker runs on.
          allowRecovery: false,
        });
        const stop = routed.adapter.stopSubagent;
        if (!routed.isActive || !stop) {
          yield* Effect.logInfo("provider sub-agent stop skipped: no live session or unsupported", {
            threadId: input.threadId,
          });
          return false;
        }
        const stopped = yield* stop({
          threadId: routed.threadId,
          providerThreadId: input.providerThreadId,
        });
        if (stopped) {
          yield* analytics.record("provider.subagent.stopped", {
            provider: routed.adapter.provider,
          });
        }
        return stopped;
      });

    const respondToRequest: ProviderServiceShape["respondToRequest"] = (rawInput) =>
      Effect.gen(function* () {
        const input = yield* decodeInputOrValidationError({
          operation: "ProviderService.respondToRequest",
          schema: ProviderRespondToRequestInput,
          payload: rawInput,
        });
        const routed = yield* resolveRoutableSession({
          threadId: input.threadId,
          operation: "ProviderService.respondToRequest",
          allowRecovery: true,
        });
        yield* routed.adapter.respondToRequest(routed.threadId, input.requestId, input.decision);
        yield* analytics.record("provider.request.responded", {
          provider: routed.adapter.provider,
          decision: input.decision,
        });
      });

    const respondToUserInput: ProviderServiceShape["respondToUserInput"] = (rawInput) =>
      Effect.gen(function* () {
        const input = yield* decodeInputOrValidationError({
          operation: "ProviderService.respondToUserInput",
          schema: ProviderRespondToUserInputInput,
          payload: rawInput,
        });
        const routed = yield* resolveRoutableSession({
          threadId: input.threadId,
          operation: "ProviderService.respondToUserInput",
          allowRecovery: true,
        });
        yield* routed.adapter.respondToUserInput(routed.threadId, input.requestId, input.answers);
      });

    const stopSession: ProviderServiceShape["stopSession"] = (rawInput) =>
      Effect.gen(function* () {
        const input = yield* decodeInputOrValidationError({
          operation: "ProviderService.stopSession",
          schema: ProviderStopSessionInput,
          payload: rawInput,
        });
        clearRuntimeIdleTimer(input.threadId);
        const routed = yield* resolveRoutableSession({
          threadId: input.threadId,
          operation: "ProviderService.stopSession",
          allowRecovery: false,
        });
        if (routed.isActive) {
          yield* routed.adapter.stopSession(routed.threadId);
        }
        yield* directory.remove(input.threadId);
        yield* analytics.record("provider.session.stopped", {
          provider: routed.adapter.provider,
        });
      });

    const stopRuntimeSession: NonNullable<ProviderServiceShape["stopRuntimeSession"]> = (
      rawInput,
    ) =>
      Effect.gen(function* () {
        const input = yield* decodeInputOrValidationError({
          operation: "ProviderService.stopRuntimeSession",
          schema: ProviderStopSessionInput,
          payload: rawInput,
        });
        clearRuntimeIdleTimer(input.threadId);
        const bindingOption = yield* directory.getBinding(input.threadId);
        const binding = Option.getOrUndefined(bindingOption);
        if (!binding) {
          return;
        }
        const adapter = yield* registry.getByProvider(binding.provider);
        const hasActiveSession = yield* adapter.hasSession(input.threadId);
        if (hasActiveSession) {
          yield* adapter.stopSession(input.threadId);
        }
        yield* directory.upsert({
          threadId: input.threadId,
          provider: binding.provider,
          ...(binding.adapterKey !== undefined ? { adapterKey: binding.adapterKey } : {}),
          ...(binding.runtimeMode !== undefined ? { runtimeMode: binding.runtimeMode } : {}),
          status: "stopped",
          resumeCursor: binding.resumeCursor,
          runtimePayload: {
            ...(binding.runtimePayload &&
            typeof binding.runtimePayload === "object" &&
            !Array.isArray(binding.runtimePayload)
              ? binding.runtimePayload
              : {}),
            activeTurnId: null,
            lastRuntimeEvent: "provider.stopRuntimeSession",
            lastRuntimeEventAt: new Date().toISOString(),
          },
        });
        yield* analytics.record("provider.session.runtime_stopped", {
          provider: binding.provider,
        });
      });

    stopIdleRuntimeSession = (threadId) => {
      void Effect.runPromise(
        Effect.gen(function* () {
          const binding = Option.getOrUndefined(yield* directory.getBinding(threadId));
          if (!binding) {
            return;
          }

          const adapter = yield* registry.getByProvider(binding.provider);
          const sessions = yield* adapter.listSessions();
          const session = sessions.find((entry) => entry.threadId === threadId);
          if (!session || session.status !== "ready" || session.activeTurnId !== undefined) {
            return;
          }
          if (session.resumeCursor === undefined) {
            return;
          }

          yield* stopRuntimeSession({ threadId });
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("provider.session.idle_stop_failed", {
              threadId,
              cause,
            }),
          ),
        ),
      );
    };

    const clearSessionResumeCursor: NonNullable<
      ProviderServiceShape["clearSessionResumeCursor"]
    > = (rawInput) =>
      Effect.gen(function* () {
        const input = yield* decodeInputOrValidationError({
          operation: "ProviderService.clearSessionResumeCursor",
          schema: ProviderStopSessionInput,
          payload: rawInput,
        });
        clearRuntimeIdleTimer(input.threadId);
        const bindingOption = yield* directory.getBinding(input.threadId);
        const binding = Option.getOrUndefined(bindingOption);
        if (!binding) {
          return;
        }
        const adapter = yield* registry.getByProvider(binding.provider);
        const hasActiveSession = yield* adapter.hasSession(input.threadId);
        if (hasActiveSession) {
          yield* adapter.stopSession(input.threadId);
        }
        yield* directory.upsert({
          threadId: input.threadId,
          provider: binding.provider,
          ...(binding.adapterKey !== undefined ? { adapterKey: binding.adapterKey } : {}),
          ...(binding.runtimeMode !== undefined ? { runtimeMode: binding.runtimeMode } : {}),
          status: "stopped",
          resumeCursor: null,
          runtimePayload: binding.runtimePayload,
        });
        yield* analytics.record("provider.session.resume_cursor_cleared", {
          provider: binding.provider,
        });
      });

    const listSessions: ProviderServiceShape["listSessions"] = () =>
      Effect.gen(function* () {
        const sessionsByProvider = yield* Effect.forEach(adapters, (adapter) =>
          adapter.listSessions(),
        );
        const activeSessions = sessionsByProvider.flatMap((sessions) => sessions);
        const persistedBindings = yield* directory.listThreadIds().pipe(
          Effect.flatMap((threadIds) =>
            Effect.forEach(
              threadIds,
              (threadId) =>
                directory
                  .getBinding(threadId)
                  .pipe(Effect.orElseSucceed(() => Option.none<ProviderRuntimeBinding>())),
              { concurrency: "unbounded" },
            ),
          ),
          Effect.orElseSucceed(() => [] as Array<Option.Option<ProviderRuntimeBinding>>),
        );
        const bindingsByThreadId = new Map<ThreadId, ProviderRuntimeBinding>();
        for (const bindingOption of persistedBindings) {
          const binding = Option.getOrUndefined(bindingOption);
          if (binding) {
            bindingsByThreadId.set(binding.threadId, binding);
          }
        }

        return activeSessions.map((session) => {
          const binding = bindingsByThreadId.get(session.threadId);
          if (!binding) {
            return session;
          }

          const overrides: {
            resumeCursor?: ProviderSession["resumeCursor"];
            runtimeMode?: ProviderSession["runtimeMode"];
          } = {};
          if (session.resumeCursor === undefined && binding.resumeCursor !== undefined) {
            overrides.resumeCursor = binding.resumeCursor;
          }
          if (binding.runtimeMode !== undefined) {
            overrides.runtimeMode = binding.runtimeMode;
          }
          return Object.assign({}, session, overrides);
        });
      });

    const getCapabilities: ProviderServiceShape["getCapabilities"] = (provider) =>
      registry.getByProvider(provider).pipe(Effect.map((adapter) => adapter.capabilities));

    const rollbackConversation: ProviderServiceShape["rollbackConversation"] = (rawInput) =>
      Effect.gen(function* () {
        const input = yield* decodeInputOrValidationError({
          operation: "ProviderService.rollbackConversation",
          schema: ProviderRollbackConversationInput,
          payload: rawInput,
        });
        if (input.numTurns === 0) {
          return;
        }
        const routed = yield* resolveRoutableSession({
          threadId: input.threadId,
          operation: "ProviderService.rollbackConversation",
          allowRecovery: true,
        });
        yield* routed.adapter.rollbackThread(routed.threadId, input.numTurns);
        yield* analytics.record("provider.conversation.rolled_back", {
          provider: routed.adapter.provider,
          turns: input.numTurns,
        });
      });

    const compactThread: ProviderServiceShape["compactThread"] = (rawInput) =>
      Effect.gen(function* () {
        const input = yield* decodeInputOrValidationError({
          operation: "ProviderService.compactThread",
          schema: ProviderCompactThreadInput,
          payload: rawInput,
        });
        const routed = yield* resolveRoutableSession({
          threadId: input.threadId,
          operation: "ProviderService.compactThread",
          allowRecovery: true,
        });
        if (!routed.adapter.compactThread) {
          return yield* toValidationError(
            "ProviderService.compactThread",
            `Context compaction is unavailable for provider '${routed.adapter.provider}'.`,
          );
        }
        yield* routed.adapter.compactThread(routed.threadId);
        yield* analytics.record("provider.thread.compacted", {
          provider: routed.adapter.provider,
        });
      });

    const runStopAll = () =>
      Effect.gen(function* () {
        const stoppedAt = new Date().toISOString();
        const threadIds = yield* directory.listThreadIds();
        const activeSessions = yield* Effect.forEach(adapters, (adapter) =>
          adapter.listSessions(),
        ).pipe(
          Effect.map((sessionsByAdapter) => sessionsByAdapter.flatMap((sessions) => sessions)),
        );
        yield* Effect.forEach(activeSessions, (session) =>
          upsertStoppedSessionBinding(session, stoppedAt),
        ).pipe(Effect.asVoid);
        yield* Effect.forEach(threadIds, (threadId) =>
          markPersistedThreadStopped(threadId, stoppedAt),
        ).pipe(Effect.asVoid);
        yield* Effect.forEach(adapters, (adapter) => adapter.stopAll()).pipe(Effect.asVoid);
        yield* analytics.record("provider.sessions.stopped_all", {
          sessionCount: threadIds.length,
        });
        yield* analytics.flush;
      });

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        for (const timer of runtimeIdleTimers.values()) {
          clearTimeout(timer);
        }
        runtimeIdleTimers.clear();
        stopIdleRuntimeSession = null;
        for (const timer of turnStallWatchdogs.values()) {
          clearTimeout(timer);
        }
        turnStallWatchdogs.clear();
        watchedTurns.clear();
        failStalledTurn = null;
      }).pipe(
        Effect.andThen(runStopAll()),
        Effect.catch((cause) => Effect.logWarning("failed to stop provider service", { cause })),
      ),
    );

    return {
      startSession,
      forkThread,
      sendTurn,
      steerTurn,
      startReview,
      interruptTurn,
      stopSubagent,
      abandonTurn,
      respondToRequest,
      respondToUserInput,
      stopSession,
      stopRuntimeSession,
      clearSessionResumeCursor,
      listSessions,
      getCapabilities,
      rollbackConversation,
      compactThread,
      // Each access creates a fresh PubSub subscription so that multiple
      // consumers (ProviderRuntimeIngestion, CheckpointReactor, etc.) each
      // independently receive all runtime events.
      get streamEvents(): ProviderServiceShape["streamEvents"] {
        return Stream.fromPubSub(runtimeEventPubSub);
      },
    } satisfies ProviderServiceShape;
  });

export const ProviderServiceLive = Layer.effect(ProviderService, makeProviderService());

export function makeProviderServiceLive(options?: ProviderServiceLiveOptions) {
  return Layer.effect(ProviderService, makeProviderService(options));
}
