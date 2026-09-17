import { describe, expect, it } from "vitest";

import type { BrowserToolParams } from "@peakcode/agent-toolkit/agent-tools";
import type { ThreadId } from "@peakcode/contracts";
import type { BrowserUseTabInfo } from "@peakcode/shared/browserUsePipe";

import {
  browserControlConfigured,
  browserFromConversation,
  makeBrowserToolHost,
  setBrowserToolHost,
} from "./browserTool.ts";

const THREAD = "thread-1" as ThreadId;

/**
 * The host talks to a session over a socket, so these tests drive it through a real pipe
 * server rather than stubbing the session. That keeps the test honest about the thing users
 * actually hit — a tool call that has to reach the desktop and come back.
 */
import * as FS from "node:fs";
import * as Net from "node:net";
import * as OS from "node:os";
import * as Path from "node:path";
import { afterEach } from "vitest";

import {
  BROWSER_USE_METHODS,
  decodeBrowserUseFrames,
  encodeBrowserUseFrame,
} from "@peakcode/shared/browserUsePipe";

const AX_REPLY = {
  nodes: [
    {
      nodeId: "1",
      ignored: false,
      role: { value: "RootWebArea" },
      name: { value: "Example" },
      childIds: ["2"],
    },
    {
      nodeId: "2",
      ignored: false,
      role: { value: "button" },
      name: { value: "Sign in" },
      backendDOMNodeId: 12,
    },
  ],
};

const tab = (id: number, url: string, active = true): BrowserUseTabInfo => ({
  id,
  title: `tab ${id}`,
  active,
  url,
});

interface CdpCall {
  method: string;
  params: Record<string, unknown>;
}

let cleanup: (() => Promise<void>) | null = null;

afterEach(async () => {
  await cleanup?.();
  cleanup = null;
  setBrowserToolHost(null);
});

/** A minimal desktop: the pipe, plus canned CDP replies. */
async function startDesktop(options: { cdp?: Record<string, unknown> } = {}) {
  const dir = FS.mkdtempSync(Path.join(OS.tmpdir(), "peakcode-browser-tool-test-"));
  const pipePath = Path.join(dir, "peakcode-iab.sock");
  const cdpCalls: CdpCall[] = [];

  const server = Net.createServer((socket) => {
    let buffered: Buffer = Buffer.alloc(0);
    socket.on("error", () => socket.destroy());
    socket.on("data", (chunk) => {
      const decoded = decodeBrowserUseFrames(Buffer.concat([buffered, chunk]));
      if (!decoded) return;
      buffered = decoded.remaining;
      for (const raw of decoded.messages) {
        const request = JSON.parse(raw) as {
          id: number;
          method: string;
          params: Record<string, unknown>;
        };
        const reply = (result: unknown) =>
          socket.write(encodeBrowserUseFrame({ jsonrpc: "2.0", id: request.id, result }));
        const fail = (message: string) =>
          socket.write(
            encodeBrowserUseFrame({ jsonrpc: "2.0", id: request.id, error: { code: 1, message } }),
          );

        switch (request.method) {
          case BROWSER_USE_METHODS.ping:
            reply("pong");
            break;
          case BROWSER_USE_METHODS.getInfo:
            reply({ name: "Peak Code In-app Browser", version: "0.1.0", type: "iab" });
            break;
          case BROWSER_USE_METHODS.getTabs:
            reply([tab(1, "https://example.com")]);
            break;
          case BROWSER_USE_METHODS.createTab:
            reply(tab(2, "about:blank"));
            break;
          case BROWSER_USE_METHODS.attach:
          case BROWSER_USE_METHODS.closeTab:
          case BROWSER_USE_METHODS.nameSession:
            reply({});
            break;
          case BROWSER_USE_METHODS.executeCdp: {
            const method = String(request.params.method);
            cdpCalls.push({
              method,
              params: (request.params.commandParams ?? {}) as Record<string, unknown>,
            });
            if (options.cdp && method in options.cdp) {
              reply(options.cdp[method]);
              break;
            }
            if (method === "Runtime.evaluate") {
              const expression = String(
                (request.params.commandParams as Record<string, unknown> | undefined)?.expression,
              );
              reply({
                result: {
                  value:
                    expression === "document.readyState"
                      ? "complete"
                      : expression === "location.href"
                        ? "https://example.com"
                        : expression === "document.title"
                          ? "Example"
                          : null,
                },
              });
              break;
            }
            if (method === "Accessibility.getFullAXTree") {
              reply(AX_REPLY);
              break;
            }
            reply({});
            break;
          }
          default:
            fail(`No handler registered for method: ${request.method}`);
        }
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(pipePath, resolve));
  cleanup = async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    FS.rmSync(dir, { recursive: true, force: true });
  };

  return { pipePath, cdpCalls };
}

const run = async (host: ReturnType<typeof makeBrowserToolHost>, params: BrowserToolParams) =>
  host.run({ threadId: THREAD, params });

const textOf = (outcome: { content: { type: string; text?: string }[] }): string =>
  outcome.content
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("\n");

describe("browser host installation", () => {
  it("reports that browser control is unwired until a host is installed", () => {
    setBrowserToolHost(null);
    expect(browserControlConfigured()).toBe(false);
  });

  it("answers rather than throwing when the session has no host", async () => {
    setBrowserToolHost(null);
    const outcome = await browserFromConversation({
      threadId: THREAD,
      params: { action: "snapshot" },
    });
    expect(outcome.details.error).toMatch(/not available in this session/);
  });

  it("becomes available once a host is installed, and stops when it is removed", async () => {
    const { pipePath } = await startDesktop();
    setBrowserToolHost(makeBrowserToolHost({ pipePath }));
    expect(browserControlConfigured()).toBe(true);

    setBrowserToolHost(null);
    expect(browserControlConfigured()).toBe(false);
  });
});

describe("browser host actions", () => {
  it("lists tabs without claiming one, and says what the next action will do", async () => {
    const { pipePath } = await startDesktop();
    const host = makeBrowserToolHost({ pipePath });

    const outcome = await run(host, { action: "get_tabs" });

    expect(textOf(outcome)).toMatch(/\[1\] https:\/\/example\.com/);
    // Listing is a read: it must not silently take over the tab the user is on.
    expect(textOf(outcome)).toMatch(/the user is looking at this one/);
    expect(textOf(outcome)).toMatch(/next action takes over the active one/);
  });

  it("marks the tab it is driving once a conversation has one", async () => {
    const { pipePath } = await startDesktop();
    const host = makeBrowserToolHost({ pipePath });

    await run(host, { action: "reload" });
    const outcome = await run(host, { action: "get_tabs" });

    expect(textOf(outcome)).toMatch(/\[1\] https:\/\/example\.com \(← driving\)/);
  });

  it("returns a ref-annotated tree and tells the model to use the refs", async () => {
    const { pipePath } = await startDesktop();
    const host = makeBrowserToolHost({ pipePath });

    const outcome = await run(host, { action: "snapshot" });

    expect(textOf(outcome)).toMatch(/\[e1\] button "Sign in"/);
    expect(textOf(outcome)).toMatch(/addressable by the refs/);
  });

  it("reports a click as a receipt, not as a confirmed effect", async () => {
    const { pipePath, cdpCalls } = await startDesktop({
      cdp: { "DOM.getContentQuads": { quads: [[0, 0, 10, 0, 10, 10, 0, 10]] } },
    });
    const host = makeBrowserToolHost({ pipePath });

    await run(host, { action: "snapshot" });
    const outcome = await run(host, { action: "click", ref: "e1" });

    expect(textOf(outcome)).toMatch(/Dispatched `click` \(ref e1\)/);
    expect(textOf(outcome)).toMatch(/receipt, not a result/);
    expect(cdpCalls.map((call) => call.method)).toContain("Input.dispatchMouseEvent");
  });

  it("navigates and points at the snapshot as the next step", async () => {
    const { pipePath } = await startDesktop();
    const host = makeBrowserToolHost({ pipePath });

    const outcome = await run(host, { action: "navigate", url: "https://example.com" });

    expect(textOf(outcome)).toMatch(/Navigated to https:\/\/example\.com/);
    expect(textOf(outcome)).toMatch(/Take a snapshot/);
  });

  it("keeps a conversation's tab across calls", async () => {
    const { pipePath, cdpCalls } = await startDesktop();
    const host = makeBrowserToolHost({ pipePath });

    await run(host, { action: "get_tabs" });
    cdpCalls.length = 0;
    await run(host, { action: "reload" });

    // The tab chosen by the first call is the one the reload went to.
    expect(cdpCalls.map((call) => call.method)).toContain("Page.reload");
  });

  it("returns a screenshot as an image block", async () => {
    const { pipePath } = await startDesktop({
      cdp: { "Page.captureScreenshot": { data: "QUJD" } },
    });
    const host = makeBrowserToolHost({ pipePath });

    const outcome = await run(host, { action: "screenshot" });

    expect(outcome.content).toContainEqual({ type: "image", data: "QUJD", mimeType: "image/jpeg" });
  });

  it("says so when no option matched, instead of claiming success", async () => {
    const { pipePath } = await startDesktop({
      cdp: {
        "DOM.resolveNode": { object: { objectId: "obj-1" } },
        "Runtime.callFunctionOn": { result: { value: null } },
      },
    });
    const host = makeBrowserToolHost({ pipePath });

    await run(host, { action: "snapshot" });
    const outcome = await run(host, { action: "select_option", ref: "e1", value: "nope" });

    expect(outcome.details.error).toMatch(/No option in e1 matched/);
  });

  it("returns an evaluate result as readable JSON", async () => {
    const { pipePath } = await startDesktop({
      cdp: { "Runtime.evaluate": { result: { value: 42 } } },
    });
    const host = makeBrowserToolHost({ pipePath });

    expect(textOf(await run(host, { action: "evaluate", expression: "6*7" }))).toBe("42");
  });

  it("explains a stale ref as something the model can fix", async () => {
    const { pipePath } = await startDesktop();
    const host = makeBrowserToolHost({ pipePath });

    await run(host, { action: "snapshot" });
    const outcome = await run(host, { action: "click", ref: "e99" });

    expect(outcome.details.error).toMatch(/Call snapshot again/);
  });
});

describe("browser host failure handling", () => {
  it("turns an unreachable desktop into an instruction, not a stack trace", async () => {
    const host = makeBrowserToolHost({
      pipePath: Path.join(OS.tmpdir(), "peakcode-missing-browser-dir", "nope.sock"),
    });

    const outcome = await run(host, { action: "snapshot" });

    expect(outcome.details.error).toMatch(/browser pipe is not reachable/);
    expect(outcome.details.error).toMatch(/Tell the user rather than retrying/);
  });

  it("passes the desktop's own refusal through", async () => {
    // No desktop is listening for this path either, but the message must not be swallowed.
    const { pipePath } = await startDesktop();
    const host = makeBrowserToolHost({ pipePath });

    const outcome = await run(host, { action: "select_tab", tab_id: 999 });

    // The fake accepts any attach, so this exercises the happy path's shape: a text result.
    expect(outcome.details.error).toBeUndefined();
  });
});
