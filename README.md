<p align="center">
  <img src="./assets/prod/black-universal-1024.png" alt="Peak Code" width="128" />
</p>

<h1 align="center">Peak Code</h1>

<p align="center">
  <strong>A local-first desktop and web GUI for the Pi coding agent.</strong><br />
  Streaming, diffs, boards and scheduled runs around one agent — all on your machine.
</p>

<p align="center">
  <a href="./README.zh.md">中文</a> •
  <a href="https://github.com/PeakCode-AI/PeakCode/blob/main/LICENSE">
    <img src="https://img.shields.io/github/license/PeakCode-AI/PeakCode?style=flat-square" alt="License" />
  </a>
  <a href="https://github.com/PeakCode-AI/PeakCode/stargazers">
    <img src="https://img.shields.io/github/stars/PeakCode-AI/PeakCode?style=flat-square" alt="Stars" />
  </a>
  <a href="https://discord.gg/jn4EGJjrvv">
    <img src="https://img.shields.io/discord/1354019574017490975?style=flat-square&logo=discord&logoColor=white&label=Discord&color=5865F2" alt="Discord" />
  </a>
  <a href="https://github.com/PeakCode-AI/PeakCode/releases">
    <img src="https://img.shields.io/github/v/release/PeakCode-AI/PeakCode?style=flat-square&label=Release" alt="Release" />
  </a>
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> •
  <a href="#features">Features</a> •
  <a href="#architecture">Architecture</a> •
  <a href="#contributing">Contributing</a>
</p>

---

![Peak Code screenshot](./assets/prod/readme-screenshot.png)

## Why Peak Code?

A coding agent is most useful when you can watch it work, steer it mid-turn, and come back to the run
tomorrow. A terminal gives you none of that. Peak Code puts one agent — [Pi](https://github.com/earendil-works/pi) —
behind an interface built for that loop:

- **Plan before it edits** — the composer carries the interaction mode (Agent, Plan, Goal) with every
  message, so a request can come back as a plan you accept instead of a diff you revert.
- **Every run stays reviewable** — turns stream live, each one records a git checkpoint, and the diff
  panel shows what a turn changed.
- **Work outlives the session** — conversations, boards and scheduled runs are files and tables on your
  machine, not state inside a vendor's cloud.
- **Bring your own models** — Pi's own `models.json` is editable in-app, so any OpenAI-, Anthropic- or
  Google-compatible endpoint works.
- **Runs where your code is** — a desktop app (macOS, Windows, Linux) or a web server you self-host.

## Quick Start

### Desktop App (Recommended)

Download from [Releases](https://github.com/PeakCode-AI/PeakCode/releases):

| Platform | Format      |
| -------- | ----------- |
| macOS    | `.dmg`      |
| Windows  | `.exe`      |
| Linux    | `.AppImage` |

#### macOS reports the app as damaged

Release builds are not signed with an Apple Developer ID yet, so Apple Silicon macOS
blocks the downloaded app with _"Peak Code (Alpha)" is damaged and can't be opened_.
The download itself is intact — the bundle just carries a quarantine flag and no
notarization ticket. Clear the flag, then open the app from **Applications**:

```bash
# Adjust the path if you installed the app somewhere else
xattr -dr com.apple.quarantine "/Applications/Peak Code (Alpha).app"
```

If macOS still refuses, open **System Settings → Privacy & Security**, scroll to the
blocked-app notice and choose **Open Anyway**.

Signed and notarized builds are produced automatically once the repository holds the
`CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_API_KEY`, `APPLE_API_KEY_ID` and
`APPLE_API_ISSUER` secrets. Until then `.github/workflows/release.yml` logs
`macOS signing disabled (missing one or more Apple signing secrets)` and publishes an
unsigned build.

### From Source

```bash
git clone https://github.com/PeakCode-AI/PeakCode.git
cd PeakCode
bun install
bun run dev
```

Then open **`http://localhost:5733`**.

> **Requirements:** Bun 1.3.9+ (the workspace is pinned to `bun@1.3.9`) or Node.js 24+, Git 2.30+, and
> [Pi](https://github.com/earendil-works/pi) with at least one authenticated model. Peak Code runs the Pi
> agent in-process from the bundled `@earendil-works/pi-coding-agent` SDK and reads pi's own config
> directory (`~/.pi/agent`) for models and credentials. A missing or outdated `pi` install shows up in the
> provider status panel, where it can also be updated in place (npm, bun, pnpm or Homebrew).

#### From Source - Windows

On Windows, the server must run on Node.js because Bun does not yet implement ConPTY. The `dev` command handles this automatically. After cloning:

```powershell
# Install dependencies (use public registry if you have a private npm registry configured)
bun install --registry https://registry.npmjs.org

# Build the server (one-time)
bun run build

# Start the dev environment
bun run dev
```

Then open **`http://localhost:5733`** in your browser.

> `bun run dev` auto-detects Windows and runs the Node.js server alongside the Vite frontend — same command as macOS/Linux.

## Features

### One Agent: Pi

Peak Code drives a single agent runtime. Pi is the only provider in the contracts
(`ProviderKind = ["pi"]`), is wrapped by a single adapter, and runs in-process — there is no agent
subprocess to supervise. That is deliberate: the app can then own the parts a terminal cannot, without
re-implementing the agent.

The model is the one thing Pi leaves to you — see [Model Providers](#model-providers) below.

### Run Modes — Agent, Plan, Goal

The composer picks how a turn is handled, and the mode travels with the message:

- **Agent** (default) — the full tool set; the agent works directly on the workspace.
- **Plan** — read-only exploration plus `write_plan`. The workspace stays untouched and the result comes back as a plan you accept.
- **Goal** — the full tool set plus the `goal` tool. The objective and its acceptance criteria are kept in state, and the harness continues the work across turns — within a token budget and a continuation cap — until the goal is completed, dropped, or out of budget.

A goal appears in the composer's goal panel, where it can be paused, resumed, completed or dropped. A goal that ran out of budget shows as `budget-limited`.

A separate runtime mode (Full access / Supervised) decides approvals and sandboxing for the session
itself; see [`.docs/runtime-modes.md`](./.docs/runtime-modes.md).

### Model Providers

Settings → Model Providers edits the `models.json` that the pi runtime loads, so you can point Peak Code at OpenAI-, Anthropic- or Google-compatible endpoints:

- Built-in templates for OpenAI, Anthropic, Google Gemini, OpenRouter, Ollama, DeepSeek and 智谱 AI (GLM), plus a custom provider entry with the `ENV_VAR` / `!shell` API-key hint.
- Add and edit models inline: model id, context window, max output tokens and the input kinds the model accepts (text, image, video, PDF).
- Saving never breaks the file pi loads. pi validates `models.json` strictly and rejects unknown input kinds, so `video`/`pdf` are kept in a key pi ignores, and clearing a field removes it from the saved config instead of writing an empty value.

### Pi Packages

Settings → Pi Packages installs [pi packages](https://github.com/earendil-works/pi/blob/main/docs/packages.md) — extensions, skills, prompt templates and themes bundled behind one source — without leaving the app:

- Both source forms `pi install` accepts: `npm:@scope/pkg` (installed through your global npm prefix) and `git:host/user/repo` (cloned into the pi agent directory), plus local paths.
- The listing shows what each package actually contributes — skills, prompts, extensions, themes — and where it landed on disk.
- Installing writes the source to the same `settings.json` that `pi` itself reads, so the CLI and the app stay in sync. New threads load the package on their next start; an open thread picks it up with `/reload`.
- Extension failures are no longer silent: a package that fails to load, or an extension handler that throws, is reported in the thread as a warning that names the extension.

Ready-made example: **pi-crew** (`npm:@melihmucuk/pi-crew`, or `git:github.com/melihmucuk/pi-crew`) adds six `crew_*` tools for running subagents in parallel while the current turn stays interactive. Its tools, skills and `/pi-crew-plan` / `/pi-crew-review` prompt templates work in Peak Code; its TUI widget, keyboard shortcut and `@`-mention autocomplete are terminal-only and stay inert.

### Skills and Commands

Settings → Skills lists the skills the agent can read, with a switch on each one: turning a skill off keeps
its files on disk but removes it from the per-turn skill list and makes `read_skill` refuse it
(`AGENT_DISABLED_SKILLS`). Skills are imported from the machine's shared skill directories
(`~/.agents/skills`, plus the ones other agents left behind), and Peak Code keeps the
[addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) pack installed at the system level so
the DEFINE → PLAN → BUILD → VERIFY → REVIEW → SHIP workflow is present in every new thread. Themes and two
prompt-engineering skills are ported from [can1357/oh-my-pi](https://github.com/can1357/oh-my-pi) (MIT) —
see [`.docs/oh-my-pi-integration.md`](./.docs/oh-my-pi-integration.md).

Slash commands put the ported skills to work without describing them by hand: `/compress` drives
`semantic-compression`, `/prompt-review` drives `system-prompts`, and `/review-prs` runs this repository's
own gate (`scripts/pr-review.sh`). Each one inserts its instruction into the composer for you to read
before sending.

### Kanban Boards

Every project has a board inside its directory at `.kanban/board.json`, so the app, a coding agent, and any other tooling read and write the same file:

- Columns 待开始 / 进行中 / 已完成 / 已阻塞 / 归档, with drag-and-drop between them.
- Moving a task into 进行中 — or creating it there — dispatches it to an agent. The task's requirement is an agile brief with acceptance criteria, which an agent can draft from the title.
- Run status is written back onto the task: 已完成 on success, 已阻塞 on failure, 待开始 when the run was interrupted.
- The task detail view merges board comments with the agent's own messages from the thread it ran in, and lets you steer or interrupt a running turn. The `kanban_comment` tool lets a dispatched agent leave one comment per finished step on its card.

### Scheduled Tasks

An automation is a plan plus one instruction plus the workspace it runs in. When the plan comes due, Peak Code opens a real thread there and sends it the instruction — so every run leaves a conversation behind that you can read, continue, or hand to someone else:

- Three plans — **once**, **daily** and **weekly** — evaluated as wall-clock times in an IANA timezone, so "every day at 09:00" stays 09:00 across a daylight-saving switch.
- Pick the workspace when the task is created. The run happens in that project, with the project's default model and the mode you picked (Agent, Plan or Goal).
- Each task keeps its run history: how the run ended, a summary of the agent's closing message, and a link into that conversation.
- Pause, resume, or run a task by hand at any time. A one-off switches itself off once it has run, and a trigger missed by more than six hours is rolled forward instead of firing late.
- You can also create one by talking to the agent — "every morning, summarise what changed here" goes through the `schedule_task` tool, which schedules it in the workspace you are already in.

See [`.docs/automations.md`](./.docs/automations.md).

### Git, Diffs and Worktrees

The chat header carries the git actions — commit, push, sync and open a pull request — and the commit
dialog is where staging happens: pick the files that go in, write the message, commit. Pull requests go
through the GitHub CLI.

The diff panel renders a turn's changes or the whole branch against its base, and each turn records a git
checkpoint, which is what "revert this turn" restores. A thread can also run in the project directory or in
its own git worktree, so two agents can work on the same repository without fighting over the working tree;
worktrees are listed and cleaned up from Settings → Worktrees.

### Terminal & Browser

An embedded xterm terminal (backed by real PTYs on the server) is attached to every thread, and the
workspace page gives a terminal its own full-width view. On the desktop build, a browser panel can drive a
page next to the transcript and feed screenshots back into the conversation.

### Session Persistence

Conversations are event-sourced into SQLite (`state.sqlite` under the app's home directory), so threads,
messages, tool runs and approvals survive a restart; a session that was running is resumed from its stored
cursor. Session state is local — nothing in the transcript leaves your machine except the model call.

### Also in the App

- **Appearance** — themes, including 100 pi TUI themes ported from oh-my-pi and a theme-pack editor.
- **English / 简体中文 UI** — full i18n, with Chinese as the default language.
- **Voice input** — dictated prompts transcribed into the composer.
- **Usage and rate limits** — a provider usage panel and rate-limit banners.
- **Notifications** — a desktop notification when a long turn finishes.
- **Subagents, sidechats and forks** — threads that branch off another thread keep their parent link.
- **Auto-update** — the desktop build updates itself through `electron-updater`.
- **Keybindings** — see [KEYBINDINGS.md](./KEYBINDINGS.md).

## Architecture

Peak Code is a Bun monorepo (`bun@1.3.9`, Turborepo, Effect-TS throughout) with a layered
client-server split:

```
Desktop (Electron)  /  Browser
        │  WebSocket — Effect RPC + typed push channels
        ▼
   Node.js server  (Effect-TS layer graph, event-sourced orchestration)
        │  in-process, no subprocess
        ▼
   Pi coding agent  (@earendil-works/pi-coding-agent)
        │
        ▼
   state.sqlite  (projects, threads, events, projections)
```

| Layer              | Key components                                                     |
| ------------------ | ------------------------------------------------------------------ |
| **Presentation**   | React 19 / Vite UI, Zustand stores, TanStack Router + Query        |
| **Application**    | `NativeApi` over WebSocket, typed push channels, wsTransport queue |
| **Domain**         | Orchestration commands/events, projections, reactors, checkpoints  |
| **Infrastructure** | Pi adapter, agent toolkit, git service, PTY service, SQLite store  |

| Package                  | Role                                                                                      |
| ------------------------ | ----------------------------------------------------------------------------------------- |
| `apps/server`            | WebSocket server (`peakcode`), orchestration, provider sessions, serves the built web app |
| `apps/web`               | React UI — sessions, transcript, terminal, boards, automations, settings                  |
| `apps/desktop`           | Electron wrapper that bundles server + web into the desktop app                           |
| `apps/marketing`         | Landing page (Astro)                                                                      |
| `packages/contracts`     | Effect/Schema contracts for provider events, WS protocol, models, kanban — schema only    |
| `packages/agent-toolkit` | The agent harness: tools, plans, goals, approvals, skills, their sqlite store             |
| `packages/shared`        | Runtime utilities shared by server and web (explicit subpath exports)                     |
| `packages/effect-acp`    | Effect-TS wrapper around the Agent Communication Protocol                                 |

Further reading: [`.docs/runtime-modes.md`](./.docs/runtime-modes.md),
[`.docs/automations.md`](./.docs/automations.md),
[`.docs/skills-and-workflow.md`](./.docs/skills-and-workflow.md),
[`.docs/workspace-layout.md`](./.docs/workspace-layout.md),
[REMOTE.md](./REMOTE.md) for self-hosting.

## Development

```bash
# Full dev environment (Web UI + Server)
bun run dev

# Individual services
bun run dev:server         # Server only
bun run dev:web            # Web UI only
bun run dev:desktop        # Desktop app
bun run dev:marketing      # Landing page

# Quality checks
bun run test               # Vitest test suite (never `bun test`)
bun run lint               # oxlint
bun run fmt                # oxfmt formatter
bun run typecheck          # TypeScript type checking

# Desktop distribution
bun run dist:desktop:dmg   # macOS DMG
bun run dist:desktop:linux # Linux AppImage
bun run dist:desktop:win   # Windows installer
```

### Windows Development

`bun run dev` auto-detects Windows and runs the server on Node.js instead of Bun. The workflow is the same as macOS/Linux:

```powershell
# First-time: build the server
bun run build

# Start both frontend and backend
bun run dev
```

Open **`http://localhost:5733`**. After editing server source, rebuild with `bun run build` and restart.

> On Windows, `bun run dev` spawns Vite (via Bun) and the Node.js server as two coordinated processes — no manual terminal juggling or environment variables required.

### Isolated Development

Run alongside an existing Peak Code instance without port conflicts:

```bash
env -u PEAKCODE_AUTH_TOKEN PEAKCODE_PORT_OFFSET=3158 PEAKCODE_NO_BROWSER=1 \
  bun run dev -- --home-dir ./.peakcode-dev --port 58090
```

The server takes port `3773` plus the offset, the web client `5733` plus the offset, and `--port`
overrides the server port. `--home-dir` keeps projects, `state.sqlite` and logs out of your real
`~/.peakcode`. Add `--dry-run` to see the resolved configuration without starting anything.

## Contributing

We welcome contributions! Please read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening issues or PRs.

**Quick guidelines:**

- Keep PRs small (< 200 lines)
- One concern per PR
- Explain _what_ changed and _why_
- Include before/after screenshots for UI changes
- Write tests for new functionality

## Community

- **[GitHub Issues](https://github.com/PeakCode-AI/PeakCode/issues)** — bug reports and feature requests
- **[Discord](https://discord.gg/jn4EGJjrvv)** — questions and day-to-day chatter

If Peak Code helps your workflow, consider giving it a star — it helps others discover the project.

## License

[MIT](./LICENSE) — use it, modify it, ship it.
