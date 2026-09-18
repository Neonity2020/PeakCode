# Usage statistics

Settings → 使用统计 is a local token ledger for the whole machine, not just for this app. It
answers one question — where did all my coding agents' tokens go? — with five headline numbers
(累计 Token 数, 峰值 Token 数, 最长聊天时长, 当前/最长连续天数), a year of activity as a calendar
heatmap, a per-model daily trend, the model split, a per-tool breakdown, a token-kind mix, and a
session drill-down that goes all the way to individual requests.

## Where the numbers come from

Every tool keeps its own local session records, and this page reads them directly. Nothing is
uploaded, and nothing is written to the app database.

| Tool             | Records read                                                             |
| ---------------- | ------------------------------------------------------------------------ |
| Claude Code      | `~/.claude/projects/**/*.jsonl`                                          |
| ccmr             | `~/.claude-gateway/projects/**/*.jsonl`                                  |
| Codex            | `~/.codex/sessions/**/*.jsonl`, `~/.codex/archived_sessions/**/*.jsonl`  |
| ZCode            | `~/.zcode/cli/db/db.sqlite` (table `model_usage`, read-only)             |
| WorkBuddy        | `~/.WorkBuddy/projects/**/*.jsonl`                                       |
| Pi               | `<agentDir>/sessions/**/*.jsonl` (`~/.pi/agent/sessions` by default)     |
| OpenCode         | `opencode.db` under `$XDG_DATA_HOME`, `~/.local/share`, `%LOCALAPPDATA%` |
| Grok Build       | `~/.grok/sessions/**/*.jsonl`                                            |
| DeepSeek Harness | `~/.dsh/sessions/**/*.{zst,zstd}` (piped through the `zstd` binary)      |

Tools that were never used still appear in the breakdown, marked 未检测到记录 with the path that
was searched — "installed but unused" and "not installed" are different answers, and the second
one is usually a configuration mistake worth seeing.

## One token convention

Tools disagree about what `input` means, so every parser normalizes to the same rule before
anything is added up:

- `inputTokens` **excludes** cache reads. Anthropic-shaped logs (Claude Code, ccmr, Pi) already
  report it that way; OpenAI-shaped logs (Codex, ZCode, WorkBuddy, OpenCode, Grok) roll the cache
  into `input`, so those subtract it out.
- `cacheReadTokens` / `cacheWriteTokens` are counted separately, and `reasoningTokens` is recorded
  but never added to a total — Pi and OpenCode already count reasoning inside `output`.
- `totalTokens` is the sum of the four, which is why the day, tool and model views always add up to
  the same number.

Per-tool quirks worth knowing, because each one silently corrupts the total if ignored:

- **Claude Code** writes one line per assistant content block, and only the last line of a group
  carries `output_tokens`; records are merged by message id, keeping the largest output.
- **Codex** either writes exact per-turn `token_usage_record`s or a _cumulative_ `token_count`
  counter — per-turn wins when present, otherwise the counter is differenced per file, so a resumed
  session is not counted twice.
- **WorkBuddy** attaches usage to whichever record carried the request, usually a `function_call`,
  and the real model name lives in `providerData.model`, not in the message.

## Scope and retention

Records are read from the last **400 days**, the window the heatmap shows. Sessions are folded as
they are read — a heavy machine logs requests by the million — and the folded result is what stays
in memory, with the request logs of only the most recently active sessions kept for drill-down
(400 sessions, 120 requests each). The panel says when a session's detail has been released instead
of showing an empty table.

## Reading the charts

- The heatmap covers the trailing 53 weeks, Sunday-first, and switches between **每日** (the day's
  own tokens), **每周** (that week's total, so a column reads as one bar) and **累计** (running total
  up to that day). Levels are quantiles over the non-zero values, not linear magnitude — with one
  20-billion-token day in the window, a linear ramp would leave every ordinary day looking empty.
- The tool filter (and the tool breakdown rows) restricts every aggregate below it. The breakdown
  itself always shows all tools, so selecting one never erases the numbers that let you pick
  another.
- The trend chart's **时间范围** toggle (近 7 日 / 近 30 日) is a client-side slice of the same
  response. Models that never spent a token are dropped before the four-series limit.
- The donut folds everything past the fifth model into 其他; **Token 构成** splits the same total into
  input, output and cache traffic.

## Endpoints

| RPC                            | Input                                | Returns                                                                                                                          |
| ------------------------------ | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `server.getUsageStatistics`    | `{ source?, windowDays?, refresh? }` | Totals, the sparse `days` series (each with its per-tool, per-model split), `models`, the `sources` list, and recent `sessions`. |
| `server.getUsageSessionDetail` | `{ source, sessionId, windowDays? }` | That session's request rows, numbered, plus how many older ones retention released.                                              |

A scan is cached for 30 seconds, and unchanged files come back from a per-file cache, so filtering
or reopening the page costs milliseconds; the panel's **刷新** button passes `refresh: true` to
re-read the logs immediately.

## What this deliberately does not do

- **No cost estimates.** The logs barely carry price data (OpenCode's `cost` and Pi's `usage.cost`
  exist but are zero on this machine, ZCode has none), so a money figure would be invented rather
  than measured. Cost belongs behind a price table the user can correct.
- **No quota or balance polling.** Reading a provider's remaining quota means calling its API with
  the user's credentials; this page stays offline and local-only.
- **No menu-bar capsule.** That is a separate surface, not a setting.

| File                                          | Role                                                            |
| --------------------------------------------- | --------------------------------------------------------------- |
| `apps/server/src/usageCollectors.ts`          | Per-tool parsers, the source registry, and the file cache.      |
| `apps/server/src/usageAggregate.ts`           | Folding into day × tool × model rows, with bounded retention.   |
| `apps/server/src/usageStatistics.ts`          | Scope, totals, and the two RPCs.                                |
| `apps/web/src/lib/usageStatistics.ts`         | Formatting, heatmap grid, trend series, donut and bar geometry. |
| `apps/web/src/components/UsageStatsPanel.tsx` | The panel, filter, breakdown and drill-down dialog.             |
