// FILE: ComposerPluginChip.tsx
// Purpose: Renders one plugin attached to the next turn as a removable pill, next to the
//          image and assistant-selection attachments it travels with.
// Layer: Chat composer presentation
// Depends on: the mention reference shape, shared chip styles, and the i18n messages.

import { memo } from "react";
import type { ProviderMentionReference } from "@peakcode/contracts";
import { PlugIcon, XIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { useMessages } from "~/i18n";
import {
  COMPOSER_ATTACHMENT_CHIP_CLASS_NAME,
  COMPOSER_INLINE_CHIP_DISMISS_BUTTON_CLASS_NAME,
} from "../composerInlineChip";

interface ComposerPluginChipProps {
  plugin: ProviderMentionReference;
  /** Display label resolved by the caller; falls back to the manifest name. */
  label: string;
  onRemovePlugin: (pluginPath: string) => void;
}

export const ComposerPluginChip = memo(function ComposerPluginChip({
  plugin,
  label,
  onRemovePlugin,
}: ComposerPluginChipProps) {
  const messages = useMessages();

  return (
    <div className={COMPOSER_ATTACHMENT_CHIP_CLASS_NAME} data-testid="composer-plugin-chip">
      <span className="flex min-w-0 max-w-[200px] items-center gap-1.5 pl-1.5" title={label}>
        <PlugIcon className="size-3.5 shrink-0 text-muted-foreground/70" aria-hidden="true" />
        <span className="min-w-0 truncate text-[12px] font-medium text-foreground/84">{label}</span>
      </span>

      <button
        type="button"
        className={cn(
          COMPOSER_INLINE_CHIP_DISMISS_BUTTON_CLASS_NAME,
          "size-5 rounded-full text-muted-foreground/62 hover:bg-[var(--color-background-button-secondary-hover)] hover:text-foreground",
        )}
        onClick={() => onRemovePlugin(plugin.path)}
        aria-label={messages.composer.removePlugin(label)}
      >
        <XIcon className="size-3" />
      </button>
    </div>
  );
});
