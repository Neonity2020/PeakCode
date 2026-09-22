// FILE: SubAgentsSettingsPanel.tsx
// Purpose: The Settings → Sub-agents section. Lists the named workers the multi-agent
// orchestrator can delegate to and lets the user add, edit, and remove them — most
// importantly, bind each worker to its own model, which is what makes "big model plans,
// small models search" possible in one turn.
// Layer: Component

import type { SubAgentDefinition } from "@peakcode/contracts";
import { useQuery } from "@tanstack/react-query";
import { useDeferredValue, useMemo, useState } from "react";

import { useMessages } from "../i18n";
import { BotIcon, PlusIcon, SearchIcon } from "../lib/icons";
import { providerModelsQueryOptions } from "../lib/providerDiscoveryReactQuery";
import {
  emptySubAgentDraft,
  useDeleteSubAgentMutation,
  useSaveSubAgentMutation,
  useSubAgentsQuery,
} from "../subAgentsReactQuery";
import { SettingsCard, SettingsRow, SettingsSection } from "./settingsPrimitives";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "./ui/select";
import { Switch } from "./ui/switch";
import { toastManager } from "./ui/toast";

/** Sentinel for the model Select: `null` (inherit) is not a valid Select value. */
const INHERIT_MODEL_VALUE = "__inherit__";

type ModelOption = { slug: string; label: string };

export function SubAgentsSettingsPanel() {
  const messages = useMessages();
  const copy = messages.settings.subAgents;
  const subAgentsQuery = useSubAgentsQuery();
  // Pi discovers its models at runtime, so the picker is fed from the provider catalogue
  // rather than a static list. Same query the General panel's default-model picker uses.
  const modelsQuery = useQuery(providerModelsQueryOptions({ provider: "pi" }));
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [editing, setEditing] = useState<SubAgentDefinition | null>(null);

  const agents = subAgentsQuery.data?.subAgents ?? [];
  const modelOptions = useMemo<ModelOption[]>(
    () =>
      (modelsQuery.data?.models ?? []).map((model) => ({
        slug: model.slug,
        label: model.name.length > 0 ? model.name : model.slug,
      })),
    [modelsQuery.data?.models],
  );

  const normalizedSearch = deferredSearch.trim().toLowerCase();
  const visibleAgents = normalizedSearch
    ? agents.filter(
        (agent) =>
          agent.name.toLowerCase().includes(normalizedSearch) ||
          agent.id.toLowerCase().includes(normalizedSearch) ||
          agent.description.toLowerCase().includes(normalizedSearch),
      )
    : agents;

  return (
    <div className="space-y-6">
      <SettingsSection title={copy.heading} description={copy.description}>
        <p className="px-0.5 text-[12px] text-muted-foreground">{copy.modelIntro}</p>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{copy.scopeUserLabel}</Badge>
            <span className="text-xs text-muted-foreground">
              {copy.installedLabel(agents.length)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={copy.searchPlaceholder}
                aria-label={copy.searchPlaceholder}
                className="h-8 w-full pl-8 sm:w-64"
              />
            </div>
            <Button size="sm" onClick={() => setEditing(emptySubAgentDraft())}>
              <PlusIcon className="size-3.5" />
              {copy.newButton}
            </Button>
          </div>
        </div>

        {subAgentsQuery.isError ? (
          <SettingsCard>
            <div className="space-y-1 px-5 py-6">
              <h3 className="text-sm font-medium text-foreground">{copy.loadFailedTitle}</h3>
              <p className="text-xs text-muted-foreground">
                {subAgentsQuery.error instanceof Error
                  ? subAgentsQuery.error.message
                  : copy.loadFailedFallback}
              </p>
            </div>
          </SettingsCard>
        ) : visibleAgents.length === 0 ? (
          <SettingsCard>
            <div className="flex flex-col items-center gap-3 px-5 py-10 text-center">
              <BotIcon className="size-6 text-muted-foreground" />
              <div className="space-y-1">
                <h3 className="text-sm font-medium text-foreground">
                  {agents.length === 0 ? copy.emptyTitle : copy.searchEmptyTitle}
                </h3>
                {agents.length === 0 ? (
                  <p className="mx-auto max-w-md text-xs text-muted-foreground">
                    {copy.emptyDescription}
                  </p>
                ) : null}
              </div>
              {agents.length === 0 ? (
                <Button size="sm" onClick={() => setEditing(emptySubAgentDraft())}>
                  <PlusIcon className="size-3.5" />
                  {copy.newButton}
                </Button>
              ) : null}
            </div>
          </SettingsCard>
        ) : (
          <SettingsCard>
            {visibleAgents.map((agent) => (
              <SubAgentRow
                key={agent.id}
                agent={agent}
                modelOptions={modelOptions}
                onEdit={() => setEditing(agent)}
              />
            ))}
          </SettingsCard>
        )}
      </SettingsSection>

      {/* Remounting on the draft's handle is what reseeds the form: a blank draft and an
          existing worker are different edits, and reusing one component state between them
          would leak the previous worker's fields. */}
      {editing ? (
        <SubAgentEditor
          key={editing.id || "__new__"}
          draft={editing}
          modelOptions={modelOptions}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

function SubAgentRow({
  agent,
  modelOptions,
  onEdit,
}: {
  agent: SubAgentDefinition;
  modelOptions: readonly ModelOption[];
  onEdit: () => void;
}) {
  const messages = useMessages();
  const copy = messages.settings.subAgents;
  const saveMutation = useSaveSubAgentMutation();
  const deleteMutation = useDeleteSubAgentMutation();
  const modelLabel =
    agent.model === null
      ? copy.modelInheritLabel
      : (modelOptions.find((option) => option.slug === agent.model)?.label ?? agent.model);

  const reportError = (error: unknown) => {
    toastManager.add({
      type: "error",
      title: copy.saveFailedTitle,
      description: error instanceof Error ? error.message : copy.loadFailedFallback,
    });
  };

  return (
    <SettingsRow
      title={agent.name}
      description={agent.description || copy.toolsAllLabel}
      status={
        <span className="flex items-center gap-2">
          <code className="rounded bg-[var(--sidebar-accent)] px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {agent.id}
          </code>
          {!agent.enabled ? <Badge variant="outline">{copy.disabledLabel}</Badge> : null}
        </span>
      }
      control={
        <div className="flex items-center gap-2">
          {/* Changing the model is the single most common edit, so it is inline here
              rather than buried in the editor dialog. */}
          <Select
            value={agent.model ?? INHERIT_MODEL_VALUE}
            onValueChange={(value) => {
              saveMutation.mutate(
                {
                  subAgent: { ...agent, model: value === INHERIT_MODEL_VALUE ? null : value },
                },
                { onError: reportError },
              );
            }}
          >
            <SelectTrigger className="w-full sm:w-44" aria-label={copy.modelLabel}>
              <SelectValue>{modelLabel}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              <SelectItem hideIndicator value={INHERIT_MODEL_VALUE}>
                {copy.modelInheritLabel}
              </SelectItem>
              {modelOptions.map((option) => (
                <SelectItem hideIndicator key={option.slug} value={option.slug}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
          <Button size="xs" variant="outline" onClick={onEdit}>
            {copy.editButton}
          </Button>
          <Button
            size="xs"
            variant="outline"
            disabled={deleteMutation.isPending}
            onClick={() => {
              if (!window.confirm(copy.deleteConfirm(agent.name))) return;
              deleteMutation.mutate({ id: agent.id }, { onError: reportError });
            }}
          >
            {copy.deleteButton}
          </Button>
        </div>
      }
    />
  );
}

function SubAgentEditor({
  draft,
  modelOptions,
  onClose,
}: {
  draft: SubAgentDefinition;
  modelOptions: readonly ModelOption[];
  onClose: () => void;
}) {
  const messages = useMessages();
  const copy = messages.settings.subAgents;
  const saveMutation = useSaveSubAgentMutation();
  const [form, setForm] = useState<SubAgentDefinition>(draft);

  const patch = (values: Partial<SubAgentDefinition>) => {
    setForm((previous) => ({ ...previous, ...values }));
  };

  const reportError = (error: unknown) => {
    toastManager.add({
      type: "error",
      title: copy.saveFailedTitle,
      description: error instanceof Error ? error.message : copy.loadFailedFallback,
    });
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogPopup className="max-w-xl gap-0 p-0">
        <DialogHeader className="gap-1 p-4 pr-12">
          <DialogTitle className="text-base">{copy.heading}</DialogTitle>
          <DialogDescription className="text-xs">{copy.modelIntro}</DialogDescription>
        </DialogHeader>
        <DialogPanel className="max-h-[min(64vh,560px)] space-y-4 px-4 py-4">
          <Field label={copy.nameLabel}>
            <Input
              value={form.name}
              placeholder={copy.namePlaceholder}
              onChange={(event) => patch({ name: event.target.value })}
            />
          </Field>

          <Field label={copy.idLabel} hint={copy.idHint}>
            <Input
              value={form.id}
              placeholder="researcher"
              onChange={(event) => patch({ id: event.target.value })}
            />
          </Field>

          <Field label={copy.roleLabel}>
            <Input
              value={form.description}
              placeholder={copy.rolePlaceholder}
              onChange={(event) => patch({ description: event.target.value })}
            />
          </Field>

          <Field label={copy.modelLabel} hint={copy.modelHint}>
            <Select
              value={form.model ?? INHERIT_MODEL_VALUE}
              onValueChange={(value) =>
                patch({ model: value === INHERIT_MODEL_VALUE ? null : value })
              }
            >
              <SelectTrigger className="w-full" aria-label={copy.modelLabel}>
                <SelectValue>
                  {form.model === null
                    ? copy.modelInheritLabel
                    : (modelOptions.find((option) => option.slug === form.model)?.label ??
                      form.model)}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="start" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value={INHERIT_MODEL_VALUE}>
                  {copy.modelInheritLabel}
                </SelectItem>
                {modelOptions.map((option) => (
                  <SelectItem hideIndicator key={option.slug} value={option.slug}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </Field>

          <Field label={copy.systemPromptLabel}>
            <textarea
              value={form.systemPrompt}
              placeholder={copy.systemPromptPlaceholder}
              onChange={(event) => patch({ systemPrompt: event.target.value })}
              rows={3}
              className="w-full rounded-md border border-[color:var(--color-border-light)] bg-[var(--color-background-panel)] px-3 py-2 text-sm text-foreground outline-none focus:border-[color:var(--color-border-focus)]"
            />
          </Field>

          <Field label={copy.toolsLabel} hint={copy.toolsHint}>
            <Input
              value={form.tools.join(", ")}
              placeholder="read_file, grep, glob"
              onChange={(event) =>
                patch({
                  tools: event.target.value
                    .split(",")
                    .map((tool) => tool.trim())
                    .filter((tool) => tool.length > 0),
                })
              }
            />
          </Field>

          <div className="flex items-center justify-between rounded-md border border-[color:var(--color-border-light)] px-3 py-2">
            <div className="min-w-0">
              <div className="text-sm font-medium text-foreground">{copy.enabledLabel}</div>
              <div className="text-xs text-muted-foreground">{copy.enabledHint}</div>
            </div>
            <Switch
              checked={form.enabled}
              onCheckedChange={(checked) => patch({ enabled: checked })}
            />
          </div>
        </DialogPanel>
        <DialogFooter className="px-4 py-3 sm:justify-between">
          <DialogClose
            render={
              <Button size="sm" variant="ghost">
                {copy.cancelButton}
              </Button>
            }
          />
          <Button
            size="sm"
            disabled={form.name.trim().length === 0 || saveMutation.isPending}
            onClick={() => {
              saveMutation.mutate(
                { subAgent: { ...form, name: form.name.trim() } },
                { onSuccess: onClose, onError: reportError },
              );
            }}
          >
            {saveMutation.isPending ? copy.savingButton : copy.saveButton}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-foreground">{label}</span>
      {children}
      {hint ? <span className="block text-[11px] text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

export default SubAgentsSettingsPanel;
