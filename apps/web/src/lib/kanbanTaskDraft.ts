// FILE: kanbanTaskDraft.ts
// Purpose: The in-memory draft behind the kanban task create page. Kept out of
//          the view so "has the user typed anything worth keeping?" is a pure,
//          testable decision — it drives the leave-page confirmation.
// Layer: Web logic helpers

import type {
  KanbanAgentProvider,
  KanbanTaskPriority,
  KanbanTaskStatus,
} from "@peakcode/contracts";

export interface KanbanTaskDraft {
  readonly title: string;
  readonly description: string;
  readonly status: KanbanTaskStatus;
  readonly priority: KanbanTaskPriority;
  readonly pipeline: string;
  readonly assignee: string;
  readonly agentProvider: KanbanAgentProvider;
  /** Empty means "run with the default model". */
  readonly agentModel: string;
}

/** Fresh draft for the create page; `status` is the column the user clicked. */
export function emptyKanbanTaskDraft(status: KanbanTaskStatus): KanbanTaskDraft {
  return {
    title: "",
    description: "",
    status,
    priority: "medium",
    pipeline: "",
    assignee: "",
    agentProvider: "pi",
    agentModel: "",
  };
}

/**
 * True once the draft differs from the untouched page. Whitespace-only text does
 * not count: it would be trimmed away before the task is created.
 */
export function isKanbanTaskDraftDirty(
  draft: KanbanTaskDraft,
  initialStatus: KanbanTaskStatus,
): boolean {
  return (
    draft.title.trim().length > 0 ||
    draft.description.trim().length > 0 ||
    draft.pipeline.trim().length > 0 ||
    draft.assignee.trim().length > 0 ||
    draft.status !== initialStatus ||
    draft.priority !== "medium" ||
    draft.agentProvider !== "pi" ||
    draft.agentModel.length > 0
  );
}
