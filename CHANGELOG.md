# Changelog

All notable changes to Peak Code are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Run modes in the composer: **Agent** (default), **Plan** and **Goal**. The mode travels with the turn and is kept in thread state. Goal mode stores the objective, its acceptance criteria and a token budget, and the harness continues the work across turns (capped by `AGENT_GOAL_MAX_CONTINUATIONS`) until the goal is completed, dropped, or out of budget; the composer's goal panel can pause, resume, complete or drop it. ([#20])
- Model providers under Settings → Model Providers: a provider rail with built-in and custom groups and status dots, an add-provider form with template picker (OpenAI, Anthropic, Google Gemini, OpenRouter, Ollama, DeepSeek, 智谱 AI) and the `ENV_VAR` / `!shell` key hint. ([#19], [#20])
- Add/edit-model dialog: model id, context window (default `1000000`), max output tokens (default `128000`) and input kinds (text, image, video, PDF). Model rows show context/output badges. ([#20])
- Kanban boards, one per project at `.kanban/board.json`: 待开始 / 进行中 / 已完成 / 已阻塞 / 归档 columns with drag and drop, agent dispatch when a task lands in 进行中 or is created there, requirement briefs an agent can draft from the title, and a task detail view that merges board comments with the agent's messages from the thread it ran in — including steer and interrupt for a running turn. ([#20])
- `@peakcode/agent-toolkit`, the agent harness hosted from the server: tools, plans, goals, approvals, skills, runtime paths, their sqlite store, and migration `040_AgentToolkit`. ([#20])
- Settings navigation split (`SettingsNav`, with the skills panel among its sections) and chat activity rows for plan/goal/approval steps. ([#20])

### Changed

- App identity is unified on `com.peakcode.app` / `com.peakcode.app.dev` across the Electron dev launcher, the Windows AUMID and electron-builder's `appId`, so one app owns its taskbar grouping, shortcuts and notifications. The macOS About panel and the staged installer metadata now read **Peak Code AI**, matching the LICENSE holder. ([#20])
- The server CLI command is `peakcode` instead of `t3`, matching the published bin name. ([#20])
- Documentation covers the new surfaces: README (English and Chinese), `.docs/runtime-modes.md`, `.docs/encyclopedia.md`, `.docs/workspace-layout.md`, `.docs/scripts.md`, and the package tables in `CONTRIBUTING.md`, `CONTRIBUTING.zh.md` and `AGENTS.md`. ([#20])

### Fixed

- Desktop packaging (`bun run dist:desktop:*`) no longer fails on bundled `workspace:` dependencies. tsdown inlines every `@peakcode/*` package into the server bundle, so they are skipped when staging the production install. ([#20])
- The release smoke test derives its workspace manifest fixture from the root `workspaces` globs instead of a hardcoded list, so a newly added package can no longer break the release-only steps by being absent from the fixture. ([#20])
- Cached `.electron-runtime` bundles are re-patched when `LAUNCHER_VERSION` changes, and each patched bundle keeps its own metadata file, so Dev and Alpha can no longer validate against the other variant's stale patch. ([#20])
- Saving a model in the provider settings no longer invalidates the `models.json` that pi loads: `video`/`pdf` are stored in a key pi ignores, and cleared fields are dropped from the saved config instead of being written as empty values. ([#20])

## [0.0.2] - 2026-06-22

### Added

- Claude Fable 5 model option. ([#4])
- Windows dev mode auto-detection: `bun run dev` runs the server on Node.js. ([#6])

### Changed

- Sidebar thread preview limit and empty-project UX. ([#3])
- Fewer redundant tokens sent per turn for the Codex and Claude providers. ([#7])

### Fixed

- Provider health spawn defect handling. ([#1])

## [0.0.1] - 2026-06-09

Initial public release: desktop builds for macOS, Windows and Linux, the Codex provider, and the web GUI.

[Unreleased]: https://github.com/PeakCode-AI/PeakCode/compare/v0.0.2...HEAD
[0.0.2]: https://github.com/PeakCode-AI/PeakCode/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/PeakCode-AI/PeakCode/releases/tag/v0.0.1
[#1]: https://github.com/PeakCode-AI/PeakCode/pull/1
[#3]: https://github.com/PeakCode-AI/PeakCode/pull/3
[#4]: https://github.com/PeakCode-AI/PeakCode/pull/4
[#6]: https://github.com/PeakCode-AI/PeakCode/pull/6
[#7]: https://github.com/PeakCode-AI/PeakCode/pull/7
[#19]: https://github.com/PeakCode-AI/PeakCode/pull/19
[#20]: https://github.com/PeakCode-AI/PeakCode/pull/20
