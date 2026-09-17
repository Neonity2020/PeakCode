<p align="center">
  <img src="./assets/prod/black-universal-1024.png" alt="Peak Code" width="128" />
</p>

<h1 align="center">Peak Code</h1>

<p align="center">
  <strong>The open-source GUI for AI coding agents.</strong><br />
  One beautiful interface for Claude Code, Codex, Gemini, Kilo Code, OpenCode, and more.
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
  <a href="#-quick-start">Quick Start</a> •
  <a href="#-features">Features</a> •
  <a href="https://discord.gg/jn4EGJjrvv">Discord</a> •
  <a href="#-contributing">Contributing</a>
</p>

---

![Peak Code screenshot](./assets/prod/readme-screenshot.png)

## Why Peak Code?

AI coding agents are powerful, but using them through raw terminals is painful. Peak Code gives you a **polished, local-first desktop and web interface** that wraps your favorite AI agents in a unified experience:

- **No more juggling terminals** — manage multiple AI agent sessions in one window
- **Real-time streaming** — watch code being generated, reviewed, and applied live
- **Built-in Git workflows** — branch, commit, push, and review diffs without leaving the app
- **Your code stays local** — everything runs on your machine, nothing touches the cloud

## Quick Start

### Desktop App (Recommended)

Download from [Releases](https://github.com/PeakCode-AI/PeakCode/releases):

| Platform | Format      |
| -------- | ----------- |
| macOS    | `.dmg`      |
| Windows  | `.exe`      |
| Linux    | `.AppImage` |

### From Source

```bash
git clone https://github.com/PeakCode-AI/PeakCode.git
cd PeakCode
bun install
bun run dev
```

> **Requirements:** [Codex CLI](https://github.com/openai/codex), Node.js 24+ or Bun, Git 2.30+, modern browser.

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

### Multi-Agent, One Interface

Seamlessly switch between AI coding providers without changing your workflow:

| Provider       | Status    |
| -------------- | --------- |
| Claude Code    | Supported |
| Codex (OpenAI) | Supported |
| Gemini         | Supported |
| Kilo Code      | Supported |
| OpenCode       | Supported |

### Run Modes — Agent, Plan, Goal

The composer picks how a turn is handled, and the mode travels with the message:

- **Agent** (default) — the full tool set; the agent works directly on the workspace.
- **Plan** — read-only exploration plus `write_plan`. The workspace stays untouched and the result comes back as a plan you accept.
- **Goal** — the full tool set plus the `goal` tool. The objective and its acceptance criteria are kept in state, and the harness continues the work across turns — within a token budget and a continuation cap — until the goal is completed, dropped, or out of budget.

A goal appears in the composer's goal panel, where it can be paused, resumed, completed or dropped. A goal that ran out of budget shows as `budget-limited`.

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

### Kanban Boards

Every project has a board inside its directory at `.kanban/board.json`, so the app, a coding agent, and any other tooling read and write the same file:

- Columns 待开始 / 进行中 / 已完成 / 已阻塞 / 归档, with drag-and-drop between them.
- Moving a task into 进行中 — or creating it there — dispatches it to an agent. The task's requirement is an agile brief with acceptance criteria, which an agent can draft from the title.
- Run status is written back onto the task: 已完成 on success, 已阻塞 on failure, 待开始 when the run was interrupted.
- The task detail view merges board comments with the agent's own messages from the thread it ran in, and lets you steer or interrupt a running turn.

### Scheduled Tasks

An automation is a plan plus one instruction plus the workspace it runs in. When the plan comes due, Peak Code opens a real thread there and sends it the instruction — so every run leaves a conversation behind that you can read, continue, or hand to someone else:

- Three plans — **once**, **daily** and **weekly** — evaluated as wall-clock times in an IANA timezone, so "every day at 09:00" stays 09:00 across a daylight-saving switch.
- Pick the workspace when the task is created. The run happens in that project, with the project's default model and the mode you picked (Agent, Plan or Goal).
- Each task keeps its run history: how the run ended, a summary of the agent's closing message, and a link into that conversation.
- Pause, resume, or run a task by hand at any time. A one-off switches itself off once it has run, and a trigger missed by more than six hours is rolled forward instead of firing late.
- You can also create one by talking to the agent — "every morning, summarise what changed here" goes through the `schedule_task` tool, which schedules it in the workspace you are already in.

### Real-Time Streaming

Watch AI agents work in real-time — see code being written, tools being invoked, and results appearing instantly. No polling, no refreshing.

### Git Integration

Built-in version control with branch management, staging, committing, and pushing — all from the same interface where you interact with AI.

### Session Persistence

Sessions survive restarts. Smart checkpointing captures conversation state so you can pick up exactly where you left off.

### Integrated Terminal & Editor

Embedded terminal for command execution and Monaco-based code editor with syntax highlighting — everything you need without leaving the window.

### Cross-Platform

Available as a native **Electron desktop app** (macOS, Windows, Linux) and a **web application** you can self-host.

## Architecture

Peak Code uses a layered client-server architecture:

```
Browser / Desktop (React + Vite + Electron)
        │ WebSocket
        ▼
   Node.js Server
        │ JSON-RPC over stdio
        ▼
   AI Agent Runtime (codex app-server)
```

| Layer              | Key Components                                         |
| ------------------ | ------------------------------------------------------ |
| **Presentation**   | React UI, Zustand stores, theme system                 |
| **Application**    | Native API, event handlers, WebSocket transport        |
| **Domain**         | Orchestration engine, domain events, state projections |
| **Infrastructure** | Provider service, Git service, terminal service        |

See [`.docs/architecture.md`](./.docs/architecture.md) for the full technical deep-dive.

## Development

```bash
# Full dev environment (Web UI + Server)
bun run dev

# Individual services
bun run dev:server         # Server only
bun run dev:web            # Web UI only
bun run dev:desktop        # Desktop app

# Quality checks
bun run test               # Vitest test suite
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

## Star History

If Peak Code helps your workflow, consider giving it a star — it helps others discover the project.

## License

[MIT](./LICENSE) — use it, modify it, ship it.
