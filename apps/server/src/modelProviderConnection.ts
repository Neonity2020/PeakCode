// Test the saved configuration through the same Pi model/auth resolution as sessions.
import path from "node:path";
import { getAgentDir, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { completeSimple } from "@earendil-works/pi-ai/compat";
import type {
  ServerListProviderModelsInput,
  ServerListProviderModelsResult,
  ServerTestModelProviderInput,
  ServerTestModelProviderResult,
} from "@peakcode/contracts";

import { readSavedProviderConfig } from "./modelProviders";

const MODEL_LIST_TIMEOUT_MS = 15_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Merge header sources, dropping the `null`s pi uses to unset a header. */
function stringHeaders(
  ...sources: ReadonlyArray<Record<string, string | null | undefined> | undefined>
): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const source of sources) {
    for (const [key, value] of Object.entries(source ?? {})) {
      if (typeof value === "string") headers[key] = value;
    }
  }
  return headers;
}

/**
 * Candidate list endpoints for a provider base URL.
 *
 * A base that already carries a version segment (`/v1`, `/v4`, `/v1beta/openai`)
 * is only suffixed; otherwise both `<base>/models` and `<base>/v1/models` are
 * tried, which is what bare hosts and aggregator roots need.
 */
export function modelListUrls(baseUrl: string): string[] {
  const base = baseUrl.trim().replace(/\/+$/, "");
  if (base.length === 0) return [];
  return /\/v\d/i.test(base) ? [`${base}/models`] : [`${base}/models`, `${base}/v1/models`];
}

/** Accepts `[{id}]`, `{data:[{id}]}` and `{models:[{id}|{name}]}` payloads. */
export function parseModelListPayload(raw: string, contentType?: string): string[] {
  const text = raw.replace(/^\uFEFF/, "").trim();
  if (text.length === 0) {
    throw new Error("the endpoint returned an empty body");
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(
      /html/i.test(contentType ?? "") || text.startsWith("<")
        ? "the address returned a web page instead of the API — point Base URL at the API root (…/v1)"
        : `the address did not return JSON (${contentType || "unknown content type"})`,
    );
  }

  const items = Array.isArray(json)
    ? json
    : isRecord(json)
      ? (json.data ?? json.models)
      : undefined;
  if (!Array.isArray(items)) {
    const body = isRecord(json) ? json : {};
    const nested = isRecord(body.error) ? body.error.message : undefined;
    const upstream =
      typeof body.message === "string" && body.message.length > 0
        ? body.message
        : typeof nested === "string" && nested.length > 0
          ? nested
          : "";
    throw new Error(
      upstream.length > 0
        ? `the provider answered: ${upstream}`
        : "the response has no model list (expected an array, `data`, or `models`)",
    );
  }

  const ids = items
    .map((item) => {
      if (!isRecord(item)) return "";
      const id = typeof item.id === "string" ? item.id.trim() : "";
      if (id.length > 0) return id;
      // Google's list returns `name: "models/gemini-…"` instead of an id.
      const name = typeof item.name === "string" ? item.name.trim() : "";
      return name.replace(/^models\//, "");
    })
    .filter((id) => id.length > 0);

  return Array.from(new Set(ids));
}

/** Auth header style per API kind; local servers can turn headers off entirely. */
export function modelListHeaders(input: {
  apiKey?: string;
  api?: string;
  authHeader?: boolean;
  headers?: Record<string, string>;
}): Record<string, string> {
  const headers: Record<string, string> = { ...input.headers };
  const key = input.apiKey?.trim() ?? "";
  if (key.length === 0 || input.authHeader === false) return headers;
  if (input.api === "anthropic-messages") {
    headers["x-api-key"] = key;
    headers["anthropic-version"] = "2023-06-01";
    return headers;
  }
  headers.Authorization = `Bearer ${key}`;
  return headers;
}

/**
 * Fetch the provider's own `/models` list using the saved config. The request
 * runs here (not in the browser) so `apiKey` can stay a `!shell`/env reference
 * resolved through pi's auth, and so CORS never applies.
 */
export async function listProviderModels(
  input: ServerListProviderModelsInput,
): Promise<ServerListProviderModelsResult> {
  const agentDir = input.agentDir?.trim() || getAgentDir();
  const runtime = await ModelRuntime.create({
    authPath: path.join(agentDir, "auth.json"),
    modelsPath: path.join(agentDir, "models.json"),
  });
  if (runtime.getError()) {
    throw new Error("Pi could not load the model configuration. Check models.json.");
  }

  const config = await readSavedProviderConfig(agentDir, input.provider);
  const baseUrl = (runtime.getProvider(input.provider)?.baseUrl ?? config?.baseUrl ?? "").trim();
  if (baseUrl.length === 0) {
    throw new Error("This provider has no Base URL. Set one and save, then fetch the model list.");
  }
  const urls = modelListUrls(baseUrl);
  const api = config?.api;
  const requestAuth = await runtime.getAuth(input.provider);
  const headers = modelListHeaders({
    ...(requestAuth?.auth.apiKey !== undefined ? { apiKey: requestAuth.auth.apiKey } : {}),
    ...(api !== undefined ? { api } : {}),
    ...(config?.authHeader !== undefined ? { authHeader: config.authHeader } : {}),
    headers: stringHeaders(
      runtime.getProvider(input.provider)?.headers,
      config?.headers,
      requestAuth?.auth.headers,
    ),
  });

  const failures: string[] = [];
  let authFailure = "";
  for (const url of urls) {
    try {
      const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(MODEL_LIST_TIMEOUT_MS),
      });
      if (response.status === 401 || response.status === 403) {
        // Some gateways only authenticate one of the candidate paths, so keep going.
        authFailure ||= `HTTP ${response.status}`;
        continue;
      }
      if (!response.ok) {
        failures.push(`${pathOf(url)}: HTTP ${response.status}`);
        continue;
      }
      const models = parseModelListPayload(
        await response.text(),
        response.headers.get("content-type") ?? undefined,
      );
      return { models: models.toSorted((a, b) => a.localeCompare(b)), url };
    } catch (error) {
      failures.push(`${pathOf(url)}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(
    authFailure.length > 0
      ? `The provider rejected the credentials (${authFailure}). Check the API key.`
      : `Could not read the model list. ${failures.join("; ")}`,
  );
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

export async function testModelProvider(
  input: ServerTestModelProviderInput,
): Promise<ServerTestModelProviderResult> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<ServerTestModelProviderResult>((resolve) => {
    timer = setTimeout(() => {
      resolve({ status: "timeout" });
      controller.abort();
    }, 20_000);
  });
  const probe = async (): Promise<ServerTestModelProviderResult> => {
    try {
      const agentDir = input.agentDir?.trim() || getAgentDir();
      const runtime = await ModelRuntime.create({
        authPath: path.join(agentDir, "auth.json"),
        modelsPath: path.join(agentDir, "models.json"),
      });
      if (runtime.getError()) return { status: "invalid-config" };
      const model = input.modelId
        ? runtime.getModel(input.provider, input.modelId)
        : runtime.getModels(input.provider)[0];
      if (!model) return { status: "model-not-found" };
      const requestAuth = await runtime.getAuth(model);
      if (controller.signal.aborted) return { status: "timeout" };
      if (!requestAuth) return { status: "auth-missing" };
      const response = await completeSimple(
        model,
        { messages: [{ role: "user", content: "Reply OK.", timestamp: Date.now() }] },
        {
          ...(requestAuth.auth.apiKey !== undefined ? { apiKey: requestAuth.auth.apiKey } : {}),
          ...(requestAuth.auth.headers !== undefined ? { headers: requestAuth.auth.headers } : {}),
          ...(requestAuth.env ? { env: requestAuth.env } : {}),
          signal: controller.signal,
          maxTokens: 64,
          maxRetries: 0,
        },
      );
      if (controller.signal.aborted) return { status: "timeout" };
      return {
        status:
          response.stopReason === "error" || response.stopReason === "aborted"
            ? "request-failed"
            : "success",
        model: `${model.provider}/${model.id}`,
      };
    } catch {
      // Upstream errors can include credentials, request headers, or response bodies.
      return { status: controller.signal.aborted ? "timeout" : "request-failed" };
    }
  };
  try {
    return await Promise.race([probe(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
