// Test the saved configuration through the same Pi model/auth resolution as sessions.
import path from "node:path";
import { getAgentDir, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { completeSimple } from "@earendil-works/pi-ai/compat";
import type {
  ServerTestModelProviderInput,
  ServerTestModelProviderResult,
} from "@peakcode/contracts";

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
