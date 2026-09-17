import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { completeSimple } from "@earendil-works/pi-ai/compat";
import { testModelProvider } from "./modelProviderConnection";

vi.mock("@earendil-works/pi-coding-agent", () => ({
  ModelRuntime: { create: vi.fn() },
  getAgentDir: () => "/default-agent",
}));
vi.mock("@earendil-works/pi-ai/compat", () => ({ completeSimple: vi.fn() }));

const model = { provider: "custom", id: "model" };
const runtime = {
  getError: vi.fn(),
  getModel: vi.fn(),
  getModels: vi.fn(),
  getAuth: vi.fn(),
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(ModelRuntime.create).mockResolvedValue(runtime as unknown as ModelRuntime);
  runtime.getModel.mockReturnValue(model);
  runtime.getModels.mockReturnValue([model]);
  runtime.getAuth.mockResolvedValue({
    auth: { apiKey: "secret", headers: { "x-test": "yes" } },
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
    expect(ModelRuntime.create).toHaveBeenCalledWith({
      authPath: "/custom-agent/auth.json",
      modelsPath: "/custom-agent/models.json",
    });
    expect(runtime.getModel).toHaveBeenCalledWith("custom", "model");
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
    expect(ModelRuntime.create).toHaveBeenCalledWith({
      authPath: "/default-agent/auth.json",
      modelsPath: "/default-agent/models.json",
    });
    expect(runtime.getModels).toHaveBeenCalledWith("custom");
  });

  it("does not send requests when saved configuration is invalid", async () => {
    runtime.getError.mockReturnValue("invalid config with private details");
    expect(await testModelProvider({ provider: "custom" })).toEqual({ status: "invalid-config" });
    expect(completeSimple).not.toHaveBeenCalled();
  });

  it("reports missing models and unresolved credentials without sending a request", async () => {
    runtime.getModels.mockReturnValue([]);
    expect(await testModelProvider({ provider: "custom" })).toEqual({ status: "model-not-found" });
    runtime.getModels.mockReturnValue([model]);
    runtime.getAuth.mockResolvedValue(undefined);
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
    runtime.getAuth.mockReturnValue(
      new Promise((resolve) => {
        resolveAuth = resolve;
      }),
    );
    const result = testModelProvider({ provider: "custom" });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await result).toEqual({ status: "timeout" });
    resolveAuth({ auth: { apiKey: "secret" } });
    await Promise.resolve();
    expect(completeSimple).not.toHaveBeenCalled();
  });
});
