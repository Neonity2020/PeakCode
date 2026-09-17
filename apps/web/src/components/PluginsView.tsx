// FILE: PluginsView.tsx
// Purpose: Plugin marketplace surface for the /plugins route. Reads provider plugin
//          discovery and renders it the way a marketplace reads: a title, a search, the
//          plugins you already have, then everything grouped by what it does. A plugin
//          opens into its detail view, which is where it can be put on the composer.
// Layer: Route-level screen
// Exports: PluginsView

import { useDeferredValue, useState } from "react";
import { RefreshCwIcon, SearchIcon } from "~/lib/icons";
import { useMessages } from "~/i18n/I18nContext";
import { SidebarInset } from "./ui/sidebar";
import { SidebarHeaderNavigationControls } from "./SidebarHeaderNavigationControls";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "./ui/input-group";
import { Skeleton } from "./ui/skeleton";
import { PluginDetailDialog } from "./PluginDetailDialog";
import {
  EmptyPanel,
  InlineWarning,
  PluginGridItem,
  PluginInstalledTile,
  SectionHeader,
  pluginEntryKey,
  sectionTitle,
} from "./PluginLibraryPresentation";
import { useAttachPluginToComposer } from "~/hooks/useAttachPluginToComposer";
import { toastManager } from "./ui/toast";
import { useProviderDiscoveryData, type PluginEntry } from "./useProviderDiscoveryData";

export function PluginsView() {
  const messages = useMessages();
  const data = useProviderDiscoveryData("plugins");
  const deferredPluginSearch = useDeferredValue(data.pluginSearch);
  const isSearching = deferredPluginSearch.trim().length > 0;
  const [detailEntry, setDetailEntry] = useState<PluginEntry | null>(null);
  const [isUsingPlugin, setIsUsingPlugin] = useState(false);
  const attachPluginToComposer = useAttachPluginToComposer();

  const handleUsePlugin = async (entry: PluginEntry) => {
    setIsUsingPlugin(true);
    try {
      const attached = await attachPluginToComposer(entry);
      if (attached) {
        setDetailEntry(null);
        return;
      }
      toastManager.add({
        type: "warning",
        title: messages.plugins.useFailedTitle,
        description: messages.plugins.useFailedDescription,
      });
    } finally {
      setIsUsingPlugin(false);
    }
  };

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden isolate">
      <div className="flex h-full flex-col">
        <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 sm:px-6">
          <SidebarHeaderNavigationControls />
          <div className="flex-1" />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-6 pb-16 pt-10">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-[26px] font-semibold leading-tight text-foreground">
                  {messages.plugins.title}
                </h1>
                <p className="mt-1.5 text-[13px] text-muted-foreground">
                  {messages.plugins.subtitle}
                </p>
              </div>
              <button
                type="button"
                aria-label={messages.plugins.refresh}
                title={messages.plugins.refresh}
                onClick={() => void data.pluginsQuery.refetch()}
                disabled={!data.canListPlugins || data.pluginsQuery.isFetching}
                className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/60 text-muted-foreground transition-colors hover:bg-[var(--sidebar-accent)] disabled:opacity-40"
              >
                <RefreshCwIcon className="size-4" />
              </button>
            </div>

            <div className="mt-5">
              <InputGroup className="rounded-xl bg-background/70 shadow-xs">
                <InputGroupAddon>
                  <InputGroupText>
                    <SearchIcon className="size-4 text-muted-foreground/60" />
                  </InputGroupText>
                </InputGroupAddon>
                <InputGroupInput
                  value={data.pluginSearch}
                  onChange={(e) => data.setPluginSearch(e.target.value)}
                  placeholder={messages.plugins.searchPlaceholder}
                  className="text-sm"
                />
              </InputGroup>
            </div>

            {(!!data.pluginsQuery.data?.remoteSyncError ||
              (data.pluginsQuery.data?.marketplaceLoadErrors.length ?? 0) > 0) && (
              <div className="mt-4 space-y-1.5">
                {data.pluginsQuery.data?.remoteSyncError ? (
                  <InlineWarning>{data.pluginsQuery.data.remoteSyncError}</InlineWarning>
                ) : null}
                {(data.pluginsQuery.data?.marketplaceLoadErrors.length ?? 0) > 0 ? (
                  <InlineWarning>
                    {data.pluginsQuery.data?.marketplaceLoadErrors
                      .map((err) => `${sectionTitle(err.marketplacePath)}: ${err.message}`)
                      .join(" • ")}
                  </InlineWarning>
                ) : null}
              </div>
            )}

            {!data.canListPlugins ? (
              <div className="mt-8">
                <EmptyPanel
                  title={messages.plugins.unavailableTitle.replace(
                    "{provider}",
                    data.providerLabel,
                  )}
                  description={messages.plugins.unavailableDescription}
                />
              </div>
            ) : data.pluginsQuery.isLoading && data.pluginEntries.length === 0 ? (
              <div className="mt-8 space-y-1">
                {["1", "2", "3", "4", "5", "6"].map((k) => (
                  <Skeleton key={k} className="h-[68px] w-full rounded-xl" />
                ))}
              </div>
            ) : data.pluginEntries.length === 0 ? (
              <div className="mt-8">
                <EmptyPanel
                  title={messages.plugins.emptyTitle}
                  description={messages.plugins.emptyDescription}
                />
              </div>
            ) : (
              <>
                {/* What you already have, as icons: the install state is the thing a user
                    checks first, and it stays out of the way of browsing below. */}
                <section className="mt-8">
                  <div className="flex items-baseline justify-between gap-3">
                    <h2 className="text-[15px] font-semibold text-foreground">
                      {messages.plugins.installedHeading}
                    </h2>
                    <span className="text-[12px] text-muted-foreground">
                      {messages.plugins.installedCount.replace(
                        "{count}",
                        String(data.installedPluginEntries.length),
                      )}
                    </span>
                  </div>
                  {data.installedPluginEntries.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {data.installedPluginEntries.map((entry) => (
                        <PluginInstalledTile
                          key={pluginEntryKey(entry)}
                          entry={entry}
                          onSelect={setDetailEntry}
                        />
                      ))}
                    </div>
                  ) : null}
                </section>

                {data.filteredPluginEntries.length === 0 ? (
                  <div className="mt-8">
                    <EmptyPanel
                      title={
                        isSearching
                          ? messages.plugins.emptySearchTitle
                          : messages.plugins.emptyTitle
                      }
                      description={
                        isSearching
                          ? messages.plugins.emptySearchDescription
                          : messages.plugins.emptyDescription
                      }
                    />
                  </div>
                ) : (
                  <div className="mt-9 space-y-8">
                    {data.categorySections.map((section) => (
                      <section key={section.key}>
                        <SectionHeader title={section.title} />
                        <div className="mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
                          {section.entries.map((entry) => (
                            <PluginGridItem
                              key={pluginEntryKey(entry)}
                              entry={entry}
                              onSelect={setDetailEntry}
                            />
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <PluginDetailDialog
        entry={detailEntry}
        onOpenChange={(open) => {
          if (!open) {
            setDetailEntry(null);
          }
        }}
        onUsePlugin={(entry) => {
          void handleUsePlugin(entry);
        }}
        isUsingPlugin={isUsingPlugin}
      />
    </SidebarInset>
  );
}
