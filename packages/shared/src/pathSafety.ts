/**
 * Path containment checks shared by the server and the agent toolkit host.
 *
 * "Is this path inside that directory?" has two genuinely different meanings, so
 * this module exposes two variants instead of one lossy helper:
 *
 * - {@link isPathInside} is purely **lexical**: both sides are normalized with
 *   `path.resolve` and compared segment by segment. Callers that have already
 *   resolved symlinks (for example after `fs.realpath`) must use this — resolving
 *   twice buys nothing and costs syscalls.
 * - {@link isPathInsideResolved} is **symlink-aware**: it resolves the directory
 *   and the nearest existing ancestor of the candidate before comparing. This is
 *   the security-critical form — a symlink planted inside the directory (or the
 *   directory itself being a symlink) must not let a path that really lives
 *   elsewhere be reported as contained.
 *
 * Comparison is case-sensitive. Callers on case-insensitive filesystems that care
 * about case must canonicalize first (`realpath` already does).
 *
 * This module imports `node:fs`, so it is a server-side shared module — the web
 * bundle must not import it (the web-facing shared modules stay node-free).
 */
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";

/**
 * True when `candidate` is `root` itself or lives beneath it.
 *
 * Lexical only — symlinks are not resolved. Use {@link isPathInsideResolved} when
 * the candidate may traverse a symlink.
 */
export function isPathInside(candidate: string, root: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  if (resolvedCandidate === resolvedRoot) return true;
  const prefix = resolvedRoot.endsWith(path.sep) ? resolvedRoot : `${resolvedRoot}${path.sep}`;
  return resolvedCandidate.startsWith(prefix);
}

/**
 * Symlink-resolving containment check.
 *
 * The directory must exist; when it does not, nothing counts as inside it. The
 * candidate may not exist yet (a write target): its nearest existing ancestor is
 * resolved instead, so a symlinked parent directory cannot smuggle the path out of
 * the root. Any filesystem error resolves to `false` — fail closed, never open.
 */
export function isPathInsideResolved(candidate: string, root: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  try {
    if (!existsSync(resolvedRoot)) return false;
    const realRoot = realpathSync(resolvedRoot);
    let probe = resolvedCandidate;
    while (!existsSync(probe)) {
      const parent = path.dirname(probe);
      if (parent === probe) return false;
      probe = parent;
    }
    const realProbe = realpathSync(probe);
    if (realProbe === realRoot) return true;
    const prefix = realRoot.endsWith(path.sep) ? realRoot : `${realRoot}${path.sep}`;
    return realProbe.startsWith(prefix);
  } catch {
    return false;
  }
}
