import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type FormEvent,
} from "react";
import {
  BookIcon,
  CalendarIcon,
  ClockIcon,
  RocketIcon,
  SparklesIcon,
  Trash2,
  PlayIcon,
  CheckIcon,
  XIcon,
  LoaderIcon,
} from "../lib/icons";
import { SidebarInset } from "./ui/sidebar";
import { useMessages } from "../i18n/I18nContext";
import { readNativeApi } from "../nativeApi";
import { useLatestProjectStore } from "../latestProjectStore";
import { useStore } from "../store";
import type {
  Automation,
  AutomationId,
  AutomationScheduleType,
  ProjectId,
} from "@peakcode/contracts";

type AutomationTemplate = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly prompt: string;
  readonly scheduleType: AutomationScheduleType;
  readonly cronExpression: string | null;
  readonly icon: ComponentType<{ className?: string }>;
};

const AUTOMATION_TEMPLATES: ReadonlyArray<AutomationTemplate> = [
  {
    id: "daily-briefing",
    title: "Daily briefing",
    description: "Each morning, summarize yesterday's commits, open PRs, and team activity.",
    prompt:
      "Create a daily briefing automation that runs every weekday at 8:00 AM, summarizing yesterday's commits, open pull requests, and team activity in the active project.",
    scheduleType: "cron",
    cronExpression: "0 8 * * 1-5",
    icon: CalendarIcon,
  },
  {
    id: "weekly-review",
    title: "Weekly review",
    description:
      "Every Friday, generate a recap of the week with highlights, blockers, and next steps.",
    prompt:
      "Create a weekly review automation that runs every Friday at 4:00 PM, generating a recap of the week with highlights, blockers, and proposed next steps.",
    scheduleType: "cron",
    cronExpression: "0 16 * * 5",
    icon: BookIcon,
  },
  {
    id: "project-monitor",
    title: "Project monitor",
    description:
      "Watch the active project for failing checks, stale issues, or drift, and surface a digest on demand.",
    prompt:
      "Create an on-demand project monitor automation that scans the active project for failing checks, stale issues, or unreviewed pull requests and produces a prioritized digest.",
    scheduleType: "manual",
    cronExpression: null,
    icon: RocketIcon,
  },
];

export function AutomationsView() {
  const messages = useMessages();
  const latestProjectId = useLatestProjectStore((s) => s.latestProjectId);
  const projects = useStore((state) => state.projects);
  // Automations can be created from any chat, including the hidden Home chat
  // container project (kind === "chat"). Surface those too so automations
  // created from the Home chat are not silently invisible here.
  const projectIds = useMemo(() => projects.map((project) => project.id), [projects]);
  const targetProjectId =
    latestProjectId && projectIds.includes(latestProjectId)
      ? latestProjectId
      : (projectIds[0] ?? null);

  const [automations, setAutomations] = useState<ReadonlyArray<Automation>>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showTemplateDialog, setShowTemplateDialog] = useState(false);
  const [editingAutomation, setEditingAutomation] = useState<Automation | null>(null);
  const [runningAutomationId, setRunningAutomationId] = useState<AutomationId | null>(null);

  const loadAutomations = useCallback(async () => {
    const api = readNativeApi();
    if (!api || projectIds.length === 0) {
      setAutomations([]);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const orderedProjectIds = [
        ...(latestProjectId && projectIds.includes(latestProjectId) ? [latestProjectId] : []),
        ...projectIds.filter((projectId) => projectId !== latestProjectId),
      ];
      const result = await Promise.all(
        orderedProjectIds.map((projectId) => api.automation.list({ projectId })),
      );
      setAutomations(result.flat());
    } catch (error) {
      console.error("Failed to load automations:", error);
    } finally {
      setLoading(false);
    }
  }, [latestProjectId, projectIds]);

  useEffect(() => {
    loadAutomations();
  }, [loadAutomations]);

  const handleCreateFromTemplate = useCallback(
    async (template: AutomationTemplate) => {
      const api = readNativeApi();
      if (!api || !targetProjectId) return;
      try {
        await api.automation.create({
          projectId: targetProjectId,
          title: template.title,
          description: template.description,
          prompt: template.prompt,
          scheduleType: template.scheduleType,
          cronExpression: template.cronExpression,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          templateId: template.id,
        });
        setShowTemplateDialog(false);
        await loadAutomations();
      } catch (error) {
        console.error("Failed to create automation from template:", error);
      }
    },
    [targetProjectId, loadAutomations],
  );

  const handleRunAutomation = useCallback(
    async (automationId: AutomationId) => {
      const api = readNativeApi();
      if (!api) return;
      try {
        setRunningAutomationId(automationId);
        await api.automation.run({ automationId });
        await loadAutomations();
      } catch (error) {
        console.error("Failed to run automation:", error);
      } finally {
        setRunningAutomationId(null);
      }
    },
    [loadAutomations],
  );

  const handleDeleteAutomation = useCallback(
    async (automationId: AutomationId) => {
      const api = readNativeApi();
      if (!api) return;
      try {
        await api.automation.delete({ automationId });
        await loadAutomations();
      } catch (error) {
        console.error("Failed to delete automation:", error);
      }
    },
    [loadAutomations],
  );

  const handleToggleEnabled = useCallback(
    async (automation: Automation) => {
      const api = readNativeApi();
      if (!api) return;
      try {
        await api.automation.update({
          automationId: automation.automationId,
          isEnabled: !automation.isEnabled,
        });
        await loadAutomations();
      } catch (error) {
        console.error("Failed to toggle automation:", error);
      }
    },
    [loadAutomations],
  );

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden isolate">
      <div className="flex h-full min-h-0 flex-col bg-background">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border/60 px-6 py-4">
          <div className="min-w-0">
            <h1 className="truncate text-[20px] font-semibold text-foreground">
              {messages.sidebar.automationsLabel}
            </h1>
            <p className="mt-0.5 truncate text-[13px] text-muted-foreground/80">
              {messages.automations.subtitle}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowTemplateDialog(true)}
              disabled={!targetProjectId}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border/60 bg-background/60 px-3 text-[12px] text-foreground/80 transition-colors hover:bg-accent/40 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <SparklesIcon className="size-3.5" />
              {messages.automations.viewTemplates}
            </button>
            <button
              type="button"
              onClick={() => setShowCreateDialog(true)}
              disabled={!targetProjectId}
              className="inline-flex h-8 items-center rounded-md bg-foreground/90 px-3 text-[12px] font-medium text-background transition-colors hover:bg-foreground disabled:cursor-not-allowed disabled:opacity-60"
            >
              {messages.automations.createFromChat}
            </button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-10">
          {loading ? (
            <div className="mx-auto flex w-full max-w-2xl flex-col items-center text-center">
              <LoaderIcon className="size-7 text-muted-foreground/70 animate-spin" />
              <p className="mt-4 text-[13px] text-muted-foreground/85">
                {messages.automations.loading}
              </p>
            </div>
          ) : projectIds.length === 0 ? (
            <div className="mx-auto flex w-full max-w-2xl flex-col items-center text-center">
              <div className="mb-6 flex size-16 items-center justify-center rounded-full border border-border/60 bg-background/60">
                <ClockIcon className="size-7 text-muted-foreground/70" />
              </div>
              <h2 className="text-[20px] font-semibold text-foreground">
                {messages.automations.noProjectTitle}
              </h2>
              <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground/85">
                {messages.automations.noProjectDescription}
              </p>
            </div>
          ) : automations.length === 0 ? (
            <div className="mx-auto flex w-full max-w-2xl flex-col items-center text-center">
              <div className="mb-6 flex size-16 items-center justify-center rounded-full border border-border/60 bg-background/60">
                <ClockIcon className="size-7 text-muted-foreground/70" />
              </div>
              <h2 className="text-[20px] font-semibold text-foreground">
                {messages.automations.emptyTitle}
              </h2>
              <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground/85">
                {messages.automations.emptyDescription}
              </p>
            </div>
          ) : (
            <div className="mx-auto w-full max-w-3xl">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {automations.map((automation) => (
                  <AutomationCard
                    key={automation.automationId}
                    automation={automation}
                    isRunning={runningAutomationId === automation.automationId}
                    onRun={handleRunAutomation}
                    onDelete={handleDeleteAutomation}
                    onToggleEnabled={handleToggleEnabled}
                    onEdit={setEditingAutomation}
                  />
                ))}
              </div>
            </div>
          )}

          {!loading && automations.length > 0 && (
            <div className="mx-auto mt-10 w-full max-w-3xl">
              <h3 className="px-1 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                {messages.automations.templatesHeading}
              </h3>
              <p className="mt-1 px-1 text-[12px] text-muted-foreground/80">
                {messages.automations.templatesHint}
              </p>
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                {AUTOMATION_TEMPLATES.map((template) => (
                  <AutomationTemplateCard
                    key={template.id}
                    template={template}
                    onClick={() => handleCreateFromTemplate(template)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {showTemplateDialog && (
        <TemplateDialog
          templates={AUTOMATION_TEMPLATES}
          onSelect={handleCreateFromTemplate}
          onClose={() => setShowTemplateDialog(false)}
        />
      )}

      {showCreateDialog && (
        <CreateAutomationDialog
          projectId={targetProjectId}
          onClose={() => setShowCreateDialog(false)}
          onCreated={async () => {
            setShowCreateDialog(false);
            await loadAutomations();
          }}
        />
      )}

      {editingAutomation && (
        <EditAutomationDialog
          automation={editingAutomation}
          onClose={() => setEditingAutomation(null)}
          onUpdated={async () => {
            setEditingAutomation(null);
            await loadAutomations();
          }}
        />
      )}
    </SidebarInset>
  );
}

function AutomationCard({
  automation,
  isRunning,
  onRun,
  onDelete,
  onToggleEnabled,
  onEdit,
}: {
  automation: Automation;
  isRunning: boolean;
  onRun: (id: AutomationId) => void;
  onDelete: (id: AutomationId) => void;
  onToggleEnabled: (automation: Automation) => void;
  onEdit: (automation: Automation) => void;
}) {
  const messages = useMessages();
  const Icon = automation.scheduleType === "cron" ? CalendarIcon : RocketIcon;

  return (
    <div className="group flex flex-col gap-3 rounded-xl border border-border/60 bg-background/60 p-4 transition-colors hover:border-border hover:bg-accent/30">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg border border-border/60 bg-background/80">
            <Icon className="size-4 text-foreground/85" />
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold leading-snug text-foreground">
              {automation.title}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground/70">
              {automation.scheduleType === "cron"
                ? `${messages.automations.cron}: ${automation.cronExpression}`
                : messages.automations.manual}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onToggleEnabled(automation)}
            className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-accent/40 hover:text-foreground"
            title={
              automation.isEnabled ? messages.automations.disable : messages.automations.enable
            }
          >
            {automation.isEnabled ? (
              <CheckIcon className="size-3.5 text-green-500" />
            ) : (
              <XIcon className="size-3.5" />
            )}
          </button>
          <button
            type="button"
            onClick={() => onRun(automation.automationId)}
            disabled={isRunning}
            className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-accent/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            title={messages.automations.runNow}
          >
            {isRunning ? (
              <LoaderIcon className="size-3.5 animate-spin" />
            ) : (
              <PlayIcon className="size-3.5" />
            )}
          </button>
          <button
            type="button"
            onClick={() => onEdit(automation)}
            className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-accent/40 hover:text-foreground"
            title={messages.automations.edit}
          >
            <SparklesIcon className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onDelete(automation.automationId)}
            className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-accent/40 hover:text-red-500"
            title={messages.automations.delete}
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>
      {automation.description && (
        <p className="line-clamp-2 text-[12px] leading-relaxed text-muted-foreground/85">
          {automation.description}
        </p>
      )}
      {automation.scriptCommand ? (
        <p
          className="line-clamp-2 rounded-md border border-border/50 bg-muted/30 px-2 py-1 font-mono text-[11px] leading-relaxed text-muted-foreground/85"
          title={automation.scriptCommand}
        >
          {messages.automations.script}: {automation.scriptCommand}
        </p>
      ) : (
        <p className="text-[11px] text-amber-600 dark:text-amber-400">
          {messages.automations.missingScript}
        </p>
      )}
      {automation.lastRunAt && (
        <p className="text-[11px] text-muted-foreground/60">
          {messages.automations.lastRun}: {new Date(automation.lastRunAt).toLocaleString()}
        </p>
      )}
    </div>
  );
}

function AutomationTemplateCard({
  template,
  onClick,
}: {
  template: AutomationTemplate;
  onClick: () => void;
}) {
  const Icon = template.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col items-start gap-3 rounded-xl border border-border/60 bg-background/60 p-4 text-left transition-colors hover:border-border hover:bg-accent/30"
    >
      <div className="flex size-9 items-center justify-center rounded-lg border border-border/60 bg-background/80">
        <Icon className="size-4 text-foreground/85" />
      </div>
      <div className="min-w-0">
        <p className="text-[13px] font-semibold leading-snug text-foreground">{template.title}</p>
        <p className="mt-1 line-clamp-3 text-[12px] leading-relaxed text-muted-foreground/85">
          {template.description}
        </p>
      </div>
    </button>
  );
}

function TemplateDialog({
  templates,
  onSelect,
  onClose,
}: {
  templates: ReadonlyArray<AutomationTemplate>;
  onSelect: (template: AutomationTemplate) => void;
  onClose: () => void;
}) {
  const messages = useMessages();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-xl border border-border/60 bg-background p-6 shadow-lg">
        <h2 className="text-[16px] font-semibold text-foreground">
          {messages.automations.chooseTemplate}
        </h2>
        <p className="mt-1 text-[13px] text-muted-foreground/80">
          {messages.automations.chooseTemplateDescription}
        </p>
        <div className="mt-4 grid grid-cols-1 gap-3">
          {templates.map((template) => (
            <TemplateDialogButton key={template.id} template={template} onSelect={onSelect} />
          ))}
        </div>
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 items-center rounded-md border border-border/60 bg-background/60 px-3 text-[12px] text-foreground/80 transition-colors hover:bg-accent/40"
          >
            {messages.automations.cancel}
          </button>
        </div>
      </div>
    </div>
  );
}

function TemplateDialogButton({
  template,
  onSelect,
}: {
  template: AutomationTemplate;
  onSelect: (template: AutomationTemplate) => void;
}) {
  const Icon = template.icon;
  return (
    <button
      type="button"
      onClick={() => onSelect(template)}
      className="flex items-start gap-3 rounded-lg border border-border/60 bg-background/60 p-3 text-left transition-colors hover:border-border hover:bg-accent/30"
    >
      <Icon className="mt-0.5 size-4 text-foreground/85" />
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-foreground">{template.title}</p>
        <p className="mt-0.5 text-[12px] text-muted-foreground/80">{template.description}</p>
      </div>
    </button>
  );
}

function CreateAutomationDialog({
  projectId,
  onClose,
  onCreated,
}: {
  projectId: ProjectId | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const messages = useMessages();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [prompt, setPrompt] = useState("");
  const [scheduleType, setScheduleType] = useState<AutomationScheduleType>("manual");
  const [cronExpression, setCronExpression] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const api = readNativeApi();
    if (!api || !projectId || !title.trim() || !prompt.trim()) return;

    try {
      setLoading(true);
      await api.automation.create({
        projectId,
        title: title.trim(),
        description: description.trim(),
        prompt: prompt.trim(),
        scheduleType,
        cronExpression: scheduleType === "cron" ? cronExpression : null,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        templateId: null,
      });
      onCreated();
    } catch (error) {
      console.error("Failed to create automation:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-lg rounded-xl border border-border/60 bg-background p-6 shadow-lg"
      >
        <h2 className="text-[16px] font-semibold text-foreground">
          {messages.automations.createTitle}
        </h2>
        <p className="mt-1 text-[13px] text-muted-foreground/80">
          {messages.automations.createDescription}
        </p>
        <div className="mt-4 space-y-4">
          <div>
            <label className="text-[12px] font-medium text-foreground/80">
              {messages.automations.title}
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 w-full rounded-md border border-border/60 bg-background/60 px-3 py-2 text-[13px] text-foreground focus:border-foreground/50 focus:outline-none"
              placeholder="e.g., Daily briefing"
              required
            />
          </div>
          <div>
            <label className="text-[12px] font-medium text-foreground/80">
              {messages.automations.description}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-1 w-full rounded-md border border-border/60 bg-background/60 px-3 py-2 text-[13px] text-foreground focus:border-foreground/50 focus:outline-none"
              placeholder="What does this automation do?"
              rows={2}
            />
          </div>
          <div>
            <label className="text-[12px] font-medium text-foreground/80">
              {messages.automations.prompt}
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="mt-1 w-full rounded-md border border-border/60 bg-background/60 px-3 py-2 text-[13px] text-foreground focus:border-foreground/50 focus:outline-none"
              placeholder="Describe what the automation should do..."
              rows={3}
              required
            />
          </div>
          <div>
            <label className="text-[12px] font-medium text-foreground/80">
              {messages.automations.scheduleType}
            </label>
            <select
              value={scheduleType}
              onChange={(e) => setScheduleType(e.target.value as AutomationScheduleType)}
              className="mt-1 w-full rounded-md border border-border/60 bg-background/60 px-3 py-2 text-[13px] text-foreground focus:border-foreground/50 focus:outline-none"
            >
              <option value="manual">{messages.automations.manual}</option>
              <option value="cron">{messages.automations.cron}</option>
            </select>
          </div>
          {scheduleType === "cron" && (
            <div>
              <label className="text-[12px] font-medium text-foreground/80">
                {messages.automations.cronExpression}
              </label>
              <input
                type="text"
                value={cronExpression}
                onChange={(e) => setCronExpression(e.target.value)}
                className="mt-1 w-full rounded-md border border-border/60 bg-background/60 px-3 py-2 text-[13px] text-foreground focus:border-foreground/50 focus:outline-none"
                placeholder={messages.automations.cronPlaceholder}
                required
              />
            </div>
          )}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 items-center rounded-md border border-border/60 bg-background/60 px-3 text-[12px] text-foreground/80 transition-colors hover:bg-accent/40"
          >
            {messages.automations.cancel}
          </button>
          <button
            type="submit"
            disabled={loading || !title.trim() || !prompt.trim()}
            className="inline-flex h-8 items-center rounded-md bg-foreground/90 px-3 text-[12px] font-medium text-background transition-colors hover:bg-foreground disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? messages.automations.creating : messages.automations.create}
          </button>
        </div>
      </form>
    </div>
  );
}

function EditAutomationDialog({
  automation,
  onClose,
  onUpdated,
}: {
  automation: Automation;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const messages = useMessages();
  const [title, setTitle] = useState(automation.title);
  const [description, setDescription] = useState(automation.description);
  const [prompt, setPrompt] = useState(automation.prompt);
  const [scheduleType, setScheduleType] = useState<AutomationScheduleType>(automation.scheduleType);
  const [cronExpression, setCronExpression] = useState(automation.cronExpression ?? "");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const api = readNativeApi();
    if (!api || !title.trim() || !prompt.trim()) return;

    try {
      setLoading(true);
      await api.automation.update({
        automationId: automation.automationId,
        title: title.trim(),
        description: description.trim(),
        prompt: prompt.trim(),
        scheduleType,
        cronExpression: scheduleType === "cron" ? cronExpression : null,
        timezone: automation.timezone,
      });
      onUpdated();
    } catch (error) {
      console.error("Failed to update automation:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-lg rounded-xl border border-border/60 bg-background p-6 shadow-lg"
      >
        <h2 className="text-[16px] font-semibold text-foreground">
          {messages.automations.editTitle}
        </h2>
        <div className="mt-4 space-y-4">
          <div>
            <label className="text-[12px] font-medium text-foreground/80">
              {messages.automations.title}
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 w-full rounded-md border border-border/60 bg-background/60 px-3 py-2 text-[13px] text-foreground focus:border-foreground/50 focus:outline-none"
              required
            />
          </div>
          <div>
            <label className="text-[12px] font-medium text-foreground/80">
              {messages.automations.description}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-1 w-full rounded-md border border-border/60 bg-background/60 px-3 py-2 text-[13px] text-foreground focus:border-foreground/50 focus:outline-none"
              rows={2}
            />
          </div>
          <div>
            <label className="text-[12px] font-medium text-foreground/80">
              {messages.automations.prompt}
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="mt-1 w-full rounded-md border border-border/60 bg-background/60 px-3 py-2 text-[13px] text-foreground focus:border-foreground/50 focus:outline-none"
              rows={3}
              required
            />
          </div>
          <div>
            <label className="text-[12px] font-medium text-foreground/80">
              {messages.automations.scheduleType}
            </label>
            <select
              value={scheduleType}
              onChange={(e) => setScheduleType(e.target.value as AutomationScheduleType)}
              className="mt-1 w-full rounded-md border border-border/60 bg-background/60 px-3 py-2 text-[13px] text-foreground focus:border-foreground/50 focus:outline-none"
            >
              <option value="manual">{messages.automations.manual}</option>
              <option value="cron">{messages.automations.cron}</option>
            </select>
          </div>
          {scheduleType === "cron" && (
            <div>
              <label className="text-[12px] font-medium text-foreground/80">
                {messages.automations.cronExpression}
              </label>
              <input
                type="text"
                value={cronExpression}
                onChange={(e) => setCronExpression(e.target.value)}
                className="mt-1 w-full rounded-md border border-border/60 bg-background/60 px-3 py-2 text-[13px] text-foreground focus:border-foreground/50 focus:outline-none"
                placeholder={messages.automations.cronPlaceholder}
                required
              />
            </div>
          )}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 items-center rounded-md border border-border/60 bg-background/60 px-3 text-[12px] text-foreground/80 transition-colors hover:bg-accent/40"
          >
            {messages.automations.cancel}
          </button>
          <button
            type="submit"
            disabled={loading || !title.trim() || !prompt.trim()}
            className="inline-flex h-8 items-center rounded-md bg-foreground/90 px-3 text-[12px] font-medium text-background transition-colors hover:bg-foreground disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? messages.automations.saving : messages.automations.save}
          </button>
        </div>
      </form>
    </div>
  );
}
