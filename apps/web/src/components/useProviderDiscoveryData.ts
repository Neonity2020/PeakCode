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

function sectionTitle(value: string): string {
  const n = value.trim();
  return n.length === 0 ? "Unknown" : n;
}

export function useProviderDiscoveryData(selectedTab: DiscoveryTab) {
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

  const marketplaceSections = useMemo<PluginSection[]>(() => {
    const map = new Map<string, { title: string; entries: PluginEntry[] }>();
    for (const entry of filteredPluginEntries) {
      const existing = map.get(entry.marketplacePath);
      if (existing) {
        existing.entries.push(entry);
      } else {
        map.set(entry.marketplacePath, {
          title: sectionTitle(entry.marketplaceName),
          entries: [entry],
        });
      }
    }
    return Array.from(map.entries()).map(([key, v]) => ({
      key,
      title: v.title,
      entries: v.entries,
    }));
  }, [filteredPluginEntries]);

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
    marketplaceSections,
    discoveredSkills,
    filteredSkills,
  };
}
