/**
 * 默认技能包：一套工程流程技能，作为"系统级默认"装进公共技能库。
 *
 * 安装不自己实现（clone / 解包 / 写目录），而是调官方 `skills` CLI
 * （`npx skills add <repo> --global --agent universal --yes`）：它已经处理了从 GitHub
 * 取包、按 SKILL.md 发现技能、以及各 agent 目录的落位约定。PeakCode 只负责"确保装着"。
 *
 * 为什么落到 universal 而不是 `-a pi`：universal 的全局落点正是公共技能库
 * `~/.agents/skills`，`read_skill` 与技能页读的就是这里；指名具体 agent 时 CLI 会把文件
 * 放进那个 agent 自己的目录（`~/.pi/agent/skills`），公共库反而拿不到。
 *
 * 技能库是用户自己的地盘，新机器上常常是空的 —— 但"按流程办事"应该是这个应用开箱
 * 就有的能力，不该等用户先知道某个 CLI。所以启动时补一次，装完就把清单记进设置，
 * 之后每次启动只做一次目录检查，不再联网。
 */
import { existsSync, readdirSync } from "node:fs";

import { getCentralRepoDir } from "./central-repo.ts";
import { spawnProcess, readStreamText } from "../runtime/spawn.ts";
import { killProcessTree } from "../runtime/proc.ts";
import { getSetting } from "../runtime/settings.ts";

/** 一个技能包：来源仓库 + 它应该带来的技能目录名。 */
export interface SkillPack {
  /** 传给 `skills add` 的仓库（`owner/name` 或完整 URL）。 */
  readonly source: string;
  /** 这个包里有哪些技能 —— 用来判断"是不是已经装过了"。 */
  readonly skills: readonly string[];
  /** 一句话说明，写进日志与技能页。 */
  readonly description: string;
}

/**
 * 内置的默认技能包：addyosmani/agent-skills（DEFINE → PLAN → BUILD → VERIFY →
 * REVIEW → SHIP 六个阶段的工程流程，MIT）。
 *
 * `skills` 里是包内技能目录名的快照。它有两个用途：判断装没装、以及在系统提示里
 * 按阶段列给模型看（见 `skills/workflow.ts`）。包本身升级后这里要跟着改。
 */
export const DEFAULT_SKILL_PACKS: readonly SkillPack[] = [
  {
    source: "addyosmani/agent-skills",
    description: "工程流程技能：从需求澄清到发布上线的六个阶段",
    skills: [
      // Meta
      "using-agent-skills",
      // Define
      "interview-me",
      "idea-refine",
      "spec-driven-development",
      "constraint-driven-development",
      // Plan
      "planning-and-task-breakdown",
      // Build
      "incremental-implementation",
      "test-driven-development",
      "context-engineering",
      "source-driven-development",
      "doubt-driven-development",
      "frontend-ui-engineering",
      "api-and-interface-design",
      // Verify
      "browser-testing-with-devtools",
      "debugging-and-error-recovery",
      // Review
      "code-review-and-quality",
      "code-simplification",
      "security-and-hardening",
      "performance-optimization",
      // Ship
      "git-workflow-and-versioning",
      "ci-cd-and-automation",
      "deprecation-and-migration",
      "documentation-and-adrs",
      "observability-and-instrumentation",
      "shipping-and-launch",
    ],
  },
];

/** 安装命令的超时（`npx` 要现取 CLI 再拉仓库，慢机器上可能到分钟级）。 */
export const DEFAULT_SKILL_PACK_INSTALL_TIMEOUT_MS = 180_000;

/** 默认技能包的总开关（设置为 "0" 关闭，用户自己维护技能库时用得上）。 */
export function defaultSkillPacksEnabled(): boolean {
  return getSetting("AGENT_SKILL_PACKS") !== "0";
}

/** 公共技能库里已经有的技能目录名。 */
export function installedSkillIds(): string[] {
  const root = getCentralRepoDir();
  if (!existsSync(root)) return [];
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/** 包里还没有装上的技能（空数组 = 装全了）。 */
export function missingPackSkills(
  pack: SkillPack,
  installed: readonly string[] = installedSkillIds(),
): string[] {
  const present = new Set(installed);
  return pack.skills.filter((skill) => !present.has(skill));
}

/** 装一个包要跑的 argv。导出是为了让测试盯住参数（`universal` 这个落点是关键）。 */
export function skillPackInstallArgv(pack: SkillPack): string[] {
  return [
    "npx",
    "--yes",
    "skills",
    "add",
    pack.source,
    "--global",
    "--agent",
    "universal",
    "--yes",
  ];
}

export type SkillPackStatus = "installed" | "already-present" | "skipped" | "failed";

export interface SkillPackResult {
  readonly pack: string;
  readonly status: SkillPackStatus;
  /** 失败原因或说明（日志 / 技能页用）。 */
  readonly detail?: string;
}

/** 跑安装命令。测试里换成假实现，不走网络。 */
export type SkillPackInstaller = (pack: SkillPack) => Promise<{ ok: boolean; detail: string }>;

/**
 * 默认安装器：`npx skills add …`，超时就整组收掉。
 *
 * 只看退出码，不去解析 CLI 的输出格式 —— 那是它的内部实现，跟着版本漂。
 * 真装没装上以调用方随后的目录检查为准（见 `ensureDefaultSkillPacks`）。
 */
export function runSkillPackInstaller(
  pack: SkillPack,
  timeoutMs: number = DEFAULT_SKILL_PACK_INSTALL_TIMEOUT_MS,
): Promise<{ ok: boolean; detail: string }> {
  return new Promise((resolve) => {
    let proc: ReturnType<typeof spawnProcess>;
    try {
      proc = spawnProcess(skillPackInstallArgv(pack), { detached: true });
    } catch (error) {
      resolve({ ok: false, detail: error instanceof Error ? error.message : String(error) });
      return;
    }

    // 两个流都要读：管道写满会把子进程卡死，等到的只会是超时。
    const stdout = readStreamText(proc.stdout);
    const stderr = readStreamText(proc.stderr);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killProcessTree(proc, "SIGKILL");
    }, timeoutMs);

    void proc.exited.then(async (code) => {
      clearTimeout(timer);
      const [out, err] = await Promise.all([stdout, stderr]);
      if (timedOut) {
        resolve({ ok: false, detail: `安装超时（${Math.round(timeoutMs / 1000)}s）` });
        return;
      }
      if (code === 0) {
        resolve({ ok: true, detail: "" });
        return;
      }
      const message = (err.trim() || out.trim()).split("\n").slice(-3).join(" ").slice(0, 400);
      resolve({ ok: false, detail: `安装命令退出码 ${code}${message ? `：${message}` : ""}` });
    });
  });
}

export interface EnsureSkillPacksOptions {
  readonly packs?: readonly SkillPack[];
  /** 覆盖安装器（测试注入）。 */
  readonly install?: SkillPackInstaller;
  /** 覆盖"已装技能"的读取（测试注入）。 */
  readonly listInstalled?: () => string[];
  readonly timeoutMs?: number;
}

/**
 * 确保默认技能包在公共技能库里。
 *
 * 幂等且不联网优先：包里每个技能都能在库里找到就整包跳过（`already-present`）。
 * 关掉开关时返回 `skipped`，调用方日志里能看出"是被关掉的，不是装失败"。
 * 失败只如实返回，不抛 —— 技能装不上不该挡住服务启动。
 */
export async function ensureDefaultSkillPacks(
  options: EnsureSkillPacksOptions = {},
): Promise<SkillPackResult[]> {
  const packs = options.packs ?? DEFAULT_SKILL_PACKS;
  if (packs.length === 0) return [];
  if (!defaultSkillPacksEnabled()) {
    return packs.map((pack) => ({
      pack: pack.source,
      status: "skipped" as const,
      detail: "已在设置里关闭",
    }));
  }

  const install =
    options.install ?? ((pack: SkillPack) => runSkillPackInstaller(pack, options.timeoutMs));
  const listInstalled = options.listInstalled ?? installedSkillIds;

  const results: SkillPackResult[] = [];
  for (const pack of packs) {
    let installed = listInstalled();
    const missing = missingPackSkills(pack, installed);
    if (missing.length === 0) {
      results.push({ pack: pack.source, status: "already-present" });
      continue;
    }

    const outcome = await install(pack);
    // 装没装上以目录为准：CLI 可能部分成功，也可能成功但没写我们要的位置。
    installed = listInstalled();
    const stillMissing = missingPackSkills(pack, installed);
    if (stillMissing.length === 0) {
      results.push({ pack: pack.source, status: "installed" });
      continue;
    }

    results.push({
      pack: pack.source,
      status: "failed",
      detail: [outcome.detail, `仍缺 ${stillMissing.slice(0, 5).join(", ")}`]
        .filter((part) => part.length > 0)
        .join("；"),
    });
  }
  return results;
}
