/**
 * 会话事件流（时间轴的原始素材）。
 *
 * 原实现把每条事件写进 `agent_events` 表再推给界面。表的读写属于宿主会话层，
 * 这里保留**事件本身的形状**与一个内存事件日志：宿主订阅 `onAgentEvent` 就能把事件
 * 转成自己的持久化 / 推送，`agent-history` 也直接按同一形状回填工具调用配对。
 */
export type AgentEventKind =
  | "status"
  | "tool_start"
  | "tool_end"
  | "error"
  | "subagent_start"
  | "subagent_end"
  /**
   * 模型在**某一步**说的话（正文片段）。
   *
   * 一条助手消息的正文是整轮拼接的（多个步骤的话连成一整块），正文里没有
   * "这句话说在哪次工具调用之前"这个信息；而界面要的是时间轴：说了什么 →
   * 调了什么工具 → 又说了什么。所以每个步骤的正文额外落成一条带顺序的事件。
   */
  | "text";

export type AgentEventRow = {
  id: number;
  conversationId: number;
  messageId: number | null;
  kind: AgentEventKind;
  toolName: string | null;
  /** JSON 字符串，UI 渲染时再解析。 */
  args: string | null;
  output: string | null;
  isError: number;
  /** 子智能体事件的归属 id（主 Agent 的事件为 null）。 */
  subagentId: string | null;
  createdAt: number;
};

export type AgentToolInfo = {
  name: string;
  label: string;
  description: string;
  /** 工具分类：read（只读）/ write（有副作用）/ interact（与用户交互）。 */
  group: "read" | "write" | "interact";
  /** 该工具是否需要授权（UI 里用盾牌标记）。 */
  gated: boolean;
};

export type AgentMode = "agent" | "plan" | "goal";
export const AGENT_MODES: readonly AgentMode[] = ["agent", "plan", "goal"];

export type AgentThinkingLevel = "off" | "low" | "medium" | "high";
export const AGENT_THINKING_LEVELS: readonly AgentThinkingLevel[] = [
  "off",
  "low",
  "medium",
  "high",
];

export type AgentRunState = {
  conversationId: number;
  running: boolean;
  mode: AgentMode;
  workspace: string;
};

export type AgentEventInput = {
  conversationId: number;
  messageId?: number | null;
  kind: AgentEventKind;
  toolName?: string | null;
  args?: string | null;
  output?: string | null;
  isError?: boolean;
  subagentId?: string | null;
};

type Listener = (event: AgentEventRow) => void;
const listeners = new Set<Listener>();
const rows = new Map<number, AgentEventRow[]>();

let seq = 0;

export function onAgentEvent(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** 记录一条事件并推给订阅者。返回落定的事件行（含分配到的 id 与时间戳）。 */
export function recordAgentEvent(input: AgentEventInput): AgentEventRow {
  seq += 1;
  const row: AgentEventRow = {
    id: seq,
    conversationId: input.conversationId,
    messageId: input.messageId ?? null,
    kind: input.kind,
    toolName: input.toolName ?? null,
    args: input.args ?? null,
    output: input.output ?? null,
    isError: input.isError ? 1 : 0,
    subagentId: input.subagentId ?? null,
    createdAt: Date.now(),
  };
  const existing = rows.get(row.conversationId);
  if (existing) existing.push(row);
  else rows.set(row.conversationId, [row]);
  for (const listener of listeners) listener(row);
  return row;
}

/** 某个会话的事件，按记录顺序。`afterId` 用于增量补齐。 */
export function listAgentEvents(conversationId: number, afterId = 0): AgentEventRow[] {
  return (rows.get(conversationId) ?? []).filter((row) => row.id > afterId);
}

/** 删掉一个会话的事件（清空会话 / 重新开始）。 */
export function deleteConversationEvents(conversationId: number): void {
  rows.delete(conversationId);
}
