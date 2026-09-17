# Computer Use

The `computer` tool drives apps on macOS through a native helper. This document explains why
it is built the way it is, and what a developer has to do once to make it work.

**Status.** Implemented and verified end to end on macOS: accessibility observation, element
actions, the clipboard, window and display geometry, and the whole range of synthetic input
(clicks, drags, wheel scrolling, typing and chords), all through the agent's `computer` tool. The
verification was measured against a purpose-built target app that logs the events it receives,
rather than by watching the screen.

## The problem this design solves

macOS files an Accessibility or Screen Recording grant against the **responsible process**,
and a child process inherits its parent's attribution. Two consequences follow, and both were
measured rather than assumed:

| How the helper is started          | Whose identity it uses | Result                                                      |
| ---------------------------------- | ---------------------- | ----------------------------------------------------------- |
| Spawned as a child of the app      | the parent's           | `AXIsProcessTrusted = YES` only if the _parent_ was granted |
| Through LaunchServices (`open -a`) | its own                | independent; needs its own grant                            |

The _first_ row is what the old shell-based approach ran into. Routing `osascript` through
Peak Code's process tree means the grant has to sit on whichever app owns that tree — Peak
Code when it was launched by itself, otherwise the terminal or agent app that started it. And
because a locally built Peak Code is ad-hoc signed, its identity changes on every rebuild, so
that grant does not survive one.

The second finding makes the fix possible. A grant filed against the helper's own identity is
pinned to the helper's **designated requirement**, and an ad-hoc signature can carry an
explicit one:

```
designated => identifier "com.peakcode.cua-helper"
```

That requirement names a bundle identifier instead of hashing the binary, so it is satisfied
by every rebuild. The helper is installed at a fixed path, launched by LaunchServices, and
rebuilt only when its own source changes — so the grant survives every rebuild of Peak Code.

**No Developer ID certificate is required.** The requirement is exactly as strong as the
helper's identifier; the token and the owner-only socket are what gate who can drive it.

## Signing: which identity, and why the default is what it is

The grant is pinned to the helper's **designated requirement**, so the signing identity decides
how durable that grant is. Three options, measured on a real machine:

| Identity                     | Designated requirement it produces                                                                                        | Survives a rebuild | Survives the certificate expiring          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------ | ------------------------------------------ |
| **ad-hoc** (default)         | `identifier "com.peakcode.cua-helper"`                                                                                    | yes                | n/a — no certificate                       |
| **Apple Development**        | `identifier "…" and anchor apple generic and certificate leaf[subject.CN] = "Apple Development: name (CERTID)"`           | yes                | **no** — the CN names that one certificate |
| **Developer ID Application** | `identifier "…" and anchor apple generic and certificate leaf[field.…6.1.13] and certificate leaf[subject.OU] = "TEAMID"` | yes                | yes — the team, not the certificate        |

The build picks an identity in this order:

1. `PEAKCODE_CUA_SIGN_IDENTITY` — an explicit override, if set.
2. **Developer ID Application**, if the keychain has one. Anchored _and_ durable, so it wins.
3. **ad-hoc** with an identifier requirement.

**Apple Development is deliberately not auto-selected.** Its requirement pins the individual
certificate, so it works until that certificate is renewed and then silently costs the user
their grant. Auto-picking it would trade a durability the user has today for an anchor they
cannot perceive — the token and the owner-only socket are what actually gate access, not the
anchor.

To use it anyway — for an anchored local build, accepting that it breaks at the next renewal:

```bash
PEAKCODE_CUA_SIGN_IDENTITY="Apple Development: kun wang (7F5XR2YQS3)" bun run dev:desktop
```

Two things learned the hard way, now enforced in the build:

- **An identity must never be combined with `--requirements`.** A certificate already produces
  an anchored requirement, and an explicit `identifier "…"` requirement _replaces_ it —
  measured: signing with a certificate plus `--requirements` yields `identifier
"com.peakcode.cua-helper"` and nothing else, quietly discarding the anchor. The flag is now
  attached only for ad-hoc signing, where the alternative is a `cdhash` that changes on every
  rebuild.
- **Switching identity does not invalidate an existing grant.** A requirement of
  `identifier "com.peakcode.cua-helper"` is satisfied by any binary carrying that identifier,
  including a certificate-signed one. Verified by granting under an ad-hoc build, re-signing
  with a certificate, and confirming accessibility still worked. The reverse is not true: a
  grant filed against a certificate-anchored requirement is not satisfied by an ad-hoc build.

A third, found while reading signatures back:

- **`codesign` prints an implicit requirement commented out.** An explicit `--requirements`
  shows as `designated => …`; the requirement a certificate produces — or the one an ad-hoc
  signature gets by default — shows as `# designated => …`. Reading only the first shape makes
  an anchored release signature look like no signature at all, and the install path would then
  "repair" it by replacing it with something weaker.

If the user ever needs to start over — a grant that no longer matches, an identity they want
gone — `tccutil reset Accessibility com.peakcode.cua-helper` clears it for this helper only.

## What the user does once

The desktop app installs and starts the helper at launch. On a fresh install the helper asks
macOS to show its own prompts. The user then adds **Peak Code Computer Use** (not Peak Code)
in both panes:

- System Settings → Privacy & Security → **Accessibility** — reading and acting on controls
- System Settings → Privacy & Security → **Screen Recording** — screenshots

This is once per machine, and it keeps working across rebuilds. `computer` with
`action: "status"` reports the state, and `action: "request_access"` re-opens the prompts.

If a rebuild ever _does_ invalidate the grant, it means the helper's binary was replaced —
check `.helper-build.json` next to the installed helper for the fingerprint it was built from.

## How the helper gets there

Two sources, and the app takes whichever exists:

| Build                   | Where the helper comes from                                                                | Signed with                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Running from a checkout | `apps/desktop/native/computer-use/main.m`, compiled on first launch                        | the best identity the machine has (see above)                                         |
| A packaged `.app`       | the bundle shipped in `Contents/Resources/computer-use`, copied into place on first launch | whatever the release signed it with, or this machine's plan when that was only ad-hoc |

The released copy is built by `scripts/build-desktop-artifact.ts`, through the same recipe the
app uses for its own builds (`packages/shared/src/computerUseHelperBuild.ts`), and shipped
outside the asar — the grant is filed against the bundle, so it has to be a real bundle on disk.

Neither path may touch an install that is already current. The artifact is fingerprinted (its
bytes, the build revision, the identifier and the signing plan) and an install whose fingerprint
still matches is left byte for byte alone. That is the whole reason the grant survives: a helper
that is rewritten is a helper the grant may no longer match. `PEAKCODE_COMPUTER_USE_BUNDLED_HELPER_PATH`
points the install at a specific shipped bundle, which is how the packaged path is tested
without packaging anything.

**The one thing packaging cannot preserve is the requirement.** The ad-hoc packaging step signs
nested bundles with `codesign --deep`, which replaces whatever requirement the helper had with a
hash of that exact binary — and a hash stops matching the moment the helper is rebuilt. So the
install path reads the shipped copy's requirement and keeps it only when it is anchored to a
team; anything else (a `cdhash`, or no signature at all) is replaced with the plan this machine
can actually keep. An anchored signature — what a Developer ID release produces — is kept
exactly as it is, because re-signing it with an ad-hoc identity would swap something
unspoofable for something spoofable.

To exercise that path without a certificate — the test drives both install paths against a
shipped bundle in a temp directory, and touches nothing on the machine:

```bash
cd apps/desktop && bun run test src/computerUseHelper.test.ts
```

The install never sends a request, though: for the real end-to-end check, build an artifact
(`bun run dist:desktop:artifact`) and run the app from the unpacked `.app`, which is what makes
the bundled copy the only source available.

## Where everything lives

| Piece                                    | Path                                                | Why there                                                                 |
| ---------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------- |
| Native helper source                     | `apps/desktop/native/computer-use/main.m`           | macOS app-bundle concerns belong to the desktop package                   |
| Build recipe: compile, sign, fingerprint | `packages/shared/src/computerUseHelperBuild.ts`     | the app and the release script have to agree, or the grant stops matching |
| Install and launch                       | `apps/desktop/src/computerUseHelper.ts`             | content-addressed install; LaunchServices launch                          |
| Release packaging                        | `scripts/build-desktop-artifact.ts`                 | builds the copy a macOS artifact ships                                    |
| Wire contract                            | `packages/shared/src/computerUse.ts`                | paths, framing and method names, defined once                             |
| Socket client                            | `apps/server/src/computer/computerUseClient.ts`     | transport, reconnection, error codes                                      |
| Tool host                                | `apps/server/src/computer/computerTool.ts`          | maps tool params to helper calls                                          |
| Tool declaration                         | `packages/agent-toolkit/src/tools/computerTools.ts` | schema and model-fixable argument checks                                  |
| Skill                                    | `plugins/computer-use/skills/computer-use/SKILL.md` | the model-facing contract                                                 |

Installed at `~/Library/Application Support/peakcode/computer-use/`:

```
Peak Code Computer Use.app   the helper — this is the app the grant is filed against
helper.sock                  owner-only socket the server dials
helper.token                 owner-only token every request must present
.helper-build.json           fingerprint and source, so an unchanged helper is never touched
helper.log                   what the helper did, for when something goes wrong
shots/                       captures, handed to the model as image blocks
```

## Coordinates: two numbers, not one

Every input verb takes screen **points**. Every capture produces **pixels**. The model reads a
coordinate off the image and passes it through unchanged, so the transform lives where the image is
known — and it needs two numbers, not one:

```
screen point = capture origin + pixel / scale
```

- **The origin** is where the image started: the window's own corner for a window capture, the
  display's origin for a full-screen one. Leaving it out put every click off by the distance from
  the screen's corner to that window — and since a window capture is what `screenshot` does by
  default when it is given an app, that was the common case rather than the exotic one.
- **The scale** is per display: a retina laptop beside a 1x monitor has two different answers, and
  the main screen's is wrong on one of them. The helper computes it from the display the captured
  content is actually on (its pixels over its points) instead of asking for a number and trusting it.

`displays` exists so this is auditable: each display's bounds, pixels and scale, in the same point
space that `click` and the accessibility tree use. `list_windows` reports window bounds in that
space too, which is why a click can be aimed at a window's rectangle directly, and why
`list_windows` → `screenshot` (`window_id`) → `click` is a coherent path for a window that is not
in front.

## What it can do

| Verb                                    | What it is for                                                                          |
| --------------------------------------- | --------------------------------------------------------------------------------------- |
| `status`, `request_access`              | Which grants are in place, and asking macOS for its prompts                             |
| `list_apps`, `list_windows`, `displays` | What is running, what is on screen, and the coordinate space itself                     |
| `get_state`, `act`                      | The accessibility tree, and acting on it by ref — no pointer, no focus change           |
| `open_app`                              | Launching or foregrounding an app                                                       |
| `click`, `drag`, `scroll`               | Real pointer input: a point, a gesture with a path, wheel movement                      |
| `type`, `key`                           | Real keyboard input: literal text, one gesture with `strategy: "paste"`, or a chord     |
| `read_clipboard`, `write_clipboard`     | Text the user or an app put there, and text to hand over                                |
| `screenshot`                            | The display or one window, as an image block, with the geometry to read coordinates off |

A few choices worth knowing about:

- **`scroll` before concluding anything is missing.** A tree only describes what is visible, so a
  short list or an absent button is usually content that has not been brought into view. Scrolling
  is also the one verb that _has_ to move the pointer when it is aimed at a point: the window
  server routes wheel events by where the pointer is, not by what the event says.
- **`type` has two strategies.** `keys` posts a unicode key event per character — faithful, and what
  a person pressing keys does. `paste` puts the text on the clipboard and presses ⌘V: one gesture
  instead of hundreds, and immune to an input method reinterpreting it, which is why it is the
  better path for long text and for CJK. It saves and restores the user's clipboard around the
  paste; an app that reads the pasteboard lazily (on save, rather than on ⌘V) can still miss it,
  which is why `keys` stays the default.
- **The clipboard is a first-class verb, not a secret behind `type`.** `read_clipboard` is the
  cheapest way to get text a GUI produced, and `write_clipboard` is how text is handed to an app
  whose interface wants a paste.
- **A handler's bug answers instead of killing the helper.** Objective-C exceptions terminate the
  process, so dispatch is wrapped: a handler that throws returns `internal_error` naming it, keeps
  the detail in `helper.log`, and leaves the helper serving every other client. Found the hard way —
  a `[NSPasteboardItem copy]` that threw took the helper down mid-verification, and the client that
  asked for it saw a closed socket.

## Design notes

**Accessibility first, real input second.** `act` addresses elements by ref and goes through the
accessibility API: precise, and no pointer movement or focus change. `click`/`drag`/`scroll`/
`type`/`key` post real events and do move the user's pointer and type into their focus, so the tool
schema and the skill both say so, and the approval prompt covers the whole class.

**Refs are not durable.** A ref names a position in one tree, so the helper keeps only the
latest observation and refuses a ref from an older one. Keeping the mapping next to the
elements is what makes a stale ref detectable rather than silently wrong.

**Sparse trees are the interesting case.** Some apps publish almost nothing until a client
asks. When a walk comes back with fewer than a handful of elements the helper sets
`AXEnhancedUserInterface` and `AXManualAccessibility` and walks again — without that, those
apps look like four unnamed nodes and a caller is pushed to coordinate clicking for no reason.

**A walk is bounded twice.** Per-call messaging timeout and an overall deadline. Every
attribute read is a round trip into another process, so an app that has stopped answering
would otherwise hold the socket; a partial tree, clearly labelled as partial, is a much better
answer than a hang.

**Capture goes through `/usr/sbin/screencapture`.** `CGWindowListCreateImage` is obsoleted in
macOS 15 and the SDK refuses it; ScreenCaptureKit is asynchronous and would need the app's
event loop for a screenshot. `screencapture` is Apple's own tool for the job, and as a child
of the helper it captures under the helper's Screen Recording grant.

## Demonstrating it

Start the desktop app, then ask the agent to do something that lives only in a GUI — for
example:

> Open Finder's Downloads folder and tell me what's in it, without using the shell.

What to watch for in the transcript:

1. `computer` with `action: "get_state"` returning a tree of the window — role, name,
   position, and the actions each element supports.
2. `computer` with `action: "act"` on a ref, returning a receipt.
3. `get_state` again, because the receipt is not the result.

If a call reports that a permission is missing, the model is instructed to tell you which one
and stop rather than retry — that is the intended behaviour, not a failure.

## Troubleshooting

| Symptom                                      | Cause                                                                                                                                              |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `computer` is not offered at all             | The server did not find a live helper at start-up. Check the desktop app is running and `helper.sock` exists.                                      |
| Every action reports `accessibility_denied`  | The grant is missing or was invalidated. `action: "request_access"`, then check System Settings.                                                   |
| Screenshots report `screen_recording_denied` | Screen Recording not granted. macOS often needs the helper restarted after granting.                                                               |
| The tool answers "protocol mismatch"         | A helper from an older install is still running. Restart the desktop app: it reinstalls and relaunches the helper.                                 |
| A verb answers "unknown method"              | The same thing from the other side — the running helper is older than the app, from before that verb existed. Restart the desktop app.             |
| A newer helper than the app                  | Fine, and not an error: every version so far has been additive, so the extra verbs simply go uncalled. Only an _older_ helper is refused.          |
| A call answers `internal_error`              | A handler inside the helper threw. The helper is still serving, `helper.log` names what happened, and repeating the same call is unlikely to help. |
| A tree comes back partial                    | The app stopped answering accessibility or hit the element ceiling. Not an error in itself.                                                        |

`helper.log` next to the installed helper is the first place to look; the client logs any call
that takes more than a second or fails.

## Not done

- **A Developer ID release has not been exercised.** The code prefers an anchored signature and
  keeps it, but this machine has no Developer ID certificate, so what has actually been run is
  the ad-hoc path: the release builds an ad-hoc helper, the packaging step's `--deep` re-signs
  it, and the install replaces that hash requirement with the identifier one. A signed release
  needs one pass to confirm the shipped signature survives the install untouched.
- **Background input.** ZCode uses SkyLight to post window-scoped input without moving the real
  cursor. This helper posts through `CGEventPost` instead: simpler and public, but it takes the
  user's focus, and a scroll aimed at a point has to move the pointer for the event to land there
  at all. `act` avoids the problem for anything the tree can express.
- **Gestures beyond one pointer.** A drag is one button following one path — pinch, rotate, swipe and
  multi-finger gestures are not expressible through `CGEventPost`, and no verb pretends otherwise.
- **Windows and Linux.** The tool is macOS-only, and is not registered elsewhere.
