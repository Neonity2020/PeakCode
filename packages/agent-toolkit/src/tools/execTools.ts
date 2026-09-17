/**
 * ExecTools - Command and network tools: bash, view_image, web_search and knowledge_search.
 *
 * @module ExecTools
 */

import path from "node:path";

import { COMMAND_TIMEOUT_MS, PIPE_DRAIN_GRACE_MS } from "./toolSupport.ts";

import {
  BuiltTool,
  ToolContext,
  authorizedFoldersOf,
  errorResult,
  textResult,
} from "./toolSupport.ts";
import { Readable } from "node:stream";

import { Type } from "@earendil-works/pi-ai";

import {
  explainSandboxDenial,
  logSandboxDegraded,
  sandboxActive,
  wrapShellCommand,
} from "../agent-sandbox.ts";

import { getSetting } from "../runtime/settings.ts";

import { killProcessTree } from "../runtime/proc.ts";
import { sleep, spawnProcess } from "../runtime/spawn.ts";
import { webSearch } from "../web-search.ts";
import { listKnowledgeBases, recall } from "../knowledge.ts";

import { audit } from "../skills/audit.ts";

/**
 * Agent 可使用的工具集。
 *
 * 权限模型（对齐 PI-Desktop 的思路：特权操作必须显式放行）：
 * - 只读工具（read_file / list_dir / glob / grep / web_search）可访问工作区之外的
 *   绝对路径，因为"读"不产生副作用；
 * - 写操作（write_file / edit_file / apply_patch）与 shell（bash）只能作用于工作区目录内，
 *   且 shell 还受 AGENT_ALLOW_SHELL 开关控制。
 */

export function createBash(ctx: ToolContext): BuiltTool {
  return {
    name: "bash",
    label: "Run command",
    description:
      "Run a shell command inside the workspace and return stdout+stderr. " +
      "Use for builds, tests, git, and package managers. Long-running or interactive commands are not suitable.",
    parameters: Type.Object({
      command: Type.String({ description: "Shell command to execute." }),
    }),
    execute: async (_toolCallId, params: { command: string }, signal?: AbortSignal) => {
      if (!ctx.allowShell) {
        return errorResult(
          "Shell access is disabled. Enable it in the Agent workspace settings to allow commands.",
        );
      }
      const shell = process.env.SHELL || "/bin/zsh";
      // 执行过的每条命令都入库留痕：模型可能被注入内容诱导执行破坏性命令，
      // 出事后要能查到"谁在什么时候跑了什么"。
      audit("agent_shell", `${ctx.workspace}: ${params.command}`);
      const timeoutMs = ctx.commandTimeoutMs ?? COMMAND_TIMEOUT_MS;
      // 命令沙箱（对齐 Codex 的 workspace-write）：开启后把命令跑在平台沙箱里，
      // 「写到工作区外」与「读凭据目录」由内核拦下，而不是靠命令黑名单。
      const wrapped = wrapShellCommand(params.command, {
        workspace: ctx.workspace,
        shell,
        authorizedFolders: authorizedFoldersOf(ctx),
      });
      if (wrapped.degradedReason) logSandboxDegraded(wrapped.degradedReason);
      try {
        /**
         * - `detached`：独立进程组，超时 / 停止时能整组杀掉。只杀 shell 的话，
         *   命令自己拉起的后台进程会活下来，而它继承了 stdout —— 读输出的那一端
         *   就永远等不到管道关闭（下面 readOutputBounded 说明了这个坑）。
         * - `stdin: "ignore"`：别让 `pip install`、`git commit` 这类等输入的命令
         *   把整轮 Agent 挂在这里。
         */
        const proc = spawnProcess(wrapped.cmd, {
          cwd: ctx.workspace,
          detached: true,
          env: { ...process.env, PATH: augmentPath() },
        });
        let killed: "timeout" | "abort" | null = null;
        const killGroup = (reason: "timeout" | "abort") => {
          if (killed) return;
          killed = reason;
          killProcessTree(proc, "SIGKILL");
        };
        const timer = setTimeout(() => killGroup("timeout"), timeoutMs);
        const onAbort = () => killGroup("abort");
        signal?.addEventListener("abort", onAbort, { once: true });
        // 已经中断过时 addEventListener 不会再触发，补一次。
        if (signal?.aborted) onAbort();
        try {
          const [stdout, stderr] = await Promise.all([
            readOutputBounded(proc.stdout, proc.exited),
            readOutputBounded(proc.stderr, proc.exited),
          ]);
          const exitCode = await proc.exited;
          const combined = [stdout, stderr].filter((s) => s.trim().length > 0).join("\n");
          const note =
            killed === "timeout"
              ? `\n[命令超过 ${Math.round(timeoutMs / 1000)} 秒，已连同子进程一起终止]`
              : killed === "abort"
                ? "\n[命令已随本次运行停止一并终止]"
                : "";
          // 沙箱拦截时只回一句 "operation not permitted" 谁都看不懂，补一句人话。
          // 带上实际后端：Landlock 拒写只回裸的 "Permission denied"，只有确认走的是
          // Landlock 才敢把它算成沙箱拦截（否则普通文件权限问题会被误报）。
          const sandboxNote =
            exitCode !== 0 && sandboxActive()
              ? explainSandboxDenial(combined, { backend: wrapped.backend })
              : null;
          if (sandboxNote) {
            /**
             * 沙箱升级（对齐 Codex 的 sandbox_approval）：命令**因为沙箱**失败时，
             * 问用户要不要跳过沙箱重跑一次 —— 而不是让模型自己撞墙或干脆绕路。
             * 只试一次；被拒绝时把拒绝原因一并回给模型，它知道"别再绕了"。
             */
            const escalation = ctx.escalateSandbox
              ? await ctx.escalateSandbox({ command: params.command, output: combined })
              : null;
            if (escalation === null && ctx.escalateSandbox) {
              audit("agent_shell", `${ctx.workspace}: [跳过沙箱重试] ${params.command}`);
              const retried = spawnProcess([shell, "-c", params.command], {
                cwd: ctx.workspace,
                detached: true,
                env: process.env,
              });
              const [retryOut, retryErr] = await Promise.all([
                readOutputBounded(retried.stdout, retried.exited),
                readOutputBounded(retried.stderr, retried.exited),
              ]);
              const retryCode = await retried.exited;
              const retryCombined = [retryOut, retryErr]
                .filter((part) => part.trim().length > 0)
                .join("\n");
              return textResult(
                `$ ${params.command}\n[沙箱拦下（${sandboxNote}），已按你的授权跳过沙箱重试]\n` +
                  `${retryCombined || "(no output)"}\n[exit ${retryCode}]${note}`,
              );
            }
            return textResult(
              `$ ${params.command}\n${combined || "(no output)"}\n[exit ${exitCode}]${note}\n${sandboxNote}` +
                (escalation ? `\n跳过沙箱重试被拒绝：${escalation}` : ""),
            );
          }
          return textResult(
            `$ ${params.command}\n${combined || "(no output)"}\n[exit ${exitCode}]${note}`,
          );
        } finally {
          clearTimeout(timer);
          signal?.removeEventListener("abort", onAbort);
        }
      } catch (e) {
        return errorResult(`bash failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  };
}

/**
 * 读子进程的输出，但**不以管道 EOF 为结束条件**。
 *
 * 命令里的 `xxx &`、后台服务会把 stdout 管道一并继承过去；直接
 * `await new Response(proc.stdout).text()` 就会一直等不到 EOF —— 工具、乃至整轮
 * Agent 都永久卡在这一行（超时定时器早就跑完了，救不回来），表现就是"一直在执行中"。
 * 所以这里改成：直接子进程一退出，再宽限 PIPE_DRAIN_GRACE_MS 把已有输出读完就收工。
 */
async function readOutputBounded(
  stream: Readable | null,
  exited: Promise<number>,
): Promise<string> {
  if (!stream) return "";
  let text = "";
  const pump = (async () => {
    try {
      for await (const chunk of stream) {
        text +=
          typeof chunk === "string" ? chunk : Buffer.from(chunk as Uint8Array).toString("utf8");
      }
    } catch {
      // 管道被取消 / 关闭：保留已经读到的部分
    }
  })();
  await Promise.race([pump, exited.then(() => sleep(PIPE_DRAIN_GRACE_MS))]);
  stream.destroy();
  return text;
}

/**
 * GUI 启动的进程 PATH 往往缺少 Homebrew / nvm 等目录，导致 node、git、brew 找不到。
 * 补上常见路径，保证工具调用不会莫名其妙地 "command not found"。
 */
export function augmentPath(): string {
  const extra = [
    "/usr/local/bin",
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
    `${process.env.HOME ?? ""}/.nvm/versions/node/*/bin`,
    `${process.env.HOME ?? ""}/.bun/bin`,
    `${process.env.HOME ?? ""}/.cargo/bin`,
  ];
  return [...extra, process.env.PATH ?? ""].join(":");
}

export function createWebSearch(): BuiltTool {
  return {
    name: "web_search",
    label: "Web search",
    description:
      "Search the web for up-to-date information (docs, releases, error messages) and return titles, URLs and snippets.",
    parameters: Type.Object({
      query: Type.String({ description: "Search query — prefer keywords over full sentences." }),
    }),
    execute: async (_toolCallId, params: { query: string }) => {
      try {
        if (getSetting("WEB_SEARCH_ENABLED") !== "1") {
          return errorResult("Web search is disabled in settings.");
        }
        const result = await webSearch(params.query);
        if (!result.ok || result.results.length === 0) {
          return errorResult(`Web search failed: ${result.error ?? "no results"}`);
        }
        const formatted = result.results
          .map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet}`)
          .join("\n\n");
        return textResult(`Provider: ${result.provider}\n\n${formatted}`);
      } catch (e) {
        return errorResult(`web_search failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  };
}

/**
 * 本地知识库检索：Agent / Plan / Goal 三模式都可用（只读）。
 * 不指定 kb 时检索全部知识库；命中返回来源文档名 + 分块内容。
 */
export function createKnowledgeSearch(): BuiltTool {
  return {
    name: "knowledge_search",
    label: "Knowledge search",
    description:
      "Search the user's local knowledge bases (documents / notes / web pages imported in OmniStudio). " +
      "Use it when the task may relate to materials the user stored locally, before searching the web.",
    parameters: Type.Object({
      query: Type.String({ description: "Search query — natural language is fine." }),
      kb: Type.Optional(
        Type.String({
          description: "Knowledge base name to restrict the search to. Omit for all.",
        }),
      ),
      top_k: Type.Optional(Type.Number({ description: "Max chunks to return (default 6)." })),
    }),
    execute: async (_toolCallId, params: { query: string; kb?: string; top_k?: number }) => {
      try {
        const kbs = listKnowledgeBases();
        if (kbs.length === 0) {
          return textResult("用户还没有创建任何知识库。");
        }
        let targets = kbs;
        if (params.kb?.trim()) {
          const lowered = params.kb.trim().toLowerCase();
          targets = kbs.filter((k) => k.name.toLowerCase() === lowered);
          if (targets.length === 0) {
            return textResult(
              `没有名为「${params.kb}」的知识库。可用：${kbs.map((k) => k.name).join("、")}`,
            );
          }
        }
        const { hits } = await recall(
          targets.map((k) => k.id),
          params.query,
          params.top_k,
          { actor: "agent" },
        );
        if (hits.length === 0) {
          return textResult("没有检索到相关内容。");
        }
        const formatted = hits
          .map(
            (h, i) =>
              `[${i + 1}] 《${h.docName}》分块 ${h.seq}（${h.kbName}，相关度 ${h.score.toFixed(2)}）\n` +
              (h.modality
                ? // 与 kb-mcp.ts 的 mediaHitTag 同款：防空正文媒体命中呈现为空行
                  `[${h.modality === "image" ? "图片" : h.modality === "audio" ? "音频" : "视频"}] ${h.docName}` +
                  (h.content ? `\n${h.content}` : "")
                : h.content),
          )
          .join("\n\n");
        return textResult(`找到 ${hits.length} 条相关片段：\n\n${formatted}`);
      } catch (e) {
        return errorResult(
          `knowledge_search failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    },
  };
}
