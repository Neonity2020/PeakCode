/**
 * 会话历史：`agent-context` 估算上下文占用时读的那一份。
 *
 * 原实现直接查 OmniStudio 的 messages 表。宿主本来就持有自己的会话存储
 * （PeakCode 是事件溯源投影，OmniStudio 是 SQLite），再让工具箱持有一份是重复的，
 * 所以这里只留端口：宿主用 `setHistoryProvider()` 把自己的历史接进来。
 * 没挂时 `getHistory` 返回空数组 —— 上下文占用会退化成"只算系统提示与工具"的估算，
 * 而不是报错。
 */
export interface HistoryMessage {
  id: number;
  role: string;
  content: string;
  createdAt: number;
}

export type HistoryProvider = (conversationId: number) => HistoryMessage[];

let provider: HistoryProvider | null = null;

export function setHistoryProvider(next: HistoryProvider | null): void {
  provider = next;
}

export function getHistory(conversationId: number): HistoryMessage[] {
  if (!provider) return [];
  try {
    return provider(conversationId);
  } catch {
    return [];
  }
}
