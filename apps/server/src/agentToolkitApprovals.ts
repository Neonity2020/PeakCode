/**
 * Approval gating for the pi coding-agent session.
 *
 * PeakCode's approval panel has always existed, but the pi provider never fed it: the
 * adapter's `respondToRequest` was a stub and no `request.opened` event was ever emitted.
 * This module closes that loop, and gives the agent toolkit's permission engine something
 * to decide.
 *
 * Wiring:
 *
 *   pi tool call
 *     → `tool_call` extension handler (registered here)
 *     → toolkit `permissionRequestForTool` + `evaluate` against the effective rule chain
 *     → allow  → return nothing, the call proceeds
 *       deny   → `{ block: true, reason }`, the call never runs
 *       ask    → emit `request.opened`; the UI's ComposerPendingApprovalPanel renders it;
 *                the user's answer comes back through `adapter.respondToRequest`
 *
 * Both the toolkit's own tools (bash / apply_patch / write_file / …) and pi's built-ins
 * (bash / edit / write / read) are covered — `permissionRequestForTool` maps both name
 * families, so a session cannot dodge the gate by using the other tool set.
 */
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { CanonicalRequestType } from "@peakcode/contracts";
import {
  effectiveRules,
  evaluate,
  getAuthorizedFolders,
  grantPermission,
  permissionRequestForTool,
  type PermissionAction,
} from "@peakcode/agent-toolkit/permissions";
import type { PermissionReply } from "@peakcode/agent-toolkit/agent-interactions";

/** What the toolkit decided about one tool call, plus what the UI needs to explain it. */
export interface ToolkitToolDecision {
  action: PermissionAction;
  /** Toolkit permission name (`bash` / `edit` / `external_directory` / …). */
  permission: string;
  title: string;
  detail: Record<string, string>;
  /** Rule patterns "always allow" would record. */
  always: string[];
  /** Canonical request type for the runtime event, so the panel picks the right wording. */
  requestType: CanonicalRequestType;
  /** Flattened one-line description for the event's `detail` field. */
  detailText: string;
}

/**
 * Toolkit permission name → canonical request type.
 *
 * The mapping is lossy on purpose: the canonical set is what the UI's `requestKind`
 * derivation understands (`command` / `file-read` / `file-change`), and anything outside
 * it degrades to `dynamic_tool_call`, which still renders — just without a specialised label.
 */
export function canonicalRequestTypeFor(
  permission: string,
  toolName: string,
): CanonicalRequestType {
  // The toolkit folds `apply_patch` into the generic `edit` permission, so the tool name is
  // the only place the distinction survives — and the panel has a dedicated label for it.
  if (toolName === "apply_patch") return "apply_patch_approval";

  switch (permission) {
    case "bash":
      return "command_execution_approval";
    case "edit":
      return "file_change_approval";
    case "read":
    case "external_directory":
      // Reading outside the workspace is a read approval; writing outside is a change.
      return toolName === "read" ||
        toolName === "read_file" ||
        toolName === "list_dir" ||
        toolName === "glob" ||
        toolName === "grep" ||
        toolName === "ls" ||
        toolName === "find" ||
        toolName === "view_image" ||
        toolName === "request_permissions"
        ? "file_read_approval"
        : "file_change_approval";
    default:
      return "dynamic_tool_call";
  }
}

/** One-line description for the runtime event; the panel shows `detail` as free text. */
function describeDecision(detail: Record<string, string>): string {
  return Object.entries(detail)
    .map(([key, value]) => `${key}: ${value}`)
    .join("；");
}

/**
 * Decide one tool call, without prompting.
 *
 * Returns `null` when the tool needs no approval at all (read-only tool, path inside the
 * workspace, unknown-but-harmless name) — the caller lets those through untouched.
 */
export function decideToolCall(input: {
  toolName: string;
  args: Record<string, unknown>;
  cwd: string;
  conversationId: number | null;
}): ToolkitToolDecision | null {
  const request = permissionRequestForTool({
    toolName: input.toolName,
    args: input.args,
    workspace: input.cwd,
  });
  if (!request) return null;

  // The effective chain already folds in workspace + session grants, so an "always allow"
  // the user gave earlier shows up here as a plain allow.
  const rules = effectiveRules(input.conversationId, input.cwd);
  const decision = evaluate(request, rules);
  return {
    action: decision.action,
    permission: request.permission,
    title: request.title,
    detail: request.detail,
    always: request.always,
    requestType: canonicalRequestTypeFor(request.permission, input.toolName),
    detailText: describeDecision(request.detail),
  };
}

/** Host-supplied prompt. Resolves with what the user chose in the approval panel. */
export type ApprovalPrompt = (input: {
  requestType: CanonicalRequestType;
  title: string;
  detail: string;
  toolName: string;
  always: string[];
}) => Promise<PermissionReply>;

export interface ToolkitApprovalExtensionOptions {
  cwd: string;
  /** Numeric session key used by the toolkit's session-scoped rules. */
  conversationId: number;
  prompt: ApprovalPrompt;
}

/** `accept` / `acceptForSession` both mean "run it"; `decline` / `cancel` mean "don't". */
export function isApproved(decision: string): boolean {
  return decision === "accept" || decision === "acceptForSession";
}

/**
 * The pi extension that enforces the toolkit's permission rules.
 *
 * Registered through the session's resource-loader `extensionFactories`; pi installs the
 * handler as `agent.beforeToolCall`, so a blocked call never executes and a mutated
 * `event.input` would be the supported way to patch arguments (we only veto).
 */
export function makeToolkitApprovalExtension(
  options: ToolkitApprovalExtensionOptions,
): ExtensionFactory {
  return (pi) => {
    pi.on("tool_call", async (event) => {
      const args = (event.input ?? {}) as Record<string, unknown>;
      const decision = decideToolCall({
        toolName: event.toolName,
        args,
        cwd: options.cwd,
        conversationId: options.conversationId,
      });
      if (!decision) return;
      if (decision.action === "allow") return;

      if (decision.action === "deny") {
        return {
          block: true,
          reason: `权限规则拒绝了这次调用（${decision.title}）。换一种做法，或者请用户先在设置里放行「${decision.permission}」。`,
        };
      }

      const reply = await options.prompt({
        requestType: decision.requestType,
        title: decision.title,
        detail: decision.detailText,
        toolName: event.toolName,
        always: decision.always,
      });

      if (reply === "deny") {
        return { block: true, reason: "用户拒绝了这次工具调用。" };
      }
      // 「本会话总是」/「始终允许」在放行的同时把规则记下来，下次同样形状的调用不再弹窗。
      if (reply === "session" || reply === "workspace") {
        for (const pattern of decision.always) {
          grantPermission({
            scope: reply === "session" ? "session" : "workspace",
            scopeRef: reply === "session" ? String(options.conversationId) : options.cwd,
            permission: decision.permission,
            pattern,
            action: "allow",
          });
        }
      }
      return;
    });
  };
}

/** Rules the user granted earlier, exposed for the settings surface. */
export function authorizedFolders(): string[] {
  return getAuthorizedFolders();
}
