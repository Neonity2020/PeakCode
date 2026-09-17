/**
 * One conversation's browser session: which tab it drives, what its last snapshot called
 * each element, and the verbs the tool exposes.
 *
 * The ref bookkeeping is the reason this is a class rather than a bag of functions. A ref
 * only means something relative to the snapshot that produced it, so the session has to
 * remember which snapshot is current and refuse handles from any other — that refusal is
 * what stops an action from landing on whatever element now happens to own a recycled node
 * id.
 *
 * All CDP traffic goes through {@link BrowserSessionPort}, which the pipe client implements
 * and tests fake. Nothing here knows about sockets.
 */
import {
  DEFAULT_MAX_ELEMENTS,
  clickPointFromQuads,
  encodeChord,
  modifierBits,
  mouseButton,
  renderAxTree,
  type AxNode,
} from "./browserCdp.ts";
import type { BrowserUseTabInfo } from "@peakcode/shared/browserUsePipe";

/**
 * The port this session drives.
 *
 * Deliberately narrower than the pipe client: tab lifecycle is a pipe method, everything
 * else is CDP, and keeping them apart is what lets a test assert exact command sequences.
 */
export interface BrowserSessionPort {
  getTabs(sessionId: string): Promise<BrowserUseTabInfo[]>;
  createTab(sessionId: string): Promise<BrowserUseTabInfo>;
  closeTab(sessionId: string, tabId: number): Promise<void>;
  attach(sessionId: string, tabId: number): Promise<void>;
  executeCdp(
    sessionId: string,
    method: string,
    params?: Record<string, unknown>,
    target?: { tabId: number },
  ): Promise<unknown>;
}

/**
 * A failure worth showing the model verbatim.
 *
 * The distinction matters: this class's errors are written as instructions ("take a new
 * snapshot"), while anything thrown by the transport is a bug or an outage and should keep
 * its raw text so a human can read it in the log.
 */
export class BrowserToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrowserToolError";
  }
}

/** How long a navigation or history move may take before we report what the page reached. */
const NAVIGATION_TIMEOUT_MS = 15_000;
const DEFAULT_WAIT_FOR_TIMEOUT_MS = 10_000;
const MAX_WAIT_FOR_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 150;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Timing knobs.
 *
 * Exposed so tests can exercise the waiting paths without spending the real budget; the
 * defaults are what production uses.
 */
export interface BrowserSessionOptions {
  navigationTimeoutMs?: number;
  pollIntervalMs?: number;
}

export interface NavigationResult {
  url: string;
  readyState: string;
  /** True when the wait expired before the page finished loading. */
  timedOut: boolean;
}

export interface ClickInput {
  ref?: string;
  x?: number;
  y?: number;
  button?: string;
  double?: boolean;
  modifiers?: string[];
}

export interface ScrollInput {
  ref?: string;
  x?: number;
  y?: number;
  deltaX?: number;
  deltaY?: number;
}

export class BrowserSession {
  /** The tab this conversation drives; `null` until something picks one. */
  private targetTabId: number | null = null;
  /** Refs from the most recent snapshot, and nothing else. */
  private refs = new Map<string, number>();
  private snapshotTaken = false;
  private accessibilityEnabled = false;
  private domEnabled = false;
  private readonly navigationTimeoutMs: number;
  private readonly pollIntervalMs: number;

  constructor(
    private readonly port: BrowserSessionPort,
    readonly sessionId: string,
    options: BrowserSessionOptions = {},
  ) {
    this.navigationTimeoutMs = options.navigationTimeoutMs ?? NAVIGATION_TIMEOUT_MS;
    this.pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;
  }

  /** The tab id currently being driven, for receipts and error messages. */
  get currentTabId(): number | null {
    return this.targetTabId;
  }

  // ---------------------------------------------------------------- tabs

  async listTabs(): Promise<BrowserUseTabInfo[]> {
    return this.port.getTabs(this.sessionId);
  }

  async selectTab(tabId: number): Promise<void> {
    await this.port.attach(this.sessionId, tabId);
    this.bindTab(tabId);
  }

  async newTab(url?: string): Promise<{ tab: BrowserUseTabInfo; navigation?: NavigationResult }> {
    const tab = await this.port.createTab(this.sessionId);
    await this.port.attach(this.sessionId, tab.id);
    this.bindTab(tab.id);
    if (url === undefined || url.length === 0) return { tab };
    return { tab, navigation: await this.navigate(url) };
  }

  async closeTab(tabId: number): Promise<void> {
    await this.port.closeTab(this.sessionId, tabId);
    if (this.targetTabId === tabId) {
      // The next call picks a new tab; refs from the old one are meaningless either way.
      this.bindTab(null);
    }
  }

  /** Point this session at a tab, discarding refs that belonged to the previous one. */
  private bindTab(tabId: number | null): void {
    this.targetTabId = tabId;
    this.refs = new Map();
    // A tab this session has not looked at yet is a different situation from one it
    // snapshotted and then navigated away from.
    this.snapshotTaken = false;
  }

  /**
   * The tab to act on, opening one if the conversation has none yet.
   *
   * The first browser call is what makes the pane appear: `createTab` asks the desktop to
   * open the panel, which is why browser work is never silent.
   */
  private async ensureTargetTab(): Promise<number> {
    if (this.targetTabId !== null) return this.targetTabId;

    const tabs = await this.port.getTabs(this.sessionId);
    if (tabs.length === 0) {
      const created = await this.port.createTab(this.sessionId);
      await this.port.attach(this.sessionId, created.id);
      this.bindTab(created.id);
      return created.id;
    }

    const chosen = tabs.find((tab) => tab.active) ?? tabs[0]!;
    await this.port.attach(this.sessionId, chosen.id);
    this.bindTab(chosen.id);
    return chosen.id;
  }

  // ---------------------------------------------------------- navigation

  async navigate(url: string): Promise<NavigationResult> {
    await this.ensureTargetTab();
    const reply = await this.cdp<{ errorText?: string }>("Page.navigate", { url });
    if (reply?.errorText) {
      throw new BrowserToolError(`Could not navigate to ${url}: ${reply.errorText}`);
    }
    // Refs belonged to the previous document, so they are not usable on the new one.
    this.invalidateSnapshot();
    return await this.settleNavigation();
  }

  async reload(): Promise<NavigationResult> {
    await this.ensureTargetTab();
    await this.cdp("Page.reload", {});
    this.invalidateSnapshot();
    return await this.settleNavigation();
  }

  async goBack(): Promise<NavigationResult> {
    return await this.navigateHistory(-1);
  }

  async goForward(): Promise<NavigationResult> {
    return await this.navigateHistory(1);
  }

  private async navigateHistory(delta: -1 | 1): Promise<NavigationResult> {
    await this.ensureTargetTab();
    const history = await this.cdp<{
      currentIndex: number;
      entries: { id: number; url: string }[];
    }>("Page.getNavigationHistory", {});

    const target = history.entries[history.currentIndex + delta];
    if (!target) {
      throw new BrowserToolError(
        delta === -1
          ? "There is no previous page in this tab's history."
          : "There is no next page in this tab's history.",
      );
    }
    await this.cdp("Page.navigateToHistoryEntry", { entryId: target.id });
    this.invalidateSnapshot();
    return await this.settleNavigation();
  }

  /**
   * Wait for the document to stop loading, then report where it actually ended up.
   *
   * A timeout is not an error: a page with a long-polling request or a blocked subresource
   * never reaches `complete`, and refusing to report anything would be less useful than
   * saying what loaded. The caller inspects the page with a fresh snapshot either way.
   */
  private async settleNavigation(): Promise<NavigationResult> {
    const deadline = Date.now() + this.navigationTimeoutMs;
    let readyState = await this.readyState();
    while (readyState !== "complete" && Date.now() < deadline) {
      await sleep(this.pollIntervalMs);
      readyState = await this.readyState();
    }
    return {
      url: await this.currentUrl(),
      readyState,
      timedOut: readyState !== "complete",
    };
  }

  private async readyState(): Promise<string> {
    return (await this.evaluateValue<string>("document.readyState")) ?? "unknown";
  }

  async currentUrl(): Promise<string> {
    return (await this.evaluateValue<string>("location.href")) ?? "";
  }

  async title(): Promise<string> {
    return (await this.evaluateValue<string>("document.title")) ?? "";
  }

  // ----------------------------------------------------------- observing

  /**
   * The page as an accessibility tree, with the refs later actions use.
   *
   * Replaces the previous snapshot wholesale: a ref from before this call is rejected, so
   * the model always acts on what it just read.
   */
  async snapshot(maxElements?: number): Promise<{ text: string; omitted: number; refs: number }> {
    await this.ensureTargetTab();
    if (!this.accessibilityEnabled) {
      await this.cdp("Accessibility.enable");
      this.accessibilityEnabled = true;
    }

    const reply = await this.cdp<{ nodes?: AxNode[] }>("Accessibility.getFullAXTree");
    const rendered = renderAxTree(reply?.nodes ?? [], {
      maxElements: maxElements ?? DEFAULT_MAX_ELEMENTS,
    });

    this.refs = rendered.refs;
    this.snapshotTaken = true;

    const body =
      rendered.lines.length === 0
        ? "(the page exposes no accessibility nodes — it may still be loading, or it may draw everything to a canvas)"
        : rendered.lines.join("\n");
    const note =
      rendered.omitted > 0
        ? `\n\n(${rendered.omitted} more element(s) omitted; the page is larger than the snapshot cap)`
        : "";
    return { text: body + note, omitted: rendered.omitted, refs: rendered.refs.size };
  }

  async screenshot(fullPage?: boolean): Promise<{ data: string; mimeType: string }> {
    await this.ensureTargetTab();
    const reply = await this.cdp<{ data?: string }>("Page.captureScreenshot", {
      format: "jpeg",
      quality: 70,
      fromSurface: true,
      ...(fullPage ? { captureBeyondViewport: true } : {}),
    });
    if (!reply?.data) {
      throw new BrowserToolError("The browser returned an empty screenshot.");
    }
    return { data: reply.data, mimeType: "image/jpeg" };
  }

  // ------------------------------------------------------------- actions

  async click(input: ClickInput): Promise<void> {
    const point = await this.resolvePoint(input);
    const { button, buttons } = mouseButton(input.button);
    const clickCount = input.double ? 2 : 1;
    const modifiers = modifierBits(input.modifiers);

    const shared = { x: point.x, y: point.y, button, buttons, clickCount, modifiers };
    await this.cdp("Input.dispatchMouseEvent", { type: "mousePressed", ...shared });
    await this.cdp("Input.dispatchMouseEvent", { type: "mouseReleased", ...shared });
  }

  async hover(input: ClickInput): Promise<void> {
    const point = await this.resolvePoint(input);
    await this.cdp("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: point.x,
      y: point.y,
      buttons: 0,
      modifiers: modifierBits(input.modifiers),
    });
  }

  async type(input: { ref?: string; text: string }): Promise<void> {
    if (input.ref !== undefined) {
      await this.focusRef(input.ref);
    } else {
      await this.ensureTargetTab();
    }
    await this.cdp("Input.insertText", { text: input.text });
  }

  async press(input: { ref?: string; key: string; modifiers?: string[] }): Promise<void> {
    const encoded = encodeChord(input.key, input.modifiers);
    if (!encoded) {
      throw new BrowserToolError(
        `Cannot encode the key "${input.key}". Use a single character, a named key (Enter, Tab, Escape, Backspace, Delete, Home, End, PageUp, PageDown, the arrows, F1–F12), or a chord like "cmd+a".`,
      );
    }
    if (input.ref !== undefined) {
      await this.focusRef(input.ref);
    } else {
      await this.ensureTargetTab();
    }

    const { modifiers, stroke } = encoded;
    const shared = {
      key: stroke.key,
      code: stroke.code,
      windowsVirtualKeyCode: stroke.keyCode,
      nativeVirtualKeyCode: stroke.keyCode,
      modifiers,
    };
    // A printable key sends `keyDown` with text so the page receives a real input event;
    // modifiers and navigation keys send `rawKeyDown`, which must not carry text.
    await this.cdp("Input.dispatchKeyEvent", {
      type: stroke.text === undefined ? "rawKeyDown" : "keyDown",
      ...shared,
      ...(stroke.text === undefined ? {} : { text: stroke.text }),
    });
    await this.cdp("Input.dispatchKeyEvent", { type: "keyUp", ...shared });
  }

  /**
   * Choose an option in a `<select>`.
   *
   * Done in the page rather than with synthesized clicks: a native dropdown renders outside
   * the page's own coordinate space, so a click can land on the wrong item or on nothing at
   * all depending on the platform.
   */
  async selectOption(input: { ref: string; value: string }): Promise<string | null> {
    const objectId = await this.resolveObjectId(input.ref);
    const reply = await this.cdp<{
      result?: { value?: unknown };
      exceptionDetails?: { text?: string };
    }>("Runtime.callFunctionOn", {
      objectId,
      returnByValue: true,
      functionDeclaration: `function (wanted) {
        if (!(this instanceof HTMLSelectElement)) return null;
        const match = [...this.options].find(
          (option) => option.value === wanted || option.text.trim() === wanted,
        );
        if (!match) return null;
        this.value = match.value;
        this.dispatchEvent(new Event("input", { bubbles: true }));
        this.dispatchEvent(new Event("change", { bubbles: true }));
        return match.text.trim() || match.value;
      }`,
      arguments: [{ value: input.value }],
    });

    if (reply?.exceptionDetails?.text) {
      throw new BrowserToolError(`select_option failed: ${reply.exceptionDetails.text}`);
    }
    return typeof reply?.result?.value === "string" ? reply.result.value : null;
  }

  async scroll(input: ScrollInput): Promise<void> {
    const point =
      input.ref !== undefined || input.x !== undefined
        ? await this.resolvePoint(input)
        : await this.viewportCentre();
    await this.cdp("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: point.x,
      y: point.y,
      deltaX: input.deltaX ?? 0,
      deltaY: input.deltaY ?? 0,
    });
  }

  // ------------------------------------------------------- escape hatches

  async evaluate(expression: string): Promise<{ value: unknown; error?: string }> {
    await this.ensureTargetTab();
    const reply = await this.cdp<{
      result?: { value?: unknown; description?: string };
      exceptionDetails?: { text?: string; exception?: { description?: string } };
    }>("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });

    const exception = reply?.exceptionDetails;
    if (exception) {
      return {
        value: null,
        error: exception.exception?.description ?? exception.text ?? "the expression threw",
      };
    }
    return { value: reply?.result?.value ?? reply?.result?.description ?? null };
  }

  private async evaluateValue<T>(expression: string): Promise<T | null> {
    const reply = await this.cdp<{ result?: { value?: unknown }; exceptionDetails?: unknown }>(
      "Runtime.evaluate",
      { expression, returnByValue: true, awaitPromise: true },
    );
    if (reply?.exceptionDetails) return null;
    return (reply?.result?.value as T | undefined) ?? null;
  }

  /** Poll a condition until it is truthy, or give up and say so. */
  async waitFor(
    condition: string,
    timeoutMs?: number,
  ): Promise<{ satisfied: boolean; waitedMs: number }> {
    const budget = Math.max(
      0,
      Math.min(timeoutMs ?? DEFAULT_WAIT_FOR_TIMEOUT_MS, MAX_WAIT_FOR_TIMEOUT_MS),
    );
    const startedAt = Date.now();
    const deadline = startedAt + budget;

    for (;;) {
      const { value, error } = await this.evaluate(condition);
      // A condition that throws is not "not yet": it will keep throwing, so report it now
      // rather than burning the whole timeout on a typo.
      if (error) {
        throw new BrowserToolError(`The wait condition threw: ${error}`);
      }
      if (value) {
        return { satisfied: true, waitedMs: Date.now() - startedAt };
      }
      if (Date.now() >= deadline) {
        return { satisfied: false, waitedMs: Date.now() - startedAt };
      }
      await sleep(this.pollIntervalMs);
    }
  }

  // ----------------------------------------------------------- internals

  private async cdp<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const tabId = await this.ensureTargetTab();
    return (await this.port.executeCdp(this.sessionId, method, params, { tabId })) as T;
  }

  /**
   * Drop the current refs, remembering that a snapshot once existed.
   *
   * The distinction drives the error the model gets: after a navigation it should hear
   * "the page moved on, look again", not "you never looked".
   */
  private invalidateSnapshot(): void {
    this.refs = new Map();
  }

  /** A ref's node id, or an explanation of why the model has to look again. */
  private backendNodeIdForRef(ref: string): number {
    const handle = ref.trim();
    const backendNodeId = this.refs.get(handle);
    if (backendNodeId !== undefined) return backendNodeId;

    if (!this.snapshotTaken) {
      throw new BrowserToolError(
        `There is no snapshot to resolve ${handle} against. Call snapshot first, then use the refs it returns.`,
      );
    }
    throw new BrowserToolError(
      `${handle} is not in the current snapshot — it was taken before this one, or the page changed. ` +
        "Call snapshot again and use a ref from that result; do not retry this one.",
    );
  }

  /** The viewport point for a ref or an explicit coordinate. */
  private async resolvePoint(input: { ref?: string; x?: number; y?: number }): Promise<{
    x: number;
    y: number;
  }> {
    if (input.ref !== undefined) {
      return await this.pointForRef(input.ref);
    }
    if (typeof input.x === "number" && typeof input.y === "number") {
      return { x: input.x, y: input.y };
    }
    throw new BrowserToolError(
      "This action needs a target: a ref from the latest snapshot, or an x/y point from a screenshot.",
    );
  }

  /**
   * Where to click for an element.
   *
   * Scroll it into view first — an element below the fold has quads, but they are off-screen
   * coordinates and the click would land on whatever is at that point instead.
   */
  private async pointForRef(ref: string): Promise<{ x: number; y: number }> {
    const backendNodeId = this.backendNodeIdForRef(ref);
    await this.enableDom();

    await this.cdp("DOM.scrollIntoViewIfNeeded", { backendNodeId });
    const reply = await this.cdp<{ quads?: number[][] }>("DOM.getContentQuads", { backendNodeId });
    const point = clickPointFromQuads(reply?.quads);
    if (point === null) {
      throw new BrowserToolError(
        `${ref} has no layout box, so there is nothing to click (it is probably hidden). ` +
          "Take a snapshot to see what is actually on the page.",
      );
    }
    return point;
  }

  private async focusRef(ref: string): Promise<void> {
    const backendNodeId = this.backendNodeIdForRef(ref);
    await this.enableDom();
    await this.cdp("DOM.focus", { backendNodeId });
  }

  private async resolveObjectId(ref: string): Promise<string> {
    const backendNodeId = this.backendNodeIdForRef(ref);
    await this.enableDom();
    const reply = await this.cdp<{ object?: { objectId?: string } }>("DOM.resolveNode", {
      backendNodeId,
    });
    const objectId = reply?.object?.objectId;
    if (!objectId) {
      throw new BrowserToolError(`${ref} is no longer in the page. Take a snapshot again.`);
    }
    return objectId;
  }

  private async enableDom(): Promise<void> {
    if (this.domEnabled) return;
    await this.cdp("DOM.enable");
    this.domEnabled = true;
  }

  private async viewportCentre(): Promise<{ x: number; y: number }> {
    const metrics = await this.cdp<{
      cssLayoutViewport?: { clientWidth?: number; clientHeight?: number };
    }>("Page.getLayoutMetrics", {});
    const width = metrics?.cssLayoutViewport?.clientWidth ?? 800;
    const height = metrics?.cssLayoutViewport?.clientHeight ?? 600;
    return { x: Math.round(width / 2), y: Math.round(height / 2) };
  }
}
