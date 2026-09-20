// FILE: ImChannelsSettingsPanel.browser.tsx
// Purpose: Locks in how the Channels panel treats typed credentials: each card keeps its
//          own unsaved values, the action that opens a card is not labelled "Save", and
//          leaving the section with half-typed secrets asks first.
// Layer: Component browser tests

import "../index.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import type { ImStatusSnapshot, ServerSettings } from "@peakcode/contracts";

import { I18nProvider } from "../i18n";
import { ImChannelsSettingsPanel } from "./ImChannelsSettingsPanel";

const api = vi.hoisted(() => ({ getSettings: vi.fn(), updateSettings: vi.fn() }));
const imApi = vi.hoisted(() => ({
  getStatus: vi.fn(),
  listConversations: vi.fn(),
  forgetConversation: vi.fn(),
  testChannel: vi.fn(),
  startRemoteAccess: vi.fn(),
  stopRemoteAccess: vi.fn(),
}));
const blocker = vi.hoisted(() => vi.fn());

vi.mock("../nativeApi", () => ({ ensureNativeApi: () => ({ server: api }) }));
vi.mock("../lib/imApi", () => ({ imApi, imApiErrorMessage: (error: unknown) => String(error) }));
vi.mock("../store", () => ({
  useStore: (select: (state: { projects: unknown[] }) => unknown) => select({ projects: [] }),
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useBlocker: blocker,
}));

const imSettings = {
  defaultProjectId: "",
  sessionIdleHours: 12,
  runtimeMode: "approval-required",
  wechat: { botToken: "", botId: "", baseUrl: "", cursor: "" },
  feishu: { domain: "feishu", appId: "", appSecret: "" },
  qq: { appId: "", appSecret: "" },
  wecom: { corpId: "", agentId: "", secret: "", callbackToken: "", encodingAesKey: "" },
  wechatMp: { appId: "", appSecret: "", callbackToken: "", encodingAesKey: "" },
  webhooks: { wecomUrl: "", dingtalkUrl: "", dingtalkSecret: "", secret: "" },
  remoteAccess: { enabled: false, binaryPath: "", url: null },
};

const statusFixture = {
  channels: [],
  log: [],
  idleHours: 12,
  remoteAccess: { state: "off", allowed: true, url: null },
} as unknown as ImStatusSnapshot;

async function mountPanel() {
  api.getSettings.mockResolvedValue({ im: imSettings } as unknown as ServerSettings);
  api.updateSettings.mockImplementation(
    async () => ({ im: imSettings }) as unknown as ServerSettings,
  );
  imApi.getStatus.mockResolvedValue(statusFixture);
  imApi.listConversations.mockResolvedValue([]);

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider language="en">
        <ImChannelsSettingsPanel />
      </I18nProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

it("opens a card with an Edit action, not a save", async () => {
  await mountPanel();

  await expect
    .element(page.getByRole("button", { name: "Edit", exact: true }).first())
    .toBeVisible();
  // The credential fields are not on screen until a card is opened, and nothing claims to
  // have saved anything.
  await expect.element(page.getByRole("textbox", { name: "App ID" })).not.toBeInTheDocument();
  expect(page.getByRole("button", { name: "Save", exact: true }).elements()).toHaveLength(0);
});

it("keeps each card's typed credentials while another card is opened", async () => {
  await mountPanel();

  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  const appId = page.getByRole("textbox", { name: "App ID", exact: true });
  await appId.fill("cli_typed_by_hand");

  // Opening another channel's card used to wipe the first one's draft on the way in.
  await page.getByRole("button", { name: "Edit", exact: true }).nth(1).click();
  await expect.element(appId).not.toBeInTheDocument();

  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  await expect.element(appId).toHaveValue("cli_typed_by_hand");

  // Nothing has been written yet: the card still has to be saved on purpose.
  expect(api.updateSettings).not.toHaveBeenCalled();
});

it("arms the leave guard while a credential is typed and not yet saved", async () => {
  await mountPanel();
  await expect.poll(() => blocker.mock.calls.at(-1)?.[0]?.disabled).toBe(true);

  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  await page.getByRole("textbox", { name: "App ID", exact: true }).fill("cli_typed_by_hand");
  expect(blocker.mock.calls.at(-1)?.[0]?.disabled).toBe(false);

  // Cancelling the card is an explicit discard, so the guard goes quiet again.
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect.poll(() => blocker.mock.calls.at(-1)?.[0]?.disabled).toBe(true);
});
