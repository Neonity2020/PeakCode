// FILE: kanbanUiState.ts
// Purpose: Persists the kanban view's own UI state across reloads: which
//          project's board is open, whether it reads as a board or a list,
//          whether the board's left menu is showing, and which columns the user
//          folded away into the hidden-column rail.
// Layer: Browser storage helper
// Exports: KanbanUiState, KANBAN_UI_STATE_DEFAULT, KANBAN_HIDDEN_STATUS_DEFAULT,
//          parseKanbanUiState, readKanbanUiState, persistKanbanUiState,
//          readKanbanProjectId, persistKanbanProjectId

import { KANBAN_TASK_STATUSES, type KanbanTaskStatus } from "@peakcode/contracts";

const KANBAN_UI_STATE_STORAGE_KEY = "peakcode:kanban-ui:v1";

export type KanbanViewMode = "board" | "list";

export interface KanbanUiState {
  readonly selectedProjectId: string | null;
  readonly viewMode: KanbanViewMode;
  readonly sidebarVisible: boolean;
  /** Columns folded into the rail; every other column is drawn on the board. */
  readonly hiddenStatuses: ReadonlyArray<KanbanTaskStatus>;
}

/**
 * Archived work is not what the board is for, so it starts folded into the
 * rail. It stays one click away, and a card can still be dropped on it.
 */
export const KANBAN_HIDDEN_STATUS_DEFAULT: ReadonlyArray<KanbanTaskStatus> = ["archived"];

export const KANBAN_UI_STATE_DEFAULT: KanbanUiState = {
  selectedProjectId: null,
  viewMode: "board",
  sidebarVisible: true,
  hiddenStatuses: KANBAN_HIDDEN_STATUS_DEFAULT,
};

/** Keeps only the column keys the board can actually draw. */
function parseHiddenStatuses(value: unknown): ReadonlyArray<KanbanTaskStatus> {
  if (!Array.isArray(value)) return KANBAN_HIDDEN_STATUS_DEFAULT;
  const known = new Set<string>(KANBAN_TASK_STATUSES);
  return value.filter(
    (entry): entry is KanbanTaskStatus => typeof entry === "string" && known.has(entry),
  );
}

/**
 * Stored payloads predate the view mode, the sidebar flag, and the hidden
 * columns, so every field is read defensively and anything unusable falls back
 * to the default.
 */
export function parseKanbanUiState(raw: string | null): KanbanUiState {
  if (!raw) {
    return KANBAN_UI_STATE_DEFAULT;
  }

  try {
    const parsed = JSON.parse(raw) as {
      selectedProjectId?: unknown;
      viewMode?: unknown;
      sidebarVisible?: unknown;
      hiddenStatuses?: unknown;
    };
    const selectedProjectId = parsed.selectedProjectId;
    return {
      selectedProjectId:
        typeof selectedProjectId === "string" && selectedProjectId.length > 0
          ? selectedProjectId
          : null,
      viewMode: parsed.viewMode === "list" ? "list" : "board",
      sidebarVisible: parsed.sidebarVisible !== false,
      hiddenStatuses: parseHiddenStatuses(parsed.hiddenStatuses),
    };
  } catch {
    return KANBAN_UI_STATE_DEFAULT;
  }
}

export function readKanbanUiState(): KanbanUiState {
  if (typeof window === "undefined") {
    return KANBAN_UI_STATE_DEFAULT;
  }

  try {
    return parseKanbanUiState(window.localStorage.getItem(KANBAN_UI_STATE_STORAGE_KEY));
  } catch {
    return KANBAN_UI_STATE_DEFAULT;
  }
}

/** Merges the patch into what is stored, so callers only name what they change. */
export function persistKanbanUiState(patch: Partial<KanbanUiState>): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const next = { ...readKanbanUiState(), ...patch };
    window.localStorage.setItem(KANBAN_UI_STATE_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage is best-effort; the in-memory selection still works for this session.
  }
}

export function readKanbanProjectId(): string | null {
  return readKanbanUiState().selectedProjectId;
}

export function persistKanbanProjectId(projectId: string | null): void {
  persistKanbanUiState({ selectedProjectId: projectId });
}
