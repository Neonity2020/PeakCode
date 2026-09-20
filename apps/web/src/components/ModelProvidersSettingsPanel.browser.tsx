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
  listProviderModels: vi.fn(),
}));
vi.mock("../nativeApi", () => ({ ensureNativeApi: () => ({ server: api }) }));

afterEach(() => vi.resetAllMocks());

const CUSTOM_PROVIDER = {
  name: "Custom Display",
  apiKey: "old",
  baseUrl: "https://old.test",
};

/**
 * Stand-in for `models.json`: `list` serves back whatever `save` was last handed, so a
 * panel that is unmounted and mounted again sees exactly what it managed to persist.
 */
interface ProviderStore {
  providers: ModelProvidersFile["providers"];
}

function readStore(store: ProviderStore): ModelProvidersFile {
  return { path: "/custom/models.json", providers: store.providers };
}

async function mountPanel(
  providers?: ModelProvidersFile["providers"],
  opts?: { selectCustom?: boolean; store?: ProviderStore },
) {
  const store: ProviderStore = opts?.store ?? {
    providers: providers ?? { custom: { ...CUSTOM_PROVIDER, models: [{ id: "old-model" }] } },
  };
  api.listModelProviders.mockImplementation(async () => readStore(store));
  api.saveModelProviders.mockImplementation(async (input: ServerSaveModelProvidersInput) => {
    store.providers = Object.fromEntries(
      Object.entries(input.providers).map(([key, provider]) => [
        key,
        { ...provider, name: provider.name ?? key },
      ]),
    );
    return readStore(store);
  });
  api.testModelProvider.mockResolvedValue({ status: "success", model: "custom/old-model" });
  api.listProviderModels.mockResolvedValue({ models: [], url: "https://old.test/v1/models" });
  // Desktop width: the model rows and dialog are meant for the settings pane.
  await page.viewport(1164, 900);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rendered = await render(
    <QueryClientProvider client={client}>
      <I18nProvider language="en">
        <ModelProvidersSettingsPanel agentDir="/custom" />
      </I18nProvider>
    </QueryClientProvider>,
  );
  if (opts?.selectCustom !== false) {
    await page.getByRole("button", { name: /Custom Display/ }).click();
  }
  return rendered;
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

  // Adding a model is written straight out: no save bar, no separate save click.
  await expect
    .poll(() => api.saveModelProviders.mock.calls.at(-1)?.[0])
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

it("keeps a provider and a model added from the panel after leaving and re-entering it", async () => {
  const store: ProviderStore = { providers: {} };
  const first = await mountPanel(undefined, { selectCustom: false, store });

  // Configure a provider the way the reported flow does: a custom vendor, its endpoint
  // and key, then one model of its own.
  await page.getByRole("button", { name: "Add model provider", exact: true }).click();
  await page.getByRole("textbox", { name: "Display name", exact: true }).fill("StepFun 自建");
  await page.getByRole("textbox", { name: "Provider key", exact: true }).fill("Step");
  await page
    .getByRole("textbox", { name: "Base URL", exact: true })
    .fill("https://api.stepfun.com");
  await page.getByRole("textbox", { name: "API key", exact: true }).fill("sk-step-test");
  await page.getByRole("button", { name: "Add provider", exact: true }).click();

  await page.getByRole("button", { name: "Add model", exact: true }).click();
  await page.getByRole("textbox", { name: "Model ID", exact: true }).fill("water18-0910");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect.element(page.getByText("water18-0910")).toBeVisible();

  // Going back to the chat unmounts the panel; what the user configured has to be on
  // disk by then, not waiting for a save bar below the card.
  first.unmount();
  await mountPanel(undefined, { selectCustom: false, store });
  await page.getByRole("button", { name: "StepFun 自建", exact: true }).click();
  await expect.element(page.getByText("water18-0910")).toBeVisible();
});

it("writes a removed model out with the field edits made before it", async () => {
  await mountPanel();
  await page.getByRole("textbox", { name: "Base URL", exact: true }).fill("https://new.test");
  await page.getByRole("button", { name: "Remove model old-model" }).click();

  await expect
    .poll(() => api.saveModelProviders.mock.calls.at(-1)?.[0])
    .toEqual({
      agentDir: "/custom",
      providers: {
        custom: { ...CUSTOM_PROVIDER, baseUrl: "https://new.test" },
      },
    });
  await expect.element(page.getByText("You have unsaved changes.")).not.toBeInTheDocument();
});

it("saves pending edits before testing from the provider detail pane", async () => {
  await mountPanel();
  await page.getByRole("textbox", { name: "API key", exact: true }).fill("sk-updated");
  // Dirty draft: the click must persist the key first, then test the saved config.
  await page.getByRole("button", { name: "Test connection" }).click();
  await expect
    .poll(() => api.saveModelProviders.mock.calls[0]?.[0])
    .toEqual({
      agentDir: "/custom",
      providers: {
        custom: { ...CUSTOM_PROVIDER, apiKey: "sk-updated", models: [{ id: "old-model" }] },
      },
    });
  await expect
    .poll(() => api.testModelProvider.mock.calls[0]?.[0])
    .toEqual({ agentDir: "/custom", provider: "custom", modelId: "old-model" });
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
  await expect
    .poll(() => api.saveModelProviders.mock.calls.at(-1)?.[0])
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

it("pre-seeds un-enabled templates in the list and enables one via key + connection test", async () => {
  await mountPanel({}, { selectCustom: false });
  // A template candidate is listed even though it is not in models.json yet.
  const openaiRow = page.getByRole("button", { name: "OpenAI", exact: true });
  await expect.element(openaiRow).toBeVisible();

  // Selecting the un-enabled candidate opens the enable form, not the editor.
  await openaiRow.click();
  await expect.element(page.getByRole("heading", { name: "Enable OpenAI" })).toBeVisible();

  // The API key is required to enable.
  await expect.element(page.getByRole("button", { name: "Enable", exact: true })).toBeDisabled();

  const keyInput = page.getByRole("textbox", { name: "API key", exact: true });
  await keyInput.fill("sk-openai-test");
  await page.getByRole("button", { name: "Enable", exact: true }).click();

  // Enabling writes the template config + key to models.json, then tests it.
  await expect
    .poll(() => api.saveModelProviders.mock.calls[0]?.[0])
    .toEqual({
      agentDir: "/custom",
      providers: {
        openai: {
          name: "OpenAI",
          api: "openai-completions",
          baseUrl: "https://api.openai.com/v1",
          apiKey: "sk-openai-test",
          models: [
            {
              id: "gpt-5.5",
              name: "GPT-5.5",
              reasoning: true,
              input: ["text", "image"],
              contextWindow: 400_000,
            },
            {
              id: "gpt-5.4-mini",
              name: "GPT-5.4 Mini",
              reasoning: true,
              input: ["text", "image"],
              contextWindow: 400_000,
            },
            {
              id: "gpt-5.4-nano",
              name: "GPT-5.4 Nano",
              input: ["text", "image"],
              contextWindow: 400_000,
            },
          ],
        },
      },
    });
  await expect
    .poll(() => api.testModelProvider.mock.calls[0]?.[0])
    .toEqual({ agentDir: "/custom", provider: "openai", modelId: "gpt-5.5" });
});

it("keeps un-enabled templates out of the saved config", async () => {
  await mountPanel();
  // A template row in the list must not change the saved payload unless enabled.
  await page.getByRole("button", { name: "Anthropic", exact: true }).click();
  await expect.element(page.getByRole("heading", { name: "Enable Anthropic" })).toBeVisible();
  // No save happens and nothing extra is written for the un-enabled template.
  await expect.element(page.getByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
  await expect(api.saveModelProviders).not.toHaveBeenCalled();
});

it("adds a custom provider with the Name → Base URL → API key field order", async () => {
  await mountPanel({}, { selectCustom: false });
  await page.getByRole("button", { name: "Add model provider", exact: true }).click();

  // The custom branch leads with the vendor name and base URL before the key.
  await expect
    .element(page.getByRole("textbox", { name: "Display name", exact: true }))
    .toBeVisible();
  await expect.element(page.getByRole("textbox", { name: "Base URL", exact: true })).toBeVisible();
  await expect.element(page.getByRole("textbox", { name: "API key", exact: true })).toBeVisible();

  await page.getByRole("textbox", { name: "Display name", exact: true }).fill("Acme AI");
  await page.getByRole("textbox", { name: "Provider key", exact: true }).fill("acme");
  await page.getByRole("textbox", { name: "Base URL", exact: true }).fill("https://acme.test/v1");
  await page.getByRole("textbox", { name: "API key", exact: true }).fill("sk-acme");
  await page.getByRole("button", { name: "Add provider", exact: true }).click();

  // Adding a provider writes it out; there is no staged step to forget.
  await expect
    .poll(() => api.saveModelProviders.mock.calls.at(-1)?.[0])
    .toEqual({
      agentDir: "/custom",
      providers: {
        acme: {
          name: "Acme AI",
          api: "openai-completions",
          baseUrl: "https://acme.test/v1",
          apiKey: "sk-acme",
        },
      },
    });
  await expect.element(page.getByText("You have unsaved changes.")).not.toBeInTheDocument();
});

it("fetches the provider's own model list and adds a picked model", async () => {
  await mountPanel();
  api.listProviderModels.mockResolvedValue({
    models: ["deepseek-v4-pro", "whisper-large-v3", "Qwen/Qwen3-max"],
    url: "https://old.test/v1/models",
  });

  await page.getByRole("button", { name: "Fetch model list" }).click();
  await expect
    .poll(() => api.listProviderModels.mock.calls[0]?.[0])
    .toEqual({ agentDir: "/custom", provider: "custom" });

  // Grouped by vendor prefix, with non-chat families labeled by category.
  await expect.element(page.getByText("deepseek-v4-pro")).toBeVisible();
  await expect.element(page.getByText("whisper-large-v3")).toBeVisible();
  await expect.element(page.getByText("Transcribe", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Add model Qwen/Qwen3-max" }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  // The picked id is added to the provider and written out as a bare entry.
  await expect
    .poll(() => api.saveModelProviders.mock.calls.at(-1)?.[0])
    .toEqual({
      agentDir: "/custom",
      providers: {
        custom: {
          ...CUSTOM_PROVIDER,
          models: [{ id: "old-model" }, { id: "Qwen/Qwen3-max" }],
        },
      },
    });
});

it("shows the provider's fetch failure inline instead of adding anything", async () => {
  await mountPanel();
  api.listProviderModels.mockRejectedValue(
    new Error("The provider rejected the credentials (401)."),
  );

  await page.getByRole("button", { name: "Fetch model list" }).click();
  await expect
    .element(page.getByText("The provider rejected the credentials (401)."))
    .toBeVisible();
  await expect(api.saveModelProviders).not.toHaveBeenCalled();
});
