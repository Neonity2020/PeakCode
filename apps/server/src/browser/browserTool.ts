/**
 * The host side of the `browser` tool.
 *
 * The toolkit declares the tool and validates arguments; this module knows how to actually
 * drive the desktop's browser pane, and answers when it cannot. It is installed once at
 * server start, the same way the automation and kanban hosts are, so the provider layer
 * never has to know a browser exists.
 *
 * Session state lives here rather than in the toolkit because it is per conversation and
 * per tab: which tab is being driven, and what the last snapshot called each element. That
 * state has to survive between tool calls in a turn and between turns in a thread, which is
 * exactly what a module-level registry gives us.
 */
import {
  errorResult,
  type BrowserToolParams,
  type ToolOutcomeWithImage,
} from "@peakcode/agent-toolkit/agent-tools";
import type { ThreadId } from "@peakcode/contracts";
import type { BrowserUseTabInfo } from "@peakcode/shared/browserUsePipe";

import { BrowserSession, BrowserToolError, type NavigationResult } from "./browserSession.ts";
import { BrowserUsePipeClient, BrowserUseUnavailableError } from "./browserUsePipeClient.ts";

/** Ceiling on a page-context result, so one `evaluate` cannot flood the context. */
const MAX_EVALUATE_CHARS = 20_000;

export interface BrowserToolHost {
  run(input: { threadId: ThreadId; params: BrowserToolParams }): Promise<ToolOutcomeWithImage>;
}

let installedHost: BrowserToolHost | null = null;

/** Install the host the tool callback resolves against. Called once per server start. */
export function setBrowserToolHost(host: BrowserToolHost | null): void {
  installedHost = host;
}

/**
 * Whether this server can drive a browser pane at all.
 *
 * The provider asks before injecting the callback, because whether the tool is registered is
 * decided per session: a server booted without a pipe has no pane to drive, and offering the
 * tool anyway would leave the model calling a verb that can never work.
 */
export function browserControlConfigured(): boolean {
  return installedHost !== null;
}

/**
 * Drive the browser from the conversation the call was made in.
 *
 * Wired as the toolkit's `onBrowser` callback. Without a host the model is told rather than
 * left guessing why nothing happened.
 */
export function browserFromConversation(input: {
  readonly threadId: string;
  readonly params: BrowserToolParams;
}): Promise<ToolOutcomeWithImage> {
  if (installedHost === null) {
    return Promise.resolve(errorResult("Browser control is not available in this session."));
  }
  return installedHost.run({ threadId: input.threadId as ThreadId, params: input.params });
}

/** Turns a thrown error into something the model can act on. */
function failure(error: unknown): ToolOutcomeWithImage {
  if (error instanceof BrowserToolError) {
    return errorResult(error.message);
  }
  if (error instanceof BrowserUseUnavailableError) {
    return errorResult(
      "Browser control is unavailable: the desktop app's browser pipe is not reachable. " +
        "It may have been closed or restarted. Tell the user rather than retrying.",
    );
  }
  return errorResult(
    `The browser command failed: ${error instanceof Error ? error.message : String(error)}`,
  );
}

const describeTabs = (tabs: BrowserUseTabInfo[], targetTabId: number | null): string => {
  if (tabs.length === 0) {
    return "No browser tab is open. The next browser action will open one.";
  }
  const lines = tabs.map((tab) => {
    const markers = [
      tab.id === targetTabId ? "← driving" : "",
      tab.active && tab.id !== targetTabId ? "the user is looking at this one" : "",
    ].filter((marker) => marker.length > 0);
    const suffix = markers.length > 0 ? ` (${markers.join("; ")})` : "";
    return `  [${tab.id}] ${tab.url || "about:blank"}${suffix}`;
  });
  // Listing is a read, so it does not claim a tab. Say what will happen instead of leaving
  // the model to guess which of the listed tabs its next action would land on.
  const unclaimed =
    targetTabId === null
      ? ["This conversation has not picked a tab yet; the next action takes over the active one."]
      : [];
  return [`${tabs.length} tab(s):`, ...lines, ...unclaimed].join("\n");
};

const describeNavigation = (result: NavigationResult): string =>
  result.timedOut
    ? `The page had not finished loading when I stopped waiting (readyState: ${result.readyState}). ` +
      "Take a snapshot to see what is actually there."
    : "Take a snapshot to read it.";

/** A receipt, not an observation: the tool reports what it dispatched, never that it worked. */
const receipt = (action: string, detail?: string): string =>
  [
    `Dispatched \`${action}\`${detail === undefined ? "" : ` (${detail})`}.`,
    "This is a receipt, not a result — observe the page before assuming it had the effect you wanted.",
  ].join(" ");

function serialize(value: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    text = String(value);
  }
  if (text.length <= MAX_EVALUATE_CHARS) return text;
  return (
    `${text.slice(0, MAX_EVALUATE_CHARS)}\n\n…(truncated: the result was ${text.length} characters. ` +
    "Narrow the expression to return only what you need.)"
  );
}

/** A text-only outcome. */
const text = (body: string): ToolOutcomeWithImage => ({
  content: [{ type: "text", text: body }],
  details: {},
});

/** Run one tool call against a session. Split out so the dispatch is readable. */
async function runAction(
  session: BrowserSession,
  params: BrowserToolParams,
): Promise<ToolOutcomeWithImage> {
  switch (params.action) {
    case "get_tabs": {
      const tabs = await session.listTabs();
      return text(describeTabs(tabs, session.currentTabId));
    }

    case "new_tab": {
      const { tab, navigation } = await session.newTab(params.url);
      const lines = [`Opened tab ${tab.id}${params.url ? ` at ${params.url}` : " (about:blank)"}.`];
      if (navigation) lines.push(describeNavigation(navigation));
      return text(lines.join("\n"));
    }

    case "select_tab": {
      await session.selectTab(params.tab_id!);
      return text(`Now driving tab ${params.tab_id}. Take a snapshot to read it.`);
    }

    case "close_tab": {
      await session.closeTab(params.tab_id!);
      return text(
        `Closed tab ${params.tab_id}.` +
          (session.currentTabId === null
            ? " This conversation now has no tab; the next call will open one."
            : ""),
      );
    }

    case "navigate": {
      const result = await session.navigate(params.url!);
      return text(`Navigated to ${result.url}. ${describeNavigation(result)}`);
    }

    case "back":
    case "forward":
    case "reload": {
      const result =
        params.action === "back"
          ? await session.goBack()
          : params.action === "forward"
            ? await session.goForward()
            : await session.reload();
      return text(`${params.action} landed on ${result.url}. ${describeNavigation(result)}`);
    }

    case "snapshot": {
      const snapshot = await session.snapshot(params.max_elements);
      return text(
        [
          snapshot.text,
          "",
          `${snapshot.refs} element(s) are addressable by the refs above. Use a ref with ` +
            "click/type/press/select_option, or an x/y point from a screenshot for anything the tree cannot express.",
        ].join("\n"),
      );
    }

    case "screenshot": {
      const image = await session.screenshot(params.full_page);
      return {
        content: [
          {
            type: "text" as const,
            text:
              `Screenshot of tab ${session.currentTabId}` +
              `${params.full_page ? " (full page)" : ""}. ` +
              "If you need to act on something in it, pass x/y read from this image as viewport CSS pixels.",
          },
          { type: "image" as const, data: image.data, mimeType: image.mimeType },
        ],
        details: {},
      };
    }

    case "click":
    case "hover": {
      const target =
        params.ref !== undefined ? `ref ${params.ref}` : `point ${params.x},${params.y}`;
      if (params.action === "click") {
        await session.click({
          ...(params.ref === undefined ? {} : { ref: params.ref }),
          ...(params.x === undefined ? {} : { x: params.x }),
          ...(params.y === undefined ? {} : { y: params.y }),
          ...(params.button === undefined ? {} : { button: params.button }),
          ...(params.double === undefined ? {} : { double: params.double }),
          ...(params.modifiers === undefined ? {} : { modifiers: params.modifiers }),
        });
      } else {
        await session.hover({
          ...(params.ref === undefined ? {} : { ref: params.ref }),
          ...(params.x === undefined ? {} : { x: params.x }),
          ...(params.y === undefined ? {} : { y: params.y }),
        });
      }
      return text(receipt(params.action, target));
    }

    case "type": {
      await session.type({
        ...(params.ref === undefined ? {} : { ref: params.ref }),
        text: params.text!,
      });
      return text(
        receipt(
          "type",
          params.ref === undefined ? "into the focused element" : `ref ${params.ref}`,
        ),
      );
    }

    case "press": {
      await session.press({
        ...(params.ref === undefined ? {} : { ref: params.ref }),
        key: params.key!,
        ...(params.modifiers === undefined ? {} : { modifiers: params.modifiers }),
      });
      return text(receipt("press", params.key));
    }

    case "select_option": {
      const chosen = await session.selectOption({ ref: params.ref!, value: params.value! });
      return chosen === null
        ? errorResult(
            `No option in ${params.ref} matched "${params.value}". Take a snapshot to see the options, ` +
              "or pass the option's value attribute instead of its label.",
          )
        : text(receipt("select_option", `chose "${chosen}"`));
    }

    case "scroll": {
      await session.scroll({
        ...(params.ref === undefined ? {} : { ref: params.ref }),
        ...(params.x === undefined ? {} : { x: params.x }),
        ...(params.y === undefined ? {} : { y: params.y }),
        ...(params.delta_x === undefined ? {} : { deltaX: params.delta_x }),
        ...(params.delta_y === undefined ? {} : { deltaY: params.delta_y }),
      });
      return text(receipt("scroll", `deltaY ${params.delta_y ?? 0}`));
    }

    case "evaluate": {
      const result = await session.evaluate(params.expression!);
      return result.error !== undefined
        ? errorResult(`The expression threw in the page: ${result.error}`)
        : text(serialize(result.value));
    }

    case "wait_for": {
      const result = await session.waitFor(params.condition!, params.timeout_ms);
      return result.satisfied
        ? text(`The condition held after ${result.waitedMs}ms.`)
        : errorResult(
            `The condition was still false after ${result.waitedMs}ms. ` +
              "It may never become true, or the page may have changed: take a snapshot to see the current state.",
          );
    }

    default:
      // The toolkit validates the action against the same list, so reaching here is a bug.
      return errorResult(`Unsupported browser action: ${params.action}`);
  }
}

/**
 * Build the host for a server that has a browser pipe to talk to.
 *
 * One session per thread, kept for the process lifetime: a conversation's tab choice and
 * snapshot refs should survive between turns, and dropping them would make the model
 * re-snapshot on every turn for no reason.
 */
export function makeBrowserToolHost(options: { readonly pipePath: string }): BrowserToolHost {
  const client = new BrowserUsePipeClient({ pipePath: options.pipePath });
  const sessions = new Map<string, BrowserSession>();

  const sessionFor = (threadId: ThreadId): BrowserSession => {
    const existing = sessions.get(threadId);
    if (existing) return existing;
    const created = new BrowserSession(client, threadId);
    sessions.set(threadId, created);
    return created;
  };

  return {
    run: async ({ threadId, params }) => {
      try {
        return await runAction(sessionFor(threadId), params);
      } catch (error) {
        return failure(error);
      }
    },
  };
}
