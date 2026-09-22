/**
 * Containment checks used to keep agent/server file access inside a directory.
 *
 * The lexical variant is covered with pure string cases; the symlink-aware variant
 * gets real filesystem cases because its whole point is what `realpath` returns.
 */
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { isPathInside, isPathInsideResolved } from "./pathSafety";

describe("isPathInside (lexical)", () => {
  test("accepts the root itself and descendants", () => {
    expect(isPathInside("/a/b", "/a/b")).toBe(true);
    expect(isPathInside("/a/b/c", "/a/b")).toBe(true);
    expect(isPathInside("/a/b/c/../d", "/a/b")).toBe(true); // normalized
    expect(isPathInside("/a/b/", "/a/b")).toBe(true);
  });

  test("rejects siblings and parents", () => {
    expect(isPathInside("/a/bc", "/a/b")).toBe(false); // no partial-segment match
    expect(isPathInside("/a", "/a/b")).toBe(false);
    expect(isPathInside("/other/b", "/a/b")).toBe(false);
  });

  test("resolves relative inputs against the same cwd", () => {
    expect(isPathInside("b/c", "b")).toBe(true);
    expect(isPathInside("b", "b/c")).toBe(false);
  });

  test("handles a filesystem-root directory without doubling the separator", () => {
    const fsRoot = path.parse(process.cwd()).root;
    expect(isPathInside(fsRoot, fsRoot)).toBe(true);
    expect(isPathInside(path.join(fsRoot, "tmp", "x"), fsRoot)).toBe(true);
  });
});

describe("isPathInsideResolved (symlink-aware)", () => {
  let dir: string;
  let root: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "path-safety-"));
    root = path.join(dir, "root");
    mkdirSync(root);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("accepts real descendants and the root", () => {
    expect(isPathInsideResolved(root, root)).toBe(true);
    expect(isPathInsideResolved(path.join(root, "a", "b"), root)).toBe(true);
  });

  test("rejects paths outside the root", () => {
    expect(isPathInsideResolved(path.join(dir, "outside.txt"), root)).toBe(false);
  });

  test("rejects a symlink that points outside the root", () => {
    const outside = path.join(dir, "outside");
    mkdirSync(outside);
    writeFileSync(path.join(outside, "secret.txt"), "x");
    symlinkSync(outside, path.join(root, "link"));
    // Lexically inside…
    expect(isPathInside(path.join(root, "link", "secret.txt"), root)).toBe(true);
    // …but not where it really resolves.
    expect(isPathInsideResolved(path.join(root, "link", "secret.txt"), root)).toBe(false);
  });

  test("does not let a not-yet-existing target escape through a symlinked parent", () => {
    const outside = path.join(dir, "outside");
    mkdirSync(outside);
    symlinkSync(outside, path.join(root, "link"));
    // File does not exist yet: the nearest existing ancestor is the symlink.
    expect(isPathInsideResolved(path.join(root, "link", "new.txt"), root)).toBe(false);
  });

  test("fails closed when the root does not exist", () => {
    expect(isPathInsideResolved(path.join(dir, "missing", "x"), path.join(dir, "missing"))).toBe(
      false,
    );
  });

  test("matches realpath when the root itself is a symlink", () => {
    const linkRoot = path.join(dir, "root-link");
    symlinkSync(root, linkRoot);
    expect(isPathInsideResolved(path.join(root, "a"), linkRoot)).toBe(true);
    expect(isPathInsideResolved(root, linkRoot)).toBe(true);
    // Sanity: the resolved roots agree.
    expect(realpathSync(linkRoot)).toBe(realpathSync(root));
  });
});
