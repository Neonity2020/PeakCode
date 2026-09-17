/**
 * MiscTools - Remaining tools: web_fetch, checkpoint, rewind, think and read_skill.
 *
 * @module MiscTools
 */

import path from "node:path";

import { BuiltTool, ToolContext, errorResult, textResult } from "./toolSupport.ts";

import { Type } from "@earendil-works/pi-ai";

import { readSkillFile, skillsPromptSection } from "../agent-skills.ts";

/**
 * Agent 可使用的工具集。
 *
 * 权限模型（对齐 PI-Desktop 的思路：特权操作必须显式放行）：
 * - 只读工具（read_file / list_dir / glob / grep / web_search）可访问工作区之外的
 *   绝对路径，因为"读"不产生副作用；
 * - 写操作（write_file / edit_file / apply_patch）与 shell（bash）只能作用于工作区目录内，
 *   且 shell 还受 AGENT_ALLOW_SHELL 开关控制。
 */

export function createWebFetch(): BuiltTool {
  return {
    name: "web_fetch",
    label: "Fetch web page",
    description:
      "Fetch a URL and return its readable text (HTML tags stripped). Use it to read a page " +
      "found by web_search, or any docs URL. Only http/https.",
    parameters: Type.Object({
      url: Type.String({ description: "Absolute URL (http/https)." }),
    }),
    execute: async (_toolCallId, params: { url: string }) => {
      try {
        const url = new URL(params.url.trim());
        if (url.protocol !== "http:" && url.protocol !== "https:") {
          return errorResult("Only http/https URLs are supported.");
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 30_000);
        const res = await fetch(url, {
          signal: controller.signal,
          redirect: "follow",
          headers: {
            "User-Agent": "OmniStudio-Agent/1.0",
            Accept: "text/html,text/plain;q=0.9,*/*;q=0.5",
          },
        }).finally(() => clearTimeout(timer));
        if (!res.ok) return errorResult(`Fetch failed: HTTP ${res.status}`);
        const contentType = res.headers.get("content-type") ?? "";
        const raw = await res.text();
        const text = contentType.includes("html") ? htmlToText(raw) : raw;
        return textResult(`URL: ${res.url}\n\n${text}`);
      } catch (e) {
        return errorResult(`web_fetch failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  };
}

/** 极简 HTML → 文本：去掉脚本样式与标签，压缩空白。够读文档，不需要完整解析器。 */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|section|article|li|tr|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 只读工具集：Plan 模式下只用这些，保证"先出方案再动手"。 */
/**
 * checkpoint / rewind：给"大范围调研"用的打点与收网（对齐 oh-my-pi 的同名机制）。
 *
 * 场景：为了定位一个问题要读十几个文件，读完之后真正有用的只有三五句结论，
 * 那些中间过程却会一直占着窗口（本地 8k 窗口下尤其致命）。
 * 打点 → 探索 → `rewind` 交结论 = 把中间过程**整段换掉**。
 *
 * 和别的压缩手段的区别：不走模型摘要，所以没有"摘要写歪了"的漂移风险 ——
 * 留下的就是你亲手写的那份结论。
 */
export function createCheckpoint(ctx: ToolContext): BuiltTool {
  return {
    name: "checkpoint",
    label: "Checkpoint",
    description:
      "Mark the start of a large exploration, then call `rewind` with your findings when it is done. " +
      "Everything between checkpoint and rewind is dropped from context and replaced by your findings, " +
      "so use it before reading many files to answer one question. " +
      "Do NOT use it for ordinary work (edits you want to keep, or a task you are about to finish).",
    parameters: Type.Object({
      goal: Type.String({
        description: "What you are about to investigate, in one short sentence.",
      }),
    }),
    execute: async (_toolCallId, params: { goal: string }) => {
      if (!ctx.onCheckpoint) return errorResult("Checkpoint is not available in this mode.");
      return ctx.onCheckpoint(params.goal ?? "");
    },
  };
}

export function createRewind(ctx: ToolContext): BuiltTool {
  return {
    name: "rewind",
    label: "Rewind",
    description:
      "Finish an exploration started with `checkpoint`: everything read since the checkpoint is dropped and " +
      "replaced by the report you write here. The report must be self-contained — it is the ONLY thing that " +
      "survives, so include paths, line numbers, causes and the conclusion. " +
      "Set revert_files=true only when you created scratch files during the exploration and want them undone.",
    parameters: Type.Object({
      report: Type.String({
        description:
          "Your findings: conclusion first, then the evidence (file:line, command output). " +
          "Must stand alone without the exploration it replaces.",
      }),
      revert_files: Type.Optional(
        Type.Boolean({
          description:
            "Also restore the workspace to its state at the checkpoint (undoes files YOU changed during the " +
            "exploration). Default false — leave it false unless you made throwaway changes.",
        }),
      ),
    }),
    execute: async (_toolCallId, params: { report: string; revert_files?: boolean }) => {
      if (!ctx.onRewind) return errorResult("Rewind is not available in this mode.");
      return ctx.onRewind({
        report: params.report ?? "",
        revertFiles: params.revert_files === true,
      });
    },
  };
}

/**
 * think：不给答案的"草稿纸"（对齐 oh-my-pi 的 think 工具）。
 *
 * 我们的模型默认 `reasoning: false`（见 `buildModel()`：不强行注入 reasoning 参数），
 * 也就是说**没有原生推理通道** —— 模型想推理只能在正文里"想出声"，那些过程会留在
 * 对话记录里、也会挤占本轮上下文。给它一个把推理写进去、只回一个空壳的工具，
 * 正文就能保持干净（工具结果本身几乎不占 token）。
 *
 * 注意：这不是"隐藏思考"。写进来的内容仍会进上下文（它是一条工具调用），
 * 只是不会出现在给用户看的正文里。
 */
export function createThink(): BuiltTool {
  return {
    name: "think",
    label: "Think",
    description:
      "A private scratchpad for reasoning that should not appear in your visible answer: weighing options, " +
      "planning a multi-step approach, double-checking an assumption, or working out why something failed. " +
      "Nothing happens as a result — use it when thinking in the open would clutter the reply. " +
      "For short reasoning just answer directly; do not call this every turn.",
    parameters: Type.Object({
      thoughts: Type.String({
        description: "The reasoning to record. Be specific; this is for you, not the user.",
      }),
    }),
    execute: async (_toolCallId, params: { thoughts: string }) => {
      if (!params.thoughts?.trim()) return textResult("------");
      // 回一个空壳：内容已经进了 transcript，这里再复述一遍纯属浪费窗口。
      return textResult("------");
    },
  };
}

/**
 * read_skill：按需读取用户安装的 Skills（对齐 oh-my-pi 的渐进披露）。
 *
 * 系统提示里只列了「名字: 描述」，正文要靠这个工具取 —— 技能可能有几千字，
 * 全塞进系统提示会直接吃掉本地窗口。不带 name 时返回清单，便于模型自己找。
 */
export function createReadSkill(): BuiltTool {
  return {
    name: "read_skill",
    label: "Read skill",
    description:
      "Read a user-installed Skill (a SKILL.md instruction file) by name, or list the available skills " +
      "when called without a name. Skills often contain the exact procedure the user wants for a task: " +
      "when the current task matches a skill listed in your system prompt, read it BEFORE acting. " +
      "Use `file` to read a script or template inside the skill directory (path relative to that directory).",
    parameters: Type.Object({
      name: Type.Optional(
        Type.String({
          description: "Skill id as listed in the system prompt. Omit to list all skills.",
        }),
      ),
      file: Type.Optional(
        Type.String({
          description:
            "Optional path of a file inside the skill directory (e.g. 'scripts/run.py'). " +
            "Defaults to SKILL.md.",
        }),
      ),
    }),
    execute: async (_toolCallId, params: { name?: string; file?: string }) => {
      const name = params.name?.trim();
      const file = params.file;
      if (!name) {
        const section = skillsPromptSection({ includeDefaultPack: true });
        return textResult(section ?? "这台机器上还没有安装任何 Skill。");
      }
      const result = readSkillFile(name, file);
      if (!result.ok) return errorResult(result.reason);
      const header = `# Skill: ${result.name}\n（技能目录：${result.path}）`;
      const tail = result.truncated
        ? "\n\n…（内容过长已截断，需要更多请用 file 参数读取技能目录里的具体文件）"
        : "";
      return textResult(`${header}\n\n${result.text}${tail}`);
    },
  };
}
