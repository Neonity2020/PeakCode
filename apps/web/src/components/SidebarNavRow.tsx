// FILE: SidebarNavRow.tsx
// Purpose: One flat navigation row in the sidebar's top menu (icon + label, optional shortcut).
// Layer: Component
// Exports: SidebarNavRow

import type { LucideIcon } from "~/lib/icons";
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
}: {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly onClick?: () => void;
  readonly active?: boolean;
  readonly disabled?: boolean;
  readonly shortcutLabel?: string | null;
  readonly testId?: string;
}) {
  const shortcutParts = shortcutLabel ? splitShortcutLabel(shortcutLabel) : [];

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        size="default"
        data-active={active}
        data-testid={testId}
        aria-current={active ? "page" : undefined}
        className="group/sidebar-primary-action h-8 gap-2.5 rounded-lg px-2 font-system-ui text-[length:var(--app-font-size-ui,12px)] font-normal text-foreground/89 transition-colors hover:bg-[var(--sidebar-accent)] data-[active=true]:bg-[var(--sidebar-accent-active)] data-[active=true]:text-[var(--sidebar-accent-foreground)]"
        aria-disabled={disabled || undefined}
        disabled={disabled}
        onClick={onClick}
      >
        <span className="inline-flex size-5 shrink-0 items-center justify-center text-muted-foreground/79">
          <Icon className="size-[15px]" />
        </span>
        <span className="truncate">{label}</span>
        {shortcutParts.length > 0 ? (
          <span className="ml-auto opacity-0 transition-opacity group-hover/sidebar-primary-action:opacity-100 group-focus-visible/sidebar-primary-action:opacity-100">
            <KbdGroup>
              {shortcutParts.map((part) => (
                <Kbd key={part}>{part}</Kbd>
              ))}
            </KbdGroup>
          </span>
        ) : null}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
