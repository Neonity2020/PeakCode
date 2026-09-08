// FILE: ModelProvidersSettingsPanel.tsx
// Purpose: "Model Providers" settings panel — edit pi's models.json provider map.
// Layer: Route screen support
import { useEffect, useMemo, useState } from "react";

import type {
  CustomModelConfig,
  ModelProviderApiKind,
  ModelProviderConfig,
} from "@peakcode/contracts";
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
import { ChevronDownIcon, Loader2Icon, PlusIcon, Trash2, XIcon } from "../lib/icons";
import { Button } from "../components/ui/button";
import { Collapsible, CollapsibleContent } from "../components/ui/collapsible";
import { Input } from "../components/ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Switch } from "../components/ui/switch";
import { toastManager } from "../components/ui/toast";

const API_KINDS: readonly ModelProviderApiKind[] = [
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generative-ai",
];

const EMPTY_TEMPLATE_ID = "custom";

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

function toStringValue(value: unknown): string {
  return typeof value === "string" ? value : value === undefined ? "" : String(value);
}

function toApiKind(value: string | undefined): ModelProviderApiKind | undefined {
  return API_KINDS.includes(value as ModelProviderApiKind)
    ? (value as ModelProviderApiKind)
    : undefined;
}

type Draft = Record<string, ModelProviderConfig>;

export function ModelProvidersSettingsPanel() {
  const messages = useMessages();
  const mp = messages.settings.modelProviders;
  const query = useModelProvidersQuery();
  const saveMutation = useSaveModelProvidersMutation();

  const [draft, setDraft] = useState<Draft | null>(null);
  const [templateId, setTemplateId] = useState<string>(EMPTY_TEMPLATE_ID);
  const [customKey, setCustomKey] = useState("");
  const [customApiKey, setCustomApiKey] = useState("");
  const [openKeys, setOpenKeys] = useState<Record<string, boolean>>({});

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
    () => (draft ? Object.entries(draft).sort(([a], [b]) => a.localeCompare(b)) : []),
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
      return { ...current, [key]: { ...existing, ...patch } };
    });
  };

  const updateModels = (key: string, models: CustomModelConfig[]) => {
    setDraft((current) => {
      const existing = current?.[key];
      if (!current || !existing) return current;
      return { ...current, [key]: { ...existing, models } };
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
    setOpenKeys((current) => ({ ...current, [key]: false }));
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
            ...(customApiKey.trim().length > 0 ? { apiKey: customApiKey.trim() } : {}),
          },
        };
      });
      setOpenKeys((current) => ({ ...current, [key]: true }));
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
    setOpenKeys((current) => ({ ...current, [key]: true }));
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
    const cleaned: Draft = {};
    for (const [key, provider] of Object.entries(draft)) {
      const models = (provider.models ?? []).filter((model) => model.id.trim().length > 0);
      cleaned[key] = { ...provider, ...(models.length > 0 ? { models } : {}) };
    }
    saveMutation.mutate(
      { providers: cleaned },
      {
        onSuccess: () => {
          toastManager.add({ type: "success", title: mp.savedTitle });
        },
      },
    );
  };

  const renderModelRow = (providerKey: string, model: CustomModelConfig, index: number) => {
    const models = draft[providerKey]?.models ?? [];
    const removeModel = () => {
      void updateModels(
        providerKey,
        models.filter((_, i) => i !== index),
      );
    };

    return (
      <div
        key={`${providerKey}-${index}-${model.id}`}
        className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center"
      >
        <div className="min-w-0 flex-1">
          <label className="flex items-center gap-2">
            <span className="sr-only">{mp.modelIdLabel}</span>
            <Input
              className="w-full font-mono text-xs"
              value={model.id}
              placeholder={mp.modelIdLabel}
              spellCheck={false}
              onChange={(event) => {
                const next = [...models];
                next[index] = { ...model, id: event.target.value };
                void updateModels(providerKey, next);
              }}
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 sm:shrink-0">
          <label className="flex items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground">{mp.modelNameLabel}</span>
            <Input
              className="h-7 w-32 text-xs"
              value={model.name ?? ""}
              placeholder={model.id}
              spellCheck={false}
              onChange={(event) => {
                const next = [...models];
                next[index] = {
                  ...model,
                  ...(event.target.value.trim().length > 0 ? { name: event.target.value } : {}),
                };
                void updateModels(providerKey, next);
              }}
            />
          </label>
          <Switch
            checked={model.reasoning === true}
            aria-label={mp.modelReasoningLabel}
            onCheckedChange={(checked) => {
              const next = [...models];
              next[index] = { ...model, reasoning: Boolean(checked) };
              void updateModels(providerKey, next);
            }}
          />
          <Switch
            checked={(model.input ?? []).includes("image")}
            aria-label={mp.modelInputImage}
            onCheckedChange={(checked) => {
              const next = [...models];
              const base = model.input ?? [];
              const input = checked
                ? Array.from(new Set([...base, "image"]))
                : base.filter((kind) => kind !== "image");
              next[index] = {
                ...model,
                ...(input.length > 0 ? { input: input as CustomModelConfig["input"] } : {}),
              };
              void updateModels(providerKey, next);
            }}
          />
          <button
            type="button"
            className="text-muted-foreground transition-colors hover:text-destructive"
            aria-label={mp.modelRemoveAria(model.id)}
            onClick={removeModel}
          >
            <XIcon className="size-4" />
          </button>
        </div>
      </div>
    );
  };

  const renderProviderCard = ([key, provider]: [string, ModelProviderConfig]) => {
    const open = openKeys[key] ?? false;
    const models = provider.models ?? [];
    return (
      <Collapsible
        key={key}
        open={open}
        onOpenChange={(next) => setOpenKeys((current) => ({ ...current, [key]: next }))}
      >
        <div className="overflow-hidden rounded-2xl border border-border/70 bg-card/50">
          <div className="flex min-h-11 items-center gap-2 px-3 py-2">
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
              onClick={() => setOpenKeys((current) => ({ ...current, [key]: !current[key] }))}
            >
              <span className="min-w-0 flex-1 text-sm font-medium text-foreground">
                {provider.name ?? key}
              </span>
              <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                {provider.api ?? "—"}
              </span>
              {provider.baseUrl ? (
                <span className="hidden shrink-0 max-w-48 truncate font-mono text-[11px] text-muted-foreground md:inline">
                  {provider.baseUrl}
                </span>
              ) : null}
              <span className="shrink-0 rounded-full bg-muted/60 px-2 py-0.5 text-[11px] text-muted-foreground">
                {models.length}
              </span>
              <ChevronDownIcon
                className={cn(
                  "size-4 shrink-0 text-muted-foreground transition-transform",
                  open && "rotate-180",
                )}
              />
            </button>
            <button
              type="button"
              className="shrink-0 text-muted-foreground transition-colors hover:text-destructive"
              aria-label={mp.providerRemoveAria(key)}
              onClick={(event) => {
                event.stopPropagation();
                removeProvider(key);
              }}
            >
              <Trash2 className="size-4" />
            </button>
          </div>

          <CollapsibleContent>
            <div className="space-y-3 border-t border-border/70 bg-muted/20 px-3 py-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="block text-xs font-medium text-foreground">
                    {mp.providerNameLabel}
                  </span>
                  <Input
                    className="mt-1"
                    value={provider.name ?? ""}
                    spellCheck={false}
                    onChange={(event) => {
                      const value = event.target.value;
                      updateProvider(key, {
                        ...(value.trim().length > 0 ? { name: value } : {}),
                      });
                    }}
                  />
                </label>
                <label className="block">
                  <span className="block text-xs font-medium text-foreground">
                    {mp.providerApiLabel}
                  </span>
                  <Select
                    value={provider.api ?? "openai-completions"}
                    onValueChange={(value) => {
                      const kind = toApiKind(value ?? undefined);
                      if (kind) {
                        updateProvider(key, { api: kind });
                      }
                    }}
                  >
                    <SelectTrigger className="mt-1 w-full" aria-label={mp.providerApiLabel}>
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
              </div>

              <label className="block">
                <span className="block text-xs font-medium text-foreground">
                  {mp.providerBaseUrlLabel}
                </span>
                <Input
                  className="mt-1 font-mono text-xs"
                  value={provider.baseUrl ?? ""}
                  placeholder="https://api.example.com/v1"
                  spellCheck={false}
                  onChange={(event) => {
                    const value = event.target.value;
                    updateProvider(key, {
                      ...(value.trim().length > 0 ? { baseUrl: value } : {}),
                    });
                  }}
                />
              </label>

              <label className="block">
                <span className="block text-xs font-medium text-foreground">
                  {mp.providerApiKeyLabel}
                </span>
                <Input
                  className="mt-1 font-mono text-xs"
                  type="password"
                  autoComplete="off"
                  value={provider.apiKey ?? ""}
                  placeholder={mp.providerApiKeyPlaceholder(
                    MODEL_PROVIDER_TEMPLATE_BY_ID.get(key)?.apiKeyEnv ?? "$API_KEY",
                  )}
                  spellCheck={false}
                  onChange={(event) => {
                    const value = event.target.value;
                    updateProvider(key, {
                      ...(value.length > 0 ? { apiKey: value } : {}),
                    });
                  }}
                />
                <span className="mt-1 block text-xs text-muted-foreground">
                  {mp.providerApiKeyHint}
                </span>
              </label>

              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-foreground">
                    {mp.providerModelsLabel}
                  </span>
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() =>
                      updateModels(key, [...models, { id: "", name: "New model", input: ["text"] }])
                    }
                  >
                    <PlusIcon className="size-3.5" />
                    {mp.modelAddButton}
                  </Button>
                </div>
                {models.length > 0 ? (
                  <div className="mt-1 divide-y divide-border/60 rounded-xl border border-border/70">
                    {models.map((model, index) => renderModelRow(key, model, index))}
                  </div>
                ) : (
                  <div className="mt-1 rounded-xl border border-dashed border-border/70 px-3 py-4 text-center text-xs text-muted-foreground">
                    {mp.emptyDescription}
                  </div>
                )}
              </div>
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>
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
    readonly region?: "china" | "global" | "local";
  }> = [
    { id: EMPTY_TEMPLATE_ID, label: mp.templateCustom },
    ...MODEL_PROVIDER_TEMPLATES.map((template) => ({
      id: template.id,
      label: `${regionLabel(template.region)} · ${template.label}`,
      region: template.region,
    })),
  ];

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h2 className="px-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          {mp.filePathLabel}
        </h2>
        <div className="rounded-2xl border border-border/70 bg-card/50 px-4 py-3">
          <code className="break-all font-mono text-[11px] text-muted-foreground">
            {query.data?.path ?? ""}
          </code>
          <p className="mt-1 text-xs text-muted-foreground">{mp.builtinHint}</p>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="px-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          {mp.addDialogTitle}
        </h2>
        <div className="rounded-2xl border border-border/70 bg-card/50 px-3 py-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="block min-w-0 flex-1">
              <span className="block text-xs font-medium text-foreground">{mp.templateLabel}</span>
              <Select
                value={templateId}
                onValueChange={(value) => {
                  if (typeof value === "string") setTemplateId(value);
                }}
              >
                <SelectTrigger className="mt-1 w-full" aria-label={mp.templateAria}>
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
              <label className="block min-w-0 sm:w-44">
                <span className="block text-xs font-medium text-foreground">
                  {mp.providerKeyLabel}
                </span>
                <Input
                  className="mt-1"
                  value={customKey}
                  placeholder="my-provider"
                  spellCheck={false}
                  onChange={(event) => setCustomKey(event.target.value)}
                />
              </label>
            ) : null}
            <label className="block min-w-0 flex-1">
              <span className="block text-xs font-medium text-foreground">
                {mp.providerApiKeyLabel}
              </span>
              <Input
                className="mt-1 font-mono text-xs"
                type="password"
                autoComplete="off"
                value={customApiKey}
                placeholder={
                  templateId === EMPTY_TEMPLATE_ID
                    ? "$MY_API_KEY"
                    : mp.providerApiKeyPlaceholder(
                        MODEL_PROVIDER_TEMPLATE_BY_ID.get(templateId)?.apiKeyEnv ?? "$API_KEY",
                      )
                }
                spellCheck={false}
                onChange={(event) => setCustomApiKey(event.target.value)}
              />
            </label>
            <Button
              type="button"
              size="sm"
              onClick={addFromTemplate}
              disabled={templateId === EMPTY_TEMPLATE_ID && customKey.trim().length === 0}
            >
              <PlusIcon className="size-3.5" />
              {mp.addButton}
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{mp.providerApiKeyHint}</p>
        </div>
      </section>

      {providerEntries.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/70 bg-card/35 px-5 py-10 text-center">
          <div className="text-sm font-medium text-foreground">{mp.emptyTitle}</div>
          <div className="mt-1 text-sm text-muted-foreground">{mp.emptyDescription}</div>
        </div>
      ) : (
        <section className="space-y-2">
          <h2 className="px-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            {mp.providerModelsLabel}
          </h2>
          <div className="space-y-2">{providerEntries.map(renderProviderCard)}</div>
        </section>
      )}

      {isDirty ? (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/70 bg-muted/30 px-4 py-3">
          <span className="text-sm text-muted-foreground">{mp.unsavedHint}</span>
          <Button size="sm" disabled={saveMutation.isPending} onClick={handleSave}>
            {saveMutation.isPending ? <Loader2Icon className="size-3.5 animate-spin" /> : null}
            {saveMutation.isPending ? mp.savingButton : mp.saveButton}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
