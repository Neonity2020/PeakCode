/**
 * The computer-use helper: one definition of the wire contract.
 *
 * The desktop app installs and launches a small native macOS helper; the server dials the
 * helper's socket and drives it. Both sides live in this repo, so the paths, the framing
 * and the method names are defined once here rather than mirrored in two places that would
 * drift.
 *
 * ## Why this peer is different from the browser-use pipe
 *
 * Two things force the shape:
 *
 * 1. **The helper is not a child process.** macOS attributes a privacy grant to the app
 *    that owns the process tree, and a child inherits its parent's attribution. A helper
 *    spawned by Peak Code would therefore borrow Peak Code's Accessibility identity — which
 *    for an ad-hoc signed dev build changes on every rebuild. The helper is launched through
 *    LaunchServices instead so it owns its grant; that rules out stdio and leaves a socket.
 * 2. **The peer is a native app, not Node.** The framing is line-delimited JSON because a C
 *    socket loop can split on `\n` without carrying a length-prefix state machine. Every
 *    message here is small, so the extra bytes a length prefix would have saved do not
 *    matter, and the simplicity is worth more than the bytes.
 *
 * ## Why the paths are deterministic
 *
 * The helper outlives the app process that launched it, and it must keep the *same* path
 * across rebuilds — the Accessibility grant is pinned to the helper's signed identity, and
 * moving the bundle would invalidate it. So the location is fixed, not per-process the way
 * `browserUsePipe` is.
 */

import * as OS from "node:os";
import * as Path from "node:path";

/** Environment variable overriding the helper socket path. */
export const PEAKCODE_COMPUTER_USE_SOCKET_ENV = "PEAKCODE_COMPUTER_USE_SOCKET_PATH";

/** Environment variable overriding the helper bundle path. */
export const PEAKCODE_COMPUTER_USE_HELPER_ENV = "PEAKCODE_COMPUTER_USE_HELPER_PATH";

/**
 * Environment variable pointing at a helper that shipped inside the app rather than at one
 * already installed.
 *
 * The desktop app resolves this itself from its own bundle; the override exists so a build can
 * be pointed at a staged copy — which is also how the install-from-bundle path is tested
 * without packaging anything.
 */
export const PEAKCODE_COMPUTER_USE_BUNDLED_HELPER_ENV = "PEAKCODE_COMPUTER_USE_BUNDLED_HELPER_PATH";

/**
 * Where a packaged app puts the helper, relative to its own resources directory.
 *
 * The release script stages the built bundle here and electron-builder copies it to
 * `Contents/Resources/computer-use` (see the macOS `extraResources` entry).
 */
export const COMPUTER_USE_BUNDLED_HELPER_DIR_NAME = "computer-use";

/**
 * The skill the `computer` tool belongs to.
 *
 * The tool is built into the harness rather than shipped by an MCP server, so nothing wires
 * "this plugin is installed" to "this tool exists" — but the plugin manifest, the skill id
 * and this constant have to agree, and keeping the name here means they cannot drift apart
 * silently.
 */
export const COMPUTER_USE_SKILL_ID = "computer-use";

/** The helper's own bundle identifier. This is what macOS lists in System Settings. */
export const COMPUTER_USE_HELPER_BUNDLE_ID = "com.peakcode.cua-helper";

/** The name the user sees in System Settings → Privacy & Security → Accessibility. */
export const COMPUTER_USE_HELPER_DISPLAY_NAME = "Peak Code Computer Use";

/** The helper bundle name on disk. */
export const COMPUTER_USE_HELPER_APP_NAME = "Peak Code Computer Use.app";

/**
 * Wire protocol version.
 *
 * The helper reports this on `status` and the client refuses a mismatch, because a stale
 * helper left running from an older build would otherwise answer older semantics.
 */
export const COMPUTER_USE_PROTOCOL_VERSION = 2;

/**
 * Hard ceiling on one line.
 *
 * An accessibility dump of a dense app is the largest thing this protocol carries, and it is
 * text. 4 MiB is generous for that while still bounding what a broken peer can make either
 * side buffer before it sees a newline.
 */
export const COMPUTER_USE_MAX_LINE_BYTES = 4 * 1024 * 1024;

/** Directory holding the installed helper, its socket and its token. */
export function resolveComputerUseDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const override = env.PEAKCODE_COMPUTER_USE_DIR?.trim();
  if (override) {
    return override;
  }
  const home = OS.homedir();
  // The helper keeps its grant across rebuilds only while its path is stable, so this is
  // deliberately not a versioned or per-process directory.
  return platform === "win32"
    ? Path.join(env.LOCALAPPDATA ?? Path.join(home, "AppData", "Local"), "peakcode", "computer-use")
    : platform === "linux"
      ? Path.join(
          env.XDG_DATA_HOME ?? Path.join(home, ".local", "share"),
          "peakcode",
          "computer-use",
        )
      : Path.join(home, "Library", "Application Support", "peakcode", "computer-use");
}

/** Where the helper bundle is installed. */
export function resolveComputerUseHelperPath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env[PEAKCODE_COMPUTER_USE_HELPER_ENV]?.trim();
  return override || Path.join(resolveComputerUseDir(env), COMPUTER_USE_HELPER_APP_NAME);
}

/** Where the helper listens. */
export function resolveComputerUseSocketPath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env[PEAKCODE_COMPUTER_USE_SOCKET_ENV]?.trim();
  return override || Path.join(resolveComputerUseDir(env), "helper.sock");
}

/**
 * Where the helper leaves the token a client has to present.
 *
 * The socket already sits in a user-owned directory, so this is defence in depth rather than
 * the only gate: it keeps another local process that guessed the path from driving the
 * user's desktop by simply connecting.
 */
export function resolveComputerUseTokenPath(env: NodeJS.ProcessEnv = process.env): string {
  return Path.join(resolveComputerUseDir(env), "helper.token");
}

/**
 * Methods.
 *
 * A const object rather than bare strings because the helper dispatches on these and the
 * client sends them, so a typo should be a type error rather than a runtime
 * "unknown method".
 */
export const COMPUTER_USE_METHODS = {
  /** Capability report: trust state, version, paths. Always safe to call. */
  status: "status",
  /** Ask macOS to show its own grant prompts, then report the new state. */
  requestAccess: "request_access",
  /** Running applications. */
  listApps: "list_apps",
  /** On-screen windows with their bounds, so a caller can pick one to read or capture. */
  listWindows: "list_windows",
  /** Active displays with their bounds and scale factors — the coordinate space itself. */
  displays: "displays",
  /** The accessibility tree of one app, rendered as text plus element refs. */
  getState: "get_state",
  /** Act on an element ref from a `get_state`. */
  act: "act",
  /** Launch or foreground an app. */
  openApp: "open_app",
  /** Synthetic pointer input at a screen coordinate. */
  click: "click",
  /** Synthetic pointer path: press, move through the intermediate points, release. */
  drag: "drag",
  /** Synthetic wheel input, aimed at a point or at an app's front window. */
  scroll: "scroll",
  /** Synthetic keyboard input: literal text. */
  type: "type",
  /** Synthetic keyboard input: one key or chord. */
  key: "key",
  /** The clipboard, read. */
  readClipboard: "read_clipboard",
  /** The clipboard, written. */
  writeClipboard: "write_clipboard",
  /** Capture the screen or one window to a PNG. */
  screenshot: "screenshot",
} as const;

export type ComputerUseMethod = (typeof COMPUTER_USE_METHODS)[keyof typeof COMPUTER_USE_METHODS];

/** A request line. */
export interface ComputerUseRequest {
  readonly id: number | string;
  readonly method: ComputerUseMethod;
  /** The token from `helper.token`, or the request is refused. */
  readonly token?: string;
  readonly params?: Record<string, unknown>;
}

/** A response line. Exactly one of `result` / `error` is present. */
export interface ComputerUseResponse {
  readonly id: number | string;
  readonly result?: unknown;
  readonly error?: { readonly code: string; readonly message: string };
}

/** Error codes the client distinguishes rather than just printing. */
export const COMPUTER_USE_ERROR_CODES = {
  /** Accessibility is not granted for the helper. */
  accessibilityDenied: "accessibility_denied",
  /** Screen Recording is not granted for the helper. */
  screenRecordingDenied: "screen_recording_denied",
  /** The helper is not the version the client speaks to. */
  protocolMismatch: "protocol_mismatch",
  /** The ref no longer exists, or belongs to an older observation. */
  staleRef: "stale_ref",
  /** Bad arguments — the caller can fix these. */
  badRequest: "bad_request",
  /** The token was missing or wrong. */
  unauthorized: "unauthorized",
  /** A handler raised inside the helper: a bug there, not a bad request from here. */
  internalError: "internal_error",
} as const;

export type ComputerUseErrorCode =
  (typeof COMPUTER_USE_ERROR_CODES)[keyof typeof COMPUTER_USE_ERROR_CODES];

/** Serialize one message. Newlines inside strings are escaped by JSON, so a line is a line. */
export function encodeComputerUseMessage(
  message: ComputerUseRequest | ComputerUseResponse,
): string {
  return `${JSON.stringify(message)}\n`;
}

/**
 * Split a buffer into complete lines plus whatever is left over.
 *
 * The remainder is returned rather than buffered internally so the caller keeps ownership of
 * its own state — the same contract `decodeBrowserUseFrames` uses.
 */
export function decodeComputerUseMessages(buffer: string): {
  messages: ComputerUseResponse[];
  rest: string;
} {
  const lastNewline = buffer.lastIndexOf("\n");
  if (lastNewline < 0) {
    return { messages: [], rest: buffer };
  }

  const complete = buffer.slice(0, lastNewline);
  const rest = buffer.slice(lastNewline + 1);
  const messages: ComputerUseResponse[] = [];

  for (const line of complete.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      messages.push(JSON.parse(trimmed) as ComputerUseResponse);
    } catch {
      // A malformed line is the peer's bug, not a reason to drop the ones around it. The
      // caller sees the gap as a missing response id and times that request out.
    }
  }

  return { messages, rest };
}
