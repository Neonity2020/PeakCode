/**
 * 知识库检索：`knowledge_search` 工具的后端。
 *
 * 原实现直接调用 OmniStudio 的向量库（1782 行：分块、嵌入、重排、媒体命中……）。
 * 那套东西和宿主的存储、模型、索引策略绑死，不属于 agent 工具箱。这里只留端口：
 * 宿主用 `setKnowledgeProvider()` 挂上自己的检索实现，没挂就等于"没有知识库"，
 * `knowledge_search` 会如实告诉模型这一点（而不是报一个看起来像 bug 的错误）。
 */
export interface KnowledgeBaseInfo {
  id: number;
  name: string;
}

export interface KnowledgeHit {
  docName: string;
  seq: number;
  kbName: string;
  score: number;
  content: string;
  /** 媒体命中（图片 / 音频 / 视频）时标记类型，正文可能为空。 */
  modality?: "image" | "audio" | "video" | null;
}

export interface KnowledgeRecallOptions {
  actor?: string;
  topK?: number;
}

export interface KnowledgeProvider {
  listKnowledgeBases(): KnowledgeBaseInfo[];
  recall(
    kbIds: number[],
    query: string,
    topK: number | undefined,
    opts: KnowledgeRecallOptions,
  ): Promise<{ hits: KnowledgeHit[] }>;
}

let provider: KnowledgeProvider | null = null;

export function setKnowledgeProvider(next: KnowledgeProvider | null): void {
  provider = next;
}

export function knowledgeProvider(): KnowledgeProvider | null {
  return provider;
}

export function listKnowledgeBases(): KnowledgeBaseInfo[] {
  if (!provider) return [];
  try {
    return provider.listKnowledgeBases();
  } catch {
    return [];
  }
}

export async function recall(
  kbIds: number[],
  query: string,
  topK?: number,
  opts: KnowledgeRecallOptions = {},
): Promise<{ hits: KnowledgeHit[] }> {
  if (!provider) return { hits: [] };
  return provider.recall(kbIds, query, topK, opts);
}
