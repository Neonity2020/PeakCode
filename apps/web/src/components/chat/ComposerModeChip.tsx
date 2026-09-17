import type { ProviderInteractionMode } from "@peakcode/contracts";
import { memo } from "react";
import { BiTargetLock } from "react-icons/bi";
import { GoTasklist, GoZap } from "react-icons/go";

import { cn } from "~/lib/utils";

/**
 * The composer's mode chip.
 *
 * One button that cycles Agent → Plan → Goal, matching the reference UI: the three modes are
 * a single dial, not three menu items, so the control shows the current one and clicking is
 * the whole interaction. It lives in the always-visible toolbar (not behind the `+` menu)
 * because the mode decides what the very next turn is allowed to do — burying it made it
 * discoverable only by accident.
 */
const MODE_ORDER: readonly ProviderInteractionMode[] = ["default", "plan", "goal"];

export const ComposerModeChip = memo(function ComposerModeChip({
  mode,
  disabled,
  onChange,
}: {
  mode: ProviderInteractionMode;
  disabled?: boolean | undefined;
  onChange: (mode: ProviderInteractionMode) => void;
}) {
  const next = MODE_ORDER[(MODE_ORDER.indexOf(mode) + 1) % MODE_ORDER.length]!;
  const { label, hint, Icon } = modePresentation(mode);

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(next)}
      title={`${label} · ${hint}（点击切换到 ${modePresentation(next).label}）`}
      aria-label={`${label} · ${hint}`}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1",
        "text-[length:var(--app-font-size-ui-sm,11px)] font-medium transition-colors",
        "text-[var(--color-text-foreground-secondary)] hover:bg-[var(--color-background-button-secondary-hover)] hover:text-[var(--color-text-foreground)]",
        "disabled:opacity-50",
        mode === "plan" && "text-[var(--color-text-accent)] hover:text-[var(--color-text-accent)]",
        mode === "goal" && "text-[var(--color-text-accent)] hover:text-[var(--color-text-accent)]",
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="leading-none">{label}</span>
    </button>
  );
});

function modePresentation(mode: ProviderInteractionMode): {
  label: string;
  hint: string;
  Icon: typeof GoZap;
} {
  switch (mode) {
    case "plan":
      return { label: "Plan", hint: "只调研不出手，先给方案", Icon: GoTasklist };
    case "goal":
      return { label: "Goal", hint: "锁定目标，自主走到验收", Icon: BiTargetLock };
    default:
      return { label: "Agent", hint: "直接动手：读改跑测一条龙", Icon: GoZap };
  }
}
