// FILE: ComposerExtrasMenu.tsx
// Purpose: Hosts the composer `+` menu: attachments first, then the plugin picker
//          (multi-select) and quick composer mode toggles.
// Layer: Chat composer presentation
// Depends on: shared menu primitives, icon buttons, plugin suggestions, and
//             caller-owned composer state callbacks.

import { memo, useId, useRef, type ChangeEvent } from "react";

import { PaperclipIcon, PlugIcon, PlusIcon } from "~/lib/icons";
import { useMessages } from "~/i18n";
import { Button } from "../ui/button";
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "../ui/menu";

export type ComposerExtrasPluginOption = {
  /** Mention reference the plugin is attached to the turn as. */
  reference: { name: string; path: string };
  /** Dedup key the selection set is keyed by — see `pluginMentionDedupKey`. */
  key: string;
  label: string;
  description: string | null;
};

export const ComposerExtrasMenu = memo(function ComposerExtrasMenu(props: {
  supportsFastMode: boolean;
  fastModeEnabled: boolean;
  plugins: ReadonlyArray<ComposerExtrasPluginOption>;
  selectedPluginKeys: ReadonlySet<string>;
  onAddPhotos: (files: File[]) => void;
  onToggleFastMode: () => void;
  onTogglePlugin: (plugin: ComposerExtrasPluginOption) => void;
}) {
  const messages = useMessages();
  const inputId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Reset the hidden input so selecting the same image twice still emits a change event.
  const handleFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length > 0) {
      props.onAddPhotos(files);
    }
    event.target.value = "";
  };

  return (
    <>
      <input
        id={inputId}
        ref={fileInputRef}
        data-testid="composer-photo-input"
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        onChange={handleFileInputChange}
      />
      <Menu>
        <MenuTrigger
          render={
            <Button
              size="icon-sm"
              variant="chrome"
              className="shrink-0 rounded-md"
              aria-label={messages.composer.extrasAria}
            />
          }
        >
          <PlusIcon aria-hidden="true" className="size-4" />
        </MenuTrigger>
        <MenuPopup align="start">
          <MenuItem
            onClick={() => {
              fileInputRef.current?.click();
            }}
          >
            <PaperclipIcon className="size-4 shrink-0" />
            {messages.composer.addImage}
          </MenuItem>

          {/* Checkbox items keep the submenu open, so several plugins are one visit. */}
          {props.plugins.length > 0 ? (
            <>
              <MenuSeparator />
              <MenuSub>
                <MenuSubTrigger>
                  <PlugIcon className="size-4 shrink-0" />
                  {messages.composer.pluginsLabel}
                </MenuSubTrigger>
                <MenuSubPopup className="w-72">
                  <MenuGroup>
                    <MenuGroupLabel>{messages.composer.pluginsHint}</MenuGroupLabel>
                    {props.plugins.map((plugin) => (
                      <MenuCheckboxItem
                        key={plugin.key}
                        checked={props.selectedPluginKeys.has(plugin.key)}
                        onCheckedChange={() => {
                          props.onTogglePlugin(plugin);
                        }}
                        className="py-2"
                      >
                        <span className="flex min-w-0 flex-col gap-0.5">
                          <span className="truncate">{plugin.label}</span>
                          {plugin.description ? (
                            <span className="truncate text-[length:var(--app-font-size-ui-xs,10px)] leading-4 text-muted-foreground/70">
                              {plugin.description}
                            </span>
                          ) : null}
                        </span>
                      </MenuCheckboxItem>
                    ))}
                  </MenuGroup>
                </MenuSubPopup>
              </MenuSub>
            </>
          ) : null}

          {props.supportsFastMode ? (
            <>
              <MenuSeparator />
              <MenuSub>
                <MenuSubTrigger>Fast</MenuSubTrigger>
                <MenuSubPopup>
                  <MenuRadioGroup
                    value={props.fastModeEnabled ? "fast" : "normal"}
                    onValueChange={(value) => {
                      const shouldEnableFast = value === "fast";
                      if (shouldEnableFast === props.fastModeEnabled) return;
                      props.onToggleFastMode();
                    }}
                  >
                    <MenuRadioItem value="normal">Default</MenuRadioItem>
                    <MenuRadioItem value="fast">Fast</MenuRadioItem>
                  </MenuRadioGroup>
                </MenuSubPopup>
              </MenuSub>
            </>
          ) : null}
        </MenuPopup>
      </Menu>
    </>
  );
});
