import type { AgentGoalView } from "@peakcode/contracts";
import { memo } from "react";

import { Button } from "../ui/button";

/**
 * The Goal-mode panel above the composer.
 *
 * Goal mode's whole point is that the harness keeps working after a turn ends, which is
 * invisible unless the state is on screen: is it still going, did it stop itself, and why.
 * So the panel always shows the objective, how much of the continuation budget is spent,
 * and — when the goal stopped on its own — the reason, because "it just stopped" is the
 * failure mode this mode has to make legible.
 */
export const ComposerGoalPanel = memo(function ComposerGoalPanel({
  goal,
  onSetStatus,
  isPending,
}: {
  goal: AgentGoalView;
  onSetStatus: (status: "active" | "paused" | "complete" | "dropped") => void;
  isPending: boolean;
}) {
  const statusLabel = goalStatusLabel(goal.status);
  const isTerminal = goal.status === "complete" || goal.status === "dropped";
  const usage = goalUsageSummary(goal);

  return (
    <div className="px-4 py-3.5 sm:px-5 sm:py-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="uppercase text-sm tracking-[0.2em]">Goal</span>
        <span className="rounded-sm bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
          {statusLabel}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{goal.objective}</span>
      </div>

      {goal.acceptance ? (
        <div className="mt-1.5 text-xs text-muted-foreground">验收标准：{goal.acceptance}</div>
      ) : null}

      <div className="mt-1.5 text-xs text-muted-foreground">{usage}</div>

      {goal.outcome ? (
        <div className="mt-1.5 text-xs text-muted-foreground">结论：{goal.outcome}</div>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {goal.status === "active" ? (
          <Button
            size="sm"
            variant="chrome"
            disabled={isPending}
            onClick={() => onSetStatus("paused")}
          >
            暂停
          </Button>
        ) : null}
        {goal.status === "paused" || goal.status === "budget-limited" ? (
          <Button
            size="sm"
            variant="chrome"
            disabled={isPending}
            onClick={() => onSetStatus("active")}
          >
            {goal.status === "budget-limited" ? "继续推进" : "恢复"}
          </Button>
        ) : null}
        {!isTerminal ? (
          <>
            <Button
              size="sm"
              variant="chrome"
              disabled={isPending}
              onClick={() => onSetStatus("complete")}
            >
              标记完成
            </Button>
            <Button
              size="sm"
              variant="chrome"
              disabled={isPending}
              onClick={() => onSetStatus("dropped")}
            >
              放弃
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
});

function goalStatusLabel(status: AgentGoalView["status"]): string {
  switch (status) {
    case "active":
      return "推进中";
    case "paused":
      return "已暂停";
    case "budget-limited":
      return "已达预算上限";
    case "complete":
      return "已完成";
    case "dropped":
      return "已放弃";
  }
}

function goalUsageSummary(goal: AgentGoalView): string {
  const parts: string[] = [];
  parts.push(
    goal.tokenBudget === null
      ? `已用 ${goal.tokensUsed} tokens`
      : `已用 ${goal.tokensUsed} / ${goal.tokenBudget} tokens`,
  );
  if (goal.secondsUsed > 0) parts.push(`已运行 ${Math.round(goal.secondsUsed / 60)} 分钟`);
  parts.push(`自动续跑 ${goal.continuations} / ${goal.maxContinuations} 次`);
  return parts.join("；");
}
