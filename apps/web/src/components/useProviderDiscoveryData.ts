// FILE: useProviderDiscoveryData.ts
// Purpose: Shared React hook for provider plugin/skill discovery data, used by both the
//          PluginsView and SkillsView surfaces. Returns the queries, capabilities, and
//          search state in a single bundle so view components stay presentational.
// Layer: Logic hook
// Exports: useProviderDiscoveryData, type ProviderDiscoveryData

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  PROVIDER_DISPLAY_NAMES,
  type ProviderKind,
  type ProviderPluginDescriptor,
  type ProviderSkillDescriptor,
} from "@peakcode/contracts";
import { useFocusedChatContext } from "~/focusedChatContext";
import { useMessages } from "~/i18n/I18nContext";
import { useStore } from "~/store";
import {
  buildPluginSearchBlob,
  buildSkillSearchBlob,
  isInstalledProviderPlugin,
  normalizeProviderDiscoveryText,
  resolveProviderDiscoveryCwd,
} from "~/lib/providerDiscovery";
import { createFirstProjectSelector } from "~/storeSelectors";
import {
  providerComposerCapabilitiesQueryOptions,
  providerPluginsQueryOptions,
  providerSkillsQueryOptions,
  supportsPluginDiscovery,
  supportsSkillDiscovery,
} from "~/lib/providerDiscoveryReactQuery";
import { serverConfigQueryOptions } from "~/lib/serverReactQuery";

export type DiscoveryTab = "plugins" | "skills";

type ProviderCapabilities = { plugins: boolean; skills: boolean };

export type PluginEntry = {
  marketplaceName: string;
  marketplacePath: string;
  plugin: ProviderPluginDescriptor;
  isFeatured: boolean;
};

export type PluginSection = {
  key: string;
  title: string;
  entries: PluginEntry[];
};

/** Bucket for a plugin whose manifest declares no category. */
export const OTHER_CATEGORY_KEY = "other";

/**
 * The heading for a category key.
 *
 * A plugin's category is a machine key from its manifest, so it may come from a marketplace
 * built by someone else. A key we have a label for gets translated; anything else keeps its
 * raw value, because showing an untranslated heading beats hiding the plugin under one.
 */
export function pluginCategoryLabel(
  key: string,
  messages: { plugins: { category: Record<string, string> } },
): string {
  return messages.plugins.category[key] ?? (key === OTHER_CATEGORY_KEY ? "Other" : key);
}

export function useProviderDiscoveryData(selectedTab: DiscoveryTab) {
  const messages = useMessages();
  const firstProject = useStore(useMemo(() => createFirstProjectSelector(), []));
  const { activeProject: focusedProject, activeThread, focusedThreadId } = useFocusedChatContext();
  const activeProject = focusedProject ?? firstProject ?? null;

  const selectedProvider: ProviderKind = "pi";
  const [pluginSearch, setPluginSearch] = useState("");
  const [skillSearch, setSkillSearch] = useState("");
  const providerThreadId = focusedThreadId;

  const serverConfigQuery = useQuery(serverConfigQueryOptions());
  const piCapabilitiesQuery = useQuery(providerComposerCapabilitiesQueryOptions("pi"));

  const providerCapabilities = useMemo<Record<ProviderKind, ProviderCapabilities>>(
    () => ({
      pi: {
        plugins: supportsPluginDiscovery(piCapabilitiesQuery.data),
        skills: supportsSkillDiscovery(piCapabilitiesQuery.data),
      },
    }),
    [piCapabilitiesQuery.data],
  );

  const discoveryCwd = resolveProviderDiscoveryCwd({
    activeThreadWorktreePath: activeThread?.worktreePath ?? null,
    activeProjectCwd: activeProject?.cwd ?? null,
    serverCwd: serverConfigQuery.data?.cwd ?? null,
  });

  const providerLabel = PROVIDER_DISPLAY_NAMES[selectedProvider];
  const canListPlugins = providerCapabilities[selectedProvider].plugins;
  const canListSkills = providerCapabilities[selectedProvider].skills;

  const pluginsQuery = useQuery(
    providerPluginsQueryOptions({
      provider: selectedProvider,
      cwd: discoveryCwd,
      threadId: providerThreadId,
      enabled: selectedTab === "plugins" && canListPlugins,
    }),
  );

  const skillsQuery = useQuery(
    providerSkillsQueryOptions({
      provider: selectedProvider,
      cwd: discoveryCwd,
      threadId: providerThreadId,
      query: selectedTab === "skills" ? skillSearch : "",
      enabled: selectedTab === "skills" && canListSkills && discoveryCwd !== null,
    }),
  );

  const discoveredSkills = useMemo(
    () => skillsQuery.data?.skills ?? [],
    [skillsQuery.data?.skills],
  );

  const pluginEntries = useMemo<PluginEntry[]>(() => {
    const featuredIds = new Set(pluginsQuery.data?.featuredPluginIds ?? []);
    return (pluginsQuery.data?.marketplaces ?? []).flatMap((m) =>
      m.plugins.map((plugin) => ({
        marketplaceName: m.name,
        marketplacePath: m.path,
        plugin,
        isFeatured: featuredIds.has(plugin.id),
      })),
    );
  }, [pluginsQuery.data]);

  const installedPluginEntries = useMemo(
    () => pluginEntries.filter((entry) => isInstalledProviderPlugin(entry.plugin)),
    [pluginEntries],
  );

  const filteredPluginEntries = useMemo(() => {
    const q = normalizeProviderDiscoveryText(pluginSearch);
    if (!q) return installedPluginEntries;
    return installedPluginEntries.filter((e) => buildPluginSearchBlob(e.plugin).includes(q));
  }, [pluginSearch, installedPluginEntries]);

  /**
   * Plugin entries grouped by the manifest's category key.
   *
   * This is the marketplace's primary axis, not the marketplace it came from: a user
   * looking for something to install scans "developer tools", and which source a plugin
   * ships from is an implementation detail they did not ask about. An entry with no
   * category lands in `other` rather than being dropped.
   */
  const categorySections = useMemo<PluginSection[]>(() => {
    const map = new Map<string, PluginEntry[]>();
    for (const entry of filteredPluginEntries) {
      const key = entry.plugin.interface?.category?.trim() || OTHER_CATEGORY_KEY;
      const bucket = map.get(key);
      if (bucket) bucket.push(entry);
      else map.set(key, [entry]);
    }
    return Array.from(map.entries()).map(([key, entries]) => ({
      key,
      title: pluginCategoryLabel(key, messages),
      entries,
    }));
  }, [filteredPluginEntries, messages]);

  const filteredSkills = useMemo<ReadonlyArray<ProviderSkillDescriptor>>(() => {
    const q = normalizeProviderDiscoveryText(skillSearch);
    if (!q) return discoveredSkills;
    return discoveredSkills.filter((s) => buildSkillSearchBlob(s).includes(q));
  }, [skillSearch, discoveredSkills]);

  return {
    selectedProvider,
    pluginSearch,
    setPluginSearch,
    skillSearch,
    setSkillSearch,
    providerCapabilities,
    providerLabel,
    canListPlugins,
    canListSkills,
    discoveryCwd,
    pluginsQuery,
    skillsQuery,
    pluginEntries,
    installedPluginEntries,
    filteredPluginEntries,
    categorySections,
    discoveredSkills,
    filteredSkills,
  };
}
