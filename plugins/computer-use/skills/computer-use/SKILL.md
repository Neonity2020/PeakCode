---
name: computer-use
description: Drive a macOS app through the `computer` tool — read its accessibility tree, act on elements, and use real input only when the tree cannot reach the target.
---

# Computer Use

The `computer` tool drives apps on this Mac through a native helper. It is how you do work
that lives in a GUI and nowhere else: a dialog with no CLI, a form in a native app, a
preference toggle, confirming what an app actually shows.

## Reach for it last

In order:

1. **Files and shell commands.** Copying a file is `cp`, not a Finder drag.
2. **The app's own CLI or config file.** Most macOS apps have one, and it is scriptable.
3. **The `browser` tool**, if the work is in a web page. It has element refs and a visible
   pane the user can watch.
4. **Only then** `computer`.

Skipping to step 4 for something 1–3 could do is slower, more brittle, and it moves the
user's cursor around while they are trying to work.

## The loop

Observe once, act once, observe again. Never chain GUI actions blind.

1. `action: "list_apps"` — what is running. Apps are matched by the name the user would say
   _or_ by bundle id, so ask for "Finder" even on a system that calls it 访达.
2. `action: "get_state"` with that app — returns the accessibility tree of the window in
   front, with a numbered ref for each element, its position and size, and the actions it
   actually supports.
3. `action: "act"` with a ref from that tree.
4. Observe again before concluding anything.

Two other reads, for when the tree is not the right lens:

- `action: "list_windows"` — every on-screen window with its id, app, title and bounds. Use it
  to find a window that is not the front one (a sheet, a popover, a background window) and to
  capture it with `screenshot` + `window_id`. Its bounds are already in screen points.
- `action: "displays"` — the displays and their scale factors. This is the coordinate space
  itself: on a second monitor the same pixel is a different point, and this is where that is
  written down.

`get_state` also reports a `state_id`. Pass it back with the ref — a ref is only meaningful
for the observation it came from, and a ref from an older one is refused on purpose. The
element behind it may be a different control by now. Do not retry a refused ref; take a
fresh `get_state`.

### Reading the tree

```
state_id: s3
访达 (pid 2390) — 180 elements
[0] Window "Downloads" @(120,60) 1280x800
  [1] Button "名称" @(213,140) 1313x28  [press]
  [4] TextField "" @(20,80) 400x24  value=""  [set_value]
  [9] Checkbox "保持文件夹在顶部" @(220,300) 16x16  [press]
```

`[press]` and `[set_value]` are the actions that element supports — use `act` with
`element_action: "press"` or `"set_value"` accordingly. `[disabled]` means it cannot be acted
on right now.

The default scope is the focused window. `scope: "all"` reads every window of the app, which
is much larger — use it only when you need to find something you were not told the location
of. A tree can also come back marked partial: it stopped early because the app stopped
answering accessibility, or because it hit the element ceiling. Do not conclude that a
control is missing just because it is not listed.

## Acting

**An element action is almost always the right move.** It is precise, it survives the window
moving, and it does not disturb the user: no pointer movement, no focus change.

- `press` — buttons, checkboxes, menu items, anything with `[press]`.
- `set_value` — text fields and other value-carrying controls. This writes the value
  directly, so the field does not need to be focused first. Prefer it over `type` for a
  field you can address.
- `focus` / `raise` — give an element keyboard focus, or bring its window forward.

### Moving through a window

`action: "scroll"` with a `direction` (`down` reveals what is further down) and an optional
`amount`, aimed with a point or an app name. **Scroll before deciding something is not there**:
a short list, a missing button and an empty panel are usually just content that has not been
brought into view, and a tree only ever describes what is visible.

A scroll at a point moves the pointer there first, because that is how the system routes wheel
events. Aiming at an app's window (no point) is the gentler option; either way the user's
pointer ends up somewhere they did not put it.

### When the tree cannot reach it

`click`, `drag`, `scroll`, `type` and `key` send **real** input. That means they move the
user's actual pointer and type into whatever currently holds their keyboard focus — anything
they were doing is interrupted. Use them only when the tree genuinely cannot express the
target: a canvas, a custom-drawn control, a slider or a reorder that has no accessibility
equivalent, a game.

Before using them, activate the app (`open_app`) so the input lands where you intend, and say
what you are doing. Keep it brief.

- `click` — `count: 2` double-clicks, `button: "right"` opens a context menu.
- `drag` — from one point to another in one gesture. The path matters: sliders, reorders,
  selections and canvases all follow it, so do not fake a drag with two clicks. Add
  `modifiers: "cmd"` for a modifier-held drag.
- `type` — `strategy: "keys"` (default) types each character; `strategy: "paste"` puts the text
  on the clipboard and presses ⌘V. **Use paste for long text and for Chinese, Japanese, Korean
  or emoji**: it is one gesture instead of hundreds of key events, and input methods cannot
  reinterpret it. The clipboard is put back afterwards, so it does not cost the user anything —
  but say that you are using it if the text is sensitive.
- `key` — one key or a chord, for example `Enter`, `Escape`, `cmd+s`, `cmd+shift+n`.

Coordinates for `click`, `drag` and `scroll` are pixels read off your most recent `screenshot`
— pass the point you actually see, unchanged. That capture knows whether it was a window or the
whole display, where it started on screen, and what the display's scale is, so the conversion
to screen coordinates is already handled. A window capture's coordinates are therefore relative
to that window's image: after the window moves, take a new capture.

### The clipboard

The clipboard is part of the desktop, so it is part of the tool:

- `action: "read_clipboard"` — what the user (or the app they were just in) copied. This is
  often the cheapest way to get text a GUI produced: a rendered table, a link, a path, an error
  message. macOS may show its own paste notification the first time; that is the system's gate,
  not something to work around.
- `action: "write_clipboard"` — put text there for an app that wants a paste. It replaces what
  was there: say so, and prefer `type` when a paste is not what the app expects.

## Permissions

The tool runs through a separate helper app, **Peak Code Computer Use**, and macOS files its
grants against that helper rather than against Peak Code. It needs:

| What                           | Which permission | Where the user grants it                                |
| ------------------------------ | ---------------- | ------------------------------------------------------- |
| Reading and acting on controls | Accessibility    | System Settings → Privacy & Security → Accessibility    |
| `screenshot`                   | Screen Recording | System Settings → Privacy & Security → Screen Recording |

`action: "status"` reports both. If something is missing, `action: "request_access"` asks
macOS to show its own prompt — but the prompt is only a shortcut, and the user still has to
switch it on themselves. Granting it once is enough and it survives later rebuilds of Peak
Code, because the grant is pinned to the helper's own identity rather than to the app.

**When a call comes back saying a permission is missing: tell the user which one, and stop.**
Do not retry it, do not look for another way to do the same thing, and never try to grant it
yourself — no `tccutil`, no editing a database, no `sudo`. That is the user's decision. The
same goes for a macOS permission dialog that appears mid-task: report it, do not click
through it for them.

## Discipline

- **Ask before anything irreversible.** Sending a message, confirming a purchase, deleting
  something, quitting an app with unsaved work, accepting a dialog on the user's behalf.
  Describe what you are about to do and wait for the user.
- **Look before you act, and look after.** Screenshots and trees are the only way you know
  what actually happened. An `act` result is a receipt, not a conclusion.
- **Coordinates come from the screenshot you just took.** Do not reuse a point from earlier
  in the conversation; windows move. If you are aiming at something you saw in a tree, its
  `@(x,y) WxH` is already screen points — click the middle of it rather than converting
  anything.
- **Scroll before saying it is not there.** Then look again.
- **Give the app a moment.** A capture taken immediately after an action often still shows
  the previous state. Re-read before concluding it failed.
- **Do not fight a permission prompt.** If a modal appears, report it.
- **The user's desktop is not your scratch space.** Close what you opened, and leave their
  windows where you found them.

## When to say no

Say so plainly, and offer the alternative, when:

- the work is in a web page — use the `browser` tool;
- the work is in files — use the shell;
- the user asked for something this cannot do reliably (multi-touch gestures, a drag that
  depends on sub-pixel timing, anything that has to happen while they are using the machine);
- permissions are not granted and the user has not chosen to grant them.

Computer use is genuinely useful and genuinely limited. Being straight about which one you
are looking at is more helpful than a confident attempt that leaves the desktop in a strange
state.
