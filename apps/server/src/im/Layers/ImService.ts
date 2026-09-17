import { randomUUID } from "node:crypto";
import OS from "node:os";

import {
  CommandId,
  ImSettings as ImSettingsSchema,
  MessageId,
  ProjectId,
  ThreadId,
  type ImChannelId,
  type ImChannelStatus,
  type ImConversation,
  type ImLogEntry,
  type ImMobileLink,
  type ImRemoteAccessStatus,
  type ImSettings,
  type ImStatusSnapshot,
  type ImWechatQrStatus,
  type ModelSelection,
  type OrchestrationProjectShell,
  type OrchestrationThread,
} from "@peakcode/contracts";
import { DateTime, Duration, Effect, HashMap, Layer, Option, Ref, Schema, Stream } from "effect";
import QRCode from "qrcode";

import { ServerAuth } from "../../auth/Services/ServerAuth.ts";
import { isLoopbackHost, isWildcardHost } from "../../startupAccess.ts";
import { ServerConfig } from "../../config.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { turnOutcomeForEvent, type TurnOutcomeEvent } from "../../orchestration/turnOutcome.ts";
import { ImConversationRepository } from "../../persistence/Services/ImConversations.ts";
import { makeHeadlessModelResolver } from "../../provider/resolveHeadlessModelSelection.ts";

import { ServerSettingsService } from "../../serverSettings.ts";
import { PHONE_PAGE_ROUTE } from "../../webEntryPaths.ts";
import { createCloudflareTunnel, type CloudflareTunnel } from "../channels/cloudflare.ts";
import { createFeishuAdapter, type FeishuAdapter } from "../channels/feishu.ts";
import {
  DEFAULT_ILINK_BASE_URL,
  createIlinkConnection,
  fetchIlinkQrCode,
  pollIlinkQrStatus,
} from "../channels/ilink.ts";
import { createQqAdapter, type QqAdapter } from "../channels/qq.ts";
import {
  createWechatMp,
  createWecomApp,
  type WechatMpChannel,
  type WecomAppChannel,
} from "../channels/wechatCallback.ts";
import { createGroupRobotPusher, type GroupRobotPusher } from "../channels/webhooks.ts";
import { errorMessageOf, type ImInboundMessage, type ImReplyHandle } from "../channels/types.ts";
import { ImService, type ImCallbackMessage, type ImServiceShape } from "../Services/ImService.ts";

/**
 * A failure the caller can act on (nothing configured yet, no workspace, a bad secret).
 * The HTTP layer turns `status` into the response code so the settings screen shows a
 * 4xx with the reason instead of a generic server error.
 */
export class ImRequestError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "ImRequestError";
    this.status = status;
  }
}

const LOG_LIMIT = 200;
const LOG_TEXT_LIMIT = 500;
const MAX_THREAD_TITLE_LENGTH = 120;
const WEBHOOK_WAIT = Duration.minutes(30);
/** Cursor writes are throttled: a cursor only has to be roughly current to be useful. */
const CURSOR_FLUSH_INTERVAL = Duration.seconds(15);

const CHANNEL_LABELS: Record<ImChannelId, string> = {
  wechat: "微信",
  feishu: "飞书/Lark",
  qq: "QQ",
  wecom: "企业微信",
  wechatMp: "公众号",
  webhook: "Webhook",
};

const CHANNEL_ORDER: ReadonlyArray<ImChannelId> = [
  "wechat",
  "feishu",
  "qq",
  "wecom",
  "wechatMp",
  "webhook",
];

/** One dispatched turn that still owes an answer to a chat. */
interface PendingReply {
  readonly channel: ImChannelId;
  readonly peer: string;
  readonly reply: ImReplyHandle;
  /** Resolves to the transient-notice handle, or null when the channel has no recall. */
  readonly ackPromise: Promise<string | null> | null;
  readonly threadId: ThreadId;
}

const newThreadId = () => ThreadId.makeUnsafe(`thread_${randomUUID()}`);
const newMessageId = () => MessageId.makeUnsafe(`msg_${randomUUID()}`);
const newCommandId = () => CommandId.makeUnsafe(`cmd_${randomUUID()}`);
const nowIso = () => new Date().toISOString();

/** The bridge's identity for a chat: channel + scope + peer. */
export function imConversationKey(input: {
  readonly channel: ImChannelId;
  readonly peerId: string;
  readonly peerScope: string;
}): string {
  return [input.channel, input.peerScope, input.peerId].filter((part) => part.length > 0).join(":");
}

/** First line of a message, short enough to be a sidebar title. */
export function imThreadTitle(input: {
  readonly channel: ImChannelId;
  readonly peerLabel: string;
  readonly text: string;
}): string {
  const firstLine =
    input.text
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? "新消息";
  const peer = input.peerLabel.trim();
  const prefix = `${CHANNEL_LABELS[input.channel]}${peer ? ` · ${peer}` : ""}`;
  return `${prefix} · ${firstLine}`.slice(0, MAX_THREAD_TITLE_LENGTH);
}

/** What the chat is told once a turn is over. */
export function imReplyTextFor(input: {
  readonly outcome: TurnOutcomeEvent["outcome"];
  readonly thread: Option.Option<OrchestrationThread>;
}): string {
  if (input.outcome === "failed") {
    const error = Option.isNone(input.thread)
      ? null
      : (input.thread.value.session?.lastError ?? null);
    if (error !== null && error.includes("model_unavailable")) {
      // The provider's own words are a JSON blob; what the person in the chat needs is the
      // one action that fixes it.
      return `❌ 这个对话用的模型已经不可用了：${providerErrorMessageOf(error)}\n在 Peak Code 的「设置 → 通用 → 默认模型」里换一个可用模型，或者在对话里改模型后重发。`;
    }
    return `❌ 执行出错：${error ?? "未知错误"}（可在 Peak Code 里打开这次对话查看详情）`;
  }
  if (input.outcome === "interrupted") {
    return "⏹ 这一轮被中断了。";
  }
  const lastAssistant = Option.isNone(input.thread)
    ? null
    : ([...input.thread.value.messages]
        .toReversed()
        .find((message) => message.role === "assistant" && message.text.trim().length > 0)?.text ??
      null);
  return lastAssistant?.trim() ?? "（这一轮没有文字输出，可在 Peak Code 里打开这次对话查看详情。）";
}

/**
 * The readable sentence inside a provider failure, for a chat reply.
 *
 * Provider errors arrive as `404: {"message":"…","type":"…","code":"404"}`, which is noise
 * in a chat window; the `message` field is the part a person can act on.
 */
function providerErrorMessageOf(detail: string): string {
  const quoted = detail.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  const message = (quoted?.[1] ?? detail.split("\n")[0] ?? detail)
    .replace(/\\"/g, '"')
    .replace(/\\n/g, " ")
    .trim();
  return message.length > 200 ? `${message.slice(0, 197)}…` : message;
}

/**
 * The address a phone should use to reach this server, or an explanation why it cannot.
 *
 * A server bound to loopback is unreachable from a phone no matter what the QR says, so
 * that case fails loudly instead of handing out a link that cannot work.
 */
export function resolveMobileBaseUrl(config: {
  readonly host: string | undefined;
  readonly port: number;
}): string {
  const { port } = config;
  const host = config.host;
  if (host === undefined || host === "0.0.0.0" || host === "::" || host === "[::]") {
    const lan = Object.values(OS.networkInterfaces())
      .flat()
      .find(
        (entry): entry is NonNullable<typeof entry> =>
          entry !== undefined &&
          entry.family === "IPv4" &&
          !entry.internal &&
          !entry.address.startsWith("169.254."),
      );
    return `http://${lan ? lan.address : "localhost"}:${port}`;
  }
  if (host === "::1" || host === "127.0.0.1" || host === "localhost") {
    throw new ImRequestError(
      "服务器只监听本机地址，手机访问不到。请用 --host 0.0.0.0 重启（或绑定局域网/Tailnet 地址）后再试。",
    );
  }
  const formatted = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `http://${formatted}:${port}`;
}

/** Render text as a PNG data URL; an empty payload renders as nothing. */
async function renderQrCode(text: string): Promise<string> {
  if (text.length === 0) return "";
  try {
    return await QRCode.toDataURL(text, { width: 512, margin: 2 });
  } catch {
    return "";
  }
}

const makeImService = Effect.gen(function* () {
  const settingsService = yield* ServerSettingsService;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const conversationRepository = yield* ImConversationRepository;
  const serverAuth = yield* ServerAuth;
  const serverConfig = yield* ServerConfig;

  const headlessModel = yield* makeHeadlessModelResolver;

  const logRef = yield* Ref.make<ReadonlyArray<ImLogEntry>>([]);
  const pendingRef = yield* Ref.make(HashMap.empty<ThreadId, ReadonlyArray<PendingReply>>());
  /** Read from plain adapter callbacks, so it lives outside a Ref. */
  let currentSettings: ImSettings = Schema.decodeSync(ImSettingsSchema)({});
  let appliedChannels = "";
  /** Cursor handed over by the polling loop; flushed to settings by its own fiber. */
  let dirtyCursor: string | null = null;
  /** Last `remoteAccess.enabled` the bridge acted on, so only real toggles have effects. */
  let lastRemoteAccessEnabled: boolean | null = null;
  /** WeChat retries callbacks, so a message id must only ever start one turn. */
  const seenCallbackIds = new Set<string>();

  const readIm = (): ImSettings => currentSettings;

  const appendLog = (entry: ImLogEntry) =>
    Ref.update(logRef, (entries) => [entry, ...entries].slice(0, LOG_LIMIT));

  const logTraffic = (input: {
    readonly channel: ImChannelId;
    readonly direction: ImLogEntry["direction"];
    readonly text: string;
    readonly peer?: string;
    readonly threadId?: ThreadId;
  }) =>
    appendLog({
      at: nowIso(),
      channel: input.channel,
      direction: input.direction,
      text: input.text.slice(0, LOG_TEXT_LIMIT),
      ...(input.peer === undefined ? {} : { peer: input.peer }),
      ...(input.threadId === undefined ? {} : { threadId: input.threadId }),
    });

  /** Adapter log lines land in the bridge's own traffic log the settings screen shows. */
  const channelLogger =
    (channel: ImChannelId, options: { readonly errorsOnly: boolean }) =>
    (level: "info" | "warn" | "error", text: string) => {
      if (options.errorsOnly && level === "info") return;
      void Effect.runPromise(logTraffic({ channel, direction: "error", text }));
    };

  const tellChat = (reply: ImReplyHandle, text: string) =>
    Effect.tryPromise({
      try: async () => {
        await reply.reply(text);
        return true;
      },
      catch: (error) => new Error(errorMessageOf(error)),
    });

  /**
   * The inbound entry point every channel calls: failures are reported into the chat and
   * the traffic log instead of escaping into an adapter's callback.
   */
  const runInboundSafely = (message: ImInboundMessage): Promise<void> =>
    Effect.runPromise(
      handleInbound(message).pipe(
        Effect.catch((error) =>
          Effect.gen(function* () {
            yield* logTraffic({
              channel: message.channel,
              direction: "error",
              text: `处理消息失败：${error.message}`,
              peer: message.peerLabel,
            });
            yield* tellChat(message.reply, `❌ 处理消息失败：${error.message}`).pipe(
              Effect.orElseSucceed(() => false),
            );
          }),
        ),
      ),
    ).catch(() => undefined);

  const wechat = createIlinkConnection({
    getSettings: () => readIm().wechat,
    onCursor: (cursor) => {
      dirtyCursor = cursor;
    },
    onMessage: runInboundSafely,
    log: channelLogger("wechat", { errorsOnly: true }),
  });

  const feishu: FeishuAdapter = createFeishuAdapter({
    getSettings: () => readIm().feishu,
    onMessage: runInboundSafely,
    log: channelLogger("feishu", { errorsOnly: true }),
  });

  const qq: QqAdapter = createQqAdapter({
    getSettings: () => readIm().qq,
    onMessage: runInboundSafely,
    log: channelLogger("qq", { errorsOnly: true }),
  });

  const wecom: WecomAppChannel = createWecomApp({ getSettings: () => readIm().wecom });
  const wechatMp: WechatMpChannel = createWechatMp({ getSettings: () => readIm().wechatMp });
  const groupRobots: GroupRobotPusher = createGroupRobotPusher({
    getSettings: () => readIm().webhooks,
    log: channelLogger("webhook", { errorsOnly: true }),
  });

  const tunnel: CloudflareTunnel = createCloudflareTunnel({
    getSettings: () => readIm().remoteAccess,
    port: serverConfig.port,
    onUrl: (url) => {
      void Effect.runPromise(
        settingsService
          .updateSettings({ im: { remoteAccess: { url } } })
          .pipe(Effect.catch(() => Effect.void)),
      );
    },
    log: channelLogger("webhook", { errorsOnly: true }),
  });

  /**
   * A quick tunnel publishes the whole server, so it may only be opened when the server
   * asks for authentication. Without a token the H5 app would be readable — and the agent
   * drivable — by anyone who learns the address.
   */
  const remoteAccessAllowed = (): { readonly allowed: boolean; readonly reason?: string } =>
    serverConfig.authToken
      ? { allowed: true }
      : {
          allowed: false,
          reason:
            "尚未设置访问令牌，无法对外开放：请用 --auth-token <token> 重启 Peak Code（桌面版自带令牌），再开启隧道。",
        };

  const remoteAccessStatus = (): ImRemoteAccessStatus => {
    const allowed = remoteAccessAllowed();
    return { ...tunnel.status(), ...allowed };
  };

  const channelStatuses = (): ReadonlyArray<ImChannelStatus> =>
    CHANNEL_ORDER.map((id) => {
      switch (id) {
        case "wechat":
          return wechat.status();
        case "feishu":
          return feishu.status();
        case "qq":
          return qq.status();
        case "wecom":
          return wecom.status();
        case "wechatMp":
          return wechatMp.status();
        case "webhook":
          return groupRobots.status();
      }
    });

  // ---------------------------------------------------------------------------
  // Turn dispatch: an inbound message becomes a real thread, so the transcript stays
  // readable (and continuable) in the app afterwards.
  // ---------------------------------------------------------------------------

  const readThread = (threadId: ThreadId) =>
    projectionSnapshotQuery
      .getThreadDetailById(threadId)
      .pipe(Effect.orElseSucceed(() => Option.none<OrchestrationThread>()));

  const resolveModelSelection = (
    projectDefault: ModelSelection | null,
  ): Effect.Effect<ModelSelection, Error> =>
    Effect.gen(function* () {
      const picked = yield* headlessModel.resolve(projectDefault);
      if (picked === null) {
        return yield* Effect.fail(
          new ImRequestError(
            "这个工作区还没有可用的模型：先在 Peak Code 里给工作区选一个模型，IM 消息才知道用什么执行。",
          ),
        );
      }
      return picked;
    });

  const resolveProject = (im: ImSettings): Effect.Effect<OrchestrationProjectShell, Error> =>
    Effect.gen(function* () {
      if (im.defaultProjectId.length > 0) {
        const shell = yield* projectionSnapshotQuery
          .getProjectShellById(ProjectId.makeUnsafe(im.defaultProjectId))
          .pipe(Effect.orElseSucceed(() => Option.none<OrchestrationProjectShell>()));
        if (Option.isSome(shell)) return shell.value;
      }
      const snapshot = yield* projectionSnapshotQuery
        .getShellSnapshot()
        .pipe(Effect.mapError((cause) => new Error(errorMessageOf(cause))));
      const projects = snapshot.projects.filter((project) => project.kind !== "chat");
      const pool = projects.length > 0 ? projects : snapshot.projects;
      const newest = [...pool].toSorted((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt),
      )[0];
      if (!newest) {
        return yield* Effect.fail(
          new ImRequestError(
            "还没有可用的工作区：先在 Peak Code 里添加一个项目，IM 消息才知道在哪里执行。",
          ),
        );
      }
      return newest;
    });

  const dispatchThreadCreate = (input: {
    readonly threadId: ThreadId;
    readonly projectId: string;
    readonly title: string;
    readonly modelSelection: ModelSelection;
    readonly runtimeMode: ImSettings["runtimeMode"];
  }) =>
    orchestrationEngine
      .dispatch({
        type: "thread.create",
        commandId: newCommandId(),
        threadId: input.threadId,
        projectId: ProjectId.makeUnsafe(input.projectId),
        title: input.title,
        modelSelection: input.modelSelection,
        runtimeMode: input.runtimeMode,
        interactionMode: "default",
        envMode: "local",
        branch: null,
        worktreePath: null,
        createdAt: nowIso(),
      })
      .pipe(Effect.mapError((cause) => new Error(errorMessageOf(cause))));

  const dispatchTurnStart = (input: {
    readonly threadId: ThreadId;
    readonly text: string;
    readonly modelSelection: ModelSelection;
    readonly runtimeMode: ImSettings["runtimeMode"];
  }) =>
    orchestrationEngine
      .dispatch({
        type: "thread.turn.start",
        commandId: newCommandId(),
        threadId: input.threadId,
        message: {
          messageId: newMessageId(),
          role: "user",
          text: input.text,
          attachments: [],
        },
        modelSelection: input.modelSelection,
        assistantDeliveryMode: "streaming",
        dispatchMode: "queue",
        runtimeMode: input.runtimeMode,
        interactionMode: "default",
        createdAt: nowIso(),
      })
      .pipe(Effect.mapError((cause) => new Error(errorMessageOf(cause))));

  const enqueuePending = (pending: PendingReply) =>
    Ref.update(pendingRef, (pendingMap) =>
      HashMap.set(pendingMap, pending.threadId, [
        ...HashMap.get(pendingMap, pending.threadId).pipe(Option.getOrElse(() => [])),
        pending,
      ]),
    );

  const dequeuePending = (threadId: ThreadId): Effect.Effect<PendingReply | null> =>
    Ref.modify(pendingRef, (pendingMap) => {
      const queue = HashMap.get(pendingMap, threadId).pipe(Option.getOrElse(() => []));
      const [next, ...rest] = queue;
      if (next === undefined) return [null, pendingMap] as const;
      return [next, HashMap.set(pendingMap, threadId, rest)] as const;
    });

  /** Dispatch a turn for a chat, opening (or reusing) the thread it continues in. */
  const handleInbound = (message: ImInboundMessage) =>
    Effect.gen(function* () {
      const im = readIm();
      const conversationKey = imConversationKey(message);
      yield* logTraffic({
        channel: message.channel,
        direction: "in",
        text: message.text,
        peer: message.peerLabel,
      });

      const existing = yield* conversationRepository
        .findByKey(conversationKey)
        .pipe(Effect.orElseSucceed(() => Option.none<ImConversation>()));
      const idleMs = im.sessionIdleHours * 60 * 60 * 1000;
      const idleExpired =
        Option.isSome(existing) &&
        idleMs > 0 &&
        Date.now() - Date.parse(existing.value.lastMessageAt) > idleMs;

      let threadId: ThreadId;
      let modelSelection: ModelSelection;

      if (Option.isNone(existing) || idleExpired) {
        const project = yield* resolveProject(im).pipe(
          Effect.catch((error) =>
            Effect.gen(function* () {
              yield* logTraffic({
                channel: message.channel,
                direction: "error",
                text: `无法开始任务：${error.message}`,
                peer: message.peerLabel,
              });
              yield* tellChat(message.reply, `❌ ${error.message}`).pipe(
                Effect.orElseSucceed(() => false),
              );
              return null;
            }),
          ),
        );
        if (project === null) return;

        const resolvedModel = yield* resolveModelSelection(project.defaultModelSelection).pipe(
          Effect.catch((error) =>
            Effect.gen(function* () {
              yield* logTraffic({
                channel: message.channel,
                direction: "error",
                text: error.message,
                peer: message.peerLabel,
              });
              yield* tellChat(message.reply, `❌ ${error.message}`).pipe(
                Effect.orElseSucceed(() => false),
              );
              return null;
            }),
          ),
        );
        if (resolvedModel === null) return;
        modelSelection = resolvedModel;
        threadId = newThreadId();
        yield* dispatchThreadCreate({
          threadId,
          projectId: project.id,
          title: imThreadTitle({
            channel: message.channel,
            peerLabel: message.peerLabel,
            text: message.text,
          }),
          modelSelection,
          runtimeMode: im.runtimeMode,
        });
        const timestamp = nowIso();
        yield* conversationRepository
          .upsert({
            conversationKey,
            channel: message.channel,
            peerId: message.peerId,
            peerLabel: message.peerLabel,
            threadId,
            projectId: project.id,
            createdAt: timestamp,
            lastMessageAt: timestamp,
          })
          .pipe(
            Effect.catch((error) =>
              Effect.logWarning("failed to record an IM conversation", { cause: error.message }),
            ),
          );
        if (idleExpired) {
          yield* logTraffic({
            channel: message.channel,
            direction: "out",
            text: `距上次对话已超过 ${im.sessionIdleHours} 小时，已开启新的会话`,
            peer: message.peerLabel,
          });
        }
      } else {
        threadId = existing.value.threadId;
        const shell = yield* projectionSnapshotQuery
          .getProjectShellById(existing.value.projectId)
          .pipe(Effect.orElseSucceed(() => Option.none<OrchestrationProjectShell>()));
        const projectDefault = Option.isSome(shell) ? shell.value.defaultModelSelection : null;
        const resolvedModel = yield* resolveModelSelection(projectDefault).pipe(
          Effect.catch((error) =>
            Effect.gen(function* () {
              yield* logTraffic({
                channel: message.channel,
                direction: "error",
                text: error.message,
                peer: message.peerLabel,
                threadId,
              });
              yield* tellChat(message.reply, `❌ ${error.message}`).pipe(
                Effect.orElseSucceed(() => false),
              );
              return null;
            }),
          ),
        );
        if (resolvedModel === null) return;
        modelSelection = resolvedModel;
        yield* conversationRepository
          .touch({ conversationKey, lastMessageAt: nowIso() })
          .pipe(Effect.orElseSucceed(() => undefined));
      }

      // The reply slot is claimed before the turn is dispatched: a fast turn must not be
      // able to finish before its answer has somewhere to go.
      const busy = HashMap.get(yield* Ref.get(pendingRef), threadId).pipe(
        Option.exists((queue) => queue.length > 0),
      );
      const ackPromise =
        message.reply.ack === undefined
          ? null
          : Promise.resolve(message.reply.ack(busy)).catch(() => null);
      yield* enqueuePending({
        channel: message.channel,
        peer: message.peerLabel,
        reply: message.reply,
        ackPromise,
        threadId,
      });

      yield* dispatchTurnStart({
        threadId,
        text: message.text,
        modelSelection,
        runtimeMode: im.runtimeMode,
      }).pipe(
        Effect.catch((error) =>
          Effect.gen(function* () {
            yield* dequeuePending(threadId);
            yield* logTraffic({
              channel: message.channel,
              direction: "error",
              text: `任务启动失败：${error.message}`,
              peer: message.peerLabel,
              threadId,
            });
            yield* tellChat(message.reply, `❌ 任务没能启动：${error.message}`).pipe(
              Effect.orElseSucceed(() => false),
            );
          }),
        ),
      );
    });

  /** Answer the chat whose turn just ended. */
  const resolvePending = (outcome: TurnOutcomeEvent) =>
    Effect.gen(function* () {
      const pending = yield* dequeuePending(outcome.threadId);
      if (pending === null) return;

      const thread = yield* readThread(outcome.threadId);
      const text = imReplyTextFor({ outcome: outcome.outcome, thread });

      // The "working on it" notice is withdrawn before the answer lands, so the chat
      // keeps only the result.
      if (pending.ackPromise !== null && pending.reply.recallAck !== undefined) {
        const recallAck = pending.reply.recallAck;
        const handle = yield* Effect.promise(() => pending.ackPromise!);
        if (handle !== null) {
          yield* Effect.tryPromise({
            try: () => recallAck(handle),
            catch: () => undefined,
          }).pipe(Effect.orElseSucceed(() => undefined));
        }
      }

      const delivered = yield* tellChat(pending.reply, text).pipe(
        Effect.catch((error) =>
          Effect.gen(function* () {
            yield* logTraffic({
              channel: pending.channel,
              direction: "error",
              text: `回复失败：${error.message}`,
              peer: pending.peer,
              threadId: outcome.threadId,
            });
            return false;
          }),
        ),
      );
      if (delivered) {
        yield* logTraffic({
          channel: pending.channel,
          direction: "out",
          text,
          peer: pending.peer,
          threadId: outcome.threadId,
        });
      }

      // Group robots double as the "nobody is watching the app" channel: a finished IM
      // task is announced there too, when one is configured.
      yield* Effect.tryPromise({
        try: () =>
          groupRobots.push(`【Peak Code · ${CHANNEL_LABELS[pending.channel]}任务完成】\n${text}`),
        catch: () => undefined,
      }).pipe(Effect.orElseSucceed(() => []));
    });

  const handleDomainEvent = (event: Parameters<typeof turnOutcomeForEvent>[0]) => {
    const outcome = turnOutcomeForEvent(event);
    return outcome === null ? Effect.void : resolvePending(outcome);
  };

  // ---------------------------------------------------------------------------
  // Lifecycle: connect what the settings describe, then follow later changes.
  // ---------------------------------------------------------------------------

  const reconcile = (im: ImSettings) =>
    Effect.gen(function* () {
      const signature = JSON.stringify({ wechat: im.wechat, feishu: im.feishu, qq: im.qq });
      // The polling cursor lives in the same settings object but must not reconnect
      // anything, so it is deliberately absent from the signature.
      if (appliedChannels === signature) return;
      appliedChannels = signature;

      yield* Effect.tryPromise({
        try: async () => {
          if (im.wechat.botToken && im.wechat.botId) await wechat.start(true);
          else await wechat.stop();
        },
        catch: (error) => new Error(errorMessageOf(error)),
      }).pipe(
        Effect.catch((error) =>
          logTraffic({ channel: "wechat", direction: "error", text: error.message }),
        ),
      );

      yield* Effect.tryPromise({
        try: async () => {
          if (im.feishu.appId && im.feishu.appSecret) await feishu.start(true);
          else await feishu.stop();
        },
        catch: (error) => new Error(errorMessageOf(error)),
      }).pipe(
        Effect.catch((error) =>
          logTraffic({ channel: "feishu", direction: "error", text: error.message }),
        ),
      );

      yield* Effect.tryPromise({
        try: async () => {
          if (im.qq.appId && im.qq.appSecret) await qq.start(true);
          else await qq.stop();
        },
        catch: (error) => new Error(errorMessageOf(error)),
      }).pipe(
        Effect.catch((error) =>
          logTraffic({ channel: "qq", direction: "error", text: error.message }),
        ),
      );
    });

  /**
   * The tunnel follows its own setting rather than the channel signature: a connected
   * tunnel is state, not configuration, and restarting it on every settings write would
   * hand out a new public address each time.
   */
  const reconcileRemoteAccess = (im: ImSettings) =>
    Effect.gen(function* () {
      // Only transitions matter. The bridge itself writes settings while it works (the
      // assigned URL, the WeChat cursor), and those emissions carry whatever `enabled`
      // was at that instant — acting on them would tear down a tunnel that is fine.
      const enabled = im.remoteAccess.enabled;
      if (lastRemoteAccessEnabled === enabled) return;
      lastRemoteAccessEnabled = enabled;
      if (!enabled) {
        if (tunnel.status().state !== "off") {
          yield* Effect.tryPromise({
            try: () => tunnel.stop(),
            catch: () => undefined,
          }).pipe(Effect.catch(() => Effect.void));
        }
        return;
      }
      const allowed = remoteAccessAllowed();
      if (!allowed.allowed) {
        yield* logTraffic({
          channel: "webhook",
          direction: "error",
          text: allowed.reason ?? "无法对外开放这个服务端。",
        });
        return;
      }
      if (tunnel.status().state === "connected" || tunnel.status().state === "connecting") return;
      yield* Effect.tryPromise({
        try: () => tunnel.start(false),
        catch: (error) => new Error(errorMessageOf(error)),
      }).pipe(Effect.catch(() => Effect.void));
    });

  const start: ImServiceShape["start"] = () =>
    Effect.gen(function* () {
      const initial = yield* settingsService.getSettings.pipe(Effect.orElseSucceed(() => null));
      if (initial !== null) {
        currentSettings = initial.im;
        yield* reconcile(initial.im);
        yield* reconcileRemoteAccess(initial.im);
      }

      yield* Effect.forkScoped(
        Stream.runForEach(settingsService.streamChanges, (next) =>
          Effect.sync(() => {
            currentSettings = next.im;
          }).pipe(
            Effect.andThen(reconcile(next.im)),
            Effect.andThen(reconcileRemoteAccess(next.im)),
          ),
        ),
      );

      yield* Effect.forkScoped(
        Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) =>
          handleDomainEvent(event).pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("IM bridge failed to answer a finished turn", {
                cause: String(cause),
              }),
            ),
          ),
        ),
      );

      // A restarted backend must not leave its tunnel running: the orphan keeps publishing
      // an address that points at a port nobody listens on any more.
      yield* Effect.addFinalizer(() =>
        Effect.tryPromise({
          try: () => tunnel.stop(),
          catch: () => undefined,
        }).pipe(Effect.orElseSucceed(() => undefined)),
      );

      // The long-poll cursor is produced by a plain callback; this fiber persists it.
      yield* Effect.forkScoped(
        Effect.gen(function* () {
          while (true) {
            yield* Effect.sleep(CURSOR_FLUSH_INTERVAL);
            const cursor = dirtyCursor;
            if (cursor === null || cursor === readIm().wechat.cursor) continue;
            dirtyCursor = null;
            yield* settingsService
              .updateSettings({ im: { wechat: { cursor } } })
              .pipe(Effect.catch(() => Effect.void));
          }
        }),
      );
    });

  const publishWechatCredentials = (input: {
    readonly botToken: string;
    readonly botId: string;
    readonly baseUrl: string;
  }) =>
    settingsService
      .updateSettings({
        im: {
          wechat: {
            botToken: input.botToken,
            botId: input.botId,
            baseUrl: input.baseUrl.length > 0 ? input.baseUrl : DEFAULT_ILINK_BASE_URL,
            // A new account needs a fresh cursor; the old one would fetch nothing.
            cursor: "",
          },
        },
      })
      .pipe(Effect.mapError((cause) => new Error(errorMessageOf(cause))));

  const testChannel: ImServiceShape["testChannel"] = (channel) =>
    Effect.gen(function* () {
      const im = readIm();
      if (channel === "feishu") {
        if (!im.feishu.appId || !im.feishu.appSecret) {
          return yield* Effect.fail(new ImRequestError("先填入飞书 App ID / App Secret。"));
        }
        const bot = yield* Effect.tryPromise({
          try: () => feishu.probe(),
          catch: (error) => new ImRequestError(errorMessageOf(error)),
        });
        const status = yield* Effect.promise(() => feishu.start(true));
        if (status.state === "failed") {
          return yield* Effect.fail(new ImRequestError(status.error ?? "飞书连接失败。"));
        }
        return {
          ok: true,
          ...(bot.name.length > 0 ? { detail: `机器人：${bot.name}` } : {}),
          channel: status,
        };
      }
      if (channel === "qq") {
        if (!im.qq.appId || !im.qq.appSecret) {
          return yield* Effect.fail(new ImRequestError("先填入 QQ AppID / AppSecret。"));
        }
        yield* Effect.tryPromise({
          try: () => qq.probe(),
          catch: (error) => new ImRequestError(errorMessageOf(error)),
        });
        const status = yield* Effect.promise(() => qq.start(true));
        return { ok: true, detail: "凭证有效，长连接已重建", channel: status };
      }
      if (channel === "wechat") {
        const status = wechat.status();
        if (!status.configured) {
          return yield* Effect.fail(
            new ImRequestError("还没有接入微信：点「扫码接入」用手机微信扫一扫。"),
          );
        }
        return { ok: true, ...(status.detail ? { detail: status.detail } : {}), channel: status };
      }
      if (channel === "wecom" || channel === "wechatMp") {
        const target = channel === "wecom" ? wecom : wechatMp;
        yield* Effect.tryPromise({
          try: () => target.probe(),
          catch: (error) => new ImRequestError(errorMessageOf(error)),
        });
        return { ok: true, detail: "凭证有效", channel: target.status() };
      }
      const status = groupRobots.status();
      if (!status.configured) {
        return yield* Effect.fail(new ImRequestError("先填入群机器人 webhook 地址。"));
      }
      const delivered = yield* Effect.tryPromise({
        try: () =>
          groupRobots.push("【Peak Code】频道连通性测试：如果你在群里看到这条消息，推送就通了。"),
        catch: (error) => new Error(errorMessageOf(error)),
      });
      return { ok: true, detail: `已推送到：${delivered.join(" / ")}`, channel: status };
    });

  const createMobileLink: ImServiceShape["createMobileLink"] = (input) =>
    Effect.gen(function* () {
      // A connected tunnel is the address that works from anywhere (mobile data, other
      // networks); the LAN address is the fallback when the phone is on the same network.
      const tunnelUrl = remoteAccessStatus();
      const baseUrl = yield* Effect.try({
        try: () =>
          tunnelUrl.state === "connected" && tunnelUrl.url.length > 0
            ? tunnelUrl.url
            : resolveMobileBaseUrl({ host: serverConfig.host, port: serverConfig.port }),
        catch: (error) => new ImRequestError(errorMessageOf(error)),
      });
      const issued = yield* serverAuth
        .issuePairingCredential({ label: "手机远程控制", role: "owner" })
        .pipe(Effect.mapError((error) => new Error(errorMessageOf(error))));
      // The credential travels in the hash, so it never reaches a server log. The phone
      // lands on its own page — a remote control for this computer, not the desktop shell —
      // and the conversation it should open rides along in the same hash.
      const url = new URL(baseUrl);
      url.pathname = PHONE_PAGE_ROUTE;
      url.searchParams.delete("token");
      const handOff = new URLSearchParams([["token", issued.credential]]);
      if (input.threadId !== undefined) handOff.set("thread", input.threadId);
      if (input.projectId !== undefined) handOff.set("project", input.projectId);
      url.hash = handOff.toString();
      return {
        url: url.toString(),
        image: yield* Effect.promise(() => renderQrCode(url.toString())),
        expiresAt: DateTime.formatIso(issued.expiresAt),
      } satisfies ImMobileLink;
    });

  const startRemoteAccess: ImServiceShape["startRemoteAccess"] = () =>
    Effect.gen(function* () {
      const allowed = remoteAccessAllowed();
      if (!allowed.allowed) {
        return yield* Effect.fail(
          new ImRequestError(allowed.reason ?? "无法对外开放这个服务端。", 403),
        );
      }
      const current = tunnel.status();
      // Already up (or coming up): report it instead of handing out a new address, which
      // would invalidate the QR code the user is looking at.
      if (current.state === "connected" || current.state === "connecting") {
        return remoteAccessStatus();
      }
      yield* Effect.tryPromise({
        try: () => tunnel.probe(),
        catch: (error) => new ImRequestError(errorMessageOf(error)),
      });
      const status = yield* Effect.tryPromise({
        try: () => tunnel.start(true),
        catch: (error) => new ImRequestError(errorMessageOf(error)),
      });
      // The intent is persisted after the tunnel is up: writing it first would wake the
      // settings watcher while the adapter still looked idle, and it would open a second
      // tunnel — a different public address from the one the caller is about to show.
      yield* settingsService
        .updateSettings({ im: { remoteAccess: { enabled: true } } })
        .pipe(Effect.catch(() => Effect.void));
      if (status.state === "failed") {
        return { ...(status as ImRemoteAccessStatus), ...remoteAccessAllowed() };
      }
      return remoteAccessStatus();
    });

  const stopRemoteAccess: ImServiceShape["stopRemoteAccess"] = () =>
    Effect.gen(function* () {
      yield* settingsService
        .updateSettings({ im: { remoteAccess: { enabled: false } } })
        .pipe(Effect.catch(() => Effect.void));
      yield* Effect.tryPromise({
        try: () => tunnel.stop(),
        catch: (error) => new ImRequestError(errorMessageOf(error)),
      });
      return remoteAccessStatus();
    });

  const status: ImServiceShape["status"] = Effect.gen(function* () {
    return {
      channels: channelStatuses(),
      log: yield* Ref.get(logRef),
      idleHours: readIm().sessionIdleHours,
      remoteAccess: remoteAccessStatus(),
    } satisfies ImStatusSnapshot;
  });

  const listConversations: ImServiceShape["listConversations"] = conversationRepository
    .list()
    .pipe(Effect.orElseSucceed(() => []));

  const forgetConversation: ImServiceShape["forgetConversation"] = (conversationKey) =>
    conversationRepository
      .deleteByKey(conversationKey)
      .pipe(Effect.mapError((error) => new Error(errorMessageOf(error))));

  const createWechatQrCode: ImServiceShape["createWechatQrCode"] = () =>
    Effect.gen(function* () {
      const code = yield* Effect.tryPromise({
        try: () => fetchIlinkQrCode(readIm().wechat.baseUrl),
        catch: (error) => new Error(errorMessageOf(error)),
      });
      return {
        qrcode: code.qrcode,
        image: yield* Effect.promise(() => renderQrCode(code.deepLink)),
        deepLink: code.deepLink,
      };
    });

  const pollWechatQrStatus: ImServiceShape["pollWechatQrStatus"] = (qrcode) =>
    Effect.gen(function* () {
      const result = yield* Effect.tryPromise({
        try: () => pollIlinkQrStatus(qrcode, readIm().wechat.baseUrl),
        catch: (error) => new Error(errorMessageOf(error)),
      });
      if (
        result.status === "confirmed" &&
        result.botToken !== undefined &&
        result.botId !== undefined
      ) {
        yield* publishWechatCredentials({
          botToken: result.botToken,
          botId: result.botId,
          baseUrl: result.baseUrl ?? "",
        });
      }
      return { status: result.status, channel: wechat.status() } satisfies ImWechatQrStatus;
    });

  const disconnectWechat: ImServiceShape["disconnectWechat"] = () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => wechat.stop()).pipe(Effect.orElseSucceed(() => undefined));
      yield* settingsService
        .updateSettings({ im: { wechat: { botToken: "", botId: "", baseUrl: "", cursor: "" } } })
        .pipe(Effect.mapError((error) => new Error(errorMessageOf(error))));
    });

  const verifyWechatCallback: ImServiceShape["verifyWechatCallback"] = (input) =>
    Effect.try({
      try: () => (input.channel === "wecom" ? wecom : wechatMp).verifyUrl(input.query),
      catch: (error) => new Error(errorMessageOf(error)),
    });

  const parseWechatCallback: ImServiceShape["parseWechatCallback"] = (input) =>
    Effect.try({
      try: () => {
        const parsed = (input.channel === "wecom" ? wecom : wechatMp).parseCallback(
          input.query,
          input.rawBody,
        );
        return {
          fromUser: parsed.fromUser,
          msgType: parsed.msgType,
          text: parsed.text,
          msgId: parsed.msgId,
        } satisfies ImCallbackMessage;
      },
      catch: (error) => new Error(errorMessageOf(error)),
    });

  const acceptWechatCallbackMessage: ImServiceShape["acceptWechatCallbackMessage"] = (input) =>
    Effect.gen(function* () {
      const { message } = input;
      if (message.msgType !== "text" || message.text.trim().length === 0) return;
      if (message.msgId.length > 0) {
        if (seenCallbackIds.has(message.msgId)) return;
        seenCallbackIds.add(message.msgId);
        if (seenCallbackIds.size > 2_000) seenCallbackIds.clear();
      }
      yield* Effect.promise(() =>
        runInboundSafely({
          channel: input.channel,
          peerId: message.fromUser,
          peerScope: "",
          peerLabel: message.fromUser,
          text: message.text.trim(),
          reply: {
            reply: (text) =>
              input.channel === "wecom"
                ? wecom.push(message.fromUser, text)
                : wechatMp.push(message.fromUser, text),
          },
        }),
      );
    });

  const runWebhookTask: ImServiceShape["runWebhookTask"] = (input) =>
    Effect.gen(function* () {
      const im = readIm();
      // The inbound bridge runs agent turns on demand, so a server that anything on the
      // network can reach must require the secret even before one is configured.
      const remoteReachable =
        isWildcardHost(serverConfig.host) ||
        (serverConfig.host !== undefined && !isLoopbackHost(serverConfig.host));
      if (im.webhooks.secret.length === 0) {
        if (remoteReachable) {
          return yield* Effect.fail(
            new ImRequestError(
              "入站 Webhook 尚未设置密钥，已拒绝：请在「设置 → 频道」里设置入站桥接密钥。",
              403,
            ),
          );
        }
      } else if (input.secret !== im.webhooks.secret) {
        return yield* Effect.fail(new ImRequestError("secret 不正确", 403));
      }
      const session =
        input.session !== undefined && input.session.length > 0 ? input.session : "default";
      const conversationKey = imConversationKey({
        channel: "webhook",
        peerId: session,
        peerScope: "",
      });
      const threadIdBefore = yield* conversationRepository
        .findByKey(conversationKey)
        .pipe(Effect.orElseSucceed(() => Option.none<ImConversation>()));

      let settle: ((text: string) => void) | null = null;
      const answered = new Promise<string>((resolve) => {
        settle = resolve;
      });

      yield* handleInbound({
        channel: "webhook",
        peerId: session,
        peerScope: "",
        peerLabel: session,
        text: input.text,
        reply: {
          reply: async (text) => {
            settle?.(text);
          },
        },
      });

      const threadId = Option.isSome(threadIdBefore)
        ? threadIdBefore.value.threadId
        : yield* conversationRepository.findByKey(conversationKey).pipe(
            Effect.orElseSucceed(() => Option.none<ImConversation>()),
            Effect.map((found) => (Option.isSome(found) ? found.value.threadId : null)),
          );
      if (threadId === null) {
        return yield* Effect.fail(new ImRequestError("任务没能启动：没有可用的工作区。"));
      }

      const reply = yield* Effect.promise(() => answered).pipe(
        Effect.timeout(WEBHOOK_WAIT),
        Effect.orElseSucceed(() => "（等待超时：任务仍在执行，可在 Peak Code 里查看这次对话。）"),
      );
      return { reply, threadId };
    });

  return ImService.of({
    start,
    status,
    listConversations,
    forgetConversation,
    createWechatQrCode,
    pollWechatQrStatus,
    disconnectWechat,
    testChannel,
    createMobileLink,
    startRemoteAccess,
    stopRemoteAccess,
    verifyWechatCallback,
    parseWechatCallback,
    acceptWechatCallbackMessage,
    runWebhookTask,
  } satisfies ImServiceShape);
});

export const ImServiceLive = Layer.effect(ImService, makeImService);
