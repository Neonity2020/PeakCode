// FILE: _chat.kanban.$taskId.tsx
// Purpose: Full-page view of one task: requirement, run state and comments.
//          A page rather than a dialog, because a tracked task carries a lot.
// Layer: Route
// Exports: Route

import { createFileRoute, useSearch } from "@tanstack/react-router";
import type { KanbanTaskId, ProjectId } from "@peakcode/contracts";
import { KanbanTaskDetailView } from "~/components/KanbanTaskDetailView";
import { readKanbanProjectId } from "~/kanbanUiState";

interface TaskDetailSearch {
  readonly project?: string | undefined;
}

function KanbanTaskDetailRoute() {
  const { taskId } = Route.useParams();
  const search = useSearch({ strict: false }) as TaskDetailSearch;
  const projectId = (search.project ?? readKanbanProjectId() ?? null) as ProjectId | null;
  return <KanbanTaskDetailView projectId={projectId} taskId={taskId as KanbanTaskId} />;
}

export const Route = createFileRoute("/_chat/kanban/$taskId")({
  component: KanbanTaskDetailRoute,
});
