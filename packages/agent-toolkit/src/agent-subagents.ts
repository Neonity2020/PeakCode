/**
 * 子智能体注册表（Multi-Agent 模式）。
 *
 * Multi-Agent 模式和 Plan / Goal 的差别在**谁来干**：Plan 只出方案，Goal 是一路自己跑，
 * Multi-Agent 是**分出去跑**。主 Agent 只做四件事 —— 拆解、派发、检查、合并 —— 具体
 * 的子任务交给一组命名好的"子智能体"（worker）执行，每个 worker 有自己的系统提示、
 * 自己的工具白名单，以及**自己的模型**。
 *
 * 最后一条是这个功能真正的价值：同一轮编排里，规划/合并这种要脑子的活可以用大模型，
 * 而被派出去翻文件、跑搜索的 worker 用小模型就够了 —— 大小模型组合把成本压下来，
 * 同时不牺牲最终结论的质量。
 *
 * 所以这个模块负责三件事（缺了任何一件，Multi-Agent 就只剩一段提示词）：
 * 1. **注册表**：worker 从哪来、叫什么、用什么模型 —— 落库，设置页里可增删改；
 * 2. **解析**：模型给的 `subagent` 句柄 → 真正要跑的那份（提示词 / 工具 / 模型）；
 * 3. **注入**：把 worker 名册和编排协议写进主 Agent 的系统提示，否则模型不知道
 *    "可以派人"、"能派谁"、"派完要检查再合并"。
 *
 * 存储：整张注册表序列化成 JSON 存在 toolkit 设置里（`AGENT_SUBAGENTS`）。注册表是
 * 一份整体配置，读多写少，用 KV 一个 key 比新开一张表更省事，也不必再做一次迁移。
 * 判定"用内置默认还是用户配置"看的是**这个 key 存在与否**，而不是列表是否为空 ——
 * 用户把 worker 全删了是一个合法状态（保存成 `[]`），不能删完又冒出一批默认值。
 */
import { getSetting, updateSettings } from "./runtime/settings.ts";

export type AgentSubAgent = {
  /** 稳定句柄，模型在 `task` 里传的就是它。 */
  id: string;
  name: string;
  /** 给设置页和主 Agent 名册看的一句话。 */
  description: string;
  /** 每次派活时追加给 worker 的额外指令；空 = 只带派发提示。 */
  systemPrompt: string;
  /** 工具白名单；空 = 不限制（全套 agent 工具）。 */
  tools: readonly string[];
  /** 模型 slug；null = 继承主 Agent 当前模型（设置页显示为"继承默认"）。 */
  model: string | null;
  enabled: boolean;
};

const SUB_AGENTS_SETTING_KEY = "AGENT_SUBAGENTS";

/** 只读 worker 的工具集：翻文件、搜网页、读技能，一律不落笔。 */
const EXPLORE_TOOLS = [
  "read_file",
  "list_dir",
  "glob",
  "grep",
  "view_image",
  "web_search",
  "web_fetch",
  "knowledge_search",
  "read_skill",
  "think",
  "get_context_remaining",
] as const;

/** 没有配置过时给出的三个 worker：调研、干事、审阅。 */
export const DEFAULT_SUB_AGENTS: readonly AgentSubAgent[] = [
  {
    id: "explore",
    name: "Explore",
    description: "只读调研工作区：找到所有相关位置，只回一段能自包含的结论。",
    systemPrompt: "",
    tools: EXPLORE_TOOLS,
    model: null,
    enabled: true,
  },
  {
    id: "general",
    name: "General",
    description: "全能力 worker，用于「这一块独立做完」的活（仍受权限策略约束）。",
    systemPrompt: "",
    tools: [],
    model: null,
    enabled: true,
  },
  {
    id: "review",
    name: "Review",
    description: "审阅当前工作区未提交的改动，按「能证明的影响」给结论。",
    systemPrompt: "",
    tools: EXPLORE_TOOLS,
    model: null,
    enabled: true,
  },
];

/** 兼容旧的 `task` 调用：explore/general/review 三个内置类型仍然认。 */
export const BUILTIN_SUBAGENT_IDS: readonly string[] = DEFAULT_SUB_AGENTS.map((agent) => agent.id);

/** 句柄规范化：小写、去空白、空格换横线。空串返回空串（交给调用方决定怎么兜底）。 */
export function normalizeSubAgentId(raw: string | null | undefined): string {
  return (raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

/**
 * 把一条落库记录解成 worker。
 *
 * 解析失败 / 字段缺失一律按"更保守"的方向兜底：`enabled` 缺省为 true（列表里看得见），
 * `model` 缺省为 null（继承默认，绝不悄悄换模型）。`id` 或 `name` 为空则丢弃该条 ——
 * 一个派不出去也认不出来的 worker 留在注册表里只会让名册出现幽灵条目。
 */
function decodeSubAgent(value: unknown): AgentSubAgent | null {
  const record = asRecord(value);
  if (!record) return null;
  const id = normalizeSubAgentId(asString(record.id) || asString(record.name));
  const name = asString(record.name).trim() || id;
  if (!id || !name) return null;
  const modelRaw = record.model;
  return {
    id,
    name,
    description: asString(record.description),
    systemPrompt: asString(record.systemPrompt),
    tools: asStringArray(record.tools),
    model: typeof modelRaw === "string" && modelRaw.trim().length > 0 ? modelRaw.trim() : null,
    enabled: record.enabled !== false,
  };
}

function decodeRegistry(raw: string): AgentSubAgent[] | null {
  if (!raw.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const seen = new Set<string>();
    const agents: AgentSubAgent[] = [];
    for (const entry of parsed) {
      const agent = decodeSubAgent(entry);
      if (!agent || seen.has(agent.id)) continue;
      seen.add(agent.id);
      agents.push(agent);
    }
    return agents;
  } catch {
    // 配置坏了不能让整个设置页 / 编排瘫痪：当作"没配过"，退回内置默认。
    return null;
  }
}

/** 拷贝一份内置 worker，免得调用方改到模块常量（`tools` 是数组，必须一起拷）。 */
function cloneDefaultSubAgent(agent: AgentSubAgent): AgentSubAgent {
  return { ...agent, tools: [...agent.tools] };
}

/** 当前注册表。没配过 = 内置默认；配过（哪怕空数组）= 用户配置。 */
export function listSubAgents(): AgentSubAgent[] {
  const stored = decodeRegistry(getSetting(SUB_AGENTS_SETTING_KEY));
  return stored ?? DEFAULT_SUB_AGENTS.map(cloneDefaultSubAgent);
}

/** 可以派活的 worker（注册表里 enabled 的那些）。 */
export function enabledSubAgents(): AgentSubAgent[] {
  return listSubAgents().filter((agent) => agent.enabled);
}

export function getSubAgent(id: string | null | undefined): AgentSubAgent | null {
  const normalized = normalizeSubAgentId(id);
  if (!normalized) return null;
  return listSubAgents().find((agent) => agent.id === normalized) ?? null;
}

function persist(agents: readonly AgentSubAgent[]): AgentSubAgent[] {
  updateSettings({ [SUB_AGENTS_SETTING_KEY]: JSON.stringify(agents) });
  return listSubAgents();
}

/** 按 id 新增或整体替换。id 为空时用 name 生成一个。返回保存后的完整注册表。 */
export function saveSubAgent(input: {
  id?: string | null;
  name: string;
  description?: string;
  systemPrompt?: string;
  tools?: readonly string[];
  model?: string | null;
  enabled?: boolean;
}): AgentSubAgent[] {
  const name = input.name.trim();
  const id = normalizeSubAgentId(input.id) || normalizeSubAgentId(name);
  if (!id) return listSubAgents();
  const next: AgentSubAgent = {
    id,
    name: name || id,
    description: input.description?.trim() ?? "",
    systemPrompt: input.systemPrompt?.trim() ?? "",
    tools: (input.tools ?? []).map((tool) => tool.trim()).filter((tool) => tool.length > 0),
    model: input.model && input.model.trim().length > 0 ? input.model.trim() : null,
    enabled: input.enabled !== false,
  };
  const agents = listSubAgents();
  const index = agents.findIndex((agent) => agent.id === id);
  if (index >= 0) agents[index] = next;
  else agents.push(next);
  return persist(agents);
}

export function deleteSubAgent(id: string): AgentSubAgent[] {
  const normalized = normalizeSubAgentId(id);
  return persist(listSubAgents().filter((agent) => agent.id !== normalized));
}

/**
 * 主 Agent 的 worker 名册。
 *
 * 为空时返回 null（一个 worker 都没有，就不该宣传这套玩法）。模型只被告知**存在哪些
 * worker 和各自的模型**，不被告知 prompt / 工具细节 —— 那是 worker 自己的事。
 */
export function subAgentRosterSection(): string | null {
  const agents = enabledSubAgents();
  if (agents.length === 0) return null;
  const lines = agents.map((agent) => {
    const model = agent.model ? `，模型 ${agent.model}` : "，模型随主 Agent";
    const summary = agent.description || "（未填写说明）";
    return `- \`${agent.id}\`（${agent.name}${model}）：${summary}`;
  });
  return ["## 可派发的子智能体", "", ...lines].join("\n");
}

/**
 * Multi-Agent 模式的行为协议。
 *
 * 这段提示词只教**流程**：说清分析 → 拆 → 派（并行）→ 验 → 合 → 收报告。具体派谁、
 * 什么模型由名册决定。几条字面约束都是刻意的：
 * - **先分析、先开口**：用户最不能接受的是"上来就创建一大堆、也不说为什么"。所以第 0 步
 *   必须是一段普通回复文字 —— 讲清拆成了哪几块、为什么这么拆、每块派给谁、各自交付什么
 *   —— 然后才允许调用 `task`。这段文字就是界面上的"编排说明"，也是用户唯一的判断依据。
 * - **开工就并行派发**：用户切到 Multi-Agent 就是不想看主 Agent 一个人慢慢串行做完。
 *   第一轮就把请求拆成 2–4 块独立工作面，在同一轮里连续调用 `task`；pi 会把同一条
 *   消息里的工具调用并发执行，界面上也会同时列出这几个 worker 在跑。
 * - "拿不准就自己动手"：并行不是目的。请求确实只有一个工作面（改一行、答一个问题）时
 *   硬拆成多块只会更慢更贵，这时自己做 —— 但同样要先说明为什么这次不拆。
 * - "worker 看不到你的上下文"：逼它把子任务写成自包含的说明 —— 这是派发失败最常见的原因。
 * - **派完必须收报告**：worker 的结论停留在它自己的上下文里，主 Agent 不主动收齐就等于
 *   把它们丢了。最后一段必须是给用户的成品（报告 / 总结 / 文档），不是"都做完了"。
 */
export const MULTI_AGENT_PROTOCOL = [
  "## Multi-Agent 编排协议",
  "",
  "你现在是编排者（orchestrator），不是唯一的执行者。按下面的流程推进这一轮：",
  "",
  "0. **先分析，并把分析写出来**：在调用任何 `task` 之前，先用一段普通回复文字告诉用户你",
  "   的判断 —— 这个请求由哪几块工作面组成、为什么是这几块、每块交给哪个 worker（什么",
  "   模型）、各自要交付什么。这段话是用户理解你在干什么的唯一入口，**必须出现在界面上**，",
  "   而不是只留在你的思考里；不要一句话不说就默默派发一堆 worker。",
  "   如果判断这次不该拆（只有一个工作面），同样先用一句话说明为什么自己做。",
  "1. **拆解**：把用户请求拆成若干个子任务，标出它们的依赖关系（谁必须先做完）。",
  "   默认按 2–4 个子任务来拆。只有当请求确实只有一个工作面（改一行、答一个事实问题）",
  "   才自己做 —— 拿不准就自己动手是为了不把简单请求拆得更慢，不是串行干活的理由。",
  "2. **并行派发**：对每个子任务调用 `task`，用 `subagent` 指定名册里的 worker 句柄。",
  "   **相互独立的子任务必须在同一轮里连续调用 `task`** —— 它们会并发执行，界面会同时",
  "   展示这几个 worker 各自的进展；一个做完再派下一个等于把并行退化成串行。",
  "   有依赖的子任务才等前一个的结论回来再派。",
  "3. **写清任务**：worker 看不到你的上下文，也看不到用户原话。`prompt` 必须是自包含的：",
  "   目标、已知条件、要交付什么、验收标准，一次讲清。",
  "4. **检查**：每个 worker 返回后，对照它的验收标准判断够不够。不够就带着具体缺口再派一次",
  "   （同一个 worker 或换一个），不要拿一段含糊的结论去凑数。",
  "5. **收齐报告**：等所有派出去的 worker 都回来，把它们各自的结论**逐条收进来**再动手。",
  "   漏掉任何一份都等于把已经花掉的工作扔了；有 worker 失败或被中断时，把它算作缺口",
  "   写进结论，不要让报告看起来是全绿的。",
  "6. **合并成成品并交付**：把各 worker 的结论合成一份完整答复 —— 开发类任务要给出整合后的",
  "   总结：每块由谁/什么模型完成、实际改了什么（文件 / 命令 / 输出作为证据）、结论是什么、",
  "   哪里冲突、还有什么没做或存疑。内容多或需要留档时，整理成一份文档（写进工作区并在回复里",
  "   给出路径）；否则就在回复里直接输出这份总结。**不要用「都做完了」当交付物。**",
].join("\n");

/**
 * Multi-Agent 模式注入主 Agent 系统提示的整段内容。
 *
 * 没有可用 worker 时返回 null：只宣传协议却不给名册，模型只能空转。
 */
export function multiAgentPromptSection(): string | null {
  const roster = subAgentRosterSection();
  if (!roster) return null;
  return [
    MULTI_AGENT_PROTOCOL,
    "",
    roster,
    "",
    "`task` 返回的是 worker 的最终结论（它自己的中间过程留在它自己的上下文里，不占你的窗口）。",
    "派出去之后不用替它们汇报过程：界面会实时列出每个 worker 的名字、模型和状态。",
    "但**开工前那段拆解说明，和收工后那份汇总报告，是你自己的活** —— 界面只展示 worker 的",
    "实时状态，不会替你解释为什么这么拆、也不会替你把它们的结论整理成结论。",
    "（这不是建议：没先说方案就调用 `task`，本轮第一次会被直接挡回来并提示你先说明。）",
  ].join("\n");
}
