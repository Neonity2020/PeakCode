/**
 * Web 检索：`web_search` 工具的后端。
 *
 * 原实现把"用哪个搜索源、怎么过代理、结果怎么解析"写死在 OmniStudio 里。那些决策属于
 * 宿主应用（密钥、代理策略、合规），不属于 agent 工具箱，所以这里只留一个端口：
 * 宿主用 `setWebSearchProvider()` 挂上自己的实现，没挂就如实回答"未配置"。
 */
export interface WebSearchHit {
  title: string;
  url: string;
  snippet: string;
}

export type WebSearchOutcome = {
  ok: boolean;
  results: WebSearchHit[];
  error?: string | undefined;
  /** 本次结果由哪个搜索源给出（host 自填，展示在工具输出里）。 */
  provider?: string | undefined;
};

export type WebSearchProvider = (query: string) => Promise<WebSearchOutcome>;

let provider: WebSearchProvider | null = null;

export function setWebSearchProvider(next: WebSearchProvider | null): void {
  provider = next;
}

export function webSearchProvider(): WebSearchProvider | null {
  return provider;
}

export async function webSearch(query: string): Promise<WebSearchOutcome> {
  const trimmed = query.trim();
  if (!trimmed) return { ok: false, error: "empty query", results: [] };
  if (!provider) {
    return { ok: false, error: "web search is not configured on this host", results: [] };
  }
  try {
    return await provider(trimmed);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      results: [],
    };
  }
}
