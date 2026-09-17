// FILE: Sidebar.threadRowParts.tsx
// Purpose: Row-level pieces of the sidebar thread list: jump labels, meta chips, avatars and
//          subagent labels.
// Layer: Component

import { TerminalIcon } from "~/lib/icons";

import { FiGitBranch } from "react-icons/fi";
import { GoRepoForked } from "react-icons/go";

import { LuMessageSquareDashed, LuSplit } from "react-icons/lu";
import { useMemo, type ReactNode } from "react";

import { type ProviderKind, ThreadId, type ResolvedKeybindingsConfig } from "@peakcode/contracts";

import { useStore } from "../store";

import { shortcutLabelForCommand, threadJumpCommandForIndex } from "../keybindings";
import { createThreadSelector } from "../storeSelectors";

import { resolveThreadEnvironmentPresentation } from "../lib/threadEnvironment";

import type { SidebarThreadSummary, Thread } from "../types";

import { ProviderIcon } from "./ProviderIcon";
import { TerminalStatusIndicator } from "./Sidebar.statusBadges";

import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

import { resolveSubagentPresentationForThread } from "../lib/subagentPresentation";

import { cn } from "~/lib/utils";

import { resolveThreadHandoffBadgeLabel } from "../lib/threadHandoff";

export const EMPTY_THREAD_JUMP_LABELS = new Map<ThreadId, string>();
export const EMPTY_SHORTCUT_PARTS: readonly string[] = [];

export function threadJumpLabelMapsEqual(
  left: ReadonlyMap<ThreadId, string>,
  right: ReadonlyMap<ThreadId, string>,
): boolean {
  if (left === right) {
    return true;
  }
  if (left.size !== right.size) {
    return false;
  }
  for (const [threadId, label] of left) {
    if (right.get(threadId) !== label) {
      return false;
    }
  }
  return true;
}

// Resolve the visible numbered-thread hints from the active keybinding config.
export function buildThreadJumpLabelMap(input: {
  keybindings: ResolvedKeybindingsConfig;
  platform: string;
  terminalOpen: boolean;
  threadJumpCommandByThreadId: ReadonlyMap<
    ThreadId,
    NonNullable<ReturnType<typeof threadJumpCommandForIndex>>
  >;
}): ReadonlyMap<ThreadId, string> {
  if (input.threadJumpCommandByThreadId.size === 0) {
    return EMPTY_THREAD_JUMP_LABELS;
  }

  const shortcutLabelOptions = {
    platform: input.platform,
    context: {
      terminalFocus: false,
      terminalOpen: input.terminalOpen,
    },
  } as const;
  const mapping = new Map<ThreadId, string>();
  for (const [threadId, command] of input.threadJumpCommandByThreadId) {
    const label = shortcutLabelForCommand(input.keybindings, command, shortcutLabelOptions);
    if (label) {
      mapping.set(threadId, label);
    }
  }
  return mapping.size > 0 ? mapping : EMPTY_THREAD_JUMP_LABELS;
}
export function WorktreeBadgeGlyph({ className }: { className?: string }) {
  return <LuSplit aria-hidden="true" className={cn("rotate-90", className)} />;
}

export function resolveWorktreeBadgeLabel(
  thread: Pick<Thread, "envMode" | "worktreePath">,
): string | null {
  return resolveThreadEnvironmentPresentation({
    envMode: thread.envMode,
    worktreePath: thread.worktreePath,
  }).worktreeBadgeLabel;
}

export type ThreadMetaChip = {
  id: "handoff" | "fork" | "sidechat" | "worktree";
  tooltip: string;
  icon: ReactNode;
};

/**
 * Back-to-front order: first = behind, last = in front.
 * Priority lowest -> highest: handoff -> fork/sidechat -> worktree.
 */
export function resolveThreadRowMetaChips(input: {
  thread: Pick<
    Thread,
    "forkSourceThreadId" | "sidechatSourceThreadId" | "envMode" | "worktreePath" | "handoff"
  >;
  includeHandoffBadge: boolean;
}): ThreadMetaChip[] {
  const chips: ThreadMetaChip[] = [];

  const handoffBadgeLabel = resolveThreadHandoffBadgeLabel(input.thread);
  if (input.includeHandoffBadge && handoffBadgeLabel) {
    chips.push({
      id: "handoff",
      tooltip: handoffBadgeLabel,
      icon: <FiGitBranch className="size-3 text-muted-foreground/55" />,
    });
  }

  if (input.thread.forkSourceThreadId) {
    chips.push({
      id: "fork",
      tooltip: "Forked thread",
      icon: <GoRepoForked className="size-3 text-emerald-600 dark:text-emerald-300/90" />,
    });
  }

  if (input.thread.sidechatSourceThreadId) {
    chips.push({
      id: "sidechat",
      tooltip: "Sidechat",
      icon: <LuMessageSquareDashed className="size-3 text-sky-600 dark:text-sky-300/90" />,
    });
  }

  const worktreeBadgeLabel = resolveWorktreeBadgeLabel(input.thread);
  if (worktreeBadgeLabel) {
    chips.push({
      id: "worktree",
      tooltip: worktreeBadgeLabel,
      icon: <WorktreeBadgeGlyph className="size-3 text-muted-foreground/55" />,
    });
  }

  return chips;
}

export function ThreadMetaChipStack({ chips }: { chips: ThreadMetaChip[] }) {
  if (chips.length === 0) {
    return <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center" />;
  }
  if (chips.length === 1) {
    const only = chips[0]!;
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center">
              {only.icon}
            </span>
          }
        />
        <TooltipPopup side="top">{only.tooltip}</TooltipPopup>
      </Tooltip>
    );
  }
  const tooltipText = chips.map((chip) => chip.tooltip).join(" · ");
  const chipSize = 14;
  const step = 8;
  const width = chipSize + step * (chips.length - 1);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            className="relative h-3.5 shrink-0"
            style={{ width: `${width}px` }}
            aria-label={tooltipText}
          >
            {chips.map((chip, index) => (
              <span
                key={chip.id}
                className="absolute top-1/2 inline-flex size-3.5 -translate-y-1/2 items-center justify-center rounded-full bg-background shadow-xs"
                style={{ left: `${index * step}px`, zIndex: index + 1 }}
              >
                {chip.icon}
              </span>
            ))}
          </div>
        }
      />
      <TooltipPopup side="top">{tooltipText}</TooltipPopup>
    </Tooltip>
  );
}

export function ProviderAvatarWithTerminal({
  provider,
  handoffSourceProvider,
  handoffTooltip,
  terminalStatus,
  terminalCount,
}: {
  provider: ProviderKind;
  handoffSourceProvider?: ProviderKind | null;
  handoffTooltip?: string | null;
  terminalStatus: TerminalStatusIndicator | null;
  terminalCount: number;
}) {
  const showBadge = terminalCount > 1 || terminalStatus !== null;
  const badgeTooltip =
    terminalCount > 1
      ? `${terminalCount} terminal${terminalCount === 1 ? "" : "s"} open`
      : (terminalStatus?.label ?? "Terminal open");
  const badgeColorClass = terminalStatus?.colorClass ?? "text-muted-foreground/55";

  const hasHandoff = Boolean(handoffSourceProvider);
  const containerClass = hasHandoff
    ? "relative inline-flex h-3.5 w-5 shrink-0 items-center"
    : "relative inline-flex size-3.5 shrink-0 items-center justify-center";

  const avatarNode = hasHandoff ? (
    <span className={containerClass}>
      <span className="absolute left-0 top-1/2 inline-flex size-3.5 -translate-y-1/2 items-center justify-center rounded-full bg-background shadow-xs">
        <ProviderIcon provider={handoffSourceProvider!} className="size-2.5" />
      </span>
      <span className="absolute right-0 top-1/2 z-10 inline-flex size-3.5 -translate-y-1/2 items-center justify-center rounded-full bg-background shadow-xs">
        <ProviderIcon provider={provider} className="size-2.5" />
      </span>
    </span>
  ) : (
    <span className={containerClass}>
      <ProviderIcon provider={provider} className="size-3.5 opacity-80" />
    </span>
  );

  const wrappedAvatar =
    hasHandoff && handoffTooltip ? (
      <Tooltip>
        <TooltipTrigger render={avatarNode} />
        <TooltipPopup side="top">{handoffTooltip}</TooltipPopup>
      </Tooltip>
    ) : (
      avatarNode
    );

  return (
    <span className="relative inline-flex shrink-0 items-center">
      {wrappedAvatar}
      {showBadge ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                aria-label={badgeTooltip}
                className="absolute -top-1.5 -right-1.5 inline-flex size-3 min-w-3 items-center justify-center rounded-full bg-background px-px shadow-xs"
              >
                {terminalCount > 1 ? (
                  <span
                    className={cn(
                      "text-[8px] font-semibold leading-none tabular-nums",
                      badgeColorClass,
                    )}
                  >
                    {terminalCount}
                  </span>
                ) : (
                  <TerminalIcon className={cn("size-2.5", badgeColorClass)} />
                )}
              </span>
            }
          />
          <TooltipPopup side="top">{badgeTooltip}</TooltipPopup>
        </Tooltip>
      ) : null}
    </span>
  );
}

export type SidebarSplitPreview = {
  title: string;
  provider: ProviderKind;
  threadId: ThreadId | null;
};

export function renderSubagentLabel(input: {
  threadId: string;
  parentThreadId?: string | null | undefined;
  agentId?: string | null | undefined;
  nickname?: string | null | undefined;
  role?: string | null | undefined;
  title?: string | null | undefined;
  threads?: ReadonlyArray<Thread> | undefined;
  titleClassName?: string | undefined;
  roleClassName?: string | undefined;
}) {
  const presentation = resolveSubagentPresentationForThread({
    thread: {
      id: input.threadId,
      parentThreadId: input.parentThreadId,
      subagentAgentId: input.agentId,
      subagentNickname: input.nickname,
      subagentRole: input.role,
      title: input.title,
    },
    threads: input.threads,
  });
  const supportingLabel =
    presentation.role ??
    (presentation.nickname && presentation.title && presentation.title !== presentation.nickname
      ? presentation.title
      : null);

  return (
    <span className="min-w-0 truncate">
      <span
        className={cn("font-medium", input.titleClassName)}
        style={{ color: presentation.accentColor }}
      >
        {presentation.nickname ?? presentation.primaryLabel}
      </span>
      {supportingLabel ? (
        <span className={cn("ml-1 text-muted-foreground/48", input.roleClassName)}>
          {presentation.role ? `(${presentation.role})` : supportingLabel}
        </span>
      ) : null}
    </span>
  );
}

export function SidebarSubagentLabel(props: {
  threadId: ThreadId;
  parentThreadId?: ThreadId | null | undefined;
  agentId?: string | null | undefined;
  nickname?: string | null | undefined;
  role?: string | null | undefined;
  title?: string | null | undefined;
  titleClassName?: string | undefined;
  roleClassName?: string | undefined;
}) {
  const selectParentThread = useMemo(
    () => createThreadSelector(props.parentThreadId ?? null),
    [props.parentThreadId],
  );
  const parentThread = useStore(selectParentThread);

  return renderSubagentLabel({
    threadId: props.threadId,
    parentThreadId: props.parentThreadId,
    agentId: props.agentId,
    nickname: props.nickname,
    role: props.role,
    title: props.title,
    threads: parentThread ? [parentThread] : undefined,
    titleClassName: props.titleClassName,
    roleClassName: props.roleClassName,
  });
}

export function resolveSplitPreviewTitle(input: {
  thread: Pick<SidebarThreadSummary, "title"> | null;
  draftPrompt: string | null;
}): string {
  if (input.thread?.title) {
    return input.thread.title;
  }
  const draftPrompt = input.draftPrompt?.trim() ?? "";
  if (draftPrompt.length > 0) {
    return draftPrompt;
  }
  return "New chat";
}
