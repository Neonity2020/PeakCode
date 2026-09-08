// FILE: modelProviderTemplates.ts
// Purpose: Presets for the "Model Providers" settings panel. Each template maps
// to a pi models.json provider entry. baseUrl/api/fields are verified against
// vendor docs; model ids are the mainstream entries at the time of writing and
// are always editable in the form.
// Layer: Web UI support

import type {
  CustomModelConfig,
  ModelProviderApiKind,
  ModelProviderConfig,
} from "@peakcode/contracts";

export interface ModelProviderTemplateModel {
  readonly id: string;
  readonly name?: string;
  readonly reasoning?: boolean;
  readonly input?: ReadonlyArray<"text" | "image">;
  readonly contextWindow?: number;
  readonly maxTokens?: number;
}

export interface ModelProviderTemplate {
  /**
   * Key used in `providers` inside models.json.
   */
  readonly id: string;
  readonly label: string;
  readonly region: "china" | "global" | "local";
  readonly api: ModelProviderApiKind;
  readonly baseUrl: string;
  /**
   * Recommended env var to reference in apiKey (e.g. `$OPENAI_API_KEY`).
   */
  readonly apiKeyEnv: string;
  readonly models: ReadonlyArray<ModelProviderTemplateModel>;
  /**
   * Shown under the template name when picking a provider.
   */
  readonly note?: string;
}

export function modelProviderTemplateToConfig(
  template: ModelProviderTemplate,
  apiKey?: string,
): ModelProviderConfig {
  const config: ModelProviderConfig = {
    name: template.label,
    api: template.api,
    baseUrl: template.baseUrl,
    ...(apiKey && apiKey.trim().length > 0 ? { apiKey: apiKey.trim() } : {}),
    ...(template.models.length > 0
      ? {
          models: template.models.map((model) => {
            const entry: CustomModelConfig = {
              id: model.id,
              ...(model.name ? { name: model.name } : {}),
              ...(model.reasoning !== undefined ? { reasoning: model.reasoning } : {}),
              ...(model.input ? { input: [...model.input] } : {}),
              ...(model.contextWindow !== undefined ? { contextWindow: model.contextWindow } : {}),
              ...(model.maxTokens !== undefined ? { maxTokens: model.maxTokens } : {}),
            };
            return entry;
          }),
        }
      : {}),
  };
  return config;
}

const text = { input: ["text"] as const };
const textImage = { input: ["text", "image"] as const };

export const MODEL_PROVIDER_TEMPLATES: readonly ModelProviderTemplate[] = [
  // ── Global ───────────────────────────────────────────────────────────
  {
    id: "openai",
    label: "OpenAI",
    region: "global",
    api: "openai-completions",
    baseUrl: "https://api.openai.com/v1",
    apiKeyEnv: "$OPENAI_API_KEY",
    note: "Pi 内置 OpenAI，通常无需重复添加；仅在自定义模型/代理时使用。",
    models: [
      { id: "gpt-5.5", name: "GPT-5.5", reasoning: true, ...textImage, contextWindow: 400_000 },
      {
        id: "gpt-5.4-mini",
        name: "GPT-5.4 Mini",
        reasoning: true,
        ...textImage,
        contextWindow: 400_000,
      },
      { id: "gpt-5.4-nano", name: "GPT-5.4 Nano", ...textImage, contextWindow: 400_000 },
    ],
  },
  {
    id: "anthropic",
    label: "Anthropic",
    region: "global",
    api: "anthropic-messages",
    baseUrl: "https://api.anthropic.com",
    apiKeyEnv: "$ANTHROPIC_API_KEY",
    note: "Pi 内置 Claude 模型，通常无需重复添加。",
    models: [
      {
        id: "claude-opus-5",
        name: "Claude Opus 5",
        reasoning: true,
        ...textImage,
        contextWindow: 200_000,
      },
      {
        id: "claude-sonnet-5",
        name: "Claude Sonnet 5",
        reasoning: true,
        ...textImage,
        contextWindow: 200_000,
      },
      { id: "claude-haiku-4-5", name: "Claude Haiku 4.5", ...textImage, contextWindow: 200_000 },
    ],
  },
  {
    id: "google",
    label: "Google Gemini",
    region: "global",
    api: "google-generative-ai",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    apiKeyEnv: "$GEMINI_API_KEY",
    note: "Pi 内置 Gemini 模型，通常无需重复添加。",
    models: [
      {
        id: "gemini-3.1-pro",
        name: "Gemini 3.1 Pro",
        reasoning: true,
        ...textImage,
        contextWindow: 1_048_576,
      },
      {
        id: "gemini-3.6-flash",
        name: "Gemini 3.6 Flash",
        reasoning: true,
        ...textImage,
        contextWindow: 1_048_576,
      },
      {
        id: "gemini-3-flash",
        name: "Gemini 3 Flash",
        reasoning: true,
        ...textImage,
        contextWindow: 1_048_576,
      },
    ],
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    region: "global",
    api: "openai-completions",
    baseUrl: "https://openrouter.ai/api/v1",
    apiKeyEnv: "$OPENROUTER_API_KEY",
    note: "聚合多家模型的网关，也可用 openrouter/auto 自动路由。",
    models: [
      { id: "openrouter/auto", name: "Auto (自动路由)", ...text },
      { id: "deepseek/deepseek-chat", name: "DeepSeek Chat", ...text },
      { id: "anthropic/claude-sonnet-5", name: "Claude Sonnet 5", reasoning: true, ...text },
    ],
  },
  {
    id: "ollama",
    label: "Ollama（本地）",
    region: "local",
    api: "openai-completions",
    baseUrl: "http://localhost:11434/v1",
    apiKeyEnv: "ollama",
    note: "本地模型无需真实 Key，可填占位值；如不支持 developer 角色请在高级项关掉。",
    models: [
      { id: "llama3.1:8b", name: "Llama 3.1 8B", ...text, contextWindow: 128_000 },
      { id: "qwen2.5-coder:7b", name: "Qwen2.5 Coder 7B", ...text, contextWindow: 32_768 },
      {
        id: "deepseek-r1:7b",
        name: "DeepSeek R1 7B",
        reasoning: true,
        ...text,
        contextWindow: 32_768,
      },
    ],
  },

  // ── 国内 ─────────────────────────────────────────────────────────────
  {
    id: "deepseek",
    label: "DeepSeek（深度求索）",
    region: "china",
    api: "openai-completions",
    baseUrl: "https://api.deepseek.com/v1",
    apiKeyEnv: "$DEEPSEEK_API_KEY",
    models: [
      {
        id: "deepseek-v4-flash",
        name: "DeepSeek V4 Flash",
        reasoning: true,
        ...text,
        contextWindow: 131_072,
      },
      {
        id: "deepseek-v4-pro",
        name: "DeepSeek V4 Pro",
        reasoning: true,
        ...text,
        contextWindow: 131_072,
      },
      { id: "deepseek-chat", name: "DeepSeek Chat", ...text, contextWindow: 64_000 },
      {
        id: "deepseek-reasoner",
        name: "DeepSeek Reasoner",
        reasoning: true,
        ...text,
        contextWindow: 64_000,
      },
    ],
  },
  {
    id: "zhipu",
    label: "智谱 AI（GLM）",
    region: "china",
    api: "openai-completions",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    apiKeyEnv: "$ZAI_API_KEY",
    models: [
      { id: "glm-4.5", name: "GLM-4.5", reasoning: true, ...textImage, contextWindow: 200_000 },
      {
        id: "glm-4.5-air",
        name: "GLM-4.5 Air",
        reasoning: true,
        ...textImage,
        contextWindow: 200_000,
      },
      { id: "glm-4.5-flash", name: "GLM-4.5 Flash", ...textImage, contextWindow: 128_000 },
    ],
  },
  {
    id: "moonshot",
    label: "Moonshot（Kimi）",
    region: "china",
    api: "openai-completions",
    baseUrl: "https://api.moonshot.cn/v1",
    apiKeyEnv: "$MOONSHOT_API_KEY",
    models: [
      { id: "kimi-k3", name: "Kimi K3", reasoning: true, ...textImage, contextWindow: 262_144 },
      {
        id: "kimi-k2.7-code",
        name: "Kimi K2.7 Code",
        reasoning: true,
        ...text,
        contextWindow: 262_144,
      },
      { id: "moonshot-v1-32k", name: "Moonshot V1 32K", ...text, contextWindow: 32_768 },
    ],
  },
  {
    id: "dashscope",
    label: "阿里云百炼（Qwen）",
    region: "china",
    api: "openai-completions",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiKeyEnv: "$DASHSCOPE_API_KEY",
    models: [
      { id: "qwen-max", name: "Qwen Max", reasoning: true, ...textImage, contextWindow: 131_072 },
      { id: "qwen-plus", name: "Qwen Plus", reasoning: true, ...textImage, contextWindow: 131_072 },
      { id: "qwen-turbo", name: "Qwen Turbo", ...textImage, contextWindow: 131_072 },
      {
        id: "qwen3-coder-plus",
        name: "Qwen3 Coder Plus",
        reasoning: true,
        ...text,
        contextWindow: 262_144,
      },
    ],
  },
  {
    id: "siliconflow",
    label: "硅基流动 SiliconFlow",
    region: "china",
    api: "openai-completions",
    baseUrl: "https://api.siliconflow.cn/v1",
    apiKeyEnv: "$SILICONFLOW_API_KEY",
    note: "托管 DeepSeek / Qwen / GLM 等开源模型，模型名带组织前缀。",
    models: [
      { id: "deepseek-ai/DeepSeek-V4-Flash", name: "DeepSeek V4 Flash", reasoning: true, ...text },
      { id: "Pro/deepseek-ai/DeepSeek-R1", name: "DeepSeek R1", reasoning: true, ...text },
      { id: "Qwen/Qwen3.6-35B-A3B", name: "Qwen3.6 35B A3B", reasoning: true, ...text },
    ],
  },
  {
    id: "minimax",
    label: "MiniMax（稀宇科技）",
    region: "china",
    api: "openai-completions",
    baseUrl: "https://api.minimaxi.com/v1",
    apiKeyEnv: "$MINIMAX_API_KEY",
    note: "Pi 已内置 MiniMax-M3（Anthropic 端点），重复添加仅用于自定义模型。",
    models: [
      { id: "MiniMax-M3", name: "MiniMax M3", reasoning: true, ...text, contextWindow: 512_000 },
      { id: "MiniMax-Text-01", name: "MiniMax Text-01", ...text, contextWindow: 1_000_000 },
    ],
  },
  {
    id: "xunfei",
    label: "讯飞星火 Spark",
    region: "china",
    api: "openai-completions",
    baseUrl: "https://spark-api-open.xf-yun.com/v1",
    apiKeyEnv: "$SPARK_API_KEY",
    note: "星火模型名较特殊（如 4.0Ultra / generalv3.5），按控制台实际值填写。",
    models: [
      { id: "4.0Ultra", name: "Spark 4.0 Ultra", reasoning: true, ...text, contextWindow: 131_072 },
      { id: "generalv3.5", name: "Spark Max", ...text, contextWindow: 131_072 },
      { id: "spark-x", name: "Spark X2/X1.5", reasoning: true, ...text, contextWindow: 262_144 },
    ],
  },
  {
    id: "stepfun",
    label: "阶跃星辰 StepFun",
    region: "china",
    api: "openai-completions",
    baseUrl: "https://api.stepfun.com/v1",
    apiKeyEnv: "$STEP_API_KEY",
    models: [
      {
        id: "step-3.7-flash",
        name: "Step 3.7 Flash",
        reasoning: true,
        ...text,
        contextWindow: 262_144,
      },
      {
        id: "step-3.5-flash",
        name: "Step 3.5 Flash",
        reasoning: true,
        ...text,
        contextWindow: 262_144,
      },
    ],
  },
  {
    id: "hunyuan",
    label: "腾讯混元 Hunyuan",
    region: "china",
    api: "openai-completions",
    baseUrl: "https://api.hunyuan.cloud.tencent.com/v1",
    apiKeyEnv: "$HUNYUAN_API_KEY",
    models: [
      {
        id: "hunyuan-turbos-latest",
        name: "Hunyuan Turbos",
        reasoning: true,
        ...text,
        contextWindow: 131_072,
      },
      {
        id: "hunyuan-turbo-latest",
        name: "Hunyuan Turbo",
        reasoning: true,
        ...text,
        contextWindow: 131_072,
      },
      { id: "hunyuan-standard", name: "Hunyuan Standard", ...text, contextWindow: 131_072 },
    ],
  },
  {
    id: "lingyi",
    label: "零一万物 01.AI",
    region: "china",
    api: "openai-completions",
    baseUrl: "https://api.lingyiwanwu.com/v1",
    apiKeyEnv: "$YI_API_KEY",
    models: [
      { id: "yi-lightning", name: "Yi Lightning", reasoning: true, ...text, contextWindow: 32_768 },
    ],
  },
];

export const MODEL_PROVIDER_TEMPLATE_BY_ID: ReadonlyMap<string, ModelProviderTemplate> = new Map(
  MODEL_PROVIDER_TEMPLATES.map((template) => [template.id, template]),
);
