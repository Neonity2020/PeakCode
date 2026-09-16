import {
  CommandId,
  ProjectCreateCommand,
  ProjectId,
  type ModelSelection,
} from "@peakcode/contracts";
import { Schema } from "effect";
import type { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

const readNativeApi = vi.fn<() => unknown>(() => ({}));

vi.mock("../nativeApi", () => ({
  readNativeApi: () => readNativeApi(),
}));

import { useComposerDraftStore } from "../composerDraftStore";
import {
  resolveProjectDefaultModelSelection,
  toProjectDefaultModelSelection,
} from "./projectDefaultModelSelection";

const STICKY_SELECTION: ModelSelection = {
  provider: "pi",
  model: "deepseek/deepseek-v4.1",
};

function makeQueryClient(models: ReadonlyArray<{ slug: string; name?: string }>): QueryClient {
  return {
    ensureQueryData: vi.fn(async () => ({ models, source: "pi.sdk", cached: false })),
  } as unknown as QueryClient;
}

function setStickyModel(model: string | null): void {
  useComposerDraftStore.setState({
    stickyModelSelectionByProvider: model ? { pi: { provider: "pi", model } } : {},
  });
}

afterEach(() => {
  readNativeApi.mockReset();
  readNativeApi.mockReturnValue({});
  setStickyModel(null);
  vi.useRealTimers();
});

describe("toProjectDefaultModelSelection", () => {
  it("drops empty and whitespace-only slugs so project.create stays schema-valid", () => {
    expect(toProjectDefaultModelSelection("pi", "")).toBeNull();
    expect(toProjectDefaultModelSelection("pi", "   ")).toBeNull();
    expect(toProjectDefaultModelSelection("pi", null)).toBeNull();
    expect(toProjectDefaultModelSelection("pi", undefined)).toBeNull();
  });

  it("trims a real slug", () => {
    expect(toProjectDefaultModelSelection("pi", " deepseek/deepseek-v4.1 ")).toEqual({
      provider: "pi",
      model: "deepseek/deepseek-v4.1",
    });
  });
});

describe("resolveProjectDefaultModelSelection", () => {
  it("prefers the last model the composer used when the provider still lists it", async () => {
    setStickyModel("deepseek/deepseek-v4.1");

    await expect(
      resolveProjectDefaultModelSelection({
        queryClient: makeQueryClient([
          { slug: "omlx/Huihui-Qwen3.8-27B" },
          { slug: "deepseek/deepseek-v4.1" },
        ]),
      }),
    ).resolves.toEqual(STICKY_SELECTION);
  });

  it("falls back to the first discovered model when no model was used yet", async () => {
    await expect(
      resolveProjectDefaultModelSelection({
        queryClient: makeQueryClient([
          { slug: "omlx/Huihui-Qwen3.8-27B" },
          { slug: "deepseek/deepseek-v4.1" },
        ]),
      }),
    ).resolves.toEqual({ provider: "pi", model: "omlx/Huihui-Qwen3.8-27B" });
  });

  it("ignores a last-used model the provider no longer offers", async () => {
    setStickyModel("removed/gone-model");

    await expect(
      resolveProjectDefaultModelSelection({
        queryClient: makeQueryClient([{ slug: "deepseek/deepseek-v4.1" }]),
      }),
    ).resolves.toEqual(STICKY_SELECTION);
  });

  it("returns null when the provider reports no models", async () => {
    setStickyModel("deepseek/deepseek-v4.1");

    await expect(
      resolveProjectDefaultModelSelection({ queryClient: makeQueryClient([]) }),
    ).resolves.toBeNull();
  });

  it("returns null when the app server is unavailable", async () => {
    readNativeApi.mockReturnValue(null);
    const queryClient = makeQueryClient([{ slug: "deepseek/deepseek-v4.1" }]);

    await expect(resolveProjectDefaultModelSelection({ queryClient })).resolves.toBeNull();
    expect(queryClient.ensureQueryData).not.toHaveBeenCalled();
  });

  it("does not wait on a model listing that never settles", async () => {
    vi.useFakeTimers();
    const queryClient = {
      ensureQueryData: vi.fn(() => new Promise(() => {})),
    } as unknown as QueryClient;

    const resolved = resolveProjectDefaultModelSelection({ queryClient });
    await vi.advanceTimersByTimeAsync(30_000);

    await expect(resolved).resolves.toBeNull();
  });

  it("produces a project.create payload the command schema accepts", async () => {
    setStickyModel("deepseek/deepseek-v4.1");
    const defaultModelSelection = await resolveProjectDefaultModelSelection({
      queryClient: makeQueryClient([{ slug: "deepseek/deepseek-v4.1" }]),
    });

    const payload = {
      type: "project.create",
      commandId: CommandId.makeUnsafe("cmd_1"),
      projectId: ProjectId.makeUnsafe("project_1"),
      kind: "project",
      title: "repo",
      workspaceRoot: "/tmp/repo",
      createWorkspaceRootIfMissing: false,
      ...(defaultModelSelection ? { defaultModelSelection } : {}),
      createdAt: "2026-09-16T00:00:00.000Z",
    };

    expect(() => Schema.decodeUnknownSync(ProjectCreateCommand)(payload)).not.toThrow();
  });

  it("keeps the payload schema-valid when no model can be resolved", () => {
    const payload = {
      type: "project.create",
      commandId: CommandId.makeUnsafe("cmd_1"),
      projectId: ProjectId.makeUnsafe("project_1"),
      kind: "project",
      title: "repo",
      workspaceRoot: "/tmp/repo",
      createdAt: "2026-09-16T00:00:00.000Z",
    };

    expect(() => Schema.decodeUnknownSync(ProjectCreateCommand)(payload)).not.toThrow();
    // The empty slug this flow used to send is exactly what the schema rejects.
    expect(() =>
      Schema.decodeUnknownSync(ProjectCreateCommand)({
        ...payload,
        defaultModelSelection: { provider: "pi", model: "" },
      }),
    ).toThrow();
  });
});
