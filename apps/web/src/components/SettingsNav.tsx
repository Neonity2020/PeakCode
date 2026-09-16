// FILE: SettingsNav.tsx
// Purpose: In-page settings navigation (grouped topics with a back-to-workspace action).
// Layer: Component
// Exports: SettingsNav

import type { SettingsNavGroupId, SettingsNavItem, SettingsSectionId } from "../settingsNavigation";
import { isElectron } from "../env";
import { useLeadingColumnTrafficLightGutterClassName } from "../hooks/useDesktopTopBarGutter";
import { useMessages } from "../i18n/I18nContext";
import { ArrowLeftIcon } from "../lib/icons";
import { cn } from "../lib/utils";

export function SettingsNav({
  items,
  groups,
  activeSection,
  onSelectSection,
  onBack,
}: {
  readonly items: readonly SettingsNavItem[];
  readonly groups: ReadonlyArray<{ id: SettingsNavGroupId; label: string }>;
  readonly activeSection: SettingsSectionId;
  readonly onSelectSection: (section: SettingsSectionId) => void;
  readonly onBack: () => void;
}) {
  const messages = useMessages();
  const leadingColumnTrafficLightGutterClassName = useLeadingColumnTrafficLightGutterClassName();

  return (
    <nav className="flex h-full min-h-0 w-[232px] shrink-0 flex-col border-r border-border/70">
      {/* This column replaces the workspace sidebar, so it owns the window's
          left edge: it clears the desktop traffic lights and doubles as the
          drag region for the window's top-left corner. */}
      <div
        className={cn(
          "shrink-0 px-3 pt-3",
          isElectron && "drag-region",
          leadingColumnTrafficLightGutterClassName,
        )}
      >
        <button
          type="button"
          data-testid="settings-back-to-app"
          onClick={onBack}
          className="inline-flex h-8 items-center gap-2 rounded-lg px-2 text-[length:var(--app-font-size-ui,12px)] font-normal text-muted-foreground transition-colors hover:bg-[var(--sidebar-accent)] hover:text-foreground"
        >
          <ArrowLeftIcon className="size-[15px]" />
          <span>{messages.settings.backToApp}</span>
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 pt-4 pb-4">
        {groups.map((group, groupIndex) => {
          const groupItems = items.filter((item) => item.group === group.id);
          if (groupItems.length === 0) return null;

          return (
            <div key={group.id} className={groupIndex > 0 ? "pt-2" : undefined}>
              <div className="mb-1.5 px-2">
                <span className="text-[length:var(--app-font-size-ui,12px)] font-normal text-muted-foreground/58">
                  {group.label}
                </span>
              </div>
              <div className="space-y-0.5">
                {groupItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = item.id === activeSection;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      data-testid={`settings-nav-${item.id}`}
                      aria-current={isActive ? "page" : undefined}
                      onClick={() => onSelectSection(item.id)}
                      className={cn(
                        "flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-[length:var(--app-font-size-ui,12px)] transition-colors",
                        "hover:bg-[var(--sidebar-accent)]",
                        isActive
                          ? "bg-[var(--sidebar-accent-active)] font-medium text-foreground"
                          : "font-normal text-foreground/89",
                      )}
                    >
                      <Icon className="size-3.5 shrink-0 text-muted-foreground/79" />
                      <span className="truncate">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </nav>
  );
}
