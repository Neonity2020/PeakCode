/**
 * ToolSupport - Shared tool constants, path/permission guards, result helpers and the tool contract types.
 *
 * @module ToolSupport
 */

import path from "node:path";

import { AgentTool, AgentToolResult, AgentToolUpdateCallback } from "@earendil-works/pi-agent-core";

import { getSetting } from "../runtime/settings.ts";
import { isAgentDataPath } from "../runtime/paths.ts";

import { capToolResultText, isSpillPath } from "../agent-spill.ts";

import { logEvent } from "../runtime/log.ts";

/**
 * Agent 可使用的工具集。
 *
 * 权限模型（对齐 PI-Desktop 的思路：特权操作必须显式放行）：
 * - 只读工具（read_file / list_dir / glob / grep / web_search）可访问工作区之外的
 *   绝对路径，因为"读"不产生副作用；
 * - 写操作（write_file / edit_file / apply_patch）与 shell（bash）只能作用于工作区目录内，
 *   且 shell 还受 AGENT_ALLOW_SHELL 开关控制。
 */

export type ToolContext = {
  /** Agent 的工作区根目录（所有相对路径的基准）。 */
  workspace: string;
  /** 是否允许执行 shell 命令。 */
  allowShell: boolean;
  /**
   * 当前模型是否接受图片输入（决定要不要给 view_image 工具，见 chat-model 的探测）。
   * 不确定时不要开：把图片塞进纯文本模型的请求会被服务端直接 400。
   */
  vision?: boolean;
  /**
   * 工作区之外已授权的目录（权限弹窗里「始终允许」写入的 + 设置页手工添加的）。
   * 命中这些目录的读写不再被路径层拦住（授权弹窗已经收过用户确认）。
   */
  authorizedFolders?: string[];
  /** 当前会话 / 消息：待办、提问、产出物登记都要带上归属。 */
  conversationId?: number;
  messageId?: number | null;
  /** 写待办清单（agent.ts 注入，落库 + 推送 UI）。 */
  onTodoWrite?: (todos: { content: string; status?: string; priority?: string }[]) => void;
  /** 向用户提问并等待答复（agent.ts 注入）。 */
  askUser?: (
    questions: {
      question: string;
      header?: string;
      options?: { label: string; description?: string }[];
      multiple?: boolean;
    }[],
  ) => Promise<string[][]>;
  /**
   * 派子智能体执行子任务，返回它的最终答复（agent.ts 注入）。
   *
   * `subagentType` 是注册表里的句柄（内置 explore/general/review 也在此列）。另外几个
   * 字段来自注册表解析：`model` 为 null 表示跟着主 Agent 走，`tools` 为空表示不限制。
   * 宿主用它们去开一个真正独立的会话，而不是复用主 Agent 的上下文。
   *
   * `name` 只用于展示：一次派发会变成界面上的一行 worker（名字 + 角色 + 模型 + 状态），
   * 只报句柄的话那一行就会显示成 `explore` 这样的内部标识。
   */
  spawnSubagent?: (opts: {
    description: string;
    prompt: string;
    subagentType: string;
    /** 该 worker 的显示名（注册表 name）；缺省时宿主回退到句柄。 */
    name?: string;
    /** 该 worker 绑定的模型 slug；null/缺省 = 继承主 Agent 当前模型。 */
    model?: string | null;
    /** 该 worker 的额外系统提示（注册表 systemPrompt），拼在派发提示之前。 */
    systemPrompt?: string;
    /** 该 worker 的工具白名单；空数组 = 不限制。 */
    tools?: readonly string[];
  }) => Promise<string>;
  /** 登记产出物（agent.ts 注入）。 */
  recordArtifact?: (filePath: string, tool: string) => void;
  /** bash 命令超时（毫秒），默认 120 秒；测试 / 特殊场景可以调小。 */
  commandTimeoutMs?: number;
  /**
   * 系统提示的 token 估算（agent.ts 注入）：`get_context_remaining` 在
   * 没有实测用量时用它把系统提示算进占用，否则会低估一大截。
   */
  systemPromptTokens?: number;
  /**
   * 沙箱升级（agent.ts 注入）：命令被沙箱拦下后，问用户要不要**跳过沙箱重跑一次**。
   * 返回 null = 允许重试；返回字符串 = 拒绝原因（原样回给模型）。
   * 无人值守（自动化 / `omi agent run`）不注入 —— 没人可问，就如实报告被拦。
   */
  escalateSandbox?: (input: { command: string; output: string }) => Promise<string | null>;
  /** 打一个探索打点（agent.ts 注入，见 checkpoint / rewind）。 */
  onCheckpoint?: (goal: string) => ToolOutcome;
  /** 收网点：用结论替换掉打点之后的中间过程（agent.ts 注入）。 */
  onRewind?: (input: { report: string; revertFiles: boolean }) => Promise<ToolOutcome>;
  /** Goal 模式的目标操作（agent.ts 注入，见 bun/agent-goals.ts）。 */
  onGoal?: (input: {
    op: string;
    objective?: string;
    acceptance?: string;
    outcome?: string;
  }) => ToolOutcome;
  /** Plan 模式唯一能写的东西：把方案写到数据目录里（agent.ts 注入）。 */
  onWritePlan?: (content: string) => ToolOutcome;
  /**
   * 定时任务（自动化）的创建与管理（宿主注入，见宿主的 automation 模块）。
   * 只在 Agent / Goal 模式下可用：Plan 模式一行都不许改，而"排一个以后会自己跑的任务"
   * 是要落库、以后会真的动手的事，不属于"只出方案"。
   */
  onScheduleTask?: (params: ScheduleTaskToolParams) => ToolOutcome | Promise<ToolOutcome>;
  /**
   * 在看板卡片上留一条进度评论（宿主注入，见宿主的 kanban 模块）。
   *
   * 只有从看板派发出去的那条会话认得回去的卡片：宿主用会话 id 反查任务，
   * 所以模型不需要（也不该）自己带任务 id。不是看板任务时宿主会如实说明。
   */
  onKanbanComment?: (params: KanbanCommentToolParams) => ToolOutcome | Promise<ToolOutcome>;
  /**
   * 读回这张卡片的历史：需求原文、之前几轮做过什么、用户在卡片上说过什么。
   *
   * 派发时塞进提示词的只有**当前**这一版需求；需求改过几版、上一轮为什么被中断、
   * 用户反馈了什么问题，都留在卡片的评论区里。二次派发时先读一次再动手，
   * 比从零猜要靠谱。同样由宿主按会话反查卡片，模型不带任何 id。
   */
  onKanbanTask?: () => ToolOutcome | Promise<ToolOutcome>;
  /**
   * 驱动本条会话的应用内浏览器（宿主注入，见宿主的 browser 模块）。
   *
   * 只有跑在桌面端、且拿到了 browser-use 管道路径的会话才注入这个回调 ——
   * 无头 / CLI 会话没有浏览器面板可驱动，工具在那些会话里根本不注册
   * （和 `view_image` 只在模型收得下图片时才注册是同一个理由）。
   */
  onBrowser?: (params: BrowserToolParams) => ToolOutcomeWithImage | Promise<ToolOutcomeWithImage>;
  /**
   * 驱动这台 Mac 上的桌面应用（宿主注入，见宿主的 computer 模块）。
   *
   * 和 `browser` 同一个理由只在真的能驱动时才注入：helper 没装、没启动、或者不在 macOS 上，
   * 会话里就没有这个动词，列出来只会让模型去调一个注定失败的工具。
   */
  onComputer?: (params: ComputerToolParams) => ToolOutcomeWithImage | Promise<ToolOutcomeWithImage>;
};

/**
 * `schedule_task` 的入参。
 *
 * 字段名是给模型看的接口（跟其它工具一致用 snake_case），宿主再映射到内部契约。
 */
export type ScheduleTaskToolParams = {
  /** create | list | set_enabled */
  op: string;
  /** create：任务名（列表和会话标题里靠它辨认）。 */
  title?: string;
  /** create：这一轮要做什么 —— 就是发给 Agent 的那句话。 */
  instructions?: string;
  /** create：once | daily | weekly。 */
  schedule_kind?: string;
  /** create + once：ISO 时间，唯一一次执行的时刻。 */
  at?: string;
  /** create + daily/weekly：当地时间的时（0-23）。 */
  hour?: number;
  /** create + daily/weekly：当地时间的分（0-59）。 */
  minute?: number;
  /** create + weekly：星期几（0=周日 … 6=周六），可多选。 */
  days_of_week?: number[];
  /** create：IANA 时区名，缺省用当前时区。 */
  timezone?: string;
  /** create：default | plan | goal，缺省 default。 */
  mode?: string;
  /** create：换一个工作区（项目 id）跑，缺省用当前会话所在的工作区。 */
  project_id?: string;
  /** set_enabled：要暂停 / 恢复的任务 id（list 会给）。 */
  automation_id?: string;
  /** set_enabled：true 恢复，false 暂停。 */
  enabled?: boolean;
};

/**
 * `kanban_comment` 的入参。
 *
 * 只有 body：卡片由宿主按会话反查，模型不该也不需要在参数里指认任务。
 */
export type KanbanCommentToolParams = {
  /** 这一条进度：做完了什么、拿什么证明的、下一步是什么。 */
  body: string;
};

/**
 * `browser` 的入参。
 *
 * 一个工具 + `action` 判别式，而不是十八个工具：浏览器操作是一轮紧接一轮的
 * 「看一眼 → 动一下 → 再看一眼」，拆成十几个工具只会让每一步都多背一份 schema，
 * 而它们本来就是同一份状态（同一个标签页、同一份快照）上的不同动词。
 *
 * 字段名是给模型看的接口（跟其它工具一致用 snake_case），宿主再映射到 CDP 命令。
 */
export type BrowserToolParams = {
  /** 见 `BROWSER_ACTIONS`。 */
  action: string;
  /** navigate / new_tab：目标地址。 */
  url?: string;
  /** 指定标签页；缺省用本条会话上次选中的那个。 */
  tab_id?: number;
  /** 动作目标：最近一次 snapshot 给的 ref。 */
  ref?: string;
  /** type：要插入的文本。 */
  text?: string;
  /** press：一个键或一组组合键（`cmd+a`、`Enter`）。 */
  key?: string;
  /** select_option：要选中的 option（value 或可见文本）。 */
  value?: string;
  /** evaluate / wait_for：页面上下文里的表达式。 */
  expression?: string;
  /** wait_for：轮询到它变成真为止的表达式。 */
  condition?: string;
  /** click / hover / scroll：视觉兜底坐标（视口 CSS px）。 */
  x?: number;
  y?: number;
  /** scroll：滚动量。 */
  delta_x?: number;
  delta_y?: number;
  /** click：left | right | middle，缺省 left。 */
  button?: string;
  /** click：双击。 */
  double?: boolean;
  /** 组合键修饰符：cmd / ctrl / alt / shift（macOS 用 cmd）。 */
  modifiers?: string[];
  /** screenshot：整页而不是当前视口。 */
  full_page?: boolean;
  /** snapshot：最多保留多少个元素。 */
  max_elements?: number;
  /** wait_for：超时毫秒数。 */
  timeout_ms?: number;
};

/**
 * `computer` 的入参。
 *
 * 和 `browser` 同样的形状：一个工具 + `action` 判别式，因为桌面操作同样是
 * 「看一眼 → 动一下 → 再看一眼」，而这些动词本来就共享同一份观察状态。
 *
 * 与浏览器的差别在于这一层不持有任何状态：观察状态（state_id → 元素）在 helper 进程里，
 * 因为元素句柄只在产生它的那次观察里有意义，放在别处迟早会指向错的控件。
 *
 * 字段名是给模型看的接口（跟其它工具一致用 snake_case），宿主再映射到 helper 的方法。
 */
export type ComputerToolParams = {
  /** 见 `COMPUTER_ACTIONS`。 */
  action: string;
  /** get_state / open_app：应用名（用户会说的那个）或 bundle id。 */
  app?: string;
  /** get_state / open_app：按进程号定位。 */
  pid?: number;
  /** open_app：还没运行时用完整 .app 路径启动。 */
  path?: string;
  /** get_state：`focused`（缺省，只看最前面的窗口）或 `all`。 */
  scope?: string;
  /** act：ref 所属的那次观察的 state_id。 */
  state_id?: string;
  /** act：该次观察里给元素编的号。 */
  ref?: number;
  /** act：press | focus | raise | set_value。 */
  element_action?: string;
  /** act(set_value)：要写进去的文本。 */
  value?: string;
  /** click：最近一张截图里的像素坐标。 */
  x?: number;
  y?: number;
  /** click：left | right | middle，缺省 left。 */
  button?: string;
  /** click：连点次数，双击传 2。 */
  count?: number;
  /** type：要插入的文本。 */
  text?: string;
  /** key：一个键或一组组合键（`cmd+a`、`Enter`）。 */
  key?: string;
  /** scroll：up | down | left | right —— 内容是往哪边看（`down` = 看更下面的内容）。 */
  direction?: string;
  /** scroll：滚多少；缺省 3 行，unit=pixel 时缺省 240 像素。 */
  amount?: number;
  /** scroll：line（缺省，一格一行，和真实滚轮一致）或 pixel。 */
  unit?: string;
  /** drag：按下、移动、松开的一条路径，起点与终点都用截图里的像素坐标。 */
  from_x?: number;
  from_y?: number;
  to_x?: number;
  to_y?: number;
  /** drag：整段拖拽的时长（缺省 400ms）。太快会被应用当成点击，太慢人会等。 */
  duration_ms?: number;
  /** drag：拖拽期间按住的修饰键，如 `cmd`、`shift`。 */
  modifiers?: string;
  /** type：keys（缺省，逐字按键）或 paste（写剪贴板再按 ⌘V，长文本和中文更稳）。 */
  strategy?: string;
  /** screenshot：抓 list_windows 给出的某个窗口，而不是目标应用最前面的那个。 */
  window_id?: number;
  /** list_windows：连菜单、面板这类非普通层窗口一起列。 */
  include_all_layers?: boolean;
  /** screenshot：抓整个屏幕而不是目标应用最前面的窗口。 */
  full_screen?: boolean;
};

/**
 * 工具结果的形状：`textResult` / `errorResult` 的并集。
 * 主进程里自己实现工具回调（checkpoint / rewind）时用它，避免手搓一套字段
 * —— 内核的 `AgentToolResult` 并没有 `isError`，失败是 `details.error` 表达的。
 */
export type ToolOutcome = {
  content: { type: "text"; text: string }[];
  details: Record<string, unknown>;
};

/**
 * 工具结果，额外允许图片块。
 *
 * `ToolOutcome` 只描述文本结果；截图类工具要把 PNG/JPEG 作为图片块交回模型
 * （和 `view_image` 同一套形状），所以 `onBrowser` 需要更宽的返回类型。
 */
export type ToolOutcomeWithImage = {
  content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[];
  details: Record<string, unknown>;
};

/**
 * 各个工具的 schema 不同，无法直接放进同一个 `AgentTool<any>[]`
 * （`Static<any>` 解析成 unknown，会把 execute 的入参反向约束掉）。
 * 这里把 execute 的入参放宽成 any，既保留每个工具内部的精确类型，
 * 又能组装成异构数组交给 Pi Agent。
 */
export type BuiltTool = Omit<AgentTool<any>, "execute"> & {
  execute: (
    toolCallId: string,
    params: any,
    signal?: AbortSignal,
    onUpdate?: AgentToolUpdateCallback<any>,
  ) => Promise<AgentToolResult<any>>;
};

/**
 * 报错要给出**下一步动作**，不能只说"找不到"。
 *
 * 弱模型拿到一句 `File not found: /x/y` 之后最常见的两种反应是：原样再试一次，
 * 或者干脆换去猜别的文件。把"怎么找"直接写在错误里，比让它自己悟便宜得多。
 */

export const NOT_FOUND_HINT =
  "。先别重试同一个路径：用 list_dir 看父目录里到底有什么、或用 glob 按文件名片段找（例如 `**/*名字*`），" +
  "确认真实路径后再读。";

/** 编辑类工具的"定位失败"提示：旧内容匹配不上，通常是文件已经变了。 */
export const EDIT_MISMATCH_HINT =
  "。文件内容与你手上的不一致（可能在上次读之后被改过，或你自己记错了）。" +
  "先 read_file 把当前内容读回来，用读到的原文重新组织这次替换；不要反复猜同一段文本。";

/**
 * 空结果也要给出下一步。
 *
 * "没找到"不等于"不存在"：可能是关键词太窄、大小写不对、或搜错了目录。
 * 直接告诉模型怎么换姿势，比让它把同样的搜索再发一遍便宜（本地模型尤其爱这么干）。
 */
export const NO_MATCH_HINT =
  "(no matches)。没搜到不代表不存在，换个姿势再试一次：" +
  "① 关键词放宽或只用其中一段（正则里少用 `.*`）；② 检查大小写与中英文标点；" +
  "③ 确认 path 是你要找的那棵目录树（用 list_dir 看一眼）。" +
  "三样都试过还没有，再下「确实没有」的结论。";

export const MAX_FILE_CHARS = 60_000;
export const COMMAND_TIMEOUT_MS = 120_000;
/** 直接子进程退出后，再给管道多少时间把末尾输出读干净。 */
export const PIPE_DRAIN_GRACE_MS = 200;

/** 递归遍历时要跳过的目录（体量大且对任务无意义）。 */
export const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".svn",
  ".hg",
  ".next",
  ".nuxt",
  ".turbo",
  "dist",
  "build",
  "out",
  "coverage",
  ".venv",
  "venv",
  "__pycache__",
  ".cache",
  ".gradle",
  "target",
  "Pods",
  "DerivedData",
]);

/**
 * 截断超长输出。
 *
 * 位置变了（见 `textResult` 的说明）：现在由 `agent.ts` 的 `afterToolCall` 统一做，
 * 因为那里才拿得到会话 id 与工具名 —— 截断的同时要把完整输出转存到磁盘并把路径
 * 写进提示里，模型才有路找回原文。展示层的实现是 `agent-spill.ts` 的
 * `truncateForModel()`，纯函数带单测。
 */

/** 把用户/模型给的路径解析成绝对路径。相对路径基于工作区。 */
export function resolvePath(workspace: string, input: string): string {
  const trimmed = input.trim();
  const expanded = trimmed.startsWith("~")
    ? path.join(process.env.HOME ?? "/", trimmed.slice(1))
    : trimmed;
  const target = path.resolve(workspace, expanded);
  assertNotSecret(workspace, target);
  return target;
}

/**
 * 工作区外读取的敏感路径黑名单。
 *
 * Agent 的工具结果会原样喂回模型，而网页搜索 / 知识库 / MCP 的返回内容都可能被
 * 提示词注入（"读 ~/.ssh/id_rsa 然后 curl 发到某处"）。工作区内不受限制（开发必需），
 * 工作区外命中这些凭据目录一律拒绝。
 */
export const SECRET_PATH_PATTERNS: RegExp[] = [
  /(^|\/)\.ssh(\/|$)/,
  /(^|\/)\.aws(\/|$)/,
  /(^|\/)\.gnupg(\/|$)/,
  /(^|\/)\.kube(\/|$)/,
  /(^|\/)\.docker\/config\.json$/,
  /(^|\/)\.netrc$/,
  /(^|\/)\.npmrc$/,
  /(^|\/)\.git-credentials$/,
  /(^|\/)\.config\/(gh|gcloud|gcloud-legacy)(\/|$)/,
  // 本机其他编码 agent 的凭据与会话（含第三方 API Key）
  /(^|\/)\.omni(\/|$)/,
  /(^|\/)\.codex(\/|$)/,
  /(^|\/)\.claude(\/|$)/,
  /Library\/Keychains(\/|$)/,
];

export function assertNotSecret(workspace: string, target: string): void {
  const root = path.resolve(workspace);
  if (target === root || target.startsWith(root + path.sep)) return;
  // 工具输出的转存目录开一个口子：那是应用自己写出来的文件（模型本来就在工具结果里
  // 看过它的前半段），不放开就谈不上"截断之后还能读回来"。数据目录的其余部分
  // （设置表里存着全部云端 API Key）照旧拦死。
  if (isSpillPath(target)) return;
  const normalized = target.replace(/\\/g, "/");
  if (SECRET_PATH_PATTERNS.some((re) => re.test(normalized)) || isAgentDataPath(target)) {
    throw new Error(
      `Refusing to access a credential path outside the workspace: ${target}. ` +
        "Copy what you need into the workspace instead.",
    );
  }
}

/** 写操作必须落在工作区内（或已授权的目录里）。 */
export function assertInsideWorkspace(workspace: string, target: string) {
  const root = path.resolve(workspace);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error(`Path outside workspace is not writable: ${target}`);
  }
}

/** 已授权目录（设置里的 + 会话授权传入的），统一成绝对路径。 */
export function authorizedFoldersOf(ctx: ToolContext): string[] {
  const fromSettings = (() => {
    try {
      const parsed = JSON.parse(getSetting("AGENT_AUTHORIZED_FOLDERS"));
      return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
    } catch {
      return [];
    }
  })();
  return [...(ctx.authorizedFolders ?? []), ...fromSettings]
    .filter((value) => typeof value === "string" && value.trim().length > 0)
    .map((value) => path.resolve(value.replace(/^~/, process.env.HOME ?? "/")));
}

export function underAny(target: string, folders: string[]): boolean {
  const abs = path.resolve(target);
  return folders.some((folder) => abs === folder || abs.startsWith(folder + path.sep));
}

/**
 * 读权限：工作区内随便读；工作区外必须落在已授权目录里。
 * 凭据路径（SECRET_PATH_PATTERNS）始终拒绝，授权也不放行。
 *
 * 唯一的例外是工具输出的转存目录（`agent-spill.ts`）：那是应用自己从工具结果里
 * 写出来的文件，用户已经授权过产生它的那次工具调用，内容模型本来也看过前半段。
 * 不放行的话，"截断之后用 read_file 读回原文"会变成每读一次弹一次授权窗 ——
 * 提示词里那句建议就成了空话。范围只有这一个子目录。
 */
export function assertReadable(ctx: ToolContext, target: string): void {
  const root = path.resolve(ctx.workspace);
  const abs = path.resolve(target);
  if (abs === root || abs.startsWith(root + path.sep)) return;
  if (isSpillPath(abs)) return;
  if (underAny(abs, authorizedFoldersOf(ctx))) return;
  throw new Error(
    `需要授权才能访问工作区之外的路径：${abs}。` +
      "请在授权弹窗里允许，或把需要的文件复制进工作区。",
  );
}

/** 写权限：工作区内或已授权目录。 */
export function assertWritable(ctx: ToolContext, target: string): void {
  const root = path.resolve(ctx.workspace);
  const abs = path.resolve(target);
  if (abs === root || abs.startsWith(root + path.sep)) return;
  if (underAny(abs, authorizedFoldersOf(ctx))) return;
  throw new Error(`Path outside workspace is not writable without permission: ${abs}`);
}

/**
 * 工具结果的**展示层截断**搬到了 `agent.ts` 的 `afterToolCall`（那里同时做超限转存）。
 *
 * 这里只留一道内存防呆：`bash` 的输出在读完之前不知道有多大，一条 `yes` 能吐出
 * 几百 MB —— 超过硬上限直接丢尾部并说明原因，免得把事件流和数据库一起拖垮。
 * 也就是说：工具结果在内存里可以是长的，**进入模型上下文之前**才被裁到 24k 字符
 * （并落盘一份完整版，见 `agent-spill.ts`）。
 */
export function textResult(text: string) {
  return { content: [{ type: "text" as const, text: capToolResultText(text) }], details: {} };
}

export function errorResult(message: string) {
  // Agent 的工具失败 = 用户看到的「它说做不了」：统一日志里留一份，
  // 事后能回答"当时是哪个工具、报的什么"，而不是只能靠界面上的只言片语。
  logEvent({
    level: "warn",
    source: "agent",
    event: "agent.tool.failed",
    message: message.slice(0, 500),
  });
  return { content: [{ type: "text" as const, text: message }], details: { error: message } };
}
