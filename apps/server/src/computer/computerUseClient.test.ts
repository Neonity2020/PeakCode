import * as FS from "node:fs";
import * as Net from "node:net";
import * as OS from "node:os";
import * as Path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  COMPUTER_USE_ERROR_CODES,
  COMPUTER_USE_MAX_LINE_BYTES,
  COMPUTER_USE_METHODS,
  COMPUTER_USE_PROTOCOL_VERSION,
  decodeComputerUseMessages,
  encodeComputerUseMessage,
} from "@peakcode/shared/computerUse";

import {
  ComputerUseClient,
  ComputerUseRequestError,
  ComputerUseUnavailableError,
} from "./computerUseClient.ts";

type Reply =
  | { readonly result: unknown }
  | { readonly error: { readonly code: string; readonly message: string } }
  | undefined;

type Handler = (
  request: {
    readonly id: number;
    readonly method: string;
    readonly token?: string;
    readonly params: Record<string, unknown>;
  },
  socket: Net.Socket,
) => Reply;

/** Everything a test starts gets closed, in reverse, whatever the test did to it. */
const closers: (() => void | Promise<void>)[] = [];

function onCleanup(close: () => void | Promise<void>): void {
  closers.push(close);
}

afterEach(async () => {
  for (const close of closers.splice(0).toReversed()) {
    await close();
  }
});

const STATUS_OK: Reply = {
  result: {
    accessibility: true,
    screenRecording: true,
    protocolVersion: COMPUTER_USE_PROTOCOL_VERSION,
    helperVersion: "1.0.0",
    helperPath: "/tmp/Peak Code Computer Use.app",
  },
};

/**
 * A stand-in helper: a real unix socket speaking the real line framing.
 *
 * The client's job is transport, so the test drives it over an actual socket rather than a
 * stub — that is the only way to cover a refused connection, a peer that never answers, and a
 * reply that arrives in pieces.
 */
async function startHelper(
  handler: Handler,
  options: {
    readonly token?: string | null;
    readonly listenAfterMs?: number;
    /** Reuse a previous helper's paths, for a test that restarts one in place. */
    readonly directory?: string;
  } = {},
) {
  const directory =
    options.directory ?? FS.mkdtempSync(Path.join(OS.tmpdir(), "peakcode-cua-client-"));
  const socketPath = Path.join(directory, "helper.sock");
  const tokenPath = Path.join(directory, "helper.token");
  if (options.token !== null) {
    FS.writeFileSync(tokenPath, `${options.token ?? "test-token"}\n`, { mode: 0o600 });
  }

  const sockets = new Set<Net.Socket>();
  const server = Net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());

    let buffered = "";
    socket.on("data", (chunk) => {
      buffered += chunk.toString("utf8");
      const { messages, rest } = decodeComputerUseMessages(buffered);
      buffered = rest;
      for (const message of messages) {
        const request = message as unknown as {
          id: number;
          method: string;
          token?: string;
          params?: Record<string, unknown>;
        };
        const reply = handler(
          {
            id: request.id,
            method: request.method,
            ...(request.token === undefined ? {} : { token: request.token }),
            params: request.params ?? {},
          },
          socket,
        );
        if (reply) {
          socket.write(encodeComputerUseMessage({ id: request.id, ...reply }));
        }
      }
    });
  });

  const listening = new Promise<void>((resolve) => {
    const listen = () => server.listen(socketPath, resolve);
    if (options.listenAfterMs === undefined) {
      listen();
    } else {
      setTimeout(listen, options.listenAfterMs);
    }
  });
  onCleanup(() => listening);

  onCleanup(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    FS.rmSync(directory, { recursive: true, force: true });
  });

  return { socketPath, tokenPath, directory, server, sockets };
}

/** A client that is always closed at the end of the test. */
function makeClient(options: ConstructorParameters<typeof ComputerUseClient>[0]) {
  const client = new ComputerUseClient(options);
  onCleanup(() => {
    client.close();
  });
  return client;
}

describe("computer-use client", () => {
  it("sends a method, presents the token, and returns the result", async () => {
    const seen: {
      method: string;
      token?: string | undefined;
      params: Record<string, unknown>;
    }[] = [];
    const { socketPath, tokenPath } = await startHelper(
      (request) => {
        seen.push({ method: request.method, token: request.token, params: request.params });
        return { result: "pong" };
      },
      { token: "test-token" },
    );

    const client = makeClient({ socketPath, tokenPath });
    await expect(client.call(COMPUTER_USE_METHODS.status)).resolves.toBe("pong");
    expect(seen).toEqual([
      { method: COMPUTER_USE_METHODS.status, token: "test-token", params: {} },
    ]);
  });

  it("surfaces the helper's error code, not only its message", async () => {
    const { socketPath, tokenPath } = await startHelper(() => ({
      error: { code: COMPUTER_USE_ERROR_CODES.staleRef, message: "ref 12 is gone" },
    }));

    const client = makeClient({ socketPath, tokenPath });
    const failure = await client.call(COMPUTER_USE_METHODS.act).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ComputerUseRequestError);
    expect((failure as ComputerUseRequestError).code).toBe(COMPUTER_USE_ERROR_CODES.staleRef);
    expect((failure as Error).message).toBe("ref 12 is gone");
  });

  it("matches a reply to its request, not to the order replies arrive in", async () => {
    const { socketPath, tokenPath } = await startHelper((request) => ({
      result: request.method === COMPUTER_USE_METHODS.status ? "status" : "apps",
    }));

    const client = makeClient({ socketPath, tokenPath });
    // Both are in flight before either is answered; a client that matched by arrival order
    // would hand each call the other's result.
    const [status, apps] = await Promise.all([
      client.call(COMPUTER_USE_METHODS.status),
      client.call(COMPUTER_USE_METHODS.listApps),
    ]);

    expect(status).toBe("status");
    expect(apps).toBe("apps");
  });

  it("waits for a helper that is still starting up", async () => {
    // LaunchServices returns before the helper has bound its socket, so a refused connection
    // right after a launch is the normal case, not a failure.
    const { socketPath, tokenPath } = await startHelper(
      (request) => ({ result: `up:${request.id}` }),
      { listenAfterMs: 80 },
    );

    const client = makeClient({
      socketPath,
      tokenPath,
      connectTimeoutMs: 2_000,
      connectPollMs: 20,
      callTimeoutMs: 2_000,
    });

    await expect(client.call(COMPUTER_USE_METHODS.status)).resolves.toBe("up:1");
  });

  it("gives up when no helper appears, and says so plainly", async () => {
    const { directory } = await startHelper(() => undefined); // throws away the helper
    const client = makeClient({
      socketPath: Path.join(directory, "nowhere.sock"),
      tokenPath: Path.join(directory, "helper.token"),
      connectTimeoutMs: 60,
      connectPollMs: 10,
    });

    await expect(client.call(COMPUTER_USE_METHODS.status)).rejects.toThrow(/is not running/);
    await expect(client.statusOrNull()).resolves.toBeNull();
  });

  it("reports a missing token as that, rather than as a helper that will not answer", async () => {
    // The token is read before dialing: an install that is half-finished should not look like a
    // helper that is refusing connections.
    const server = await startHelper(() => undefined, { token: null });
    const client = makeClient({
      socketPath: server.socketPath,
      tokenPath: server.tokenPath,
      // The client keeps retrying for the whole connect window, because the window between the
      // app writing the token and launching the helper is a real one. The test only needs to be
      // told the reason, not to wait out the default 5s.
      connectTimeoutMs: 60,
      connectPollMs: 10,
    });

    await expect(client.call(COMPUTER_USE_METHODS.status)).rejects.toThrow(/token file is missing/);
  });

  it("treats a peer that never answers as a timeout rather than hanging", async () => {
    const { socketPath, tokenPath } = await startHelper(() => undefined);

    const client = makeClient({ socketPath, tokenPath, callTimeoutMs: 50 });
    const failure = await client
      .call(COMPUTER_USE_METHODS.getState)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ComputerUseRequestError);
    expect((failure as ComputerUseRequestError).code).toBe("timeout");
    expect((failure as Error).message).toMatch(/did not answer/);
  });

  it("reassembles a reply that arrives in pieces", async () => {
    const { socketPath, tokenPath } = await startHelper((request, socket) => {
      const line = encodeComputerUseMessage({
        id: request.id,
        result: { text: "a tree long enough that splitting it is worth the trouble" },
      });
      // One byte at a time, over the encoded bytes rather than the string: the worst case the
      // client has to reassemble.
      for (const byte of Buffer.from(line)) socket.write(Buffer.from([byte]));
      return undefined;
    });

    const client = makeClient({ socketPath, tokenPath, callTimeoutMs: 2_000 });
    await expect(client.call(COMPUTER_USE_METHODS.getState)).resolves.toEqual({
      text: "a tree long enough that splitting it is worth the trouble",
    });
  });

  it("fails a call in flight when the helper goes away", async () => {
    const { socketPath, tokenPath, server, sockets } = await startHelper(() => undefined);
    const client = makeClient({ socketPath, tokenPath, callTimeoutMs: 5_000 });

    const pending = client.call(COMPUTER_USE_METHODS.getState);
    await new Promise((resolve) => setTimeout(resolve, 30));
    for (const socket of sockets) socket.destroy();
    server.close();
    onCleanup(() => undefined); // the helper's own cleanup already closed it

    await expect(pending).rejects.toBeInstanceOf(ComputerUseUnavailableError);
  });

  it("drops an oversized reply instead of buffering it forever", async () => {
    // A peer that never sends a newline is a broken peer. The client is bounded, so it drops
    // the connection rather than growing a buffer until the process dies.
    const { socketPath, tokenPath } = await startHelper((_request, socket) => {
      socket.write("x".repeat(COMPUTER_USE_MAX_LINE_BYTES + 1024));
      return undefined;
    });

    const client = makeClient({ socketPath, tokenPath, callTimeoutMs: 5_000 });
    await expect(client.call(COMPUTER_USE_METHODS.getState)).rejects.toThrow(/oversized reply/);
  });

  it("re-dials the same socket after the helper restarts", async () => {
    // The helper can be replaced underneath a running client: a grant change and an app update
    // both end with a new process on the same socket path, and the client has to reach it
    // without being restarted itself.
    const first = await startHelper((request) => ({ result: `first:${request.id}` }));
    const client = makeClient({
      socketPath: first.socketPath,
      tokenPath: first.tokenPath,
      connectTimeoutMs: 2_000,
      connectPollMs: 20,
      callTimeoutMs: 2_000,
    });
    await expect(client.call(COMPUTER_USE_METHODS.status)).resolves.toBe("first:1");

    for (const socket of first.sockets) socket.destroy();
    await new Promise<void>((resolve) => first.server.close(() => resolve()));
    FS.rmSync(first.socketPath, { force: true });

    await startHelper((request) => ({ result: `second:${request.id}` }), {
      directory: first.directory,
    });
    // Let the client see its socket close first. A call that *races* the helper's death is
    // reported as unavailable rather than retried — deliberately: the client cannot tell a
    // request that never left from one that was delivered and lost its answer, and repeating a
    // click is worse than reporting a failure. The next call is the one that has to work.
    await new Promise((resolve) => setTimeout(resolve, 20));

    await expect(client.call(COMPUTER_USE_METHODS.status)).resolves.toBe("second:2");
  });
});

describe("computer-use status probe", () => {
  it("reports the two grants and the version", async () => {
    const { socketPath, tokenPath } = await startHelper(() => STATUS_OK);
    const client = makeClient({ socketPath, tokenPath });

    await expect(client.statusOrNull()).resolves.toEqual({
      accessibility: true,
      screenRecording: true,
      protocolVersion: COMPUTER_USE_PROTOCOL_VERSION,
      helperVersion: "1.0.0",
      helperPath: "/tmp/Peak Code Computer Use.app",
    });
  });

  it("refuses a helper older than the verbs this build calls", async () => {
    // An older helper would answer "unknown method" for a verb the caller knows exists, so this is
    // an error the caller has to see — not a null that reads as "no helper".
    const { socketPath, tokenPath } = await startHelper(() => ({
      result: {
        ...(STATUS_OK as { result: object }).result,
        protocolVersion: COMPUTER_USE_PROTOCOL_VERSION - 1,
      },
    }));
    const client = makeClient({ socketPath, tokenPath });

    const failure = await client.statusOrNull().catch((error: unknown) => error);
    expect((failure as ComputerUseRequestError).code).toBe(
      COMPUTER_USE_ERROR_CODES.protocolMismatch,
    );
  });

  it("accepts a helper newer than this build", async () => {
    // The other direction is an ordinary state, not a fault: a helper rebuilt from a checkout
    // beside a server built earlier. The extra verbs simply go uncalled.
    const { socketPath, tokenPath } = await startHelper(() => ({
      result: {
        ...(STATUS_OK as { result: object }).result,
        protocolVersion: COMPUTER_USE_PROTOCOL_VERSION + 1,
      },
    }));
    const client = makeClient({ socketPath, tokenPath });

    await expect(client.statusOrNull()).resolves.toMatchObject({
      protocolVersion: COMPUTER_USE_PROTOCOL_VERSION + 1,
    });
  });

  it("reads a status the helper answered with nothing in it", async () => {
    const { socketPath, tokenPath } = await startHelper(() => ({
      result: { protocolVersion: COMPUTER_USE_PROTOCOL_VERSION },
    }));
    const client = makeClient({ socketPath, tokenPath });

    await expect(client.statusOrNull()).resolves.toMatchObject({
      accessibility: false,
      screenRecording: false,
      helperVersion: "",
    });
  });
});
