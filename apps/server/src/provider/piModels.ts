/**
 * PiModels - Pi model registry access, thinking levels and model-reference parsing.
 *
 * @module PiModels
 */
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { getSupportedThinkingLevels, type Api, type Model } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

export const PROVIDER = "pi" as const;
export const DEFAULT_PI_THINKING_LEVEL: ThinkingLevel = "medium";
/**
 * How long an unanswered approval prompt stays open. Matches the toolkit's own
 * interaction timeout: after this the call is denied rather than left hanging.
 */

const LOCAL_PI_MODEL_ADDITIONS: ReadonlyArray<Model<Api>> = [
  {
    id: "MiniMax-M3",
    name: "MiniMax-M3",
    api: "anthropic-messages",
    provider: "minimax-cn",
    baseUrl: "https://api.minimaxi.com/anthropic",
    reasoning: true,
    input: ["text", "image"],
    cost: {
      input: 0.6,
      output: 2.4,
      cacheRead: 0.12,
      cacheWrite: 0,
    },
    contextWindow: 512_000,
    maxTokens: 128_000,
  },
];
export const PI_THINKING_OPTIONS: ReadonlyArray<{
  readonly value: ThinkingLevel;
  readonly label: string;
  readonly description: string;
  readonly isDefault?: true;
}> = [
  { value: "off", label: "Off", description: "No extra reasoning" },
  { value: "minimal", label: "Minimal", description: "Light reasoning" },
  { value: "low", label: "Low", description: "Faster reasoning" },
  { value: "medium", label: "Medium", description: "Balanced reasoning", isDefault: true },
  { value: "high", label: "High", description: "Deeper reasoning" },
  { value: "xhigh", label: "Extra High", description: "Maximum reasoning" },
];

export type PiModelRuntime = Pick<ModelRuntime, "getModel" | "getModels" | "getAvailable">;

export function toMessage(cause: unknown, fallback: string): string {
  if (cause instanceof Error && cause.message.trim().length > 0) {
    return cause.message;
  }
  return fallback;
}

export function trimToUndefined(value: string | null | undefined): string | undefined {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 ? trimmed : undefined;
}

function isPiThinkingLevel(value: string | null | undefined): value is ThinkingLevel {
  return (
    value === "off" ||
    value === "minimal" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh"
  );
}

export function normalizePiThinkingLevel(
  value: string | null | undefined,
): ThinkingLevel | undefined {
  return isPiThinkingLevel(value) ? value : undefined;
}

// Mirrors Pi SDK clamping so model discovery does not advertise levels that will be ignored.
export function getPiSupportedThinkingOptions(
  model: Pick<Model<Api>, "reasoning" | "thinkingLevelMap">,
): ReadonlyArray<(typeof PI_THINKING_OPTIONS)[number]> {
  if (!model.reasoning) {
    return [];
  }
  const supportedLevels = new Set(getSupportedThinkingLevels(model as Model<Api>));
  return PI_THINKING_OPTIONS.filter((option) => supportedLevels.has(option.value));
}

function parseModelReference(
  modelId: string | null | undefined,
): { readonly provider?: string; readonly id: string } | undefined {
  const trimmed = trimToUndefined(modelId);
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.includes("/")) {
    const [provider, ...rest] = trimmed.split("/");
    const id = rest.join("/");
    if (provider && id) {
      return { provider, id };
    }
  }
  if (trimmed.includes(":")) {
    const [provider, ...rest] = trimmed.split(":");
    const id = rest.join(":");
    if (provider && id) {
      return { provider, id };
    }
  }
  return { id: trimmed };
}

function createProviderModelFallback(
  runtime: PiModelRuntime,
  parsed: { readonly provider: string; readonly id: string },
): Model<Api> | undefined {
  const providerDefault = runtime.getModels().find((model) => model.provider === parsed.provider);
  if (!providerDefault) {
    return undefined;
  }
  return {
    id: parsed.id,
    name: parsed.id,
    api: providerDefault.api,
    provider: parsed.provider,
    baseUrl: providerDefault.baseUrl,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 16_384,
    ...(providerDefault.compat ? { compat: providerDefault.compat } : {}),
  };
}

export function findModelInRegistry(
  runtime: PiModelRuntime,
  modelId: string | null | undefined,
): Model<Api> | undefined {
  const parsed = parseModelReference(modelId);
  if (!parsed) {
    return undefined;
  }
  if (parsed.provider) {
    return (
      runtime.getModel(parsed.provider, parsed.id) ??
      LOCAL_PI_MODEL_ADDITIONS.find(
        (model) => model.provider === parsed.provider && model.id === parsed.id,
      ) ??
      createProviderModelFallback(runtime, { provider: parsed.provider, id: parsed.id })
    );
  }
  return (
    runtime
      .getModels()
      .find((model) => model.id === parsed.id || `${model.provider}/${model.id}` === parsed.id) ??
    LOCAL_PI_MODEL_ADDITIONS.find(
      (model) => model.id === parsed.id || `${model.provider}/${model.id}` === parsed.id,
    )
  );
}

export function withLocalPiModelAdditions(
  models: ReadonlyArray<Model<Api>>,
  availableModels: ReadonlyArray<Model<Api>>,
): ReadonlyArray<Model<Api>> {
  const keys = new Set(models.map((model) => `${model.provider}/${model.id}`));
  const availableProviders = new Set(availableModels.map((model) => model.provider));
  const additions = LOCAL_PI_MODEL_ADDITIONS.filter(
    (model) => availableProviders.has(model.provider) && !keys.has(`${model.provider}/${model.id}`),
  );
  return additions.length > 0 ? [...models, ...additions] : models;
}
