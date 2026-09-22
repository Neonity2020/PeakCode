import type { ProviderInteractionMode } from "@peakcode/contracts";
import { memo } from "react";
import { BiTargetLock } from "react-icons/bi";
import { GoTasklist, GoZap } from "react-icons/go";
import { TbSitemap } from "react-icons/tb";

import { useMessages } from "~/i18n";
import { composerInteractionModeLabel } from "~/lib/composerInteractionMode";
import { cn } from "~/lib/utils";

/**
 * The composer's mode chip.
 *
 * One button that cycles Agent → Plan → Goal → Multi-Agent, matching the reference UI: the
 * modes are a single dial, not a menu, so the control shows the current one and clicking is
 * the whole interaction. It lives in the always-visible toolbar (not behind the `+` menu)
 * because the mode decides what the very next turn is allowed to do — burying it made it
 * discoverable only by accident.
 */
const MODE_ORDER: readonly ProviderInteractionMode[] = ["default", "plan", "goal", "multi"];

const MODE_ICONS: Record<ProviderInteractionMode, typeof GoZap> = {
  default: GoZap,
  plan: GoTasklist,
  goal: BiTargetLock,
  multi: TbSitemap,
};

export const ComposerModeChip = memo(function ComposerModeChip({
  mode,
  disabled,
  onChange,
}: {
  mode: ProviderInteractionMode;
  disabled?: boolean | undefined;
  onChange: (mode: ProviderInteractionMode) => void;
}) {
  const messages = useMessages();
  const next = MODE_ORDER[(MODE_ORDER.indexOf(mode) + 1) % MODE_ORDER.length]!;
  const label = composerInteractionModeLabel(mode);
  const hint = modeHint(messages, mode);
  const Icon = MODE_ICONS[mode];

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(next)}
      title={`${label} · ${hint} · ${messages.composer.interactionMode.switchHint(composerInteractionModeLabel(next))}`}
      aria-label={`${label} · ${hint}`}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1",
        "text-[length:var(--app-font-size-ui-sm,11px)] font-medium transition-colors",
        "text-[var(--color-text-foreground-secondary)] hover:bg-[var(--color-background-button-secondary-hover)] hover:text-[var(--color-text-foreground)]",
        "disabled:opacity-50",
        mode === "plan" && "text-[var(--color-text-accent)] hover:text-[var(--color-text-accent)]",
        mode === "goal" && "text-[var(--color-text-accent)] hover:text-[var(--color-text-accent)]",
        mode === "multi" && "text-[var(--color-text-accent)] hover:text-[var(--color-text-accent)]",
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="leading-none">{label}</span>
    </button>
  );
});

function modeHint(messages: ReturnType<typeof useMessages>, mode: ProviderInteractionMode): string {
  const hints = messages.composer.interactionMode;
  switch (mode) {
    case "plan":
      return hints.planHint;
    case "goal":
      return hints.goalHint;
    case "multi":
      return hints.multiHint;
    default:
      return hints.agentHint;
  }
}
