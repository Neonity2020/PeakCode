import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";

import { createBash, createKnowledgeSearch, createWebSearch } from "./tools/execTools.ts";
import { createTaskTool } from "./tools/integrationTools.ts";
import { createAskUser, createGoalTool, createTodoWrite } from "./tools/interactionTools.ts";
import { createBrowserTool } from "./tools/browserTools.ts";
import { createComputerTool } from "./tools/computerTools.ts";
import {
  createCheckpoint,
  createReadSkill,
  createRewind,
  createThink,
  createWebFetch,
} from "./tools/miscTools.ts";
import { createGlob, createGrep, createListDir, createReadFile } from "./tools/readTools.ts";
import {
  BrowserToolParams,
  ComputerToolParams,
  KanbanCommentToolParams,
  ScheduleTaskToolParams,
  ToolOutcome,
  ToolOutcomeWithImage,
  errorResult,
  textResult,
} from "./tools/toolSupport.ts";
import {
  createApplyPatch,
  createContextRemaining,
  createEditFile,
  createRequestPermissions,
  createViewImage,
  createWriteFile,
} from "./tools/writeTools.ts";

import {
  createKanbanCommentTool,
  createKanbanTaskTool,
  createScheduleTaskTool,
} from "./tools/integrationTools.ts";
import { createWritePlan } from "./tools/interactionTools.ts";
import { BuiltTool, ToolContext } from "./tools/toolSupport.ts";
import path from "node:path";
import type { Readable } from "node:stream";
import type {
  AgentTool,
  AgentToolResult,
  AgentToolUpdateCallback,
} from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";

import { applyPatch } from "./apply-patch.ts";
import { isInsideWorkspace } from "./permissions.ts";
import {
  explainSandboxDenial,
  logSandboxDegraded,
  sandboxActive,
  wrapShellCommand,
} from "./agent-sandbox.ts";
import { contextUsage, describeContextUsage } from "./agent-context.ts";
import { getSetting } from "./runtime/settings.ts";
import { isAgentDataPath } from "./runtime/paths.ts";
import { killProcessTree } from "./runtime/proc.ts";
import { sleep, spawnProcess } from "./runtime/spawn.ts";
import { webSearch } from "./web-search.ts";
import { listKnowledgeBases, recall } from "./knowledge.ts";
import { readSkillFile, skillsPromptSection } from "./agent-skills.ts";
import { capToolResultText, isSpillPath } from "./agent-spill.ts";
import { audit } from "./skills/audit.ts";
import { logEvent } from "./runtime/log.ts";

/**
 * Agent 可使用的工具集。
 *
 * 权限模型（对齐 PI-Desktop 的思路：特权操作必须显式放行）：
 * - 只读工具（read_file / list_dir / glob / grep / web_search）可访问工作区之外的
 *   绝对路径，因为"读"不产生副作用；
 * - 写操作（write_file / edit_file / apply_patch）与 shell（bash）只能作用于工作区目录内，
 *   且 shell 还受 AGENT_ALLOW_SHELL 开关控制。
 */

export type {
  BrowserToolParams,
  BuiltTool,
  ComputerToolParams,
  KanbanCommentToolParams,
  ScheduleTaskToolParams,
  ToolContext,
  ToolOutcome,
  ToolOutcomeWithImage,
} from "./tools/toolSupport.ts";
export { errorResult, textResult } from "./tools/toolSupport.ts";
// The tool's own vocabulary, next to the tool: callers that have to agree with it — the server's
// contract tests, the permission rules — read it from here rather than restating the list.
export { COMPUTER_ACTIONS, computerArgsError } from "./tools/computerTools.ts";

export function buildReadOnlyTools(ctx: ToolContext): BuiltTool[] {
  return [
    createReadFile(ctx),
    createListDir(ctx),
    createGlob(ctx),
    createGrep(ctx),
    // 看图是只读的，但只在模型真的能收图片时才给（见 ToolContext.vision）。
    ...(ctx.vision ? [createViewImage(ctx)] : []),
    createWebSearch(),
    createWebFetch(),
    createKnowledgeSearch(),
    createReadSkill(),
    createThink(),
    createCheckpoint(ctx),
    createRewind(ctx),
    createTodoWrite(ctx),
    createAskUser(ctx),
    createContextRemaining(ctx),
    createRequestPermissions(ctx),
  ];
}

/** 完整工具集：Agent / Goal 模式下可用，包含写文件与 shell。 */
export function buildAgentTools(ctx: ToolContext): BuiltTool[] {
  return [
    ...buildReadOnlyTools(ctx),
    createWriteFile(ctx),
    createEditFile(ctx),
    createApplyPatch(ctx),
    createWritePlan(ctx),
    createGoalTool(ctx),
    createScheduleTaskTool(ctx),
    createKanbanCommentTool(ctx),
    createKanbanTaskTool(ctx),
    // 浏览器只在宿主真的注入了面板回调时才注册：无头 / CLI 会话没有可驱动的
    // 浏览器面板，列出来只会让模型去调一个注定失败的动词（同 view_image 的理由）。
    // 它算写操作（点一下可能就提交了表单），所以 Plan 模式由模式过滤关掉，见 agentToolkitMode。
    ...(ctx.onBrowser ? [createBrowserTool(ctx)] : []),
    // 桌面控制同理：helper 没起来就没有可驱动的桌面，注册了也只是让模型去撞墙。
    // 它同样算写操作（一次点击可能就是一次提交），所以 Plan 模式由模式过滤关掉，
    // 见 agentToolkitMode。
    ...(ctx.onComputer ? [createComputerTool(ctx)] : []),
    createBash(ctx),
    createTaskTool(ctx),
  ];
}
