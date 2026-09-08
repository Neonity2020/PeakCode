// FILE: ProviderModelPicker.tsx
// Purpose: Renders the composer model menu (Pi-only) and supports controlled opening for shortcuts.
// Layer: Chat composer presentation
// Depends on: Pi model options, shared menu primitives, and picker trigger styling.

import { type ModelSlug, type ProviderKind } from "@peakcode/contracts";
import { resolveSelectableModel } from "@peakcode/shared/model";
import * as Schema from "effect/Schema";
import {
  Fragment,
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { formatProviderModelOptionName } from "../../providerModelOptions";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { PROVIDER_ICON_COMPONENT_BY_PROVIDER } from "../ProviderIcon";
import { cn } from "~/lib/utils";
import { PickerPanelShell } from "./PickerPanelShell";
import { PickerTriggerButton } from "./PickerTriggerButton";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ShortcutKbd } from "../ui/shortcut-kbd";
import {
  groupProviderModelOptions,
  groupProviderModelOptionsWithFavorites,
  type ProviderModelOption,
} from "../../providerModelOptions";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { StarFilledIcon, StarIcon } from "../../lib/icons";
import { Skeleton } from "../ui/skeleton";

function providerIconClassName(_provider: ProviderKind, _fallbackClassName: string): string {
  return "text-foreground";
}

const SEARCHABLE_MODEL_PICKER_THRESHOLD = 15;
const PI_FAVORITE_MODEL_STORAGE_KEY = "peakcode:pi-favourite-models:v1";
const FavoriteModelSlugs = Schema.Array(Schema.String);

// Keeps persisted favorite slugs compact and stable while preserving the user's order.
function toggleFavoriteModelSlug(current: ReadonlyArray<string>, slug: string): string[] {
  const normalizedCurrent = Array.from(new Set(current.filter((entry) => entry.trim().length > 0)));
  return normalizedCurrent.includes(slug)
    ? normalizedCurrent.filter((entry) => entry !== slug)
    : [...normalizedCurrent, slug];
}

function resolveSelectedModelLabel(input: {
  provider: ProviderKind;
  model: string;
  options: ReadonlyArray<ProviderModelOption>;
}): string {
  const exact = input.options.find((option) => option.slug === input.model);
  if (exact) {
    return exact.name;
  }
  return formatProviderModelOptionName({
    provider: input.provider,
    slug: input.model,
  });
}

function buildModelSearchText(option: ProviderModelOption): string {
  return [option.name, option.slug, option.upstreamProviderName, option.upstreamProviderId]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ")
    .toLowerCase();
}

export const ProviderModelPicker = memo(function ProviderModelPicker(props: {
  provider: ProviderKind;
  model: ModelSlug;
  modelOptionsByProvider: Record<ProviderKind, ReadonlyArray<ProviderModelOption>>;
  loadingModels?: boolean;
  activeProviderIconClassName?: string;
  compact?: boolean;
  disabled?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onSelectionCommitted?: () => void;
  shortcutLabel?: string | null;
  onProviderModelChange: (provider: ProviderKind, model: ModelSlug) => void;
}) {
  const { onOpenChange, onSelectionCommitted, open } = props;
  const [uncontrolledMenuOpen, setUncontrolledMenuOpen] = useState(false);
  const selectionCommitTimerRef = useRef<number | null>(null);
  const [modelSearchQuery, setModelSearchQuery] = useState("");
  const [piFavoriteModelSlugs, setPiFavoriteModelSlugs] = useLocalStorage(
    PI_FAVORITE_MODEL_STORAGE_KEY,
    [],
    FavoriteModelSlugs,
  );
  const deferredModelSearchQuery = useDeferredValue(modelSearchQuery);
  const activeProvider = props.provider;
  const isMenuOpen = open ?? uncontrolledMenuOpen;
  const selectedProviderOptions = props.modelOptionsByProvider[activeProvider];
  const selectedModelLabel = resolveSelectedModelLabel({
    provider: activeProvider,
    model: props.model,
    options: selectedProviderOptions,
  });
  const ProviderIcon = PROVIDER_ICON_COMPONENT_BY_PROVIDER[activeProvider];
  const setMenuOpen = useCallback(
    (nextOpen: boolean) => {
      if (open === undefined) {
        setUncontrolledMenuOpen(nextOpen);
      }
      if (!nextOpen) {
        setModelSearchQuery("");
      }
      onOpenChange?.(nextOpen);
    },
    [onOpenChange, open],
  );
  const scheduleSelectionCommitted = useCallback(() => {
    if (selectionCommitTimerRef.current !== null) {
      window.clearTimeout(selectionCommitTimerRef.current);
    }
    // Base UI restores focus to the trigger while closing; refocus callers after that tick.
    selectionCommitTimerRef.current = window.setTimeout(() => {
      selectionCommitTimerRef.current = null;
      onSelectionCommitted?.();
    }, 0);
  }, [onSelectionCommitted]);
  useEffect(
    () => () => {
      if (selectionCommitTimerRef.current !== null) {
        window.clearTimeout(selectionCommitTimerRef.current);
      }
    },
    [],
  );
  const handleModelChange = (provider: ProviderKind, value: string) => {
    if (props.disabled) return;
    if (!value) return;
    const resolvedModel = resolveSelectableModel(
      provider,
      value,
      props.modelOptionsByProvider[provider],
    );
    if (!resolvedModel) return;
    props.onProviderModelChange(provider, resolvedModel);
    setMenuOpen(false);
    scheduleSelectionCommitted();
  };

  const renderModelRadioGroup = () => {
    if (props.loadingModels) {
      return (
        <div className="w-60 space-y-2 px-2 py-2" aria-label="Loading models">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="flex items-center gap-2 rounded-md px-2 py-1.5">
              <Skeleton className="size-3.5 rounded-full" />
              <Skeleton className={cn("h-3.5 rounded-full", index % 3 === 0 ? "w-24" : "w-32")} />
            </div>
          ))}
        </div>
      );
    }

    const providerOptions = props.modelOptionsByProvider[activeProvider];
    const shouldShowSearch = providerOptions.length >= SEARCHABLE_MODEL_PICKER_THRESHOLD;
    const normalizedModelSearchQuery = deferredModelSearchQuery.trim().toLowerCase();
    const filteredOptions =
      shouldShowSearch && normalizedModelSearchQuery.length > 0
        ? providerOptions.filter((option) =>
            buildModelSearchText(option).includes(normalizedModelSearchQuery),
          )
        : providerOptions;
    const piFavoriteModelSlugSet = new Set(piFavoriteModelSlugs);
    const groupedOptions = groupProviderModelOptionsWithFavorites({
      options: filteredOptions,
      favoriteSlugs: piFavoriteModelSlugSet,
    });

    const content =
      groupedOptions.length > 0 ? (
        <MenuRadioGroup
          value={props.model}
          onValueChange={(value) => handleModelChange(activeProvider, value)}
        >
          {groupedOptions.map((group, index) => (
            <Fragment key={`${activeProvider}:${group.key}`}>
              <MenuGroup>
                {group.label ? <MenuGroupLabel>{group.label}</MenuGroupLabel> : null}
                {group.options.map((modelOption) => {
                  const isFavorite = piFavoriteModelSlugSet.has(modelOption.slug);
                  return (
                    <MenuRadioItem
                      key={`${activeProvider}:${modelOption.slug}`}
                      value={modelOption.slug}
                      onClick={() => {
                        setMenuOpen(false);
                        scheduleSelectionCommitted();
                      }}
                    >
                      <span className="flex w-full min-w-0 items-center gap-2">
                        <span className="block min-w-0 flex-1 truncate">{modelOption.name}</span>
                        <button
                          type="button"
                          aria-label={
                            isFavorite
                              ? `Remove ${modelOption.name} from favourites`
                              : `Add ${modelOption.name} to favourites`
                          }
                          className={cn(
                            "-me-2 ms-auto inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground/55 transition-colors hover:bg-[var(--color-background-elevated-tertiary)] hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/60",
                            isFavorite && "text-amber-300 hover:text-amber-200",
                          )}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setPiFavoriteModelSlugs((current) =>
                              toggleFavoriteModelSlug(current, modelOption.slug),
                            );
                          }}
                          onPointerDown={(event) => {
                            event.stopPropagation();
                          }}
                        >
                          {isFavorite ? (
                            <StarFilledIcon aria-hidden="true" className="size-3.5" />
                          ) : (
                            <StarIcon aria-hidden="true" className="size-3.5" />
                          )}
                        </button>
                      </span>
                    </MenuRadioItem>
                  );
                })}
              </MenuGroup>
              {index < groupedOptions.length - 1 ? <MenuSeparator /> : null}
            </Fragment>
          ))}
        </MenuRadioGroup>
      ) : (
        <div className="px-2 py-2 text-muted-foreground text-sm">No matches</div>
      );

    if (!shouldShowSearch) {
      return content;
    }

    return (
      <PickerPanelShell
        searchPlaceholder="Search models"
        query={modelSearchQuery}
        onQueryChange={setModelSearchQuery}
        stopSearchKeyPropagation
        autoFocusSearch
        widthClassName="w-60"
        bleedParentPadding
      >
        {content}
      </PickerPanelShell>
    );
  };

  return (
    <Menu
      open={isMenuOpen}
      onOpenChange={(open) => {
        if (props.disabled) {
          setMenuOpen(false);
          return;
        }
        setMenuOpen(open);
      }}
    >
      {props.shortcutLabel ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <MenuTrigger
                render={
                  <PickerTriggerButton
                    disabled={props.disabled ?? false}
                    compact={props.compact ?? false}
                    icon={
                      <ProviderIcon
                        aria-hidden="true"
                        className={cn(
                          "size-3.5 shrink-0",
                          providerIconClassName(activeProvider, "text-muted-foreground/70"),
                          props.activeProviderIconClassName,
                        )}
                      />
                    }
                    label={selectedModelLabel}
                  />
                }
              />
            }
          >
            <span className="sr-only">{selectedModelLabel}</span>
          </TooltipTrigger>
          {!isMenuOpen ? (
            <TooltipPopup side="top" sideOffset={6}>
              <span className="inline-flex items-center gap-2 px-1 py-0.5">
                <span>Change model</span>
                <ShortcutKbd
                  shortcutLabel={props.shortcutLabel}
                  className="h-4 min-w-4 px-1 text-[length:var(--app-font-size-ui-2xs,9px)] text-muted-foreground"
                />
              </span>
            </TooltipPopup>
          ) : null}
        </Tooltip>
      ) : (
        <MenuTrigger
          render={
            <PickerTriggerButton
              disabled={props.disabled ?? false}
              compact={props.compact ?? false}
              icon={
                <ProviderIcon
                  aria-hidden="true"
                  className={cn(
                    "size-3.5 shrink-0",
                    providerIconClassName(activeProvider, "text-muted-foreground/70"),
                    props.activeProviderIconClassName,
                  )}
                />
              }
              label={selectedModelLabel}
            />
          }
        >
          <span className="sr-only">{selectedModelLabel}</span>
        </MenuTrigger>
      )}
      <MenuPopup align="start">{renderModelRadioGroup()}</MenuPopup>
    </Menu>
  );
});
