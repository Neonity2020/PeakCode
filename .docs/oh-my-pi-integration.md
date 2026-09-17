# oh-my-pi integration

What Peak Code reuses from [can1357/oh-my-pi](https://github.com/can1357/oh-my-pi) (a fork of
pi, MIT), where it lands in this repository, and why the rest of oh-my-pi is deliberately
left out.

- Upstream commit reviewed: `9b2a43514bfcfc0b9607ac9ac160115aec897f06` (2026-09-14).
- This is a **native** integration: the ported content feeds Peak Code's own theme catalog
  and skill library, not a side directory that has to be installed by hand.

## Category review

oh-my-pi is a full pi fork: a Rust core (`crates/*`), a 31-tool agent runtime
(`packages/coding-agent`), its own TUI, and a small set of `.omp/` developer resources. Only
the last group maps onto anything Peak Code owns.

| oh-my-pi area                                                                              | What it is                                            | Peak Code subsystem                                 | Decision                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/coding-agent/src/modes/theme/`                                                   | 98 default themes + `dark`/`light`, pi TUI JSON       | Web appearance catalog (`apps/web/src/theme`)       | **Port** — map to `ChromeTheme` seeds and expose as `omp-*`                                                                                                                                                                              |
| `.omp/skills/system-prompts/`, `.omp/skills/semantic-compression/`                         | Two prompt-engineering skills, self-contained methods | Skill library (`packages/agent-toolkit/src/skills`) | **Port** as a bundled in-tree payload                                                                                                                                                                                                    |
| `.omp/skills/tool-prompt-optimization/`                                                    | Skill + two probe scripts                             | —                                                   | **Skip** — the scripts import `@oh-my-pi/pi-ai` and instantiate oh-my-pi's own tools                                                                                                                                                     |
| `.omp/commands/{review-prs,fix-issues,triage,release,cleanup}.md`                          | Slash-command prompts                                 | Composer slash commands (pi prompt templates)       | **Skip** — hardcode oh-my-pi's repo layout and its `github`/`irc` tools                                                                                                                                                                  |
| `.omp/tools/tui.ts`, `packages/coding-agent/examples/extensions/`, `docs/skills/examples/` | Extension/tool/hook demos against oh-my-pi's API      | pi extension host                                   | **Skip** — `@ts-nocheck` demos importing `@oh-my-pi/pi-coding-agent`; the one substantive example (a `tool_call` hook blocking `rm -rf /`) duplicates the `DANGEROUS_COMMAND_WILDCARDS` and allow/ask/deny rules Peak Code already ships |
| `packages/coding-agent/src/prompts/**`                                                     | Internal prompt fragments                             | —                                                   | **Skip** — assembled by oh-my-pi's code, not standalone templates                                                                                                                                                                        |
| `crates/*`, most `packages/*`                                                              | Native core, agent runtime, TUI                       | —                                                   | **Skip** — fork internals                                                                                                                                                                                                                |
| `docs/**`                                                                                  | Documentation for oh-my-pi's own features             | —                                                   | **Skip** — prose about its provider/TUI/natives internals, nothing loadable; the runnable examples under `docs/skills/examples/` are covered by the extensions row above                                                                 |

`packages/contracts` is untouched, as required: this work adds no contracts and no runtime
dependencies.

## Integrated files

`oh-my-pi` paths are relative to the oh-my-pi checkout; the rest are relative to this repo.

| #   | Source (oh-my-pi)                                                                                           | Target (Peak Code)                                                                                                                                                      | Shape                                                                    |
| --- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 1   | `packages/coding-agent/src/modes/theme/defaults/*.json` (98), `.../theme/dark.json`, `.../theme/light.json` | `apps/web/src/theme/oh-my-pi.seed.generated.ts`                                                                                                                         | Generated `ChromeTheme` seeds + options, ids `omp-*`                     |
| 2   | `.omp/skills/system-prompts/SKILL.md` + `small-models.md`                                                   | `packages/agent-toolkit/src/skills/oh-my-pi.bundled.generated.ts`                                                                                                       | Embedded payload (installed as `~/.agents/skills/system-prompts/`)       |
| 3   | `.omp/skills/semantic-compression/SKILL.md`                                                                 | `packages/agent-toolkit/src/skills/oh-my-pi.bundled.generated.ts`                                                                                                       | Embedded payload (installed as `~/.agents/skills/semantic-compression/`) |
| 4   | —                                                                                                           | `scripts/generate-oh-my-pi-theme-seeds.ts`                                                                                                                              | Generator for entry 1                                                    |
| 5   | —                                                                                                           | `scripts/generate-oh-my-pi-bundled-skills.ts`                                                                                                                           | Generator for entries 2–3                                                |
| 6   | —                                                                                                           | `packages/agent-toolkit/src/skills/bundled.ts`                                                                                                                          | Create-only installer into the shared skill library                      |
| 7   | —                                                                                                           | `apps/web/src/theme/oh-my-pi.seed.test.ts`                                                                                                                              | Catalog/seed/contrast guards                                             |
| 8   | —                                                                                                           | `packages/agent-toolkit/src/__tests__/skills-bundled.test.ts`                                                                                                           | Installer guards                                                         |
| 9   | —                                                                                                           | `apps/web/src/theme/theme.logic.ts`, `apps/server/src/main.ts`                                                                                                          | Wiring (merge catalog / install at startup)                              |
| 10  | —                                                                                                           | `scripts/lib/oh-my-pi-source.ts`                                                                                                                                        | Shared `--source` parsing, commit lookup, MIT attribution for 4–5        |
| 11  | —                                                                                                           | `scripts/oh-my-pi-source.test.ts`                                                                                                                                       | Guards for the shared plumbing                                           |
| 12  | —                                                                                                           | `packages/agent-toolkit/src/skills/enablement.ts`, `apps/server/src/localSkills.ts`, `apps/web/src/components/SkillsPanel.tsx`, `apps/web/src/localSkillsReactQuery.ts` | Per-skill switch (setting, runtime gates, Settings → Skills toggle)      |
| 13  | —                                                                                                           | `apps/web/src/composerSlashCommands.ts`, `apps/web/src/hooks/useComposerSlashCommands.ts`, `apps/web/src/components/chat/ComposerCommandMenu.tsx`                       | `/compress`, `/prompt-review`, `/review-prs`                             |

### How the mapping works

**Themes.** oh-my-pi themes are pi TUI themes: colors may be hex literals, `vars` references,
or 256-color indices, and the background lives in the optional `export` block. Peak Code's
`ChromeTheme` needs `accent` / `surface` / `ink` / diff colors / skill color. The generator:

- resolves `vars` recursively; palette indices are dropped (no hex equivalent);
- takes `surface` from `export.pageBg`;
- since oh-my-pi's `text` is usually `""` (terminal default), takes `ink` from the first
  foreground token that clears a 4.5:1 contrast ratio against the surface, falling back to
  white/near-black;
- maps `toolDiffAdded` / `toolDiffRemoved` / `mdCode` to the semantic colors;
- sets `contrast` from the variant (45 light / 60 dark). This is the one field with no upstream
  counterpart — oh-my-pi themes carry only `name`/`vars`/`colors`/`export`/`symbols` — so the
  pair is the one the Codex catalog itself uses most, not a mapped value;
- classifies the variant from the surface luminance and namespaces the id `omp-<name>`, so
  `nord` (Peak Code) and `omp-dark-nord` (oh-my-pi) stay distinguishable.

All 100 themes are ported. They are additive: `CODE_THEME_OPTIONS` is `BASE ∪ OH_MY_PI`, the
base ids are never shadowed, and no existing theme changes. They reach the UI through the two
consumers of `getAvailableCodeThemes` — the per-variant `ThemePackEditor` in Settings and the
`SidebarSearchPalette`. The contrast guard alone would not notice a merge that stopped
serving the ported seeds (all 100 ids would quietly render as the default and still pass), so
`oh-my-pi.seed.test.ts` also asserts that every `omp-*` id resolves to its own payload.

Applying a theme goes through `getCodeThemeSeedPatch` rather than the seed directly, and the
`omp-*` ids have no `CODE_THEME_SEED_PATCH_METADATA` entry — so their patch carries `accent` /
`ink` / `semanticColors` / `surface` but leaves `contrast`, `opaqueWindows` and `fonts` at
whatever the previous theme had. That reads like an omission and is not one. The map mirrors
which fields the packaged Codex themes declare (the test calls it "the raw seed fields that
Codex merges"), only 9 of the 28 base themes appear in it, and everything outside it
contributes just those four fields. Two consequences worth knowing before "fixing" it: the
carry-over is what keeps a theme switch from resetting contrast/font choices the user made, and
the values the generator writes for the three gated fields are already the per-variant defaults
(`contrast` 45 light / 60 dark, `opaqueWindows: false`, no font overrides) — so applying any of
the 100 themes from a default state reproduces its seed exactly, and adding metadata entries
would be the change that starts overriding user settings.

**Skills.** The skills CLI cannot fetch oh-my-pi's skills (they live under `.omp/skills`,
which it does not scan), and the built server bundles TypeScript only, so the payload is
embedded as strings. At startup the server writes any missing skill into the shared library
(`~/.agents/skills`), create-only — an existing directory is never overwritten. Once on disk
the skills behave like any other: the agent lists them, `read_skill` opens them, and
`/skill:<id>` resolves. This reuses the `AGENT_SKILL_PACKS` switch.

That one write serves two independent readers, which is why a single install covers both the
tool and the composer. The agent-toolkit reads the library directly (`listSkills()` and
`readSkillFile()`, both rooted at `getCentralRepoDir()`), and pi's own resource loader
auto-scans the same `~/.agents/skills` directory on top of its package skills. Checked in an
isolated `$HOME`: after one install, `readSkillFile` returns all three files byte-identical to
the embedded payload (including the `small-models.md` that `system-prompts` tells the model to
read), and pi's `DefaultPackageManager.resolve()` reports both skills as enabled top-level
entries, which is what `/skill:<id>` can name.

Nothing in code enumerates the bundled ids: discovery happens from disk like any other skill,
so adding or dropping a skill is a change to the generated payload and nothing else. The
workflow section of the system prompt does not name them — but that is not the whole story for
what the model sees, so the effect is worth stating plainly. `skillsPromptSection()` injects
every skill it finds into the per-turn system prompt, minus the default pack
(`defaultPackSkillIds()`), and the two ported skills are _not_ in that pack. Walking the chain
in an isolated `$HOME` with an empty library shows the change exactly:

- before install: `listSkills()` is empty and `skillsPromptSection()` returns `null` — no skill
  section in the prompt at all;
- after install: the section appears and lists both ids, each description truncated to
  `MAX_SKILL_DESCRIPTION_CHARS` (160).

So on a machine that has never installed a skill, the port turns an absent prompt section into
a present one; on a machine that has some, the list grows by two entries. The list is capped at
`MAX_SKILLS_IN_PROMPT` (24), so those two can also push the tail out of the visible list —
still reachable through `read_skill`, and the section says how many were left out.

### Turning a skill off, and the commands that drive one

Two things were added on top of the install so the port is usable rather than merely present.
Both are opt-in: with no setting written and no command typed, the behaviour described above is
exactly what you get.

**Per-skill switch.** Settings → Skills carries a toggle per local skill, stored as
`AGENT_DISABLED_SKILLS` — a JSON array of ids, empty by default, read through
`skills/enablement.ts`. "Off" is enforced in three places so it cannot be half-true:
`skillsPromptSection()` drops the id from the per-turn list, `readSkillFile()` refuses it with a
reason the model can act on, and `workflowPromptSection()` stops naming it per stage — that
section promises `read_skill` can open what it names, so leaving a disabled id in would point
the model at a dead end. The files stay on disk: this is a disable, not an uninstall, and the
startup installer is create-only, so re-enabling costs nothing.

The key is the skill's **directory name** (`LocalUserSkillDescriptor.id`), not the display name
from frontmatter — that is the id `read_skill` resolves, and the two can differ. To make that
hard to get wrong, the descriptor now carries `id` alongside `name` and the server projects
`enabled` from the id; a toggle keyed on the display name would silently do nothing, which
`localSkills.test.ts` pins with a skill whose two names differ.

**Commands.** Three composer commands put the instruction into the input box for review (the
same shape as `/subagents` — they never send on their own):

| Command          | What it drives                                                                     |
| ---------------- | ---------------------------------------------------------------------------------- |
| `/compress`      | `read_skill semantic-compression`, then compress the named text and declare losses |
| `/prompt-review` | `read_skill system-prompts`, then review a prompt against that house style         |
| `/review-prs`    | `bash scripts/pr-review.sh <PR number\|--all\|nothing>` and report its verdict     |

`/review-prs` is the one oh-my-pi command worth adapting, because this repo already owns the
gate it wraps (`scripts/pr-review.sh`, exit 0/1/2). The other four were left out on purpose:
`review-prs`/`fix-issues`/`triage` need GitHub issue tooling and oh-my-pi's own label taxonomy
(Peak Code has neither), and `release` would mean defining a release flow rather than porting
one. The three commands are registered in `COMPOSER_PROMPT_INJECTION_BUILDERS`, which both
dispatch sites read, so adding a fourth means one table entry plus one `buildXPrompt`.

**Generators.** Both scripts read from one checkout, stamp the same upstream commit and MIT
attribution into their header, and are re-run by hand, so that plumbing lives in
`scripts/lib/oh-my-pi-source.ts` rather than being copied into each. It also fixes one
`--source` contract for both (last value wins, missing value fails loudly) instead of the two
slightly different parsers they started with.

The skill bodies are the upstream bytes, so three passages still name oh-my-pi's own CLI, tool
prompts and internal paths. Each is a wrapper, illustration or case study around a method that
does not depend on it — either skill can be followed end to end without resolving any of them —
so they are left in place rather than edited out of third-party text, and the "self-contained"
claim above is about the method, not those lines:

| Where                                                         | What it names                                                                              |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `semantic-compression` "Running it as a command"              | `omp compress <file>`, and `packages/coding-agent/src/compress/prompts/system.md`          |
| `system-prompts/small-models.md` "Case Study: Session Titles" | `packages/coding-agent/src/prompts/system/title-system.md` and `tiny/worker.ts`            |
| `system-prompts` "Surface, not machinery"                     | Tool-prompt examples `read.md`, `lsp.md`, `ast_edit`, `hashline.md` (labelled "this repo") |

Read them as provenance, not as instructions to run. `tool-prompt-optimization` is excluded for
the opposite reason: there the script _is_ the procedure, so an excerpt would be broken rather
than merely annotated.

## Verification

```bash
# Theme catalog: options, seeds, no id shadowing, ink contrast.
(cd apps/web && bun run vitest run src/theme/oh-my-pi.seed.test.ts)

# Bundled skills: payload shape, install, create-only, traversal guard.
(cd packages/agent-toolkit && bun run vitest run src/__tests__/skills-bundled.test.ts)

# Generator plumbing: --source parsing, commit lookup, attribution.
(cd scripts && bun run vitest run oh-my-pi-source.test.ts)

# Regenerate (requires an oh-my-pi checkout). Then `bun fmt`, which normalizes the output.
bun scripts/generate-oh-my-pi-theme-seeds.ts --source /path/to/oh-my-pi
bun scripts/generate-oh-my-pi-bundled-skills.ts --source /path/to/oh-my-pi

# Repo gates.
bun fmt:check && bun typecheck && bun lint
```

Regeneration is expected to be a no-op on a committed tree: both scripts are deterministic, so
running them against the pinned commit and formatting the result must leave the files
byte-identical. A diff there means the vendored content and the script have drifted apart.

## License

oh-my-pi is MIT. The generated files carry the upstream commit in their header. The notice:

> MIT License — Copyright (c) 2025 Mario Zechner, Copyright (c) 2025-2026 Can Bölük,
> Copyright (c) 2026 Stencil Labs, Inc.
>
> Permission is hereby granted, free of charge, to any person obtaining a copy of this
> software and associated documentation files (the "Software"), to deal in the Software
> without restriction, including without limitation the rights to use, copy, modify, merge,
> publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons
> to whom the Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or
> substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
> INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
> PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE
> FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
> OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
> DEALINGS IN THE SOFTWARE.

## Assumptions

- Additive, and opt-out rather than opt-in. Existing flows are untouched — no existing theme
  changes, an existing skill directory is never overwritten — but neither addition is
  something a user asks for: `omp-*` themes appear in the appearance picker as soon as the
  catalog merges, and the two skills are written into `~/.agents/skills` on first boot.
  `defaultSkillPacksEnabled()` is true unless `AGENT_SKILL_PACKS=0`, and that single switch
  also governs the pre-existing default engineering-workflow pack, so it turns off both
  rather than only the bundled skills. The one existing flow that does move is the per-turn
  skill list in the system prompt, which gains both entries (see Skills above) — additive, but
  it is prompt window, so it is named here rather than folded into "nothing changes".
- Porting the whole theme collection (rather than a curated subset) is deliberate: the
  generator is deterministic and reviewable, and deduplication by palette name would wrongly
  drop distinct files (`omp-dark-nord` is not Peak Code's `nord`).
- `tool-prompt-optimization` is the one portable-looking skill held back; its probe scripts
  are the blocker and are recorded above rather than silently dropped.
