import { memo, useEffect, useRef, useState, type ComponentType, type CSSProperties } from "react";
import {
  RiArrowDownSLine,
  RiArrowRightSLine,
  RiCheckLine,
  RiErrorWarningLine,
  RiLoader4Line,
  RiPauseLine,
  RiRobot3Line,
  RiTimeLine,
} from "react-icons/ri";
import { ThreadId } from "@peakcode/contracts";

import { cn } from "~/lib/utils";
import {
  formatSubagentModelLabel,
  humanizeSubagentStatus,
  normalizeSubagentStatusKind,
  resolveSubagentPresentation,
} from "../../lib/subagentPresentation";
import {
  formatSubagentDuration,
  formatSubagentSilence,
  shouldOfferWorkerStop,
  SUBAGENT_SILENCE_WARN_MS,
} from "../../lib/subagentProgress";
import type { WorkLogSubagent, WorkLogSubagentAction } from "../../session-logic";

/**
 * The delegation card: one orchestrator node on the left, every worker it dispatched fanned out
 * to the right, joined by branches that stay live while a worker is out and settle when it
 * comes back.
 *
 * Why a tree instead of the flat list this replaced: the list lost the two facts that make a
 * Multi-Agent turn readable — that the workers were dispatched *by* the main agent, and that
 * they ran *concurrently*. A fan of branches shows both at a glance, and a branch that is still
 * animating answers "which of these is still working" without reading any text.
 *
 * Everything the rows show but the delegation payload cannot know — steps taken, elapsed time,
 * the tool call running right now — is derived from the worker's child thread in
 * `enrichSubagentWorkEntries`; this component only lays it out.
 */

/** Fixed gutter geometry: the orchestrator column, then the branch fan. */
const MAIN_NODE_WIDTH_PX = 172;
const BRANCH_GUTTER_PX = 26;
/** The worker list is a flex column with this gap; a trunk must span it to stay continuous. */
const WORKER_ROW_GAP_PX = 6;

type WorkerState = "running" | "completed" | "failed" | "queued" | "stopped" | "idle";

/**
 * How each state presents itself.
 *
 * `className` carries the hue (see `.subagent-state-*` in index.css) and `icon` the glyph, so a
 * worker's state survives both a glance and a colour-blind reader. Only `running` moves — the
 * animation is what separates "still out there" from "came back", which colour alone cannot say.
 */
const WORKER_STATE_TONE: Record<
  WorkerState,
  {
    className: string;
    Icon: ComponentType<{ className?: string | undefined }>;
    label: string;
    animated: boolean;
  }
> = {
  running: {
    className: "subagent-state-running",
    Icon: RiLoader4Line,
    label: "Working",
    animated: true,
  },
  completed: {
    className: "subagent-state-completed",
    Icon: RiCheckLine,
    label: "Completed",
    animated: false,
  },
  failed: {
    className: "subagent-state-failed",
    Icon: RiErrorWarningLine,
    label: "Failed",
    animated: false,
  },
  queued: {
    className: "subagent-state-queued",
    Icon: RiTimeLine,
    label: "Queued",
    animated: true,
  },
  stopped: {
    className: "subagent-state-stopped",
    Icon: RiPauseLine,
    label: "Stopped",
    animated: false,
  },
  idle: {
    className: "subagent-state-idle",
    Icon: RiPauseLine,
    label: "Idle",
    animated: false,
  },
};

/** The trunk is one line for the whole fan, so it stays neutral however the workers are doing. */
const TRUNK_BRANCH_CLASS = "text-foreground/25";

/**
 * Which of the six states a row is in.
 *
 * The delegation only ever reports `running` / `completed` / `failed`, so a row with no usable
 * status at all is a worker that is still out — reading that as "running" keeps the branch
 * animated rather than showing a settled node next to a worker that never came back.
 */
function workerState(subagent: WorkLogSubagent): WorkerState {
  return (
    normalizeSubagentStatusKind(subagent.statusLabel ?? subagent.rawStatus, subagent.isActive) ??
    "running"
  );
}

function workerStateLabel(subagent: WorkLogSubagent, state: WorkerState): string {
  return (
    subagent.statusLabel ??
    humanizeSubagentStatus(subagent.rawStatus, subagent.isActive) ??
    WORKER_STATE_TONE[state].label
  );
}

/**
 * How long a worker has been quiet, ticking once a second.
 *
 * A leaf component owning its own interval, the same way the transcript's working timer does:
 * the card has to stay live without dragging the whole timeline through a re-render every second.
 * Past `SUBAGENT_SILENCE_WARN_MS` it turns amber, which is the first honest sign that a worker
 * still claiming to run may be wedged.
 */
function SubagentSilence({ since, prefix }: { since: string; prefix: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const initial = formatSubagentSilence(Date.now() - Date.parse(since));

  useEffect(() => {
    const update = () => {
      const element = ref.current;
      if (!element) return;
      const elapsed = Date.now() - Date.parse(since);
      element.textContent = `${prefix}${formatSubagentSilence(elapsed)} ago`;
      element.dataset.subagentSilence = elapsed >= SUBAGENT_SILENCE_WARN_MS ? "warn" : "live";
    };
    update();
    const id = window.setInterval(update, 1000);
    return () => window.clearInterval(id);
  }, [since, prefix]);

  return (
    <span
      ref={ref}
      data-subagent-silence="live"
      className="shrink-0 tabular-nums data-[subagent-silence=warn]:text-amber-500"
    >
      {`${prefix}${initial} ago`}
    </span>
  );
}

/**
 * One branch segment.
 *
 * The live/held distinction is the whole point of the graphic, so it is driven by CSS rather
 * than by swapping two colours: a running branch is a dashed stroke whose dashes travel toward
 * the node (motion = work in flight), a settled one is a plain faint line.
 */
function BranchSegment({
  state,
  orientation,
  toneClassName,
  animated,
  className,
  style,
}: {
  state: WorkerState;
  orientation: "horizontal" | "vertical";
  /** Overrides the state's tint, for segments that belong to no single worker. */
  toneClassName?: string | undefined;
  /** Overrides whether the dashes travel. The trunk never moves; only a worker's branch does. */
  animated?: boolean | undefined;
  className?: string | undefined;
  style?: CSSProperties | undefined;
}) {
  const isAnimated = animated ?? WORKER_STATE_TONE[state].animated;
  return (
    <span
      aria-hidden="true"
      data-subagent-branch={isAnimated ? state : "static"}
      className={cn(
        orientation === "horizontal" ? "subagent-branch-h" : "subagent-branch-v",
        WORKER_STATE_TONE[state].className,
        toneClassName ?? "subagent-state-branch",
        className,
      )}
      style={style}
    />
  );
}

function WorkerNode({
  subagent,
  fontSizePx,
  onOpenThread,
  onStopWorker,
}: {
  subagent: WorkLogSubagent;
  fontSizePx: number;
  onOpenThread?: ((threadId: ThreadId) => void) | undefined;
  onStopWorker?: ((providerThreadId: string) => void) | undefined;
}) {
  const state = workerState(subagent);
  const tone = WORKER_STATE_TONE[state];
  const presentation = resolveSubagentPresentation({
    nickname: subagent.nickname,
    role: subagent.role,
    fallbackId: subagent.threadId,
  });
  const openableThreadId = subagent.resolvedThreadId ?? null;
  const canOpen = Boolean(openableThreadId && onOpenThread);
  const steps = subagent.steps !== undefined ? `${subagent.steps} steps` : null;
  const elapsed = formatSubagentDuration(subagent.elapsedMs);
  const modelLabel = formatSubagentModelLabel(subagent.model);
  // Only the model name, never `<provider>/<model>`: a provider id is long enough to crowd the
  // line out, and when it is configured from a credential it puts a key fragment on screen. The
  // full reference stays in the tooltip.
  const modelName = modelLabel?.split("/").at(-1) ?? null;
  const meta = [modelName, steps, elapsed].filter((part): part is string => Boolean(part));
  const metaTitle = [modelLabel, steps, elapsed]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
  // Only a worker that is still out can be stopped, and only by its delegation id — the same id
  // the runtime registry (`liveSubagents`) is keyed by.
  const canStop = Boolean(onStopWorker) && shouldOfferWorkerStop(subagent);
  // The record expands in place. It is deliberately not the "open the child thread" affordance:
  // a worker's steps arrive on the delegation item itself (see `PiDelegationWorkerProgress`), so
  // inspecting one never depends on the child thread's own detail having landed — which is the
  // half of this that used to leave the user with nothing to look at.
  const recentSteps = subagent.recentSteps ?? [];
  const canExpand = recentSteps.length > 0;
  const [recordOpen, setRecordOpen] = useState(false);

  const body = (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <div className="flex min-w-0 items-baseline gap-1.5">
        <span
          className="truncate font-semibold leading-[18px]"
          style={{ fontSize: `${fontSizePx}px`, color: presentation.accentColor }}
          title={presentation.fullLabel}
        >
          {presentation.nickname ?? presentation.primaryLabel}
        </span>
        {presentation.role ? (
          <span className="shrink-0 text-[10px] font-medium text-muted-foreground/75">
            {presentation.role}
          </span>
        ) : null}
      </div>
      {subagent.prompt ? (
        <p
          className="truncate leading-4 text-foreground/88"
          style={{ fontSize: `${Math.max(11, fontSizePx - 1)}px` }}
          title={subagent.prompt}
        >
          {subagent.prompt}
        </p>
      ) : null}
      {meta.length > 0 ? (
        <p
          className="truncate leading-4 text-muted-foreground/75"
          style={{ fontSize: `${Math.max(10, fontSizePx - 2)}px` }}
          title={metaTitle}
        >
          {meta.join(" · ")}
        </p>
      ) : null}
      {state === "running" ? (
        <p
          className={cn(
            "flex min-w-0 items-baseline gap-1.5 leading-4",
            tone.className,
            "subagent-state-ink",
          )}
          style={{ fontSize: `${Math.max(10, fontSizePx - 2)}px` }}
          title={subagent.latestStep ?? "Waiting for this worker's first step"}
        >
          <span className="subagent-state-dot size-1.5 shrink-0 animate-pulse self-center rounded-full" />
          {subagent.latestStep ? (
            <span className="truncate">{subagent.latestStep}</span>
          ) : (
            <span className="truncate">waiting for its first step</span>
          )}
          {subagent.latestStepAt ? (
            <SubagentSilence since={subagent.latestStepAt} prefix="· " />
          ) : null}
        </p>
      ) : null}
      {recordOpen && canExpand ? (
        <ol
          data-subagent-record={subagent.providerThreadId}
          className="mt-0.5 space-y-0.5 border-l border-foreground/18 pl-2"
        >
          {recentSteps.map((step, index) => (
            <li
              key={step.id}
              className="truncate leading-4 text-foreground/72"
              style={{ fontSize: `${Math.max(10, fontSizePx - 2)}px` }}
              title={step.title}
            >
              <span className="pr-1 tabular-nums text-muted-foreground/55">{index + 1}.</span>
              {step.title}
            </li>
          ))}
          {subagent.steps !== undefined && subagent.steps > recentSteps.length ? (
            <li
              className="leading-4 text-muted-foreground/55"
              style={{ fontSize: `${Math.max(10, fontSizePx - 2)}px` }}
            >
              …{subagent.steps - recentSteps.length} earlier steps
            </li>
          ) : null}
        </ol>
      ) : null}
    </div>
  );

  const aside = (
    <div className="flex shrink-0 flex-col items-end gap-1 pt-0.5">
      <span
        className={cn(
          "flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-semibold tracking-[0.08em]",
          tone.className,
          "subagent-state-pill",
        )}
      >
        <tone.Icon className={cn("size-2.5 shrink-0", tone.animated && "animate-spin")} />
        {workerStateLabel(subagent, state)}
      </span>
      {canStop ? (
        <button
          type="button"
          data-subagent-stop={subagent.providerThreadId}
          className="cursor-pointer rounded-full border border-foreground/22 px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.12em] text-foreground/78 transition-colors hover:border-foreground/40 hover:bg-foreground/[0.08] hover:text-foreground"
          title="End this worker; the rest of the turn keeps going"
          onClick={() => onStopWorker?.(subagent.providerThreadId!)}
        >
          Stop
        </button>
      ) : null}
      {canExpand ? (
        <button
          type="button"
          data-subagent-record-toggle={subagent.providerThreadId}
          aria-expanded={recordOpen}
          className="flex cursor-pointer items-center gap-0.5 rounded-full px-1 py-0.5 text-[9px] font-medium uppercase tracking-[0.12em] text-foreground/72 transition-colors hover:bg-foreground/[0.08] hover:text-foreground"
          title={recordOpen ? "Hide this worker's recent steps" : "Show this worker's recent steps"}
          onClick={() => setRecordOpen((open) => !open)}
        >
          {recordOpen ? (
            <RiArrowDownSLine className="size-3 shrink-0" />
          ) : (
            <RiArrowRightSLine className="size-3 shrink-0" />
          )}
          {recordOpen ? "Hide steps" : "View steps"}
        </button>
      ) : null}
      {canOpen ? (
        <span className="text-[9px] font-medium uppercase tracking-[0.12em] text-muted-foreground/70">
          Open thread
        </span>
      ) : null}
    </div>
  );

  const nodeClassName = cn(
    "subagent-state-surface flex min-w-0 flex-1 items-start gap-2.5 rounded-xl border px-2.5 py-2 text-left transition-colors",
    tone.className,
  );

  // The stop button cannot live inside the node's own open-button, so the node is a container and
  // only its body is the clickable target.
  return (
    <div className={nodeClassName}>
      {canOpen && openableThreadId && onOpenThread ? (
        <button
          type="button"
          className="flex min-w-0 flex-1 cursor-pointer items-start gap-2.5 text-left"
          title="Open this worker's thread to see every step it took"
          onClick={() => onOpenThread(ThreadId.makeUnsafe(openableThreadId))}
        >
          {body}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-start gap-2.5">{body}</div>
      )}
      {aside}
    </div>
  );
}

export const SubagentDelegationCard = memo(function SubagentDelegationCard({
  workEntry,
  chatMetaFontSizePx,
  textFontSizePx,
  onOpenThread,
  onStopWorker,
}: {
  workEntry: SubagentDelegationEntry;
  chatMetaFontSizePx: number;
  textFontSizePx: number;
  onOpenThread?: ((threadId: ThreadId) => void) | undefined;
  /** Ends one running worker; absent when the card has no live turn to stop. */
  onStopWorker?: ((providerThreadId: string) => void) | undefined;
}) {
  const subagents = workEntry.subagents ?? [];
  const total = subagents.length;
  const settled = subagents.filter((subagent) => workerState(subagent) !== "running").length;
  const runningCount = total - settled;
  const endedCount = subagents.filter((subagent) => {
    const state = workerState(subagent);
    return state === "stopped" || state === "failed";
  }).length;
  // The orchestration summary only knows the whole batch, so it says "8 subagents finished" even
  // when six of them were cut short. Fall back to a neutral headline in that case: the counts
  // below and the per-node badges carry the truth.
  const headline =
    endedCount === 0
      ? (workEntry.subagentAction?.summaryText ??
        (total === 1 ? "1 subagent" : `${total} subagents`))
      : `${total} subagents`;
  const duration = formatSubagentDuration(
    subagents.reduce<number | null>((longest, subagent) => {
      const elapsed = subagent.elapsedMs;
      if (elapsed === undefined || elapsed === null) return longest;
      return longest === null ? elapsed : Math.max(longest, elapsed);
    }, null),
  );

  if (total === 0) {
    return null;
  }

  return (
    <div
      className="rounded-[16px] border border-foreground/16 bg-foreground/[0.028] px-3 py-2.5"
      data-subagent-delegation-card={workEntry.id}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <RiRobot3Line className="size-3 shrink-0 text-muted-foreground/50" />
        <span
          className="truncate font-medium text-foreground/95"
          style={{ fontSize: `${textFontSizePx}px` }}
        >
          {headline}
        </span>
        <span
          className="text-muted-foreground/78"
          style={{ fontSize: `${Math.max(10, chatMetaFontSizePx - 1)}px` }}
        >
          {settled}/{total} finished
          {runningCount > 0 ? ` · ${runningCount} working` : ""}
          {endedCount > 0 ? ` · ${endedCount} interrupted` : ""}
          {duration ? ` · ${duration}` : ""}
        </span>
      </div>

      <div className="mt-2.5 flex items-stretch">
        {/* The orchestrator node, vertically centered against its fan of workers. */}
        <div className="flex shrink-0 items-center" style={{ width: `${MAIN_NODE_WIDTH_PX}px` }}>
          <div
            className={cn(
              "subagent-state-surface w-full rounded-xl border px-2.5 py-2",
              runningCount > 0 ? "subagent-state-running" : "subagent-state-completed",
            )}
          >
            <div
              className={cn(
                "flex items-center gap-1.5",
                runningCount > 0 ? "subagent-state-running" : "subagent-state-completed",
              )}
            >
              <span
                className={cn(
                  "subagent-state-dot size-1.5 shrink-0 rounded-full",
                  runningCount > 0 && "animate-pulse",
                )}
              />
              <span
                className="truncate font-semibold text-foreground/95"
                style={{ fontSize: `${textFontSizePx}px` }}
              >
                Main agent
              </span>
            </div>
            <p
              className="pt-0.5 leading-4 text-muted-foreground/82"
              style={{ fontSize: `${Math.max(10, textFontSizePx - 2)}px` }}
            >
              {runningCount > 0
                ? `Coordinating ${runningCount} delegated ${runningCount === 1 ? "task" : "tasks"}`
                : `Coordinated ${total} delegated ${total === 1 ? "task" : "tasks"}`}
            </p>
          </div>
        </div>

        {/* Trunk stub from the orchestrator into the fan. */}
        <div className="relative shrink-0" style={{ width: `${BRANCH_GUTTER_PX}px` }}>
          <BranchSegment
            state="running"
            orientation="horizontal"
            toneClassName={TRUNK_BRANCH_CLASS}
            animated={false}
            className="absolute top-1/2 left-0 w-full"
          />
        </div>

        {/* Workers, each joined to the trunk by its own branch. */}
        <div className="flex min-w-0 flex-1 flex-col" style={{ rowGap: `${WORKER_ROW_GAP_PX}px` }}>
          {subagents.map((subagent, index) => {
            const state = workerState(subagent);
            const isLast = index === total - 1;
            return (
              <div
                key={`${workEntry.id}:${subagent.threadId}`}
                className="relative flex items-stretch"
              >
                <div className="relative shrink-0" style={{ width: `${BRANCH_GUTTER_PX}px` }}>
                  {/* The trunk passes every row; it stops at the last node's elbow. */}
                  <BranchSegment
                    state="running"
                    orientation="vertical"
                    toneClassName={TRUNK_BRANCH_CLASS}
                    animated={false}
                    className="absolute left-0 w-px"
                    style={{
                      top: 0,
                      height: isLast ? "50%" : `calc(100% + ${WORKER_ROW_GAP_PX}px)`,
                    }}
                  />
                  <BranchSegment
                    state={state}
                    orientation="horizontal"
                    className="absolute top-1/2 left-0 w-full"
                  />
                  <span
                    className={cn(
                      "subagent-state-dot absolute left-0 size-1.5 -translate-x-1/2 rounded-full",
                      WORKER_STATE_TONE[state].className,
                    )}
                    style={{ top: "calc(50% - 3px)" }}
                  />
                </div>
                <WorkerNode
                  subagent={subagent}
                  fontSizePx={textFontSizePx}
                  onOpenThread={onOpenThread}
                  onStopWorker={onStopWorker}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});

export interface SubagentDelegationEntry {
  id: string;
  subagents?: ReadonlyArray<WorkLogSubagent> | undefined;
  subagentAction?: WorkLogSubagentAction | undefined;
}
