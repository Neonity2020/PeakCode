/**
 * PiSubagentDelegation - Builds the `collab_agent_tool_call` payload that surfaces a turn's
 * delegated workers as one subagent card in the transcript and as child threads in the sidebar.
 *
 * @module PiSubagentDelegation
 */

/**
 * Why this module exists.
 *
 * A toolkit `task` call runs its worker in an in-memory session whose only output is the
 * returned string (see `runSubagent` in `PiAdapter`). That is the right execution model — the
 * worker's tool chatter never floods the orchestrator's context — but it left the whole run
 * invisible: the transcript showed a generic "Delegate to subagent" row and nothing said which
 * workers were running, on which model, or how far along they were.
 *
 * The rest of the system already knows how to draw that: the provider runtime contract has a
 * `collab_agent_tool_call` item type, the web decoders read worker identity/state out of its
 * payload, the transcript renders one card with a row per worker, and the orchestration
 * ingestion turns its receiver thread ids into real child threads. This module is the missing
 * producer — it shapes one aggregated item per turn so the card shows *all* of a turn's workers
 * at once, updating in place as they settle, instead of one card per `task` call.
 *
 * Two payload details are load-bearing and easy to get wrong:
 *
 * - **The inherited model is reported as `requestedModel`, a bound one as `model`.** The
 *   ingestion treats a non-hint model as the child thread's own model selection. A worker that
 *   merely inherits the orchestrator's model must still *show* that model in its card row, but
 *   writing it as a real model would also pin the child thread to it.
 * - **`agentStates[x].model` stays empty.** Agent states are also read as identity hints, and
 *   that path has no "requested" flag, so a model there would be applied to the child thread.
 */

/**
 * A worker's lifecycle as the card's status pill and the child thread both read it.
 *
 * `stopped` is distinct from `failed`: a worker the user (or an aborted turn) ended did not break,
 * and showing it as a failure would misreport what happened.
 */
export type PiDelegationWorkerStatus = "running" | "completed" | "failed" | "stopped";

export interface PiDelegatedWorker {
  /**
   * Provider-side thread id for this worker, also the child thread's identity on the web side
   * (`subagent:<parentThreadId>:<providerThreadId>`). Unique per delegation, not per worker
   * definition: the same `explore` worker delegated twice in one turn is two rows.
   */
  readonly providerThreadId: string;
  /** Registry handle (`explore`, `general`, …) shown as the row's role. */
  readonly workerId: string;
  /** Registry display name, shown as the row's nickname. */
  readonly name: string;
  /** The short delegation description — what the row says this worker was asked to do. */
  readonly description: string;
  /** The worker's own model slug when the registry binds one; absent = inherits. */
  readonly model?: string | undefined;
  readonly status: PiDelegationWorkerStatus;
  /** One line of "latest" detail: the sub-task while running, the outcome once settled. */
  readonly message?: string | undefined;
  /**
   * What the worker has *done so far*, published on the card's own event stream.
   *
   * This is duplicated state on purpose. The web used to read a worker's progress only from its
   * child thread, which is a second fetch over a second subscription — and when that subscription
   * had not landed, a worker 167 tool calls deep still rendered as "waiting for its first step",
   * with no way for the user to tell a busy worker from a wedged one. Progress rides on the
   * delegation item instead, so it arrives on exactly the stream that draws the card.
   */
  readonly progress?: PiDelegationWorkerProgress | undefined;
}

export interface PiDelegationWorkerProgress {
  /** Distinct tool calls the worker has started. */
  readonly steps?: number | undefined;
  /** Title of the most recent tool call, i.e. what it is doing right now. */
  readonly lastStep?: string | undefined;
  /** When `lastStep` was recorded, so the card can show how long ago that was. */
  readonly lastStepAt?: string | undefined;
  /** When the worker started, so the card can show how long it has been running. */
  readonly startedAt?: string | undefined;
  /**
   * The worker's most recent tool calls, oldest first — its record, published on the card's own
   * stream so a worker can be inspected without opening its child thread.
   *
   * Contiguous-but-sliced, so each entry carries the call's own id (not its position): the same
   * tool called twice is two legitimate entries with distinct identities to render.
   */
  readonly recentSteps?: readonly PiDelegationWorkerStep[] | undefined;
}

/** One entry of a worker's record: the tool call's id and what it was. */
export interface PiDelegationWorkerStep {
  readonly id: string;
  readonly title: string;
}

export interface PiSubagentDelegationItemInput {
  readonly workers: readonly PiDelegatedWorker[];
  /** The orchestrator's effective model (`provider/id`), shown for workers that inherit it. */
  readonly inheritedModel?: string | undefined;
  /** True once every worker has settled, which is what closes the card. */
  readonly settled: boolean;
}

/** `<done>/<total> finished` — the card's meta line, e.g. `3/3 finished`. */
export function delegationProgressMessage(workers: readonly PiDelegatedWorker[]): string | null {
  if (workers.length === 0) return null;
  const done = workers.filter((worker) => worker.status !== "running").length;
  return `${done}/${workers.length} finished`;
}

/**
 * The outcome line for one settled worker: its size and the head of its conclusion.
 *
 * The conclusion can run to pages (a worker is asked for a self-contained answer), and the
 * card renders `message` on a single truncated line — so keep the first line and cap it. `steps`
 * is the worker's tool-call count, which is the only cheap signal of how much work it did.
 */
export function delegationSettleMessage(input: {
  readonly steps?: number | undefined;
  readonly answer?: string | undefined;
}): string | undefined {
  const head = input.answer
    ?.split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  const summary = head ? (head.length > 160 ? `${head.slice(0, 157)}...` : head) : undefined;
  const stepLabel = input.steps !== undefined && input.steps > 0 ? `${input.steps} steps` : "";
  const parts = [stepLabel, summary].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

/**
 * The card's line for a worker the runtime budget ended.
 *
 * Deliberately not phrased as a failure: the worker did not break, it ran out of time, and its
 * partial answer is being used — so the card says how much it got through and who has the rest.
 */
export function delegationBudgetMessage(input: {
  readonly minutes: number;
  readonly steps?: number | undefined;
}): string {
  const stepLabel =
    input.steps !== undefined && input.steps > 0 ? ` after ${input.steps} steps` : "";
  return `Ran past its ${input.minutes}-minute budget${stepLabel} — stopped; its partial answer went back to the orchestrator.`;
}

export function buildSubagentDelegationItem(
  input: PiSubagentDelegationItemInput,
): Record<string, unknown> {
  const { workers, inheritedModel } = input;
  const progress = delegationProgressMessage(workers);

  const receiverAgents = workers.map((worker) => ({
    threadId: worker.providerThreadId,
    agentId: worker.workerId,
    agentNickname: worker.name,
    agentRole: worker.workerId,
    ...(worker.model
      ? { model: worker.model }
      : inheritedModel
        ? { requestedModel: inheritedModel }
        : {}),
    // The short description, not the full prompt: this is the row's one-line label.
    prompt: worker.description,
  }));

  const agentStates: Record<string, Record<string, unknown>> = {};
  for (const worker of workers) {
    agentStates[worker.providerThreadId] = {
      agentId: worker.workerId,
      agentNickname: worker.name,
      agentRole: worker.workerId,
      status: worker.status,
      ...(worker.message ? { summary: worker.message } : {}),
      ...(worker.progress?.steps !== undefined ? { steps: worker.progress.steps } : {}),
      ...(worker.progress?.lastStep ? { lastStep: worker.progress.lastStep } : {}),
      ...(worker.progress?.lastStepAt ? { lastStepAt: worker.progress.lastStepAt } : {}),
      ...(worker.progress?.startedAt ? { startedAt: worker.progress.startedAt } : {}),
      ...(worker.progress?.recentSteps?.length
        ? {
            recentSteps: worker.progress.recentSteps.map((step) => ({
              id: step.id,
              title: step.title,
            })),
          }
        : {}),
    };
  }

  return {
    tool: "spawnAgent",
    status: input.settled ? "completed" : "inProgress",
    ...(progress ? { message: progress } : {}),
    receiverThreadIds: workers.map((worker) => worker.providerThreadId),
    receiverAgents,
    agentStates,
  };
}
