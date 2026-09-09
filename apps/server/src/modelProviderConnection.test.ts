import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { completeSimple } from "@earendil-works/pi-ai";
import { testModelProvider } from "./modelProviderConnection";

vi.mock("@earendil-works/pi-coding-agent", () => ({
  AuthStorage: { create: vi.fn() },
  ModelRegistry: { create: vi.fn() },
  getAgentDir: () => "/default-agent",
}));
vi.mock("@earendil-works/pi-ai", () => ({ completeSimple: vi.fn() }));

const model = { provider: "custom", id: "model" };
const registry = {
  getError: vi.fn(),
  find: vi.fn(),
  getAll: vi.fn(),
  getApiKeyAndHeaders: vi.fn(),
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(ModelRegistry.create).mockReturnValue(registry as unknown as ModelRegistry);
  registry.find.mockReturnValue(model);
  registry.getAll.mockReturnValue([model]);
  registry.getApiKeyAndHeaders.mockResolvedValue({
    ok: true,
    apiKey: "secret",
    headers: { "x-test": "yes" },
  });
  vi.mocked(completeSimple).mockResolvedValue({ stopReason: "stop" } as Awaited<
    ReturnType<typeof completeSimple>
  >);
});
afterEach(() => vi.useRealTimers());

describe("testModelProvider", () => {
  it("uses the saved model and resolved auth in the selected directory", async () => {
    expect(
      await testModelProvider({ agentDir: "/custom-agent", provider: "custom", modelId: "model" }),
    ).toEqual({ status: "success", model: "custom/model" });
    expect(AuthStorage.create).toHaveBeenCalledWith("/custom-agent/auth.json");
    expect(ModelRegistry.create).toHaveBeenCalledWith(undefined, "/custom-agent/models.json");
    expect(registry.find).toHaveBeenCalledWith("custom", "model");
    expect(completeSimple).toHaveBeenCalledWith(
      model,
      expect.objectContaining({ messages: expect.any(Array) }),
      expect.objectContaining({
        apiKey: "secret",
        headers: { "x-test": "yes" },
        maxTokens: 64,
        maxRetries: 0,
      }),
    );
  });

  it("falls back to the first provider model and default directory", async () => {
    expect(await testModelProvider({ provider: "custom" })).toEqual({
      status: "success",
      model: "custom/model",
    });
    expect(AuthStorage.create).toHaveBeenCalledWith("/default-agent/auth.json");
  });

  it("does not send requests when saved configuration is invalid", async () => {
    registry.getError.mockReturnValue("invalid config with private details");
    expect(await testModelProvider({ provider: "custom" })).toEqual({ status: "invalid-config" });
    expect(completeSimple).not.toHaveBeenCalled();
  });

  it("reports missing models and unresolved credentials without sending a request", async () => {
    registry.getAll.mockReturnValue([]);
    expect(await testModelProvider({ provider: "custom" })).toEqual({ status: "model-not-found" });
    registry.getAll.mockReturnValue([model]);
    registry.getApiKeyAndHeaders.mockResolvedValue({ ok: false, error: "secret" });
    expect(await testModelProvider({ provider: "custom" })).toEqual({ status: "auth-missing" });
    expect(completeSimple).not.toHaveBeenCalled();
  });

  it("does not expose upstream errors or credentials", async () => {
    vi.mocked(completeSimple).mockRejectedValue(new Error("secret Authorization header"));
    expect(await testModelProvider({ provider: "custom" })).toEqual({ status: "request-failed" });
    vi.mocked(completeSimple).mockResolvedValue({
      stopReason: "error",
      errorMessage: "secret",
    } as Awaited<ReturnType<typeof completeSimple>>);
    expect(await testModelProvider({ provider: "custom" })).toEqual({
      status: "request-failed",
      model: "custom/model",
    });
  });

  it("aborts slow requests after 20 seconds", async () => {
    vi.useFakeTimers();
    vi.mocked(completeSimple).mockImplementation(() => new Promise(() => {}));
    const result = testModelProvider({ provider: "custom" });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await result).toEqual({ status: "timeout" });
    expect(vi.mocked(completeSimple).mock.calls[0]?.[2]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not start a request if auth resolves after the deadline", async () => {
    vi.useFakeTimers();
    let resolveAuth!: (value: unknown) => void;
    registry.getApiKeyAndHeaders.mockReturnValue(
      new Promise((resolve) => {
        resolveAuth = resolve;
      }),
    );
    const result = testModelProvider({ provider: "custom" });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await result).toEqual({ status: "timeout" });
    resolveAuth({ ok: true, apiKey: "secret" });
    await Promise.resolve();
    expect(completeSimple).not.toHaveBeenCalled();
  });
});
