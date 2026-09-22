import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { completeSimple } from "@earendil-works/pi-ai/compat";
import {
  listProviderModels,
  modelListHeaders,
  modelListUrls,
  parseModelListPayload,
  testModelProvider,
} from "./modelProviderConnection";
import { readSavedProviderConfig } from "./modelProviders";

vi.mock("@earendil-works/pi-coding-agent", () => ({
  ModelRuntime: { create: vi.fn() },
  getAgentDir: () => "/default-agent",
}));
vi.mock("@earendil-works/pi-ai/compat", () => ({ completeSimple: vi.fn() }));
vi.mock("./modelProviders", () => ({ readSavedProviderConfig: vi.fn() }));

const model = { provider: "custom", id: "model" };
const runtime = {
  getError: vi.fn(),
  getModel: vi.fn(),
  getModels: vi.fn(),
  getAuth: vi.fn(),
  getProvider: vi.fn(),
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(ModelRuntime.create).mockResolvedValue(runtime as unknown as ModelRuntime);
  runtime.getModel.mockReturnValue(model);
  runtime.getModels.mockReturnValue([model]);
  runtime.getAuth.mockResolvedValue({
    auth: { apiKey: "secret", headers: { "x-test": "yes" } },
  });
  runtime.getProvider.mockReturnValue({ baseUrl: "https://api.test/v1", headers: {} });
  vi.mocked(readSavedProviderConfig).mockResolvedValue({ api: "openai-completions" });
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

describe("modelListUrls", () => {
  it("only suffixes a base that already carries a version segment", () => {
    expect(modelListUrls("https://api.deepseek.com/v1")).toEqual([
      "https://api.deepseek.com/v1/models",
    ]);
    expect(modelListUrls("https://open.bigmodel.cn/api/paas/v4/")).toEqual([
      "https://open.bigmodel.cn/api/paas/v4/models",
    ]);
  });

  it("tries both candidate paths for a bare host", () => {
    expect(modelListUrls("https://api.example.com")).toEqual([
      "https://api.example.com/models",
      "https://api.example.com/v1/models",
    ]);
    expect(modelListUrls("   ")).toEqual([]);
  });
});

describe("parseModelListPayload", () => {
  it("accepts array, data, and models payloads and dedupes ids", () => {
    expect(parseModelListPayload('[{"id":"b"},{"id":"a"},{"id":"b"}]')).toEqual(["b", "a"]);
    expect(parseModelListPayload('{"data":[{"id":"a"}]}')).toEqual(["a"]);
    expect(parseModelListPayload('{"models":[{"name":"models/gemini-3"}]}')).toEqual(["gemini-3"]);
  });

  it("explains a web page instead of a JSON parse failure", () => {
    expect(() => parseModelListPayload("<html></html>", "text/html")).toThrow(/web page/);
    expect(() => parseModelListPayload('{"error":{"message":"bad key"}}')).toThrow(/bad key/);
    expect(() => parseModelListPayload("   ")).toThrow(/empty body/);
  });
});

describe("modelListHeaders", () => {
  it("uses bearer tokens, anthropic keys, and honors authHeader=false", () => {
    expect(modelListHeaders({ apiKey: "k", api: "openai-completions" })).toEqual({
      Authorization: "Bearer k",
    });
    expect(modelListHeaders({ apiKey: "k", api: "anthropic-messages" })).toEqual({
      "x-api-key": "k",
      "anthropic-version": "2023-06-01",
    });
    expect(modelListHeaders({ apiKey: "k", authHeader: false })).toEqual({});
    expect(modelListHeaders({ headers: { "x-extra": "1" } })).toEqual({ "x-extra": "1" });
  });
});

describe("listProviderModels", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const jsonResponse = (body: unknown, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => "application/json" },
    text: async () => JSON.stringify(body),
  });

  const textResponse = (body: string, contentType = "text/html", status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => contentType },
    text: async () => body,
  });

  it("reads the saved endpoint with the resolved key and sorts the ids", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [{ id: "z-model" }, { id: "a-model" }] }));

    expect(await listProviderModels({ agentDir: "/custom-agent", provider: "custom" })).toEqual({
      models: ["a-model", "z-model"],
      url: "https://api.test/v1/models",
    });
    // The provider's own headers ride along with the resolved key.
    expect(fetchMock).toHaveBeenCalledWith("https://api.test/v1/models", {
      headers: { "x-test": "yes", Authorization: "Bearer secret" },
      signal: expect.anything(),
    });
  });

  it("falls back to /v1/models when the bare path is not the API", async () => {
    runtime.getProvider.mockReturnValue({ baseUrl: "https://api.test", headers: {} });
    fetchMock
      .mockResolvedValueOnce(jsonResponse("not found", 404))
      .mockResolvedValueOnce(jsonResponse([{ id: "a-model" }]));

    expect(await listProviderModels({ provider: "custom" })).toEqual({
      models: ["a-model"],
      url: "https://api.test/v1/models",
    });
  });

  it("reports rejected credentials and unreadable lists without leaking the key", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "nope" }, 401));
    await expect(listProviderModels({ provider: "custom" })).rejects.toThrow(
      /rejected the credentials/,
    );

    vi.mocked(readSavedProviderConfig).mockResolvedValue({
      api: "anthropic-messages",
      baseUrl: "https://api.test/v1",
    });
    fetchMock.mockResolvedValue(textResponse("<html></html>"));
    await expect(listProviderModels({ provider: "custom" })).rejects.toThrow(/web page/);
  });

  it("refuses providers without a base URL", async () => {
    runtime.getProvider.mockReturnValue(undefined);
    vi.mocked(readSavedProviderConfig).mockResolvedValue({ api: "openai-completions" });
    await expect(listProviderModels({ provider: "custom" })).rejects.toThrow(/no Base URL/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // The create form fetches before the provider exists on disk: the draft supplies both
  // the endpoint and the key, so the saved config and the credential store are empty.
  it("uses the form's draft for a provider that is not saved yet", async () => {
    runtime.getProvider.mockReturnValue(undefined);
    runtime.getAuth.mockResolvedValue(undefined);
    vi.mocked(readSavedProviderConfig).mockResolvedValue(undefined);
    fetchMock.mockResolvedValue(jsonResponse({ data: [{ id: "draft-model" }] }));

    expect(
      await listProviderModels({
        provider: "170",
        draft: { baseUrl: "https://draft.test/v1", apiKey: "draft-secret" },
      }),
    ).toEqual({ models: ["draft-model"], url: "https://draft.test/v1/models" });
    expect(fetchMock).toHaveBeenCalledWith("https://draft.test/v1/models", {
      headers: { Authorization: "Bearer draft-secret" },
      signal: expect.anything(),
    });
  });

  // A saved provider with a stored key still wins when the form left the key blank —
  // otherwise re-fetching from the detail pane would send no credentials at all.
  it("falls back to the stored credential when the draft omits the key", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [{ id: "a-model" }] }));

    await listProviderModels({
      provider: "custom",
      draft: { baseUrl: "https://draft.test/v1" },
    });
    expect(fetchMock).toHaveBeenCalledWith("https://draft.test/v1/models", {
      headers: { "x-test": "yes", Authorization: "Bearer secret" },
      signal: expect.anything(),
    });
  });
});
