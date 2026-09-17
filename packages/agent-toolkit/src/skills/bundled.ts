// Bundled skills: in-tree skill payloads Peak Code installs into the shared skill library.
//
// The default engineering-workflow pack comes from GitHub through the `skills` CLI. These
// skills are ported from oh-my-pi and cannot be fetched that way (they live under
// `.omp/skills`, which the CLI does not discover), so their content is embedded in
// `oh-my-pi.bundled.generated.ts` and written to `~/.agents/skills` at startup. Once on
// disk they behave like any other skill: the agent sees them in the skill listing and reads
// a body through `read_skill`, and `/skill:<id>` resolves.
//
// Writes are create-only: an existing directory is left untouched so a user's local edits
// are never clobbered, and a broken payload cannot take down server startup.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { getCentralRepoDir } from "./central-repo.ts";
import { defaultSkillPacksEnabled } from "./default-pack.ts";
import { OH_MY_PI_BUNDLED_SKILLS, type BundledSkill } from "./oh-my-pi.bundled.generated.ts";
import { safeJoin, safeName } from "../path-safety.ts";

export type BundledSkillStatus = "installed" | "already-present" | "skipped" | "failed";

export interface BundledSkillResult {
  readonly skill: string;
  readonly status: BundledSkillStatus;
  /** Failure reason or a short note; mirrors `SkillPackResult.detail`. */
  readonly detail?: string;
}

export interface InstallBundledSkillsOptions {
  /** Payload override (tests). Defaults to the generated oh-my-pi skills. */
  readonly skills?: readonly BundledSkill[];
  /** Shared skill library root. Defaults to `~/.agents/skills`. */
  readonly root?: string;
  /** Skill ids already present, so the same check the pack installer uses can be injected. */
  readonly installed?: readonly string[];
  /** Master switch; defaults to the `AGENT_SKILL_PACKS` setting. */
  readonly enabled?: boolean;
}

/**
 * Install every missing bundled skill into the shared library.
 *
 * Idempotent: a skill whose directory already exists is reported `already-present` and not
 * rewritten. Errors are returned per skill instead of thrown — a failed skill must not stop
 * the server from booting.
 */
export function installBundledSkills(
  options: InstallBundledSkillsOptions = {},
): BundledSkillResult[] {
  const skills = options.skills ?? OH_MY_PI_BUNDLED_SKILLS;
  const enabled = options.enabled ?? defaultSkillPacksEnabled();
  if (!enabled) {
    return skills.map((skill) => ({
      skill: skill.id,
      status: "skipped",
      detail: "已在设置里关闭",
    }));
  }

  const root = options.root ?? getCentralRepoDir();
  const installed = new Set(options.installed ?? []);

  return skills.map((skill) => {
    if (installed.has(skill.id)) return { skill: skill.id, status: "already-present" };

    const id = safeName(skill.id);
    if (!id) return { skill: skill.id, status: "failed", detail: `技能名不合法：${skill.id}` };
    const skillDir = join(root, id);
    if (existsSync(skillDir)) return { skill: skill.id, status: "already-present" };

    try {
      for (const file of skill.files) {
        const target = safeJoin(skillDir, file.path);
        if (!target) {
          return { skill: skill.id, status: "failed", detail: `技能内的路径不合法：${file.path}` };
        }
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, file.content, "utf8");
      }
    } catch (error) {
      return {
        skill: skill.id,
        status: "failed",
        detail: error instanceof Error ? error.message : String(error),
      };
    }
    return { skill: skill.id, status: "installed" };
  });
}
