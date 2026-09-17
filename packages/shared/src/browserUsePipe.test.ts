import { tmpdir } from "node:os";
import { basename, dirname } from "node:path";

import { describe, expect, it } from "vitest";

import {
  BROWSER_USE_HEADER_BYTES,
  BROWSER_USE_MAX_MESSAGE_BYTES,
  PEAKCODE_BROWSER_USE_PIPE_ENV,
  decodeBrowserUseFrames,
  encodeBrowserUseFrame,
  resolveConfiguredBrowserUsePipePath,
  resolveDefaultBrowserUsePipePath,
} from "./browserUsePipe";

describe("browser-use pipe path resolution", () => {
  it("creates a discoverable unix socket path under the Codex browser-use directory", () => {
    const pipePath = resolveDefaultBrowserUsePipePath("darwin");

    expect(dirname(pipePath)).toBe(`${tmpdir()}/codex-browser-use`);
    expect(basename(pipePath)).toMatch(/^peakcode-iab-\d+\.sock$/);
  });

  it("uses a named pipe on Windows", () => {
    expect(resolveDefaultBrowserUsePipePath("win32")).toMatch(
      /^\\\\\.\\pipe\\codex-browser-use-peakcode-iab-\d+$/,
    );
  });

  it("prefers an explicit pipe path from the environment", () => {
    expect(
      resolveConfiguredBrowserUsePipePath(
        { [PEAKCODE_BROWSER_USE_PIPE_ENV]: "/tmp/codex-browser-use/custom.sock" },
        "darwin",
      ),
    ).toBe("/tmp/codex-browser-use/custom.sock");
  });

  it("falls back to the per-process default when the variable is blank or absent", () => {
    const fallback = resolveDefaultBrowserUsePipePath("darwin");
    expect(resolveConfiguredBrowserUsePipePath({}, "darwin")).toBe(fallback);
    expect(
      resolveConfiguredBrowserUsePipePath({ [PEAKCODE_BROWSER_USE_PIPE_ENV]: "  " }, "darwin"),
    ).toBe(fallback);
  });

  it("gives different processes different sockets", () => {
    // Two running instances sharing one socket would cross their commands; the pid in
    // the name is what keeps them apart.
    expect(resolveDefaultBrowserUsePipePath("darwin")).toContain(`-${process.pid}.sock`);
  });
});

describe("browser-use pipe framing", () => {
  const roundTrip = (message: unknown) => {
    const decoded = decodeBrowserUseFrames(encodeBrowserUseFrame(message));
    expect(decoded).not.toBeNull();
    return decoded?.messages.map((raw) => JSON.parse(raw));
  };

  it("round-trips a request", () => {
    const request = { id: 3, method: "getTabs", params: { session_id: "thread-1" } };
    expect(roundTrip(request)).toEqual([request]);
  });

  it("round-trips a payload with multi-byte text", () => {
    const message = { id: 1, result: { title: "登录 — 示例站点" } };
    expect(roundTrip(message)).toEqual([message]);
  });

  it("prefixes the payload with its byte length, not its character count", () => {
    const frame = encodeBrowserUseFrame({ text: "中文" });
    expect(frame.readUInt32LE(0)).toBe(Buffer.byteLength(JSON.stringify({ text: "中文" }), "utf8"));
    expect(frame.length).toBe(BROWSER_USE_HEADER_BYTES + frame.readUInt32LE(0));
  });

  it("keeps a partial frame for the next chunk instead of dropping it", () => {
    const frame = encodeBrowserUseFrame({ id: 1, method: "ping" });

    // The realistic split: read a fragment, keep what did not parse, prepend it next time.
    const first = decodeBrowserUseFrames(frame.subarray(0, 3));
    expect(first).toEqual({ messages: [], remaining: frame.subarray(0, 3) });

    const second = decodeBrowserUseFrames(Buffer.concat([first!.remaining, frame.subarray(3)]));
    expect(second?.messages).toHaveLength(1);
    expect(JSON.parse(second!.messages[0]!)).toEqual({ id: 1, method: "ping" });
    expect(second?.remaining).toHaveLength(0);
  });

  it("splits two frames that arrived in one chunk", () => {
    const a = encodeBrowserUseFrame({ id: 1, method: "ping" });
    const b = encodeBrowserUseFrame({ id: 2, method: "getInfo" });
    const decoded = decodeBrowserUseFrames(Buffer.concat([a, b]));

    expect(decoded?.messages).toHaveLength(2);
    expect(decoded?.messages.map((raw) => JSON.parse(raw).id)).toEqual([1, 2]);
    expect(decoded?.remaining).toHaveLength(0);
  });

  it("rejects a frame larger than the ceiling rather than buffering it", () => {
    const header = Buffer.alloc(BROWSER_USE_HEADER_BYTES);
    header.writeUInt32LE(BROWSER_USE_MAX_MESSAGE_BYTES + 1, 0);
    expect(decodeBrowserUseFrames(header)).toBeNull();
  });

  it("accepts a frame exactly at the ceiling", () => {
    const header = Buffer.alloc(BROWSER_USE_HEADER_BYTES);
    header.writeUInt32LE(BROWSER_USE_MAX_MESSAGE_BYTES, 0);
    // Still short of the announced body, so this is a partial read, not a rejection.
    expect(decodeBrowserUseFrames(header)).toEqual({ messages: [], remaining: header });
  });

  it("returns nothing for an empty buffer", () => {
    expect(decodeBrowserUseFrames(Buffer.alloc(0))).toEqual({
      messages: [],
      remaining: Buffer.alloc(0),
    });
  });
});
