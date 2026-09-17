// FILE: computerUseClient.ts
// Purpose: Dials the native computer-use helper's socket and answers requests on it.
// Layer: Server computer-use transport
// Depends on: node:net/fs, the shared computer-use contract
//
// The helper is started by the desktop app, not by this process, and it may or may not be
// running when the first tool call arrives. So the client owns reconnection: it dials
// lazily, retries a refused connection, and reports an unavailable helper as a state the
// model can be told about rather than as a thrown error.

import * as FS from "node:fs";
import * as Net from "node:net";

import {
  COMPUTER_USE_MAX_LINE_BYTES,
  COMPUTER_USE_METHODS,
  COMPUTER_USE_PROTOCOL_VERSION,
  decodeComputerUseMessages,
  encodeComputerUseMessage,
  resolveComputerUseSocketPath,
  resolveComputerUseTokenPath,
  type ComputerUseMethod,
  type ComputerUseResponse,
} from "@peakcode/shared/computerUse";

/** Per-call ceiling. The helper bounds its own accessibility walk, so anything approaching
 *  this is a helper that has stopped answering rather than a slow scan. */
const CALL_TIMEOUT_MS = 30_000;

/** How long to wait for the helper's socket after the desktop app says it started one. */
const CONNECT_TIMEOUT_MS = 5_000;
const CONNECT_POLL_MS = 150;

/** Raised when the helper is not reachable at all, so callers can say that plainly instead
 *  of reporting a failed action. */
export class ComputerUseUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ComputerUseUnavailableError";
  }
}

/** Raised when the helper answered with an error. `code` is the contract's error code, so
 *  callers can distinguish a denied permission from a stale ref. */
export class ComputerUseRequestError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ComputerUseRequestError";
    this.code = code;
  }
}

type PendingCall = {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout;
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class ComputerUseClient {
  private socket: Net.Socket | null = null;
  private connecting: Promise<void> | null = null;
  private buffer = "";
  private nextId = 1;
  private readonly pending = new Map<number, PendingCall>();
  private readonly socketPath: string;
  private readonly tokenPath: string;
  private readonly callTimeoutMs: number;
  private readonly connectTimeoutMs: number;
  private readonly connectPollMs: number;

  constructor(
    options: {
      socketPath?: string;
      tokenPath?: string;
      /** Overridable so a test can exercise the failure paths without waiting 30s for them. */
      callTimeoutMs?: number;
      connectTimeoutMs?: number;
      connectPollMs?: number;
    } = {},
  ) {
    this.socketPath = options.socketPath ?? resolveComputerUseSocketPath();
    this.tokenPath = options.tokenPath ?? resolveComputerUseTokenPath();
    this.callTimeoutMs = options.callTimeoutMs ?? CALL_TIMEOUT_MS;
    this.connectTimeoutMs = options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS;
    this.connectPollMs = options.connectPollMs ?? CONNECT_POLL_MS;
  }

  /** Whether the helper's socket exists at all. A socket file with nothing behind it still
   *  exists after a crash, so this is a cheap pre-filter, not proof of liveness. */
  private socketExists(): boolean {
    try {
      return FS.statSync(this.socketPath).isSocket();
    } catch {
      return false;
    }
  }

  private readToken(): string {
    let token: string;
    try {
      token = FS.readFileSync(this.tokenPath, "utf8").trim();
    } catch {
      throw new ComputerUseUnavailableError(
        "The computer-use helper's token file is missing. It is created by the desktop app when the helper is installed.",
      );
    }
    if (!token) {
      throw new ComputerUseUnavailableError("The computer-use helper's token file is empty.");
    }
    return token;
  }

  private attach(socket: Net.Socket): void {
    this.socket = socket;

    socket.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString("utf8");
      if (this.buffer.length > COMPUTER_USE_MAX_LINE_BYTES) {
        // A peer that never sends a newline is a broken peer; drop it rather than growing.
        this.buffer = "";
        this.dropConnection(new Error("the computer-use helper sent an oversized reply"));
        return;
      }
      this.drain();
    });

    socket.on("error", (error: Error) => {
      this.dropConnection(error);
    });

    socket.on("close", () => {
      this.dropConnection(new Error("the computer-use helper closed the connection"));
    });
  }

  private drain(): void {
    const { messages, rest } = decodeComputerUseMessages(this.buffer);
    this.buffer = rest;

    for (const message of messages) {
      const id = typeof message.id === "number" ? message.id : null;
      if (id === null) {
        continue;
      }
      const pending = this.pending.get(id);
      if (!pending) {
        continue;
      }
      this.pending.delete(id);
      clearTimeout(pending.timer);

      if (message.error) {
        pending.reject(new ComputerUseRequestError(message.error.code, message.error.message));
      } else {
        pending.resolve(message.result);
      }
    }
  }

  /** Fail every in-flight call. A helper that restarted mid-call will not answer them. */
  private dropConnection(error: Error): void {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.destroy();
      this.socket = null;
    }
    this.buffer = "";

    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new ComputerUseUnavailableError(error.message));
    }
    this.pending.clear();
  }

  private async connectOnce(): Promise<void> {
    // Read the token before dialing so a missing or empty file is reported as that, rather
    // than as a connection that mysteriously gets refused.
    const token = this.readToken();
    if (!token) {
      throw new ComputerUseUnavailableError("The computer-use helper's token file is empty.");
    }

    await new Promise<void>((resolve, reject) => {
      const socket = Net.createConnection(this.socketPath);
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new ComputerUseUnavailableError("Timed out connecting to the computer-use helper."));
      }, this.connectTimeoutMs);

      socket.once("connect", () => {
        clearTimeout(timer);
        this.attach(socket);
        // The token is checked per request, so a wrong or rotated token shows up as an
        // `unauthorized` error on the first call rather than as a connection failure.
        resolve();
      });
      socket.once("error", (error: Error) => {
        clearTimeout(timer);
        socket.destroy();
        reject(new ComputerUseUnavailableError(error.message));
      });
    });
  }

  /**
   * Connect, waiting for a helper that is starting up.
   *
   * The desktop app launches the helper through LaunchServices, which returns before the
   * helper has bound its socket. So a refused connection right after a launch is expected,
   * and this polls rather than failing on the first attempt.
   */
  private async ensureConnected(): Promise<void> {
    if (this.socket && !this.socket.destroyed) {
      return;
    }
    if (this.connecting) {
      return this.connecting;
    }

    this.connecting = (async () => {
      const deadline = Date.now() + this.connectTimeoutMs;
      let lastError: Error | null = null;

      while (Date.now() < deadline) {
        if (this.socketExists()) {
          try {
            await this.connectOnce();
            return;
          } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
          }
        }
        await delay(this.connectPollMs);
      }

      throw new ComputerUseUnavailableError(
        lastError
          ? `The computer-use helper is not running (${lastError.message}).`
          : "The computer-use helper is not running. Start the Peak Code desktop app to install and launch it.",
      );
    })();

    try {
      await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  /**
   * Make one request. Connects first if needed.
   *
   * A request is sent once, and only once. Reconnecting is safe — the client dials lazily and
   * retries a refused connection — but re-*sending* is not: a call that was delivered and then
   * lost its answer may well have been executed, and repeating a click or a keystroke is worse
   * than reporting that the helper went away. Callers see an unavailable error, and the next
   * call, the one that is not racing the helper's death, reconnects and works.
   */
  async call(method: ComputerUseMethod, params: Record<string, unknown> = {}): Promise<unknown> {
    await this.ensureConnected();

    const socket = this.socket;
    if (!socket) {
      throw new ComputerUseUnavailableError("The computer-use helper is not reachable.");
    }

    const token = this.readToken();
    const id = this.nextId++;

    const promise = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new ComputerUseRequestError(
            "timeout",
            `The computer-use helper did not answer \`${method}\` within ${this.callTimeoutMs / 1000}s.`,
          ),
        );
      }, this.callTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });

    socket.write(encodeComputerUseMessage({ id, method, token, params }));
    return promise;
  }

  /**
   * Capability report, or null when the helper is not reachable.
   *
   * Used to decide whether the tool is offered at all, so it answers rather than throws.
   */
  async statusOrNull(): Promise<{
    accessibility: boolean;
    screenRecording: boolean;
    protocolVersion: number;
    helperVersion: string;
    helperPath: string;
  } | null> {
    try {
      const result = (await this.call(COMPUTER_USE_METHODS.status)) as Record<string, unknown>;
      const protocolVersion = Number(result.protocolVersion ?? 0);
      // Only an *older* helper is refused. Every version so far has been additive — new verbs,
      // same shapes — so a newer helper answers everything this build knows how to ask and the
      // extra verbs simply go uncalled. Refusing it the other way round would make a perfectly
      // ordinary state (an older server build beside a helper that was just rebuilt from a
      // checkout) look like a fault, and the advice for that fault is "restart the app", which is
      // what produced the mismatch.
      if (protocolVersion < COMPUTER_USE_PROTOCOL_VERSION) {
        throw new ComputerUseRequestError(
          "protocol_mismatch",
          `The computer-use helper speaks protocol ${protocolVersion}, and this build needs at least ${COMPUTER_USE_PROTOCOL_VERSION}. It is left over from an older install: restart the desktop app, which reinstalls and relaunches it.`,
        );
      }
      return {
        accessibility: result.accessibility === true,
        screenRecording: result.screenRecording === true,
        protocolVersion,
        helperVersion: String(result.helperVersion ?? ""),
        helperPath: String(result.helperPath ?? ""),
      };
    } catch (error) {
      if (error instanceof ComputerUseUnavailableError) {
        return null;
      }
      throw error;
    }
  }

  /** Close the connection without ending the helper: it is a separate app and outlives us. */
  close(): void {
    this.dropConnection(new Error("client closed"));
  }
}

/** A client per server process is enough; the helper multiplexes connections anyway. */
export function createComputerUseClient(): ComputerUseClient {
  return new ComputerUseClient();
}

export type { ComputerUseResponse };
