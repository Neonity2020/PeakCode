// FILE: PluginDetailDialog.browser.tsx
// Purpose: Verifies the plugin detail view: the read-only detail it renders from plugin
//          discovery, and the action that hands the plugin to the composer.
// Layer: Browser UI test
// Depends on: vitest browser rendering helpers, react-query, the i18n provider, and a
//             stubbed native API for the plugin read.

import "../index.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { NativeApi } from "@peakcode/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { I18nProvider } from "../i18n";
import { PluginDetailDialog } from "./PluginDetailDialog";
import type { PluginEntry } from "./useProviderDiscoveryData";

const PLUGIN_ENTRY: PluginEntry = {
  marketplaceName: "peakcode",
  marketplacePath: "/marketplaces/peakcode",
  isFeatured: true,
  plugin: {
    id: "browser-use",
    name: "browser-use",
    source: { type: "local", path: "/plugins/browser-use" },
    installed: true,
    enabled: true,
    installPolicy: "INSTALLED_BY_DEFAULT",
    authPolicy: "ON_INSTALL",
    interface: {
      displayName: "Browser Use",
      shortDescription: "Drive a real browser tab.",
      developerName: "Peak Code",
      category: "developer-tools",
      capabilities: ["browser", "screenshots"],
      defaultPrompt: ["Open the pricing page and tell me what the free tier includes."],
    },
  },
};

function stubNativeApi(readPlugin: NativeApi["provider"]["readPlugin"]): () => void {
  const previous = window.nativeApi;
  window.nativeApi = { provider: { readPlugin } } as unknown as NativeApi;
  return () => {
    if (previous === undefined) {
      delete window.nativeApi;
      return;
    }
    window.nativeApi = previous;
  };
}

async function mountDialog() {
  const onUsePlugin = vi.fn<(entry: PluginEntry) => void>();
  const host = document.createElement("div");
  document.body.append(host);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const screen = await render(
    <I18nProvider language="en">
      <QueryClientProvider client={queryClient}>
        <PluginDetailDialog
          entry={PLUGIN_ENTRY}
          onOpenChange={() => undefined}
          onUsePlugin={onUsePlugin}
          isUsingPlugin={false}
        />
      </QueryClientProvider>
    </I18nProvider>,
    { container: host },
  );

  return {
    onUsePlugin,
    cleanup: async () => {
      await screen.unmount();
      host.remove();
      queryClient.clear();
    },
  };
}

describe("PluginDetailDialog", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shows the read detail alongside what discovery already knew", async () => {
    const restoreNativeApi = stubNativeApi(async () => ({
      plugin: {
        marketplaceName: "peakcode",
        marketplacePath: "/marketplaces/peakcode",
        summary: PLUGIN_ENTRY.plugin,
        description: "A paragraph the manifest carries for the detail view.",
        skills: [
          {
            name: "browser-use",
            description: "How to drive the in-app browser.",
            path: "/skills/browser-use",
            enabled: true,
          },
        ],
        apps: [],
        mcpServers: [],
      },
    }));
    const dialog = await mountDialog();

    try {
      await expect.element(page.getByText("Browser Use")).toBeVisible();
      await expect.element(page.getByText("Peak Code · Developer tools")).toBeVisible();
      await expect
        .element(page.getByText("A paragraph the manifest carries for the detail view."))
        .toBeVisible();
      await expect.element(page.getByText("How to drive the in-app browser.")).toBeVisible();
      await expect
        .element(page.getByText("Open the pricing page and tell me what the free tier includes."))
        .toBeVisible();
    } finally {
      restoreNativeApi();
      await dialog.cleanup();
    }
  });

  it("hands the plugin to the caller when the use action is pressed", async () => {
    const restoreNativeApi = stubNativeApi(async () => {
      throw new Error("The read is not what this test is about.");
    });
    const dialog = await mountDialog();

    try {
      await page.getByTestId("plugin-detail-use").click();

      expect(dialog.onUsePlugin).toHaveBeenCalledTimes(1);
      expect(dialog.onUsePlugin.mock.calls[0]?.[0]).toBe(PLUGIN_ENTRY);
    } finally {
      restoreNativeApi();
      await dialog.cleanup();
    }
  });
});
