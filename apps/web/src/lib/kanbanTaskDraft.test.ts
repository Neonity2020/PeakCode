// FILE: kanbanTaskDraft.test.ts
// Purpose: Cover the dirty check that drives the create page's leave guard, so a
//          whitespace-only draft never triggers a spurious confirmation.

import { describe, expect, it } from "vitest";

import { emptyKanbanTaskDraft, isKanbanTaskDraftDirty } from "./kanbanTaskDraft";

describe("isKanbanTaskDraftDirty", () => {
  it("is clean for a fresh draft", () => {
    expect(isKanbanTaskDraftDirty(emptyKanbanTaskDraft("todo"), "todo")).toBe(false);
  });

  it("ignores whitespace-only input", () => {
    const draft = { ...emptyKanbanTaskDraft("todo"), title: "   ", description: "\n\t" };
    expect(isKanbanTaskDraftDirty(draft, "todo")).toBe(false);
  });

  it("is dirty once any field carries content", () => {
    const base = emptyKanbanTaskDraft("todo");
    expect(isKanbanTaskDraftDirty({ ...base, title: "Task" }, "todo")).toBe(true);
    expect(isKanbanTaskDraftDirty({ ...base, description: "Notes" }, "todo")).toBe(true);
    expect(isKanbanTaskDraftDirty({ ...base, pipeline: "pipeline" }, "todo")).toBe(true);
    expect(isKanbanTaskDraftDirty({ ...base, assignee: "dev" }, "todo")).toBe(true);
    expect(isKanbanTaskDraftDirty({ ...base, agentModel: "gpt-5" }, "todo")).toBe(true);
  });

  it("treats changed select defaults as dirty", () => {
    const base = emptyKanbanTaskDraft("todo");
    expect(isKanbanTaskDraftDirty({ ...base, priority: "high" }, "todo")).toBe(true);
    // A different initial column that the user moved away from counts too.
    expect(isKanbanTaskDraftDirty(emptyKanbanTaskDraft("in_progress"), "todo")).toBe(true);
  });
});
