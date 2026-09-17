import * as FS from "node:fs";
import * as Net from "node:net";
import * as OS from "node:os";
import * as Path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  BROWSER_USE_METHODS,
  decodeBrowserUseFrames,
  encodeBrowserUseFrame,
} from "@peakcode/shared/browserUsePipe";

import { BrowserUsePipeClient, BrowserUseUnavailableError } from "./browserUsePipeClient.ts";

type Handler = (
  method: string,
  params: Record<string, unknown>,
) => { result?: unknown; error?: string } | undefined;

let cleanup: (() => Promise<void>) | null = null;

afterEach(async () => {
  await cleanup?.();
  cleanup = null;
});

/**
 * A stand-in desktop: a real unix socket speaking the real framing.
 *
 * The client's job is transport, so the test drives it over an actual socket rather than a
 * stub — that is the only way to cover connect failures, partial reads, and peer closes.
 */
async function startPipe(handler: Handler) {
  const dir = FS.mkdtempSync(Path.join(OS.tmpdir(), "peakcode-pipe-client-test-"));
  const pipePath = Path.join(dir, "peakcode-iab.sock");
  const sockets = new Set<Net.Socket>();

  const server = Net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());

    let buffered: Buffer = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      const decoded = decodeBrowserUseFrames(Buffer.concat([buffered, chunk]));
      if (!decoded) {
        socket.destroy();
        return;
      }
      buffered = decoded.remaining;
      for (const raw of decoded.messages) {
        const request = JSON.parse(raw) as {
          id: number;
          method: string;
          params: Record<string, unknown>;
        };
        const reply = handler(request.method, request.params ?? {});
        if (!reply) continue;
        socket.write(
          encodeBrowserUseFrame(
            "error" in reply
              ? { jsonrpc: "2.0", id: request.id, error: { code: 1, message: reply.error } }
              : { jsonrpc: "2.0", id: request.id, result: reply.result },
          ),
        );
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(pipePath, resolve));
  cleanup = async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    FS.rmSync(dir, { recursive: true, force: true });
  };

  return { pipePath, server, sockets };
}

describe("browser-use pipe client", () => {
  it("sends a method and returns the result", async () => {
    const seen: string[] = [];
    const { pipePath } = await startPipe((method) => {
      seen.push(method);
      return { result: "pong" };
    });

    const client = new BrowserUsePipeClient({ pipePath });
    await expect(client.call(BROWSER_USE_METHODS.ping)).resolves.toBe("pong");
    expect(seen).toEqual([BROWSER_USE_METHODS.ping]);
  });

  it("passes the session id through to the desktop", async () => {
    let received: Record<string, unknown> = {};
    const { pipePath } = await startPipe((_method, params) => {
      received = params;
      return { result: [{ id: 7, title: "t", active: true, url: "https://example.com" }] };
    });

    const client = new BrowserUsePipeClient({ pipePath });
    const tabs = await client.getTabs("thread-42");

    expect(received).toEqual({ session_id: "thread-42" });
    expect(tabs).toEqual([{ id: 7, title: "t", active: true, url: "https://example.com" }]);
  });

  it("nests the CDP target the way the desktop expects", async () => {
    let received: Record<string, unknown> = {};
    const { pipePath } = await startPipe((_method, params) => {
      received = params;
      return { result: { frameId: "F1" } };
    });

    const client = new BrowserUsePipeClient({ pipePath });
    await client.executeCdp(
      "thread-42",
      "Page.navigate",
      { url: "https://example.com" },
      {
        tabId: 3,
      },
    );

    expect(received).toEqual({
      session_id: "thread-42",
      method: "Page.navigate",
      commandParams: { url: "https://example.com" },
      target: { tabId: 3 },
    });
  });

  it("omits an undefined target and command params", async () => {
    let received: Record<string, unknown> = {};
    const { pipePath } = await startPipe((_method, params) => {
      received = params;
      return { result: {} };
    });

    const client = new BrowserUsePipeClient({ pipePath });
    await client.executeCdp("thread-42", "Page.reload", undefined);

    expect(received).toEqual({ session_id: "thread-42", method: "Page.reload" });
  });

  it("surfaces the desktop's own error message", async () => {
    const { pipePath } = await startPipe(() => ({ error: "Unknown tab: 9" }));
    const client = new BrowserUsePipeClient({ pipePath });

    await expect(client.call(BROWSER_USE_METHODS.getTabs, { session_id: "t" })).rejects.toThrow(
      /Unknown tab: 9/,
    );
  });

  it("reports an unreachable pipe as unavailable, not as a syscall error", async () => {
    const client = new BrowserUsePipeClient({
      pipePath: Path.join(OS.tmpdir(), "peakcode-does-not-exist", "nope.sock"),
    });

    await expect(client.call(BROWSER_USE_METHODS.ping)).rejects.toBeInstanceOf(
      BrowserUseUnavailableError,
    );
    await expect(client.isAvailable()).resolves.toBe(false);
  });

  it("treats a peer that never answers as unavailable rather than hanging", async () => {
    const { pipePath } = await startPipe(() => undefined);
    const client = new BrowserUsePipeClient({ pipePath, requestTimeoutMs: 50 });

    await expect(client.call(BROWSER_USE_METHODS.ping)).rejects.toThrow(/timed out after 50ms/);
  });

  it("survives a response split across chunks", async () => {
    const dir = FS.mkdtempSync(Path.join(OS.tmpdir(), "peakcode-pipe-client-split-"));
    const pipePath = Path.join(dir, "peakcode-iab.sock");
    const server = Net.createServer((socket) => {
      let buffered: Buffer = Buffer.alloc(0);
      socket.on("data", (chunk) => {
        const decoded = decodeBrowserUseFrames(Buffer.concat([buffered, chunk]));
        if (!decoded) return;
        buffered = decoded.remaining;
        for (const raw of decoded.messages) {
          const { id } = JSON.parse(raw) as { id: number };
          const frame = encodeBrowserUseFrame({
            jsonrpc: "2.0",
            id,
            result: { title: "a fairly long title so the frame is worth splitting" },
          });
          // One byte at a time: the worst case the client has to reassemble.
          for (const byte of frame) socket.write(Buffer.from([byte]));
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(pipePath, resolve));
    cleanup = async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      FS.rmSync(dir, { recursive: true, force: true });
    };

    const client = new BrowserUsePipeClient({ pipePath });
    await expect(
      client.call<{ title: string }>(BROWSER_USE_METHODS.getInfo, { session_id: "t" }),
    ).resolves.toEqual({ title: "a fairly long title so the frame is worth splitting" });
  });

  it("caches a successful probe so later calls skip it", async () => {
    let pings = 0;
    const { pipePath } = await startPipe((method) => {
      if (method === BROWSER_USE_METHODS.ping) pings += 1;
      return { result: method === BROWSER_USE_METHODS.ping ? "pong" : [] };
    });

    const client = new BrowserUsePipeClient({ pipePath });
    await expect(client.isAvailable()).resolves.toBe(true);
    await expect(client.isAvailable()).resolves.toBe(true);
    expect(pings).toBe(1);
  });

  it("does not cache a failed probe, so a desktop that starts later still works", async () => {
    const client = new BrowserUsePipeClient({
      pipePath: Path.join(OS.tmpdir(), "peakcode-missing-dir", "nope.sock"),
    });

    await expect(client.isAvailable()).resolves.toBe(false);
    await expect(client.isAvailable()).resolves.toBe(false);
  });
});
