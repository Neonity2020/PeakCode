import { describe, expect, it } from "vitest";

import {
  DEFAULT_MAX_ELEMENTS,
  MAX_MAX_ELEMENTS,
  clickPointFromQuads,
  encodeChord,
  modifierBits,
  mouseButton,
  renderAxTree,
  type AxNode,
} from "./browserCdp.ts";

const node = (input: Partial<AxNode> & { nodeId: string }): AxNode => ({
  ignored: false,
  ...input,
});

describe("renderAxTree", () => {
  it("renders role, name and a ref in page order", () => {
    const tree = renderAxTree([
      node({
        nodeId: "1",
        role: { value: "RootWebArea" },
        name: { value: "Sign in" },
        childIds: ["2", "3"],
      }),
      node({
        nodeId: "2",
        role: { value: "textbox" },
        name: { value: "Email" },
        backendDOMNodeId: 11,
      }),
      node({
        nodeId: "3",
        role: { value: "button" },
        name: { value: "Sign in" },
        backendDOMNodeId: 12,
      }),
    ]);

    expect(tree.lines).toEqual([
      'RootWebArea "Sign in"',
      '  [e1] textbox "Email" value=""',
      '  [e2] button "Sign in"',
    ]);
    expect([...tree.refs]).toEqual([
      ["e1", 11],
      ["e2", 12],
    ]);
  });

  it("drops structural noise so the budget goes to actionable nodes", () => {
    const tree = renderAxTree([
      node({ nodeId: "1", role: { value: "generic" }, childIds: ["2", "3"] }),
      node({ nodeId: "2", role: { value: "InlineTextBox" }, name: { value: "hello" } }),
      node({ nodeId: "3", role: { value: "none" }, name: { value: "wrapper" } }),
    ]);

    expect(tree.lines).toEqual([]);
  });

  it("keeps a named generic node, which is how labelled regions appear", () => {
    const tree = renderAxTree([
      node({ nodeId: "1", role: { value: "generic" }, name: { value: "Search results" } }),
    ]);
    expect(tree.lines).toEqual(['generic "Search results"']);
  });

  it("skips nodes that say nothing", () => {
    const tree = renderAxTree([node({ nodeId: "1", role: { value: "button" } })]);
    expect(tree.lines).toEqual([]);
  });

  it("does not assign a ref to a node the browser gave no backend id for", () => {
    const tree = renderAxTree([
      node({ nodeId: "1", role: { value: "heading" }, name: { value: "Title" } }),
      node({ nodeId: "2", role: { value: "button" }, name: { value: "Go" }, backendDOMNodeId: 5 }),
    ]);

    // The heading is readable but not addressable; the button takes e1, not e2.
    expect(tree.lines).toEqual(['heading "Title"', '[e1] button "Go"']);
    expect([...tree.refs]).toEqual([["e1", 5]]);
  });

  it("prints a value for value-bearing roles", () => {
    const tree = renderAxTree([
      node({
        nodeId: "1",
        role: { value: "textbox" },
        name: { value: "Email" },
        value: { value: "a@b.c" },
        backendDOMNodeId: 1,
      }),
    ]);
    expect(tree.lines).toEqual(['[e1] textbox "Email" value="a@b.c"']);
  });

  it("prints only the states that are on", () => {
    const tree = renderAxTree([
      node({
        nodeId: "1",
        role: { value: "checkbox" },
        name: { value: "Remember me" },
        backendDOMNodeId: 1,
        properties: [
          { name: "checked", value: { value: false } },
          { name: "disabled", value: { value: true } },
        ],
      }),
    ]);
    // "checked=false" is already implied by reading the page; "disabled" is not.
    expect(tree.lines).toEqual(['[e1] checkbox "Remember me" disabled']);
  });

  it("collapses an exact repeat of the previous static text", () => {
    const tree = renderAxTree([
      node({
        nodeId: "1",
        role: { value: "StaticText" },
        name: { value: "Hello" },
        childIds: ["2"],
      }),
      node({ nodeId: "2", role: { value: "StaticText" }, name: { value: "Hello" } }),
    ]);

    expect(tree.lines).toEqual(['StaticText "Hello"']);
  });

  it("collapses whitespace in names and values", () => {
    const tree = renderAxTree([
      node({
        nodeId: "1",
        role: { value: "heading" },
        name: { value: "  Two\n  words  " },
        backendDOMNodeId: 1,
      }),
    ]);
    expect(tree.lines).toEqual(['[e1] heading "Two words"']);
  });

  it("caps the output and reports how much was dropped", () => {
    const children = Array.from({ length: 10 }, (_value, index) =>
      node({
        nodeId: `c${index}`,
        role: { value: "button" },
        name: { value: `B${index}` },
        backendDOMNodeId: index + 1,
      }),
    );
    const tree = renderAxTree(
      [
        node({ nodeId: "1", role: { value: "generic" }, childIds: children.map((c) => c.nodeId!) }),
        ...children,
      ],
      { maxElements: 3 },
    );

    expect(tree.lines).toHaveLength(3);
    expect(tree.omitted).toBe(7);
    // Refs stay dense: a dropped line must not consume a handle the model can then guess.
    expect([...tree.refs.keys()]).toEqual(["e1", "e2", "e3"]);
  });

  it("clamps the requested cap into the supported range", () => {
    const many = Array.from({ length: 5 }, (_value, index) =>
      node({
        nodeId: `c${index}`,
        role: { value: "button" },
        name: { value: `B${index}` },
        backendDOMNodeId: index + 1,
      }),
    );
    const tree = [
      node({ nodeId: "root", role: { value: "generic" }, childIds: many.map((c) => c.nodeId!) }),
      ...many,
    ];

    expect(renderAxTree(tree, { maxElements: 0 }).lines).toHaveLength(1);
    expect(
      renderAxTree(tree, { maxElements: Number.MAX_SAFE_INTEGER }).lines.length,
    ).toBeLessThanOrEqual(MAX_MAX_ELEMENTS);
    expect(renderAxTree(tree).lines.length).toBeLessThanOrEqual(DEFAULT_MAX_ELEMENTS);
  });

  it("survives an empty or orphaned reply", () => {
    expect(renderAxTree([])).toEqual({ lines: [], refs: new Map(), omitted: 0 });
    // A child id with no node behind it is skipped rather than throwing.
    expect(
      renderAxTree([
        node({
          nodeId: "1",
          role: { value: "heading" },
          name: { value: "T" },
          childIds: ["missing"],
        }),
      ]).lines,
    ).toEqual(['heading "T"']);
  });

  it("still shows a node the root cannot reach", () => {
    // A detached node would otherwise be invisible, and the agent would conclude the page
    // simply does not have that control.
    const tree = renderAxTree([
      node({
        nodeId: "1",
        role: { value: "heading" },
        name: { value: "Title" },
        backendDOMNodeId: 1,
      }),
      node({
        nodeId: "2",
        role: { value: "button" },
        name: { value: "Orphan" },
        backendDOMNodeId: 2,
      }),
    ]);

    expect(tree.lines).toEqual(['[e1] heading "Title"', '[e2] button "Orphan"']);
  });

  it("visits a shared child once, not once per parent", () => {
    const shared = node({
      nodeId: "shared",
      role: { value: "button" },
      name: { value: "Once" },
      backendDOMNodeId: 9,
    });
    const tree = renderAxTree([
      node({ nodeId: "a", role: { value: "generic" }, name: { value: "A" }, childIds: ["shared"] }),
      node({ nodeId: "b", role: { value: "generic" }, name: { value: "B" }, childIds: ["shared"] }),
      shared,
    ]);

    expect(tree.lines.filter((line) => line.includes("Once"))).toHaveLength(1);
  });
});

describe("clickPointFromQuads", () => {
  it("returns the centre of the first quad", () => {
    // A 100x40 box at (10,20): the click should land at (60,40).
    expect(clickPointFromQuads([[10, 20, 110, 20, 110, 60, 10, 60]])).toEqual({ x: 60, y: 40 });
  });

  it("rounds to whole pixels", () => {
    expect(clickPointFromQuads([[0, 0, 11, 0, 11, 11, 0, 11]])).toEqual({ x: 6, y: 6 });
  });

  it("refuses a node with no layout, rather than clicking (0,0)", () => {
    expect(clickPointFromQuads([])).toBeNull();
    expect(clickPointFromQuads(undefined)).toBeNull();
    expect(clickPointFromQuads([[]])).toBeNull();
    expect(clickPointFromQuads([[1, 2, 3]])).toBeNull();
    expect(clickPointFromQuads([[0, 0, Number.NaN, 0, 0, 0, 0, 0]])).toBeNull();
  });
});

describe("encodeChord", () => {
  it("parses a named key", () => {
    expect(encodeChord("Enter", undefined)).toEqual({
      modifiers: 0,
      stroke: { key: "Enter", code: "Enter", keyCode: 13 },
    });
  });

  it("is case-insensitive for named keys", () => {
    expect(encodeChord("escape", undefined)?.stroke.key).toBe("Escape");
    expect(encodeChord("ESC", undefined)?.stroke.key).toBe("Escape");
  });

  it("folds a chord's modifiers into the bitmask", () => {
    // cmd=4, shift=8
    expect(encodeChord("cmd+shift+k", undefined)).toEqual({
      modifiers: 12,
      stroke: { key: "k", code: "KeyK", keyCode: 75, text: "k" },
    });
  });

  it("merges modifiers passed alongside the chord", () => {
    expect(encodeChord("a", ["ctrl"])?.modifiers).toBe(2);
    expect(encodeChord("a", ["alt", "ctrl"])?.modifiers).toBe(3);
  });

  it("carries text only for printable keys", () => {
    // A modifier with text would type a literal character into the page.
    expect(encodeChord("a", undefined)?.stroke.text).toBe("a");
    expect(encodeChord("Tab", undefined)?.stroke.text).toBeUndefined();
    expect(encodeChord("ArrowDown", undefined)?.stroke.text).toBeUndefined();
  });

  it("maps digits and function keys to usable codes", () => {
    expect(encodeChord("7", undefined)?.stroke).toEqual({
      key: "7",
      code: "Digit7",
      keyCode: 55,
      text: "7",
    });
    expect(encodeChord("F5", undefined)?.stroke.key).toBe("F5");
  });

  it("refuses a chord it cannot encode instead of guessing", () => {
    expect(encodeChord("", undefined)).toBeNull();
    expect(encodeChord("HyperKey", undefined)).toBeNull();
  });
});

describe("mouseButton", () => {
  it("maps the three buttons to CDP fields and bitmasks", () => {
    expect(mouseButton(undefined)).toEqual({ button: "left", buttons: 1 });
    expect(mouseButton("right")).toEqual({ button: "right", buttons: 2 });
    expect(mouseButton("middle")).toEqual({ button: "middle", buttons: 4 });
  });

  it("falls back to left for something it does not know", () => {
    expect(mouseButton("thumb")).toEqual({ button: "left", buttons: 1 });
  });
});

describe("modifierBits", () => {
  it("accepts either spelling of the command key", () => {
    expect(modifierBits(["cmd"])).toBe(4);
    expect(modifierBits(["meta"])).toBe(4);
    expect(modifierBits(["command"])).toBe(4);
  });

  it("ignores unknown modifiers and empty input", () => {
    expect(modifierBits(["hyper"])).toBe(0);
    expect(modifierBits(undefined)).toBe(0);
  });
});
