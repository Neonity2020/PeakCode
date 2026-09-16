// FILE: kanbanUiState.ts
// Purpose: Persists the kanban view's selected project across reloads.
// Layer: Browser storage helper
// Exports: readKanbanProjectId, persistKanbanProjectId

const KANBAN_UI_STATE_STORAGE_KEY = "peakcode:kanban-ui:v1";

export function readKanbanProjectId(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(KANBAN_UI_STATE_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as { selectedProjectId?: unknown };
    const selectedProjectId = parsed.selectedProjectId;
    return typeof selectedProjectId === "string" && selectedProjectId.length > 0
      ? selectedProjectId
      : null;
  } catch {
    return null;
  }
}

export function persistKanbanProjectId(projectId: string | null): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      KANBAN_UI_STATE_STORAGE_KEY,
      JSON.stringify({ selectedProjectId: projectId }),
    );
  } catch {
    // Storage is best-effort; the in-memory selection still works for this session.
  }
}
