// Test the saved configuration through the same Pi model/auth resolution as sessions.
import path from "node:path";
import { AuthStorage, getAgentDir, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { completeSimple } from "@earendil-works/pi-ai";
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
      const auth = AuthStorage.create(path.join(agentDir, "auth.json"));
      const registry = ModelRegistry.create(auth, path.join(agentDir, "models.json"));
      if (registry.getError()) return { status: "invalid-config" };
      const model = input.modelId
        ? registry.find(input.provider, input.modelId)
        : registry.getAll().find((entry) => entry.provider === input.provider);
      if (!model) return { status: "model-not-found" };
      const requestAuth = await registry.getApiKeyAndHeaders(model);
      if (controller.signal.aborted) return { status: "timeout" };
      if (!requestAuth.ok) return { status: "auth-missing" };
      const response = await completeSimple(
        model,
        { messages: [{ role: "user", content: "Reply OK.", timestamp: Date.now() }] },
        { ...requestAuth, signal: controller.signal, maxTokens: 64, maxRetries: 0 },
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
