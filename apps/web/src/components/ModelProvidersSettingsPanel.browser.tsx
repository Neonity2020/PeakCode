import "../index.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { page } from "vitest/browser";
import { afterEach, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import type { ModelProvidersFile, ServerSaveModelProvidersInput } from "@peakcode/contracts";
import { I18nProvider } from "../i18n";
import { ModelProvidersSettingsPanel } from "./ModelProvidersSettingsPanel";

const api = vi.hoisted(() => ({
  listModelProviders: vi.fn(),
  saveModelProviders: vi.fn(),
  testModelProvider: vi.fn(),
}));
vi.mock("../nativeApi", () => ({ ensureNativeApi: () => ({ server: api }) }));

afterEach(() => vi.resetAllMocks());

async function mountPanel() {
  const file: ModelProvidersFile = {
    path: "/custom/models.json",
    providers: { custom: { name: "Custom Display", apiKey: "old", baseUrl: "https://old.test", models: [{ id: "old-model" }] } },
  };
  api.listModelProviders.mockResolvedValue(file);
  api.saveModelProviders.mockImplementation(async (input: ServerSaveModelProvidersInput) => ({
    path: file.path,
    providers: Object.fromEntries(Object.entries(input.providers).map(([key, provider]) => [key, { ...provider, name: provider.name ?? key }])),
  }));
  api.testModelProvider.mockResolvedValue({ status: "success", model: "custom/old-model" });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await render(<QueryClientProvider client={client}><I18nProvider language="en"><ModelProvidersSettingsPanel agentDir="/custom" /></I18nProvider></QueryClientProvider>);
  await page.getByRole("button", { name: /Custom Display/ }).click();
}

it("clears fields, removes blank models, and resets the dirty state after saving", async () => {
  await mountPanel();
  await page.getByRole("textbox", { name: "Base URL", exact: true }).fill("");
  await page.getByRole("textbox", { name: "Display name", exact: true }).first().fill("");
  const modelId = page.getByRole("textbox", { name: "Model id", exact: true });
  await modelId.fill("replacement");
  await expect.element(modelId).toHaveFocus();
  await modelId.fill("");
  await expect.element(page.getByRole("button", { name: "Test connection" })).toBeDisabled();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect.poll(() => api.saveModelProviders.mock.calls[0]?.[0]).toEqual({
    agentDir: "/custom", providers: { custom: { apiKey: "old" } },
  });
  await expect.element(page.getByText("You have unsaved changes.")).not.toBeInTheDocument();
  await expect.element(page.getByRole("button", { name: "Test connection" })).toBeEnabled();
});

it("tests the saved model in the same directory and displays the result", async () => {
  await mountPanel();
  await page.getByRole("button", { name: "Test connection" }).click();
  await expect.poll(() => api.testModelProvider.mock.calls[0]?.[0]).toEqual({
    agentDir: "/custom", provider: "custom", modelId: "old-model",
  });
  await expect.element(page.getByRole("status")).toHaveTextContent("Connection successful (custom/old-model)");
});
