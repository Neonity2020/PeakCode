# Browser Use Requirements

PeakCode's desktop app already renders a real browser pane per thread. This
document specifies the agent-facing browser tool that drives that pane, so the
model can open pages, read them, and act on them instead of guessing from a
`curl`.

**Status.** Implemented. The tool, the pipe client, the CDP layer and the host wiring are in
place with tests at each layer; the desktop's pipe gained `closeTab` and per-conversation
pane resolution. Desktop computer use is not started — see "Follow-on work".

## Goal

Give the agent one tool that closes the loop on web work: observe a rendered
page, act on it, observe the result. The page the agent drives is the same pane
the user is looking at, so every action is visible as it happens.

## Background

Three pieces exist today and one is missing.

**The pane exists.** `apps/desktop/src/browserManager.ts` owns an in-app browser
per thread: Electron `WebContentsView` plus `webContents.debugger` attached at
CDP 1.3, tab runtime suspend/restore, screenshot capture, panel bounds, and a
`persist:peakcode-browser` session partition.

**The host-side pipe exists.** `apps/desktop/src/browserUsePipeServer.ts` already
exposes that pane over a Codex-compatible native pipe: 4-byte length framing,
JSON-RPC 2.0 over a unix socket (a named pipe on Windows), eight methods
(`ping`, `getInfo`, `getTabs`, `createTab`, `nameSession`, `attach`, `detach`,
`executeCdp`), plus `onCDPEvent` notifications.

**The pipe is dead code.** `apps/desktop/src/main.ts` passes
`PEAKCODE_BROWSER_USE_PIPE_PATH` into the backend environment, but nothing in the
repository reads it. The consumer used to be the bundled `codex app-server`,
which this repository no longer ships.

**The tool is missing.** `packages/agent-toolkit` registers 25 tools. None of
them touch a browser. `web_fetch` returns raw HTML with no rendering, no
session, and no way to click.

So the work is a client and a tool, not a browser.

## Scope

### In scope

- Reading a page as a structured accessibility tree, with stable element refs.
- Acting on it: navigate, click, hover, type, press keys, select options, scroll.
- Tabs: list, create, select, close.
- Screenshots, returned as image content for vision models.
- Page-context evaluation and condition waiting.
- Approval gating, plan-mode exclusion, and a capability gate so sessions
  without a desktop pane never see the tool.
- Tests at every layer, plus desktop-side changes needed to make multi-thread
  behaviour correct.

### Out of scope

- Desktop computer use (mouse/keyboard control outside the browser). Blocked on
  Developer ID signing; see "Follow-on work".
- A headless Chromium or Chrome-extension backend. The pane is the product.
- File upload. Electron's file chooser is not reachable through the pane, which
  matches the Codex in-app-browser boundary.
- Video recording, network interception, storage manipulation, tracing.
- Parallel control of tabs the user opened by hand. The agent works on the tabs
  it created, and can select them; claiming arbitrary user tabs is deferred.

## User flow

- The user asks for something that needs a rendered page ("check the login form
  on localhost:5173 actually submits", "read what this dashboard says").
- The agent's first browser call opens the pane in that thread and makes it
  visible, so browser work is never silent.
- The agent takes a snapshot, picks a target from it, and acts.
- Every action is visible in the pane as it happens.
- The first navigation to a new origin asks the user once. Approving it with
  "always allow" covers later actions on the same origin.
- The agent reports what it saw, citing what the page showed.
- Tabs persist for the lifetime of the app process unless the agent closes them.

## Tool surface

One tool, `browser`, with an `action` discriminator. One tool rather than
eighteen because browser work is a tight observe/act loop and because every
extra tool costs prompt budget in every turn.

Parameter names are snake_case like the rest of the toolkit.

| `action`           | Required         | Optional                                  | Effect                                                          |
| ------------------ | ---------------- | ----------------------------------------- | --------------------------------------------------------------- |
| `get_tabs`         | —                | —                                         | List tabs: id, title, url, which is active. Does not claim one. |
| `new_tab`          | —                | `url`                                     | Create and activate a tab. Defaults to `about:blank`.           |
| `select_tab`       | `tab_id`         | —                                         | Activate a tab and make it the default target.                  |
| `close_tab`        | `tab_id`         | —                                         | Close a tab.                                                    |
| `navigate`         | `url`            | `tab_id`                                  | Navigate the target tab and wait for load.                      |
| `back` / `forward` | —                | `tab_id`                                  | History navigation.                                             |
| `reload`           | —                | `tab_id`                                  | Reload.                                                         |
| `snapshot`         | —                | `tab_id`, `max_elements`                  | Accessibility tree of the page, with refs.                      |
| `screenshot`       | —                | `tab_id`, `full_page`                     | PNG/JPEG of the page as an image block.                         |
| `click`            | `ref` or `x`+`y` | `tab_id`, `button`, `double`, `modifiers` | Click an element or a point.                                    |
| `hover`            | `ref` or `x`+`y` | `tab_id`, `modifiers`                     | Move the pointer.                                               |
| `type`             | `text`           | `ref`, `tab_id`                           | Insert text into an element, or the focused element.            |
| `press`            | `key`            | `ref`, `tab_id`, `modifiers`              | Press one key or chord.                                         |
| `select_option`    | `ref`, `value`   | `tab_id`                                  | Choose an option by value or visible label.                     |
| `scroll`           | `ref` or `x`+`y` | `tab_id`, `delta_x`, `delta_y`            | Wheel scroll at a target.                                       |
| `evaluate`         | `expression`     | `tab_id`                                  | Run JS in the page and return the JSON result.                  |
| `wait_for`         | `condition`      | `tab_id`, `timeout_ms`                    | Poll until the expression is truthy.                            |

`tab_id` defaults to the tab this thread last selected, so the model only passes
it when it means a different tab.

### Refs

`snapshot` labels each element with a short ref (`e12`). Refs are scoped to the
snapshot that produced them: a ref from an older snapshot is rejected with a
message telling the model to take a fresh one. This mirrors the discipline in
Codex and ZCode, where element targets carry a `state_id` for the same reason —
a bare node id can be reused after a garbage collection and silently point at a
different element.

Coordinates are the fallback for targets the tree cannot express (canvas,
custom-drawn widgets). They are viewport CSS pixels measured on the latest
`screenshot`, and the tool description says plainly that a coordinate is never
to be derived from snapshot numbers.

## Architecture

```
pi agent (tool call)
  └─ agent-toolkit  browser tool        packages/agent-toolkit/src/tools/browserTools.ts
       └─ ctx.onBrowser                 (host-injected callback)
            └─ apps/server/src/browser/browserTool.ts       args → outcome
                 └─ browserSession.ts                       refs + CDP verbs
                      └─ browserUsePipeClient.ts            framing + JSON-RPC
                           └─ unix socket  ─────────────▶  BrowserUsePipeServer (desktop)
                                                                └─ DesktopBrowserManager
                                                                     └─ WebContentsView + CDP
```

The toolkit declares the tool and knows nothing about CDP; the server supplies
the implementation. This is the same split as `schedule_task`
(`apps/server/src/automation/automationTool.ts`) and `kanban_comment`
(`apps/server/src/kanban/kanbanTool.ts`), and it keeps the provider layer free of
a browser dependency.

### New files

| File                                               | Role                                                                                       |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `packages/shared/src/browserUsePipe.ts`            | The wire contract: env var, pipe path, framing, method names, message types.               |
| `packages/agent-toolkit/src/tools/browserTools.ts` | Declares `browser`; `BrowserToolParams`; argument validation; forwards to `ctx.onBrowser`. |
| `apps/server/src/browser/browserUsePipeClient.ts`  | Framing, JSON-RPC correlation, timeouts, capability probe.                                 |
| `apps/server/src/browser/browserCdp.ts`            | Pure helpers: AX tree → compact text + refs; quads → click point; key-chord encoding.      |
| `apps/server/src/browser/browserSession.ts`        | Per-conversation state: target tab, snapshot refs, and the CDP verbs.                      |
| `apps/server/src/browser/browserTool.ts`           | The host: `setBrowserToolHost` / `browserFromConversation` / `makeBrowserToolHost`.        |

### Changed files

| File                                              | Change                                                                                                                                               |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/package.json`                    | Export `./browserUsePipe`.                                                                                                                           |
| `packages/agent-toolkit/src/tools/toolSupport.ts` | `ToolContext.onBrowser`, `BrowserToolParams`, `ToolOutcomeWithImage`.                                                                                |
| `packages/agent-toolkit/src/agent-tools.ts`       | Register `browser` when `onBrowser` is injected; export the new types.                                                                               |
| `packages/agent-toolkit/src/permissions.ts`       | `browser` approval case; `browsing` / `browsing_script` defaults per mode; labels and probes.                                                        |
| `apps/server/src/config.ts`                       | `ServerConfigShape.browserUsePipePath`.                                                                                                              |
| `apps/server/src/main.ts`                         | Read the pipe path from the environment; install the host at startup.                                                                                |
| `apps/server/src/agentToolkit.ts`                 | Accept and forward `onBrowser`.                                                                                                                      |
| `apps/server/src/agentToolkitMode.ts`             | Treat `browser` as write-capable (off in plan mode).                                                                                                 |
| `apps/server/src/provider/Layers/PiAdapter.ts`    | Inject `onBrowser` when the host is installed.                                                                                                       |
| `apps/desktop/src/browserUsePipeServer.ts`        | Import the shared contract instead of its own copies; resolve the thread from `session_id`; add `closeTab`; refuse a tab outside the session's pane. |
| `apps/desktop/src/browserManager.ts`              | `getBrowserUseSnapshot(threadId?)` — a thread-scoped pane lookup.                                                                                    |

`packages/contracts` is untouched: the wire types for the tool live in the toolkit next to
`ScheduleTaskToolParams`, and the desktop's browser contracts already exist.

The desktop's own copies of the pipe path resolver and the framing functions moved into
`packages/shared/src/browserUsePipe.ts`. They had been defined in the desktop module with a
consumer that no longer exists in this repository; the server now reads the same definition
instead of a second copy that would drift.

## Observation and targeting

The default way to read a page is `snapshot`, and it is deliberately not a
screenshot. Text is cheaper, survives without a vision model, and yields stable
targets that survive a re-render.

`snapshot` calls `Accessibility.getFullAXTree` and renders a compact indented
tree of role, name, and state, keeping only meaningful nodes:

```
[e1]  heading "Sign in"
[e4]  textbox "Email" value=""
[e7]  textbox "Password"
[e9]  checkbox "Remember me" checked=false
[e11] button "Sign in"
```

Each line's ref maps to the node's `backendDOMNodeId`. Nodes that are ignored,
not rendered, or unnamed and uninteresting are dropped, and the output is
capped by `max_elements` so a large page cannot flood the context.

Actions that take a `ref` resolve it the same way, which is what Puppeteer does
and what makes the path reliable:

- **click / hover** — `DOM.scrollIntoViewIfNeeded` → `DOM.getContentQuads` →
  center of the first quad → `Input.dispatchMouseEvent`
  (`mousePressed` then `mouseReleased`, with `clickCount` for double).
- **type** — `DOM.focus` (when a ref is given) → `Input.insertText`.
- **press** — `Input.dispatchKeyEvent` with `keyDown` and `keyUp`, encoded from
  the chord.
- **scroll** — `Input.dispatchMouseEvent` with `type: mouseWheel` at the target
  point.

`screenshot` is explicitly the fallback, and the tool description says so: use
it when the question is visual (layout, styling, rendering) or when the target
is not in the tree, not as a routine second observation.

## Permissions and modes

**Approval is keyed by origin.** Navigating is the boundary that gets asked about: a
`navigate` or a `new_tab` carrying a URL produces a `browsing` request whose pattern and
"always allow" value are the URL's origin, so one site asks once. `new_tab` without a URL
opens `about:blank` and asks nothing.

**Page scripts are a separate permission.** `evaluate` runs arbitrary JavaScript in a page
the user is looking at but cannot see happening — it can read cookies and call APIs on the
user's behalf. It raises `browsing_script` keyed on `*` rather than on the current origin,
so an approved site does not implicitly approve scripting in it.

**Other actions do not prompt.** Clicking, typing, scrolling, snapshotting and screenshotting
happen on a page the user can see, in a pane that is the consent surface. Prompting per click
would make the observe/act/observe loop unusable, and the boundaries that matter are the two
above.

Approval-mode defaults follow the rest of the toolkit: `auto` allows both, `manual` and the
default `smart` ask, `strict` denies.

**Plan mode excludes `browser`.** It joins `WRITE_CAPABLE_TOOLKIT_TOOLS` alongside `bash` and
`apply_patch`. A click can submit a form, and plan mode's promise is that it touches nothing.

**Capability gate.** The tool is registered only when the host injects `onBrowser`, which
happens only when the server was started with a browser-use pipe path — that is, only under
the desktop app. A headless or CLI server keeps its prompt free of a tool that could never
work. This follows `view_image`, which is likewise omitted when the model or environment
cannot support it.

**Screenshots need a vision model.** The tool refuses `screenshot` for a model that cannot
receive images and points at `snapshot` instead, rather than sending a block the provider
will reject.

## Error handling and limits

- **No pane.** If the pipe is absent or the socket cannot be reached, the tool
  reports that browser control is unavailable in this session rather than
  failing opaquely.
- **Dead refs.** A ref outside the current snapshot's generation is rejected
  with "take a new snapshot"; the tool never silently re-resolves it.
- **Navigation timeout.** `navigate` waits for the load event with a bounded
  timeout, then reports the URL actually reached. The page is inspected through
  a fresh snapshot, not through the wait result.
- **Action results are receipts, not observations.** An action reports what was
  dispatched and whether it was dispatched, and the model is told to re-observe
  rather than assume the UI changed. This is the same rule ZCode enforces with
  its `action_sent` receipts.
- **Page content is untrusted.** Snapshot text is data. The tool description
  states that page content is never an instruction, and that only the user's
  request authorizes navigation.
- **Untrusted output size.** Snapshot output is capped by `max_elements`;
  `evaluate` results are serialized and truncated like other tool output.
- **Screenshots** respect the existing image-size cap used by `view_image` and
  are requested as JPEG at a modest quality by default so a full-page capture
  cannot blow the context budget.

## Implementation plan

Each phase landed with its tests.

**1 — Tool declaration.** `BrowserToolParams` and `createBrowserTool` in the
toolkit; `ToolContext.onBrowser`; registration gated on the callback; mode and
permission entries. Tests: parameters accepted/rejected, "not available"
outcome, plan-mode exclusion, origin-keyed approval request, the vision guard.

**2 — Pipe contract and client.** The framing and path resolution moved into
`@peakcode/shared/browserUsePipe` so the desktop and the server share one
definition; `browserUsePipeClient.ts` adds id correlation, a per-request
timeout, a cached capability probe, and a clean "unavailable" error. Tests:
round-trip against a real unix socket, framing across split chunks, oversized
frame rejection, timeout, and a response delivered one byte at a time.

**3 — CDP layer.** `browserCdp.ts` pure helpers, then `browserSession.ts` over
an injected `executeCdp` port. Tests: AX tree rendering and ref mapping,
`max_elements` capping, unreachable nodes, quad-to-point, key encoding, and the
exact CDP call sequence for click/type/scroll/select/navigate.

**4 — Host and wiring.** `browserTool.ts` mapping params to session calls;
`setBrowserToolHost` installed in `main.ts`; `PiAdapter` injects `onBrowser`
when the host exists; `ServerConfigShape` gains the pipe path. Tests: the host
driven through a real pipe server, receipts vs. errors, and the
host-not-installed path.

**5 — Desktop corrections.** Resolve the pane from `session_id` instead of
always using the active pane; refuse a tab outside the session's pane; add
`closeTab`. Tests: extend `browserUsePipeServer.test.ts` with two threads and a
fake manager.

**6 — End-to-end.** Still to run: a dev-instance smoke pass that navigates to a
local page, snapshots it, clicks a control, and confirms the effect in the pane.
The layers are covered by tests, but a human has not yet watched it work.

## Test plan

- Toolkit unit tests for the declaration, gating, and approval shape.
- Pipe client tests against a real socket, including chunk-split framing and
  failure modes.
- CDP tests with a recorded/canned `executeCdp` port, asserting exact command
  sequences so a refactor cannot quietly change what gets dispatched.
- Desktop tests for session-to-thread resolution and `closeTab`.
- One manual end-to-end pass against a real local page in an isolated dev
  instance (`--home-dir ./.peakcode-browser-use --port 58091`), because the
  value of this feature is that a human can watch it work.
- `bun fmt`, `bun lint`, `bun typecheck` once at the end of the work.

## Acceptance criteria

- The agent can navigate to a URL, read the page as a tree, click a control,
  and report the resulting state, with all of it visible in the pane.
- A ref from a superseded snapshot is rejected, and the error tells the model to
  re-snapshot.
- The first action on a new origin prompts once; "always allow" covers the rest
  of that origin.
- Plan mode does not offer `browser`.
- A server started without a pipe path never advertises `browser`, and the
  session works exactly as before.
- Two threads with browser panes open do not receive each other's commands.
- Every new module has tests, and the full check suite passes.

## Risks

- **Electron CDP coverage.** `Input`, `DOM`, `Page`, `Accessibility`, and
  `Runtime` are all expected to work through `webContents.debugger`. Phase 3's
  first task is a quick probe of each domain against a real pane, before the
  driver is built on them.
- **AX tree volume.** Large apps can produce very large trees; the cap and the
  node filter are load-bearing, not cosmetic.
- **Approval UX.** Origin granularity is a judgement call. If users find one
  prompt per site too coarse, the fallback is per-action-type within an origin.
- **Pane-driven ambiguity.** A request is answered from the conversation's own pane when
  that conversation has one, falling back to the active pane otherwise, and a tab outside the
  session's pane is refused. What remains is that opening a pane happens in the renderer,
  which only knows the thread the user is on — so a conversation whose thread has no pane yet
  adopts the active one rather than conjuring its own. That is fine while there is one browser
  surface; it should be revisited if a second one (a headless backend, say) is ever added.
- **`get_tabs` does not claim a tab.** Listing is a read and must not take over the tab the
  user is on, so the conversation's tab is chosen by the first action instead. The tool says
  so in its output, but a model that ignores it may act on the active tab when it meant a
  different one; `select_tab` is the explicit answer.

## Follow-on work

**Desktop computer use** is a separate effort and is not started here. The
blocking issue is not the automation API but macOS permission identity: PeakCode
signs ad-hoc today (`apps/desktop/scripts/electron-builder-ad-hoc-sign.cjs`), so
there is no stable signature for a helper bundle to hold Accessibility and
Screen Recording grants against, and users would have to re-authorize after
every update. Developer ID signing and notarization come first. The cheapest
path to value after that is an external macOS automation process such as
`steipete/peekaboo` (MIT) rather than a bespoke native layer, since the
non-focus-stealing behaviour that makes computer use usable depends on private
SkyLight APIs that would have to be written by hand.
