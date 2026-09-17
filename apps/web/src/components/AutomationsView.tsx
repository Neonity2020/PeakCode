// FILE: AutomationsView.tsx
// Purpose: Scheduled tasks ("automations"): a plan, one instruction, and the workspace it
//          runs in. Every run opens a real conversation there, so the card carries the run
//          history and a way back into those conversations.
// Layer: Component
// Exports: AutomationsView

import { useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import type {
  Automation,
  AutomationRun,
  AutomationRunStatus,
  ProjectId,
} from "@peakcode/contracts";
import { useMessages } from "../i18n/I18nContext";
import {
  AUTOMATION_MODES,
  WEEKDAY_ORDER,
  defaultAutomationForm,
  formFromAutomation,
  scheduleFromForm,
  type AutomationFormState,
} from "../lib/automationForm";
import {
  useAutomationCreateMutation,
  useAutomationDeleteMutation,
  useAutomationRunsQuery,
  useAutomationRunMutation,
  useAutomationsQuery,
  useAutomationUpdateMutation,
} from "../lib/automationReactQuery";
import {
  CalendarIcon,
  CheckIcon,
  ClockIcon,
  ExternalLinkIcon,
  FolderIcon,
  LoaderIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  SquarePenIcon,
  Trash2,
  XIcon,
} from "../lib/icons";
import { cn } from "../lib/utils";
import { useLatestProjectStore } from "../latestProjectStore";
import { useStore } from "../store";
import { formatRelativeTime } from "./Sidebar";
import { SidebarInset } from "./ui/sidebar";

const RUN_STATUS_CLASS: Record<AutomationRunStatus, string> = {
  running: "bg-info/12 text-info",
  succeeded: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400",
  failed: "bg-destructive/12 text-destructive",
  interrupted: "bg-muted text-muted-foreground",
};

const RUN_STATUS_ICON: Record<AutomationRunStatus, typeof CheckIcon> = {
  running: LoaderIcon,
  succeeded: CheckIcon,
  failed: XIcon,
  interrupted: ClockIcon,
};

interface WorkspaceOption {
  readonly id: ProjectId;
  readonly name: string;
  readonly cwd: string;
}

export function AutomationsView() {
  const messages = useMessages();
  const projects = useStore((state) => state.projects);
  const latestProjectId = useLatestProjectStore((state) => state.latestProjectId);
  const automationsQuery = useAutomationsQuery();

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Automation | null>(null);

  // Chat-only projects have no real directory behind them, so they cannot host a run.
  const workspaces = useMemo<ReadonlyArray<WorkspaceOption>>(
    () =>
      projects
        .filter((project) => project.kind !== "chat")
        .map((project) => ({ id: project.id, name: project.name, cwd: project.cwd })),
    [projects],
  );
  const workspaceById = useMemo(
    () => new Map(workspaces.map((workspace) => [workspace.id, workspace])),
    [workspaces],
  );
  const defaultWorkspaceId =
    latestProjectId && workspaceById.has(latestProjectId)
      ? latestProjectId
      : (workspaces[0]?.id ?? null);

  const automations = automationsQuery.data ?? [];

  return (
    <SidebarInset className="flex h-full min-h-0 flex-col overflow-hidden">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border/60 px-6 py-4">
        <div className="min-w-0">
          <h1 className="truncate text-[20px] font-semibold text-foreground">
            {messages.sidebar.automationsLabel}
          </h1>
          <p className="mt-0.5 truncate text-[13px] text-muted-foreground/80">
            {messages.automations.subtitle}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          disabled={defaultWorkspaceId === null}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-foreground/90 px-3 text-[12px] font-medium text-background transition-colors hover:bg-foreground disabled:cursor-not-allowed disabled:opacity-60"
        >
          <PlusIcon className="size-3.5" />
          {messages.automations.newAutomation}
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-8">
        {automationsQuery.isPending ? (
          <EmptyState icon={LoaderIcon} spinning title={messages.automations.loading} />
        ) : workspaces.length === 0 ? (
          <EmptyState
            icon={FolderIcon}
            title={messages.automations.noWorkspaceTitle}
            description={messages.automations.noWorkspaceDescription}
          />
        ) : automations.length === 0 ? (
          <EmptyState
            icon={ClockIcon}
            title={messages.automations.emptyTitle}
            description={messages.automations.emptyDescription}
            hint={messages.automations.chatHint}
          />
        ) : (
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
            {automations.map((automation) => (
              <AutomationCard
                key={automation.automationId}
                automation={automation}
                workspace={workspaceById.get(automation.projectId) ?? null}
                onEdit={() => setEditing(automation)}
              />
            ))}
            <p className="px-1 pt-1 text-[11.5px] leading-relaxed text-muted-foreground/60">
              {messages.automations.chatHint}
            </p>
          </div>
        )}
      </div>

      {(creating || editing !== null) && (
        <AutomationEditor
          automation={editing ?? undefined}
          workspaces={workspaces}
          defaultWorkspaceId={defaultWorkspaceId}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </SidebarInset>
  );
}

function EmptyState({
  icon: Icon,
  title,
  description,
  hint,
  spinning,
}: {
  readonly icon: typeof CheckIcon;
  readonly title: string;
  readonly description?: string;
  readonly hint?: string;
  readonly spinning?: boolean;
}) {
  return (
    <div className="mx-auto my-auto flex w-full max-w-md flex-col items-center text-center">
      <div className="mb-5 flex size-16 items-center justify-center rounded-full border border-border/60 bg-background/60">
        <Icon className={cn("size-7 text-muted-foreground/70", spinning && "animate-spin")} />
      </div>
      <h2 className="text-[17px] font-semibold text-foreground">{title}</h2>
      {description ? (
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground/85">{description}</p>
      ) : null}
      {hint ? <p className="mt-3 text-[11.5px] text-muted-foreground/55">{hint}</p> : null}
    </div>
  );
}

function AutomationCard({
  automation,
  workspace,
  onEdit,
}: {
  readonly automation: Automation;
  readonly workspace: WorkspaceOption | null;
  readonly onEdit: () => void;
}) {
  const messages = useMessages();
  const runMutation = useAutomationRunMutation();
  const updateMutation = useAutomationUpdateMutation();
  const deleteMutation = useAutomationDeleteMutation();

  const planLabel = describePlan(automation, messages);

  return (
    <section
      className="rounded-xl border border-border/60 bg-background/40"
      data-automation-id={automation.automationId}
    >
      <div className="flex items-start gap-3 p-3.5">
        <span
          className={cn(
            "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg",
            automation.isEnabled ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
          )}
        >
          <CalendarIcon className="size-4" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-[13.5px] font-medium text-foreground">
              {automation.title}
            </span>
            {!automation.isEnabled ? (
              <Badge className="bg-muted text-muted-foreground">
                {messages.automations.disabled}
              </Badge>
            ) : null}
            {automation.lastRunStatus ? (
              <Badge className={RUN_STATUS_CLASS[automation.lastRunStatus]}>
                {messages.automations.runStatus[automation.lastRunStatus]}
              </Badge>
            ) : null}
          </div>

          <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground/85">
            {automation.instructions}
          </p>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground/75">
            <span>{planLabel}</span>
            <span>
              {messages.automations.nextRun}:{" "}
              {automation.nextRunAt
                ? formatMoment(automation.nextRunAt)
                : messages.automations.noNextRun}
            </span>
            <span>
              {messages.automations.lastRun}:{" "}
              {automation.lastRunAt
                ? formatMoment(automation.lastRunAt)
                : messages.automations.never}
            </span>
            <span className="inline-flex min-w-0 items-center gap-1" title={workspace?.cwd}>
              <FolderIcon className="size-3 shrink-0" />
              <span className="truncate">
                {workspace?.name ?? messages.automations.workspaceMissing}
              </span>
            </span>
            <span title={automation.timezone}>{automation.timezone}</span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <IconButton
            label={messages.automations.runNow}
            disabled={runMutation.isPending}
            onClick={() => runMutation.mutate({ automationId: automation.automationId })}
          >
            {runMutation.isPending &&
            runMutation.variables?.automationId === automation.automationId ? (
              <LoaderIcon className="size-3.5 animate-spin" />
            ) : (
              <PlayIcon className="size-3.5" />
            )}
          </IconButton>
          <IconButton
            label={
              automation.isEnabled ? messages.automations.disable : messages.automations.enable
            }
            disabled={updateMutation.isPending}
            onClick={() =>
              updateMutation.mutate({
                automationId: automation.automationId,
                isEnabled: !automation.isEnabled,
              })
            }
          >
            {automation.isEnabled ? (
              <PauseIcon className="size-3.5" />
            ) : (
              <PlayIcon className="size-3.5" />
            )}
          </IconButton>
          <IconButton label={messages.automations.edit} onClick={onEdit}>
            <SquarePenIcon className="size-3.5" />
          </IconButton>
          <IconButton
            label={messages.automations.delete}
            className="hover:text-destructive"
            onClick={() => {
              if (window.confirm(messages.automations.deleteConfirmTitle)) {
                deleteMutation.mutate({ automationId: automation.automationId });
              }
            }}
          >
            <Trash2 className="size-3.5" />
          </IconButton>
        </div>
      </div>

      <div className="border-t border-border/50 px-3.5 py-2.5">
        <p className="text-[10.5px] font-medium tracking-wider text-muted-foreground/60 uppercase">
          {messages.automations.runsHeading}
        </p>
        <AutomationRunHistory automationId={automation.automationId} />
      </div>
    </section>
  );
}

function AutomationRunHistory({
  automationId,
}: {
  readonly automationId: Automation["automationId"];
}) {
  const messages = useMessages();
  const navigate = useNavigate();
  const runsQuery = useAutomationRunsQuery(automationId);
  const runs = runsQuery.data ?? [];

  if (runsQuery.isPending) {
    return (
      <p className="px-0.5 py-2 text-[11.5px] text-muted-foreground/60">
        {messages.automations.loading}
      </p>
    );
  }
  if (runs.length === 0) {
    return (
      <p className="px-0.5 py-2 text-[11.5px] text-muted-foreground/60">
        {messages.automations.noRuns}
      </p>
    );
  }

  return (
    <div className="mt-1.5 flex flex-col gap-1">
      {runs.map((run: AutomationRun) => {
        const StatusIcon = RUN_STATUS_ICON[run.status];
        return (
          <div
            key={run.runId}
            className="flex items-start gap-2 rounded-lg border border-border/50 px-2 py-1.5"
          >
            <StatusIcon
              className={cn(
                "mt-0.5 size-3.5 shrink-0",
                run.status === "running" && "animate-spin text-info",
                run.status === "succeeded" && "text-emerald-600 dark:text-emerald-400",
                run.status === "failed" && "text-destructive",
                run.status === "interrupted" && "text-muted-foreground",
              )}
            />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] text-muted-foreground/85">
                {formatMoment(run.startedAt)} · {messages.automations.runStatus[run.status]}
                {run.trigger === "manual" ? ` · ${messages.automations.triggerManual}` : ""}
              </p>
              {(run.errorMessage ?? run.summary) ? (
                <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground/70">
                  {run.errorMessage ?? run.summary}
                </p>
              ) : null}
            </div>
            {run.threadId ? (
              <button
                type="button"
                onClick={() =>
                  void navigate({ to: "/$threadId", params: { threadId: run.threadId! } })
                }
                className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md border border-border/60 bg-background/60 px-2 text-[11px] text-foreground/80 transition-colors hover:bg-accent/40"
              >
                <ExternalLinkIcon className="size-3" />
                {messages.automations.openConversation}
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function AutomationEditor({
  automation,
  workspaces,
  defaultWorkspaceId,
  onClose,
}: {
  readonly automation?: Automation | undefined;
  readonly workspaces: ReadonlyArray<WorkspaceOption>;
  readonly defaultWorkspaceId: ProjectId | null;
  readonly onClose: () => void;
}) {
  const messages = useMessages();
  const createMutation = useAutomationCreateMutation();
  const updateMutation = useAutomationUpdateMutation({
    successMessage: () => messages.automations.savedToast,
  });
  const [form, setForm] = useState<AutomationFormState>(() =>
    automation
      ? formFromAutomation(automation)
      : defaultAutomationForm({
          workspaceId: defaultWorkspaceId,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        }),
  );

  const patch = <K extends keyof AutomationFormState>(key: K, value: AutomationFormState[K]) =>
    setForm((previous) => ({ ...previous, [key]: value }));

  const saving = createMutation.isPending || updateMutation.isPending;
  const canSave =
    form.title.trim().length > 0 &&
    form.instructions.trim().length > 0 &&
    form.workspaceId !== null &&
    !saving;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!canSave || form.workspaceId === null) return;
    const common = {
      title: form.title.trim(),
      instructions: form.instructions.trim(),
      schedule: scheduleFromForm(form),
      timezone: form.timezone.trim().length > 0 ? form.timezone.trim() : undefined,
      mode: form.mode,
    };
    if (automation) {
      updateMutation.mutate(
        {
          automationId: automation.automationId,
          projectId: form.workspaceId,
          ...common,
        },
        { onSuccess: () => onClose() },
      );
      return;
    }
    createMutation.mutate(
      { projectId: form.workspaceId, ...common },
      { onSuccess: () => onClose() },
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border/60 bg-background p-5 shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-[15px] font-semibold text-foreground">
            {automation ? messages.automations.editTitle : messages.automations.createTitle}
          </h2>
          <button
            type="button"
            aria-label={messages.automations.cancel}
            onClick={onClose}
            className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-accent/60 hover:text-foreground"
          >
            <XIcon className="size-4" />
          </button>
        </div>

        <form className="mt-4 flex flex-col gap-3.5" onSubmit={submit}>
          <Field label={messages.automations.taskTitle}>
            <input
              autoFocus
              aria-label={messages.automations.taskTitle}
              value={form.title}
              placeholder={messages.automations.taskTitlePlaceholder}
              onChange={(event) => patch("title", event.target.value)}
              className={FIELD_INPUT_CLASS}
            />
          </Field>

          <Field
            label={messages.automations.instructions}
            hint={messages.automations.instructionsHint}
          >
            <textarea
              rows={4}
              aria-label={messages.automations.instructions}
              value={form.instructions}
              placeholder={messages.automations.instructionsPlaceholder}
              onChange={(event) => patch("instructions", event.target.value)}
              className={cn(FIELD_INPUT_CLASS, "h-auto resize-y py-2 leading-relaxed")}
            />
          </Field>

          <Field label={messages.automations.workspace}>
            <select
              aria-label={messages.automations.workspace}
              value={form.workspaceId ?? ""}
              onChange={(event) => patch("workspaceId", event.target.value as ProjectId)}
              className={FIELD_INPUT_CLASS}
            >
              <option value="" disabled>
                {messages.automations.selectWorkspace}
              </option>
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name} — {workspace.cwd}
                </option>
              ))}
            </select>
          </Field>

          <div className="rounded-lg border border-border/60 p-3">
            <div className="flex flex-wrap items-end gap-3">
              <Field label={messages.automations.plan}>
                <select
                  aria-label={messages.automations.plan}
                  value={form.kind}
                  onChange={(event) =>
                    patch("kind", event.target.value as AutomationFormState["kind"])
                  }
                  className={cn(FIELD_INPUT_CLASS, "w-[130px]")}
                >
                  <option value="once">{messages.automations.planKinds.once}</option>
                  <option value="daily">{messages.automations.planKinds.daily}</option>
                  <option value="weekly">{messages.automations.planKinds.weekly}</option>
                </select>
              </Field>

              {form.kind === "once" ? (
                <Field label={messages.automations.onceAt}>
                  <input
                    type="datetime-local"
                    value={form.atLocal}
                    onChange={(event) => patch("atLocal", event.target.value)}
                    className={cn(FIELD_INPUT_CLASS, "w-[210px]")}
                  />
                </Field>
              ) : (
                <Field label={messages.automations.time}>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={0}
                      max={23}
                      value={form.hour}
                      onChange={(event) => patch("hour", Number(event.target.value) || 0)}
                      className={cn(FIELD_INPUT_CLASS, "w-[62px] px-2")}
                    />
                    <span className="text-[13px] text-muted-foreground/70">:</span>
                    <input
                      type="number"
                      min={0}
                      max={59}
                      value={form.minute}
                      onChange={(event) => patch("minute", Number(event.target.value) || 0)}
                      className={cn(FIELD_INPUT_CLASS, "w-[62px] px-2")}
                    />
                  </div>
                </Field>
              )}

              <Field label={messages.automations.timezone}>
                <input
                  value={form.timezone}
                  onChange={(event) => patch("timezone", event.target.value)}
                  className={cn(FIELD_INPUT_CLASS, "w-[170px]")}
                />
              </Field>
            </div>

            {form.kind === "weekly" ? (
              <div className="mt-3 flex flex-col gap-1.5">
                <span className="text-[11px] font-medium tracking-wider text-muted-foreground/70 uppercase">
                  {messages.automations.weekdays}
                </span>
                <div className="flex flex-wrap gap-1">
                  {WEEKDAY_ORDER.map((weekday) => {
                    const active = form.daysOfWeek.includes(weekday);
                    return (
                      <button
                        key={weekday}
                        type="button"
                        onClick={() =>
                          patch(
                            "daysOfWeek",
                            active
                              ? form.daysOfWeek.filter((value) => value !== weekday)
                              : [...form.daysOfWeek, weekday],
                          )
                        }
                        className={cn(
                          "rounded-full border px-2.5 py-1 text-[11.5px] transition-colors",
                          active
                            ? "border-primary/60 bg-primary/10 text-foreground"
                            : "border-border/60 text-muted-foreground hover:bg-accent/40",
                        )}
                      >
                        {messages.automations.weekdayLabels[weekday] ?? String(weekday)}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <div className="mt-3">
              <Field label={messages.automations.mode}>
                <select
                  aria-label={messages.automations.mode}
                  value={form.mode}
                  onChange={(event) =>
                    patch("mode", event.target.value as AutomationFormState["mode"])
                  }
                  className={cn(FIELD_INPUT_CLASS, "w-[130px]")}
                >
                  {AUTOMATION_MODES.map((mode) => (
                    <option key={mode} value={mode}>
                      {messages.automations.modes[mode]}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-0.5">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-8 items-center rounded-md border border-border/60 bg-background/60 px-3 text-[12px] text-foreground/80 transition-colors hover:bg-accent/40"
            >
              {messages.automations.cancel}
            </button>
            <button
              type="submit"
              disabled={!canSave}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-foreground/90 px-3 text-[12px] font-medium text-background transition-colors hover:bg-foreground disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? <LoaderIcon className="size-3.5 animate-spin" /> : null}
              {automation ? messages.automations.save : messages.automations.create}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const FIELD_INPUT_CLASS =
  "h-9 rounded-md border border-border/60 bg-background/60 px-2.5 text-[13px] text-foreground outline-hidden focus-visible:ring-1 focus-visible:ring-ring";

function Field({
  label,
  hint,
  children,
}: {
  readonly label: string;
  readonly hint?: string;
  readonly children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium tracking-wider text-muted-foreground/70 uppercase">
        {label}
      </span>
      {children}
      {hint ? (
        <span className="text-[11.5px] leading-relaxed text-muted-foreground/55">{hint}</span>
      ) : null}
    </label>
  );
}

function Badge({
  className,
  children,
}: {
  readonly className?: string;
  readonly children: React.ReactNode;
}) {
  return (
    <span className={cn("rounded px-1.5 py-0.5 text-[10.5px] leading-4", className)}>
      {children}
    </span>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  className,
  children,
}: {
  readonly label: string;
  readonly onClick: () => void;
  readonly disabled?: boolean;
  readonly className?: string;
  readonly children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex size-7 items-center justify-center rounded-md text-muted-foreground/80 transition-colors hover:bg-accent/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
    >
      {children}
    </button>
  );
}

function formatMoment(iso: string): string {
  const relative = formatRelativeTime(iso);
  const absolute = new Date(iso).toLocaleString();
  return relative === "now" ? absolute : `${absolute} (${relative})`;
}

function describePlan(automation: Automation, messages: ReturnType<typeof useMessages>): string {
  const schedule = automation.schedule;
  if (schedule.kind === "once") {
    return messages.automations.scheduleOnce(new Date(schedule.at).toLocaleString());
  }
  const time = `${String(schedule.hour).padStart(2, "0")}:${String(schedule.minute).padStart(2, "0")}`;
  if (schedule.kind === "daily") return messages.automations.scheduleDaily(time);
  const days = [...schedule.daysOfWeek]
    .toSorted((left, right) => left - right)
    .map((weekday) => messages.automations.weekdayLabels[weekday] ?? "")
    .filter((value) => value.length > 0)
    .join(", ");
  return messages.automations.scheduleWeekly(days, time);
}
