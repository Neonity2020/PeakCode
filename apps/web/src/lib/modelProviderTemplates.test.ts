import { expect, it } from "vitest";
import {
  MODEL_PROVIDER_TEMPLATE_BY_ID,
  modelProviderTemplateToConfig,
} from "./modelProviderTemplates";

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
