// FILE: gitCommandErrors.ts
// Purpose: Builds GitCommandError values and explains blocked working-tree operations.
// Layer: Server Git service

import { Layer, Schema } from "effect";

import { commandLabel, quoteGitCommand } from "./gitOutputParsing.ts";

import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";

import { GitCommandError } from "./Errors.ts";
import { GitCore, type ExecuteGitInput } from "./Services/GitCore.ts";

export function createGitCommandError(
  operation: string,
  cwd: string,
  args: readonly string[],
  detail: string,
  cause?: unknown,
): GitCommandError {
  return new GitCommandError({
    operation,
    command: commandLabel(args),
    cwd,
    detail,
    ...(cause !== undefined ? { cause } : {}),
  });
}

export const DIRTY_WORKTREE_PATTERN =
  /Your local changes to the following files would be overwritten by (?:checkout|merge):\s*([\s\S]*?)Please commit your changes or stash them/;
export const UNTRACKED_OVERWRITE_PATTERN =
  /The following untracked working tree files would be overwritten by (?:checkout|merge):\s*([\s\S]*?)Please move or remove them/;

export function parseDirtyWorktreeFiles(stderr: string): string[] | null {
  const match = DIRTY_WORKTREE_PATTERN.exec(stderr) ?? UNTRACKED_OVERWRITE_PATTERN.exec(stderr);
  if (!match?.[1]) return null;
  const files = match[1]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return files.length > 0 ? files : null;
}

export function explainPullBlockedByLocalChanges(error: GitCommandError): string | null {
  const files = parseDirtyWorktreeFiles(error.detail);
  if (!files) return null;
  const fileList = files.map((file) => `  - ${file}`).join("\n");
  return `Local changes block pull. Commit or stash these files first:\n${fileList}`;
}

export function toGitCommandError(
  input: Pick<ExecuteGitInput, "operation" | "cwd" | "args">,
  detail: string,
) {
  return (cause: unknown) =>
    Schema.is(GitCommandError)(cause)
      ? cause
      : new GitCommandError({
          operation: input.operation,
          command: quoteGitCommand(input.args),
          cwd: input.cwd,
          detail: `${cause instanceof Error && cause.message.length > 0 ? cause.message : "Unknown error"} - ${detail}`,
          ...(cause !== undefined ? { cause } : {}),
        });
}
