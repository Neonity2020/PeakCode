// FILE: listOrder.test.ts
// Purpose: Pins moveToEnd, the rule every project list uses to keep the app's
//          built-in workspace at the bottom.
// Layer: Web presentation helper tests

import { describe, expect, it } from "vitest";

import { moveToEnd } from "./listOrder";

describe("moveToEnd", () => {
  it("moves every match to the back, keeping the rest in order", () => {
    expect(moveToEnd(["a", "keep", "b", "keep"], (value) => value === "keep")).toEqual([
      "a",
      "b",
      "keep",
      "keep",
    ]);
  });

  it("returns the same order when nothing matches", () => {
    const items = ["a", "b"];
    expect(moveToEnd(items, () => false)).toEqual(["a", "b"]);
  });

  it("does not mutate the input", () => {
    const items = ["keep", "a"];
    moveToEnd(items, (value) => value === "keep");
    expect(items).toEqual(["keep", "a"]);
  });
});
