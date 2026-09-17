# Scheduled tasks

An automation is a plan plus one instruction plus the workspace it runs in. When the plan
comes due, the server opens a real thread in that workspace and sends it the instruction, so
a scheduled run leaves behind a conversation — not a log line. That conversation is the point
of the feature: you can read what happened, ask follow-up questions, or revert a turn.

## The three plans

| Plan     | Fields                         | Behaviour                                    |
| -------- | ------------------------------ | -------------------------------------------- |
| `once`   | `at` (ISO instant)             | Fires once, then switches itself off.        |
| `daily`  | `hour`, `minute`               | Fires at that wall-clock time every day.     |
| `weekly` | `hour`, `minute`, `daysOfWeek` | Fires on the selected weekdays (0 = Sunday). |

Times are wall-clock times in the task's IANA timezone, so "every day at 09:00" stays 09:00
across a daylight-saving switch. The maths lives in
`packages/shared/src/automationSchedule.ts` and is pure, so the scheduler, the UI and the
agent tool all read the same definitions.

Each task stores a `next_run_at`; the scheduler is a 30-second sweep that compares it against
the clock (`AutomationService.startScheduler`). There is no job queue: a single-machine server
has a handful of tasks at most.

The sweep holds a few deliberate rules:

- **A trigger missed by more than six hours is rolled forward**, not run. The server was
  probably not running at the time, and firing yesterday's 09:00 briefing in the evening is
  worse than skipping it. A `once` task is exempt — it has no next occurrence to roll to.
- **A task already running is not started twice.** The claim is a run row in SQLite, written
  before the thread is created, so a crash in between cannot hand the same plan to two runs.
- **A failed dispatch still advances the plan.** A task whose model is broken must not retry
  every 30 seconds for the rest of the day.
- **A paused task has no `next_run_at`**, which is what keeps it out of the scheduler's query
  entirely.

## What a run is

`AutomationService.run` opens a thread in the task's project (`自动化：<task name>`), dispatches
`thread.create` and `thread.turn.start` with the task's instructions, and records a run row
pointing at that thread. How the run _ended_ is a fact the orchestration events carry, so
`AutomationRunReactor` watches them and writes the outcome — plus the run's closing assistant
message as its summary — back onto the run:

| Event                                            | Outcome       |
| ------------------------------------------------ | ------------- |
| `thread.turn-diff-completed` (status `ready`)    | `succeeded`   |
| `thread.turn-diff-completed` (status `error`)    | `failed`      |
| `thread.turn-diff-completed` (status `missing`)  | `interrupted` |
| `thread.session-set` (`error`)                   | `failed`      |
| `thread.session-set` (`stopped`, no active turn) | `interrupted` |

A session that merely reports `ready` is deliberately **not** an outcome: the provider
announces a freshly started session that way, which would close a run before its first turn
ran. The kanban run reactor uses the same mapping, so both features agree on what "finished"
means.

A goal-mode run is not over at its first turn boundary — the continuation reactor keeps
sending turns — so the outcome is deferred while the thread's goal still wants continuation.

Runs left open by a shutdown are released as `interrupted` when the reactor starts.

## Where tasks come from

- **The Automations page** (`/automations`): a task name, a description of what it should do,
  the workspace, and the plan.
- **A conversation.** The model has a `schedule_task` tool
  (`packages/agent-toolkit/src/agent-tools.ts`), so "every morning, summarise what changed
  here" schedules the task straight from the chat. The tool resolves the workspace from the
  thread it was called in unless the model names another project, and it reports the task id
  and the next run instant back to the model. The implementation is bound to the server in
  `apps/server/src/automation/automationTool.ts`.

The tool is off in Plan mode (it commits the agent to acting later with nobody watching) and
is not approval-gated: it writes the app's own store, exactly like `goal` and `write_plan`.

## Modes

A task carries one of the composer's interaction modes and passes it to its run:

- `default` — the agent works directly on the workspace.
- `plan` — read-only; the run proposes instead of changing anything.
- `goal` — the run works toward an acceptance criterion and keeps itself going across turns.

## Storage and migration

Tasks and runs live in SQLite (`automations`, `automation_runs`). Migration
`041_AutomationSchedules` rebuilt both tables: the earlier shape stored five-field cron
expressions, an `auto | manual` discriminator and three script columns no code path wrote.
The old rows are not converted — a cron string that means "every day at 09:00" can be read
back, but steps, ranges and month fields have no equivalent in the new model, and silently
rewriting a schedule is worse than dropping it.
