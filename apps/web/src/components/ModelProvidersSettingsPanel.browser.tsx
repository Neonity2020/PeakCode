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

const CUSTOM_PROVIDER = {
  name: "Custom Display",
  apiKey: "old",
  baseUrl: "https://old.test",
};

async function mountPanel(providers?: ModelProvidersFile["providers"]) {
  const file: ModelProvidersFile = {
    path: "/custom/models.json",
    providers: providers ?? { custom: { ...CUSTOM_PROVIDER, models: [{ id: "old-model" }] } },
  };
  api.listModelProviders.mockResolvedValue(file);
  api.saveModelProviders.mockImplementation(async (input: ServerSaveModelProvidersInput) => ({
    path: file.path,
    providers: Object.fromEntries(
      Object.entries(input.providers).map(([key, provider]) => [
        key,
        { ...provider, name: provider.name ?? key },
      ]),
    ),
  }));
  api.testModelProvider.mockResolvedValue({ status: "success", model: "custom/old-model" });
  // Desktop width: the model rows and dialog are meant for the settings pane.
  await page.viewport(1164, 900);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await render(
    <QueryClientProvider client={client}>
      <I18nProvider language="en">
        <ModelProvidersSettingsPanel agentDir="/custom" />
      </I18nProvider>
    </QueryClientProvider>,
  );
  await page.getByRole("button", { name: /Custom Display/ }).click();
}

it("adds a model through the dialog, keeping unsupported input kinds out of pi's input", async () => {
  await mountPanel();
  await page.getByRole("button", { name: "Add model", exact: true }).click();

  const modelId = page.getByRole("textbox", { name: "Model ID", exact: true });
  await expect.element(modelId).toBeVisible();
  await expect
    .element(page.getByRole("textbox", { name: "Context window" }))
    .toHaveValue("1000000");
  await expect
    .element(page.getByRole("textbox", { name: "Max output tokens" }))
    .toHaveValue("128000");

  // Text input is locked on: clicking the chip cannot clear the selection.
  const textChip = page.getByRole("checkbox", { name: "Text" }).first();
  await expect.element(textChip).toHaveAttribute("aria-checked", "true");
  await textChip.click();
  await expect.element(textChip).toHaveAttribute("aria-checked", "true");

  // Save stays enabled; an empty id is reported on the field instead.
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect.element(modelId).toHaveAttribute("aria-invalid", "true");
  await expect.element(page.getByText("deepseek-v4-pro")).not.toBeInTheDocument();

  await modelId.fill("deepseek-v4-pro");
  await page.getByRole("checkbox", { name: "Image" }).click();
  await page.getByRole("checkbox", { name: "Video" }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();

  await expect.element(page.getByText("deepseek-v4-pro")).toBeVisible();

  await page.getByRole("button", { name: "Save changes" }).click();
  await expect
    .poll(() => api.saveModelProviders.mock.calls[0]?.[0])
    .toEqual({
      agentDir: "/custom",
      providers: {
        custom: {
          name: "Custom Display",
          apiKey: "old",
          baseUrl: "https://old.test",
          models: [
            { id: "old-model" },
            {
              id: "deepseek-v4-pro",
              contextWindow: 1_000_000,
              maxTokens: 128_000,
              // pi rejects any other value in `input`; video goes to the
              // pi-ignored `inputTypes` extension key instead.
              input: ["text", "image"],
              inputTypes: ["text", "image", "video"],
            },
          ],
        },
      },
    });
  await expect.element(page.getByText("You have unsaved changes.")).not.toBeInTheDocument();
});

it("clears fields, removes models, and resets the dirty state after saving", async () => {
  await mountPanel();
  await page.getByRole("textbox", { name: "Base URL", exact: true }).fill("");
  await page.getByRole("textbox", { name: "Display name", exact: true }).first().fill("");
  await page.getByRole("button", { name: "Remove model old-model" }).click();
  await expect.element(page.getByRole("button", { name: "Test connection" })).toBeDisabled();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect
    .poll(() => api.saveModelProviders.mock.calls[0]?.[0])
    .toEqual({
      agentDir: "/custom",
      providers: { custom: { apiKey: "old" } },
    });
  await expect.element(page.getByText("You have unsaved changes.")).not.toBeInTheDocument();
  await expect.element(page.getByRole("button", { name: "Test connection" })).toBeEnabled();
});

it("edits an existing model in place, seeding the dialog from its config", async () => {
  await mountPanel({
    custom: {
      ...CUSTOM_PROVIDER,
      models: [
        { id: "old-model", contextWindow: 32000, maxTokens: 8000, input: ["text", "image"] },
      ],
    },
  });
  await page.getByRole("button", { name: "Edit old-model" }).click();
  await expect.element(page.getByText("Edit model", { exact: true })).toBeVisible();
  await expect.element(page.getByRole("textbox", { name: "Context window" })).toHaveValue("32000");
  await expect
    .element(page.getByRole("checkbox", { name: "Image" }))
    .toHaveAttribute("aria-checked", "true");

  await page.getByRole("checkbox", { name: "PDF" }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();

  // Replaces the existing entry instead of appending a second one.
  await expect.element(page.getByRole("button", { name: "Edit old-model" })).toBeVisible();
  await expect
    .element(page.getByRole("button", { name: "Edit old-model 2" }))
    .not.toBeInTheDocument();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect
    .poll(() => api.saveModelProviders.mock.calls[0]?.[0])
    .toEqual({
      agentDir: "/custom",
      providers: {
        custom: {
          name: "Custom Display",
          apiKey: "old",
          baseUrl: "https://old.test",
          models: [
            {
              id: "old-model",
              contextWindow: 32000,
              maxTokens: 8000,
              input: ["text", "image"],
              inputTypes: ["text", "image", "pdf"],
            },
          ],
        },
      },
    });
});

it("tests the saved model in the same directory and displays the result", async () => {
  await mountPanel();
  await page.getByRole("button", { name: "Test connection" }).click();
  await expect
    .poll(() => api.testModelProvider.mock.calls[0]?.[0])
    .toEqual({
      agentDir: "/custom",
      provider: "custom",
      modelId: "old-model",
    });
  await expect
    .element(page.getByRole("status"))
    .toHaveTextContent("Connection successful (custom/old-model)");
});
