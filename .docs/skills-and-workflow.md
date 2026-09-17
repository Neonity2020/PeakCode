# Skills and the default engineering workflow

Peak Code ships with an engineering workflow that the agent is expected to follow by default,
and the skills that spell that workflow out. This document covers where the skills live, how
they get installed, what the agent is told, and how to turn any of it off.

## Where skills live

The agent reads one shared library: `~/.agents/skills/<skill-id>/SKILL.md` (the same
directory the skills CLI calls the _canonical_ store, and the same one the Skills page lists).
Override the location with the `SKILLS_CENTRAL_PATH` setting.

There is one lookup path, not two: the default pack is _installed into_ that library rather
than read from somewhere else, so a skill the agent can name is a skill that is on disk — and
`read_skill` gives an honest "no such skill" when the pack is not installed yet.

The agent never reads skill bodies into the prompt. It sees a list of `id: description` lines
and pulls a body in on demand with the `read_skill` tool (`file` reads a script or template
inside the skill directory). With a small context window that is the difference between having
skills and not having them.

## The default pack

`addyosmani/agent-skills` (MIT) — 25 skills covering six stages: DEFINE, PLAN, BUILD, VERIFY,
REVIEW, SHIP. Declared in
[`packages/agent-toolkit/src/skills/default-pack.ts`](../packages/agent-toolkit/src/skills/default-pack.ts).

It is installed at the **system level**, through the official skills CLI:

```bash
npx skills add addyosmani/agent-skills --global --agent universal --yes
```

`--agent universal` is deliberate: it is the target whose global directory _is_ the canonical
store, so the files land in `~/.agents/skills`. Naming a specific agent instead (`-a pi`)
would put them in that agent's own directory (`~/.pi/agent/skills`) and the shared library
would stay empty.

The server runs this check once at startup, forked so a slow (or offline) `npx` can never hold
up boot:

- every skill id in the pack is already in the library → nothing happens;
- some are missing → run the CLI once, then re-check the directory (a successful exit code is
  not proof on its own);
- settings say `AGENT_SKILL_PACKS=0` → skipped entirely.

Failures are logged as `default skill pack unavailable` with the reason and the ids that are
still missing. Nothing breaks: the workflow section carries the process itself, and the detail
only lives in the skills.

To update the pack by hand:

```bash
npx skills update --global     # or: npx skills add addyosmani/agent-skills -g -a universal -y
```

## What the agent is told

Two sections are appended to the system prompt on **every turn**, in this order
(`apps/server/src/agentToolkitMode.ts`, `makeToolkitContextExtension`):

1. **The workflow section** (`packages/agent-toolkit/src/skills/workflow.ts`) — the six stages,
   which skill to read at each one, and the judgement call: heavy work (multi-file changes, new
   features, protocol or data-shape changes, hard-to-reproduce bugs, irreversible actions) goes
   through the stages; light work (questions, reading code, one-file fixes, formatting) does
   not. The agent says which it decided and why, in one line.
2. **The skills listing** (`packages/agent-toolkit/src/agent-skills.ts`) — the machine's other
   skills, `id: description` each. The default pack is deliberately **excluded** here: the
   workflow section already names all 25, and listing them twice would push the user's own
   skills out of the window. `read_skill` without a name still lists everything.

Both sections are also what makes the process default rather than suggested: a fresh thread's
first turn already carries them, in every interaction mode (Agent / Plan / Goal).

## Board tasks

A kanban task that lands in 进行中 is dispatched with the board's standing instructions
(`BOARD_RUN_INSTRUCTIONS` in `apps/server/src/kanban/boardDocument.ts`) after the task text:

- move through the workflow, reading the relevant skill at each stage;
- **after each finished step, record it on the card** with the `kanban_comment` tool — what
  finished, what proved it (files, commands, output), what comes next;
- keep questions to a minimum (nobody is watching the conversation), pick a sensible default
  and note the fork and the choice on the card;
- leave the status changes to the board: the run's outcome writes 已完成 / 已阻塞 / 待开始.

The card is resolved from the thread the task was dispatched from
(`apps/server/src/kanban/kanbanTool.ts`), never from tool arguments — a comment cannot be
pointed at someone else's card, and the agent does not have to know any board ids. A
conversation that is not a board task is told so instead of getting a silent success.

`kanban_comment` is registered in every session but is **off in Plan mode** (it writes
`.kanban/board.json`), and it needs no approval prompt: the write target is chosen by the host,
and gating each progress line would defeat the point.

## Turning it off

| Setting                  | Effect                                      |
| ------------------------ | ------------------------------------------- |
| `AGENT_SKILL_WORKFLOW=0` | no workflow section in the system prompt    |
| `AGENT_SKILL_PACKS=0`    | no default-pack install check at startup    |
| `SKILLS_CENTRAL_PATH`    | where the shared skill library is read from |

With the workflow section on but the pack absent, the agent is still told the process and
falls back to following the stage descriptions itself — it does not silently skip the flow.

## Cost

The two sections are roughly 4.5 KB of text per turn (about 1.5k tokens with CJK-heavy text).
On a tight local context window that is real, so `AGENT_SKILL_WORKFLOW=0` is the first knob to
reach for; the skills themselves cost nothing until `read_skill` pulls one in.
