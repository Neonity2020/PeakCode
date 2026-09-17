// FILE: kanbanDrag.test.ts
// Purpose: Cover the kanban drop-slot arithmetic used by drag-and-drop.

import { describe, expect, it } from "vitest";

import { dropIndexFromMiddles, resolveDropIndex } from "./kanbanDrag";

describe("dropIndexFromMiddles", () => {
  const middles = [40, 120, 200];

  it("inserts before the first card whose midpoint is below the pointer", () => {
    expect(dropIndexFromMiddles(middles, 10)).toBe(0);
    expect(dropIndexFromMiddles(middles, 60)).toBe(1);
    expect(dropIndexFromMiddles(middles, 150)).toBe(2);
  });

  it("appends when the pointer is below every card", () => {
    expect(dropIndexFromMiddles(middles, 400)).toBe(3);
  });

  it("appends for an empty column", () => {
    expect(dropIndexFromMiddles([], 120)).toBe(0);
  });
});

describe("resolveDropIndex", () => {
  it("keeps the raw slot when the card comes from another column", () => {
    expect(resolveDropIndex({ rawIndex: 2, originalIndex: null })).toBe(2);
  });

  it("keeps the raw slot when dragging a card up inside its own column", () => {
    expect(resolveDropIndex({ rawIndex: 0, originalIndex: 2 })).toBe(0);
    expect(resolveDropIndex({ rawIndex: 1, originalIndex: 1 })).toBe(1);
  });

  it("shifts down by one when the dragged card sits above the drop slot", () => {
    // Cards [A, B, C]; dragging A (index 0) below B reports slot 2, but B is
    // the only remaining card, so the target order is 1.
    expect(resolveDropIndex({ rawIndex: 2, originalIndex: 0 })).toBe(1);
    expect(resolveDropIndex({ rawIndex: 3, originalIndex: 1 })).toBe(2);
  });
});
