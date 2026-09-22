import { agentStore, type AgentSettingKey, type AgentStore } from "../store/AgentStore.ts";

/**
 * Settings access, backed by the active `AgentStore`.
 *
 * The original modules called straight into OmniStudio's settings table. Keeping the
 * same three accessor names means the ported code only changes its import path.
 *
 * Reads are memoised per store instance. A single permission evaluation walks the same
 * settings several times (approval mode, custom rules, authorized folders) and that path
 * runs on every tool call, so each unique key would otherwise be a SQL round-trip. The
 * cache is a `WeakMap` keyed by the store object rather than a module-level map: swapping
 * the store (`setAgentStore`) yields a fresh bucket automatically, and a dropped store's
 * entries are collected with it — no cross-test or cross-hosting bleed.
 */
const settingCache = new WeakMap<AgentStore, Map<AgentSettingKey, string>>();

function cacheFor(store: AgentStore): Map<AgentSettingKey, string> {
  let cache = settingCache.get(store);
  if (cache === undefined) {
    cache = new Map();
    settingCache.set(store, cache);
  }
  return cache;
}

/** Raw setting value; empty string when unset, matching the original accessor. */
export function getSetting(key: AgentSettingKey): string {
  const store = agentStore();
  const cache = cacheFor(store);
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const value = store.getSetting(key) ?? "";
  cache.set(key, value);
  return value;
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
  const store = agentStore();
  store.setSettings(values);
  // Drop exactly what we wrote so the next read refetches. `setSettings` ignores
  // `undefined` values, but evicting them too is harmless (they just miss and re-read).
  const cache = settingCache.get(store);
  if (cache === undefined) return;
  for (const key of Object.keys(values) as AgentSettingKey[]) cache.delete(key);
}
