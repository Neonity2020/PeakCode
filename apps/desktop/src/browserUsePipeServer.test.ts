// FILE: browserUsePipeServer.test.ts
// Purpose: Guards the desktop browser-use pipe: framing over a real socket, per-session
//          thread isolation, and the tab lifecycle the server drives.
// Layer: Desktop test
// Depends on: Vitest, the shared pipe contract, and a fake DesktopBrowserManager

import * as FS from "node:fs";
import * as Net from "node:net";
import * as OS from "node:os";
import * as Path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ThreadBrowserState, ThreadId } from "@peakcode/contracts";
import {
  BROWSER_USE_METHODS,
  decodeBrowserUseFrames,
  encodeBrowserUseFrame,
  type BrowserUseRpcResponse,
} from "@peakcode/shared/browserUsePipe";

import type { DesktopBrowserManager, BrowserUseSnapshot } from "./browserManager";
import { BrowserUsePipeServer } from "./browserUsePipeServer";

const THREAD_A = "thread-a" as ThreadId;
const THREAD_B = "thread-b" as ThreadId;

const tabState = (id: string, url: string) => ({
  id,
  url,
  title: `${id} title`,
  status: "live" as const,
  isLoading: false,
  canGoBack: false,
  canGoForward: false,
  faviconUrl: null,
  lastCommittedUrl: url,
  lastError: null,
});

const threadState = (
  threadId: ThreadId,
  tabs: string[],
  activeTabId: string,
): ThreadBrowserState => ({
  threadId,
  version: 1,
  open: true,
  activeTabId,
  tabs: tabs.map((id) => tabState(id, `https://${id}.example.com`)),
  lastError: null,
});

/**
 * A stand-in for the real manager.
 *
 * Only the surface the pipe uses is implemented, and the pane lookups answer for two
 * threads at once so the isolation behaviour is observable.
 */
function fakeManager(options: { active?: ThreadId } = {}) {
  const states = new Map<ThreadId, ThreadBrowserState>([
    [THREAD_A, threadState(THREAD_A, ["a1", "a2"], "a1")],
    [THREAD_B, threadState(THREAD_B, ["b1"], "b1")],
  ]);
  const closed: { threadId: ThreadId; tabId: string }[] = [];
  const cdpCalls: { threadId: ThreadId; tabId: string; method: string }[] = [];
  let activeThreadId = options.active ?? THREAD_A;

  const manager = {
    getBrowserUseSnapshot(threadId?: ThreadId): BrowserUseSnapshot | null {
      const wanted = threadId ?? activeThreadId;
      const state = states.get(wanted);
      return state?.open ? { threadId: wanted, state } : null;
    },
    newTab(input: { threadId: ThreadId }) {
      const state = states.get(input.threadId)!;
      const id = `${input.threadId}-new`;
      state.tabs = [...state.tabs, tabState(id, "about:blank")];
      state.activeTabId = id;
      return state;
    },
    closeTab(input: { threadId: ThreadId; tabId: string }) {
      const state = states.get(input.threadId)!;
      state.tabs = state.tabs.filter((tab) => tab.id !== input.tabId);
      if (state.activeTabId === input.tabId) {
        state.activeTabId = state.tabs[0]?.id ?? null;
      }
      closed.push({ threadId: input.threadId, tabId: input.tabId });
      return state;
    },
    async attachBrowserUseTab() {
      return undefined;
    },
    subscribeToCdpEvents() {
      return () => {};
    },
    async executeCdp(input: { threadId: ThreadId; tabId: string; method: string }) {
      cdpCalls.push({ threadId: input.threadId, tabId: input.tabId, method: input.method });
      return { ok: true };
    },
  };

  return {
    manager: manager as unknown as DesktopBrowserManager,
    closed,
    cdpCalls,
    setActive(threadId: ThreadId) {
      activeThreadId = threadId;
    },
  };
}

let cleanup: (() => Promise<void>) | null = null;

afterEach(async () => {
  await cleanup?.();
  cleanup = null;
});

/** Start a pipe server on a private socket and hand back a request helper. */
async function startPipe(fake = fakeManager()) {
  const pipePath = Path.join(
    FS.mkdtempSync(Path.join(OS.tmpdir(), "peakcode-pipe-test-")),
    `peakcode-iab-${process.pid}.sock`,
  );
  const server = new BrowserUsePipeServer(fake.manager, pipePath);
  await server.start();
  cleanup = async () => {
    await server.dispose();
    FS.rmSync(Path.dirname(pipePath), { recursive: true, force: true });
  };

  const socket = Net.createConnection(pipePath);
  await new Promise<void>((resolve) => socket.once("connect", () => resolve()));

  let buffered: Buffer = Buffer.alloc(0);
  const pending = new Map<number, (response: BrowserUseRpcResponse) => void>();
  socket.on("data", (chunk) => {
    const decoded = decodeBrowserUseFrames(Buffer.concat([buffered, chunk]));
    if (!decoded) throw new Error("pipe produced an undecodable frame");
    buffered = decoded.remaining;
    for (const raw of decoded.messages) {
      const response = JSON.parse(raw) as BrowserUseRpcResponse;
      if (typeof response.id === "number") pending.get(response.id)?.(response);
    }
  });
  cleanup = (() => {
    const previous = cleanup!;
    return async () => {
      socket.destroy();
      await previous();
    };
  })();

  let nextId = 1;
  const call = (method: string, params: Record<string, unknown> = {}) => {
    const id = nextId;
    nextId += 1;
    const settled = new Promise<BrowserUseRpcResponse>((resolve) => pending.set(id, resolve));
    socket.write(encodeBrowserUseFrame({ id, method, params }));
    return settled;
  };

  return { call, fake, socket };
}

describe("browser-use pipe server", () => {
  it("answers ping", async () => {
    const { call } = await startPipe();
    expect((await call(BROWSER_USE_METHODS.ping)).result).toBe("pong");
  });

  it("reports itself as the in-app browser and remembers the session id", async () => {
    const { call } = await startPipe();
    const info = (await call(BROWSER_USE_METHODS.getInfo, { session_id: THREAD_A }))
      .result as Record<string, unknown>;

    expect(info.type).toBe("iab");
    expect(info.metadata).toEqual({ codexSessionId: THREAD_A });
  });

  it("rejects a request without a session id", async () => {
    const { call } = await startPipe();
    const response = await call(BROWSER_USE_METHODS.getTabs);
    expect(response.error?.message).toMatch(/session_id/);
  });

  it("reports an unknown method instead of silently succeeding", async () => {
    const { call } = await startPipe();
    const response = await call("teleport", { session_id: THREAD_A });
    expect(response.error?.message).toMatch(/No handler registered for method: teleport/);
  });

  it("lists the tabs of the session's own thread, not the active pane", async () => {
    // The active pane is thread A; this request is for thread B.
    const { call } = await startPipe(fakeManager({ active: THREAD_A }));
    const tabs = (await call(BROWSER_USE_METHODS.getTabs, { session_id: THREAD_B })).result as {
      url: string;
    }[];

    expect(tabs.map((tab) => tab.url)).toEqual(["https://b1.example.com"]);
  });

  it("runs CDP against the session's own thread", async () => {
    const { call, fake } = await startPipe(fakeManager({ active: THREAD_A }));
    const tabs = (await call(BROWSER_USE_METHODS.getTabs, { session_id: THREAD_B })).result as {
      id: number;
    }[];
    await call(BROWSER_USE_METHODS.attach, { session_id: THREAD_B, tabId: tabs[0]!.id });
    await call(BROWSER_USE_METHODS.executeCdp, {
      session_id: THREAD_B,
      method: "Page.navigate",
    });

    expect(fake.cdpCalls).toEqual([{ threadId: THREAD_B, tabId: "b1", method: "Page.navigate" }]);
  });

  it("creates a tab in the session's thread and selects it", async () => {
    const { call, fake } = await startPipe();
    const created = (await call(BROWSER_USE_METHODS.createTab, { session_id: THREAD_A }))
      .result as { id: number; url: string; active: boolean };

    expect(created.url).toBe("about:blank");
    expect(created.active).toBe(true);

    // The selection sticks: a later CDP call with no explicit tabId lands on the new tab.
    await call(BROWSER_USE_METHODS.executeCdp, { session_id: THREAD_A, method: "Page.reload" });
    expect(fake.cdpCalls.at(-1)).toEqual({
      threadId: THREAD_A,
      tabId: `${THREAD_A}-new`,
      method: "Page.reload",
    });
  });

  it("closes a tab and forgets the session's selection of it", async () => {
    const { call, fake } = await startPipe();
    const tabs = (await call(BROWSER_USE_METHODS.getTabs, { session_id: THREAD_A })).result as {
      id: number;
    }[];

    const closedId = tabs[0]!.id;
    await call(BROWSER_USE_METHODS.attach, { session_id: THREAD_A, tabId: closedId });
    const response = await call(BROWSER_USE_METHODS.closeTab, {
      session_id: THREAD_A,
      tabId: closedId,
    });

    expect(response.error).toBeUndefined();
    expect(fake.closed).toEqual([{ threadId: THREAD_A, tabId: "a1" }]);

    // Acting on the tab that just went away is an error rather than a silent no-op.
    const stale = await call(BROWSER_USE_METHODS.executeCdp, {
      session_id: THREAD_A,
      method: "Page.reload",
    });
    expect(stale.error?.message).toMatch(/No browser tab selected/);
  });

  it("refuses a tab id that belongs to another session's thread", async () => {
    const { call, fake } = await startPipe();
    const bTabs = (await call(BROWSER_USE_METHODS.getTabs, { session_id: THREAD_B })).result as {
      id: number;
    }[];

    // `executeCdp` carries its target nested under `target`, unlike `attach`.
    const response = await call(BROWSER_USE_METHODS.executeCdp, {
      session_id: THREAD_A,
      method: "Page.reload",
      target: { tabId: bTabs[0]!.id },
    });

    expect(response.error?.message).toMatch(/is not in this session's browser pane/);
    expect(fake.cdpCalls).toEqual([]);
  });
});
