import { describe, expect, it } from "vitest";

import { WS_METHODS } from "./ws";
import { WsRpcError, WsRpcGroup } from "./rpc";

describe("WS RPC contracts", () => {
  it("exports the additive Effect RPC group", () => {
    expect(WsRpcGroup).toBeDefined();
  });

  it("uses a schema-backed transport error", () => {
    expect(new WsRpcError({ message: "failed" }).message).toBe("failed");
  });

  it("registers every WS method as an Rpc in the group", () => {
    // Every handler keyed off WS_METHODS in wsRpc.ts must have a matching
    // Rpc.make entry, otherwise the server crashes at startup with
    // "Cannot read properties of undefined (reading 'key')".
    // projects.list/add/remove are HTTP/native-only and
    // git.subscribeActionProgress is delivered through the desktop event bus;
    // none of them have an effect Rpc entry.
    const nonRpcMethods = new Set([
      "projects.list",
      "projects.add",
      "projects.remove",
      "git.subscribeActionProgress",
    ]);
    const registeredTags = new Set(Array.from(WsRpcGroup.requests.keys(), (tag) => String(tag)));
    for (const [key, method] of Object.entries(WS_METHODS)) {
      if (nonRpcMethods.has(method)) continue;
      expect(
        registeredTags.has(method),
        `WS method ${key} ("${method}") is missing an Rpc.make entry`,
      ).toBe(true);
    }
  });
});
