// FILE: settingsPrimitives.tsx
// Purpose: Shared layout building blocks for settings panels — a titled
// section, a card that groups rows, a titled row with a control slot, and the
// small "reset to default" affordance. Extracted from the settings route so
// section panels that live in their own files (About, and any future ones)
// render with the same spacing and borders as the inline panels.
// Layer: Component primitives

import type { ReactNode } from "react";

import { Undo2Icon } from "../lib/icons";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

/**
 * A titled group of settings: bold heading, optional description, then the
 * card that holds the rows.
 */
export function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <header className="px-0.5">
        <h2 className="text-[14px] leading-5 font-semibold text-foreground">{title}</h2>
        {description ? (
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{description}</p>
        ) : null}
      </header>
      {children}
    </section>
  );
}

/** White card that groups rows; rows draw their own separators. */
export function SettingsCard({ children }: { children: ReactNode }) {
  return (
    <div
      className="overflow-hidden rounded-xl border border-[color:var(--color-border-light)] bg-[var(--color-background-panel)]"
      data-slot="settings-card"
    >
      {children}
    </div>
  );
}

export function SettingsRow({
  title,
  description,
  status,
  resetAction,
  control,
  children,
  onClick,
}: {
  title: string;
  description: string;
  status?: ReactNode;
  resetAction?: ReactNode;
  control?: ReactNode;
  children?: ReactNode;
  onClick?: () => void;
}) {
  return (
    <div
      className="group/settings-row border-b border-[color:var(--color-border-light)] px-5 py-4 transition-colors last:border-b-0 hover:bg-[var(--sidebar-accent)]"
      data-slot="settings-row"
    >
      <div
        className={cn(
          "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between",
          onClick && "cursor-pointer",
        )}
        onClick={onClick}
      >
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex min-h-5 items-center gap-1.5">
            <h3 className="text-sm font-medium text-foreground">{title}</h3>
            <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center opacity-0 transition-opacity group-hover/settings-row:opacity-100 group-focus-within/settings-row:opacity-100">
              {resetAction}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">{description}</p>
          {status ? <div className="pt-1 text-[11px] text-muted-foreground">{status}</div> : null}
        </div>
        {control ? (
          <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto sm:justify-end">
            {control}
          </div>
        ) : null}
      </div>
      {children}
    </div>
  );
}

export function SettingResetButton({
  label,
  onClick,
  tooltip,
  ariaLabel,
}: {
  label: string;
  onClick: () => void;
  tooltip?: string;
  ariaLabel?: string;
}) {
  const resolvedTooltip = tooltip ?? "Reset to default";
  const resolvedAriaLabel = ariaLabel ?? `Reset ${label} to default`;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={resolvedAriaLabel}
            className="size-5 rounded-sm p-0 text-muted-foreground hover:text-foreground"
            onClick={(event) => {
              event.stopPropagation();
              onClick();
            }}
          >
            <Undo2Icon className="size-3" />
          </Button>
        }
      />
      <TooltipPopup side="top">{resolvedTooltip}</TooltipPopup>
    </Tooltip>
  );
}
