// FILE: ModelProviderModelDialog.tsx
// Purpose: "添加模型 / 编辑模型" dialog for one entry of a provider's `models`
// array — id, context window, max output tokens and the capability picker.
// Layer: Settings overlay — mounted from the model providers panel.

import { useEffect, useState } from "react";

import type { CustomModelConfig, ModelInputTypeKind } from "@peakcode/contracts";
import { cn } from "~/lib/utils";
import { useMessages } from "../i18n";
import {
  BASE_INPUT_TYPE,
  INPUT_TYPE_ORDER,
  modelInputTypes,
  withModelInputTypes,
} from "../lib/modelCapabilities";
import { LockIcon } from "../lib/icons";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Dialog, DialogPopup, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";

/** Empty "add" dialog starts from the reference defaults. */
const DEFAULT_CONTEXT_WINDOW = "1000000";
const DEFAULT_MAX_TOKENS = "128000";

export interface ModelProviderModelDialogProps {
  readonly open: boolean;
  /** Model being edited; `null` opens the dialog in "add" mode. */
  readonly model: CustomModelConfig | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSubmit: (model: CustomModelConfig) => void;
}

function digitsOnly(value: string): string {
  return value.replace(/[^0-9]/g, "");
}

function parseCount(value: string): number | undefined {
  const parsed = Number(digitsOnly(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/** Blank for unset values so the field falls back to its placeholder. */
function formatCount(value: number | undefined): string {
  return value !== undefined ? String(value) : "";
}

export function ModelProviderModelDialog({
  open,
  model,
  onOpenChange,
  onSubmit,
}: ModelProviderModelDialogProps) {
  const messages = useMessages();
  const mp = messages.settings.modelProviders;

  const [id, setId] = useState("");
  const [contextWindow, setContextWindow] = useState(DEFAULT_CONTEXT_WINDOW);
  const [maxTokens, setMaxTokens] = useState(DEFAULT_MAX_TOKENS);
  const [inputTypes, setInputTypes] = useState<readonly ModelInputTypeKind[]>([BASE_INPUT_TYPE]);
  const [showIdError, setShowIdError] = useState(false);

  // Re-seed on every open so a cancelled edit never leaks into the next one.
  useEffect(() => {
    if (!open) return;
    setShowIdError(false);
    setId(model?.id ?? "");
    // New models start from the defaults; existing models only display what
    // they configure, so re-saving an untouched entry writes nothing new.
    setContextWindow(model ? formatCount(model.contextWindow) : DEFAULT_CONTEXT_WINDOW);
    setMaxTokens(model ? formatCount(model.maxTokens) : DEFAULT_MAX_TOKENS);
    setInputTypes(model ? modelInputTypes(model) : [BASE_INPUT_TYPE]);
  }, [open, model]);

  const trimmedId = id.trim();
  const idIsEmpty = trimmedId.length === 0;

  /** Whether the dialog holds anything that is not what it was opened with. */
  const seeds = {
    id: model?.id ?? "",
    contextWindow: model ? formatCount(model.contextWindow) : DEFAULT_CONTEXT_WINDOW,
    maxTokens: model ? formatCount(model.maxTokens) : DEFAULT_MAX_TOKENS,
    inputTypes: model ? modelInputTypes(model) : [BASE_INPUT_TYPE],
  };
  const isDirty =
    id !== seeds.id ||
    contextWindow !== seeds.contextWindow ||
    maxTokens !== seeds.maxTokens ||
    inputTypes.join(",") !== seeds.inputTypes.join(",");

  /**
   * Escape, the close button and a click on the backdrop all land here. Dismissing the
   * dialog throws the definition away, so each of those asks first — the explicit Cancel
   * button does not.
   */
  const requestClose = (next: boolean) => {
    if (!next && isDirty && !window.confirm(messages.common.unsavedChangesConfirm)) return;
    onOpenChange(next);
  };

  const toggleInputType = (kind: ModelInputTypeKind, checked: boolean) => {
    setInputTypes((current) => {
      const next = new Set(current);
      if (checked) next.add(kind);
      else next.delete(kind);
      next.add(BASE_INPUT_TYPE);
      return INPUT_TYPE_ORDER.filter((candidate) => next.has(candidate));
    });
  };

  const handleSubmit = () => {
    if (idIsEmpty) {
      // Save stays enabled the way the reference design shows it; an empty id
      // is reported on the field itself instead of a dead-looking button.
      setShowIdError(true);
      return;
    }
    const contextWindowValue = parseCount(contextWindow);
    const maxTokensValue = parseCount(maxTokens);
    // Spread-then-override keeps existing keys in place and appends new ones;
    // a cleared field stays `undefined`, which every consumer treats as unset.
    onSubmit(
      withModelInputTypes(
        {
          ...model,
          id: trimmedId,
          contextWindow: contextWindowValue,
          maxTokens: maxTokensValue,
        },
        inputTypes,
      ),
    );
  };

  const fieldLabel = "block text-[13px] text-muted-foreground";
  const fieldGap = "mt-2.5 border-[color:var(--color-border-heavy)]";
  const dialogButtonClass = "h-[30px] rounded-lg px-3.5 text-[13px]";

  return (
    <Dialog open={open} onOpenChange={requestClose}>
      <DialogPopup className="max-w-[576px] gap-0 p-0">
        <div className="flex flex-col p-4">
          <DialogTitle className="pr-8 text-base">
            {model ? mp.modelEditTitle : mp.modelAddTitle}
          </DialogTitle>

          <div className="mt-4 flex flex-col">
            <label>
              <span className={fieldLabel}>{mp.modelIdLabel}</span>
              <Input
                className={cn(fieldGap, "h-8 rounded-lg px-2.5 text-[13px]")}
                value={id}
                placeholder={mp.modelIdPlaceholder}
                spellCheck={false}
                autoComplete="off"
                autoFocus
                aria-invalid={showIdError && idIsEmpty ? true : undefined}
                onChange={(event) => setId(event.target.value)}
              />
            </label>

            <label className="mt-4 block">
              <span className={fieldLabel}>{mp.modelContextLabel}</span>
              <Input
                className={cn(fieldGap, "h-8 rounded-lg px-2.5 text-[13px] tabular-nums")}
                value={contextWindow}
                inputMode="numeric"
                placeholder={DEFAULT_CONTEXT_WINDOW}
                onChange={(event) => setContextWindow(digitsOnly(event.target.value))}
              />
            </label>

            <label className="mt-4 block">
              <span className={fieldLabel}>{mp.modelMaxTokensLabel}</span>
              <Input
                className={cn(fieldGap, "h-8 rounded-lg px-2.5 text-[13px] tabular-nums")}
                value={maxTokens}
                inputMode="numeric"
                placeholder={DEFAULT_MAX_TOKENS}
                onChange={(event) => setMaxTokens(digitsOnly(event.target.value))}
              />
            </label>

            <div className="mt-4">
              <span className={fieldLabel}>{mp.modelInputTypesLabel}</span>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                {INPUT_TYPE_ORDER.map((kind) => (
                  <ModelCapabilityChip
                    key={kind}
                    label={mp.inputTypes[kind]}
                    checked={inputTypes.includes(kind)}
                    locked={kind === BASE_INPUT_TYPE}
                    onCheckedChange={(checked) => toggleInputType(kind, checked)}
                  />
                ))}
              </div>
            </div>

            <div className="mt-4">
              <span className={fieldLabel}>{mp.modelOutputTypesLabel}</span>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <ModelCapabilityChip label={mp.inputTypes.text} checked locked />
              </div>
            </div>
          </div>

          <div className="mt-5 flex items-center justify-end gap-2">
            <Button
              className={cn(dialogButtonClass, "bg-background text-foreground")}
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {mp.cancelButton}
            </Button>
            <Button className={dialogButtonClass} onClick={handleSubmit}>
              {mp.modelSaveButton}
            </Button>
          </div>
        </div>
      </DialogPopup>
    </Dialog>
  );
}

interface ModelCapabilityChipProps {
  readonly label: string;
  readonly checked: boolean;
  /** Locked chips render checked and cannot be toggled off. */
  readonly locked?: boolean;
  readonly onCheckedChange?: (checked: boolean) => void;
}

function ModelCapabilityChip({
  label,
  checked,
  locked = false,
  onCheckedChange,
}: ModelCapabilityChipProps) {
  return (
    <label
      className={cn(
        "flex h-8 items-center gap-2 rounded-lg border border-border px-2.5 text-[13px] text-foreground transition-colors",
        locked ? "cursor-default" : "cursor-pointer hover:bg-foreground/4",
      )}
    >
      <Checkbox
        checked={checked}
        readOnly={locked}
        aria-label={label}
        onCheckedChange={(value) => onCheckedChange?.(value === true)}
      />
      <span>{label}</span>
      {locked ? <LockIcon aria-hidden className="size-3.5 text-muted-foreground" /> : null}
    </label>
  );
}
