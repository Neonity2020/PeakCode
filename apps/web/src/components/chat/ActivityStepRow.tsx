// FILE: ActivityStepRow.tsx
// Purpose: Renders one agent step in the transcript as a compact single line —
//          muted icon on the left, action word, then the step summary (thinking
//          duration, read/search counts, or the command that ran).
// Layer: Component
// Exports: ActivityStepRow

import { memo } from "react";

import { BrainIcon, SearchIcon, TerminalIcon, type LucideIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { useMessages, type Messages } from "../../i18n";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type { ActivityRow } from "./activityRows";

type StepRow = Extract<ActivityRow, { kind: "thinking" | "read" | "command" }>;

/** Seconds are the smallest unit shown, matching the reference step stream. */
function formatStepDuration(durationMs: number, messages: Messages): string {
  const totalSeconds = Math.max(1, Math.round(durationMs / 1000));
  if (totalSeconds < 60) {
    return messages.chat.timeline.activityDurationSeconds(totalSeconds);
  }
  const minutes = Math.floor(totalSeconds / 60);
  return messages.chat.timeline.activityDurationMinutes(minutes, totalSeconds % 60);
}

function stepPresentation(
  row: StepRow,
  messages: Messages,
): { icon: LucideIcon; action: string; detail: string | null; hoverText: string | null } {
  if (row.kind === "thinking") {
    return {
      icon: BrainIcon,
      action: messages.chat.timeline.activityThinking,
      detail:
        row.durationMs === null
          ? null
          : messages.chat.timeline.activityThinkingDuration(
              formatStepDuration(row.durationMs, messages),
            ),
      hoverText: null,
    };
  }

  if (row.kind === "read") {
    const parts: string[] = [];
    if (row.counts.searchCount > 0) {
      parts.push(messages.chat.timeline.activityReadSearchCount(row.counts.searchCount));
    }
    if (row.counts.fileCount > 0) {
      parts.push(messages.chat.timeline.activityReadFileCount(row.counts.fileCount));
    }
    const targets = row.entries
      .map((entry) => entry.toolTitle ?? entry.label)
      .filter((value) => value.trim().length > 0);
    return {
      icon: SearchIcon,
      action: messages.chat.timeline.activityRead,
      detail: parts.length > 0 ? parts.join(", ") : null,
      hoverText: targets.length > 0 ? targets.join("\n") : null,
    };
  }

  return {
    icon: TerminalIcon,
    action: messages.chat.timeline.activityCommand,
    detail: row.command,
    hoverText: row.rawCommand,
  };
}

export const ActivityStepRow = memo(function ActivityStepRow(props: {
  row: StepRow;
  fontSizePx: number;
}) {
  const { row, fontSizePx } = props;
  const messages = useMessages();
  const { icon: StepIcon, action, detail, hoverText } = stepPresentation(row, messages);
  const iconSizePx = fontSizePx + 2;

  const content = (
    <div className="flex min-w-0 items-center gap-2" title={hoverText ?? undefined}>
      <span
        className="flex shrink-0 items-center justify-center text-muted-foreground/45"
        style={{ width: iconSizePx, height: iconSizePx }}
      >
        <StepIcon style={{ width: iconSizePx, height: iconSizePx }} />
      </span>
      <p
        className="min-w-0 flex-1 truncate text-muted-foreground"
        style={{ fontSize: `${fontSizePx}px`, lineHeight: `${Math.round(fontSizePx * 1.6)}px` }}
      >
        {action}
        {detail ? <span className="text-muted-foreground/80"> · {detail}</span> : null}
      </p>
    </div>
  );

  if (row.kind !== "command") {
    return content;
  }

  return (
    <Tooltip>
      <TooltipTrigger render={content} />
      <TooltipPopup side="top" align="start" className="max-w-[36rem] whitespace-pre-wrap">
        {row.rawCommand}
      </TooltipPopup>
    </Tooltip>
  );
});

/** Step rows are listed one per line with the reference stream's airy rhythm. */
export const ACTIVITY_ROW_LIST_CLASS = cn("flex flex-col gap-3.5");
