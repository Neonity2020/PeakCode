import { describe, expect, it } from "vitest";

import { buildAgentTools, buildReadOnlyTools } from "../agent-tools.ts";
import { BROWSER_ACTIONS, browserArgsError, createBrowserTool } from "../tools/browserTools.ts";
import { defaultRules, evaluate, permissionRequestForTool } from "../permissions.ts";
import type { BrowserToolParams, ToolContext } from "../tools/toolSupport.ts";

const workspace = "/tmp/ws";

/** A context that looks like a desktop session with a browser pane available. */
const withBrowser = (): ToolContext => ({
  workspace,
  allowShell: false,
  onBrowser: () => ({ content: [{ type: "text", text: "ok" }], details: {} }),
});

describe("browser tool registration", () => {
  it("is absent when the host injected no pane callback", () => {
    const names = buildAgentTools({ workspace, allowShell: false }).map((tool) => tool.name);
    expect(names).not.toContain("browser");
  });

  it("is registered once a pane callback exists", () => {
    const names = buildAgentTools(withBrowser()).map((tool) => tool.name);
    expect(names.filter((name) => name === "browser")).toHaveLength(1);
  });

  it("stays out of the read-only set plan mode is built from", () => {
    const names = buildReadOnlyTools(withBrowser()).map((tool) => tool.name);
    expect(names).not.toContain("browser");
  });
});

describe("browser argument validation", () => {
  const invalid = (params: BrowserToolParams) => browserArgsError(params);

  it("rejects a missing or unknown action", () => {
    expect(invalid({ action: "" })).toMatch(/action.*required/i);
    expect(invalid({ action: "teleport" })).toMatch(/Unknown .action./);
  });

  it("accepts every advertised action that needs no further arguments", () => {
    for (const action of BROWSER_ACTIONS) {
      const bare: BrowserToolParams = {
        action,
        // Actions with required fields are covered individually below.
        ...(action === "navigate" ? { url: "https://example.com" } : {}),
        ...(action === "select_tab" || action === "close_tab" ? { tab_id: 1 } : {}),
        ...(action === "click" || action === "hover" ? { ref: "e1" } : {}),
        ...(action === "type" ? { text: "hi" } : {}),
        ...(action === "press" ? { key: "Enter" } : {}),
        ...(action === "select_option" ? { ref: "e1", value: "a" } : {}),
        ...(action === "evaluate" ? { expression: "1" } : {}),
        ...(action === "wait_for" ? { condition: "true" } : {}),
      };
      expect(invalid(bare), `${action} should be satisfiable`).toBeNull();
    }
  });

  it("names the missing field for the actions that need one", () => {
    expect(invalid({ action: "navigate" })).toMatch(/needs a `url`/);
    expect(invalid({ action: "select_tab" })).toMatch(/needs a `tab_id`/);
    expect(invalid({ action: "type" })).toMatch(/needs the `text`/);
    expect(invalid({ action: "press" })).toMatch(/needs a `key`/);
    expect(invalid({ action: "evaluate" })).toMatch(/needs an `expression`/);
    expect(invalid({ action: "wait_for" })).toMatch(/needs a `condition`/);
  });

  it("requires both a ref and a value for select_option", () => {
    expect(invalid({ action: "select_option", value: "a" })).toMatch(/needs the `ref`/);
    expect(invalid({ action: "select_option", ref: "e1" })).toMatch(/needs the `value`/);
  });

  it("takes a ref or a full point, never half of one", () => {
    expect(invalid({ action: "click" })).toMatch(/needs a `ref`/);
    expect(invalid({ action: "click", x: 10 })).toMatch(/needs both `x` and `y`/);
    expect(invalid({ action: "click", x: 10, y: 20 })).toBeNull();
    expect(invalid({ action: "hover", ref: "e2" })).toBeNull();
  });

  it("lets scroll run without a target so the viewport centre can be used", () => {
    expect(invalid({ action: "scroll", delta_y: 400 })).toBeNull();
  });

  it("rejects an unknown mouse button", () => {
    expect(invalid({ action: "click", ref: "e1", button: "thumb" })).toMatch(
      /left, right or middle/,
    );
    expect(invalid({ action: "click", ref: "e1", button: "right" })).toBeNull();
  });
});

describe("browser tool execution", () => {
  it("forwards validated parameters to the host callback", async () => {
    const seen: BrowserToolParams[] = [];
    const tool = createBrowserTool({
      workspace,
      allowShell: false,
      onBrowser: (params) => {
        seen.push(params);
        return { content: [{ type: "text", text: "snapshot body" }], details: {} };
      },
    });

    const result = await tool.execute("call-1", { action: "snapshot" } as BrowserToolParams);

    expect(seen).toEqual([{ action: "snapshot" }]);
    expect(result.content[0]).toEqual({ type: "text", text: "snapshot body" });
  });

  it("answers instead of throwing when the session has no browser", async () => {
    const tool = createBrowserTool({ workspace, allowShell: false });
    const result = await tool.execute("call-1", { action: "snapshot" } as BrowserToolParams);
    expect(result.details.error).toMatch(/not available in this session/);
  });

  it("reports invalid arguments without reaching the host", async () => {
    let called = 0;
    const tool = createBrowserTool({
      workspace,
      allowShell: false,
      onBrowser: () => {
        called += 1;
        return { content: [{ type: "text", text: "ok" }], details: {} };
      },
    });

    const result = await tool.execute("call-1", { action: "navigate" } as BrowserToolParams);

    expect(called).toBe(0);
    expect(result.details.error).toMatch(/needs a `url`/);
  });

  it("refuses a screenshot for a model that cannot receive images", async () => {
    let called = 0;
    const tool = createBrowserTool({
      workspace,
      allowShell: false,
      vision: false,
      onBrowser: () => {
        called += 1;
        return { content: [{ type: "text", text: "ok" }], details: {} };
      },
    });

    const result = await tool.execute("call-1", { action: "screenshot" } as BrowserToolParams);

    expect(called).toBe(0);
    expect(result.details.error).toMatch(/cannot receive images/);
    // It has to point at the thing that does work without vision.
    expect(result.details.error).toMatch(/snapshot/);
  });

  it("allows a screenshot when the model can see images", async () => {
    const tool = createBrowserTool({
      workspace,
      allowShell: false,
      vision: true,
      onBrowser: () => ({
        content: [{ type: "image", data: "QUJD", mimeType: "image/jpeg" }],
        details: {},
      }),
    });

    const result = await tool.execute("call-1", { action: "screenshot" } as BrowserToolParams);

    expect(result.content[0]).toEqual({ type: "image", data: "QUJD", mimeType: "image/jpeg" });
  });
});

describe("browser approval", () => {
  /**
   * The toolkit layer is responsible for turning a call into a request and for the
   * built-in policy table; the host layer turns that into an actual prompt. Testing
   * both halves here keeps the approval shape from drifting without standing up the
   * server's approval host.
   */
  const decide = (args: Record<string, unknown>, mode: "smart" | "auto" | "strict" = "smart") => {
    const request = permissionRequestForTool({ toolName: "browser", args, workspace });
    if (!request) return null;
    const decision = evaluate(request, defaultRules(mode));
    return { request, action: decision.action };
  };

  it("keys navigation approval by origin, not by full URL", () => {
    const result = decide({ action: "navigate", url: "https://example.com/a/b?q=1" });
    expect(result?.request.permission).toBe("browsing");
    expect(result?.request.always).toEqual(["https://example.com"]);
  });

  it("asks before the first visit to a site in the default approval mode", () => {
    expect(decide({ action: "navigate", url: "http://localhost:5173/login" })?.action).toBe("ask");
  });

  it("opens a site without asking when the user opted out of approvals", () => {
    expect(decide({ action: "navigate", url: "https://example.com" }, "auto")?.action).toBe(
      "allow",
    );
    expect(decide({ action: "navigate", url: "https://example.com" }, "strict")?.action).toBe(
      "deny",
    );
  });

  it("does not prompt for a blank tab", () => {
    expect(decide({ action: "new_tab" })).toBeNull();
    expect(decide({ action: "new_tab", url: "about:blank" })).toBeNull();
  });

  it("prompts for page scripts under their own permission", () => {
    const result = decide({ action: "evaluate", expression: "document.cookie" });
    expect(result?.request.permission).toBe("browsing_script");
    expect(result?.request.always).toEqual(["*"]);
    // A script has no origin to key on, so it is never covered by a site approval.
    expect(result?.request.pattern).toBe("*");
  });

  it("does not prompt for in-page actions or observation", () => {
    for (const args of [
      { action: "snapshot" },
      { action: "screenshot" },
      { action: "click", ref: "e1" },
      { action: "type", ref: "e2", text: "hi" },
      { action: "scroll", delta_y: 100 },
      { action: "get_tabs" },
    ]) {
      expect(decide(args), `${args.action} should not prompt`).toBeNull();
    }
  });
});
