# Workspace file explorer

A chat is already attached to a folder — its checkout, or a worktree. This feature makes that
attachment browsable: **Show files** (查看文件) swaps the sidebar for a file tree of that
workspace, and picking a file opens a read-only preview beside the conversation, so you can
check what the agent is about to change without leaving the app.

There are two entry points, because a workspace outlives any one chat:

- The folder icon on a **project row** browses the project root.
- **Show files** in a **thread's** context menu browses that thread's root — the worktree when
  the chat runs in one, which is the whole point for a worktree-backed chat.

The reference for the shape is the same feature in ZCode; what follows is how Peak Code
implements it.

## The three surfaces

| Surface          | Where it lives                               | What it owns                                           |
| ---------------- | -------------------------------------------- | ------------------------------------------------------ |
| Sidebar explorer | `components/files/WorkspaceFilesSidebar.tsx` | Back-to-tasks, search, changed-files filter, the tree. |
| Preview panel    | `components/FileViewerPanel.tsx`             | Tab strip, breadcrumb, file contents.                  |
| Explorer state   | `filesExplorerStore.ts`                      | Which chat owns the sidebar, each chat's open tabs.    |

The panel is a third `ChatRightPanel` (`"browser" | "diff" | "files"`), so it reuses the existing
right-panel plumbing: `singleChatPanelStore` for a single chat, `SplitViewPanePanelState` for a
split pane, and `DiffPanelShell` for the header chrome. Tab state does **not** live in the panel
state — a panel state answers "is the panel open", and mixing a tab list into it would have meant
threading two more fields through every pane reducer. `filesExplorerStore` holds it instead,
keyed by thread id, persisted under `peakcode:files-explorer:v1`.

## Workspace root

The tree's root is `resolveThreadWorkspaceCwd({ projectCwd, envMode, worktreePath })` — the same
resolver the diff panel, checkpoints and the server use, so a worktree chat browses its worktree
and not the project root. `hooks/useThreadWorkspaceContext.ts` wraps that resolution (including
the draft-thread fallback) for panel components, and reports `pending` while a worktree is still
being prepared so the panel can say so instead of showing an empty tree.

## Server surface

Two new RPCs, both rooted at an explicit `cwd`:

- `projects.readFile` → `{ relativePath, kind: "text" | "binary" | "too-large", contents, byteLength }`.
  Paths are contained by `WorkspacePaths.resolveRelativePathWithinRoot` (the same check
  `projects.writeFile` uses), size is checked from `stat` **before** reading so an oversized file
  never reaches the buffer (`PROJECT_READ_FILE_MAX_BYTES`, 256 KB), and content is classified by
  `apps/server/src/workspaceFileContent.ts`: a NUL byte in the first 8 KB means binary, a UTF-8
  BOM is stripped, `binary`/`too-large` results carry no payload at all.
- `projects.listChangedFiles` → `{ isGitRepository, files: [{ path, status }] }`, where `status`
  collapses the porcelain index/worktree pair into `modified | added | deleted | renamed |
untracked | conflicted`.

`projects.listDirectories` (which the tree walks one level at a time) gained a `..` containment
check — it previously resolved the requested path without verifying it stayed inside `cwd`.

Two details in `listWorkspaceChangedFiles` are worth knowing, because both are easy to get wrong:

- **`-z` output is repository-root relative.** The `status.relativePaths` shortcut that makes
  `git status` print cwd-relative paths applies to the human-readable formats only; adding `-z`
  (which we need for unquoted paths) switches paths back to the repository root. The module
  therefore reads `git rev-parse --show-prefix` and strips that prefix, dropping any change that
  lands outside the requested root. That single `rev-parse` also answers "is this a work tree at
  all", so a plain folder reports `isGitRepository: false` instead of an error.
- **Paths may contain spaces**, so the porcelain parser skips a fixed number of single-token
  fields and treats the remainder as the path — `split(" ", n)` truncates rather than keeping the
  remainder, which silently cut `docs/my file.md` down to `docs/my`.

## Decoration and filtering

The tree decorates entries from the changed-file list: files get a status letter (M/A/R/U/D/C),
directories get a neutral dot when any descendant changed. `resolveChangedDirectorySet` walks
each changed path once and collects its ancestors, so a directory check is a set lookup rather
than a scan over every changed file.

The tree refreshes itself at turn boundaries. `thread.turn-diff-completed`, `thread.reverted`
and `thread.conversation-rolled-back` already invalidate the project query caches in
`routes/__root.tsx`; the same flush calls `bumpWorkspaceRevision()` (`lib/workspaceRevision.ts`),
which the tree subscribes to through `useSyncExternalStore`. The tree is a plain per-directory
cache rather than a React Query cache, so this is what keeps a directory the agent just wrote
into from looking unchanged. A refresh re-reads only the levels that are already loaded and
keeps the expansion state, so it costs one `readdir` per visible level and never flickers —
the refresh button does the same thing by hand. Expanding a directory also re-reads it, which
is when a stale level is most likely to be noticed.

The filter button toggles **changed only**, which lists the changed files flat (with their full
parent path) instead of filtering the tree — a changed file can live in a collapsed directory, and
a flat list is both simpler and more informative. The search box uses
`projects.searchEntries`, the same workspace index the composer's `@` mentions use.

## Preview modes

`resolveFilePreviewKind` picks the mode from the extension:

- **markdown** (`.md`, `.mdx`, `.markdown`) renders through `ChatMarkdown`, so a README looks the
  same here as it does in a message, with a Preview/Source toggle.
- **image** (the same allowlist the server's `/api/local-image` route accepts) renders through
  that route via `buildLocalImageUrl`.
- **everything else** renders as code with line numbers through `@pierre/diffs`' `File`
  component — the same highlighter the diff panel uses, wrapped in the shared
  `buildWorkspaceCodeUnsafeCSS` theme bridge so fonts and surface colors match. Files above
  120 KB render as plain text with line numbers instead of tokenizing.

Out-of-band states are explicit rather than blank: `too-large`, `binary`, empty, missing and
read-failure each get their own message, and a failure whose message mentions `ENOENT` is
reported as a missing file.

## Not implemented

Opening a file from anywhere other than its own row — search results, the changed list, a deep
link until the click lands, or the panel reopening later — expands the directories above it
(`resolveDirectoriesToExpand`, which skips ancestors the user already opened so revealing never
collapses anything) and scrolls it into view.

Deliberately out of scope for this pass, all present in the reference implementation: PDF,
Office and pptx previews; writing files back from the panel; revealing a file in a diff; and the
quick-open picker behind the reference's `+` button (here `+` switches the sidebar to the tree
instead). None of them need new architecture — they are additional preview branches in
`FileViewerPanel` or additional actions on the existing RPCs.
