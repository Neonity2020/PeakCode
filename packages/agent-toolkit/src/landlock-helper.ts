/**
 * Landlock 后端（Linux 5.13+ 的内核级沙箱）。
 *
 * Landlock 没有命令行工具：规则必须由直接发 `landlock_create_ruleset` /
 * `landlock_add_rule` / `landlock_restrict_self` 的进程建立。原实现随应用编译一个 C 小助手，
 * 本移植**不携带该原生助手**（它要编译器、要按平台构建，且只服务 Linux）。
 *
 * 因此这里如实报告"不可用"：`landlockHelper()` 返回 `ok: false`，`agent-sandbox` 据此
 * 降级到 bubblewrap / Seatbelt / 不沙箱 —— 与"这台机器没有编译器"时原实现的行为一致。
 * 需要 Landlock 的宿主可以通过 `setLandlockHelper()` 挂上自己的助手。
 */
import { landlockRulesetSpec } from "./agent-sandbox.ts";

export type LandlockHelper =
  | { ok: true; path: string; abi: number; source: "cache" | "built" }
  | { ok: false; reason: string };

export type HelperRunner = {
  run(cmd: string[], timeoutMs: number): { code: number; stdout: string; stderr: string };
};

let injectedHelper: LandlockHelper | null = null;
let cachedHelper: LandlockHelper | null = null;

/** 挂上一个外部构建的 Landlock 助手；传 null 恢复"不可用"。 */
export function setLandlockHelper(helper: LandlockHelper | null): void {
  injectedHelper = helper;
  cachedHelper = null;
}

export function landlockHelper(opts: { refresh?: boolean | undefined } = {}): LandlockHelper {
  if (injectedHelper) return injectedHelper;
  if (cachedHelper && !opts.refresh) return cachedHelper;
  cachedHelper =
    process.platform === "linux"
      ? { ok: false, reason: "本构建未附带 Landlock 助手（setLandlockHelper 可注入）" }
      : { ok: false, reason: `Landlock 只在 Linux 上存在（当前 ${process.platform}）` };
  return cachedHelper;
}

export function resetLandlockHelperCache(): void {
  cachedHelper = null;
}

export function landlockHelperAvailable(): boolean {
  return landlockHelper().ok;
}

export function landlockCommand(
  binary: string,
  spec: string,
  shell: string,
  command: string,
  canary?: string,
): string[] {
  const canaryArgs = canary ? ["--canary", canary] : [];
  return [binary, "--spec", spec, ...canaryArgs, "--", shell, "-c", command];
}

/**
 * canary 探测：这套规则在**这个工作区所在的文件系统**上真的生效吗？
 *
 * Landlock 的规则匹配基于 inode，遇到 FUSE 类文件系统（Docker Desktop 的共享目录、
 * 部分网络盘）会整片落空 —— 表现是"连工作区都读不了"，每条命令都 Permission denied。
 * 真跑一次才能知道，所以这里拿同一个规格去限制一个什么都不做的进程。
 */
const canaryCache = new Map<string, { ok: boolean; reason: string | null }>();

export function probeLandlockWorkspace(
  workspace: string,
  opts: {
    binary?: string;
    mode?: "workspace-write" | "read-only";
    runner?: HelperRunner;
    refresh?: boolean;
  } = {},
): { ok: boolean; reason: string | null } {
  const mode = opts.mode ?? "workspace-write";
  const key = `${workspace}|${mode}`;
  if (!opts.refresh) {
    const cached = canaryCache.get(key);
    if (cached) return cached;
  }
  const helper = opts.binary
    ? { ok: true as const, path: opts.binary }
    : landlockHelper({ refresh: opts.refresh });
  if (!helper.ok) {
    const result = { ok: false, reason: helper.reason };
    canaryCache.set(key, result);
    return result;
  }
  if (!opts.runner) {
    const result = { ok: false, reason: "没有可用的 Landlock 探测执行器" };
    canaryCache.set(key, result);
    return result;
  }
  const probe = opts.runner.run(
    [
      helper.path,
      "--spec",
      landlockRulesetSpec({ workspace, mode, authorizedFolders: [] }),
      "--canary",
      workspace,
      "--",
      "/bin/true",
    ],
    15_000,
  );
  const result =
    probe.code === 0
      ? { ok: true, reason: null }
      : {
          ok: false,
          reason: (probe.stderr || probe.stdout).trim().slice(0, 240) || `退出码 ${probe.code}`,
        };
  canaryCache.set(key, result);
  return result;
}

export function resetLandlockCanaryCache(): void {
  canaryCache.clear();
}
