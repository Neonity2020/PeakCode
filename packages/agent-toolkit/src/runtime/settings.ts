import { agentStore, type AgentSettingKey } from "../store/AgentStore.ts";

/**
 * Settings access, backed by the active `AgentStore`.
 *
 * The original modules called straight into OmniStudio's settings table. Keeping the
 * same three accessor names means the ported code only changes its import path.
 */

/** Raw setting value; empty string when unset, matching the original accessor. */
export function getSetting(key: AgentSettingKey): string {
  return agentStore().getSetting(key) ?? "";
}

/** Setting parsed as a number; `fallback` when unset or not numeric. */
export function getNumericSetting(key: AgentSettingKey, fallback: number): number {
  const raw = getSetting(key);
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Setting parsed as a boolean. Only explicit truthy spellings count. */
export function getBooleanSetting(key: AgentSettingKey, fallback = false): boolean {
  const raw = getSetting(key)?.trim().toLowerCase();
  if (raw === undefined || raw === "") return fallback;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

export function updateSettings(values: Partial<Record<AgentSettingKey, string>>): void {
  agentStore().setSettings(values);
}
