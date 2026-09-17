/**
 * WriteTools - Mutating tools: write_file, edit_file, apply_patch, permission and context requests.
 *
 * @module WriteTools
 */
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";

import { EDIT_MISMATCH_HINT, NOT_FOUND_HINT } from "./toolSupport.ts";

import {
  BuiltTool,
  ToolContext,
  assertReadable,
  assertWritable,
  errorResult,
  resolvePath,
  textResult,
} from "./toolSupport.ts";
import path from "node:path";

import { Type } from "@earendil-works/pi-ai";

import { applyPatch } from "../apply-patch.ts";
import { isInsideWorkspace } from "../permissions.ts";

import { contextUsage, describeContextUsage } from "../agent-context.ts";

/**
 * Agent 可使用的工具集。
 *
 * 权限模型（对齐 PI-Desktop 的思路：特权操作必须显式放行）：
 * - 只读工具（read_file / list_dir / glob / grep / web_search）可访问工作区之外的
 *   绝对路径，因为"读"不产生副作用；
 * - 写操作（write_file / edit_file / apply_patch）与 shell（bash）只能作用于工作区目录内，
 *   且 shell 还受 AGENT_ALLOW_SHELL 开关控制。
 */

export function createWriteFile(ctx: ToolContext): BuiltTool {
  return {
    name: "write_file",
    label: "Write file",
    description:
      "Create or overwrite a file inside the workspace with the given content. " +
      "Parent directories are created automatically. Prefer `edit_file` for surgical changes.",
    parameters: Type.Object({
      path: Type.String({ description: "Path relative to the workspace, or absolute inside it." }),
      content: Type.String({ description: "Full file content to write." }),
    }),
    execute: async (_toolCallId, params: { path: string; content: string }) => {
      try {
        const target = resolvePath(ctx.workspace, params.path);
        assertWritable(ctx, target);
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, params.content, "utf8");
        ctx.recordArtifact?.(target, "write_file");
        return textResult(`Wrote ${params.content.length} chars to ${target}`);
      } catch (e) {
        return errorResult(`write_file failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  };
}

export function createEditFile(ctx: ToolContext): BuiltTool {
  return {
    name: "edit_file",
    label: "Edit file",
    description:
      "Replace an exact string inside a file inside the workspace. `old_str` must appear " +
      "exactly once unless `replace_all` is true. Read the file first to get the exact text.",
    parameters: Type.Object({
      path: Type.String({ description: "Path relative to the workspace, or absolute inside it." }),
      old_str: Type.String({ description: "Exact text to replace (including whitespace)." }),
      new_str: Type.String({ description: "Replacement text." }),
      replace_all: Type.Optional(Type.Boolean({ description: "Replace every occurrence." })),
    }),
    execute: async (
      _toolCallId,
      params: { path: string; old_str: string; new_str: string; replace_all?: boolean },
    ) => {
      try {
        const target = resolvePath(ctx.workspace, params.path);
        assertWritable(ctx, target);
        if (!existsSync(target)) return errorResult(`File not found: ${target}${NOT_FOUND_HINT}`);
        const original = readFileSync(target, "utf8");
        const occurrences = original.split(params.old_str).length - 1;
        if (occurrences === 0)
          return errorResult(`old_str not found in ${target}${EDIT_MISMATCH_HINT}`);
        if (occurrences > 1 && !params.replace_all) {
          return errorResult(
            `old_str occurs ${occurrences} times in ${target}. Pass replace_all=true or make old_str unique.` +
              "（更稳的做法：把 old_str 扩到上下几行，让它只匹配一处。）",
          );
        }
        const next = params.replace_all
          ? original.split(params.old_str).join(params.new_str)
          : original.replace(params.old_str, params.new_str);
        writeFileSync(target, next, "utf8");
        ctx.recordArtifact?.(target, "edit_file");
        return textResult(
          `Edited ${target} (${occurrences} replacement${occurrences > 1 ? "s" : ""})`,
        );
      } catch (e) {
        return errorResult(`edit_file failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  };
}

/**
 * apply_patch（对齐 Codex）：一次调用完成多文件的新增 / 修改 / 删除 / 重命名，
 * 解析与应用规则见 apply-patch.ts。相比连续调用 edit_file，它的价值在于
 * 「一处匹配不上就整体不动」—— 模型不会留下改了一半的仓库。
 */
export function createApplyPatch(ctx: ToolContext): BuiltTool {
  return {
    name: "apply_patch",
    label: "Apply patch",
    description:
      "Apply a multi-file patch. Wrap hunks between '*** Begin Patch' and '*** End Patch'. " +
      "Use '*** Add File: <path>' (every content line prefixed with '+'), " +
      "'*** Update File: <path>' (optional '*** Move to: <new path>', then '@@' sections with " +
      "context lines prefixed by a space, removals by '-', additions by '+'), and " +
      "'*** Delete File: <path>'. Prefer this over several edit_file calls: it is atomic — " +
      "if any section fails to match, nothing is written and you get a precise error.",
    parameters: Type.Object({
      patch: Type.String({
        description:
          "The full patch text, starting with '*** Begin Patch' and ending with '*** End Patch'.",
      }),
    }),
    execute: async (_toolCallId, params: { patch: string }) => {
      const resolve = (rawPath: string) => {
        const target = resolvePath(ctx.workspace, rawPath);
        assertWritable(ctx, target);
        return target;
      };
      const result = applyPatch(params.patch, {
        resolve,
        fs: {
          read: (target) => {
            if (!existsSync(target)) return null;
            if (statSync(target).isDirectory()) {
              throw new Error(`Refusing to patch a directory: ${target}`);
            }
            return readFileSync(target, "utf8");
          },
          write: (target, contents) => {
            mkdirSync(path.dirname(target), { recursive: true });
            writeFileSync(target, contents, "utf8");
          },
          remove: (target) => {
            if (existsSync(target)) unlinkSync(target);
          },
        },
      });
      if (!result.ok) return errorResult(result.error);
      for (const change of result.changes) ctx.recordArtifact?.(change.path, "apply_patch");
      return textResult(result.summary);
    },
  };
}

/**
 * request_permissions（对齐 Codex 的同名工具）：模型带着**理由**申请访问工作区之外的路径。
 *
 * 关键点：这个工具**必须经过授权闸门**（`permissions.ts` 把它翻译成
 * external_directory 请求）—— 它能跑起来本身就意味着用户刚点了允许（或策略本就放行）。
 * 所以工具体内不再自己发起一次询问：那样会先问一次工具、再问一次目录，用户要点两次；
 * 而如果把它放进免授权名单，模型就能拿到一句假的"已授权"。
 *
 * 相比"先撞一次墙再看报错"，它的价值是让用户在卡片上看到**意图**（要哪个目录、拿去做什么），
 * 而不是一条冷冰冰的路径拒绝；被拒时模型也会拿到明确的拒绝理由。
 */
export function createRequestPermissions(ctx: ToolContext): BuiltTool {
  return {
    name: "request_permissions",
    label: "Request access",
    description:
      "Ask the user to grant access to a path outside the workspace (for example a sibling " +
      "repository or a data folder). Always explain why you need it. The user approves or denies " +
      "on a card in the conversation; once approved you may read/write that path in this session.",
    parameters: Type.Object({
      path: Type.String({
        description: "Absolute path (or path outside the workspace) you need access to.",
      }),
      reason: Type.String({ description: "One sentence: what you will do with it." }),
    }),
    execute: async (_toolCallId, params: { path: string; reason: string }) => {
      const target = params.path?.trim();
      if (!target) return errorResult("request_permissions needs a path.");
      // 工作区内的路径本来就能访问，走到这里说明模型多问了一次。
      if (isInsideWorkspace(ctx.workspace, path.resolve(ctx.workspace, target))) {
        return textResult(`${target} is already inside the workspace — no approval needed.`);
      }
      return textResult(
        `Access granted for ${target}. Proceed with the operation; if a workspace rule was added, ` +
          "further reads/writes under it will not ask again.",
      );
    },
  };
}

/**
 * get_context_remaining（对齐 Codex 的同名工具）：让模型自己能看到还剩多少窗口。
 * 本地模型窗口小，长任务里"该继续读文件还是先收尾"应当由它自己判断 ——
 * 而不是等压缩真的发生（那时中间历史已经被裁掉了）。
 */
export function createContextRemaining(ctx: ToolContext): BuiltTool {
  return {
    name: "get_context_remaining",
    label: "Context left",
    description:
      "Report how much of the context window is still free for this session. " +
      "Call it before starting a large read (many files, a big directory) when the task has " +
      "already been running for a while, or when you are unsure whether you can afford one more step.",
    parameters: Type.Object({}),
    execute: async () => {
      if (ctx.conversationId === undefined) {
        return errorResult("Context usage is only available inside a conversation.");
      }
      const usage = contextUsage(ctx.conversationId, {
        systemPromptTokens: ctx.systemPromptTokens,
      });
      return textResult(describeContextUsage(usage));
    },
  };
}

/** view_image 支持的图片类型（按扩展名判；本地模型走的是服务端的 mtmd / vision 前端）。 */ export const IMAGE_MEDIA_TYPES: Record<
  string,
  string
> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
};

/** 单张图片上限：base64 会再膨胀 1/3，再大就该先压缩（或用 bash 里的 sips / magick）。 */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/**
 * view_image（对齐 Codex 的同名工具）：把本地图片作为图片内容块交回模型，
 * 让视觉模型能"看"截图 / 设计稿 / 生成结果。仅在当前模型看起来支持图片输入时
 * 才会注册这个工具（纯文本模型收到图片块会被服务端拒绝）。
 */
export function createViewImage(ctx: ToolContext): BuiltTool {
  return {
    name: "view_image",
    label: "View image",
    description:
      "Read an image file from disk and attach it to the conversation so you can see it " +
      "(screenshots, diagrams, generated images). Use this whenever the task depends on " +
      "what an image actually shows.",
    parameters: Type.Object({
      path: Type.String({ description: "Path relative to the workspace, or absolute." }),
    }),
    execute: async (_toolCallId, params: { path: string }) => {
      try {
        const target = resolvePath(ctx.workspace, params.path);
        assertReadable(ctx, target);
        if (!existsSync(target)) return errorResult(`Image not found: ${target}`);
        const mediaType = IMAGE_MEDIA_TYPES[path.extname(target).toLowerCase()];
        if (!mediaType) {
          return errorResult(
            `Unsupported image type: ${path.extname(target) || "(no extension)"}. ` +
              `Supported: ${Object.keys(IMAGE_MEDIA_TYPES).join(", ")}`,
          );
        }
        const size = statSync(target).size;
        if (size > MAX_IMAGE_BYTES) {
          return errorResult(
            `Image is too large (${Math.round(size / 1024 / 1024)}MB, limit ` +
              `${MAX_IMAGE_BYTES / 1024 / 1024}MB). Downscale it first (e.g. ` +
              `\`sips -Z 1568 "${target}" --out /tmp/small.png\`) and view the smaller copy.`,
          );
        }
        const data = readFileSync(target).toString("base64");
        return {
          content: [
            {
              type: "text" as const,
              text: `Attached image: ${target} (${mediaType}, ${size} bytes)`,
            },
            { type: "image" as const, data, mimeType: mediaType },
          ],
          details: {},
        };
      } catch (e) {
        return errorResult(`view_image failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  };
}
