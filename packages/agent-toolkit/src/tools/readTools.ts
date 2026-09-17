/**
 * ReadTools - Read-only filesystem tools: read_file, list_dir, glob and grep.
 *
 * @module ReadTools
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";

import { IGNORED_DIRS, MAX_FILE_CHARS, NOT_FOUND_HINT, NO_MATCH_HINT } from "./toolSupport.ts";

import {
  BuiltTool,
  ToolContext,
  assertReadable,
  errorResult,
  resolvePath,
  textResult,
} from "./toolSupport.ts";
import path from "node:path";

import { Type } from "@earendil-works/pi-ai";

/**
 * Agent 可使用的工具集。
 *
 * 权限模型（对齐 PI-Desktop 的思路：特权操作必须显式放行）：
 * - 只读工具（read_file / list_dir / glob / grep / web_search）可访问工作区之外的
 *   绝对路径，因为"读"不产生副作用；
 * - 写操作（write_file / edit_file / apply_patch）与 shell（bash）只能作用于工作区目录内，
 *   且 shell 还受 AGENT_ALLOW_SHELL 开关控制。
 */

/** 递归收集目录下的文件路径（受 IGNORED_DIRS 与深度限制）。 */
export function walkDir(root: string, maxDepth = 8): string[] {
  const out: string[] = [];
  const visit = (dir: string, depth: number) => {
    if (depth > maxDepth) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const full = path.join(dir, name);
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        if (IGNORED_DIRS.has(name) || name.startsWith(".")) continue;
        visit(full, depth + 1);
      } else if (stat.isFile()) {
        out.push(full);
      }
    }
  };
  visit(root, 0);
  return out;
}

/** 简易 glob：`**` 匹配任意层级，`*` 匹配非分隔符字符，`?` 匹配单个字符。 */
export function globToRegExp(pattern: string): RegExp {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        re += ".*";
        i++;
      } else {
        re += "[^/]*";
      }
    } else if (ch === "?") {
      re += "[^/]";
    } else if (".+^${}()|[]\\".includes(ch)) {
      re += `\\${ch}`;
    } else {
      re += ch;
    }
  }
  return new RegExp(`^${re}$`);
}

export function createReadFile(ctx: ToolContext): BuiltTool {
  return {
    name: "read_file",
    label: "Read file",
    description:
      "Read a text file from disk. Use an absolute path or a path relative to the workspace. " +
      "Returns the content with line numbers, truncated for very large files.",
    parameters: Type.Object({
      path: Type.String({ description: "Absolute path, or path relative to the workspace." }),
      offset: Type.Optional(Type.Number({ description: "1-based line number to start from." })),
      limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read." })),
    }),
    execute: async (_toolCallId, params: { path: string; offset?: number; limit?: number }) => {
      try {
        const target = resolvePath(ctx.workspace, params.path);
        assertReadable(ctx, target);
        if (!existsSync(target)) return errorResult(`File not found: ${target}${NOT_FOUND_HINT}`);
        const raw = readFileSync(target, "utf8");
        const lines = raw.split("\n");
        const start = Math.max(0, (params.offset ?? 1) - 1);
        const end = params.limit ? start + params.limit : lines.length;
        const slice = lines.slice(start, end);
        const numbered = slice
          .map((line, i) => `${String(start + i + 1).padStart(5, " ")} | ${line}`)
          .join("\n");
        return textResult(numbered.slice(0, MAX_FILE_CHARS));
      } catch (e) {
        return errorResult(`read_file failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  };
}

export function createListDir(ctx: ToolContext): BuiltTool {
  return {
    name: "list_dir",
    label: "List directory",
    description:
      "List files and directories. Directories are suffixed with '/'. Useful to explore an unfamiliar project.",
    parameters: Type.Object({
      path: Type.String({ description: "Directory to list (default: workspace root)." }),
    }),
    execute: async (_toolCallId, params: { path?: string }) => {
      try {
        const target = resolvePath(ctx.workspace, params.path?.trim() ? params.path : ".");
        assertReadable(ctx, target);
        if (!existsSync(target)) return errorResult(`Not found: ${target}`);
        const entries = readdirSync(target, { withFileTypes: true })
          .filter((e) => !e.name.startsWith(".") || e.name === ".env.example")
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
        return textResult(entries.join("\n") || "(empty directory)");
      } catch (e) {
        return errorResult(`list_dir failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  };
}

export function createGlob(ctx: ToolContext): BuiltTool {
  return {
    name: "glob",
    label: "Find files",
    description:
      "Find files whose path matches a glob pattern, e.g. `**/*.ts` or `src/**/*.test.ts`. " +
      "Searched from the workspace root or the given directory.",
    parameters: Type.Object({
      pattern: Type.String({ description: "Glob pattern, e.g. `**/*.ts`." }),
      path: Type.Optional(Type.String({ description: "Directory to search from." })),
    }),
    execute: async (_toolCallId, params: { pattern: string; path?: string }) => {
      try {
        const root = resolvePath(ctx.workspace, params.path?.trim() ? params.path : ".");
        assertReadable(ctx, root);
        if (!existsSync(root)) return errorResult(`Not found: ${root}`);
        const re = globToRegExp(params.pattern.replace(/^\.\//, ""));
        const matches = walkDir(root)
          .map((full) => path.relative(root, full))
          .filter((rel) => re.test(rel))
          .sort()
          .slice(0, 500);
        return textResult(matches.join("\n") || "(no matches)");
      } catch (e) {
        return errorResult(`glob failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  };
}

export function createGrep(ctx: ToolContext): BuiltTool {
  return {
    name: "grep",
    label: "Search content",
    description:
      "Search file contents with a regular expression and return matching lines with file:line. " +
      "Faster than reading every file when you need to locate a symbol.",
    parameters: Type.Object({
      pattern: Type.String({ description: "Regular expression to search for." }),
      path: Type.Optional(Type.String({ description: "Directory or file to search in." })),
      include: Type.Optional(Type.String({ description: "Optional glob filter, e.g. `*.ts`." })),
    }),
    execute: async (_toolCallId, params: { pattern: string; path?: string; include?: string }) => {
      try {
        const target = resolvePath(ctx.workspace, params.path?.trim() ? params.path : ".");
        assertReadable(ctx, target);
        if (!existsSync(target)) return errorResult(`Not found: ${target}`);
        let re: RegExp;
        try {
          re = new RegExp(params.pattern);
        } catch {
          return errorResult(`Invalid regular expression: ${params.pattern}`);
        }
        const includeRe = params.include ? globToRegExp(`**/${params.include}`) : null;
        const files = statSync(target).isDirectory() ? walkDir(target) : [target];
        const hits: string[] = [];
        for (const file of files) {
          if (hits.length >= 200) break;
          if (includeRe) {
            const rel = path.relative(target, file);
            if (!includeRe.test(rel) && !globToRegExp(params.include!).test(path.basename(file))) {
              continue;
            }
          }
          let content: string;
          try {
            content = readFileSync(file, "utf8");
          } catch {
            continue; // binary or unreadable
          }
          content.split("\n").forEach((line, i) => {
            if (hits.length >= 200) return;
            if (re.test(line)) hits.push(`${file}:${i + 1}: ${line.trimEnd()}`);
          });
        }
        return textResult(hits.join("\n") || NO_MATCH_HINT);
      } catch (e) {
        return errorResult(`grep failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  };
}
