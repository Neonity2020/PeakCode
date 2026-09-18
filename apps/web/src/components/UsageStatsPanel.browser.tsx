import "../index.css";
import type {
  ServerGetUsageSessionDetailResult,
  ServerUsageStatisticsResult,
  ServerUsageStatisticsSource,
} from "@peakcode/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { I18nProvider } from "../i18n";
import { UsageStatsPanel } from "./UsageStatsPanel";

const api = vi.hoisted(() => ({
  getUsageStatistics: vi.fn(),
  getUsageSessionDetail: vi.fn(),
}));
vi.mock("../nativeApi", () => ({ ensureNativeApi: () => ({ server: api }) }));

afterEach(() => vi.resetAllMocks());

function localDateKey(day: number): string {
  const date = new Date(2026, 8, day);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function iso(day: number, hour: number, minute = 0): string {
  return new Date(2026, 8, day, hour, minute).toISOString();
}

const source = (
  id: ServerUsageStatisticsSource["id"],
  label: string,
  input: Partial<ServerUsageStatisticsSource>,
): ServerUsageStatisticsSource => ({
  id,
  label,
  roots: [`/Users/tester/.${id}`],
  active: true,
  tokens: 0,
  responses: 0,
  sessions: 0,
  models: 0,
  lastUsedAt: null,
  ...input,
});

/** Two tools on one machine, so the filter and the breakdown both have something to say. */
const statistics: ServerUsageStatisticsResult = {
  generatedAt: iso(18, 10),
  source: "local-agent-logs",
  windowDays: 400,
  earliestAt: iso(16, 9),
  latestAt: iso(18, 10),
  totals: {
    tokens: 1_400,
    inputTokens: 900,
    outputTokens: 200,
    cacheReadTokens: 300,
    cacheWriteTokens: 0,
    reasoningTokens: 20,
    peakDayTokens: 900,
    peakDay: localDateKey(18),
    longestChatMs: 2 * 60 * 60 * 1_000,
    currentStreakDays: 3,
    longestStreakDays: 3,
    activeDays: 3,
    sessions: 2,
    responses: 3,
  },
  sources: [
    source("zcode", "ZCode", {
      tokens: 1_100,
      responses: 2,
      sessions: 1,
      models: 1,
      lastUsedAt: iso(18, 10),
    }),
    source("pi", "Pi", {
      tokens: 300,
      responses: 1,
      sessions: 1,
      models: 1,
      lastUsedAt: iso(17, 10),
    }),
    source("grok", "Grok Build", { active: false, roots: ["/Users/tester/.grok/sessions"] }),
  ],
  days: [
    {
      date: localDateKey(16),
      tokens: 200,
      responses: 1,
      bySource: [
        {
          source: "pi",
          tokens: 200,
          responses: 1,
          models: [{ model: "deepseek-v4.1", tokens: 200 }],
        },
      ],
    },
    {
      date: localDateKey(17),
      tokens: 100,
      responses: 1,
      bySource: [
        {
          source: "pi",
          tokens: 100,
          responses: 1,
          models: [{ model: "deepseek-v4.1", tokens: 100 }],
        },
      ],
    },
    {
      date: localDateKey(18),
      tokens: 1_100,
      responses: 1,
      bySource: [
        {
          source: "zcode",
          tokens: 1_100,
          responses: 1,
          models: [{ model: "deepseek-v4", tokens: 1_100 }],
        },
      ],
    },
  ],
  models: [
    {
      model: "deepseek-v4",
      tokens: 1_100,
      responses: 2,
      sources: ["zcode"],
      lastUsedAt: iso(18, 10),
    },
    {
      model: "deepseek-v4.1",
      tokens: 300,
      responses: 1,
      sources: ["pi"],
      lastUsedAt: iso(17, 10),
    },
  ],
  sessions: [
    {
      source: "zcode",
      sessionId: "sess-zcode",
      project: "PeakCode",
      startedAt: iso(18, 9),
      endedAt: iso(18, 11),
      tokens: 1_100,
      responses: 4,
      models: ["deepseek-v4"],
      hasRequestDetail: true,
    },
    {
      source: "pi",
      sessionId: "sess-pi",
      project: "Workspace",
      startedAt: iso(16, 9),
      endedAt: iso(16, 10),
      tokens: 300,
      responses: 2,
      models: ["deepseek-v4.1"],
      hasRequestDetail: false,
    },
  ],
};

const sessionDetail: ServerGetUsageSessionDetailResult = {
  source: "zcode",
  sessionId: "sess-zcode",
  project: "PeakCode",
  tokens: 1_100,
  responses: 2,
  droppedRequests: 0,
  requests: [
    {
      sequence: 1,
      timestamp: iso(18, 9, 30),
      model: "deepseek-v4",
      tokens: 600,
      inputTokens: 500,
      outputTokens: 100,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
    {
      sequence: 2,
      timestamp: iso(18, 10, 15),
      model: "deepseek-v4",
      tokens: 500,
      inputTokens: 400,
      outputTokens: 100,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
  ],
};

const emptyStatistics: ServerUsageStatisticsResult = {
  ...statistics,
  earliestAt: null,
  latestAt: null,
  totals: {
    ...statistics.totals,
    tokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    reasoningTokens: 0,
    peakDayTokens: 0,
    peakDay: null,
    longestChatMs: 0,
    currentStreakDays: 0,
    longestStreakDays: 0,
    activeDays: 0,
    sessions: 0,
    responses: 0,
  },
  days: [],
  models: [],
  sessions: [],
  sources: statistics.sources.map((entry) => ({ ...entry, active: false, tokens: 0, sessions: 0 })),
};

async function mountPanel(
  payload: ServerUsageStatisticsResult = statistics,
  language: "en" | "zh" = "en",
) {
  api.getUsageStatistics.mockResolvedValue(payload);
  api.getUsageSessionDetail.mockResolvedValue(sessionDetail);
  await page.viewport(1280, 1400);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await render(
    <QueryClientProvider client={client}>
      <I18nProvider language={language}>
        <UsageStatsPanel />
      </I18nProvider>
    </QueryClientProvider>,
  );
}

it("reports the whole machine's totals and lists every tool", async () => {
  await mountPanel();

  await expect.element(page.getByText("Local usage")).toBeVisible();
  await expect.element(page.getByText("Total tokens")).toBeVisible();
  await vi.waitFor(() => {
    expect(document.querySelector('[data-usage-tool-row="zcode"]')?.textContent).toContain("ZCode");
  });
  expect(document.querySelector('[data-usage-tool-row="pi"]')).not.toBeNull();
  // A tool with no records is still listed, with where its logs were looked for.
  const inactiveRow = document.querySelector('[data-usage-tool-row="grok"]');
  expect(inactiveRow?.textContent).toContain("No records found");
  // The mix has to add up: 900 input + 200 output + 300 cache read of 1.4K total.
  const mix = document.querySelector('[data-slot="usage-token-mix"]')?.textContent ?? "";
  expect(mix).toContain("Input");
  expect(mix).toContain("64%");
  expect(mix).toContain("21%");

  // The unfiltered page asks for every tool at once.
  await vi.waitFor(() => expect(api.getUsageStatistics).toHaveBeenCalledWith({}));
});

it("filters every aggregate down to one tool", async () => {
  await mountPanel();
  await expect.element(page.getByText("Total tokens")).toBeVisible();

  const zcodeChip = document.querySelector('[data-usage-filter="zcode"]');
  expect(zcodeChip).not.toBeNull();
  await page.elementLocator(zcodeChip!).click();

  await vi.waitFor(() =>
    expect(api.getUsageStatistics).toHaveBeenLastCalledWith({ source: "zcode" }),
  );
  // The trend card names what it is showing so a filtered page is never ambiguous.
  await expect.element(page.getByText("Daily token trend · ZCode")).toBeVisible();
});

it("keeps inactive tools out of the filter chips", async () => {
  await mountPanel();
  await vi.waitFor(() => {
    expect(document.querySelector('[data-usage-filter="zcode"]')).not.toBeNull();
  });

  expect(document.querySelector('[data-usage-filter="grok"]')).toBeNull();
  expect(document.querySelector('[data-usage-filter="zcode"]')).not.toBeNull();
});

it("opens a session's request log on demand", async () => {
  await mountPanel();
  await expect.element(page.getByText("Recent sessions")).toBeVisible();

  // Detail is not fetched until the session is actually opened.
  expect(api.getUsageSessionDetail).not.toHaveBeenCalled();
  const session = document.querySelector('[data-usage-session="sess-zcode"]');
  expect(session).not.toBeNull();
  await page.elementLocator(session!).click();

  await vi.waitFor(() =>
    expect(api.getUsageSessionDetail).toHaveBeenCalledWith({
      source: "zcode",
      sessionId: "sess-zcode",
    }),
  );
  const dialog = document.querySelector('[data-slot="usage-session-dialog"]');
  await vi.waitFor(() => expect(dialog?.textContent).toContain("deepseek-v4"));
  expect(dialog?.textContent).toContain("600");
  expect(dialog?.textContent).toContain("400");
});

it("leaves a session without retained requests unclickable", async () => {
  await mountPanel();
  await expect.element(page.getByText("Recent sessions")).toBeVisible();

  const button = document.querySelector('[data-usage-session="sess-pi"]');
  expect(button?.hasAttribute("disabled")).toBe(true);
});

it("refreshes by rescanning instead of trusting the cache", async () => {
  await mountPanel();
  await expect.element(page.getByText("Total tokens")).toBeVisible();

  await page.getByRole("button", { name: "Refresh" }).click();

  await vi.waitFor(() =>
    expect(api.getUsageStatistics).toHaveBeenLastCalledWith({ refresh: true }),
  );
});

it("explains an empty machine instead of drawing empty charts", async () => {
  await mountPanel(emptyStatistics);

  await expect.element(page.getByText("No usage recorded yet")).toBeVisible();
  await expect.element(page.getByText("Tool usage")).not.toBeInTheDocument();
});

it("labels the panel in the active language", async () => {
  await mountPanel(statistics, "zh");

  await expect.element(page.getByText("本机用量")).toBeVisible();
  await expect.element(page.getByText("工具用量")).toBeVisible();
  await expect.element(page.getByText("Token 构成")).toBeVisible();
  await expect.element(page.getByText("最近会话")).toBeVisible();
});
