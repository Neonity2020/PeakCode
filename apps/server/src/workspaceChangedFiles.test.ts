import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { afterEach, assert, describe, it } from "vitest";

import { parsePorcelainV2ChangedFiles } from "./git/gitOutputParsing";
import { listWorkspaceChangedFiles } from "./workspaceChangedFiles";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeFile(cwd: string, relativePath: string, contents: string): void {
  const absolutePath = path.join(cwd, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, contents, "utf8");
}

function runGit(cwd: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || `git ${args.join(" ")} failed`);
  }
}

// Porcelain v2 is NUL-separated; renamed records carry their original path as the next field.
function record(fields: readonly string[]): string {
  return `${fields.join("\0")}\0`;
}

describe("parsePorcelainV2ChangedFiles", () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("maps ordinary index/worktree statuses onto a single label", () => {
    const stdout = record([
      "1 .M N... 100644 100644 100644 abc abc src/modified.ts",
      "1 A. N... 000000 100644 100644 abc abc src/added.ts",
      "1 .D N... 100644 100644 000000 abc abc src/deleted.ts",
    ]);

    assert.deepEqual(parsePorcelainV2ChangedFiles(stdout), [
      { path: "src/modified.ts", status: "modified" },
      { path: "src/added.ts", status: "added" },
      { path: "src/deleted.ts", status: "deleted" },
    ]);
  });

  it("reads the destination path of a rename and skips the original path field", () => {
    const stdout = record([
      "2 R. N... 100644 100644 100644 abc abc R100 src/after.ts",
      "src/before.ts",
      "1 .M N... 100644 100644 100644 abc abc src/trailing.ts",
    ]);

    assert.deepEqual(parsePorcelainV2ChangedFiles(stdout), [
      { path: "src/after.ts", status: "renamed" },
      { path: "src/trailing.ts", status: "modified" },
    ]);
  });

  it("keeps paths containing spaces intact", () => {
    const stdout = record(["1 .M N... 100644 100644 100644 abc abc docs/my file.md"]);

    assert.deepEqual(parsePorcelainV2ChangedFiles(stdout), [
      { path: "docs/my file.md", status: "modified" },
    ]);
  });

  it("reports untracked files and ignores ignored entries", () => {
    const stdout = record(["? new.txt", "! ignored.log"]);

    assert.deepEqual(parsePorcelainV2ChangedFiles(stdout), [
      { path: "new.txt", status: "untracked" },
    ]);
  });

  it("reports unmerged entries as conflicted", () => {
    const stdout = record(["u UU N... 100644 100644 100644 100644 abc abc abc src/conflict.ts"]);

    assert.deepEqual(parsePorcelainV2ChangedFiles(stdout), [
      { path: "src/conflict.ts", status: "conflicted" },
    ]);
  });

  it("skips branch headers and empty records", () => {
    const stdout = record([
      "# branch.head main",
      "",
      "1 .M N... 100644 100644 100644 abc abc a.ts",
    ]);

    assert.deepEqual(parsePorcelainV2ChangedFiles(stdout), [{ path: "a.ts", status: "modified" }]);
  });
});

describe("listWorkspaceChangedFiles", () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports paths relative to the requested workspace root", async () => {
    const cwd = makeTempDir("peakcode-changed-files-");
    runGit(cwd, ["init", "-q", "."]);
    writeFile(cwd, "src/app.ts", "const a = 1;\n");
    writeFile(cwd, "README.md", "hello\n");
    runGit(cwd, ["add", "-A"]);
    runGit(cwd, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"]);

    writeFile(cwd, "src/app.ts", "const a = 2;\n");
    writeFile(cwd, "src/new-file.ts", "export {};\n");

    const result = await listWorkspaceChangedFiles({ cwd });

    assert.isTrue(result.isGitRepository);
    assert.deepEqual(
      result.files
        .map((file) => ({ path: file.path, status: file.status }))
        .toSorted((a, b) => a.path.localeCompare(b.path)),
      [
        { path: "src/app.ts", status: "modified" },
        { path: "src/new-file.ts", status: "untracked" },
      ],
    );
  });

  it("lists changes from a subdirectory relative to that subdirectory", async () => {
    const cwd = makeTempDir("peakcode-changed-files-subdir-");
    runGit(cwd, ["init", "-q", "."]);
    writeFile(cwd, "packages/app/src/index.ts", "const a = 1;\n");
    runGit(cwd, ["add", "-A"]);
    runGit(cwd, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"]);
    writeFile(cwd, "packages/app/src/index.ts", "const a = 2;\n");

    const result = await listWorkspaceChangedFiles({ cwd: path.join(cwd, "packages/app") });

    assert.deepEqual(result.files, [{ path: "src/index.ts", status: "modified" }]);
  });

  it("reports a non-repository directory without throwing", async () => {
    const cwd = makeTempDir("peakcode-changed-files-plain-");
    writeFile(cwd, "notes.txt", "hello\n");

    const result = await listWorkspaceChangedFiles({ cwd });

    assert.deepEqual(result, { isGitRepository: false, files: [] });
  });
});
