import { spawn, type ChildProcess } from "node:child_process";

import type { ImRemoteAccessSettings, ImRemoteAccessStatus } from "@peakcode/contracts";

import { errorMessageOf } from "./types.ts";

/**
 * Cloudflare quick tunnel: the public door for the phone.
 *
 * `cloudflared tunnel --url http://127.0.0.1:<port>` dials out to Cloudflare and prints a
 * `https://<random-words>.trycloudflare.com` address that forwards back to this server's
 * port — no account, no DNS record, no port forwarding. That is exactly what a phone on
 * mobile data needs, and why the QR code hands out the tunnel URL rather than a LAN one.
 *
 * The address is public: anyone who learns it reaches the same authentication wall a LAN
 * client does, which is why the server only publishes itself when it actually requires
 * authentication (checked by the bridge, not here).
 */

const URL_PATTERN = /https:\/\/[a-z0-9][a-z0-9-]*\.trycloudflare\.com/i;
const START_TIMEOUT_MS = 30_000;
const STOP_GRACE_MS = 3_000;
/** cloudflared's own chatter, kept short: only recent lines are useful in an error. */
const OUTPUT_TAIL_LINES = 6;

export interface CloudflareTunnelOptions {
  readonly getSettings: () => ImRemoteAccessSettings;
  /** Local port the tunnel forwards to. */
  readonly port: number;
  /** Called once with the assigned URL, so the caller can remember it. */
  readonly onUrl: (url: string) => void;
  readonly log?: (level: "info" | "warn" | "error", text: string) => void;
}

export interface CloudflareTunnel {
  readonly start: (force?: boolean) => Promise<ImRemoteAccessStatus>;
  readonly stop: () => Promise<void>;
  readonly status: () => ImRemoteAccessStatus;
  /** Whether a quick-tunnel binary can be found and run at all. */
  readonly probe: () => Promise<void>;
}

/** The URL inside a chunk of cloudflared output, or null while there is none yet. */
export function extractTunnelUrl(output: string): string | null {
  const match = output.match(URL_PATTERN);
  return match === null ? null : match[0];
}

/** The tail of what the process said, for a failure message a human can act on. */
export function tunnelOutputTail(output: string): string {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(-OUTPUT_TAIL_LINES)
    .join("\n");
}

export function createCloudflareTunnel(options: CloudflareTunnelOptions): CloudflareTunnel {
  const log = options.log ?? (() => {});
  let child: ChildProcess | null = null;
  let state: ImRemoteAccessStatus["state"] = "off";
  let lastError = "";
  let assignedUrl = "";
  let output = "";
  let stopping = false;
  /**
   * Start/stop are serialized: a settings-triggered start and a button-triggered start can
   * land in the same tick, and two concurrent spawns would leave one process orphaned and
   * hand out two different public addresses.
   */
  let queue: Promise<unknown> = Promise.resolve();
  const serialize = <T>(task: () => Promise<T>): Promise<T> => {
    const next = queue.then(task, task);
    queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };

  const currentUrl = (): string => {
    const fromSettings = options.getSettings().url;
    return assignedUrl.length > 0 ? assignedUrl : fromSettings;
  };

  const status = (): ImRemoteAccessStatus => ({
    provider: "cloudflare",
    state,
    url: currentUrl(),
    ...(lastError ? { error: lastError } : {}),
    allowed: true,
  });

  const stopInternal = async (): Promise<void> => {
    stopping = true;
    const running = child;
    child = null;
    state = "off";
    if (!running || running.exitCode !== null || running.signalCode !== null) return;
    await new Promise<void>((resolve) => {
      const killTimer = setTimeout(() => {
        try {
          running.kill("SIGKILL");
        } catch {
          // Already gone.
        }
        resolve();
      }, STOP_GRACE_MS);
      running.once("exit", () => {
        clearTimeout(killTimer);
        resolve();
      });
      try {
        running.kill("SIGTERM");
      } catch {
        clearTimeout(killTimer);
        resolve();
      }
    });
  };

  const stop = (): Promise<void> => serialize(() => stopInternal());

  const startInternal = async (force: boolean): Promise<ImRemoteAccessStatus> => {
    const settings = options.getSettings();
    if (child !== null && !force) return status();
    if (child !== null) await stop();

    stopping = false;
    output = "";
    lastError = "";
    state = "connecting";
    assignedUrl = "";

    const binary =
      settings.binaryPath.trim().length > 0 ? settings.binaryPath.trim() : "cloudflared";
    // No metrics port: several instances (dev + desktop) must not fight over 20241.
    const childProcess = spawn(
      binary,
      [
        "tunnel",
        "--url",
        `http://127.0.0.1:${options.port}`,
        "--no-autoupdate",
        "--metrics",
        "127.0.0.1:0",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    child = childProcess;

    const url = await new Promise<string | null>((resolve) => {
      let settled = false;
      const finish = (value: string | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => finish(null), START_TIMEOUT_MS);

      const onChunk = (chunk: Buffer) => {
        output = `${output}${chunk.toString("utf8")}`.slice(-8_000);
        const found = extractTunnelUrl(output);
        if (found !== null) finish(found);
      };
      childProcess.stdout?.on("data", onChunk);
      childProcess.stderr?.on("data", onChunk);

      childProcess.once("error", (error) => {
        lastError =
          (error as NodeJS.ErrnoException).code === "ENOENT"
            ? `未找到 ${binary}：请先安装 Cloudflare 隧道客户端（macOS: brew install cloudflared）。`
            : errorMessageOf(error);
        finish(null);
      });
      childProcess.once("exit", (code) => {
        if (stopping) return;
        lastError = lastError.length > 0 ? lastError : `cloudflared 退出（code ${code ?? "null"}）`;
        finish(null);
      });
    });

    if (url === null) {
      state = "failed";
      if (lastError.length === 0) {
        lastError = `隧道没有在 ${START_TIMEOUT_MS / 1000} 秒内就绪：\n${tunnelOutputTail(output)}`;
      }
      log("error", `Cloudflare 隧道启动失败：${lastError}`);
      await stop();
      return { ...status(), state: "failed" };
    }

    assignedUrl = url;
    state = "connected";
    try {
      options.onUrl(url);
    } catch {
      // Remembering the URL is a convenience; a failed write must not drop the tunnel.
    }
    log("info", `Cloudflare 隧道已连接：${url}`);
    return status();
  };

  const start = (force = false): Promise<ImRemoteAccessStatus> =>
    serialize(() => startInternal(force));

  const probe = async (): Promise<void> => {
    const binary = options.getSettings().binaryPath.trim() || "cloudflared";
    await new Promise<void>((resolve, reject) => {
      const check = spawn(binary, ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
      let text = "";
      check.stdout?.on("data", (chunk: Buffer) => {
        text = `${text}${chunk.toString("utf8")}`;
      });
      check.stderr?.on("data", (chunk: Buffer) => {
        text = `${text}${chunk.toString("utf8")}`;
      });
      check.once("error", (error) => {
        reject(
          (error as NodeJS.ErrnoException).code === "ENOENT"
            ? new Error(
                `未找到 ${binary}：请先安装 Cloudflare 隧道客户端（macOS: brew install cloudflared）。`,
              )
            : new Error(errorMessageOf(error)),
        );
      });
      check.once("exit", (code) => {
        if (code === 0) resolve();
        else
          reject(
            new Error(`${binary} --version 失败（code ${code ?? "null"}）${text.slice(0, 120)}`),
          );
      });
    });
  };

  return { start, stop, status, probe };
}
