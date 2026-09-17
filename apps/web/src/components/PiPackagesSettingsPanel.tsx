// FILE: PiPackagesSettingsPanel.tsx
// Purpose: "Pi Packages" settings panel — install and remove pi packages (extensions,
// skills, prompt templates, themes) from npm, git, or a local path. This is the GUI
// equivalent of `pi install npm:@scope/pkg` / `pi install git:host/user/repo`.
// Layer: Route screen support
import { useState } from "react";

import type { PiPackageSummary } from "@peakcode/contracts";
import { useMessages } from "../i18n";
import {
  useInstallPiPackageMutation,
  usePiPackagesQuery,
  useRemovePiPackageMutation,
} from "../lib/piPackagesReactQuery";
import { Loader2Icon, PackageIcon, Trash2 } from "../lib/icons";
import { cn } from "~/lib/utils";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";

/** Sources offered as one-click fills; the field itself accepts any pi source. */
const SUGGESTED_SOURCES = ["npm:@melihmucuk/pi-crew", "git:github.com/melihmucuk/pi-crew"];

const PANEL_CONTROL_CLASS = "rounded-xl border-foreground/9 bg-foreground/4 shadow-none";

export function PiPackagesSettingsPanel({ agentDir = "" }: { agentDir?: string }) {
  const messages = useMessages();
  const pkg = messages.settings.piPackages;
  const query = usePiPackagesQuery(agentDir);
  const installMutation = useInstallPiPackageMutation();
  const removeMutation = useRemovePiPackageMutation();
  const [source, setSource] = useState("");

  const snapshot = query.data;
  const packages = snapshot?.packages ?? [];
  const install = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    installMutation.mutate(
      { source: trimmed, ...(agentDir ? { agentDir } : {}) },
      { onSuccess: () => setSource("") },
    );
  };

  const renderResourceBadges = (entry: PiPackageSummary) => {
    const badges: Array<[string, number]> = [
      [pkg.resources.skills, entry.resources.skills],
      [pkg.resources.prompts, entry.resources.prompts],
      [pkg.resources.extensions, entry.resources.extensions],
      [pkg.resources.themes, entry.resources.themes],
    ];
    return badges
      .filter(([, count]) => count > 0)
      .map(([label, count]) => (
        <span
          key={label}
          className="rounded-full bg-foreground/8 px-2 py-0.5 text-[11px] text-foreground/78"
        >
          {count} {label}
        </span>
      ));
  };

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-5 px-5 py-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium text-foreground">{pkg.heading}</h2>
        <p className="text-xs text-muted-foreground">{pkg.description}</p>
        {snapshot ? (
          <p className="text-xs text-muted-foreground/78">
            {pkg.settingsPathLabel}: <code className="text-[11px]">{snapshot.settingsPath}</code>
          </p>
        ) : null}
      </div>

      <form
        className="flex flex-col gap-2 rounded-xl border border-border/70 px-4 py-4"
        onSubmit={(event) => {
          event.preventDefault();
          install(source);
        }}
      >
        <label className="block text-xs font-medium text-foreground" htmlFor="pi-package-source">
          {pkg.sourceLabel}
        </label>
        <div className="flex items-center gap-2">
          <Input
            id="pi-package-source"
            value={source}
            onChange={(event) => setSource(event.target.value)}
            placeholder={pkg.sourcePlaceholder}
            className={cn(PANEL_CONTROL_CLASS, "h-8 flex-1 text-[13px]")}
            disabled={installMutation.isPending}
          />
          <Button
            type="submit"
            size="sm"
            className="rounded-full text-[13px] before:rounded-full"
            disabled={!source.trim() || installMutation.isPending}
          >
            {installMutation.isPending ? <Loader2Icon className="size-4 animate-spin" /> : null}
            {installMutation.isPending ? pkg.installingButton : pkg.installButton}
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">{pkg.sourceHint}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          {SUGGESTED_SOURCES.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              className="rounded-full bg-foreground/8 px-2.5 py-1 text-[11px] text-foreground/78 transition-colors hover:bg-foreground/12"
              onClick={() => setSource(suggestion)}
            >
              {suggestion}
            </button>
          ))}
        </div>
      </form>

      {query.isLoading ? (
        <div className="flex items-center gap-2 rounded-xl border border-dashed border-border/70 px-4 py-6 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" />
          {pkg.loadingLabel}
        </div>
      ) : query.isError ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-6 text-sm text-destructive">
          <div className="font-medium">{pkg.loadFailedTitle}</div>
          <div className="mt-1">
            {query.error instanceof Error ? query.error.message : pkg.loadFailedFallback}
          </div>
        </div>
      ) : packages.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/70 px-4 py-6 text-sm text-muted-foreground">
          <div className="font-medium text-foreground">{pkg.emptyTitle}</div>
          <div className="mt-1">{pkg.emptyDescription}</div>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {packages.map((entry) => (
            <li
              key={`${entry.scope}:${entry.source}`}
              className="flex items-start gap-3 rounded-xl border border-border/70 px-4 py-3"
            >
              <PackageIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-mono text-[12px] text-foreground">
                    {entry.source}
                  </span>
                  <span className="rounded-full bg-foreground/8 px-2 py-0.5 text-[11px] text-foreground/78">
                    {entry.kind}
                  </span>
                  {entry.scope === "project" ? (
                    <span className="rounded-full bg-foreground/8 px-2 py-0.5 text-[11px] text-foreground/78">
                      {pkg.projectScopeLabel}
                    </span>
                  ) : null}
                  {entry.filtered ? (
                    <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[11px] text-foreground">
                      {pkg.filteredLabel}
                    </span>
                  ) : null}
                  {renderResourceBadges(entry)}
                </div>
                <div className="truncate text-[11px] text-muted-foreground">
                  {entry.installedPath ?? pkg.notInstalledLabel}
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={pkg.removeAria(entry.source)}
                className="rounded-full text-muted-foreground hover:text-destructive"
                disabled={removeMutation.isPending}
                onClick={() => {
                  if (!window.confirm(pkg.removeConfirm(entry.source))) return;
                  removeMutation.mutate({
                    source: entry.source,
                    ...(agentDir ? { agentDir } : {}),
                  });
                }}
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <p className="text-[11px] text-muted-foreground">{pkg.reloadHint}</p>
    </div>
  );
}
