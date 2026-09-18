// FILE: ModelProviderRemoteModelsDialog.tsx
// Purpose: "获取模型列表" picker — lists the ids a provider's own `/models`
// endpoint returned, grouped by vendor prefix and filterable by category, with
// per-row / per-group / bulk add into the provider's `models` array.
// Layer: Settings overlay — mounted from the model providers panel.

import { useEffect, useMemo, useState } from "react";

import { cn } from "~/lib/utils";
import { useMessages } from "../i18n";
import {
  MODEL_CATEGORIES,
  classifyModelName,
  countByCategory,
  groupModelsByNamespace,
  type ModelCategory,
} from "../lib/modelCategories";
import { CheckIcon, Loader2Icon, PlusIcon, SearchIcon } from "../lib/icons";
import { Button } from "../components/ui/button";
import { Dialog, DialogPopup, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";

export interface ModelProviderRemoteModelsDialogProps {
  readonly open: boolean;
  readonly providerLabel: string;
  /** Ids returned by the provider's `/models` endpoint. */
  readonly models: readonly string[];
  /** Ids the provider already has configured, so they render as added. */
  readonly existingIds: readonly string[];
  readonly isLoading: boolean;
  /** Human-readable fetch failure; the dialog stays useful for retrying. */
  readonly error: string | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onAdd: (ids: readonly string[]) => void;
}

const GROUP_HEADER_CLASS =
  "sticky top-0 z-10 flex items-center gap-2 bg-[var(--composer-surface)] px-1 py-1.5";

export function ModelProviderRemoteModelsDialog({
  open,
  providerLabel,
  models,
  existingIds,
  isLoading,
  error,
  onOpenChange,
  onAdd,
}: ModelProviderRemoteModelsDialogProps) {
  const messages = useMessages();
  const mp = messages.settings.modelProviders;

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<ModelCategory | "all">("all");

  // A fresh fetch starts from a clean filter rather than the last search.
  useEffect(() => {
    if (open) {
      setQuery("");
      setCategory("all");
    }
  }, [open]);

  const existing = useMemo(() => new Set(existingIds), [existingIds]);
  const counts = useMemo(() => countByCategory(models), [models]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return models.filter((id) => {
      if (category !== "all" && classifyModelName(id) !== category) return false;
      return needle.length === 0 || id.toLowerCase().includes(needle);
    });
  }, [models, query, category]);

  const missing = useMemo(() => models.filter((id) => !existing.has(id)), [models, existing]);
  const groups = useMemo(() => groupModelsByNamespace(visible), [visible]);
  // Only show categories the provider actually returned, so the row of chips
  // does not fill up with zeroes for every non-chat family.
  const chips = MODEL_CATEGORIES.filter((value) => counts[value] > 0);

  const addLabel = (id: string) =>
    existing.has(id) ? (
      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
        <CheckIcon className="size-3" />
        {mp.remoteModelsAdded}
      </span>
    ) : (
      <Button
        size="xs"
        className="rounded-full border-transparent bg-foreground/10 text-foreground"
        aria-label={mp.remoteModelsAddAria(id)}
        onClick={() => onAdd([id])}
      >
        <PlusIcon className="size-3" />
        {mp.remoteModelsAdd}
      </Button>
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-[620px] gap-0 p-0">
        <div className="flex flex-col p-4">
          <DialogTitle className="pr-8 text-base">
            {mp.remoteModelsTitle(providerLabel)}
          </DialogTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            {isLoading
              ? mp.remoteModelsLoading
              : error
                ? mp.remoteModelsFailed
                : mp.remoteModelsSummary(models.length, missing.length)}
          </p>

          {error ? (
            <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          ) : null}

          {!error && !isLoading ? (
            <>
              <div className="relative mt-3">
                <SearchIcon className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="h-8 rounded-lg ps-8 text-[13px]"
                  value={query}
                  placeholder={mp.remoteModelsSearchPlaceholder}
                  aria-label={mp.remoteModelsSearchPlaceholder}
                  spellCheck={false}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-1">
                <button
                  type="button"
                  onClick={() => setCategory("all")}
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[11px] transition-colors",
                    category === "all"
                      ? "bg-foreground/12 text-foreground"
                      : "text-muted-foreground hover:bg-foreground/6",
                  )}
                >
                  {mp.modelCategoryAll} {models.length}
                </button>
                {chips.map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setCategory(value)}
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[11px] transition-colors",
                      category === value
                        ? "bg-foreground/12 text-foreground"
                        : "text-muted-foreground hover:bg-foreground/6",
                    )}
                  >
                    {mp.modelCategories[value]} {counts[value]}
                  </button>
                ))}
              </div>

              <div className="mt-2 max-h-[360px] min-h-[160px] overflow-y-auto rounded-lg border border-[color:var(--color-border-light)] px-2 pb-2">
                {visible.length === 0 ? (
                  <p className="px-1 py-6 text-center text-xs text-muted-foreground">
                    {models.length === 0 ? mp.remoteModelsEmpty : mp.remoteModelsNoMatch}
                  </p>
                ) : (
                  groups.map((group) => {
                    const groupMissing = group.models.filter((id) => !existing.has(id));
                    return (
                      <div key={group.namespace || "__ungrouped"}>
                        <div className={GROUP_HEADER_CLASS}>
                          <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-muted-foreground">
                            {group.namespace || mp.remoteModelsGroupOther}
                            <span className="ml-1.5 text-muted-foreground/60">
                              {group.models.length}
                            </span>
                          </span>
                          {groupMissing.length > 1 ? (
                            <button
                              type="button"
                              className="shrink-0 rounded-full px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-foreground/6 hover:text-foreground"
                              onClick={() => onAdd(groupMissing)}
                            >
                              {mp.remoteModelsAddGroup}
                            </button>
                          ) : null}
                        </div>
                        <div className="space-y-0.5">
                          {group.models.map((id) => (
                            <div
                              key={id}
                              className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-foreground/4"
                            >
                              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground">
                                {id}
                              </span>
                              <span className="shrink-0 rounded-md border border-[color:var(--color-border-light)] px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                {mp.modelCategories[classifyModelName(id)]}
                              </span>
                              <span className="w-[72px] shrink-0 text-end">{addLabel(id)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          ) : isLoading ? (
            <div className="mt-3 flex items-center justify-center gap-2 rounded-lg border border-dashed border-border/70 py-10 text-xs text-muted-foreground">
              <Loader2Icon className="size-3.5 animate-spin" />
              {mp.remoteModelsLoading}
            </div>
          ) : null}

          <div className="mt-4 flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {!error && !isLoading
                ? mp.remoteModelsAddedCount(existingCount(models, existing))
                : null}
            </span>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                className="rounded-full border-transparent bg-foreground/10 text-foreground"
                disabled={missing.length === 0}
                onClick={() => onAdd(missing)}
              >
                {mp.remoteModelsAddAll}
              </Button>
              <Button size="sm" className="rounded-full" onClick={() => onOpenChange(false)}>
                {mp.cancelButton}
              </Button>
            </div>
          </div>
        </div>
      </DialogPopup>
    </Dialog>
  );
}

/** How many of the listed ids the provider already has. */
function existingCount(models: readonly string[], existing: ReadonlySet<string>): number {
  return models.filter((id) => existing.has(id)).length;
}
