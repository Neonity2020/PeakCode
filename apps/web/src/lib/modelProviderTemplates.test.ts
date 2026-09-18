import { expect, it } from "vitest";
import {
  MODEL_PROVIDER_TEMPLATE_BY_ID,
  MODEL_PROVIDER_TEMPLATES,
  modelProviderTemplateToConfig,
} from "./modelProviderTemplates";

it("leads with the China vendors and pushes the international ones to the end", () => {
  const ids = MODEL_PROVIDER_TEMPLATES.map((template) => template.id);
  expect(ids[0]).toBe("deepseek");
  // Every China vendor comes before the first international one.
  const firstInternational = ids.indexOf("openai");
  expect(ids.slice(0, firstInternational)).toEqual([
    "deepseek",
    "zhipu",
    "moonshot",
    "dashscope",
    "siliconflow",
    "minimax-cn",
    "xunfei",
    "stepfun",
    "hunyuan",
    "xiaomi",
  ]);
  expect(ids.at(-1)).toBe("ollama");
});

it("keeps MiniMax China on the Pi credential namespace and China Anthropic endpoint", () => {
  const template = MODEL_PROVIDER_TEMPLATE_BY_ID.get("minimax-cn");
  expect(template).toBeDefined();
  const config = modelProviderTemplateToConfig(template!);
  expect(config.api).toBe("anthropic-messages");
  expect(config.baseUrl).toBe("https://api.minimaxi.com/anthropic");
  expect(config.apiKey).toBeUndefined();
  expect(template!.apiKeyEnv).toBe("MINIMAX_CN_API_KEY");
  expect(config.models?.some((model) => model.id === "MiniMax-M3")).toBe(true);
  expect(MODEL_PROVIDER_TEMPLATE_BY_ID.get("minimax")).toBeUndefined();
});

it("preserves an explicitly supplied MiniMax credential", () => {
  const template = MODEL_PROVIDER_TEMPLATE_BY_ID.get("minimax-cn")!;
  expect(modelProviderTemplateToConfig(template, " custom-key ").apiKey).toBe("custom-key");
});

it("offers Xiaomi MiMo on its OpenAI-compatible endpoint instead of the removed 01.AI entry", () => {
  const template = MODEL_PROVIDER_TEMPLATE_BY_ID.get("xiaomi");
  expect(template).toBeDefined();
  const config = modelProviderTemplateToConfig(template!);
  expect(config.api).toBe("openai-completions");
  expect(config.baseUrl).toBe("https://api.xiaomimimo.com/v1");
  expect(config.apiKey).toBeUndefined();
  expect(template!.apiKeyEnv).toBe("MIMO_API_KEY");
  expect(config.models?.map((model) => model.id)).toEqual(["mimo-v2-5-pro", "mimo-v2-5"]);
  expect(MODEL_PROVIDER_TEMPLATE_BY_ID.get("lingyi")).toBeUndefined();
});
