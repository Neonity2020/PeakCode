// FILE: ModelProvidersSettingsPanel.tsx
// Purpose: "Model Providers" settings panel — edit pi's models.json provider map.
// Layer: Route screen support
import { useEffect, useMemo, useState } from "react";

import type {
  CustomModelConfig,
  ModelProviderApiKind,
  ModelProviderConfig,
} from "@peakcode/contracts";
import { useMutation } from "@tanstack/react-query";
import { ensureNativeApi } from "../nativeApi";
import { cleanModelProviderDraft, patchModelProvider } from "../lib/modelProviderDraft";
import { cn } from "~/lib/utils";
import { useMessages } from "../i18n";
import {
  useModelProvidersQuery,
  useSaveModelProvidersMutation,
} from "../lib/modelProvidersReactQuery";
import {
  MODEL_PROVIDER_TEMPLATES,
  MODEL_PROVIDER_TEMPLATE_BY_ID,
  modelProviderTemplateToConfig,
} from "../lib/modelProviderTemplates";
import { Loader2Icon, PlusIcon, SquarePenIcon, Trash2 } from "../lib/icons";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { toastManager } from "../components/ui/toast";
import { ModelProviderModelDialog } from "./ModelProviderModelDialog";

const API_KINDS: readonly ModelProviderApiKind[] = [
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generative-ai",
];

const EMPTY_TEMPLATE_ID = "custom";

/**
 * Control chrome shared by the right pane: filled, borderless-looking pill
 * controls (the panel's design language), matching the reference layout.
 */
const PANEL_CONTROL_CLASS = "rounded-xl border-foreground/9 bg-foreground/4 shadow-none";
const PANEL_SELECT_CLASS =
  "h-8 rounded-xl border-transparent bg-foreground/8 px-3 shadow-none [&_svg]:opacity-45";
const PANEL_LABEL_CLASS = "block text-xs font-medium text-foreground";
const PANEL_BUTTON_CLASS = "rounded-full text-[13px] before:rounded-full";
const PANEL_PRIMARY_BUTTON_CLASS = PANEL_BUTTON_CLASS;
const PANEL_SECONDARY_BUTTON_CLASS = cn(
  PANEL_BUTTON_CLASS,
  "border-transparent bg-foreground/10 text-foreground",
);

function cloneProvider(provider: ModelProviderConfig): ModelProviderConfig {
  return {
    ...provider,
    ...(provider.models ? { models: provider.models.map((model) => ({ ...model })) } : {}),
  };
}

function cloneProviders(
  providers: Readonly<Record<string, ModelProviderConfig>>,
): Record<string, ModelProviderConfig> {
  return Object.fromEntries(
    Object.entries(providers).map(([key, provider]) => [key, cloneProvider(provider)]),
  );
}

function toApiKind(value: string | undefined): ModelProviderApiKind | undefined {
  return API_KINDS.includes(value as ModelProviderApiKind)
    ? (value as ModelProviderApiKind)
    : undefined;
}

type Draft = Record<string, ModelProviderConfig>;

export function ModelProvidersSettingsPanel({ agentDir = "" }: { agentDir?: string }) {
  const messages = useMessages();
  const mp = messages.settings.modelProviders;
  const query = useModelProvidersQuery(agentDir);
  const saveMutation = useSaveModelProvidersMutation();
  const connectionTest = useMutation({
    mutationFn: (input: { provider: string; modelId?: string }) =>
      ensureNativeApi().server.testModelProvider({ ...input, ...(agentDir ? { agentDir } : {}) }),
  });

  const [draft, setDraft] = useState<Draft | null>(null);
  const [templateId, setTemplateId] = useState<string>(EMPTY_TEMPLATE_ID);
  const [customKey, setCustomKey] = useState("");
  const [customApiKey, setCustomApiKey] = useState("");
  const [selectedProviderKey, setSelectedProviderKey] = useState<string | null>(null);
  const [addProviderOpen, setAddProviderOpen] = useState(false);
  const [modelDialogOpen, setModelDialogOpen] = useState(false);
  /** Index of the model being edited; `null` adds a new one. */
  const [editingModelIndex, setEditingModelIndex] = useState<number | null>(null);

  const providers = query.data?.providers;
  useEffect(() => {
    if (providers) {
      setDraft((current) => current ?? cloneProviders(providers));
    }
  }, [providers]);

  const isDirty = useMemo(() => {
    if (!draft || !providers) return false;
    return JSON.stringify(draft) !== JSON.stringify(providers);
  }, [draft, providers]);

  const providerEntries = useMemo(
    () => (draft ? Object.entries(draft).toSorted(([a], [b]) => a.localeCompare(b)) : []),
    [draft],
  );

  if (!draft) {
    if (query.isLoading) {
      return (
        <div className="flex items-center gap-2 rounded-xl border border-dashed border-border/70 px-4 py-6 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" />
          {mp.filePathLabel}
        </div>
      );
    }
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-6 text-sm text-destructive">
        <div className="font-medium">{mp.loadFailedTitle}</div>
        <div className="mt-1">
          {query.error instanceof Error ? query.error.message : mp.loadFailedFallback}
        </div>
      </div>
    );
  }

  const updateProvider = (key: string, patch: Partial<ModelProviderConfig>) => {
    setDraft((current) => {
      const existing = current?.[key];
      if (!current || !existing) return current;
      return { ...current, [key]: patchModelProvider(existing, patch) };
    });
  };

  const updateModels = (key: string, models: CustomModelConfig[]) => {
    setDraft((current) => {
      const existing = current?.[key];
      if (!current || !existing) return current;
      return {
        ...current,
        [key]: patchModelProvider(existing, { models: models.length > 0 ? models : undefined }),
      };
    });
  };

  const removeProvider = (key: string) => {
    const name = draft[key]?.name ?? key;
    // 设置页其他删除操作也使用系统 confirm，保持一致。
    if (!window.confirm(mp.providerRemoveConfirm(name))) return;
    setDraft((current) => {
      if (!current) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
    setTemplateId(EMPTY_TEMPLATE_ID);
  };

  const addFromTemplate = () => {
    if (templateId === EMPTY_TEMPLATE_ID) {
      if (customKey.trim().length === 0) return;
      const key = customKey.trim();
      setDraft((current) => {
        if (!current) return current;
        const existing = current[key];
        return {
          ...current,
          [key]: {
            ...existing,
            name: existing?.name ?? key,
            api: existing?.api ?? "openai-completions",
            ...(customApiKey.trim().length > 0 ? { apiKey: customApiKey.trim() } : {}),
          },
        };
      });
      setCustomKey("");
      setCustomApiKey("");
      return;
    }

    const template = MODEL_PROVIDER_TEMPLATE_BY_ID.get(templateId);
    if (!template) return;
    const key = template.id;
    setDraft((current) => {
      if (!current) return current;
      const exists = current[key] !== undefined;
      const config = modelProviderTemplateToConfig(template, customApiKey);
      return { ...current, [key]: { ...(exists ? current[key] : {}), ...config } };
    });
    setTemplateId(EMPTY_TEMPLATE_ID);
    setCustomApiKey("");
    if (draft[key]) {
      toastManager.add({
        type: "success",
        title: mp.addDialogTitle,
        description: mp.providerExistsHint(draft[key]?.name ?? key),
      });
    }
  };

  const handleSave = () => {
    if (!draft) return;
    const cleaned = cleanModelProviderDraft(draft);
    saveMutation.mutate(
      { providers: cleaned, ...(agentDir ? { agentDir } : {}) },
      {
        onSuccess: (saved) => {
          setDraft(cloneProviders(saved.providers));
          connectionTest.reset();
          toastManager.add({ type: "success", title: mp.savedTitle });
        },
      },
    );
  };

  const regionLabel = (region: "china" | "global" | "local" | undefined) =>
    region === "china"
      ? mp.regionChina
      : region === "global"
        ? mp.regionGlobal
        : region === "local"
          ? mp.regionLocal
          : "";

  const templateOptions: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
  }> = [
    { id: EMPTY_TEMPLATE_ID, label: mp.templateCustom },
    ...MODEL_PROVIDER_TEMPLATES.map((template) => ({
      id: template.id,
      label: `${regionLabel(template.region)} · ${template.label}`,
    })),
  ];

  const builtinEntries = providerEntries.filter(([key]) => MODEL_PROVIDER_TEMPLATE_BY_ID.has(key));
  const customEntries = providerEntries.filter(([key]) => !MODEL_PROVIDER_TEMPLATE_BY_ID.has(key));
  const activeProviderKey =
    selectedProviderKey && draft[selectedProviderKey]
      ? selectedProviderKey
      : (providerEntries[0]?.[0] ?? null);
  const activeProvider = activeProviderKey ? draft[activeProviderKey] : undefined;
  const activeModels = activeProvider?.models ?? [];

  const renderProviderListRow = ([key, provider]: [string, ModelProviderConfig]) => {
    const active = key === activeProviderKey;
    return (
      <button
        key={key}
        type="button"
        onClick={() => {
          setSelectedProviderKey(key);
          setAddProviderOpen(false);
          setEditingModelIndex(null);
        }}
        className={cn(
          "flex h-7 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[12px] transition-colors",
          active
            ? "bg-[var(--sidebar-accent-active)] text-foreground"
            : "font-normal text-foreground/89 hover:bg-[var(--sidebar-accent)]",
        )}
      >
        <span className="min-w-0 flex-1 truncate">{provider.name ?? key}</span>
        <span
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            provider.apiKey ? "bg-success" : "bg-muted-foreground/40",
          )}
          aria-hidden
        />
      </button>
    );
  };

  const submitModel = (model: CustomModelConfig) => {
    if (!activeProviderKey) return;
    const index = editingModelIndex;
    const models = [...activeModels];
    if (index !== null && index < models.length) {
      models[index] = model;
    } else {
      models.push(model);
    }
    updateModels(activeProviderKey, models);
    setModelDialogOpen(false);
    setEditingModelIndex(null);
  };

  const renderAddProviderForm = () => (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-5 py-4">
      <h3 className="text-[13px] font-semibold text-foreground">{mp.addDialogTitle}</h3>
      <label className="block">
        <span className={PANEL_LABEL_CLASS}>{mp.templateLabel}</span>
        <Select
          value={templateId}
          onValueChange={(value) => {
            if (typeof value === "string") setTemplateId(value);
          }}
        >
          <SelectTrigger
            className={cn("mt-1 w-full", PANEL_SELECT_CLASS)}
            aria-label={mp.templateAria}
          >
            <SelectValue>
              {templateOptions.find((option) => option.id === templateId)?.label ??
                mp.templateCustom}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup>
            {templateOptions.map((option) => (
              <SelectItem key={option.id} hideIndicator value={option.id}>
                {option.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </label>
      {templateId === EMPTY_TEMPLATE_ID ? (
        <label className="block">
          <span className={PANEL_LABEL_CLASS}>{mp.providerKeyLabel}</span>
          <Input
            className={cn("mt-1 font-mono text-xs", PANEL_CONTROL_CLASS)}
            value={customKey}
            placeholder="my-provider"
            spellCheck={false}
            onChange={(event) => setCustomKey(event.target.value)}
          />
        </label>
      ) : null}
      <label className="block">
        <span className={PANEL_LABEL_CLASS}>{mp.providerApiKeyLabel}</span>
        <Input
          className={cn("mt-1 font-mono text-xs", PANEL_CONTROL_CLASS)}
          type="password"
          autoComplete="off"
          value={customApiKey}
          placeholder={
            templateId === EMPTY_TEMPLATE_ID
              ? "MY_API_KEY"
              : mp.providerApiKeyPlaceholder(
                  MODEL_PROVIDER_TEMPLATE_BY_ID.get(templateId)?.apiKeyEnv ?? "API_KEY",
                )
          }
          spellCheck={false}
          onChange={(event) => setCustomApiKey(event.target.value)}
        />
      </label>
      <p className="text-xs text-muted-foreground">{mp.providerApiKeyHint}</p>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          className={PANEL_PRIMARY_BUTTON_CLASS}
          onClick={() => {
            addFromTemplate();
            const nextKey = templateId === EMPTY_TEMPLATE_ID ? customKey.trim() : templateId;
            if (nextKey.length > 0) {
              setSelectedProviderKey(nextKey);
              setAddProviderOpen(false);
            }
          }}
          disabled={templateId === EMPTY_TEMPLATE_ID && customKey.trim().length === 0}
        >
          <PlusIcon className="size-3.5" />
          {mp.addButton}
        </Button>
        <Button
          type="button"
          size="sm"
          className={PANEL_SECONDARY_BUTTON_CLASS}
          onClick={() => setAddProviderOpen(false)}
        >
          {mp.cancelButton}
        </Button>
      </div>
    </div>
  );

  const renderModelRow = (model: CustomModelConfig, index: number) => {
    const rowKey = `${activeProviderKey}:${index}`;
    return (
      <div
        key={rowKey}
        className="flex items-center gap-2.5 rounded-lg border border-[color:var(--color-border-light)] px-3 py-2"
      >
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
          {model.id || "—"}
        </span>
        {model.name && model.name !== model.id ? (
          <span className="hidden min-w-0 max-w-40 truncate text-[11px] text-muted-foreground sm:inline">
            {model.name}
          </span>
        ) : null}
        {model.contextWindow !== undefined ? (
          <span className="shrink-0 rounded-md border border-[color:var(--color-border-light)] px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
            {mp.modelContextBadge(formatTokenCount(model.contextWindow))}
          </span>
        ) : null}
        {model.maxTokens !== undefined ? (
          <span className="shrink-0 rounded-md border border-[color:var(--color-border-light)] px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
            {mp.modelMaxTokensBadge(formatTokenCount(model.maxTokens))}
          </span>
        ) : null}
        <button
          type="button"
          className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
          aria-label={mp.modelEditAria(model.id)}
          onClick={() => {
            setEditingModelIndex(index);
            setModelDialogOpen(true);
          }}
        >
          <SquarePenIcon className="size-3.5" />
        </button>
        <button
          type="button"
          className="shrink-0 text-muted-foreground transition-colors hover:text-destructive"
          aria-label={mp.modelRemoveAria(model.id)}
          onClick={() => {
            setEditingModelIndex(null);
            updateModels(
              activeProviderKey ?? "",
              activeModels.filter((_, i) => i !== index),
            );
          }}
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
    );
  };

  const renderProviderDetail = (key: string, provider: ModelProviderConfig) => {
    const models = provider.models ?? [];
    const isTesting = connectionTest.variables?.provider === key;
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
        <div className="flex items-center gap-2">
          <Input
            className="h-7 min-w-0 flex-1 border-0 bg-transparent px-0 text-[15px] font-semibold shadow-none focus-visible:ring-0"
            value={provider.name ?? ""}
            placeholder={key}
            aria-label={mp.providerNameLabel}
            spellCheck={false}
            onChange={(event) => {
              const name = event.target.value.trim();
              updateProvider(key, { name: name || undefined });
            }}
          />
          <Button
            size="xs"
            className={PANEL_SECONDARY_BUTTON_CLASS}
            disabled={isDirty || saveMutation.isPending || connectionTest.isPending}
            onClick={() =>
              connectionTest.mutate({
                provider: key,
                ...(models[0]?.id ? { modelId: models[0].id } : {}),
              })
            }
          >
            {connectionTest.isPending && isTesting ? (
              <Loader2Icon data-icon="inline-start" className="animate-spin" />
            ) : null}
            {mp.testButton}
          </Button>
          <button
            type="button"
            className="shrink-0 text-muted-foreground transition-colors hover:text-destructive"
            aria-label={mp.providerRemoveAria(key)}
            onClick={() => removeProvider(key)}
          >
            <Trash2 className="size-4" />
          </button>
        </div>

        <label className="block">
          <span className={PANEL_LABEL_CLASS}>{mp.providerBaseUrlLabel}</span>
          <Input
            className={cn("mt-1 font-mono text-xs", PANEL_CONTROL_CLASS)}
            value={provider.baseUrl ?? ""}
            placeholder="https://api.example.com/v1"
            spellCheck={false}
            onChange={(event) => {
              const baseUrl = event.target.value.trim();
              updateProvider(key, { baseUrl: baseUrl || undefined });
            }}
          />
        </label>

        <label className="block">
          <span className={PANEL_LABEL_CLASS}>{mp.providerApiLabel}</span>
          <Select
            value={provider.api ?? "openai-completions"}
            onValueChange={(value) => {
              const kind = toApiKind(value ?? undefined);
              if (kind) {
                updateProvider(key, { api: kind });
              }
            }}
          >
            <SelectTrigger
              className={cn("mt-1 w-full", PANEL_SELECT_CLASS)}
              aria-label={mp.providerApiLabel}
            >
              <SelectValue>{provider.api ?? "openai-completions"}</SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {API_KINDS.map((kind) => (
                <SelectItem key={kind} hideIndicator value={kind}>
                  {kind}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </label>

        <label className="block">
          <span className={PANEL_LABEL_CLASS}>{mp.providerApiKeyLabel}</span>
          <Input
            className={cn("mt-1 font-mono text-xs", PANEL_CONTROL_CLASS)}
            type="password"
            autoComplete="off"
            value={provider.apiKey ?? ""}
            placeholder={MODEL_PROVIDER_TEMPLATE_BY_ID.get(key)?.apiKeyEnv ?? "API_KEY"}
            spellCheck={false}
            onChange={(event) => {
              const apiKey = event.target.value;
              updateProvider(key, { apiKey: apiKey || undefined });
            }}
          />
        </label>

        <div>
          <div className="flex items-center justify-between gap-2">
            <span className={PANEL_LABEL_CLASS}>{mp.providerModelsLabel}</span>
            <Button
              size="xs"
              className={PANEL_SECONDARY_BUTTON_CLASS}
              onClick={() => {
                setEditingModelIndex(null);
                setModelDialogOpen(true);
              }}
            >
              <PlusIcon className="size-3.5" />
              {mp.modelAddButton}
            </Button>
          </div>
          {models.length > 0 ? (
            <div className="mt-2 space-y-1">{models.map(renderModelRow)}</div>
          ) : (
            <div className="mt-2 rounded-lg border border-dashed border-border/70 px-3 py-4 text-center text-xs text-muted-foreground">
              {mp.emptyDescription}
            </div>
          )}
        </div>

        <p className="text-xs text-muted-foreground">{isDirty ? mp.testSaveFirst : mp.testHint}</p>
        {!isDirty && isTesting && !connectionTest.isPending ? (
          <p role="status" className="text-xs text-muted-foreground">
            {connectionTest.isError
              ? mp.testResults["request-failed"]
              : connectionTest.data
                ? mp.testResults[connectionTest.data.status]
                : null}
            {connectionTest.data?.model ? ` (${connectionTest.data.model})` : null}
          </p>
        ) : null}
      </div>
    );
  };

  return (
    <fieldset disabled={saveMutation.isPending} className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span>{mp.filePathLabel}</span>
        <code className="font-mono text-[11px]">{query.data?.path ?? ""}</code>
        <span aria-hidden>·</span>
        <span>{mp.builtinHint}</span>
      </div>

      <div className="overflow-hidden rounded-xl border border-[color:var(--color-border-light)] bg-card">
        <div className="flex min-h-[520px]">
          <div className="flex w-[248px] shrink-0 flex-col border-r border-[color:var(--color-border-light)] p-2">
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
              {builtinEntries.length > 0 ? (
                <div>
                  <div className="px-2 pb-1 text-[11px] text-muted-foreground/58">
                    {mp.builtinGroupLabel}
                  </div>
                  <div className="space-y-0.5">{builtinEntries.map(renderProviderListRow)}</div>
                </div>
              ) : null}
              <div>
                <div className="px-2 pb-1 text-[11px] text-muted-foreground/58">
                  {mp.customGroupLabel}
                </div>
                <div className="space-y-0.5">
                  {customEntries.length > 0 ? (
                    customEntries.map(renderProviderListRow)
                  ) : (
                    <div className="px-2 py-1 text-[11px] text-muted-foreground/60">
                      {mp.emptyDescription}
                    </div>
                  )}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setEditingModelIndex(null);
                setAddProviderOpen(true);
              }}
              className="mt-2 inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2 text-[12px] text-foreground/89 transition-colors hover:bg-[var(--sidebar-accent)]"
            >
              <PlusIcon className="size-3.5" />
              {mp.addDialogTitle}
            </button>
          </div>

          {addProviderOpen ? (
            renderAddProviderForm()
          ) : activeProviderKey && activeProvider ? (
            renderProviderDetail(activeProviderKey, activeProvider)
          ) : (
            <div className="flex flex-1 items-center justify-center px-6 py-10 text-center">
              <div>
                <div className="text-sm font-medium text-foreground">{mp.emptyTitle}</div>
                <div className="mt-1 text-xs text-muted-foreground">{mp.emptyDescription}</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {isDirty ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-[color:var(--color-border-light)] px-4 py-3">
          <span className="text-sm text-muted-foreground">{mp.unsavedHint}</span>
          <Button size="sm" disabled={saveMutation.isPending} onClick={handleSave}>
            {saveMutation.isPending ? <Loader2Icon className="size-3.5 animate-spin" /> : null}
            {saveMutation.isPending ? mp.savingButton : mp.saveButton}
          </Button>
        </div>
      ) : null}

      <ModelProviderModelDialog
        open={modelDialogOpen}
        model={editingModelIndex !== null ? (activeModels[editingModelIndex] ?? null) : null}
        onOpenChange={(open) => {
          setModelDialogOpen(open);
          if (!open) setEditingModelIndex(null);
        }}
        onSubmit={submitModel}
      />
    </fieldset>
  );
}

/** Render a token budget the way the model rows and dialog summarize them. */
const formatTokenCount = (value: number): string => {
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    return `${Number.isInteger(millions) ? millions : millions.toFixed(1)}M`;
  }
  if (value >= 1000) {
    const thousands = value / 1000;
    return `${Number.isInteger(thousands) ? thousands : thousands.toFixed(1)}K`;
  }
  return String(value);
};
