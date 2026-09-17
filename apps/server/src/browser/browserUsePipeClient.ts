/**
 * Client for the desktop's browser-use pipe.
 *
 * The desktop app hosts the in-app browser and serves a small JSON-RPC pipe over a unix
 * socket (a named pipe on Windows); this is the server's end of it. The wire shape is
 * defined once in `@peakcode/shared/browserUsePipe` so the two sides cannot drift.
 *
 * One connection per call, deliberately. Requests are small, the socket is local, and a
 * fresh connection means a crashed or restarted desktop cannot leave the server holding a
 * half-dead socket it has to detect and heal. Correlation by id still works, so a caller
 * can keep several calls in flight.
 */
import * as Net from "node:net";

import {
  BROWSER_USE_METHODS,
  decodeBrowserUseFrames,
  encodeBrowserUseFrame,
  type BrowserUseBrowserInfo,
  type BrowserUseCdpTarget,
  type BrowserUseExecuteCdpParams,
  type BrowserUseRpcResponse,
  type BrowserUseTabInfo,
} from "@peakcode/shared/browserUsePipe";

/** Default per-request timeout. A CDP round trip is local, so this is generous. */
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

/** The desktop may still be booting; a probe should not hang the turn waiting for it. */
const PROBE_TIMEOUT_MS = 2_000;

/**
 * Browser control is not reachable.
 *
 * Separate from a generic error so the tool layer can tell the model "this session has no
 * browser pane" without also telling it that the socket path does not exist — a syscall
 * error is noise the model cannot act on.
 */
export class BrowserUseUnavailableError extends Error {
  override readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "BrowserUseUnavailableError";
    this.cause = cause;
  }
}

/** Connect failures that mean "the desktop is not there", not "the request was bad". */
const UNAVAILABLE_CODES = new Set(["ENOENT", "ECONNREFUSED", "EPIPE", "ECONNRESET"]);

const isUnavailableCode = (error: unknown): boolean => {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return typeof code === "string" && UNAVAILABLE_CODES.has(code);
};

export interface BrowserUsePipeClientOptions {
  /** Socket path reported by the desktop through `PEAKCODE_BROWSER_USE_PIPE_PATH`. */
  pipePath: string;
  requestTimeoutMs?: number;
}

export class BrowserUsePipeClient {
  private readonly pipePath: string;
  private readonly requestTimeoutMs: number;
  /** Set once a probe succeeds; a desktop that answered is not going to start answering. */
  private provenAvailable = false;

  constructor(options: BrowserUsePipeClientOptions) {
    this.pipePath = options.pipePath;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  /**
   * One RPC.
   *
   * Throws {@link BrowserUseUnavailableError} when the pipe cannot be reached at all, and a
   * plain `Error` carrying the desktop's own message when the request itself was refused.
   */
  async call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    return (await this.request(method, params, this.requestTimeoutMs)) as T;
  }

  /**
   * Whether the desktop is answering.
   *
   * A successful probe is remembered for the process lifetime: the pipe either exists for
   * this session or it does not, and re-probing on every call would put a connect attempt
   * in front of every browser action. Failures are not cached — a desktop that is still
   * starting up should start working without a restart.
   */
  async isAvailable(): Promise<boolean> {
    if (this.provenAvailable) return true;
    try {
      await this.request(BROWSER_USE_METHODS.ping, {}, PROBE_TIMEOUT_MS);
      this.provenAvailable = true;
      return true;
    } catch {
      return false;
    }
  }

  getInfo(): Promise<BrowserUseBrowserInfo> {
    return this.call<BrowserUseBrowserInfo>(BROWSER_USE_METHODS.getInfo);
  }

  getTabs(sessionId: string): Promise<BrowserUseTabInfo[]> {
    return this.call<BrowserUseTabInfo[]>(BROWSER_USE_METHODS.getTabs, {
      session_id: sessionId,
    });
  }

  createTab(sessionId: string): Promise<BrowserUseTabInfo> {
    return this.call<BrowserUseTabInfo>(BROWSER_USE_METHODS.createTab, {
      session_id: sessionId,
    });
  }

  closeTab(sessionId: string, tabId: number): Promise<void> {
    return this.call<void>(BROWSER_USE_METHODS.closeTab, { session_id: sessionId, tabId });
  }

  /** Bind a tab to the session so later calls without a target land on it. */
  attach(sessionId: string, tabId: number): Promise<void> {
    return this.call<void>(BROWSER_USE_METHODS.attach, { session_id: sessionId, tabId });
  }

  /**
   * Run one CDP command.
   *
   * The target is nested under `target` here, unlike `attach` — that asymmetry is the
   * pipe's existing contract, kept as-is so the desktop side stays unchanged.
   */
  executeCdp(
    sessionId: string,
    method: string,
    commandParams: Record<string, unknown> | undefined,
    target?: BrowserUseCdpTarget,
  ): Promise<unknown> {
    const params: Record<string, unknown> & BrowserUseExecuteCdpParams = {
      session_id: sessionId,
      method,
      ...(commandParams === undefined ? {} : { commandParams }),
      ...(target === undefined ? {} : { target }),
    };
    return this.call<unknown>(BROWSER_USE_METHODS.executeCdp, params);
  }

  private request(
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<unknown> {
    const id = 1;
    return new Promise<unknown>((resolve, reject) => {
      let buffered: Buffer = Buffer.alloc(0);
      let settled = false;

      const socket = Net.createConnection(this.pipePath);
      socket.setTimeout(timeoutMs);

      const finish = (error: Error | null, value?: unknown): void => {
        if (settled) return;
        settled = true;
        socket.destroy();
        if (error) reject(error);
        else resolve(value);
      };

      const wrap = (error: unknown): Error =>
        isUnavailableCode(error)
          ? new BrowserUseUnavailableError(
              "Browser control is unavailable: the desktop browser pipe is not reachable.",
              error,
            )
          : new Error(error instanceof Error ? error.message : String(error));

      socket.on("connect", () => {
        socket.write(encodeBrowserUseFrame({ id, method, params }));
      });

      socket.on("data", (chunk) => {
        const decoded = decodeBrowserUseFrames(Buffer.concat([buffered, chunk]));
        if (!decoded) {
          finish(new Error("Browser pipe sent a frame larger than the protocol allows."));
          return;
        }
        buffered = decoded.remaining;
        for (const raw of decoded.messages) {
          let response: BrowserUseRpcResponse;
          try {
            response = JSON.parse(raw) as BrowserUseRpcResponse;
          } catch {
            finish(new Error("Browser pipe sent a response that was not JSON."));
            return;
          }
          if (response.id !== id) continue;
          if (response.error) {
            finish(new Error(response.error.message));
            return;
          }
          finish(null, response.result);
          return;
        }
      });

      socket.on("timeout", () => {
        finish(new Error(`Browser pipe request timed out after ${timeoutMs}ms: ${method}`));
      });
      socket.on("error", (error) => finish(wrap(error)));
      socket.on("close", () => {
        finish(
          new BrowserUseUnavailableError(
            "Browser pipe closed before returning a response. Is the desktop still running?",
          ),
        );
      });
    });
  }
}
