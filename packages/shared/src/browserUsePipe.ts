/**
 * The browser-use pipe: one definition of the wire contract.
 *
 * The desktop app hosts the in-app browser and serves this pipe; the server dials
 * it to drive the pane an agent is working with. Both sides live in this repo, so
 * the framing, the environment variable, and the method names are defined once
 * here rather than mirrored in two places that would drift.
 *
 * The shape is deliberately Codex-compatible — the same 4-byte length-prefixed
 * frames and the same method names the desktop's pipe server already spoke — so
 * the host side of the contract did not have to be rewritten to gain a client.
 */

import * as OS from "node:os";
import * as Path from "node:path";

/** Environment variable carrying the pipe path into the server process. */
export const PEAKCODE_BROWSER_USE_PIPE_ENV = "PEAKCODE_BROWSER_USE_PIPE_PATH";

/**
 * The skill the `browser` tool belongs to.
 *
 * The tool is built into the harness rather than shipped by an MCP server, so nothing wires
 * "this plugin is installed" to "this tool exists" — but a plugin's skill and its tool have
 * to agree on the name, and the composer references the plugin while the model reads the
 * skill. Keeping the name here means the plugin manifest, the skill id and this constant
 * cannot drift apart silently.
 */
export const BROWSER_USE_SKILL_ID = "browser-use";

/** Length prefix in bytes (uint32, platform endianness). */
export const BROWSER_USE_HEADER_BYTES = 4;

/**
 * Hard ceiling on one frame.
 *
 * Frames carry CDP payloads, and a full accessibility snapshot of a heavy page is
 * large. 8 MiB is generous for that while still bounding what a broken or hostile
 * peer can make either side allocate.
 */
export const BROWSER_USE_MAX_MESSAGE_BYTES = 8 * 1024 * 1024;

/** Directory for the unix socket, under the OS temp directory. */
const BROWSER_USE_PIPE_DIR = "codex-browser-use";
const BROWSER_USE_PIPE_NAME_PREFIX = "peakcode-iab";

/**
 * Where the pipe lives when nothing configured it.
 *
 * Per-process on purpose: two running Peak Code instances must not fight over one
 * socket, and a stale socket left by a crashed process must never be adopted.
 */
export function resolveDefaultBrowserUsePipePath(platform = process.platform): string {
  if (platform === "win32") {
    return String.raw`\\.\pipe\codex-browser-use-${BROWSER_USE_PIPE_NAME_PREFIX}-${process.pid}`;
  }
  return Path.join(
    OS.tmpdir(),
    BROWSER_USE_PIPE_DIR,
    `${BROWSER_USE_PIPE_NAME_PREFIX}-${process.pid}.sock`,
  );
}

/** The configured pipe path, falling back to the per-process default. */
export function resolveConfiguredBrowserUsePipePath(
  env: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
): string {
  return env[PEAKCODE_BROWSER_USE_PIPE_ENV]?.trim() || resolveDefaultBrowserUsePipePath(platform);
}

/**
 * Pipe methods.
 *
 * A const object rather than bare strings: the desktop dispatches on these and the
 * server sends them, so a typo should be a type error rather than a runtime
 * "No handler registered for method".
 */
export const BROWSER_USE_METHODS = {
  ping: "ping",
  getInfo: "getInfo",
  getTabs: "getTabs",
  createTab: "createTab",
  closeTab: "closeTab",
  nameSession: "nameSession",
  attach: "attach",
  detach: "detach",
  executeCdp: "executeCdp",
} as const;

export type BrowserUseMethod = (typeof BROWSER_USE_METHODS)[keyof typeof BROWSER_USE_METHODS];

/** Server-initiated notification carrying a CDP event from an attached tab. */
export const BROWSER_USE_CDP_EVENT_NOTIFICATION = "onCDPEvent";

export type BrowserUseRpcId = string | number;

/**
 * A request on the pipe.
 *
 * `id` is echoed back so a client can keep several requests in flight on one
 * connection; the desktop also tolerates an omitted `id` and simply does not reply.
 */
export interface BrowserUseRpcRequest {
  id?: BrowserUseRpcId;
  method?: string;
  params?: unknown;
}

export interface BrowserUseRpcError {
  code: number;
  message: string;
}

/** A reply, or a notification when `method` is set instead of `result`/`error`. */
export interface BrowserUseRpcResponse {
  jsonrpc: "2.0";
  id?: BrowserUseRpcId;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: BrowserUseRpcError;
}

/** One tab as the pipe reports it. `id` is the pipe's own handle, not a CDP target id. */
export interface BrowserUseTabInfo {
  id: number;
  title: string;
  active: boolean;
  url: string;
}

/** What `getInfo` answers: identifies the host and its backend type. */
export interface BrowserUseBrowserInfo {
  name: string;
  version: string;
  type: string;
  metadata?: Record<string, unknown>;
}

/** Target selector accepted by `executeCdp` and `attach`. */
export interface BrowserUseCdpTarget {
  tabId?: number;
}

/** Parameters accepted by `executeCdp`. */
export interface BrowserUseExecuteCdpParams {
  method: string;
  commandParams?: Record<string, unknown>;
  target?: BrowserUseCdpTarget;
}

/** Prefix a payload with its length, in the platform's byte order. */
export function encodeBrowserUseFrame(message: unknown): Buffer {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(BROWSER_USE_HEADER_BYTES);
  if (OS.endianness() === "LE") {
    header.writeUInt32LE(payload.length, 0);
  } else {
    header.writeUInt32BE(payload.length, 0);
  }
  return Buffer.concat([header, payload]);
}

/**
 * Pull every complete frame out of a buffer.
 *
 * Returns `null` when a frame announces more than {@link BROWSER_USE_MAX_MESSAGE_BYTES}:
 * that is not a short read but a peer that is either broken or hostile, and the
 * caller should drop the connection rather than keep buffering. A partial trailing
 * frame is returned as `remaining` for the next chunk.
 */
export function decodeBrowserUseFrames(
  buffer: Buffer,
): { messages: string[]; remaining: Buffer } | null {
  let offset = 0;
  const messages: string[] = [];
  while (buffer.length - offset >= BROWSER_USE_HEADER_BYTES) {
    const messageLength =
      OS.endianness() === "LE" ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
    if (messageLength > BROWSER_USE_MAX_MESSAGE_BYTES) {
      return null;
    }
    const frameLength = BROWSER_USE_HEADER_BYTES + messageLength;
    if (buffer.length - offset < frameLength) {
      break;
    }
    messages.push(
      buffer.subarray(offset + BROWSER_USE_HEADER_BYTES, offset + frameLength).toString("utf8"),
    );
    offset += frameLength;
  }
  return { messages, remaining: buffer.subarray(offset) };
}
