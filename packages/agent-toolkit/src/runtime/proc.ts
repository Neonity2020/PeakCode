/**
 * 进程工具：把一条命令连它的整个进程组一起收掉。
 *
 * 只保留 `killProcessTree`。原模块还带着 OmniStudio 的"常驻子进程 + 日志泵 + 代理环境"
 * 那一整套（依赖它的服务器管理），agent 侧真正用到的只有这一件：`bash` 工具超时或
 * 被用户打断时，必须杀掉**整棵**进程树 —— 只杀 shell 的话，它派出去的 `npm test`
 * 会活下来继续占着端口和文件锁。
 */

/** 任何带 pid / kill 的东西：Bun.spawn 的 Subprocess 与 Node 的 ChildProcess 都满足。 */
export interface KillableProc {
  readonly pid?: number | undefined;
  // 方法式声明（而不是属性式箭头函数）：参数按双变检查，Bun 的 `kill(signal?: Signals | number)`
  // 与 Node 的 `kill(signal?: NodeJS.Signals)` 才都能赋进来。
  kill?(signal?: string | number): void;
}

export function killProcessTree(
  proc: KillableProc | null | undefined,
  signal: "SIGTERM" | "SIGKILL" = "SIGTERM",
): void {
  if (!proc) return;
  const pid = proc.pid;
  if (typeof pid === "number" && pid > 0) {
    try {
      // 负 pid = 整个进程组。子进程以 detached 启动时自成一个组，这是唯一能收全的方式。
      process.kill(-pid, signal);
      return;
    } catch {
      // ESRCH：进程组已不存在，走单进程兜底
    }
  }
  try {
    proc.kill?.(signal);
  } catch {
    // already dead
  }
}
