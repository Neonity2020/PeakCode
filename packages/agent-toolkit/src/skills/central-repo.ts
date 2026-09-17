// Central skill library: path resolution (default `~/.agents/skills`) and layout.
//
// The port keeps only what the agent needs — locating a skill directory. The original
// module also maintained a git-backed index in SQLite and a filesystem watcher; that
// belongs to the skills-manager UI, not to the agent's read path.
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { safeJoin, safeName } from "../path-safety.ts";
import { getSetting, updateSettings } from "../runtime/settings.ts";

/** Default location of the central skill library, relative to `$HOME`. */
export const DEFAULT_CENTRAL_SKILLS_DIR = ".agents/skills";
/** Metadata dir inside the central repo (travels with git). */
export const SKILLS_META_DIR = ".agents";

/** Central library root (also the git backup repo root). */
export function getCentralRepoDir(): string {
  const override = getSetting("SKILLS_CENTRAL_PATH")?.trim();
  if (override) return resolve(expandHome(override));
  return join(homedir(), DEFAULT_CENTRAL_SKILLS_DIR);
}

export function expandHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}

/** Directory holding the skills themselves. */
export function getSkillsDir(): string {
  return getCentralRepoDir();
}

/**
 * Directory of one skill in the central library. Returns `null` for an illegal id.
 *
 * The skill id reaches the filesystem from the model (`read_skill`), from the UI, and
 * from remote repos. Without `safeName`/`safeJoin` a `../../..` id turns "read a skill"
 * into "read any file on disk", so anything that is not a plain directory name is refused.
 */
export function centralSkillDir(skillId: string): string | null {
  const id = safeName(skillId);
  return id ? safeJoin(getCentralRepoDir(), id) : null;
}

/** Cross-device metadata directory. */
export function getMetaDir(): string {
  return join(getCentralRepoDir(), SKILLS_META_DIR);
}

/** Temporary clone/import directory. */
export function getTmpDir(): string {
  return join(getCentralRepoDir(), SKILLS_META_DIR, "tmp");
}

export function setCentralRepoPath(p: string): void {
  updateSettings({ SKILLS_CENTRAL_PATH: p.trim() });
}

/** Create the central library on first use. */
export function ensureCentralRepo(): { ok: boolean; dir: string; created: boolean } {
  const dir = getCentralRepoDir();
  if (existsSync(dir)) return { ok: true, dir, created: false };
  try {
    mkdirSync(dir, { recursive: true });
    return { ok: true, dir, created: true };
  } catch {
    return { ok: false, dir, created: false };
  }
}
