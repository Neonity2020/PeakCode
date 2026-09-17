// FILE: PluginDetailDialog.tsx
// Purpose: The plugin detail view: what the plugin is (long description, capabilities,
//          bundled skills) plus the action that puts it on the composer.
// Layer: Route-level presentation
// Depends on: plugin discovery queries, plugin glyphs, dialog primitives and i18n messages.

import { useQuery } from "@tanstack/react-query";
import { useMessages } from "~/i18n";
import { providerReadPluginQueryOptions } from "~/lib/providerDiscoveryReactQuery";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Skeleton } from "./ui/skeleton";
import { PluginGlyph } from "./PluginLibraryPresentation";
import { pluginCategoryLabel, type PluginEntry } from "./useProviderDiscoveryData";

export function PluginDetailDialog({
  entry,
  onOpenChange,
  onUsePlugin,
  isUsingPlugin,
}: {
  entry: PluginEntry | null;
  onOpenChange: (open: boolean) => void;
  onUsePlugin: (entry: PluginEntry) => void;
  isUsingPlugin: boolean;
}) {
  const messages = useMessages();
  const detailQuery = useQuery(
    providerReadPluginQueryOptions({
      provider: "pi",
      marketplacePath: entry?.marketplacePath ?? "",
      pluginName: entry?.plugin.name ?? "",
      enabled: entry !== null,
    }),
  );

  if (entry === null) {
    return null;
  }

  const plugin = entry.plugin;
  const detail = detailQuery.data?.plugin;
  const displayName = plugin.interface?.displayName ?? plugin.name;
  // The list already carries the marketplace's short sentence; the read carries the paragraph.
  const description =
    detail?.description ??
    plugin.interface?.longDescription ??
    plugin.interface?.shortDescription ??
    null;
  const capabilities = plugin.interface?.capabilities ?? [];
  const examplePrompts = plugin.interface?.defaultPrompt ?? [];
  const skills = detail?.skills ?? [];

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-xl" data-testid="plugin-detail-dialog">
        <DialogHeader className="flex-row items-start gap-3.5">
          <PluginGlyph plugin={plugin} />
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate text-lg">{displayName}</DialogTitle>
            <DialogDescription className="mt-1 truncate text-[12px]">
              {[
                plugin.interface?.developerName,
                pluginCategoryLabel(plugin.interface?.category ?? "", messages),
              ]
                .filter((value) => typeof value === "string" && value.trim().length > 0)
                .join(" · ")}
            </DialogDescription>
          </div>
        </DialogHeader>

        <DialogPanel className="max-h-[52vh] space-y-5 text-[13px]">
          {description ? (
            <p className="leading-relaxed text-muted-foreground">{description}</p>
          ) : null}

          {capabilities.length > 0 ? (
            <div>
              <p className="text-[12px] font-medium text-foreground">
                {messages.plugins.detailCapabilities}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {capabilities.map((capability) => (
                  <span
                    key={capability}
                    className="rounded-md border border-border/60 bg-background/60 px-2 py-0.5 text-[11px] text-muted-foreground"
                  >
                    {capability}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {skills.length > 0 ? (
            <div>
              <p className="text-[12px] font-medium text-foreground">
                {messages.plugins.detailSkills}
              </p>
              <ul className="mt-2 space-y-1.5">
                {skills.map((skill) => (
                  <li key={skill.name} className="flex min-w-0 flex-col">
                    <span className="text-[12px] font-medium text-foreground/90">{skill.name}</span>
                    {skill.description ? (
                      <span className="text-[12px] leading-snug text-muted-foreground">
                        {skill.description}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {examplePrompts.length > 0 ? (
            <div>
              <p className="text-[12px] font-medium text-foreground">
                {messages.plugins.detailExamples}
              </p>
              <ul className="mt-2 space-y-1.5">
                {examplePrompts.map((prompt) => (
                  <li
                    key={prompt}
                    className="rounded-lg border border-border/60 bg-background/60 px-3 py-2 text-[12px] leading-snug text-muted-foreground"
                  >
                    {prompt}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {detailQuery.isLoading ? <Skeleton className="h-16 w-full rounded-xl" /> : null}
        </DialogPanel>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {messages.common.close}
          </Button>
          <Button
            onClick={() => onUsePlugin(entry)}
            disabled={isUsingPlugin}
            data-testid="plugin-detail-use"
          >
            {messages.plugins.detailUse}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
