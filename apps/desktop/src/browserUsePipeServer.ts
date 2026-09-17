// FILE: browserUsePipeServer.ts
// Purpose: Exposes the in-app browser over a Codex-compatible browser-use native pipe.
// Layer: Desktop browser automation bridge
// Depends on: DesktopBrowserManager, the shared pipe contract, Node net server primitives

import * as FS from "node:fs";
import * as Net from "node:net";
import * as Path from "node:path";

import type { BrowserExecuteCdpInput, ThreadBrowserState, ThreadId } from "@peakcode/contracts";
import {
  BROWSER_USE_METHODS,
  resolveConfiguredBrowserUsePipePath,
  decodeBrowserUseFrames,
  encodeBrowserUseFrame,
  type BrowserUseRpcRequest,
} from "@peakcode/shared/browserUsePipe";

import type { DesktopBrowserManager } from "./browserManager";

const BROWSER_USE_INITIAL_URL = "about:blank";
const BROWSER_USE_PANEL_READY_TIMEOUT_MS = 2_000;
const BROWSER_USE_PANEL_READY_POLL_MS = 50;

interface BrowserUseTrackedTab {
  id: number;
  threadId: ThreadId;
  tabId: string;
}

interface BrowserUsePipeServerOptions {
  pipePath?: string;
  requestOpenPanel?: () => void | Promise<void>;
}

export const PEAKCODE_BROWSER_USE_PIPE_PATH = resolveConfiguredBrowserUsePipePath();

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function requireSessionId(params: unknown): string {
  const sessionId = asString(asObject(params)?.session_id);
  if (!sessionId) {
    throw new Error("Missing required browser session_id");
  }
  return sessionId;
}

function ensurePipeParentDirectory(pipePath: string): void {
  if (process.platform === "win32") {
    return;
  }
  FS.mkdirSync(Path.dirname(pipePath), { recursive: true });
}

function cleanupPipePath(pipePath: string): void {
  if (process.platform === "win32") {
    return;
  }
  try {
    const stat = FS.lstatSync(pipePath);
    if (!stat.isSocket() && !stat.isFile()) {
      return;
    }
    FS.unlinkSync(pipePath);
  } catch {
    // Ignore stale socket cleanup failures.
  }
}

export class BrowserUsePipeServer {
  private readonly sockets = new Set<Net.Socket>();
  private readonly pendingBySocket = new Map<Net.Socket, Buffer>();
  private readonly trackedTabByKey = new Map<string, BrowserUseTrackedTab>();
  private readonly trackedTabById = new Map<number, BrowserUseTrackedTab>();
  private readonly selectedTrackedTabIdBySessionId = new Map<string, number>();
  private readonly cdpListenerDisposeBySessionId = new Map<string, () => void>();
  private readonly server: Net.Server;
  private readonly pipePath: string;
  private readonly requestOpenPanel: (() => void | Promise<void>) | undefined;
  private nextTrackedTabId = 1;
  private started = false;

  constructor(
    private readonly browserManager: DesktopBrowserManager,
    options: BrowserUsePipeServerOptions | string = PEAKCODE_BROWSER_USE_PIPE_PATH,
  ) {
    this.pipePath =
      typeof options === "string" ? options : (options.pipePath ?? PEAKCODE_BROWSER_USE_PIPE_PATH);
    this.requestOpenPanel = typeof options === "string" ? undefined : options.requestOpenPanel;
    this.server = Net.createServer((socket) => this.handleSocketConnection(socket));
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }
    ensurePipeParentDirectory(this.pipePath);
    cleanupPipePath(this.pipePath);
    await new Promise<void>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.pipePath, () => {
        this.server.off("error", reject);
        resolve();
      });
    });
    this.started = true;
  }

  async dispose(): Promise<void> {
    for (const dispose of this.cdpListenerDisposeBySessionId.values()) {
      dispose();
    }
    this.cdpListenerDisposeBySessionId.clear();
    for (const socket of this.sockets) {
      socket.destroy();
    }
    this.sockets.clear();
    this.pendingBySocket.clear();
    if (this.started) {
      await new Promise<void>((resolve) => {
        this.server.close(() => resolve());
      });
      this.started = false;
    }
    cleanupPipePath(this.pipePath);
  }

  private handleSocketConnection(socket: Net.Socket): void {
    this.sockets.add(socket);
    this.pendingBySocket.set(socket, Buffer.alloc(0));
    socket.on("data", (chunk) => this.handleSocketData(socket, chunk));
    socket.on("close", () => {
      this.sockets.delete(socket);
      this.pendingBySocket.delete(socket);
    });
    socket.on("error", () => {
      this.sockets.delete(socket);
      this.pendingBySocket.delete(socket);
      socket.destroy();
    });
  }

  private handleSocketData(socket: Net.Socket, chunk: Buffer): void {
    const decoded = decodeBrowserUseFrames(
      Buffer.concat([this.pendingBySocket.get(socket) ?? Buffer.alloc(0), chunk]),
    );
    if (!decoded) {
      this.pendingBySocket.delete(socket);
      socket.destroy();
      return;
    }
    this.pendingBySocket.set(socket, decoded.remaining);
    for (const message of decoded.messages) {
      void this.handleIncomingMessage(socket, message);
    }
  }

  private async handleIncomingMessage(socket: Net.Socket, rawMessage: string): Promise<void> {
    let request: BrowserUseRpcRequest;
    try {
      request = JSON.parse(rawMessage) as BrowserUseRpcRequest;
    } catch {
      return;
    }

    if (request.id === undefined || typeof request.method !== "string") {
      return;
    }

    try {
      const result = await this.handleRequest(request.method, request.params);
      socket.write(encodeBrowserUseFrame({ jsonrpc: "2.0", id: request.id, result }));
    } catch (error) {
      socket.write(
        encodeBrowserUseFrame({
          jsonrpc: "2.0",
          id: request.id,
          error: {
            code: 1,
            message: error instanceof Error ? error.message : String(error),
          },
        }),
      );
    }
  }

  private async handleRequest(method: string, params: unknown): Promise<unknown> {
    switch (method) {
      case BROWSER_USE_METHODS.ping:
        return "pong";
      case BROWSER_USE_METHODS.getInfo: {
        const sessionId = asString(asObject(params)?.session_id);
        return {
          name: "Peak Code In-app Browser",
          version: "0.1.0",
          type: "iab",
          ...(sessionId ? { metadata: { codexSessionId: sessionId } } : {}),
        };
      }
      case BROWSER_USE_METHODS.getTabs:
        return this.getTabsForSession(requireSessionId(params));
      case BROWSER_USE_METHODS.createTab:
        return this.createTabForSession(requireSessionId(params));
      case BROWSER_USE_METHODS.closeTab:
        return this.closeTabForSession(requireSessionId(params), params);
      case BROWSER_USE_METHODS.nameSession:
        requireSessionId(params);
        if (!asString(asObject(params)?.name)) {
          throw new Error("nameSession requires a name");
        }
        return {};
      case BROWSER_USE_METHODS.attach:
        return this.attachForSession(requireSessionId(params), params);
      case BROWSER_USE_METHODS.detach:
        return this.detachForSession(requireSessionId(params));
      case BROWSER_USE_METHODS.executeCdp:
        return this.executeCdpForSession(requireSessionId(params), params);
      default:
        throw new Error(`No handler registered for method: ${method}`);
    }
  }

  /**
   * The browser pane a pipe session should act on.
   *
   * The server sends its thread id as `session_id`, so a request is answered from that
   * thread's own pane whenever it has one. Without this, two threads with browser panes
   * open would race for whichever pane happened to be active, and the agent working in
   * the background thread would drive the page the user is looking at somewhere else.
   *
   * Falling back to the active pane keeps the old single-pane behaviour working for a
   * session whose thread has no pane yet — opening a pane happens in the renderer, which
   * only knows the thread the user is on, so a session cannot conjure a pane for an
   * arbitrary thread from here.
   */
  private getBrowserHostStateForSession(sessionId: string): {
    threadId: ThreadId;
    state: ThreadBrowserState;
  } | null {
    const forThread = this.browserManager.getBrowserUseSnapshot(sessionId as ThreadId);
    if (forThread?.state.open) {
      return forThread;
    }
    return this.getActiveBrowserHostState();
  }

  private getActiveBrowserHostState(): {
    threadId: ThreadId;
    state: ThreadBrowserState;
  } | null {
    const snapshot = this.browserManager.getBrowserUseSnapshot();
    if (!snapshot || !snapshot.state.open) {
      return null;
    }
    return snapshot;
  }

  private async waitForActiveBrowserHostState(sessionId: string): Promise<{
    threadId: ThreadId;
    state: ThreadBrowserState;
  } | null> {
    const existing = this.getBrowserHostStateForSession(sessionId);
    if (existing) {
      return existing;
    }

    await this.requestOpenPanel?.();
    const deadline = Date.now() + BROWSER_USE_PANEL_READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const snapshot = this.getBrowserHostStateForSession(sessionId);
      if (snapshot) {
        return snapshot;
      }
      await new Promise((resolve) => setTimeout(resolve, BROWSER_USE_PANEL_READY_POLL_MS));
    }
    return null;
  }

  private trackTab(threadId: ThreadId, tabId: string): BrowserUseTrackedTab {
    const key = `${threadId}:${tabId}`;
    const existing = this.trackedTabByKey.get(key);
    if (existing) {
      return existing;
    }
    const tracked = {
      id: this.nextTrackedTabId,
      threadId,
      tabId,
    } satisfies BrowserUseTrackedTab;
    this.nextTrackedTabId += 1;
    this.trackedTabByKey.set(key, tracked);
    this.trackedTabById.set(tracked.id, tracked);
    return tracked;
  }

  private getTabsForSession(sessionId: string): Array<{
    id: number;
    title: string;
    active: boolean;
    url: string;
  }> {
    const snapshot = this.getBrowserHostStateForSession(sessionId);
    if (!snapshot) {
      return [];
    }
    const selectedTrackedTabId = this.selectedTrackedTabIdBySessionId.get(sessionId) ?? null;
    return snapshot.state.tabs.map((tab) => {
      const tracked = this.trackTab(snapshot.threadId, tab.id);
      return {
        id: tracked.id,
        title: tab.title,
        active:
          selectedTrackedTabId === tracked.id ||
          (selectedTrackedTabId === null && snapshot.state.activeTabId === tab.id),
        url: tab.lastCommittedUrl ?? tab.url,
      };
    });
  }

  private async createTabForSession(sessionId: string): Promise<{
    id: number;
    title: string;
    active: boolean;
    url: string;
  }> {
    const snapshot = await this.waitForActiveBrowserHostState(sessionId);
    if (!snapshot) {
      throw new Error("No active Peak Code browser pane available");
    }
    const nextState = this.browserManager.newTab({
      threadId: snapshot.threadId,
      url: BROWSER_USE_INITIAL_URL,
      activate: true,
    });
    const activeTab =
      nextState.tabs.find((tab) => tab.id === nextState.activeTabId) ?? nextState.tabs[0] ?? null;
    if (!activeTab) {
      throw new Error("Could not create a browser tab.");
    }
    const tracked = this.trackTab(snapshot.threadId, activeTab.id);
    this.selectedTrackedTabIdBySessionId.set(sessionId, tracked.id);
    return {
      id: tracked.id,
      title: activeTab.title,
      active: true,
      url: activeTab.lastCommittedUrl ?? activeTab.url,
    };
  }

  private async closeTabForSession(
    sessionId: string,
    params: unknown,
  ): Promise<Record<string, never>> {
    const tracked = this.resolveTrackedTabForSession(sessionId, params);
    // The tab is going away, so the CDP event subscription and the session's selection
    // are both meaningless now. Dropping them here keeps a later request from asking the
    // browser manager about a runtime that has already been destroyed.
    this.cdpListenerDisposeBySessionId.get(sessionId)?.();
    this.cdpListenerDisposeBySessionId.delete(sessionId);
    if (this.selectedTrackedTabIdBySessionId.get(sessionId) === tracked.id) {
      this.selectedTrackedTabIdBySessionId.delete(sessionId);
    }
    this.trackedTabById.delete(tracked.id);
    this.trackedTabByKey.delete(`${tracked.threadId}:${tracked.tabId}`);
    this.browserManager.closeTab({ threadId: tracked.threadId, tabId: tracked.tabId });
    return {};
  }

  private resolveTrackedTabForSession(sessionId: string, params: unknown): BrowserUseTrackedTab {
    const requestedTrackedTabId = asNumber(asObject(params)?.tabId);
    const trackedTabId =
      requestedTrackedTabId ?? this.selectedTrackedTabIdBySessionId.get(sessionId) ?? null;
    if (trackedTabId === null) {
      throw new Error("No browser tab selected for this session.");
    }
    const tracked = this.trackedTabById.get(trackedTabId);
    if (!tracked) {
      throw new Error(`Unknown tab: ${trackedTabId}`);
    }

    /**
     * A session may only act on a tab inside the pane it is bound to.
     *
     * Tracked ids are global, so without this check a session that somehow holds another
     * thread's id would silently drive that thread's page — the cross-thread leak the
     * session-scoped pane resolution exists to prevent. An unresolved pane (no pane open
     * anywhere yet) skips the check rather than rejecting everything.
     */
    const paneThreadId = this.getBrowserHostStateForSession(sessionId)?.threadId;
    if (paneThreadId !== undefined && tracked.threadId !== paneThreadId) {
      throw new Error(`Tab ${trackedTabId} is not in this session's browser pane.`);
    }
    return tracked;
  }

  private async attachForSession(
    sessionId: string,
    params: unknown,
  ): Promise<Record<string, never>> {
    const tracked = this.resolveTrackedTabForSession(sessionId, params);
    this.selectedTrackedTabIdBySessionId.set(sessionId, tracked.id);
    this.cdpListenerDisposeBySessionId.get(sessionId)?.();
    await this.browserManager.attachBrowserUseTab({
      threadId: tracked.threadId,
      tabId: tracked.tabId,
    });
    const dispose = this.browserManager.subscribeToCdpEvents(
      {
        threadId: tracked.threadId,
        tabId: tracked.tabId,
      },
      (event) => {
        this.broadcastNotification("onCDPEvent", {
          source: {
            tabId: tracked.id,
          },
          method: event.method,
          ...(event.params !== undefined ? { params: event.params } : {}),
        });
      },
    );
    this.cdpListenerDisposeBySessionId.set(sessionId, dispose);
    return {};
  }

  private async detachForSession(sessionId: string): Promise<Record<string, never>> {
    this.cdpListenerDisposeBySessionId.get(sessionId)?.();
    this.cdpListenerDisposeBySessionId.delete(sessionId);
    return {};
  }

  private async executeCdpForSession(sessionId: string, params: unknown): Promise<unknown> {
    const request = asObject(params);
    const method = asString(request?.method);
    if (!method) {
      throw new Error("executeCdp requires a method");
    }
    const tracked = this.resolveTrackedTabForSession(sessionId, asObject(request?.target) ?? null);
    this.selectedTrackedTabIdBySessionId.set(sessionId, tracked.id);
    const commandParams = asObject(request?.commandParams);
    return this.browserManager.executeCdp({
      threadId: tracked.threadId,
      tabId: tracked.tabId,
      method,
      ...(commandParams ? { params: commandParams } : {}),
    } satisfies BrowserExecuteCdpInput);
  }

  private broadcastNotification(method: string, params: unknown): void {
    const payload = encodeBrowserUseFrame({
      jsonrpc: "2.0",
      method,
      params,
    });
    for (const socket of this.sockets) {
      if (!socket.destroyed) {
        socket.write(payload);
      }
    }
  }
}
