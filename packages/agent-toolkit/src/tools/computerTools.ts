/**
 * `computer`：驱动 macOS 桌面。
 *
 * 工具只声明接口并做「模型自己能改对」的入参校验，真正的实现在宿主
 * （`apps/server/src/computer/`）—— 它才知道 helper 的套接字、观察状态和坐标缩放。
 * 这条分界和 `browser` / `schedule_task` / `kanban_comment` 一致：工具集不碰宿主服务。
 *
 * 描述里写的三件事是模型最容易做错的：用元素 ref 而不是坐标、ref 只在本次观察内有效、
 * 合成输入会真的移动用户的鼠标和焦点。
 */
import { Type } from "@earendil-works/pi-ai";

import { BuiltTool, ComputerToolParams, ToolContext, errorResult } from "./toolSupport.ts";

/**
 * 全部动作。
 *
 * 观测（list_apps / list_windows / displays / get_state / screenshot / status）、
 * 元素（act）、应用（open_app）、合成输入（click / drag / scroll / type / key）、
 * 剪贴板（read_clipboard / write_clipboard）、授权（request_access）。
 */
export const COMPUTER_ACTIONS = [
  "status",
  "request_access",
  "list_apps",
  "list_windows",
  "displays",
  "get_state",
  "act",
  "open_app",
  "click",
  "drag",
  "scroll",
  "type",
  "key",
  "read_clipboard",
  "write_clipboard",
  "screenshot",
] as const;

export type ComputerAction = (typeof COMPUTER_ACTIONS)[number];

const ACTION_SET: ReadonlySet<string> = new Set(COMPUTER_ACTIONS);

/** `act` 能做的元素操作。 */
const ELEMENT_ACTIONS = ["press", "focus", "raise", "set_value"] as const;

const CLICK_BUTTONS = ["left", "right", "middle"] as const;

/** 滚动的四个方向，按"内容往哪边走"命名（`down` = 看更下面的内容）。 */
const SCROLL_DIRECTIONS = new Set(["up", "down", "left", "right"]);

const SCROLL_UNITS = new Set(["line", "pixel"]);

/** `paste` 会在按下 ⌘V 前后接管剪贴板，所以它是一个要明说的选择，而不是默认。 */
const TYPE_STRATEGIES = new Set(["keys", "paste"]);

const MODIFIER_NAMES = new Set([
  "cmd",
  "command",
  "shift",
  "ctrl",
  "control",
  "alt",
  "opt",
  "option",
]);

const asTrimmed = (value: string | undefined): string => value?.trim() ?? "";

/**
 * 入参校验。
 *
 * 只拦「模型看着报错就能自己改对」的输入：动作名拼错、少一个必填项、坐标只给了一半。
 * 资源类的失败（应用不在运行、ref 过期、没授权、helper 没起）留给宿主 ——
 * 那些要看真实状态才能回答。
 *
 * 返回一句话就够：调用方把它原样交回模型，模型是唯一能修正这次调用的人。
 */
export function computerArgsError(params: ComputerToolParams): string | null {
  const action = asTrimmed(params.action);
  if (!action) {
    return `\`action\` is required. One of: ${COMPUTER_ACTIONS.join(", ")}.`;
  }
  if (!ACTION_SET.has(action)) {
    return `Unknown \`action\`: ${action}. One of: ${COMPUTER_ACTIONS.join(", ")}.`;
  }

  if ((typeof params.x === "number") !== (typeof params.y === "number")) {
    return "A coordinate needs both `x` and `y`.";
  }
  if (
    params.button !== undefined &&
    !(CLICK_BUTTONS as readonly string[]).includes(asTrimmed(params.button))
  ) {
    return "`button` must be left, right or middle.";
  }

  switch (action) {
    case "get_state":
      // Either identity works; without one there is nothing to attach to.
      if (typeof params.pid === "number" || asTrimmed(params.app)) {
        return null;
      }
      return "`get_state` needs an `app` name or a `pid` (list_apps shows the running ones).";
    case "act": {
      if (!asTrimmed(params.state_id)) {
        return "`act` needs the `state_id` from the `get_state` you are acting on.";
      }
      if (typeof params.ref !== "number") {
        return "`act` needs a `ref` from that `get_state`.";
      }
      const elementAction = asTrimmed(params.element_action) || "press";
      if (!(ELEMENT_ACTIONS as readonly string[]).includes(elementAction)) {
        return `Unknown \`element_action\`: ${elementAction}. One of: ${ELEMENT_ACTIONS.join(", ")}.`;
      }
      if (elementAction === "set_value" && params.value === undefined) {
        return "`set_value` needs the `value` to write.";
      }
      return null;
    }
    case "open_app":
      if (asTrimmed(params.app) || asTrimmed(params.path) || typeof params.pid === "number") {
        return null;
      }
      return "`open_app` needs an `app` name, a `pid`, or a `path` to launch.";
    case "click":
      return typeof params.x === "number" && typeof params.y === "number"
        ? null
        : "`click` needs an `x`/`y` point read off your latest screenshot.";
    case "drag": {
      const missing = (["from_x", "from_y", "to_x", "to_y"] as const).filter(
        (key) => typeof params[key] !== "number",
      );
      if (missing.length) {
        return `\`drag\` needs all four of \`from_x\`, \`from_y\`, \`to_x\`, \`to_y\` (missing ${missing.join(", ")}).`;
      }
      if (params.duration_ms !== undefined && params.duration_ms < 50) {
        return "`duration_ms` under 50 looks like a click to most apps. Use 100-1000.";
      }
      if (
        params.modifiers !== undefined &&
        !params.modifiers
          .split("+")
          .every((part) => MODIFIER_NAMES.has(asTrimmed(part).toLowerCase()))
      ) {
        return "`modifiers` must be a `+`-joined chord of cmd, shift, ctrl, alt — or left out.";
      }
      return null;
    }
    case "scroll": {
      const direction = asTrimmed(params.direction).toLowerCase();
      if (!SCROLL_DIRECTIONS.has(direction)) {
        return `\`scroll\` needs a \`direction\`: ${[...SCROLL_DIRECTIONS].join(", ")}.`;
      }
      if (params.unit !== undefined && !SCROLL_UNITS.has(asTrimmed(params.unit).toLowerCase())) {
        return "`unit` is `line` (default) or `pixel`.";
      }
      if (params.amount !== undefined && !(params.amount > 0)) {
        return "`amount` is how much to scroll, so it has to be positive — the direction says which way.";
      }
      return null;
    }
    case "read_clipboard":
      return null;
    case "write_clipboard":
      return params.text === undefined
        ? "`write_clipboard` needs the `text` to put on the clipboard."
        : null;
    case "type":
      if (params.text === undefined) {
        return "`type` needs the `text` to insert.";
      }
      if (params.strategy !== undefined && !TYPE_STRATEGIES.has(asTrimmed(params.strategy))) {
        return "`strategy` is `keys` (default) or `paste`.";
      }
      return null;
    case "key":
      return asTrimmed(params.key) ? null : "`key` needs a `key` (for example `Enter` or `cmd+a`).";
    default:
      // status / request_access / list_apps / list_windows / displays / get_state / screenshot
      // 不需要额外参数，除 get_state（上面单独校验）。
      return null;
  }
}

/**
 * `computer`：看见并操作 macOS 上的应用。
 *
 * 描述就是模型侧的契约，所以它把最容易做错的事写在最前面：先观察、用 ref 而不是坐标、
 * 合成输入会抢走用户的光标，以及不可逆的操作要先问。
 */
export function createComputerTool(ctx: ToolContext): BuiltTool {
  return {
    name: "computer",
    label: "Use the computer",
    description:
      "See and drive apps on this Mac: read an app's accessibility tree, act on its controls, " +
      "and fall back to real mouse and keyboard input when the tree cannot express the target. " +
      "Use this for work in a native macOS app — the `browser` tool is better for web pages, and " +
      "the shell is better for files.\n\n" +
      "Work in a loop: observe once, act once, observe again. `get_state` is how you see an app — " +
      "it returns the accessibility tree of the window in focus, with a numbered ref for each " +
      "element, its position and size, and the actions it actually supports (`press`, `set_value`). " +
      "Act with `act` and a ref from that same observation. Nothing is on the screen that you have " +
      "not scrolled to: if a list looks short, `scroll` before concluding something is absent.\n\n" +
      "Prefer `act` over coordinates: an element action is precise, survives the window moving, " +
      "and never touches the user's pointer or focus. A ref is only valid for the observation it " +
      "came from — after anything changes, call `get_state` again rather than reusing it. Reach " +
      "for `click`/`type`/`key` only when the tree genuinely cannot express the target (a canvas, " +
      "a custom-drawn control), and know that those move the user's real cursor and type into " +
      "their real focus.\n\n" +
      "Coordinates for `click`, `drag` and `scroll` are pixels read off your most recent " +
      "`screenshot` (or a window's own coordinates from `list_windows`). That capture reports the " +
      "scale it was taken at and where it sat on screen, so pass the point you actually see in the " +
      "image and it is mapped for you — on a multi-display Mac the same pixel is a different " +
      "screen point depending on which display it was on, which is why `displays` exists.\n\n" +
      "Mouse and keyboard: `click` (with `count: 2` to double-click, `button: right` for a context " +
      "menu), `drag` for anything that follows a gesture — a slider, a reorder, a selection, a " +
      "canvas — and `scroll` to move content, aimed with an optional point or an app name. Typing " +
      'goes through `type` (add `strategy: "paste"` for long text or non-Latin scripts, which is ' +
      "faster and survives input methods) and `key` for shortcuts like `cmd+s`.\n\n" +
      "The clipboard is part of the desktop: `read_clipboard` gets what a person would have copied " +
      "— the text an app just produced, a path, a link — and `write_clipboard` puts text there for " +
      "an app that wants a paste. Prefer those to retyping a long string.\n\n" +
      "Anything irreversible — sending a message, confirming a purchase, deleting something, " +
      "quitting an app with unsaved work — is the user's decision. Describe it and wait. If a call " +
      "comes back saying a permission is missing, tell the user which one to grant and stop; do " +
      "not retry it.",
    parameters: Type.Object({
      action: Type.String({
        description:
          "status | request_access | list_apps | list_windows | displays | get_state | act | " +
          "open_app | click | drag | scroll | type | key | read_clipboard | write_clipboard | " +
          "screenshot",
      }),
      app: Type.Optional(
        Type.String({
          description:
            "get_state / open_app: which app, by the name the user would say or its bundle id.",
        }),
      ),
      pid: Type.Optional(
        Type.Number({ description: "get_state / open_app: target the app by process id." }),
      ),
      path: Type.Optional(
        Type.String({
          description: "open_app: a full .app path, for an app that is not running yet.",
        }),
      ),
      scope: Type.Optional(
        Type.String({
          description:
            "get_state: `focused` (default) reads the window in front; `all` reads every window " +
            "of the app — much larger, use it only to find something you were not told the " +
            "location of.",
        }),
      ),
      state_id: Type.Optional(
        Type.String({ description: "act: the `state_id` from the observation the ref came from." }),
      ),
      ref: Type.Optional(
        Type.Number({
          description: "act: the element to act on, as numbered by that observation.",
        }),
      ),
      element_action: Type.Optional(
        Type.String({
          description: "act: press (default) | focus | raise | set_value.",
        }),
      ),
      value: Type.Optional(
        Type.String({
          description:
            "act with set_value: the text to write. This writes the control's value directly, " +
            "so unlike `type` it does not need the field to be focused.",
        }),
      ),
      x: Type.Optional(
        Type.Number({ description: "click: x, in pixels of your latest screenshot." }),
      ),
      y: Type.Optional(
        Type.Number({ description: "click: y, in pixels of your latest screenshot." }),
      ),
      button: Type.Optional(
        Type.String({ description: "click: left (default) | right | middle." }),
      ),
      count: Type.Optional(
        Type.Number({ description: "click: how many clicks, for example 2 to double-click." }),
      ),
      text: Type.Optional(Type.String({ description: "type: the text to insert." })),
      key: Type.Optional(
        Type.String({ description: "key: one key or chord, for example `Enter` or `cmd+a`." }),
      ),
      full_screen: Type.Optional(
        Type.Boolean({
          description:
            "screenshot: capture the whole display instead of the target app's front window.",
        }),
      ),
      window_id: Type.Optional(
        Type.Number({
          description:
            "screenshot: capture this window (an id from list_windows) instead of the app's " +
            "front window — use it for a background window, a sheet, or a popover.",
        }),
      ),
      include_all_layers: Type.Optional(
        Type.Boolean({
          description:
            "list_windows: include panels, menus and overlays, which are not ordinary windows " +
            "and are left out by default.",
        }),
      ),
      direction: Type.Optional(
        Type.String({
          description:
            "scroll: up | down | left | right — which way to look through the content, so `down` " +
            "reveals what is further down.",
        }),
      ),
      amount: Type.Optional(
        Type.Number({
          description:
            "scroll: how far. Defaults to 3 lines, or 240 pixels when `unit` is `pixel`. A long " +
            "list usually needs several scrolls with a look in between.",
        }),
      ),
      unit: Type.Optional(
        Type.String({
          description:
            "scroll: line (default, one wheel tick per line, which is what apps expect) or pixel.",
        }),
      ),
      from_x: Type.Optional(
        Type.Number({
          description: "drag: where the pointer goes down, in your latest screenshot's pixels.",
        }),
      ),
      from_y: Type.Optional(Type.Number({ description: "drag: see `from_x`." })),
      to_x: Type.Optional(
        Type.Number({ description: "drag: where the pointer comes up, in the same pixels." }),
      ),
      to_y: Type.Optional(Type.Number({ description: "drag: see `to_x`." })),
      duration_ms: Type.Optional(
        Type.Number({
          description:
            "drag: how long the gesture takes (default 400). A drag that is too quick reads as a " +
            "click to most apps.",
        }),
      ),
      modifiers: Type.Optional(
        Type.String({
          description: "drag: hold these during the gesture, for example `cmd` or `shift`.",
        }),
      ),
      strategy: Type.Optional(
        Type.String({
          description:
            "type: keys (default) types each character as a key event; paste puts the text on " +
            "the clipboard and presses ⌘V, then puts the clipboard back. Paste is the better " +
            "choice for long text, for CJK, and for anything an input method would reinterpret.",
        }),
      ),
    }),
    execute: async (_toolCallId, params: ComputerToolParams) => {
      if (!ctx.onComputer) {
        return errorResult("Computer control is not available in this session.");
      }
      const invalid = computerArgsError(params);
      if (invalid) return errorResult(invalid);
      // A screenshot only helps a model that can receive images, and sending one to a
      // text-only provider is rejected outright. Say so rather than burning the call.
      if (params.action === "screenshot" && ctx.vision !== true) {
        return errorResult(
          "This model cannot receive images, so a screenshot would not help. Read the app with " +
            "`get_state` instead — the accessibility tree is text, and `act` can drive it.",
        );
      }
      return ctx.onComputer(params);
    },
  };
}
