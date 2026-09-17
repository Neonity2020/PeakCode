/**
 * The host side of the `computer` tool.
 *
 * The toolkit declares the tool and validates arguments; this module knows how to reach the
 * native helper and answers when it cannot. It is installed once at server start, the way the
 * browser host is, so the provider layer never has to know a computer exists.
 *
 * ## Where the state lives, and why
 *
 * The observation state — which refs exist for which `state_id` — deliberately lives in the
 * helper, not here. A ref names a position in one tree, and the element behind it may be a
 * different control by the time the next call arrives; keeping the mapping next to the
 * elements is what makes a stale ref detectable instead of silently wrong.
 *
 * The one thing this layer does own is the geometry of the last capture: the model reads a
 * coordinate off an image and passes it through, and this is the side that knows where that image
 * came from. Two numbers are needed, not one — the scale (points to pixels, per display) and the
 * origin (where the image sat on screen). A window capture starts at the window's own corner, so
 * dividing by the scale alone put every click off by the distance from the screen's corner to
 * that window; the origin is what fixes it.
 */
import * as FS from "node:fs";

import {
  errorResult,
  textResult,
  type ComputerToolParams,
  type ToolOutcomeWithImage,
} from "@peakcode/agent-toolkit/agent-tools";

import { COMPUTER_USE_METHODS } from "@peakcode/shared/computerUse";

import {
  ComputerUseClient,
  ComputerUseRequestError,
  ComputerUseUnavailableError,
} from "./computerUseClient.ts";

/** Ceiling on an accessibility dump handed to the model. The helper already bounds its own
 *  walk; this is the second line of defence against a very large window. */
const MAX_TREE_CHARS = 60_000;

/** A clipboard can hold a whole document. Same reasoning as the tree ceiling above. */
const MAX_CLIPBOARD_CHARS = 20_000;

export interface ComputerToolHost {
  run(params: ComputerToolParams): Promise<ToolOutcomeWithImage>;
}

let installedHost: ComputerToolHost | null = null;

/** Install the host the tool callback resolves against. Called once per server start. */
export function setComputerToolHost(host: ComputerToolHost | null): void {
  installedHost = host;
}

/**
 * Whether this server can drive a desktop at all.
 *
 * The provider asks before injecting the callback, because whether the tool is registered is
 * decided per session: a server with no helper has no desktop to drive, and offering the tool
 * anyway would leave the model calling a verb that can never work.
 */
export function computerControlConfigured(): boolean {
  return installedHost !== null;
}

/** Drive the desktop. Wired as the toolkit's `onComputer` callback. */
export function computerFromConversation(
  params: ComputerToolParams,
): Promise<ToolOutcomeWithImage> {
  if (installedHost === null) {
    return Promise.resolve(errorResult("Computer control is not available in this session."));
  }
  return installedHost.run(params);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/** The permission state, phrased so the model can tell the user exactly what to do. */
function permissionReport(status: {
  accessibility: boolean;
  screenRecording: boolean;
  helperPath: string;
}): string {
  const lines = [
    `Accessibility: ${status.accessibility ? "granted" : "NOT granted"}`,
    `Screen Recording: ${status.screenRecording ? "granted" : "NOT granted"}`,
    `Helper: ${status.helperPath}`,
  ];
  if (!status.accessibility || !status.screenRecording) {
    const missing = [
      ...(status.accessibility ? [] : ["Accessibility"]),
      ...(status.screenRecording ? [] : ["Screen Recording"]),
    ];
    lines.push(
      "",
      `Peak Code Computer Use needs ${missing.join(" and ")} before it can do anything. ` +
        "Ask the user to add it under System Settings → Privacy & Security, and stop there — " +
        "do not retry until they say it is granted.",
    );
  }
  return lines.join("\n");
}

export class DefaultComputerToolHost implements ComputerToolHost {
  private readonly client: ComputerUseClient;

  /**
   * Where the most recent capture sat, and at what scale.
   *
   * Accessibility geometry and input synthesis are in points; a capture is in pixels. The model
   * reads a point off the image and passes it straight through, so the transform has to happen
   * somewhere the image is known — here. Before any capture the identity transform is used, which
   * makes a coordinate without a screenshot mean screen points, as it always did.
   */
  private lastCapture = { originX: 0, originY: 0, scaleFactor: 1 };

  /** Turn a coordinate read off the last capture into a screen point. */
  private toScreenPoint(x: number, y: number): { x: number; y: number } {
    const { originX, originY, scaleFactor } = this.lastCapture;
    const scale = scaleFactor > 0 ? scaleFactor : 1;
    return { x: originX + x / scale, y: originY + y / scale };
  }

  constructor(client: ComputerUseClient) {
    this.client = client;
  }

  async run(params: ComputerToolParams): Promise<ToolOutcomeWithImage> {
    try {
      return await this.dispatch(params);
    } catch (error) {
      return this.failure(error);
    }
  }

  private async dispatch(params: ComputerToolParams): Promise<ToolOutcomeWithImage> {
    switch (params.action) {
      case "status": {
        const status = await this.client.statusOrNull();
        if (!status) {
          return errorResult(
            "The computer-use helper is not running. The Peak Code desktop app installs and starts it.",
          );
        }
        return textResult(permissionReport(status));
      }

      case "request_access": {
        // The helper calls the system's own prompt, so this is the one action that is safe to
        // take while the grant is missing.
        const result = asRecord(await this.client.call(COMPUTER_USE_METHODS.requestAccess));
        return textResult(
          [
            "macOS has been asked to show its permission prompts.",
            "",
            permissionReport({
              accessibility: result.accessibility === true,
              screenRecording: result.screenRecording === true,
              helperPath: String(result.helperPath ?? ""),
            }),
            "",
            "If a permission is still not granted, the user has to switch it on in System Settings; " +
              "the prompt only offers the shortcut. Wait for the user rather than retrying.",
          ].join("\n"),
        );
      }

      case "list_apps": {
        const result = asRecord(await this.client.call(COMPUTER_USE_METHODS.listApps));
        const apps = Array.isArray(result.apps) ? result.apps : [];
        const lines = apps.map((entry) => {
          const app = asRecord(entry);
          const active = app.active === true ? " (frontmost)" : "";
          return `- ${String(app.name ?? "?")} [${String(app.bundleId ?? "")}] pid ${String(app.pid ?? "?")}${active}`;
        });
        return textResult([`${apps.length} running apps:`, "", ...lines].join("\n"));
      }

      case "list_windows": {
        const result = asRecord(
          await this.client.call(COMPUTER_USE_METHODS.listWindows, {
            include_all_layers: params.include_all_layers === true,
          }),
        );
        const windows = Array.isArray(result.windows) ? result.windows : [];
        const lines = windows.map((entry) => {
          const window = asRecord(entry);
          const bounds = asRecord(window.bounds);
          const front = window.frontmost === true ? ", frontmost" : "";
          const layer = Number(window.layer ?? 0);
          return (
            `- [${String(window.windowId ?? "?")}] ${String(window.app ?? "?")} ` +
            `"${String(window.title ?? "")}" pid ${String(window.pid ?? "?")} ` +
            `at (${Number(bounds.x ?? 0)},${Number(bounds.y ?? 0)}) ` +
            `${Number(bounds.width ?? 0)}x${Number(bounds.height ?? 0)}${front}` +
            (layer === 0 ? "" : ` layer ${layer}`)
          );
        });
        return textResult(
          [
            `${windows.length} on-screen windows:`,
            "",
            ...lines,
            "",
            "Capture one with `screenshot` and its `window_id`; its bounds are also screen points, " +
              "so a `click` can be aimed at it directly.",
          ].join("\n"),
        );
      }

      case "displays": {
        const result = asRecord(await this.client.call(COMPUTER_USE_METHODS.displays));
        const displays = Array.isArray(result.displays) ? result.displays : [];
        const lines = displays.map((entry) => {
          const display = asRecord(entry);
          const bounds = asRecord(display.bounds);
          return (
            `- display ${String(display.id ?? "?")}${display.main === true ? " (main)" : ""} ` +
            `at (${Number(bounds.x ?? 0)},${Number(bounds.y ?? 0)}) ` +
            `${Number(bounds.width ?? 0)}x${Number(bounds.height ?? 0)} points, ` +
            `${Number(display.pixelWidth ?? 0)}x${Number(display.pixelHeight ?? 0)} pixels, ` +
            `scale ${Number(display.scaleFactor ?? 1)}`
          );
        });
        return textResult(
          [
            `${displays.length} active display${displays.length === 1 ? "" : "s"}:`,
            "",
            ...lines,
            "",
            "Screen points are what `click` takes and what the window bounds above are in. " +
              "Screenshots are in pixels, and the scale differs per display — read coordinates " +
              "off an image rather than guessing them from here.",
          ].join("\n"),
        );
      }

      case "get_state": {
        const result = asRecord(
          await this.client.call(COMPUTER_USE_METHODS.getState, {
            app: params.app?.trim() || undefined,
            pid: params.pid,
            scope: params.scope?.trim() || undefined,
          }),
        );

        const text = String(result.text ?? "");
        const stateId = String(result.stateId ?? "");
        const partial = result.partial === true;

        const header = [
          `state_id: ${stateId}`,
          "Act with `act` using a ref from this tree. The refs are only valid for this observation.",
          partial
            ? "This tree is partial — it stopped early or hit the element ceiling. Do not conclude " +
              "that a control is missing just because it is not listed."
            : "",
        ]
          .filter(Boolean)
          .join("\n");

        const body =
          text.length > MAX_TREE_CHARS ? `${text.slice(0, MAX_TREE_CHARS)}\n[truncated]` : text;
        return textResult(`${header}\n\n${body}`);
      }

      case "act": {
        const result = asRecord(
          await this.client.call(COMPUTER_USE_METHODS.act, {
            stateId: params.state_id,
            ref: params.ref,
            action: params.element_action?.trim() || "press",
            value: params.value,
          }),
        );
        return textResult(
          `Dispatched \`${params.element_action?.trim() || "press"}\` on ref ${String(params.ref)} ` +
            `(${String(result.detail ?? "ok")}). That is a receipt, not a result — call \`get_state\` ` +
            "again if you need to know what changed.",
        );
      }

      case "open_app": {
        const result = asRecord(
          await this.client.call(COMPUTER_USE_METHODS.openApp, {
            app: params.app?.trim() || undefined,
            pid: params.pid,
            path: params.path?.trim() || undefined,
          }),
        );
        return textResult(String(result.detail ?? "done"));
      }

      case "click": {
        const point = this.toScreenPoint(params.x ?? 0, params.y ?? 0);
        const result = asRecord(
          await this.client.call(COMPUTER_USE_METHODS.click, {
            x: point.x,
            y: point.y,
            button: params.button?.trim() || "left",
            count: params.count ?? 1,
          }),
        );
        const where = `(${Math.round(point.x)},${Math.round(point.y)}) in screen points`;
        return textResult(
          `${String(result.detail ?? "clicked")} — ${where}. The user's pointer moved, so this is ` +
            "real input rather than a background action. Take a screenshot if you need to see what " +
            "it did.",
        );
      }

      case "drag": {
        const from = this.toScreenPoint(params.from_x ?? 0, params.from_y ?? 0);
        const to = this.toScreenPoint(params.to_x ?? 0, params.to_y ?? 0);
        const result = asRecord(
          await this.client.call(COMPUTER_USE_METHODS.drag, {
            from_x: from.x,
            from_y: from.y,
            to_x: to.x,
            to_y: to.y,
            button: params.button?.trim() || "left",
            duration_ms: params.duration_ms ?? 400,
            modifiers: params.modifiers?.trim() || undefined,
          }),
        );
        return textResult(
          `${String(result.detail ?? "dragged")} — (${Math.round(from.x)},${Math.round(from.y)}) to ` +
            `(${Math.round(to.x)},${Math.round(to.y)}) in screen points. The user's pointer moved. ` +
            "That is a receipt, not a result: observe again to see what it did.",
        );
      }

      case "scroll": {
        const direction = params.direction?.trim().toLowerCase() || "";
        const hasPoint = typeof params.x === "number" && typeof params.y === "number";
        const point = hasPoint ? this.toScreenPoint(params.x ?? 0, params.y ?? 0) : null;
        const result = asRecord(
          await this.client.call(COMPUTER_USE_METHODS.scroll, {
            ...(point ? { x: point.x, y: point.y } : {}),
            // Without a point, the app's window is what a caller means by "scroll there".
            ...(point ? {} : { app: params.app?.trim() || undefined, pid: params.pid }),
            direction,
            amount: params.amount,
            unit: params.unit?.trim().toLowerCase() || "line",
          }),
        );
        const moved = result.pointerMoved === true;
        return textResult(
          `${String(result.detail ?? "scrolled")}.${moved ? " The user's pointer moved first — scroll events land where the pointer is." : ""} ` +
            "Content that scrolled is not content that changed: call `get_state` again if you need " +
            "to know what is visible now.",
        );
      }

      case "type": {
        const strategy = params.strategy?.trim().toLowerCase() || "keys";
        const result = asRecord(
          await this.client.call(COMPUTER_USE_METHODS.type, {
            text: params.text ?? "",
            strategy,
          }),
        );
        return textResult(
          `${String(result.detail ?? "typed")}, into whatever currently has the user's keyboard focus.` +
            (strategy === "paste"
              ? " It went through the clipboard, which was put back the way it was."
              : ""),
        );
      }

      case "key": {
        const result = asRecord(
          await this.client.call(COMPUTER_USE_METHODS.key, { key: params.key }),
        );
        return textResult(String(result.detail ?? "pressed"));
      }

      case "read_clipboard": {
        const result = asRecord(await this.client.call(COMPUTER_USE_METHODS.readClipboard));
        const text = String(result.text ?? "");
        const types = Array.isArray(result.types) ? result.types.map(String) : [];
        if (result.hasText !== true) {
          return textResult(
            `The clipboard holds no text (${types.length ? types.join(", ") : "nothing"}). ` +
              "If it should hold an image or a file, read it where it lives rather than through " +
              "the clipboard.",
          );
        }
        const body =
          text.length > MAX_CLIPBOARD_CHARS
            ? `${text.slice(0, MAX_CLIPBOARD_CHARS)}\n[truncated]`
            : text;
        return textResult(
          [
            `Clipboard text (${text.length} characters, change count ${String(result.changeCount ?? "?")}):`,
            "",
            body,
          ].join("\n"),
        );
      }

      case "write_clipboard": {
        const result = asRecord(
          await this.client.call(COMPUTER_USE_METHODS.writeClipboard, {
            text: params.text ?? "",
          }),
        );
        return textResult(
          `${String(result.detail ?? "wrote the clipboard")}. The user's previous clipboard content ` +
            "is gone — say so if it might matter, and prefer handing text to an app that way only " +
            "when a paste is what it wants.",
        );
      }

      case "screenshot": {
        // A full-screen capture names no target at all: the helper's default is the display.
        const target =
          params.full_screen === true
            ? {}
            : {
                app: params.app?.trim() || undefined,
                pid: params.pid,
                window_id: params.window_id,
              };
        const result = asRecord(await this.client.call(COMPUTER_USE_METHODS.screenshot, target));

        const path = String(result.path ?? "");
        const scale = Number(result.scaleFactor ?? 1) || 1;
        const originX = Number(result.originX ?? 0);
        const originY = Number(result.originY ?? 0);
        const display = asRecord(result.display);
        this.lastCapture = { originX, originY, scaleFactor: scale };

        if (!path || !FS.existsSync(path)) {
          return errorResult("The capture did not produce a file.");
        }

        const data = await FS.promises.readFile(path);
        const pixelWidth = Number(result.pixelWidth ?? 0);
        const pixelHeight = Number(result.pixelHeight ?? 0);
        const windowId = result.windowId;

        return {
          content: [
            {
              type: "text" as const,
              text:
                `Captured ${pixelWidth}x${pixelHeight} pixels of ` +
                (windowId === undefined
                  ? "the display at the screen's origin"
                  : `window ${String(windowId)}, which starts at screen point (${originX},${originY})`) +
                ` (image saved at ${path}). ` +
                "Coordinates for `click`, `drag` and `scroll` are pixels in this image — pass the " +
                "point you see as-is; where the image sat and the display's scale are already " +
                "accounted for. " +
                (display.id === undefined ? "" : `Display ${String(display.id)}. `) +
                (scale === 1 ? "" : `Scaled ${scale}x. `),
            },
            { type: "image" as const, data: data.toString("base64"), mimeType: "image/png" },
          ],
          details: {
            path,
            pixelWidth,
            pixelHeight,
            scaleFactor: scale,
            originX,
            originY,
            windowId,
          },
        };
      }

      default:
        return errorResult(`Unknown action \`${params.action}\`.`);
    }
  }

  private failure(error: unknown): ToolOutcomeWithImage {
    if (error instanceof ComputerUseUnavailableError) {
      return errorResult(
        "Computer control is unavailable: the Peak Code computer-use helper is not running. " +
          "It is installed and started by the desktop app. Tell the user rather than retrying.",
      );
    }

    if (error instanceof ComputerUseRequestError) {
      switch (error.code) {
        case "accessibility_denied":
          return errorResult(
            "Peak Code Computer Use does not have Accessibility permission. Ask the user to grant " +
              "it in System Settings → Privacy & Security → Accessibility, then end your turn. " +
              "Do not retry — it will fail the same way until they do.",
          );
        case "screen_recording_denied":
          return errorResult(
            "Peak Code Computer Use does not have Screen Recording permission. Ask the user to grant " +
              "it in System Settings → Privacy & Security → Screen Recording, then end your turn.",
          );
        case "stale_ref":
          return errorResult(
            `${error.message} Take a fresh \`get_state\` and use a ref from that one — the element ` +
              "behind the old ref may be a different control now.",
          );
        case "protocol_mismatch":
          return errorResult(`${error.message} Tell the user to restart the desktop app.`);
        case "internal_error":
          // The helper answers instead of dying, so this is reportable rather than fatal.
          return errorResult(
            `${error.message} Do not repeat the same call expecting a different result — try ` +
              "another way of doing it, or tell the user what failed.",
          );
        default:
          return errorResult(error.message);
      }
    }

    return errorResult(
      `The computer command failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
