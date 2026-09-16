// Skill discovery for the agent's prompt section and `read_skill` tool.
//
// The skills manager in OmniStudio assembles this list from a SQLite index plus per-tool
// sync targets. The agent only ever needs `id` / `name` / `description`, and the central
// library on disk is the source of truth for those, so the port reads SKILL.md frontmatter
// directly and keeps no index.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { getCentralRepoDir } from "./central-repo.ts";

export interface ManagedSkill {
  id: string;
  name: string;
  description: string | null;
  /** Absolute path of the skill directory. */
  dir: string;
}

interface Frontmatter {
  name?: string;
  description?: string;
}

function parseFrontmatter(raw: string): Frontmatter {
  if (!raw.startsWith("---")) return {};
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return {};
  const block = raw.slice(3, end);
  const fields: Frontmatter = {};
  for (const line of block.split("\n")) {
    const match = /^(name|description)\s*:\s*(.*)$/.exec(line.trim());
    if (!match) continue;
    const [, key, rawValue] = match;
    if (key === undefined || rawValue === undefined) continue;
    let value = rawValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key === "name") fields.name = value;
    else fields.description = value;
  }
  return fields;
}

function readSkillMarker(dir: string): string | null {
  for (const marker of ["SKILL.md", "skill.md"]) {
    const candidate = join(dir, marker);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Every skill in the central library. Unreadable entries are skipped rather than
 * throwing: a broken skill in the library must not take down the agent turn.
 */
export function listSkills(): ManagedSkill[] {
  const root = getCentralRepoDir();
  if (!existsSync(root)) return [];

  const skills: ManagedSkill[] = [];
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return [];
  }

  for (const id of entries) {
    if (id.startsWith(".")) continue;
    const dir = join(root, id);
    try {
      if (!statSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }
    const marker = readSkillMarker(dir);
    if (!marker) continue;
    let frontmatter: Frontmatter = {};
    try {
      frontmatter = parseFrontmatter(readFileSync(marker, "utf8"));
    } catch {
      frontmatter = {};
    }
    skills.push({
      id,
      name: frontmatter.name ?? id,
      description: frontmatter.description ?? null,
      dir,
    });
  }

  return skills.sort((left, right) => left.id.localeCompare(right.id));
}
