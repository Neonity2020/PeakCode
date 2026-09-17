/**
 * Pure helpers for driving a page over CDP.
 *
 * Everything here is a function of its arguments: turning an accessibility tree into the
 * text the model reads, turning a quads reply into a click point, encoding a key chord.
 * Keeping them out of the session class is what makes the tricky parts — ref assignment,
 * capping, key encoding — testable without a browser.
 *
 * The targeting scheme follows Puppeteer's, which is the well-trodden path: scroll the node
 * into view, ask for its content quads, click the centre of the first one. Reimplementing
 * that differently would mean rediscovering its edge cases.
 */

/** One node of `Accessibility.getFullAXTree`'s reply, narrowed to what we read. */
export interface AxNode {
  nodeId?: string;
  ignored?: boolean;
  role?: { value?: unknown };
  name?: { value?: unknown };
  value?: { value?: unknown };
  properties?: { name?: string; value?: { value?: unknown } }[];
  childIds?: string[];
  backendDOMNodeId?: number;
}

export interface AxSnapshot {
  /** One line per element, ready to hand to the model. */
  lines: string[];
  /** Snapshot-local handle (`e12`) to CDP `backendNodeId`. */
  refs: Map<string, number>;
  /** How many lines were dropped by the cap. */
  omitted: number;
}

/** Default cap on snapshot lines. Big enough for a real page, small enough to stay cheap. */
export const DEFAULT_MAX_ELEMENTS = 400;
export const MAX_MAX_ELEMENTS = 2_000;

/**
 * Roles that never carry anything actionable.
 *
 * `InlineTextBox` always duplicates its `StaticText` parent, and `none`/`presentation` are
 * decoration. Skipping these roughly triples how much real page fits in the same budget.
 * `generic` is deliberately absent: a generic node with a name is a labelled region worth
 * showing, and one without a name fails the actionability test below anyway.
 */
const ALWAYS_SKIP_ROLES = new Set([
  "none",
  "presentation",
  "ignored",
  "InlineTextBox",
  "LineBreak",
]);

/** Roles whose own state is worth printing, because it changes what an action means. */
const STATE_KEYS = ["checked", "disabled", "expanded", "selected", "required", "readonly"];

const text = (value: unknown): string => (typeof value === "string" ? value : "");

const collapse = (value: string): string => value.replace(/\s+/g, " ").trim();

const roleOf = (node: AxNode): string => collapse(text(node.role?.value));

/** Value-bearing roles print their value; a textbox's content is the point of reading it. */
const VALUE_ROLES = new Set([
  "textbox",
  "searchbox",
  "combobox",
  "spinbutton",
  "slider",
  "listbox",
]);

/**
 * Render an accessibility tree as the compact, ref-annotated text the model works from.
 *
 * Traversal is depth-first in child order so the output reads top-to-bottom like the page.
 * Refs are assigned in that same order, which makes `e1` the first thing on the page rather
 * than an arbitrary id — the model can reason about "the third button" and be right.
 */
export function renderAxTree(
  nodes: readonly AxNode[],
  options: { maxElements?: number } = {},
): AxSnapshot {
  const maxElements = Math.max(
    1,
    Math.min(options.maxElements ?? DEFAULT_MAX_ELEMENTS, MAX_MAX_ELEMENTS),
  );

  const byId = new Map<string, AxNode>();
  for (const node of nodes) {
    if (typeof node.nodeId === "string") byId.set(node.nodeId, node);
  }
  // The tree is rooted at the first node the browser reports; some replies include orphans.
  const root = nodes.find((node) => !node.ignored) ?? nodes[0];

  const lines: string[] = [];
  const refs = new Map<string, number>();
  const visited = new Set<string>();
  let omitted = 0;
  let nextRef = 1;
  let previousName = "";

  const visit = (node: AxNode, depth: number): void => {
    if (typeof node.nodeId === "string") {
      if (visited.has(node.nodeId)) return;
      visited.add(node.nodeId);
    }

    const role = roleOf(node);
    const name = collapse(text(node.name?.value));
    const value = collapse(text(node.value?.value));

    /**
     * A node earns a line when it says something: a name to locate it by, or a value worth
     * reading. Everything else is structure, and structure is not what an agent acts on.
     */
    const says = name.length > 0 || value.length > 0;

    // The accessibility tree reports a page's prose once per inline box, so an exact repeat
    // of the previous line is duplication rather than content.
    const duplicated = name.length > 0 && name === previousName && role === "StaticText";

    if (says && !duplicated && !ALWAYS_SKIP_ROLES.has(role)) {
      if (lines.length >= maxElements) {
        omitted += 1;
      } else {
        const backendNodeId = node.backendDOMNodeId;
        const handle = typeof backendNodeId === "number" ? `e${nextRef++}` : null;
        if (handle !== null && typeof backendNodeId === "number") {
          refs.set(handle, backendNodeId);
        }
        lines.push(formatLine({ role, name, value, node, depth, ref: handle }));
        if (name.length > 0) previousName = name;
      }
    }

    for (const childId of node.childIds ?? []) {
      const child = byId.get(childId);
      if (child) visit(child, depth + 1);
    }
  };

  if (root) visit(root, 0);

  /**
   * Walk anything the root could not reach.
   *
   * A well-formed reply is a single tree, but a node detached from the root would otherwise
   * be invisible to the model — it would look like the page simply does not have that
   * control, and the agent would hunt for a target that is right there in the reply.
   */
  for (const node of nodes) {
    if (typeof node.nodeId !== "string" || !visited.has(node.nodeId)) {
      visit(node, 0);
    }
  }

  return { lines, refs, omitted };
}

function formatLine(input: {
  role: string;
  name: string;
  value: string;
  node: AxNode;
  depth: number;
  ref: string | null;
}): string {
  const { role, name, value, node, depth, ref } = input;
  const label = name.length > 0 ? `${role} "${name}"` : role;

  const indent = depth === 0 ? "" : "  ".repeat(Math.min(depth, 16));
  const handle = ref === null ? "" : `[${ref}] `;

  const states = STATE_KEYS.flatMap((key) => {
    const property = node.properties?.find((candidate) => candidate.name === key);
    if (!property) return [];
    const raw = property.value?.value;
    // Only print a state when it is on: "disabled=false" is the default and adds nothing.
    if (raw === false || raw === "false" || raw === undefined) return [];
    return [raw === true ? key : `${key}=${collapse(text(raw))}`];
  });

  const parts = [`${indent}${handle}${label}`];
  if (VALUE_ROLES.has(role)) parts.push(`value=${JSON.stringify(value)}`);
  if (states.length > 0) parts.push(states.join(" "));
  return parts.join(" ").trimEnd();
}

/**
 * The click point for an element, from its content quads.
 *
 * Quad coordinates are viewport CSS pixels, which is the same space
 * `Input.dispatchMouseEvent` consumes — no page-to-screen transform belongs here, and
 * getting one wrong is exactly the class of bug that makes a click land on the wrong thing.
 */
export function clickPointFromQuads(quads: unknown): { x: number; y: number } | null {
  if (!Array.isArray(quads) || quads.length === 0) return null;
  const first = quads[0];
  if (!Array.isArray(first) || first.length < 8) return null;

  // A quad is x1,y1, x2,y2, x3,y3, x4,y4 around the box; the centre is the mean.
  const xs = [first[0], first[2], first[4], first[6]].map(Number);
  const ys = [first[1], first[3], first[5], first[7]].map(Number);
  if ([...xs, ...ys].some((value) => !Number.isFinite(value))) return null;

  return {
    x: Math.round((Math.min(...xs) + Math.max(...xs)) / 2),
    y: Math.round((Math.min(...ys) + Math.max(...ys)) / 2),
  };
}

/** CDP modifier bits. */
const MODIFIER_BITS: Record<string, number> = {
  alt: 1,
  ctrl: 2,
  control: 2,
  meta: 4,
  cmd: 4,
  command: 4,
  shift: 8,
};

export function modifierBits(modifiers: readonly string[] | undefined): number {
  let bits = 0;
  for (const modifier of modifiers ?? []) {
    bits |= MODIFIER_BITS[modifier.trim().toLowerCase()] ?? 0;
  }
  return bits;
}

/**
 * Keys that are not a printable character.
 *
 * `code` and the virtual key code are what the page actually sees for these; sending only
 * `key` produces a keydown that many frameworks ignore.
 */
const NAMED_KEYS: Record<string, { key: string; code: string; keyCode: number }> = {
  enter: { key: "Enter", code: "Enter", keyCode: 13 },
  return: { key: "Enter", code: "Enter", keyCode: 13 },
  tab: { key: "Tab", code: "Tab", keyCode: 9 },
  escape: { key: "Escape", code: "Escape", keyCode: 27 },
  esc: { key: "Escape", code: "Escape", keyCode: 27 },
  backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
  delete: { key: "Delete", code: "Delete", keyCode: 46 },
  space: { key: " ", code: "Space", keyCode: 32 },
  arrowup: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  up: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  arrowdown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  down: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  arrowleft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  left: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  arrowright: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  right: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  home: { key: "Home", code: "Home", keyCode: 36 },
  end: { key: "End", code: "End", keyCode: 35 },
  pageup: { key: "PageUp", code: "PageUp", keyCode: 33 },
  pagedown: { key: "PageDown", code: "PageDown", keyCode: 34 },
};

export interface KeyStroke {
  key: string;
  code: string;
  keyCode: number;
  /** Only printable keys carry text; a modifier or Arrow keys must not. */
  text?: string;
}

/**
 * Parse one key or chord (`Enter`, `cmd+a`, `Ctrl+Shift+K`).
 *
 * Returns the modifier bits and the single key to press, or `null` when the chord has no
 * recognisable key — a wrong guess here types the wrong thing into the user's page, so
 * refusing is better than approximating.
 */
export function encodeChord(
  chord: string,
  modifiers: readonly string[] | undefined,
): { modifiers: number; stroke: KeyStroke } | null {
  const parts = chord
    .split("+")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length === 0) return null;

  const inlineModifiers = parts.slice(0, -1);
  const keyPart = parts[parts.length - 1]!;
  const bits = modifierBits([...(modifiers ?? []), ...inlineModifiers]);

  const named = NAMED_KEYS[keyPart.toLowerCase()];
  if (named) return { modifiers: bits, stroke: { ...named } };

  // A single character: send it as text so the page receives an actual input event.
  if ([...keyPart].length === 1) {
    const upper = keyPart.toUpperCase();
    const isLetter = upper >= "A" && upper <= "Z";
    const isDigit = keyPart >= "0" && keyPart <= "9";
    return {
      modifiers: bits,
      stroke: {
        key: keyPart,
        code: isLetter ? `Key${upper}` : isDigit ? `Digit${keyPart}` : "",
        keyCode: isLetter || isDigit ? upper.charCodeAt(0) : 0,
        text: keyPart,
      },
    };
  }

  // Function keys and the like: pass the name through, since CDP accepts many of them.
  if (/^f\d{1,2}$/i.test(keyPart)) {
    return {
      modifiers: bits,
      stroke: { key: keyPart, code: keyPart.toUpperCase(), keyCode: 0 },
    };
  }

  return null;
}

/** Left, right and middle as the CDP `button` field and the `buttons` bitmask. */
export function mouseButton(button: string | undefined): { button: string; buttons: number } {
  switch ((button ?? "left").trim().toLowerCase()) {
    case "right":
      return { button: "right", buttons: 2 };
    case "middle":
      return { button: "middle", buttons: 4 };
    default:
      return { button: "left", buttons: 1 };
  }
}
