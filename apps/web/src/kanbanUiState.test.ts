// FILE: kanbanUiState.test.ts
// Purpose: Pins the board's stored UI state: readable defaults for payloads
//          written by older builds, and merge-on-write so each action only
//          names the field it changes.
// Layer: Browser storage helper tests

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  KANBAN_HIDDEN_STATUS_DEFAULT,
  KANBAN_UI_STATE_DEFAULT,
  parseKanbanUiState,
  persistKanbanUiState,
  persistKanbanProjectId,
  readKanbanProjectId,
  readKanbanUiState,
} from "./kanbanUiState";

const STORAGE_KEY = "peakcode:kanban-ui:v1";

function installWindow(storage: Map<string, string>) {
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
    },
  });
}

describe("parseKanbanUiState", () => {
  it("falls back to the defaults for missing or unreadable payloads", () => {
    expect(parseKanbanUiState(null)).toEqual(KANBAN_UI_STATE_DEFAULT);
    expect(parseKanbanUiState("not json")).toEqual(KANBAN_UI_STATE_DEFAULT);
    expect(parseKanbanUiState("{}")).toEqual(KANBAN_UI_STATE_DEFAULT);
  });

  it("keeps a project written by the earlier build and fills in the new fields", () => {
    expect(parseKanbanUiState(JSON.stringify({ selectedProjectId: "p_1" }))).toEqual({
      selectedProjectId: "p_1",
      viewMode: "board",
      sidebarVisible: true,
      hiddenStatuses: KANBAN_HIDDEN_STATUS_DEFAULT,
    });
  });

  it("only accepts the modes it knows", () => {
    expect(parseKanbanUiState(JSON.stringify({ viewMode: "list" })).viewMode).toBe("list");
    expect(parseKanbanUiState(JSON.stringify({ viewMode: "calendar" })).viewMode).toBe("board");
    expect(parseKanbanUiState(JSON.stringify({ sidebarVisible: false })).sidebarVisible).toBe(
      false,
    );
  });

  it("keeps only the column keys the board can draw", () => {
    expect(
      parseKanbanUiState(JSON.stringify({ hiddenStatuses: ["archived", "someday"] }))
        .hiddenStatuses,
    ).toEqual(["archived"]);
    expect(
      parseKanbanUiState(JSON.stringify({ hiddenStatuses: "archived" })).hiddenStatuses,
    ).toEqual(KANBAN_HIDDEN_STATUS_DEFAULT);
  });
});

describe("kanban ui state storage", () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    storage.clear();
    installWindow(storage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("round-trips the view mode", () => {
    persistKanbanUiState({ viewMode: "list", selectedProjectId: "p_1" });
    expect(readKanbanUiState()).toEqual({
      selectedProjectId: "p_1",
      viewMode: "list",
      sidebarVisible: true,
      hiddenStatuses: KANBAN_HIDDEN_STATUS_DEFAULT,
    });
  });

  it("merges a patch instead of dropping the fields it does not mention", () => {
    persistKanbanUiState({ viewMode: "list", selectedProjectId: "p_1" });
    persistKanbanUiState({ sidebarVisible: false });
    persistKanbanUiState({ hiddenStatuses: [] });

    expect(readKanbanUiState()).toEqual({
      selectedProjectId: "p_1",
      viewMode: "list",
      sidebarVisible: false,
      hiddenStatuses: [],
    });
    expect(JSON.parse(storage.get(STORAGE_KEY)!)).toMatchObject({ selectedProjectId: "p_1" });
  });

  it("keeps the project helpers reading and writing the same payload", () => {
    persistKanbanProjectId("p_2");
    expect(readKanbanProjectId()).toBe("p_2");

    persistKanbanProjectId(null);
    expect(readKanbanProjectId()).toBeNull();
  });
});
