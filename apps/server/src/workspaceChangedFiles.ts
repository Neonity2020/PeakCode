// FILE: workspaceChangedFiles.ts
// Purpose: List the workspace's git-changed files with per-path status for the file explorer.
// Layer: Server workspace utilities
// Exports: listWorkspaceChangedFiles

import { type ProjectListChangedFilesResult } from "@peakcode/contracts";

import { parsePorcelainV2ChangedFiles } from "./git/gitOutputParsing";
import { runProcess } from "./processRunner";

// Mirrors the workspace index builder: keep background fsmonitor/untracked-cache daemons
// out of the loop so a status read stays cheap and side-effect free.
const WORKSPACE_GIT_HARDENED_CONFIG_ARGS = [
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.untrackedCache=false",
] as const;

const GIT_STATUS_TIMEOUT_MS = 10_000;
const GIT_STATUS_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const GIT_REV_PARSE_MAX_OUTPUT_BYTES = 4_096;

const NO_REPOSITORY_RESULT: ProjectListChangedFilesResult = {
  isGitRepository: false,
  files: [],
};

/**
 * Paths come back relative to `cwd`, matching how the file explorer lists directories, so
 * callers can key decorations by the same relative path they render.
 */
export async function listWorkspaceChangedFiles(input: {
  cwd: string;
}): Promise<ProjectListChangedFilesResult> {
  const prefix = await resolveRepositoryPrefix(input.cwd);
  if (prefix === null) {
    return NO_REPOSITORY_RESULT;
  }

  const status = await runProcess(
    "git",
    [
      ...WORKSPACE_GIT_HARDENED_CONFIG_ARGS,
      "status",
      "--porcelain=v2",
      "--untracked-files=all",
      "-z",
    ],
    {
      cwd: input.cwd,
      allowNonZeroExit: true,
      timeoutMs: GIT_STATUS_TIMEOUT_MS,
      maxBufferBytes: GIT_STATUS_MAX_OUTPUT_BYTES,
      outputMode: "truncate",
    },
  ).catch(() => null);

  if (!status || status.code !== 0) {
    return NO_REPOSITORY_RESULT;
  }

  const parsed = parsePorcelainV2ChangedFiles(dropIncompleteTrailingRecord(status.stdout, status));
  const files = [];
  for (const file of parsed) {
    const relativePath = stripRepositoryPrefix(file.path, prefix);
    // Changes outside the requested workspace root are not part of this tree.
    if (relativePath) {
      files.push({ path: relativePath, status: file.status });
    }
  }

  return { isGitRepository: true, files };
}

/**
 * `-z` output is always repository-root relative (the `status.relativePaths` shortcut only
 * applies to the human-readable formats), so the cwd's prefix has to be removed by hand.
 * Returns "" at the repository root and null when `cwd` is not in a work tree.
 */
async function resolveRepositoryPrefix(cwd: string): Promise<string | null> {
  const result = await runProcess("git", ["rev-parse", "--is-inside-work-tree", "--show-prefix"], {
    cwd,
    allowNonZeroExit: true,
    timeoutMs: 5_000,
    maxBufferBytes: GIT_REV_PARSE_MAX_OUTPUT_BYTES,
  }).catch(() => null);

  if (!result || result.code !== 0) {
    return null;
  }

  const [insideWorkTree, prefixLine = ""] = result.stdout.split(/\r?\n/g);
  if (insideWorkTree?.trim() !== "true") {
    return null;
  }
  return prefixLine.trim();
}

function stripRepositoryPrefix(repoRelativePath: string, prefix: string): string | null {
  if (prefix.length === 0) {
    return repoRelativePath;
  }
  if (!repoRelativePath.startsWith(prefix)) {
    return null;
  }
  const relativePath = repoRelativePath.slice(prefix.length);
  return relativePath.length > 0 ? relativePath : null;
}

// A byte-capped read can end mid-record; the trailing partial path would otherwise be
// reported as a change for a file that does not exist.
function dropIncompleteTrailingRecord(
  stdout: string,
  status: { stdoutTruncated?: boolean | undefined },
): string {
  if (!status.stdoutTruncated || stdout.endsWith("\0")) {
    return stdout;
  }
  const lastSeparatorIndex = stdout.lastIndexOf("\0");
  return lastSeparatorIndex === -1 ? "" : stdout.slice(0, lastSeparatorIndex + 1);
}
