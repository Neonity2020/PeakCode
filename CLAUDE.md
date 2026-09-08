# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Task Completion Requirements

- All of `bun fmt`, `bun lint`, and `bun typecheck` must pass before considering tasks completed.
- Treat `bun fmt`, `bun lint`, and `bun typecheck` as heavyweight workspace checks: bundle them into one final verification pass per task whenever possible, and avoid rerunning the full set repeatedly during iteration.
- If a user asks for a small follow-up right after a recent full verification pass, prefer no rerun or the smallest reasonable re-check unless the user explicitly asks for full validation again.
- NEVER run `bun test`. Always use `bun run test` (runs Vitest).

## Commands

```bash
# Development
bun run dev              # full dev mode (server + web, via scripts/dev-runner.ts)
bun run dev:server       # server only
bun run dev:web          # web only
bun run dev:desktop      # desktop (Electron) dev mode
bun run electron:dev     # Electron with isolated home dir

# Build
bun run build            # full monorepo build (turbo)
bun run build:contracts  # build contracts only (other packages depend on it)

# Test — always use bun run test, never bun test
bun run test                        # full test suite (turbo)
bunx --bun vitest run path/to/file  # run a single test file
bunx --bun vitest run -t "pattern"  # run tests matching a pattern

# Lint & Format
bun fmt                  # oxfmt
bun fmt:check            # oxfmt --check (CI)
bun lint                 # oxlint
bun typecheck            # full monorepo typecheck (turbo)

# Desktop distribution
bun run dist:desktop:dmg       # macOS .dmg
bun run dist:desktop:linux     # Linux AppImage
bun run dist:desktop:win       # Windows NSIS installer

# Clean
bun run clean            # remove all node_modules, dist, .turbo
```

## Monorepo Architecture

Peak Code is a Bun monorepo (`packageManager: bun@1.3.9`) using Turborepo and Effect-TS throughout. The `catalog` system in `package.json` pins all Effect packages to the same snapshot (from `pkg.pr.new`) to avoid version skew. The linker is `isolated` (`bunfig.toml`), meaning each package has its own `node_modules`.

### Package Roles

- **`apps/server`**: Node.js WebSocket server. Wraps the Pi provider agent, serves the React web app, and manages provider sessions. Built entirely on Effect-TS.
- **`apps/web`**: React 19 / Vite 8 UI. Session UX, conversation/event rendering, terminal (xterm), and client-side state via zustand. Connects to the server through WebSocket. Uses TanStack Router and React Query.
- **`apps/desktop`**: Electron 40 wrapper. Bundles the server + web app into a desktop application. Uses `electron-updater` for auto-updates.
- **`apps/marketing`**: Marketing/landing page site.
- **`packages/contracts`**: Shared Effect/Schema schemas and TypeScript contracts for provider events, the WebSocket RPC protocol, model/session types, and IPC messages. Schema-only — no runtime logic. Build this first (`bun run build:contracts`) before working on dependent packages.
- **`packages/shared`**: Shared runtime utilities consumed by both server and web. Uses explicit subpath exports (e.g. `@t3tools/shared/git`) — no barrel index.
- **`packages/effect-acp`**: Effect-TS wrapper around the Agent Communication Protocol (ACP). Provides typed client/server abstractions for agent communication.
- **`scripts`**: Build and development tooling — `dev-runner.ts` (orchestrates dev mode), `build-desktop-artifact.ts`, `release-smoke.ts`.

## Effect-TS Architecture (Critical)

The server is built on Effect-TS with a strict **Layers/Services** pattern. Understanding this is essential:

### Effect ServiceMap Pattern

The server uses `ServiceMap.Service` (a custom subclass of `Context.Tag`) throughout. Every service is defined as a tag with a shape interface:

```typescript
// Services define the interface
export class ServerLifecycleEvents extends ServiceMap.Service<ServerLifecycleEvents, Shape>()(
  "tag",
) {}
```

Services are consumed with `yield*` inside `Effect.gen`:

```typescript
const result =
  yield *
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const lifecycle = yield* ServerLifecycleEvents;
    // ...
  });
```

### Layers Pattern

Every module has a `Layers/` and `Services/` directory:

- **`Services/`**: Defines the service interface (class extending `ServiceMap.Service`) and the shape type.
- **`Layers/`**: Contains `Layer` implementations (`FooLive`) that provide the service. Layers wire together via `Layer.provide`, `Layer.provideMerge`, and `Layer.mergeAll`.

Top-level composition happens in `apps/server/src/serverLayers.ts` and `apps/server/src/effectServer.ts`. This is where all subsystem layers are assembled into the final runtime.

### Key Subsystems

| Subsystem     | Directory        | Purpose                                                                     |
| ------------- | ---------------- | --------------------------------------------------------------------------- |
| Provider      | `provider/`      | Multi-provider abstraction — spawns/manages provider app-server processes   |
| Orchestration | `orchestration/` | Event-sourced domain: command ingestion → event store → projection pipeline |
| Persistence   | `persistence/`   | SQLite via Effect SQL — migrations, repositories, query layers              |
| Checkpointing | `checkpointing/` | Git diff-based checkpoints for agent work                                   |
| Git           | `git/`           | Git operations — worktrees, branches, PR workflows                          |
| Terminal      | `terminal/`      | PTY management — shell sessions streamed over WS                            |
| Workspace     | `workspace/`     | File system operations, workspace entries, LSP integration                  |
| Auth          | `auth/`          | Pairing-based auth, bearer tokens, credential management                    |
| Automation    | `automation/`    | (New) Scheduled/triggered automation scripts                                |
| Environment   | `environment/`   | Server environment variable management                                      |
| Telemetry     | `telemetry/`     | Analytics and usage tracking                                                |
| Project       | `project/`       | Project-level operations (favicon, file search, etc.)                       |

### Orchestration System (Event Sourcing + CQRS)

The orchestration domain uses event sourcing:

1. **Command ingestion** — client commands arrive via WebSocket RPC → `ProviderCommandReactor`/`ProviderRuntimeIngestion`
2. **Event store** — `OrchestrationEventStore` persists raw domain events in SQLite
3. **Projection pipeline** — `ProjectionPipeline` replays events into read-optimized projection tables
4. **Snapshot query** — `ProjectionSnapshotQuery` serves snapshot views to the UI
5. **Reactor pattern** — `OrchestrationReactor`, `CheckpointReactor`, `ThreadDeletionReactor` react to events and drive side effects

The orchestration event types and commands are defined in `packages/contracts/src/orchestration.ts`.

### Provider Adapter System

The provider is wrapped by the `PiAdapter` (in `provider/Layers/PiAdapter.ts`, service tag in `provider/Services/PiAdapter.ts`). It drives the Pi coding agent SDK (`@earendil-works/pi-coding-agent`) directly — no external CLI app-server subprocess.

The single adapter conforms to the common interface (`ProviderService`). The `ProviderAdapterRegistry` handles adapter lookup, `ProviderDiscoveryService` reports Pi availability, and `ProviderHealth` checks Pi install/auth status. Pi is the only supported provider.

### Persistence & Migrations

Uses `effect/unstable/sql` with SQLite (Bun's built-in SQLite). Migrations are defined as TypeScript files in `persistence/Migrations/` and statically imported in `persistence/Migrations.ts` — no dynamic file loading. They run via `Migrator.make` with `fromRecord`.

Each migration is numbered and named: `001_OrchestrationEvents.ts`, `002_OrchestrationCommandReceipts.ts`, etc. Migrations run automatically on server startup before any queries execute.

## WebSocket RPC Protocol

Client-server communication uses `effect/unstable/rpc` over WebSocket:

- **Contract definitions**: `packages/contracts/src/rpc.ts` — defines all RPC methods, channels, and payloads using Effect Schema
- **Server RPC handler**: `apps/server/src/wsRpc.ts` — implements all RPC methods, streams orchestration events
- **Client transport**: `apps/web/src/wsNativeApi.ts` — typed client that calls RPC methods
- **WS protocol**: `packages/contracts/src/ws.ts` — WebSocket-specific types (welcome, channels, methods)

The RPC system uses `RpcGroup` for grouping related methods and supports both request/response and server-push streaming patterns. Provider events and orchestration state changes are pushed to the client via WS channels.

## Project Snapshot

Peak Code is a minimal web GUI for using the Pi coding agent.

This repository is a VERY EARLY WIP. Proposing sweeping changes that improve long-term maintainability is encouraged.

## Core Priorities

1. Performance first.
2. Reliability first.
3. Keep behavior predictable under load and during failures (session restarts, reconnects, partial streams).

If a tradeoff is required, choose correctness and robustness over short-term convenience.

## Maintainability

Long term maintainability is a core priority. If you add new functionality, first check if there is shared logic that can be extracted to a separate module. Duplicate logic across multiple files is a code smell and should be avoided. Don't be afraid to change existing code. Don't take shortcuts by just adding local logic to solve a problem.

## Pi Coding Agent (Important)

Peak Code is Pi-only. The server drives the Pi coding agent SDK (`@earendil-works/pi-coding-agent`) through `provider/Layers/PiAdapter.ts`, then streams structured events to the browser through WebSocket push messages.

How we use it in this codebase:

- Pi session lifecycle (startup/resume/turns) is brokered in `apps/server/src/provider/Layers/PiAdapter.ts`.
- Provider dispatch and thread event logging are coordinated in `apps/server/src/providerManager.ts`.
- Web server consumes orchestration domain events via WebSocket push on channel `orchestration.domainEvent` (provider runtime activity is projected into orchestration events server-side).

Docs:

- Pi SDK: `@earendil-works/pi-coding-agent` (used directly in `provider/Layers/PiAdapter.ts`).

## Environment Variables

Key env vars (see `turbo.json` for the full list):
| Variable | Purpose |
|---|---|
| `PEAKCODE_HOME` | Base directory for data (state, DB, settings, logs) |
| `PEAKCODE_MODE` | `web` or `desktop` |
| `PEAKCODE_PORT` | Server port (default: 3773) |
| `PEAKCODE_AUTH_TOKEN` | Bearer token for API access |
| `PEAKCODE_NO_BROWSER` | Skip opening browser on startup |
| `PEAKCODE_LOG_WS_EVENTS` | Log raw WebSocket events |

## Reference Repos

- Pi coding agent (the SDK Peak Code drives): https://github.com/earendil-works/pi-coding-agent
- Codex-Monitor (Tauri, strong reference implementation for agent-wrapping UX): https://github.com/Dimillian/CodexMonitor

Use these as implementation references when designing protocol handling, UX flows, and operational safeguards.
