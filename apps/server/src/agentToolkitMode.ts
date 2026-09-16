/**
 * Interaction modes: `default` / `plan` / `goal`.
 *
 * PeakCode already had the `plan` skeleton — the mode is persisted per thread, the UI has a
 * toggle, and a proposed plan flows through orchestration into `ProposedPlanCard`. What was
 * missing was a producer: the pi adapter never read `interactionMode`, nothing emitted
 * `turn.proposed.*`, and `planMode.ts`'s prompt shim had no callers. This module fills that
 * gap and adds `goal` alongside it.
 *
 * What each mode actually changes:
 *
 * - **default** — the full tool set, minus the two mode-only tools (`write_plan`, `goal`).
 * - **plan**    — read-only tools plus `write_plan`. Every write-capable tool is switched
 *                 off, from both families (the toolkit's `write_file`/`edit_file`/
 *                 `apply_patch`/`bash`/`task` and pi's own `write`/`edit`/`bash`), so "plan
 *                 mode touches nothing" is enforced by the tool registry rather than by the
 *                 prompt asking nicely.
 * - **goal**    — the full tool set plus `goal`. The agent records the objective and
 *                 acceptance criteria, and the harness continues across turns until the goal
 *                 reaches a terminal state or runs out of budget.
 */
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type {
  AgentApprovalMode,
  AgentGoalUserStatus,
  AgentGoalView,
  AgentRuntimeGetResult,
  ProviderInteractionMode,
  ThreadId,
} from "@peakcode/contracts";
import {
  createGoal,
  describeGoal,
  getGoal,
  goalContinuationText,
  goalPromptSection,
  isTerminal,
  maxGoalContinuations,
  setGoalStatus,
} from "@peakcode/agent-toolkit/agent-goals";
import { approvePlan, planHandoffSection, savePlan } from "@peakcode/agent-toolkit/agent-plans";
import { contextUsage } from "@peakcode/agent-toolkit/agent-context";
import { agentStore } from "@peakcode/agent-toolkit/store/AgentStore";
import type { ToolOutcome } from "@peakcode/agent-toolkit/agent-tools";
import { getSetting, updateSettings } from "@peakcode/agent-toolkit/runtime/settings";
import { threadConversationKey } from "./agentToolkit";

/** Toolkit tools that can change the world. Everything here is off in plan mode. */
const WRITE_CAPABLE_TOOLKIT_TOOLS = new Set([
  "bash",
  "write_file",
  "edit_file",
  "apply_patch",
  "task",
  // `write_plan` writes too, but only into the toolkit's data directory — it is the one
  // write plan mode is allowed to make, so it is handled separately below.
]);

/** pi's own write-capable built-ins. Kept in sync with `createCodingTools`. */
const WRITE_CAPABLE_PI_TOOLS = new Set(["write", "edit", "bash"]);

const PLAN_ONLY_TOOLS = new Set(["write_plan"]);
const GOAL_ONLY_TOOLS = new Set(["goal"]);

/**
 * Which of the registered tools a turn in this mode may use.
 *
 * Registration and activation are separate concerns: every toolkit tool is registered once
 * per session so `setActiveToolsByName` can switch modes without rebuilding the session, and
 * this decides which subset is live. Switching the active set also rebuilds pi's base system
 * prompt, so plan mode stops advertising tools it cannot use.
 */
export function activeToolNamesForMode(
  mode: ProviderInteractionMode,
  allToolNames: readonly string[],
): string[] {
  return allToolNames.filter((name) => {
    const writeCapable = WRITE_CAPABLE_TOOLKIT_TOOLS.has(name) || WRITE_CAPABLE_PI_TOOLS.has(name);

    if (mode === "plan") {
      if (GOAL_ONLY_TOOLS.has(name)) return false;
      if (PLAN_ONLY_TOOLS.has(name)) return true;
      return !writeCapable;
    }
    if (mode === "goal") {
      return !PLAN_ONLY_TOOLS.has(name);
    }
    // default
    return !PLAN_ONLY_TOOLS.has(name) && !GOAL_ONLY_TOOLS.has(name);
  });
}

function textOutcome(text: string): ToolOutcome {
  return { content: [{ type: "text", text }], details: {} };
}

/**
 * The `goal` tool: create / get / complete / abandon.
 *
 * Mirrors OmniStudio's handler. The instruction that matters most is the one on `complete`
 * — the system prompt tells the model to attach evidence, and the reply repeats it, because
 * "I did a lot of things" is the standard way an autonomous loop lies about being done.
 */
export function handleGoalTool(
  conversationId: number,
  input: { op: string; objective?: string; acceptance?: string; outcome?: string },
): ToolOutcome {
  const op = input.op?.trim().toLowerCase();

  if (op === "create") {
    const objective = (input.objective ?? "").trim();
    if (!objective) return textOutcome("create 需要 objective。");
    const goal = createGoal(conversationId, {
      objective,
      acceptance: input.acceptance?.trim() || null,
    });
    return textOutcome(
      `目标已登记。\n\n${describeGoal(goal)}\n\n` +
        "现在开始推进；回合结束后会自动继续，直到达成或撞上预算。",
    );
  }

  if (op === "get") {
    const goal = getGoal(conversationId);
    if (!goal) return textOutcome("这个会话还没有目标。先调用 goal 的 create。");
    return textOutcome(`${describeGoal(goal)}\n\n验收标准：${goal.acceptance ?? "（未明确）"}`);
  }

  if (op === "complete" || op === "abandon") {
    const goal = getGoal(conversationId);
    if (!goal) return textOutcome("没有可结束的目标。");
    if (isTerminal(goal.status)) return textOutcome(`目标已经是终态（${goal.status}）。`);
    const outcome = input.outcome?.trim() ?? "";
    if (op === "complete" && !outcome) {
      return textOutcome(
        "complete 需要 outcome：列出证据（改了哪些文件、跑了什么命令、看到什么输出）。" +
          "没有证据就不要标完成 —— 做不到就用 abandon 说明卡在哪。",
      );
    }
    const updated = setGoalStatus(
      conversationId,
      op === "complete" ? "complete" : "dropped",
      outcome,
    );
    return textOutcome(
      updated
        ? `${op === "complete" ? "目标已完成" : "目标已放弃"}。\n\n${describeGoal(updated)}`
        : "目标状态更新失败。",
    );
  }

  return textOutcome(`不认识的 op：${input.op}。可用：create / get / complete / abandon。`);
}

/**
 * The `write_plan` tool: persist the plan and hand the markdown back for the proposed-plan
 * event. Saving to the toolkit's data directory (not the workspace) is what lets plan mode
 * keep its "the workspace is untouched" promise while still producing something durable that
 * survives a switch back to default mode.
 */
export function handleWritePlan(
  conversationId: number,
  workspace: string,
  content: string,
): { outcome: ToolOutcome; planMarkdown: string | null } {
  const trimmed = content.trim();
  if (!trimmed) return { outcome: textOutcome("方案内容不能为空。"), planMarkdown: null };
  try {
    const plan = savePlan(conversationId, { content: trimmed, workspace });
    return {
      outcome: textOutcome(
        `方案已写入 ${plan.filePath ?? "(数据目录)"}。\n\n` +
          "在回复里简要复述方案要点后停下，等用户批准或要求修改。",
      ),
      planMarkdown: trimmed,
    };
  } catch (error) {
    return {
      outcome: textOutcome(`写方案失败：${error instanceof Error ? error.message : String(error)}`),
      planMarkdown: null,
    };
  }
}

/** Mark the stored plan as approved (the UI's "implement" path calls this). */
export function approveStoredPlan(conversationId: number): boolean {
  return approvePlan(conversationId).ok;
}

export interface ToolkitContextExtensionOptions {
  conversationId: number;
  /** Read lazily: the mode is per turn, the extension is per session. */
  currentMode: () => ProviderInteractionMode;
}

/**
 * Per-turn prompt injection.
 *
 * `before_agent_start` runs on every turn, which is what makes this the right hook: a goal
 * can be created mid-session, and the goal section has to appear from the *next* turn on,
 * not from the next session. Returning `systemPrompt` replaces it for that turn only, so
 * nothing has to be unwound afterwards.
 */
export function makeToolkitContextExtension(
  options: ToolkitContextExtensionOptions,
): ExtensionFactory {
  return (pi) => {
    pi.on("before_agent_start", (event) => {
      const mode = options.currentMode();
      const sections: string[] = [];

      if (mode === "goal") {
        const goalSection = goalSectionFor(options.conversationId);
        if (goalSection) sections.push(goalSection);
      }
      if (mode === "plan") {
        // A previously approved plan still frames the work when the user returns to plan mode.
        const handoff = planHandoffSection(options.conversationId);
        if (handoff) sections.push(handoff);
      }
      if (sections.length === 0) return;

      return { systemPrompt: `${event.systemPrompt}\n\n${sections.join("\n\n")}` };
    });
  };
}

/** The goal section plus the continuation budget, so the model knows how many turns it has. */
function goalSectionFor(conversationId: number): string | null {
  const section = goalPromptSection(conversationId);
  if (!section) return null;
  const goal = getGoal(conversationId);
  if (!goal) return null;
  return `${section}

**自动续跑预算**：已用 ${goal.continuations} / ${maxGoalContinuations()} 次。`;
}

/** The message that restarts a goal turn. Used by the continuation loop. */
export function goalContinuationPrompt(conversationId: number): string | null {
  const goal = getGoal(conversationId);
  if (!goal || isTerminal(goal.status)) return null;
  return goalContinuationText(goal);
}

/** Whether a goal still wants the harness to keep going. */
export function goalWantsContinuation(conversationId: number): boolean {
  const goal = getGoal(conversationId);
  return goal !== null && !isTerminal(goal.status);
}

/** The goal as the composer's panel needs it, or `null` when the thread has none. */
export function readGoalView(threadId: ThreadId): AgentGoalView | null {
  const conversationId = threadConversationKey(threadId);
  const goal = getGoal(conversationId);
  if (!goal) return null;
  return {
    threadId,
    objective: goal.objective,
    acceptance: goal.acceptance,
    status: goal.status,
    tokenBudget: goal.tokenBudget,
    tokensUsed: goal.tokensUsed,
    secondsUsed: goal.secondsUsed,
    continuations: goal.continuations,
    maxContinuations: maxGoalContinuations(),
    outcome: goal.outcome,
    updatedAt: new Date(goal.updatedAt ?? Date.now()).toISOString(),
  };
}

/**
 * Move a goal to a state the user picked.
 *
 * Resuming from `budget-limited` also resets the continuation counter. Without that the
 * scheduler would see the cap already reached and stop again on the very next turn — the
 * button would look like it worked and do nothing.
 */
export function applyGoalStatus(
  threadId: ThreadId,
  status: AgentGoalUserStatus,
  outcome?: string,
): AgentGoalView | null {
  const conversationId = threadConversationKey(threadId);
  const goal = getGoal(conversationId);
  if (!goal) return null;

  const next = setGoalStatus(conversationId, status, outcome ?? null);
  if (!next) return null;

  if (status === "active" && goal.status === "budget-limited") {
    const stored = getGoal(conversationId);
    if (stored) {
      agentStore().upsertGoal({
        ...stored,
        continuations: 0,
        createdAt: stored.createdAt ?? Date.now(),
        updatedAt: Date.now(),
      });
    }
  }
  return readGoalView(threadId);
}

/**
 * Per-thread runtime state the composer toolbar reads.
 *
 * Approval mode lives in the toolkit's settings (`AGENT_APPROVAL_MODE`) and is what
 * `agentToolkitApprovals` evaluates tool calls against, so reading it from the same place the
 * gate does keeps the chip and the actual behaviour from drifting apart.
 */
const threadContextWindows = new Map<number, number>();

export function readAgentRuntimeStatus(threadId: ThreadId): AgentRuntimeGetResult {
  const conversationId = threadConversationKey(threadId);
  const windowTokens = threadContextWindows.get(conversationId);
  const context =
    windowTokens === undefined ? null : contextUsage(conversationId, { windowTokens });
  return { approvalMode: readApprovalMode(), context };
}

export function setAgentApprovalMode(mode: AgentApprovalMode): AgentApprovalMode {
  updateSettings({ AGENT_APPROVAL_MODE: mode });
  return readApprovalMode();
}

/** The stored approval policy, defaulting the same way the permission engine does. */
export function readApprovalMode(): AgentApprovalMode {
  const raw = getSetting("AGENT_APPROVAL_MODE");
  return raw === "manual" || raw === "auto" || raw === "strict" ? raw : "smart";
}

/**
 * Remember the active model's context window for a thread.
 *
 * The toolkit's context accounting defaults to a global window setting, which is wrong here:
 * two threads can run different models with different windows. The adapter reports the real
 * one per turn, and the ring measures against it.
 */
export function rememberThreadContextWindow(threadId: ThreadId, windowTokens: number): void {
  if (!Number.isFinite(windowTokens) || windowTokens <= 0) return;
  threadContextWindows.set(threadConversationKey(threadId), Math.floor(windowTokens));
}

export function forgetThreadContextWindow(threadId: ThreadId): void {
  threadContextWindows.delete(threadConversationKey(threadId));
}
