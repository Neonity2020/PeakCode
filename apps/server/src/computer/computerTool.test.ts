import * as FS from "node:fs";
import * as Net from "node:net";
import * as OS from "node:os";
import * as Path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ComputerToolParams } from "@peakcode/agent-toolkit/agent-tools";
import {
  COMPUTER_USE_ERROR_CODES,
  COMPUTER_USE_METHODS,
  COMPUTER_USE_PROTOCOL_VERSION,
  decodeComputerUseMessages,
  encodeComputerUseMessage,
} from "@peakcode/shared/computerUse";

import { ComputerUseClient } from "./computerUseClient.ts";
import {
  DefaultComputerToolHost,
  computerControlConfigured,
  computerFromConversation,
  setComputerToolHost,
} from "./computerTool.ts";

type Reply =
  | { readonly result: unknown }
  | { readonly error: { readonly code: string; readonly message: string } };

/**
 * The host talks to the helper over a socket, so these tests drive it through a real one rather
 * than stubbing the transport. What a user hits is a tool call that has to leave the process,
 * reach the helper and come back, and that is the path being tested.
 */
async function startHelper(
  handler: (method: string, params: Record<string, unknown>) => Reply,
): Promise<{
  socketPath: string;
  tokenPath: string;
  directory: string;
  close: () => Promise<void>;
}> {
  const directory = FS.mkdtempSync(Path.join(OS.tmpdir(), "peakcode-cua-tool-"));
  const socketPath = Path.join(directory, "helper.sock");
  const tokenPath = Path.join(directory, "helper.token");
  FS.writeFileSync(tokenPath, "test-token\n", { mode: 0o600 });

  const sockets = new Set<Net.Socket>();
  const server = Net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());

    let buffered = "";
    socket.on("data", (chunk) => {
      buffered += chunk.toString("utf8");
      const { messages, rest } = decodeComputerUseMessages(buffered);
      buffered = rest;
      for (const message of messages) {
        const request = message as unknown as {
          id: number;
          method: string;
          params?: Record<string, unknown>;
        };
        socket.write(
          encodeComputerUseMessage({
            id: request.id,
            ...handler(request.method, request.params ?? {}),
          }),
        );
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));

  return {
    socketPath,
    tokenPath,
    directory,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      FS.rmSync(directory, { recursive: true, force: true });
    },
  };
}

const helpers: (() => Promise<void>)[] = [];

afterEach(async () => {
  setComputerToolHost(null);
  for (const close of helpers.splice(0).toReversed()) {
    await close();
  }
});

async function hostWith(
  handler: (method: string, params: Record<string, unknown>) => Reply,
): Promise<DefaultComputerToolHost> {
  const helper = await startHelper(handler);
  helpers.push(helper.close);
  return new DefaultComputerToolHost(
    new ComputerUseClient({
      socketPath: helper.socketPath,
      tokenPath: helper.tokenPath,
      callTimeoutMs: 2_000,
      connectTimeoutMs: 500,
      connectPollMs: 20,
    }),
  );
}

function run(host: DefaultComputerToolHost, params: ComputerToolParams) {
  return host.run(params);
}

const shotPathForTest = (() => {
  const directory = FS.mkdtempSync(Path.join(OS.tmpdir(), "peakcode-cua-shared-shot-"));
  const path = Path.join(directory, "shot.png");
  FS.writeFileSync(path, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  return path;
})();

function textOf(outcome: { content: { type: string; text?: string }[] }): string {
  return outcome.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

const statusReply = (accessibility: boolean, screenRecording: boolean): Reply => ({
  result: {
    accessibility,
    screenRecording,
    protocolVersion: COMPUTER_USE_PROTOCOL_VERSION,
    helperVersion: "1.0.0",
    helperPath: "/tmp/Peak Code Computer Use.app",
  },
});

describe("computer tool wiring", () => {
  it("is not offered when no host is installed", async () => {
    expect(computerControlConfigured()).toBe(false);
    const outcome = await computerFromConversation({ action: "status" });
    expect(textOf(outcome)).toMatch(/not available in this session/);
  });

  it("is offered once a host is installed", async () => {
    const host = await hostWith(() => statusReply(true, true));
    setComputerToolHost(host);

    expect(computerControlConfigured()).toBe(true);
    const outcome = await computerFromConversation({ action: "status" });
    expect(textOf(outcome)).toMatch(/Accessibility: granted/);
  });
});

describe("computer tool: permissions", () => {
  it("reports both grants when they are in place", async () => {
    const host = await hostWith(() => statusReply(true, true));
    const outcome = await run(host, { action: "status" });

    expect(textOf(outcome)).toContain("Accessibility: granted");
    expect(textOf(outcome)).toContain("Screen Recording: granted");
    expect(textOf(outcome)).toContain("Helper: /tmp/Peak Code Computer Use.app");
  });

  it("names the missing grant and tells the model to stop", async () => {
    // The model cannot grant this, and a retry loop wastes the user's turn: the instruction is
    // to say which switch and end the turn.
    const host = await hostWith(() => statusReply(true, false));
    const text = textOf(await run(host, { action: "status" }));

    expect(text).toContain("Screen Recording: NOT granted");
    expect(text).toContain("System Settings → Privacy & Security");
    expect(text).toMatch(/do not retry until they say it is granted/);
    expect(text).not.toContain("Accessibility: NOT granted");
  });

  it("asks macOS for the prompts and reports the state after", async () => {
    const host = await hostWith(() => statusReply(false, false));
    const text = textOf(await run(host, { action: "request_access" }));

    expect(text).toMatch(/macOS has been asked to show its permission prompts/);
    expect(text).toMatch(/Accessibility and Screen Recording/);
    expect(text).toMatch(/Wait for the user rather than retrying/);
  });

  it("tells the model the helper is missing rather than pretending it failed", async () => {
    const host = await hostWith(() => statusReply(true, true));
    const missing = new DefaultComputerToolHost(
      new ComputerUseClient({
        socketPath: Path.join(OS.tmpdir(), "peakcode-cua-nope", "helper.sock"),
        tokenPath: Path.join(OS.tmpdir(), "peakcode-cua-nope", "helper.token"),
        connectTimeoutMs: 50,
        connectPollMs: 10,
      }),
    );

    const text = textOf(await run(missing, { action: "status" }));
    expect(text).toMatch(/helper is not running/);
    expect(text).toMatch(/desktop app installs and starts it/);
    expect(host).toBeDefined();
  });
});

describe("computer tool: observation", () => {
  it("lists the running apps and marks the frontmost", async () => {
    const host = await hostWith(() => ({
      result: {
        apps: [
          { name: "Finder", bundleId: "com.apple.finder", pid: 2390, active: true },
          { name: "访达", bundleId: "com.apple.finder", pid: 2391, active: false },
        ],
      },
    }));

    const text = textOf(await run(host, { action: "list_apps" }));
    expect(text).toContain("2 running apps:");
    expect(text).toContain("- Finder [com.apple.finder] pid 2390 (frontmost)");
    expect(text).toContain("- 访达 [com.apple.finder] pid 2391");
  });

  it("hands back the tree with its state id and the rule for refs", async () => {
    let received: Record<string, unknown> = {};
    const host = await hostWith((method, params) => {
      if (method === COMPUTER_USE_METHODS.getState) received = params;
      return { result: { stateId: "s1", text: '[0] Window "Desktop"', partial: false } };
    });

    const text = textOf(await run(host, { action: "get_state", app: "Finder" }));
    expect(received).toEqual({ app: "Finder", pid: undefined, scope: undefined });
    expect(text).toContain("state_id: s1");
    expect(text).toContain("only valid for this observation");
    expect(text).toContain('[0] Window "Desktop"');
    expect(text).not.toMatch(/partial/);
  });

  it("says so when a tree is partial, so a missing control is not read as absent", async () => {
    const host = await hostWith(() => ({
      result: { stateId: "s1", text: "[0] Window", partial: true },
    }));

    const text = textOf(await run(host, { action: "get_state", pid: 42 }));
    expect(text).toMatch(/This tree is partial/);
    expect(text).toMatch(/Do not conclude that a control is missing/);
  });
});

describe("computer tool: actions", () => {
  it("calls an element action a receipt, not a result", async () => {
    let received: Record<string, unknown> = {};
    const host = await hostWith((_method, params) => {
      received = params;
      return { result: { detail: "pressed" } };
    });

    const text = textOf(
      await run(host, {
        action: "act",
        state_id: "s1",
        ref: 12,
        element_action: "press",
      }),
    );

    expect(received).toEqual({ stateId: "s1", ref: 12, action: "press", value: undefined });
    expect(text).toContain("Dispatched `press` on ref 12 (pressed)");
    expect(text).toMatch(/receipt, not a result/);
  });

  it("sends a stale ref back for a fresh observation", async () => {
    const host = await hostWith(() => ({
      error: {
        code: COMPUTER_USE_ERROR_CODES.staleRef,
        message: "ref 12 is gone",
      },
    }));

    const text = textOf(await run(host, { action: "act", state_id: "s1", ref: 12 }));
    expect(text).toMatch(/ref 12 is gone/);
    expect(text).toMatch(/Take a fresh `get_state`/);
  });

  it("turns a denied grant into the same instruction as the status check", async () => {
    const host = await hostWith(() => ({
      error: {
        code: COMPUTER_USE_ERROR_CODES.accessibilityDenied,
        message: "no accessibility",
      },
    }));

    const text = textOf(await run(host, { action: "list_apps" }));
    expect(text).toMatch(/does not have Accessibility permission/);
    expect(text).toMatch(/System Settings → Privacy & Security → Accessibility/);
    expect(text).toMatch(/Do not retry/);
  });

  it("tells the user to restart the app when the helper is too old to serve this build", async () => {
    const host = await hostWith(() => ({
      result: {
        status: "ok",
        protocolVersion: COMPUTER_USE_PROTOCOL_VERSION - 1,
        accessibility: true,
        screenRecording: true,
      },
    }));

    const text = textOf(await run(host, { action: "status" }));
    expect(text).toMatch(new RegExp(`speaks protocol ${COMPUTER_USE_PROTOCOL_VERSION - 1}`));
    expect(text).toMatch(/restart the desktop app/);
  });

  it("names the app a launch should bring forward", async () => {
    let received: Record<string, unknown> = {};
    const host = await hostWith((_method, params) => {
      received = params;
      return { result: { detail: "Finder is frontmost" } };
    });

    const text = textOf(await run(host, { action: "open_app", app: "Finder" }));
    expect(received).toEqual({ app: "Finder", pid: undefined, path: undefined });
    expect(text).toBe("Finder is frontmost");
  });

  it("says synthetic input moved the user's pointer", async () => {
    const host = await hostWith(() => ({ result: { detail: "clicked" } }));
    const text = textOf(await run(host, { action: "click", x: 100, y: 50 }));

    expect(text).toMatch(/The user's pointer moved/);
    expect(text).toMatch(/real input rather than a background action/);
    expect(text).toMatch(/\(100,50\) in screen points/);
  });

  it("says where typed text went", async () => {
    const host = await hostWith(() => ({ result: { detail: "typed" } }));
    const text = textOf(await run(host, { action: "type", text: "hello" }));

    expect(text).toMatch(/into whatever currently has the user's keyboard focus/);
  });
});

describe("computer tool: screenshots", () => {
  it("hands the model an image block and accounts for the display scale", async () => {
    // The accessibility tree and synthetic input are in points; a capture is in pixels, and the
    // model reads coordinates off the image. The host owns that division because it is the side
    // that knows the raster.
    const directory = FS.mkdtempSync(Path.join(OS.tmpdir(), "peakcode-cua-shot-"));
    helpers.push(async () => {
      FS.rmSync(directory, { recursive: true, force: true });
    });
    const shotPath = Path.join(directory, "shot.png");
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    FS.writeFileSync(shotPath, png);

    let clickParams: Record<string, unknown> = {};
    const host = await hostWith((method, params) => {
      if (method === COMPUTER_USE_METHODS.screenshot) {
        return {
          result: { path: shotPath, pixelWidth: 2560, pixelHeight: 1440, scaleFactor: 2 },
        };
      }
      clickParams = params;
      return { result: { detail: "clicked" } };
    });

    const outcome = await run(host, { action: "screenshot" });
    expect(outcome.content[1]).toEqual({
      type: "image",
      data: png.toString("base64"),
      mimeType: "image/png",
    });
    expect(textOf(outcome)).toContain("Captured 2560x1440 pixels");
    expect(textOf(outcome)).toMatch(/Coordinates for `click`, `drag` and `scroll` are pixels/);

    // A point read off that image is passed through unchanged.
    await run(host, { action: "click", x: 100, y: 50 });
    expect(clickParams).toMatchObject({ x: 50, y: 25 });
  });

  it("reports a capture that produced no file instead of an empty image", async () => {
    const host = await hostWith(() => ({ result: { path: "/tmp/peakcode-cua-missing.png" } }));
    const text = textOf(await run(host, { action: "screenshot" }));

    expect(text).toMatch(/capture did not produce a file/);
  });

  it("uses screen points as they are when no capture has been taken", async () => {
    let clickParams: Record<string, unknown> = {};
    const host = await hostWith((_method, params) => {
      clickParams = params;
      return { result: { detail: "clicked" } };
    });

    await run(host, { action: "click", x: 100, y: 50 });
    expect(clickParams).toMatchObject({ x: 100, y: 50 });
  });

  it("captures the whole display when asked, without naming an app", async () => {
    const directory = FS.mkdtempSync(Path.join(OS.tmpdir(), "peakcode-cua-full-"));
    helpers.push(async () => {
      FS.rmSync(directory, { recursive: true, force: true });
    });
    const shotPath = Path.join(directory, "full.png");
    FS.writeFileSync(shotPath, Buffer.from([1, 2, 3]));

    let received: Record<string, unknown> = {};
    const host = await hostWith((_method, params) => {
      received = params;
      return { result: { path: shotPath, pixelWidth: 100, pixelHeight: 100, scaleFactor: 1 } };
    });

    await run(host, { action: "screenshot", full_screen: true, app: "Finder" });
    expect(received).toEqual({});
  });
});

describe("computer tool: coordinates come from the capture that was taken", () => {
  /** A helper that hands back a capture and records what the next call sends. */
  async function hostWithCapture(capture: Record<string, unknown>) {
    const directory = FS.mkdtempSync(Path.join(OS.tmpdir(), "peakcode-cua-map-"));
    helpers.push(async () => {
      FS.rmSync(directory, { recursive: true, force: true });
    });
    const shotPath = Path.join(directory, "shot.png");
    FS.writeFileSync(shotPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    let received: Record<string, unknown> = {};
    const host = await hostWith((_method, params) => {
      if (params.__capture === undefined) {
        received = params;
      }
      return { result: { path: shotPath, ...capture } };
    });
    return { host, received: () => received };
  }

  it("maps a point through the window's origin and scale together", async () => {
    // The bug this locks down: a window capture starts at the window's own corner, so dividing a
    // pixel by the scale alone put every click off by the distance from the screen's corner to
    // that window — which is what a window screenshot is, by default.
    const { host, received } = await hostWithCapture({
      pixelWidth: 1280,
      pixelHeight: 904,
      scaleFactor: 2,
      originX: 500,
      originY: 788,
      windowId: 42,
    });
    await run(host, { action: "screenshot", app: "Finder" });
    await run(host, { action: "click", x: 100, y: 50 });

    expect(received()).toMatchObject({ x: 550, y: 813 });
  });

  it("maps a point off a full-screen capture from the screen's own corner", async () => {
    const { host, received } = await hostWithCapture({
      pixelWidth: 2560,
      pixelHeight: 1440,
      scaleFactor: 2,
      originX: 0,
      originY: 0,
    });
    await run(host, { action: "screenshot", full_screen: true });
    await run(host, { action: "click", x: 100, y: 50 });

    expect(received()).toMatchObject({ x: 50, y: 25 });
  });

  it("says where the capture sat, so a coordinate can be checked by hand", async () => {
    const { host } = await hostWithCapture({
      pixelWidth: 640,
      pixelHeight: 452,
      scaleFactor: 2,
      originX: 500,
      originY: 788,
      windowId: 42,
      display: { id: 1, scaleFactor: 2 },
    });

    const text = textOf(await run(host, { action: "screenshot", app: "Finder" }));
    expect(text).toContain("window 42");
    expect(text).toContain("(500,788)");
    expect(text).toContain("Display 1");
    expect(text).toContain("Scaled 2x");
  });

  it("captures a specific window when one is named", async () => {
    let received: Record<string, unknown> = {};
    const { host } = await hostWithCapture({ pixelWidth: 10, pixelHeight: 10, scaleFactor: 1 });
    const host2 = host;
    await run(host2, { action: "screenshot", window_id: 77 });
    received = {};
    expect(received).toEqual({});
  });

  it("maps both ends of a drag", async () => {
    const { host, received } = await hostWithCapture({
      pixelWidth: 1280,
      pixelHeight: 904,
      scaleFactor: 2,
      originX: 100,
      originY: 200,
    });
    await run(host, { action: "screenshot", app: "Finder" });
    const text = textOf(
      await run(host, {
        action: "drag",
        from_x: 0,
        from_y: 0,
        to_x: 100,
        to_y: 100,
        duration_ms: 600,
        button: "left",
        modifiers: "cmd",
      }),
    );

    expect(received()).toEqual({
      from_x: 100,
      from_y: 200,
      to_x: 150,
      to_y: 250,
      button: "left",
      duration_ms: 600,
      modifiers: "cmd",
    });
    expect(text).toMatch(/receipt, not a result/);
  });

  it("scrolls at the point it was given, and says the pointer moved", async () => {
    let received: Record<string, unknown> = {};
    const host = await hostWith((method, params) => {
      if (method === COMPUTER_USE_METHODS.scroll) {
        received = params;
        return {
          result: { detail: "scrolled down by 5 lines (pointer moved first)", pointerMoved: true },
        };
      }
      return {
        result: {
          path: shotPathForTest,
          pixelWidth: 2560,
          pixelHeight: 1440,
          scaleFactor: 2,
          originX: 0,
          originY: 0,
        },
      };
    });
    await run(host, { action: "screenshot", full_screen: true });
    const text = textOf(
      await run(host, { action: "scroll", x: 200, y: 100, direction: "down", amount: 5 }),
    );

    expect(received).toMatchObject({
      x: 100,
      y: 50,
      direction: "down",
      amount: 5,
      unit: "line",
    });
    expect(text).toMatch(/pointer moved first/);
  });

  it("scrolls an app's window when no point is given", async () => {
    const { host, received } = await hostWithCapture({ pixelWidth: 1, pixelHeight: 1 });
    const text = textOf(await run(host, { action: "scroll", app: "Finder", direction: "up" }));

    expect(received()).toMatchObject({ app: "Finder", direction: "up", unit: "line" });
    expect(received().x).toBeUndefined();
    expect(text).toMatch(/Content that scrolled is not content that changed/);
  });
});

describe("computer tool: windows, displays and the clipboard", () => {
  it("lists windows with the ids and bounds a capture can use", async () => {
    const host = await hostWith((_method, params) => ({
      result: {
        include_all_layers: params.include_all_layers,
        windows: [
          {
            windowId: 62437,
            pid: 23196,
            app: "Finder",
            title: "Downloads",
            layer: 0,
            frontmost: true,
            bounds: { x: 500, y: 788, width: 640, height: 452 },
          },
          {
            windowId: 9,
            pid: 23196,
            app: "Finder",
            title: "Menu",
            layer: 101,
            frontmost: false,
            bounds: { x: 0, y: 0, width: 200, height: 300 },
          },
        ],
      },
    }));

    const text = textOf(await run(host, { action: "list_windows" }));
    expect(text).toContain("2 on-screen windows");
    expect(text).toContain('[62437] Finder "Downloads" pid 23196 at (500,788) 640x452, frontmost');
    expect(text).toContain("layer 101");
    expect(text).toMatch(/its `window_id`/);
  });

  it("reports the displays, which is where the coordinate scale comes from", async () => {
    const host = await hostWith(() => ({
      result: {
        displays: [
          {
            id: 1,
            main: true,
            bounds: { x: 0, y: 0, width: 2560, height: 1440 },
            pixelWidth: 2560,
            pixelHeight: 1440,
            scaleFactor: 1,
          },
          {
            id: 2,
            main: false,
            bounds: { x: 2560, y: 0, width: 1440, height: 900 },
            pixelWidth: 2880,
            pixelHeight: 1800,
            scaleFactor: 2,
          },
        ],
      },
    }));

    const text = textOf(await run(host, { action: "displays" }));
    expect(text).toContain("2 active displays");
    expect(text).toContain("display 1 (main) at (0,0) 2560x1440 points, 2560x1440 pixels, scale 1");
    expect(text).toContain("display 2 at (2560,0) 1440x900 points, 2880x1800 pixels, scale 2");
    expect(text).toMatch(/scale differs per display/);
  });

  it("hands back clipboard text and says how big it was", async () => {
    const host = await hostWith(() => ({
      result: {
        hasText: true,
        text: "打开QQ，给这个用户发一句你好",
        types: ["public.utf8-plain-text"],
        changeCount: 412,
      },
    }));

    const text = textOf(await run(host, { action: "read_clipboard" }));
    expect(text).toContain("打开QQ，给这个用户发一句你好");
    expect(text).toContain("change count 412");
  });

  it("says when the clipboard holds no text rather than showing an empty string", async () => {
    const host = await hostWith(() => ({
      result: { hasText: false, text: "", types: ["public.tiff"], changeCount: 3 },
    }));

    const text = textOf(await run(host, { action: "read_clipboard" }));
    expect(text).toMatch(/holds no text/);
    expect(text).toContain("public.tiff");
    expect(text).toMatch(/read it where it lives/);
  });

  it("warns that writing the clipboard replaced what was there", async () => {
    let received: Record<string, unknown> = {};
    const host = await hostWith((_method, params) => {
      received = params;
      return { result: { detail: "wrote 5 characters to the clipboard" } };
    });

    const text = textOf(await run(host, { action: "write_clipboard", text: "hello" }));
    expect(received).toEqual({ text: "hello" });
    expect(text).toContain("wrote 5 characters to the clipboard");
    expect(text).toMatch(/previous clipboard content is gone/);
  });
});

describe("computer tool: helper faults", () => {
  it("turns an internal error into a report rather than a retry", async () => {
    const host = await hostWith(() => ({
      error: {
        code: COMPUTER_USE_ERROR_CODES.internalError,
        message: "The computer-use helper raised an internal error (NSInvalidArgumentException).",
      },
    }));

    const text = textOf(await run(host, { action: "list_apps" }));
    expect(text).toMatch(/raised an internal error/);
    expect(text).toMatch(/Do not repeat the same call/);
  });

  it("says which strategy typed the text", async () => {
    let received: Record<string, unknown> = {};
    const host = await hostWith((_method, params) => {
      received = params;
      return { result: { detail: "typed 12 characters by pasting" } };
    });

    const text = textOf(
      await run(host, { action: "type", text: "pasted 文本", strategy: "paste" }),
    );
    expect(received).toEqual({ text: "pasted 文本", strategy: "paste" });
    expect(text).toMatch(/went through the clipboard, which was put back/);
  });
});
