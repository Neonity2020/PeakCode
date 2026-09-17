// Per-skill enablement: which skill ids the agent must not see or read.
//
// The store records the *disabled* set, so an empty (default) record means every skill
// behaves exactly as it always has — installing this feature cannot switch anything off.
// Ids are stored as a JSON array in one setting value, the same list-in-a-string shape
// `AGENT_PERMISSION_RULES` uses, and the parser tolerates hand-edited junk by falling back
// to "nothing disabled" rather than throwing on a path the agent turn depends on.
import type { AgentSettingKey } from "../store/AgentStore.ts";
import { getSetting, updateSettings } from "../runtime/settings.ts";

/** Setting key holding the JSON array of disabled skill ids. */
export const DISABLED_SKILLS_SETTING: AgentSettingKey = "AGENT_DISABLED_SKILLS";

/** Ids compare case-insensitively: they arrive from directory names, the UI and the model. */
function normalizeSkillId(id: string): string {
  return id.trim().toLowerCase();
}

/**
 * Read the disabled set out of a raw setting value.
 *
 * Anything that is not an array of non-empty strings is ignored; a corrupt value degrades to
 * "nothing disabled" so a bad setting can never make every skill disappear.
 */
export function parseDisabledSkillIds(raw: string): string[] {
  if (!raw.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const ids = new Set<string>();
  for (const item of parsed) {
    if (typeof item !== "string") continue;
    const id = normalizeSkillId(item);
    if (id) ids.add(id);
  }
  return [...ids].toSorted();
}

/** Every skill id currently switched off on this machine. */
export function disabledSkillIds(): Set<string> {
  return new Set(parseDisabledSkillIds(getSetting(DISABLED_SKILLS_SETTING)));
}

/** Whether a skill may be listed to the model and read from disk. Unknown ids are enabled. */
export function isSkillEnabled(skillId: string): boolean {
  const id = normalizeSkillId(skillId);
  if (!id) return true;
  return !disabledSkillIds().has(id);
}

/**
 * Switch one skill on or off and persist the new set.
 *
 * Returns the ids that are disabled afterwards, so a caller can echo the stored state back
 * without a second read. Writing an id that is already in the requested state is a no-op.
 */
export function setSkillEnabled(skillId: string, enabled: boolean): string[] {
  const id = normalizeSkillId(skillId);
  if (!id) return parseDisabledSkillIds(getSetting(DISABLED_SKILLS_SETTING));
  const disabled = disabledSkillIds();
  if (enabled) disabled.delete(id);
  else disabled.add(id);
  const next = [...disabled].toSorted();
  updateSettings({ [DISABLED_SKILLS_SETTING]: JSON.stringify(next) });
  return next;
}
