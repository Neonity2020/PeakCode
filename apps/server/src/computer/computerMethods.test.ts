// FILE: computerMethods.test.ts
// Purpose: Holds the three places that have to agree about `computer` to each other — the tool's
//          action list, the wire contract, and the native helper's dispatch table.
// Layer: Server computer-use contract tests
//
// They are written in three languages and in three packages, so nothing in the type system ties
// them together: an action added to the tool but not to the helper is a verb the model can call
// and the desktop answers "unknown method" to, and a method the helper serves but the tool never
// offers is dead code nobody notices. Reading the helper's own source is the only way to check the
// last of the three, and it is a plain string match on purpose — a parsing library would be more
// code than the thing it checks.

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { COMPUTER_ACTIONS } from "@peakcode/agent-toolkit/agent-tools";
import { COMPUTER_USE_METHODS } from "@peakcode/shared/computerUse";

const helperSource = readFileSync(
  new URL("../../../desktop/native/computer-use/main.m", import.meta.url),
  "utf8",
);

/** Every method the helper's dispatch chain knows how to answer. */
function helperMethods(): string[] {
  const dispatch = helperSource.slice(
    helperSource.indexOf("static NSDictionary *DispatchUnprotected"),
  );
  const matches = dispatch.matchAll(/\[method isEqualToString:@"([a-z_]+)"\]/g);
  return [...matches].map((match) => match[1] ?? "").toSorted();
}

describe("the computer tool's verbs", () => {
  it("are the same set in the tool and on the wire", () => {
    expect([...COMPUTER_ACTIONS].toSorted()).toEqual(
      Object.values(COMPUTER_USE_METHODS).toSorted(),
    );
  });

  it("are the same set on the wire and in the helper", () => {
    expect(helperMethods()).toEqual(Object.values(COMPUTER_USE_METHODS).toSorted());
  });

  it("keeps every method snake_case, which is what the helper matches on", () => {
    for (const method of Object.values(COMPUTER_USE_METHODS)) {
      expect(method).toMatch(/^[a-z][a-z_]*$/);
    }
  });

  it("names the helper's dispatch the way the platform's own API does", () => {
    // The helper is a small ObjC program and its dispatch chain is the only index of what it can
    // do; if it stops matching this pattern the test above silently checks nothing.
    expect(helperMethods().length).toBeGreaterThan(10);
    expect(helperSource).toContain("HandleScreenshot");
  });
});
