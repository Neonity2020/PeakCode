import { homedir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  COMPUTER_USE_BUNDLED_HELPER_DIR_NAME,
  COMPUTER_USE_HELPER_APP_NAME,
  COMPUTER_USE_MAX_LINE_BYTES,
  PEAKCODE_COMPUTER_USE_HELPER_ENV,
  PEAKCODE_COMPUTER_USE_SOCKET_ENV,
  decodeComputerUseMessages,
  encodeComputerUseMessage,
  resolveComputerUseDir,
  resolveComputerUseHelperPath,
  resolveComputerUseSocketPath,
  resolveComputerUseTokenPath,
} from "./computerUse";

describe("computer-use path resolution", () => {
  it("keeps the helper in one fixed place on macOS", () => {
    // Not versioned and not per-process: the Accessibility grant is pinned to the helper's
    // signed identity, and a path that moved would invalidate it.
    expect(resolveComputerUseDir({}, "darwin")).toBe(
      join(homedir(), "Library", "Application Support", "peakcode", "computer-use"),
    );
  });

  it("follows each platform's convention elsewhere", () => {
    expect(resolveComputerUseDir({ XDG_DATA_HOME: "/data" }, "linux")).toBe(
      "/data/peakcode/computer-use",
    );
    expect(resolveComputerUseDir({}, "linux")).toBe(
      join(homedir(), ".local", "share", "peakcode", "computer-use"),
    );
    expect(resolveComputerUseDir({ LOCALAPPDATA: "/local" }, "win32")).toBe(
      "/local/peakcode/computer-use",
    );
  });

  it("lets the whole directory be moved, for an isolated run", () => {
    expect(resolveComputerUseDir({ PEAKCODE_COMPUTER_USE_DIR: "/isolated" }, "darwin")).toBe(
      "/isolated",
    );
  });

  it("puts the bundle, the socket and the token beside each other", () => {
    const directory = resolveComputerUseDir({});
    expect(resolveComputerUseHelperPath({})).toBe(join(directory, COMPUTER_USE_HELPER_APP_NAME));
    expect(resolveComputerUseSocketPath({})).toBe(join(directory, "helper.sock"));
    expect(resolveComputerUseTokenPath({})).toBe(join(directory, "helper.token"));
  });

  it("lets the helper and the socket be pointed elsewhere individually", () => {
    expect(
      resolveComputerUseHelperPath({ [PEAKCODE_COMPUTER_USE_HELPER_ENV]: "/tmp/Helper.app" }),
    ).toBe("/tmp/Helper.app");
    expect(
      resolveComputerUseSocketPath({ [PEAKCODE_COMPUTER_USE_SOCKET_ENV]: "/tmp/helper.sock" }),
    ).toBe("/tmp/helper.sock");
  });

  it("names the directory the packaging step ships the helper in", () => {
    expect(COMPUTER_USE_BUNDLED_HELPER_DIR_NAME).toBe("computer-use");
  });
});

describe("computer-use line framing", () => {
  const roundTrip = (message: unknown) =>
    decodeComputerUseMessages(encodeComputerUseMessage(message as never)).messages;

  it("ends every message with exactly one newline", () => {
    expect(encodeComputerUseMessage({ id: 1, method: "status" })).toBe(
      '{"id":1,"method":"status"}\n',
    );
  });

  it("round-trips a request and a response", () => {
    expect(
      roundTrip({ id: 7, method: "get_state", token: "t", params: { app: "Finder" } }),
    ).toEqual([{ id: 7, method: "get_state", token: "t", params: { app: "Finder" } }]);
    expect(roundTrip({ id: 7, result: { stateId: "s1", text: "…" } })).toEqual([
      { id: 7, result: { stateId: "s1", text: "…" } },
    ]);
  });

  it("round-trips an error code the caller is meant to distinguish", () => {
    expect(roundTrip({ id: 2, error: { code: "stale_ref", message: "ref 12 is gone" } })).toEqual([
      { id: 2, error: { code: "stale_ref", message: "ref 12 is gone" } },
    ]);
  });

  it("keeps a partial line for the next chunk instead of parsing it", () => {
    const first = decodeComputerUseMessages('{"id":1,"resu');
    expect(first).toEqual({ messages: [], rest: '{"id":1,"resu' });

    const second = decodeComputerUseMessages(`${first.rest}lt":"ok"}\n`);
    expect(second.messages).toEqual([{ id: 1, result: "ok" }]);
    expect(second.rest).toBe("");
  });

  it("splits several messages that arrived in one chunk", () => {
    const decoded = decodeComputerUseMessages('{"id":1,"result":1}\n{"id":2,"result":2}\n');
    expect(decoded.messages.map((message) => message.id)).toEqual([1, 2]);
    expect(decoded.rest).toBe("");
  });

  it("skips a malformed line without dropping its neighbours", () => {
    // The peer's bug, not a reason to lose the answers around it: the caller sees the missing
    // id as a timeout, which is a state it already handles.
    const decoded = decodeComputerUseMessages(
      '{"id":1,"result":1}\nnot json at all\n{"id":2,"result":2}\n',
    );
    expect(decoded.messages.map((message) => message.id)).toEqual([1, 2]);
  });

  it("ignores blank lines between messages", () => {
    expect(decodeComputerUseMessages('\n{"id":1,"result":1}\n\n').messages).toEqual([
      { id: 1, result: 1 },
    ]);
  });

  it("returns nothing when there is no complete line yet", () => {
    expect(decodeComputerUseMessages("")).toEqual({ messages: [], rest: "" });
    expect(decodeComputerUseMessages('{"id":1}')).toEqual({ messages: [], rest: '{"id":1}' });
  });

  it("bounds one line generously enough for an accessibility dump", () => {
    // A dense window is the largest thing this protocol carries, and it is text.
    expect(COMPUTER_USE_MAX_LINE_BYTES).toBe(4 * 1024 * 1024);
  });
});
