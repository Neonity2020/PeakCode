import { describe, expect, it } from "vitest";

import type { BrowserUseTabInfo } from "@peakcode/shared/browserUsePipe";

import { BrowserSession, BrowserToolError, type BrowserSessionPort } from "./browserSession.ts";

interface CdpCall {
  method: string;
  params: Record<string, unknown>;
  target?: { tabId: number };
}

const tab = (id: number, url: string, active = false): BrowserUseTabInfo => ({
  id,
  title: `tab ${id}`,
  active,
  url,
});

/**
 * A recording stand-in for the pipe client.
 *
 * CDP replies are supplied per method so a test can describe the page it wants to be looking
 * at, and every call is kept so the assertions can be about the exact command sequence —
 * which is the part of this layer worth pinning down.
 */
function fakePort(
  options: {
    tabs?: BrowserUseTabInfo[];
    replies?: Record<string, unknown>;
    evaluate?: (expression: string) => unknown;
  } = {},
) {
  const calls: CdpCall[] = [];
  const lifecycle: string[] = [];
  let tabs = options.tabs ?? [tab(1, "https://example.com", true)];
  let nextTabId = 100;

  const port: BrowserSessionPort = {
    async getTabs() {
      lifecycle.push("getTabs");
      return tabs;
    },
    async createTab() {
      lifecycle.push("createTab");
      const created = tab(nextTabId++, "about:blank");
      tabs = [...tabs, created];
      return created;
    },
    async closeTab(_sessionId, tabId) {
      lifecycle.push(`closeTab:${tabId}`);
      tabs = tabs.filter((candidate) => candidate.id !== tabId);
    },
    async attach(_sessionId, tabId) {
      lifecycle.push(`attach:${tabId}`);
    },
    async executeCdp(_sessionId, method, params = {}, target) {
      calls.push({ method, params, ...(target === undefined ? {} : { target }) });
      if (method === "Runtime.evaluate" && options.evaluate) {
        return { result: { value: options.evaluate(String(params.expression)) } };
      }
      return options.replies?.[method] ?? {};
    },
  };

  return { port, calls, lifecycle, setTabs: (next: BrowserUseTabInfo[]) => (tabs = next) };
}

const session = (port: BrowserSessionPort) =>
  // Waiting paths run against fake timing so the tests do not spend the real budget.
  new BrowserSession(port, "thread-1", { navigationTimeoutMs: 0, pollIntervalMs: 0 });

const methodsOf = (calls: CdpCall[]) => calls.map((call) => call.method);

const AX_REPLY = {
  nodes: [
    {
      nodeId: "1",
      ignored: false,
      role: { value: "RootWebArea" },
      name: { value: "Example" },
      childIds: ["2", "3"],
    },
    {
      nodeId: "2",
      ignored: false,
      role: { value: "textbox" },
      name: { value: "Email" },
      backendDOMNodeId: 11,
    },
    {
      nodeId: "3",
      ignored: false,
      role: { value: "button" },
      name: { value: "Sign in" },
      backendDOMNodeId: 12,
    },
  ],
};

describe("target selection", () => {
  it("adopts the active tab of a conversation that has not picked one", async () => {
    const { port, lifecycle } = fakePort({
      tabs: [tab(1, "https://a.test"), tab(2, "https://b.test", true)],
    });
    const browser = session(port);

    await browser.snapshot();

    expect(lifecycle).toEqual(["getTabs", "attach:2"]);
    expect(browser.currentTabId).toBe(2);
  });

  it("creates a tab when the conversation has none, which is what opens the pane", async () => {
    const { port, lifecycle } = fakePort({ tabs: [] });
    const browser = session(port);

    await browser.snapshot();

    expect(lifecycle).toEqual(["getTabs", "createTab", "attach:100"]);
  });

  it("picks a tab once and reuses it", async () => {
    const { port, lifecycle } = fakePort();
    const browser = session(port);

    await browser.snapshot();
    await browser.snapshot();

    expect(lifecycle).toEqual(["getTabs", "attach:1"]);
  });

  it("forgets the tab it was driving when that tab closes", async () => {
    const { port, lifecycle } = fakePort();
    const browser = session(port);

    await browser.snapshot();
    await browser.closeTab(1);

    expect(lifecycle).toEqual(["getTabs", "attach:1", "closeTab:1"]);
    expect(browser.currentTabId).toBeNull();
  });

  it("opens a new tab and navigates it in one step", async () => {
    const { port, calls } = fakePort({
      replies: { Runtime: {}, "Page.navigate": { frameId: "F" } },
      evaluate: (expression) =>
        expression === "document.readyState" ? "complete" : "https://example.com/next",
    });
    const browser = session(port);

    const result = await browser.newTab("https://example.com/next");

    expect(result.tab.id).toBe(100);
    expect(result.navigation?.url).toBe("https://example.com/next");
    expect(methodsOf(calls)).toContain("Page.navigate");
  });
});

describe("snapshot", () => {
  it("enables accessibility once and returns refs the actions can use", async () => {
    const { port, calls } = fakePort({ replies: { "Accessibility.getFullAXTree": AX_REPLY } });
    const browser = session(port);

    const first = await browser.snapshot();
    await browser.snapshot();

    expect(first.refs).toBe(2);
    expect(first.text).toBe(
      ['RootWebArea "Example"', '  [e1] textbox "Email" value=""', '  [e2] button "Sign in"'].join(
        "\n",
      ),
    );
    expect(methodsOf(calls).filter((method) => method === "Accessibility.enable")).toHaveLength(1);
  });

  it("says so plainly when the page exposes nothing", async () => {
    const { port } = fakePort({ replies: { "Accessibility.getFullAXTree": { nodes: [] } } });
    const browser = session(port);

    expect((await browser.snapshot()).text).toMatch(/no accessibility nodes/);
  });

  it("reports how much the cap dropped", async () => {
    const { port } = fakePort({ replies: { "Accessibility.getFullAXTree": AX_REPLY } });
    const browser = session(port);

    expect((await browser.snapshot(1)).text).toMatch(/2 more element\(s\) omitted/);
  });

  it("attributes every CDP call to the conversation's own tab", async () => {
    const { port, calls } = fakePort({ replies: { "Accessibility.getFullAXTree": AX_REPLY } });
    await session(port).snapshot();

    expect(calls.every((call) => call.target?.tabId === 1)).toBe(true);
  });
});

describe("stale refs", () => {
  const setup = async () => {
    const { port, calls } = fakePort({ replies: { "Accessibility.getFullAXTree": AX_REPLY } });
    const browser = session(port);
    await browser.snapshot();
    return { browser, calls };
  };

  it("refuses a ref when no snapshot has been taken", async () => {
    const { port } = fakePort({ replies: { "Accessibility.getFullAXTree": AX_REPLY } });
    const browser = session(port);

    await expect(browser.click({ ref: "e1" })).rejects.toThrow(/Call snapshot first/);
  });

  it("refuses a ref from before the latest snapshot and says what to do", async () => {
    const { browser, calls } = await setup();
    // A second snapshot renumbers from e1, so a handle the model remembered goes stale.
    await browser.snapshot();
    const before = calls.length;

    await expect(browser.click({ ref: "e9" })).rejects.toThrow(/Call snapshot again/);
    // The refusal happens before anything is dispatched.
    expect(calls.length).toBe(before);
  });

  it("refuses refs after a navigation, since they described the previous document", async () => {
    const { browser } = await setup();
    await browser.navigate("https://elsewhere.test");

    await expect(browser.press({ ref: "e1", key: "Enter" })).rejects.toThrow(/Call snapshot again/);
  });
});

describe("click", () => {
  it("scrolls the element into view and clicks the centre of its box", async () => {
    const { port, calls } = fakePort({
      replies: {
        "Accessibility.getFullAXTree": AX_REPLY,
        "DOM.getContentQuads": { quads: [[10, 20, 110, 20, 110, 60, 10, 60]] },
      },
    });
    const browser = session(port);
    await browser.snapshot();
    calls.length = 0;

    await browser.click({ ref: "e2" });

    expect(methodsOf(calls)).toEqual([
      "DOM.enable",
      "DOM.scrollIntoViewIfNeeded",
      "DOM.getContentQuads",
      "Input.dispatchMouseEvent",
      "Input.dispatchMouseEvent",
    ]);
    const press = calls[3]!;
    expect(press.params).toMatchObject({
      type: "mousePressed",
      x: 60,
      y: 40,
      button: "left",
      clickCount: 1,
    });
    expect(calls[4]!.params).toMatchObject({ type: "mouseReleased", x: 60, y: 40 });
  });

  it("resolves the ref against the element it names, not a remembered position", async () => {
    const { port, calls } = fakePort({
      replies: {
        "Accessibility.getFullAXTree": AX_REPLY,
        "DOM.getContentQuads": { quads: [[0, 0, 10, 0, 10, 10, 0, 10]] },
      },
    });
    const browser = session(port);
    await browser.snapshot();
    calls.length = 0;

    await browser.click({ ref: "e2" });

    // The button is backend node 12; the textbox was 11.
    expect(calls.find((call) => call.method === "DOM.getContentQuads")?.params).toEqual({
      backendNodeId: 12,
    });
  });

  it("honours the button, double-click and modifiers", async () => {
    const { port, calls } = fakePort({
      replies: {
        "Accessibility.getFullAXTree": AX_REPLY,
        "DOM.getContentQuads": { quads: [[0, 0, 10, 0, 10, 10, 0, 10]] },
      },
    });
    const browser = session(port);
    await browser.snapshot();
    calls.length = 0;

    await browser.click({ ref: "e1", button: "right", double: true, modifiers: ["shift"] });

    expect(calls[3]!.params).toMatchObject({
      button: "right",
      buttons: 2,
      clickCount: 2,
      modifiers: 8,
    });
  });

  it("clicks an explicit point without touching the DOM domain", async () => {
    const { port, calls } = fakePort({ replies: { "Accessibility.getFullAXTree": AX_REPLY } });
    const browser = session(port);
    await browser.snapshot();
    calls.length = 0;

    await browser.click({ x: 5, y: 6 });

    expect(methodsOf(calls)).toEqual(["Input.dispatchMouseEvent", "Input.dispatchMouseEvent"]);
    expect(calls[0]!.params).toMatchObject({ x: 5, y: 6 });
  });

  it("refuses an element with no layout box instead of clicking (0,0)", async () => {
    const { port } = fakePort({
      replies: { "Accessibility.getFullAXTree": AX_REPLY, "DOM.getContentQuads": { quads: [] } },
    });
    const browser = session(port);
    await browser.snapshot();

    await expect(browser.click({ ref: "e1" })).rejects.toThrow(/no layout box/);
  });

  it("refuses a click with neither a ref nor a point", async () => {
    const { port } = fakePort({ replies: { "Accessibility.getFullAXTree": AX_REPLY } });
    const browser = session(port);
    await browser.snapshot();

    await expect(browser.click({})).rejects.toBeInstanceOf(BrowserToolError);
  });
});

describe("keyboard and text", () => {
  const setup = async () =>
    session(fakePort({ replies: { "Accessibility.getFullAXTree": AX_REPLY } }).port);

  it("focuses the element before inserting text", async () => {
    const { port, calls } = fakePort({ replies: { "Accessibility.getFullAXTree": AX_REPLY } });
    const browser = session(port);
    await browser.snapshot();
    calls.length = 0;

    await browser.type({ ref: "e1", text: "a@b.c" });

    expect(methodsOf(calls)).toEqual(["DOM.enable", "DOM.focus", "Input.insertText"]);
    expect(calls[1]!.params).toEqual({ backendNodeId: 11 });
    expect(calls[2]!.params).toEqual({ text: "a@b.c" });
  });

  it("types into the focused element when given no ref", async () => {
    const { port, calls } = fakePort({ replies: { "Accessibility.getFullAXTree": AX_REPLY } });
    const browser = session(port);
    await browser.snapshot();
    calls.length = 0;

    await browser.type({ text: "hello" });

    expect(methodsOf(calls)).toEqual(["Input.insertText"]);
  });

  it("sends a printable key as text so the page sees real input", async () => {
    const { port, calls } = fakePort({ replies: { "Accessibility.getFullAXTree": AX_REPLY } });
    const browser = session(port);
    await browser.snapshot();
    calls.length = 0;

    await browser.press({ key: "a" });

    expect(methodsOf(calls)).toEqual(["Input.dispatchKeyEvent", "Input.dispatchKeyEvent"]);
    expect(calls[0]!.params).toMatchObject({ type: "keyDown", key: "a", text: "a" });
    expect(calls[1]!.params).toMatchObject({ type: "keyUp", key: "a" });
  });

  it("sends a named key without text, which would otherwise type a character", async () => {
    const { port, calls } = fakePort({ replies: { "Accessibility.getFullAXTree": AX_REPLY } });
    const browser = session(port);
    await browser.snapshot();
    calls.length = 0;

    await browser.press({ key: "Enter" });

    expect(calls[0]!.params).toMatchObject({
      type: "rawKeyDown",
      key: "Enter",
      windowsVirtualKeyCode: 13,
    });
    expect(calls[0]!.params).not.toHaveProperty("text");
  });

  it("carries chord modifiers on both halves of the keystroke", async () => {
    const { port, calls } = fakePort({ replies: { "Accessibility.getFullAXTree": AX_REPLY } });
    const browser = session(port);
    await browser.snapshot();
    calls.length = 0;

    await browser.press({ key: "cmd+a" });

    expect(calls[0]!.params).toMatchObject({ modifiers: 4, key: "a" });
    expect(calls[1]!.params).toMatchObject({ modifiers: 4 });
  });

  it("refuses a key it cannot encode rather than typing something else", async () => {
    const browser = await setup();
    await expect(browser.press({ key: "HyperKey" })).rejects.toThrow(/Cannot encode the key/);
  });

  it("selects an option in the page and reports what was chosen", async () => {
    const { port, calls } = fakePort({
      replies: {
        "Accessibility.getFullAXTree": AX_REPLY,
        "DOM.resolveNode": { object: { objectId: "obj-1" } },
        "Runtime.callFunctionOn": { result: { value: "Canada" } },
      },
    });
    const browser = session(port);
    await browser.snapshot();
    calls.length = 0;

    const chosen = await browser.selectOption({ ref: "e1", value: "CA" });

    expect(chosen).toBe("Canada");
    expect(methodsOf(calls)).toEqual(["DOM.enable", "DOM.resolveNode", "Runtime.callFunctionOn"]);
    expect(calls[2]!.params).toMatchObject({
      objectId: "obj-1",
      returnByValue: true,
      arguments: [{ value: "CA" }],
    });
  });

  it("says so when the option does not exist", async () => {
    const { port } = fakePort({
      replies: {
        "Accessibility.getFullAXTree": AX_REPLY,
        "DOM.resolveNode": { object: { objectId: "obj-1" } },
        "Runtime.callFunctionOn": { result: { value: null } },
      },
    });
    const browser = session(port);
    await browser.snapshot();

    expect(await browser.selectOption({ ref: "e1", value: "nope" })).toBeNull();
  });
});

describe("scroll", () => {
  it("scrolls from the element the ref names", async () => {
    const { port, calls } = fakePort({
      replies: {
        "Accessibility.getFullAXTree": AX_REPLY,
        "DOM.getContentQuads": { quads: [[0, 0, 20, 0, 20, 20, 0, 20]] },
      },
    });
    const browser = session(port);
    await browser.snapshot();
    calls.length = 0;

    await browser.scroll({ ref: "e1", deltaY: 300 });

    expect(calls.at(-1)!.params).toMatchObject({ type: "mouseWheel", x: 10, y: 10, deltaY: 300 });
  });

  it("scrolls the viewport centre when given no target", async () => {
    const { port, calls } = fakePort({
      replies: {
        "Accessibility.getFullAXTree": AX_REPLY,
        "Page.getLayoutMetrics": { cssLayoutViewport: { clientWidth: 800, clientHeight: 600 } },
      },
    });
    const browser = session(port);
    await browser.snapshot();
    calls.length = 0;

    await browser.scroll({ deltaY: 500 });

    expect(calls.at(-1)!.params).toMatchObject({ type: "mouseWheel", x: 400, y: 300, deltaY: 500 });
  });
});

describe("navigation", () => {
  it("navigates, waits for the document, and reports where it landed", async () => {
    const { port, calls } = fakePort({
      replies: { "Page.navigate": { frameId: "F" } },
      evaluate: (expression) => {
        if (expression === "document.readyState") return "complete";
        if (expression === "location.href") return "https://example.com/after";
        return null;
      },
    });
    const browser = session(port);

    const result = await browser.navigate("https://example.com/after");

    expect(result).toEqual({
      url: "https://example.com/after",
      readyState: "complete",
      timedOut: false,
    });
    expect(methodsOf(calls)).toContain("Page.navigate");
  });

  it("reports a page that never finishes loading instead of failing", async () => {
    const { port } = fakePort({
      replies: { "Page.navigate": { frameId: "F" } },
      evaluate: (expression) =>
        expression === "document.readyState" ? "loading" : "https://example.com/slow",
    });
    const browser = session(port);

    const result = await browser.navigate("https://example.com/slow");

    expect(result.timedOut).toBe(true);
    expect(result.readyState).toBe("loading");
    // The URL is still reported: "it loaded partially" is more useful than nothing.
    expect(result.url).toBe("https://example.com/slow");
  });

  it("surfaces a navigation the browser refused", async () => {
    const { port } = fakePort({
      replies: { "Page.navigate": { errorText: "net::ERR_NAME_NOT_RESOLVED" } },
    });
    const browser = session(port);

    await expect(browser.navigate("https://nope.invalid")).rejects.toThrow(/ERR_NAME_NOT_RESOLVED/);
  });

  it("walks history by index and explains when there is nowhere to go", async () => {
    const { port, calls } = fakePort({
      replies: {
        "Page.getNavigationHistory": {
          currentIndex: 0,
          entries: [{ id: 1, url: "https://example.com" }],
        },
      },
    });
    const browser = session(port);

    await expect(browser.goBack()).rejects.toThrow(/no previous page/);
    expect(methodsOf(calls)).not.toContain("Page.navigateToHistoryEntry");
  });

  it("moves forward through history when there is a next entry", async () => {
    const { port, calls } = fakePort({
      replies: {
        "Page.getNavigationHistory": {
          currentIndex: 0,
          entries: [
            { id: 1, url: "https://example.com" },
            { id: 2, url: "https://example.com/two" },
          ],
        },
      },
      evaluate: (expression) =>
        expression === "document.readyState" ? "complete" : "https://example.com/two",
    });
    const browser = session(port);

    await browser.goForward();

    expect(calls.find((call) => call.method === "Page.navigateToHistoryEntry")?.params).toEqual({
      entryId: 2,
    });
  });
});

describe("evaluate and wait_for", () => {
  it("returns the value of an expression", async () => {
    const { port } = fakePort({ evaluate: () => 42 });
    const browser = session(port);

    expect(await browser.evaluate("6*7")).toEqual({ value: 42 });
  });

  it("returns the page's own error text when the expression throws", async () => {
    const { port } = fakePort({
      replies: {
        "Runtime.evaluate": {
          exceptionDetails: {
            text: "Uncaught",
            exception: { description: "ReferenceError: nope is not defined" },
          },
        },
      },
    });
    const browser = session(port);

    const result = await browser.evaluate("nope()");

    expect(result.error).toMatch(/ReferenceError/);
  });

  it("stops waiting as soon as the condition holds", async () => {
    let calls = 0;
    const { port } = fakePort({
      evaluate: () => {
        calls += 1;
        return calls >= 2 ? "ready" : "";
      },
    });
    const browser = session(port);

    const result = await browser.waitFor("window.ready");

    expect(result.satisfied).toBe(true);
    expect(calls).toBe(2);
  });

  it("reports an unmet condition rather than pretending it passed", async () => {
    const { port } = fakePort({ evaluate: () => false });
    const browser = session(port);

    expect((await browser.waitFor("false", 0)).satisfied).toBe(false);
  });

  it("reports a condition that throws immediately instead of burning the timeout", async () => {
    const { port } = fakePort({
      replies: { "Runtime.evaluate": { exceptionDetails: { text: "Uncaught" } } },
    });
    const browser = session(port);

    await expect(browser.waitFor("nope()")).rejects.toThrow(/wait condition threw/);
  });
});

describe("screenshot", () => {
  it("returns image data with the matching media type", async () => {
    const { port, calls } = fakePort({ replies: { "Page.captureScreenshot": { data: "AAAA" } } });
    const browser = session(port);

    expect(await browser.screenshot()).toEqual({ data: "AAAA", mimeType: "image/jpeg" });
    expect(calls.at(-1)!.params).toMatchObject({ format: "jpeg" });
  });

  it("asks for the area beyond the viewport for a full-page capture", async () => {
    const { port, calls } = fakePort({ replies: { "Page.captureScreenshot": { data: "AAAA" } } });
    const browser = session(port);

    await browser.screenshot(true);

    expect(calls.at(-1)!.params).toMatchObject({ captureBeyondViewport: true });
  });

  it("refuses an empty image instead of attaching nothing", async () => {
    const { port } = fakePort({ replies: { "Page.captureScreenshot": {} } });
    const browser = session(port);

    await expect(browser.screenshot()).rejects.toThrow(/empty screenshot/);
  });
});
