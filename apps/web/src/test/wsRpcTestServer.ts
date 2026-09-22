// FILE: wsRpcTestServer.ts
// Purpose: Emulate the server half of the Effect RPC WebSocket protocol so browser
//          tests can exercise the real transport: unary calls, subscription streams
//          and streamed pushes. Frame shapes mirror effect/unstable/rpc RpcMessage.
// Layer: Browser test helper (not collected as a test file)

import { http, HttpResponse, ws } from "msw";
import { setupWorker, type SetupWorker } from "msw/browser";

/** A decoded client → server frame for a method call. */
export interface WsRpcTestRequest {
  readonly id: string;
  readonly tag: string;
  readonly payload: Record<string, unknown>;
}

/** Filter used by the request/stream lookups. */
export type WsRpcTestMatch = Partial<Record<string, unknown>>;

/** Sends one value into an open subscription stream. */
export type WsRpcTestStreamSend = (value: unknown) => void;

/** Completes an open subscription stream so the client stops collecting it. */
export type WsRpcTestStreamEnd = () => void;

/** A live subscription stream opened by the app. */
export interface WsRpcTestStream {
  readonly id: string;
  readonly tag: string;
  readonly payload: Record<string, unknown>;
  send: WsRpcTestStreamSend;
}

type UnaryHandler = (payload: Record<string, unknown>) => unknown;
type StreamHandler = (
  payload: Record<string, unknown>,
  send: WsRpcTestStreamSend,
  end: WsRpcTestStreamEnd,
) => void;

interface ClientFrame {
  _tag?: unknown;
  id?: unknown;
  requestId?: unknown;
  tag?: unknown;
  payload?: unknown;
}

function matches(payload: Record<string, unknown>, match: WsRpcTestMatch | undefined): boolean {
  if (!match) return true;
  return Object.entries(match).every(([key, value]) => payload[key] === value);
}

/**
 * MSW-backed stand-in for the Peak Code WebSocket server.
 *
 * The app speaks Effect RPC over `/ws`: it sends `Request` frames and expects
 * `Exit` frames (unary or stream completion) and `Chunk` frames (stream values).
 * Register handlers per method tag; unknown methods resolve to `{}` so partially
 * covered fixtures keep rendering.
 */
export class WsRpcTestServer {
  readonly worker: SetupWorker;

  private readonly wsLink = ws.link(/ws(s)?:\/\/.*/);
  private readonly unaryHandlers = new Map<string, UnaryHandler>();
  private readonly streamHandlers = new Map<string, StreamHandler>();
  private fallbackHandler: ((tag: string, payload: Record<string, unknown>) => unknown) | null =
    null;
  private readonly recordedRequests: WsRpcTestRequest[] = [];
  private readonly openStreams = new Map<string, WsRpcTestStream>();
  private readonly unhandledTags = new Set<string>();
  private client: { send: (data: string) => void } | null = null;
  private connectionResolvers: Array<() => void> = [];

  constructor() {
    this.worker = setupWorker(
      this.wsLink.addEventListener("connection", ({ client }) => {
        this.client = client;
        client.addEventListener("message", (event) => {
          if (typeof event.data !== "string") return;
          this.handleFrame(event.data);
        });
        const resolvers = this.connectionResolvers;
        this.connectionResolvers = [];
        for (const resolve of resolvers) resolve();
      }),
      // Static asset routes the app touches on boot; tests can override them with
      // `server.worker.use(...)` when they need real payloads.
      http.get("*/attachments/:attachmentId", () => new HttpResponse(null, { status: 204 })),
      http.get("*/api/project-favicon", () => new HttpResponse(null, { status: 204 })),
    );
  }

  /** Starts request interception. `quiet` keeps MSW from logging. */
  async start(): Promise<void> {
    await this.worker.start({
      onUnhandledRequest: "bypass",
      quiet: true,
      serviceWorker: { url: "/mockServiceWorker.js" },
    });
  }

  async stop(): Promise<void> {
    this.client = null;
    this.openStreams.clear();
    this.recordedRequests.length = 0;
    this.unhandledTags.clear();
    await this.worker.stop();
  }

  /** Resolves once the app has opened its WebSocket connection. */
  waitForConnection(): Promise<void> {
    if (this.client) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.connectionResolvers.push(resolve);
    });
  }

  /** Answers a unary method with a fixed value or a per-call resolver. */
  handle(tag: string, handler: UnaryHandler): this;
  handle(tag: string, value: unknown): this;
  handle(tag: string, handlerOrValue: UnaryHandler | unknown): this {
    this.unaryHandlers.set(
      tag,
      typeof handlerOrValue === "function"
        ? (handlerOrValue as UnaryHandler)
        : () => handlerOrValue,
    );
    return this;
  }

  /**
   * Answers methods that have no dedicated handler. Lets a fixture resolve every
   * tag in one place (mirroring the previous single-resolver mocks).
   */
  handleFallback(handler: (tag: string, payload: Record<string, unknown>) => unknown): this {
    this.fallbackHandler = handler;
    return this;
  }

  /**
   * Handles a subscription method. The handler runs on every subscribe so tests
   * can push the opening snapshot immediately and later values through `emit`.
   */
  stream(tag: string, handler: StreamHandler): this {
    this.streamHandlers.set(tag, handler);
    return this;
  }

  get requests(): readonly WsRpcTestRequest[] {
    return this.recordedRequests;
  }

  requestsFor(tag: string, match?: WsRpcTestMatch): WsRpcTestRequest[] {
    return this.recordedRequests.filter(
      (request) => request.tag === tag && matches(request.payload, match),
    );
  }

  count(tag: string, match?: WsRpcTestMatch): number {
    return this.requestsFor(tag, match).length;
  }

  /** Method tags the app asked for that no test handler covered. */
  get unhandled(): readonly string[] {
    return [...this.unhandledTags];
  }

  clearRequests(): void {
    this.recordedRequests.length = 0;
  }

  /** Pushes one value into every open stream for `tag` (optionally filtered). */
  emit(tag: string, value: unknown, match?: WsRpcTestMatch): void {
    for (const stream of this.openStreams.values()) {
      if (stream.tag !== tag) continue;
      if (!matches(stream.payload, match)) continue;
      stream.send(value);
    }
  }

  private handleFrame(raw: string): void {
    let frame: ClientFrame;
    try {
      frame = JSON.parse(raw) as ClientFrame;
    } catch {
      return;
    }
    if (frame._tag === "Request") {
      this.handleRequest(frame);
      return;
    }
    if (frame._tag === "Ping") {
      // The RPC socket protocol keeps subscriptions alive with pings; an unanswered ping
      // fails every stream and sends the transport into a reconnect loop.
      this.send({ _tag: "Pong" });
      return;
    }
    if (frame._tag === "Interrupt") {
      const requestId = String(frame.requestId);
      this.openStreams.delete(requestId);
      this.send({ _tag: "Exit", requestId, exit: { _tag: "Success", value: null } });
    }
  }

  private handleRequest(frame: ClientFrame): void {
    const id = String(frame.id);
    const tag = typeof frame.tag === "string" ? frame.tag : "";
    const payload =
      frame.payload && typeof frame.payload === "object"
        ? (frame.payload as Record<string, unknown>)
        : {};
    this.recordedRequests.push({ id, tag, payload });

    const streamHandler = this.streamHandlers.get(tag);
    if (streamHandler) {
      const stream: WsRpcTestStream = {
        id,
        tag,
        payload,
        send: (value) => {
          this.send({ _tag: "Chunk", requestId: id, values: [value] });
        },
      };
      this.openStreams.set(id, stream);
      const end = () => {
        this.openStreams.delete(id);
        this.send({ _tag: "Exit", requestId: id, exit: { _tag: "Success", value: null } });
      };
      streamHandler(payload, stream.send, end);
      return;
    }

    const unaryHandler = this.unaryHandlers.get(tag) ?? this.fallbackHandler?.bind(null, tag);
    if (!unaryHandler) {
      this.unhandledTags.add(tag);
      this.sendSuccess(id, {});
      return;
    }
    try {
      this.sendSuccess(id, unaryHandler(payload));
    } catch (error) {
      this.send({
        _tag: "Exit",
        requestId: id,
        exit: {
          _tag: "Failure",
          cause: [{ _tag: "Fail", error: error instanceof Error ? error.message : String(error) }],
        },
      });
    }
  }

  private sendSuccess(id: string, value: unknown): void {
    this.send({ _tag: "Exit", requestId: id, exit: { _tag: "Success", value } });
  }

  private send(frame: unknown): void {
    this.client?.send(JSON.stringify(frame));
  }
}
