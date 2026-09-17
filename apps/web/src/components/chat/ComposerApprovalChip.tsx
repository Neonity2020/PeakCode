import { AGENT_APPROVAL_MODES, type AgentApprovalMode } from "@peakcode/contracts";
import { memo, useState } from "react";
import { BiLockAlt } from "react-icons/bi";
import { GoCheck, GoShield, GoZap } from "react-icons/go";
import { HiOutlineHandRaised } from "react-icons/hi2";

import { cn } from "~/lib/utils";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";

/**
 * The composer's approval-policy chip.
 *
 * This is the same four-level policy the server evaluates tool calls against
 * (`AGENT_APPROVAL_MODE` → `agentToolkitApprovals`), so what the chip says is what actually
 * happens to the next `bash` or `write_file` — the two are read from one place on purpose.
 *
 * It replaces the old two-state "Full access / Default permissions" button. That one drove
 * `runtimeMode`, which could only express "ask about everything" or "ask about nothing";
 * the middle ground (write freely, stop at dangerous commands) is where most work happens.
 */
export const ComposerApprovalChip = memo(function ComposerApprovalChip({
  mode,
  disabled,
  isPending,
  onChange,
}: {
  mode: AgentApprovalMode;
  disabled?: boolean | undefined;
  isPending?: boolean | undefined;
  onChange: (mode: AgentApprovalMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const { label, Icon } = approvalPresentation(mode);

  return (
    <Menu open={open} onOpenChange={setOpen}>
      <MenuTrigger
        render={
          <button
            type="button"
            disabled={disabled || isPending}
            aria-label={`审批模式：${label}`}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1",
              "text-[length:var(--app-font-size-ui-sm,11px)] transition-colors",
              "text-[var(--color-text-foreground-secondary)] hover:bg-[var(--color-background-button-secondary-hover)] hover:text-[var(--color-text-foreground)]",
              "disabled:opacity-50",
            )}
          >
            <Icon className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="leading-none">{label}</span>
          </button>
        }
      />
      <MenuPopup align="start" side="top">
        {AGENT_APPROVAL_MODES.map((candidate) => {
          const item = approvalPresentation(candidate);
          return (
            <MenuItem
              key={candidate}
              onClick={() => {
                setOpen(false);
                if (candidate !== mode) onChange(candidate);
              }}
            >
              <item.Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span>{item.label}</span>
                <span className="text-xs text-muted-foreground">{item.hint}</span>
              </span>
              {candidate === mode ? (
                <GoCheck className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              ) : null}
            </MenuItem>
          );
        })}
      </MenuPopup>
    </Menu>
  );
});

function approvalPresentation(mode: AgentApprovalMode): {
  label: string;
  hint: string;
  Icon: typeof GoZap;
} {
  switch (mode) {
    case "manual":
      return { label: "每次编辑", hint: "改文件、跑命令之前都先问你", Icon: HiOutlineHandRaised };
    case "auto":
      return { label: "全自动", hint: "全部放行，只有提权到沙箱之外会拦一下", Icon: GoZap };
    case "strict":
      return { label: "只读", hint: "拒绝所有写操作与命令", Icon: BiLockAlt };
    default:
      return {
        label: "允许编辑",
        hint: "写文件与普通命令直接跑，危险命令才问",
        Icon: GoShield,
      };
  }
}
