# Bundled Plugins

Peak Code ships some capabilities as **plugins**: a manifest plus one or more skills, listed
in the `/plugins` view and referenceable from the composer with `@`.

Two exist today — `browser-use` and `computer-use` — and they are the pattern to copy.

## What a plugin is here

```
plugins/<name>/
  plugin.json                 the manifest: what the plugin is, what it offers
  skills/<skill-id>/SKILL.md  the agent-facing instructions, plus any files they reference
```

A plugin is **not** a sandbox and not a second process. It carries two things:

- **A manifest**, which is what plugin discovery reports and what the `/plugins` view and
  the composer's `@` menu render.
- **Skills**, which are installed into the shared skill library (`~/.agents/skills`) at
  server startup. Once there they behave like any other skill: the agent sees them in its
  prompt's skill listing, reads a body with `read_skill`, and the composer offers them as
  `$<skill-id>`.

Tools are **not** declared here. A plugin whose capability is backed by an agent tool (like
`browser-use` and the harness's `browser` tool) documents that tool in its skill; a plugin
whose capability is procedural (like `computer-use`) is skills-only. Both are real plugins.

## The manifest

```json
{
  "name": "browser-use",
  "displayName": "Browser Use",
  "shortDescription": "One sentence. Shown in the composer menu and the plugin card.",
  "longDescription": "A paragraph for the plugin detail view.",
  "developerName": "Peak Code",
  "category": "Automation",
  "capabilities": ["browser", "screenshots"],
  "defaultPrompt": ["A sentence the user could send to start using this."],
  "skills": ["browser-use"]
}
```

Rules the generator enforces:

- `name` must equal the directory name — otherwise the plugin is unreachable under the name
  the UI shows.
- `skills` must list at least one id, and each id must have a `skills/<id>/SKILL.md`. A
  plugin that installs nothing is a slot in the UI that does nothing.
- `shortDescription` matters more than it looks: the composer falls back to the source path
  when it is missing, which reads as a file location rather than as a sentence.

## The skill

Standard skill shape: frontmatter with `name` and `description`, then the body.

```markdown
---
name: browser-use
description: One line, at most 160 characters — the prompt listing truncates past that.
---

# Browser Use

...
```

`name` must equal the skill id: the model reaches the skill through that name, and the
composer's `$` token is built from it.

## Adding one

1. Create `plugins/<name>/plugin.json` and `plugins/<name>/skills/<id>/SKILL.md`.
2. Format, then regenerate — **in that order**:

   ```bash
   bun run fmt
   bun scripts/generate-bundled-plugins.ts
   ```

   The order matters because the formatter can rewrite a skill body, and the payload embeds
   the body as it was at generation time.

3. Run `bun run test`. A test fails if the committed payload no longer matches the sources,
   naming the generator to run.

`packages/agent-toolkit/src/plugins/bundled.generated.ts` is generated and is listed in
`.oxfmtrc.json`'s `ignorePatterns`, so the formatter leaves it alone. Do not edit it by hand.

## Why the payload is generated

The server bundle carries TypeScript only, so `plugins/` on disk is not present in an
installed app. The generator embeds the manifests and skill bodies as strings, the skills are
written to the shared library at startup, and the manifests are served to plugin discovery
from memory. This is the same arrangement as `oh-my-pi.bundled.generated.ts`, which embeds
the skills that cannot be fetched from the GitHub pack.

## One consequence to know about

Installation is **create-only**: a skill directory that already exists is left alone, so a
user's own edits to a bundled skill are never clobbered. That is the established contract for
bundled skills, and it has a sharp edge for plugins: **editing a plugin's skill does not
reach anyone who already has it installed.** The manifest changes (they come from memory),
the skill body does not.

For a skill that carries a tool contract — `browser-use` describes ref lifetimes, permission
behaviour and the observe/act loop — that means a change to the contract needs either a new
skill id or a deliberate migration. Treat a bundled skill's body as effectively append-only.

## How it reaches the user

```
plugins/*                    source of truth
  └─ generate-bundled-plugins.ts        embeds manifests + skill bodies
       └─ bundled.generated.ts
            ├─ installBundledSkills()   skills → ~/.agents/skills, at startup
            │    └─ listSkills() → prompt listing + read_skill + /skills view
            └─ PiAdapter.listPlugins()  manifests → plugin discovery
                 └─ ProviderPluginDescriptor
                      ├─ /plugins view → detail view → "use" attaches the plugin
                      └─ composer → mention chips → the turn's mentions
```

The last hop is why `PiAdapter` sets `supportsPluginDiscovery` and `supportsPluginMentions`:
the composer gates its plugin surface on those flags, so a provider that reports no plugin
discovery gets no plugin mentions regardless of what discovery would return.

## Attaching a plugin to a turn

Two ways in, one thing out:

- **Typing `@`** in the composer inserts the plugin's name into the prompt as a mention
  token. The plugin travels with the message because its name is in the text.
- **Picking from the composer's `+` menu** attaches it as a chip — several at a time, and
  alongside images, pasted screenshots and assistant selections, which are unaffected. The
  chip lives on the composer draft (persisted with it), not in the prompt text, so it is
  attached explicitly rather than by name.

The plugin library's detail view has the same action as its main button (see
`useAttachPluginToComposer`): it opens the chat you were last in — or a new one — with the
plugin already on the composer.

Both routes end as `mentions` on the turn's user message, deduped by mention path, so a
plugin named in the prompt _and_ attached as a chip is sent once. See `mergePluginMentions`
in `apps/web/src/components/ChatView.composer.logic.ts`.
