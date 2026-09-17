import { describe, expect, it } from "vitest";

import { buildAgentTools } from "../agent-tools.ts";
import { COMPUTER_ACTIONS, computerArgsError, createComputerTool } from "../tools/computerTools.ts";
import type { ComputerToolParams, ToolContext } from "../tools/toolSupport.ts";

const workspace = "/tmp/ws";

/** A context that looks like a session on a machine with a helper behind it. */
const withComputer = (vision = true): ToolContext => ({
  workspace,
  allowShell: false,
  vision,
  onComputer: () => ({ content: [{ type: "text", text: "ok" }], details: {} }),
});

const args = (params: Partial<ComputerToolParams> & { action: string }): ComputerToolParams =>
  params as ComputerToolParams;

describe("computer tool registration", () => {
  it("is absent when the host injected no helper callback", () => {
    const names = buildAgentTools({ workspace, allowShell: false }).map((tool) => tool.name);
    expect(names).not.toContain("computer");
  });

  it("is registered once a callback exists", () => {
    const names = buildAgentTools(withComputer()).map((tool) => tool.name);
    expect(names.filter((name) => name === "computer")).toHaveLength(1);
  });

  it("offers every verb in its schema description", () => {
    const tool = createComputerTool(withComputer());
    const action = (tool.parameters as { properties: { action: { description: string } } })
      .properties.action.description;

    for (const verb of COMPUTER_ACTIONS) {
      expect(action).toContain(verb);
    }
  });
});

describe("computer argument checks", () => {
  it("rejects a missing or unknown verb, and lists the ones that exist", () => {
    expect(computerArgsError(args({ action: "" }))).toMatch(/`action` is required/);
    const unknown = computerArgsError(args({ action: "teleport" }));
    expect(unknown).toMatch(/Unknown `action`: teleport/);
    expect(unknown).toContain("scroll");
  });

  it("rejects half a coordinate", () => {
    expect(computerArgsError(args({ action: "click", x: 10 }))).toMatch(/needs both `x` and `y`/);
  });

  it("wants a target for get_state, and accepts either kind", () => {
    expect(computerArgsError(args({ action: "get_state" }))).toMatch(
      /needs an `app` name or a `pid`/,
    );
    expect(computerArgsError(args({ action: "get_state", app: "Finder" }))).toBeNull();
    expect(computerArgsError(args({ action: "get_state", pid: 23196 }))).toBeNull();
  });

  it("wants the observation an element ref came from", () => {
    expect(computerArgsError(args({ action: "act", ref: 12 }))).toMatch(/needs the `state_id`/);
    expect(computerArgsError(args({ action: "act", state_id: "s1" }))).toMatch(/needs a `ref`/);
    expect(computerArgsError(args({ action: "act", state_id: "s1", ref: 12 }))).toBeNull();
    expect(
      computerArgsError(args({ action: "act", state_id: "s1", ref: 12, element_action: "poke" })),
    ).toMatch(/Unknown `element_action`/);
    expect(
      computerArgsError(
        args({ action: "act", state_id: "s1", ref: 12, element_action: "set_value" }),
      ),
    ).toMatch(/needs the `value` to write/);
  });

  it("wants something to work on for open_app", () => {
    expect(computerArgsError(args({ action: "open_app" }))).toMatch(
      /needs an `app` name, a `pid`, or a `path`/,
    );
    expect(
      computerArgsError(args({ action: "open_app", path: "/Applications/Finder.app" })),
    ).toBeNull();
  });

  it("wants a point read off a screenshot for click", () => {
    expect(computerArgsError(args({ action: "click" }))).toMatch(/read off your latest screenshot/);
    expect(computerArgsError(args({ action: "click", x: 1, y: 2 }))).toBeNull();
  });

  it("rejects a drag that is missing an end, or one that is too quick to be a drag", () => {
    const partial = computerArgsError(args({ action: "drag", from_x: 1, from_y: 2, to_x: 3 }));
    expect(partial).toMatch(/missing to_y/);
    expect(
      computerArgsError(args({ action: "drag", from_x: 1, from_y: 2, to_x: 3, to_y: 4 })),
    ).toBeNull();
    expect(
      computerArgsError(
        args({ action: "drag", from_x: 1, from_y: 2, to_x: 3, to_y: 4, duration_ms: 10 }),
      ),
    ).toMatch(/looks like a click/);
  });

  it("rejects modifiers that are not modifiers", () => {
    expect(
      computerArgsError(
        args({ action: "drag", from_x: 1, from_y: 2, to_x: 3, to_y: 4, modifiers: "banana" }),
      ),
    ).toMatch(/`modifiers` must be/);
    expect(
      computerArgsError(
        args({ action: "drag", from_x: 1, from_y: 2, to_x: 3, to_y: 4, modifiers: "cmd+shift" }),
      ),
    ).toBeNull();
  });

  it("wants a direction for scroll, and a positive distance", () => {
    expect(computerArgsError(args({ action: "scroll" }))).toMatch(/needs a `direction`/);
    expect(computerArgsError(args({ action: "scroll", direction: "sideways" }))).toMatch(
      /needs a `direction`/,
    );
    expect(computerArgsError(args({ action: "scroll", direction: "down" }))).toBeNull();
    expect(
      computerArgsError(args({ action: "scroll", direction: "down", unit: "furlongs" })),
    ).toMatch(/`unit` is `line`/);
    // The sign of the movement is the direction's job; a negative amount would just be confusing.
    expect(computerArgsError(args({ action: "scroll", direction: "down", amount: -3 }))).toMatch(
      /has to be positive/,
    );
  });

  it("wants text for the verbs that write it", () => {
    expect(computerArgsError(args({ action: "type" }))).toMatch(/needs the `text` to insert/);
    expect(computerArgsError(args({ action: "write_clipboard" }))).toMatch(/needs the `text`/);
    expect(computerArgsError(args({ action: "write_clipboard", text: "" }))).toBeNull();
  });

  it("accepts only the two typing strategies", () => {
    expect(computerArgsError(args({ action: "type", text: "hi", strategy: "paste" }))).toBeNull();
    expect(computerArgsError(args({ action: "type", text: "hi", strategy: "keys" }))).toBeNull();
    expect(computerArgsError(args({ action: "type", text: "hi", strategy: "telepathy" }))).toMatch(
      /`strategy` is `keys`/,
    );
  });

  it("wants a key for key", () => {
    expect(computerArgsError(args({ action: "key" }))).toMatch(/needs a `key`/);
    expect(computerArgsError(args({ action: "key", key: "cmd+a" }))).toBeNull();
  });

  it("asks for nothing extra on the reads", () => {
    for (const action of [
      "status",
      "request_access",
      "list_apps",
      "list_windows",
      "displays",
      "read_clipboard",
      "screenshot",
    ]) {
      expect(computerArgsError(args({ action }))).toBeNull();
    }
  });
});

describe("computer screenshots and vision", () => {
  const screenshotTool = (vision: boolean) => createComputerTool(withComputer(vision));

  it("refuses a screenshot for a model that cannot receive images", async () => {
    const tool = screenshotTool(false);
    const outcome = await tool.execute("call-1", args({ action: "screenshot" }));

    expect(JSON.stringify(outcome)).toMatch(/cannot receive images/);
    // Reading the same app as a tree is the workaround, and the error says so.
    expect(JSON.stringify(outcome)).toMatch(/`get_state` instead/);
  });

  it("passes a screenshot through when the model can see", async () => {
    const tool = screenshotTool(true);
    const outcome = await tool.execute("call-1", args({ action: "screenshot" }));

    expect(JSON.stringify(outcome)).toContain("ok");
  });

  it("does not block the other verbs for a text-only model", async () => {
    const tool = screenshotTool(false);
    const outcome = await tool.execute("call-1", args({ action: "get_state", app: "Finder" }));

    expect(JSON.stringify(outcome)).toContain("ok");
  });
});
