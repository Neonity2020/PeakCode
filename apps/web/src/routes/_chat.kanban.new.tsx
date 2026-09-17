// FILE: _chat.kanban.new.tsx
// Purpose: Full-page kanban task creation, reached from the board's "New task"
//          action. A page rather than a dialog, so the whole form fits and the
//          draft cannot be lost to a stray backdrop click.
// Layer: Route
// Exports: Route

import { createFileRoute, useSearch } from "@tanstack/react-router";
import { KANBAN_TASK_STATUSES, type KanbanTaskStatus, type ProjectId } from "@peakcode/contracts";
import { KanbanTaskCreateView } from "~/components/KanbanTaskCreateView";
import { readKanbanProjectId } from "~/kanbanUiState";

interface CreateTaskSearch {
  readonly project?: string | undefined;
  readonly status?: string | undefined;
}

const isKanbanTaskStatus = (value: string | undefined): value is KanbanTaskStatus =>
  (KANBAN_TASK_STATUSES as ReadonlyArray<string>).includes(value ?? "");

function KanbanTaskCreateRoute() {
  const search = useSearch({ strict: false }) as CreateTaskSearch;
  const projectId = (search.project ?? readKanbanProjectId() ?? null) as ProjectId | null;
  const status: KanbanTaskStatus = isKanbanTaskStatus(search.status) ? search.status : "todo";
  return <KanbanTaskCreateView projectId={projectId} initialStatus={status} />;
}

export const Route = createFileRoute("/_chat/kanban/new")({
  component: KanbanTaskCreateRoute,
});
