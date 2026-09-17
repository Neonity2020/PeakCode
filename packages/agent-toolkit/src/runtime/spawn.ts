/**
 * 可移植的子进程封装。
 *
 * 原实现直接用 `Bun.spawn` / `Bun.spawnSync` / `Bun.Glob`。这些在 Bun 下没问题，
 * 但把整个工具箱锁死在 Bun 运行时上 —— PeakCode 的服务端既能跑在 Bun 也能跑在 Node，
 * 而 vitest 默认就是 Node。`node:child_process` 两个运行时都支持，能力也够：
 * `detached` 一样能起独立进程组（整组杀掉的前提），`spawnSync` 一样能同步拿退出码。
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Readable } from "node:stream";

export interface SpawnedProcess {
  readonly pid: number | undefined;
  readonly stdout: Readable | null;
  readonly stderr: Readable | null;
  /** 退出码。进程被信号杀掉时给 `128 + signal` 之外，这里统一给 -1。 */
  readonly exited: Promise<number>;
  /** 只在 `stdin: "pipe"` 时非空（hook 脚本从 stdin 读事件 JSON）。 */
  readonly stdin: import("node:stream").Writable | null;
  kill(signal?: string | number): void;
  unref(): void;
}

export interface SpawnOptions {
  cwd?: string | undefined;
  env?: Record<string, string | undefined> | undefined;
  /** 独立进程组：超时 / 停止时能整组杀掉（`killProcessTree` 依赖它）。 */
  detached?: boolean | undefined;
  stdin?: "ignore" | "pipe" | undefined;
}

export function spawnProcess(cmd: readonly string[], opts: SpawnOptions = {}): SpawnedProcess {
  const detached = opts.detached ?? true;
  const child = spawn(cmd[0] ?? "", cmd.slice(1), {
    cwd: opts.cwd,
    env: opts.env as NodeJS.ProcessEnv | undefined,
    stdio: [opts.stdin ?? "ignore", "pipe", "pipe"],
    detached,
  });

  const exited = new Promise<number>((resolve) => {
    if (child.exitCode !== null) {
      resolve(child.exitCode);
      return;
    }
    child.once("exit", (code, signal) => {
      resolve(code ?? (signal ? -1 : 0));
    });
    child.once("error", () => resolve(-1));
  });

  return {
    get pid() {
      return child.pid ?? undefined;
    },
    get stdout() {
      return child.stdout;
    },
    get stderr() {
      return child.stderr;
    },
    get stdin() {
      return child.stdin;
    },
    exited,
    kill(signal?: string | number) {
      try {
        child.kill(signal as NodeJS.Signals | number | undefined);
      } catch {
        // already dead
      }
    },
    unref() {
      child.unref();
    },
  };
}

export interface SpawnSyncResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface SpawnSyncOptions extends SpawnOptions {
  /** Defaults to 60s. git 在巨大的仓库上偶尔会慢，但挂死比慢更糟。 */
  timeoutMs?: number | undefined;
}

/** 同步跑一条命令并收下输出。用于能力探测与影子 git 这类"跑完才知道"的地方。 */
export function spawnSyncCapture(
  cmd: readonly string[],
  opts: SpawnSyncOptions = {},
): SpawnSyncResult {
  const result = spawnSync(cmd[0] ?? "", cmd.slice(1), {
    cwd: opts.cwd,
    env: opts.env as NodeJS.ProcessEnv | undefined,
    encoding: "utf8",
    timeout: opts.timeoutMs ?? 60_000,
  });
  return {
    code: result.status ?? (result.error ? -1 : 0),
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: typeof result.stderr === "string" ? result.stderr : "",
  };
}

/** 同步等待：既不用忙转，也不需要 Bun 的 `sleepSync`。 */
export function sleepSync(ms: number): void {
  const view = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(view, 0, 0, Math.max(0, ms));
}

/**
 * 读完一个子进程输出流。
 *
 * 原来是 `new Response(proc.stdout).text()` —— `Bun.spawn` 给的正是 WHATWG ReadableStream，
 * 而 `node:child_process` 给的是 Node Readable，两者不是一回事。异步迭代两个运行时都支持。
 */
export async function readStreamText(stream: Readable | null): Promise<string> {
  if (!stream) return "";
  let text = "";
  try {
    for await (const chunk of stream) {
      text += typeof chunk === "string" ? chunk : Buffer.from(chunk as Uint8Array).toString("utf8");
    }
  } catch {
    // 流被取消 / 提前关闭：保留已经读到的部分
  }
  return text;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 把数据交给子进程的 stdin 并收尾。
 *
 * 脚本可能不读 stdin 就退出（`echo`、`exit 1` 这类），此时写入以 EPIPE 失败。
 * 流上没有 error 监听器时，这个失败会以未处理事件冒到进程级 —— 测试环境里
 * vitest 会把它记成 unhandled error，整个测试运行直接判失败。投递 stdin 本来就是
 * 尽力而为：同一份 payload 也在环境变量里，调用方按自己的契约处理失败。
 */
export function writeStdin(proc: SpawnedProcess, data: string): void {
  const stdin = proc.stdin;
  if (!stdin) return;
  stdin.on("error", () => {});
  stdin.write(data);
  stdin.end();
}

/**
 * 单层 glob（`*\/name`）。
 *
 * 原实现用 `new Bun.Glob("...").scanSync()`。工具箱只用到这一种固定形状 ——
 * 快照索引目录、spill 目录 —— 为它引一个 glob 引擎不值当，而且在 Node 下也没有。
 */
export function globDirectories(root: string, fileName: string): string[] {
  if (!existsSync(root)) return [];
  const hits: string[] = [];
  for (const entry of readdirSync(root)) {
    const candidate = join(root, entry, fileName);
    if (existsSync(candidate)) hits.push(candidate);
  }
  return hits.sort();
}
