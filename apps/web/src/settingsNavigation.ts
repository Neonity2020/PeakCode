// FILE: settingsNavigation.ts
// Purpose: Share the settings topic taxonomy between the settings screen and tests.
// Layer: Route/UI support
// Exports: section ids, nav items, nav groups, and search normalization helper

import {
  AdjustmentsIcon,
  ArchiveIcon,
  BellIcon,
  BookIcon,
  type LucideIcon,
  PaletteIcon,
  Server2Icon,
  SettingsIcon,
  WrenchIcon,
  WorktreeIcon,
} from "./lib/icons";
import { useMessages, type Messages } from "./i18n";

export const SETTINGS_SECTION_IDS = [
  "general",
  "appearance",
  "notifications",
  "behavior",
  "skills",
  "modelProviders",
  "worktrees",
  "archived",
  "advanced",
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[number];
export type SettingsNavGroupId = "basics" | "agent" | "data";

export type SettingsNavItem = {
  id: SettingsSectionId;
  group: SettingsNavGroupId;
  label: string;
  description: string;
  icon: LucideIcon;
};

type SettingsNavItemSpec = {
  id: SettingsSectionId;
  group: SettingsNavGroupId;
  icon: LucideIcon;
  labelKey: keyof Messages["settings"]["nav"];
  descriptionKey: keyof Messages["settings"]["nav"];
};

const SETTINGS_NAV_ITEM_SPECS_INTERNAL: readonly SettingsNavItemSpec[] = [
  {
    id: "general",
    group: "basics",
    icon: SettingsIcon,
    labelKey: "general",
    descriptionKey: "general",
  },
  {
    id: "appearance",
    group: "basics",
    icon: PaletteIcon,
    labelKey: "appearance",
    descriptionKey: "appearance",
  },
  {
    id: "notifications",
    group: "basics",
    icon: BellIcon,
    labelKey: "notifications",
    descriptionKey: "notifications",
  },
  {
    id: "behavior",
    group: "basics",
    icon: AdjustmentsIcon,
    labelKey: "behavior",
    descriptionKey: "behavior",
  },
  {
    id: "modelProviders",
    group: "basics",
    icon: Server2Icon,
    labelKey: "modelProviders",
    descriptionKey: "modelProviders",
  },
  {
    id: "skills",
    group: "agent",
    icon: BookIcon,
    labelKey: "skills",
    descriptionKey: "skills",
  },
  {
    id: "worktrees",
    group: "data",
    icon: WorktreeIcon,
    labelKey: "worktrees",
    descriptionKey: "worktrees",
  },
  {
    id: "archived",
    group: "data",
    icon: ArchiveIcon,
    labelKey: "archived",
    descriptionKey: "archived",
  },
  {
    id: "advanced",
    group: "data",
    icon: WrenchIcon,
    labelKey: "advanced",
    descriptionKey: "advanced",
  },
] as const;

const SETTINGS_NAV_GROUP_IDS: readonly SettingsNavGroupId[] = ["basics", "agent", "data"] as const;

export function buildSettingsNavItems(messages: Messages): readonly SettingsNavItem[] {
  return SETTINGS_NAV_ITEM_SPECS_INTERNAL.map((spec) => {
    const entry = messages.settings.nav[spec.labelKey];
    return {
      id: spec.id,
      group: spec.group,
      icon: spec.icon,
      label: entry.label,
      description: entry.description,
    };
  });
}

export function buildSettingsNavGroups(messages: Messages): ReadonlyArray<{
  id: SettingsNavGroupId;
  label: string;
}> {
  return SETTINGS_NAV_GROUP_IDS.map((id) => ({ id, label: messages.settings.groups[id] }));
}

export function useSettingsNavItems(): readonly SettingsNavItem[] {
  const messages = useMessages();
  return buildSettingsNavItems(messages);
}

export function useSettingsNavGroups(): ReadonlyArray<{
  id: SettingsNavGroupId;
  label: string;
}> {
  const messages = useMessages();
  return buildSettingsNavGroups(messages);
}

export function normalizeSettingsSection(value: unknown): SettingsSectionId {
  if (typeof value !== "string") {
    return "general";
  }
  return SETTINGS_SECTION_IDS.find((candidate) => candidate === value) ?? "general";
}
