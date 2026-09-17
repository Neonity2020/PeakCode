// FILE: SidebarNavRow.tsx
// Purpose: One flat navigation row in the sidebar's top menu (icon + label, optional
//          shortcut, and an optional trailing action button beside the row).
// Layer: Component
// Exports: SidebarNavRow

import type { ReactNode } from "react";

import type { LucideIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { splitShortcutLabel } from "../keybindings";
import { Kbd, KbdGroup } from "./ui/kbd";
import { SidebarMenuButton, SidebarMenuItem } from "./ui/sidebar";

export function SidebarNavRow({
  icon: Icon,
  label,
  onClick,
  active = false,
  disabled = false,
  shortcutLabel,
  testId,
  trailing,
}: {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly onClick?: () => void;
  readonly active?: boolean;
  readonly disabled?: boolean;
  readonly shortcutLabel?: string | null;
  readonly testId?: string;
  /** An extra control rendered beside the row, e.g. the mobile/IM entry next to Settings. */
  readonly trailing?: ReactNode;
}) {
  const shortcutParts = shortcutLabel ? splitShortcutLabel(shortcutLabel) : [];

  return (
    <SidebarMenuItem className={trailing === undefined ? undefined : "flex items-center gap-1"}>
      <SidebarMenuButton
        size="default"
        data-active={active}
        data-testid={testId}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group/sidebar-primary-action h-8 gap-2.5 rounded-lg px-2 font-system-ui text-[length:var(--app-font-size-ui,12px)] font-normal text-foreground/89 transition-colors hover:bg-[var(--sidebar-accent)] data-[active=true]:bg-[var(--sidebar-accent-active)] data-[active=true]:text-[var(--sidebar-accent-foreground)]",
          trailing === undefined ? undefined : "min-w-0 flex-1",
        )}
        aria-disabled={disabled || undefined}
        disabled={disabled}
        onClick={onClick}
      >
        <span className="inline-flex size-5 shrink-0 items-center justify-center text-muted-foreground/79">
          <Icon className="size-[15px]" />
        </span>
        <span className="truncate">{label}</span>
        {shortcutParts.length > 0 ? (
          // Hidden in the phone layout: there is no keyboard to press there, and a touch
          // tap leaves the hover reveal sticky, so the hint would sit in every row.
          <span className="ml-auto opacity-0 transition-opacity group-hover/sidebar-primary-action:opacity-100 group-focus-visible/sidebar-primary-action:opacity-100 max-md:hidden">
            <KbdGroup>
              {shortcutParts.map((part) => (
                <Kbd key={part}>{part}</Kbd>
              ))}
            </KbdGroup>
          </span>
        ) : null}
      </SidebarMenuButton>
      {trailing}
    </SidebarMenuItem>
  );
}
