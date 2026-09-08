import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, FileSystem } from "effect";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  modelEntryFromJson,
  modelEntryToJson,
  providerFromJson,
  providerToJson,
  readModelProvidersFile,
  saveModelProvidersFile,
} from "./modelProviders";

const testLayer = NodeServices.layer;

const runWithFs = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.runPromise(effect.pipe(Effect.provide(testLayer)) as Effect.Effect<A, E, never>);

const createTestFs = async () =>
  runWithFs(
    Effect.gen(function* () {
      return yield* FileSystem.FileSystem;
    }),
  );

describe("model entry conversions", () => {
  it("round-trips editable fields and preserves unknown keys", () => {
    const json = {
      id: "my-model",
      name: "My Model",
      api: "openai-completions",
      reasoning: true,
      input: ["text", "image"],
      contextWindow: 131072,
      maxTokens: 8192,
      cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0.5 },
      samplingParams: { temperature: 1.0 },
      customField: { nested: true },
    };

    const entry = modelEntryFromJson(json);
    expect(entry).not.toBeNull();
    expect(entry!.id).toBe("my-model");
    expect(entry!.api).toBe("openai-completions");
    expect(entry!.extra).toEqual({ customField: { nested: true } });

    const back = modelEntryToJson(entry!);
    expect(back).toEqual(json);
  });

  it("rejects entries without an id and ignores unknown api kinds", () => {
    expect(modelEntryFromJson({ name: "No id" })).toBeNull();
    const entry = modelEntryFromJson({ id: "x", api: "not-a-real-api", baseUrl: 42 });
    expect(entry!.api).toBeUndefined();
    expect(entry!.baseUrl).toBeUndefined();
  });

  it("drops malformed members from arrays but keeps valid ones", () => {
    const entry = modelEntryFromJson({
      id: "x",
      input: ["text", "not-an-input"],
      cost: { input: 1, output: "expensive" },
    });
    expect(entry!.input).toEqual(["text"]);
    expect(entry!.cost!.output).toBeUndefined();
  });
});

describe("provider conversions", () => {
  it("round-trips a provider with models and unknown keys", () => {
    const json = {
      name: "My Friendly Provider",
      api: "anthropic-messages",
      baseUrl: "https://example.com",
      apiKey: "$MY_KEY",
      authHeader: true,
      headers: { "x-custom": "value" },
      modelOverrides: { "built-in": { contextWindow: 200000 } },
      models: [{ id: "m1" }, { id: "m2", reasoning: true }],
      oauth: { type: "radius", baseUrl: "https://auth.example.com" },
    };

    const provider = providerFromJson("my-provider", json);
    expect(provider).not.toBeNull();
    expect(provider!.name).toBe("My Friendly Provider");
    expect(provider!.models).toHaveLength(2);
    expect(provider!.extra).toEqual({
      oauth: { type: "radius", baseUrl: "https://auth.example.com" },
    });

    const back = providerToJson(provider!);
    expect(back.oauth).toEqual(json.oauth);
    expect(back.models).toEqual(json.models);
    expect(back).toEqual(expect.objectContaining(json));
  });

  it("returns null for non-object provider entries", () => {
    expect(providerFromJson("bad", "not-an-object")).toBeNull();
    expect(providerFromJson("bad", null)).toBeNull();
  });
});

describe("readModelProvidersFile", () => {
  it("returns an empty map when the file does not exist", async () => {
    const agentDir = await mkdtemp(join(tmpdir(), "peakcode-mp-"));
    try {
      const result = await runWithFs(readModelProvidersFile(agentDir));
      expect(result.providers).toEqual({});
      expect(result.path).toBe(join(agentDir, "models.json"));
    } finally {
      await rm(agentDir, { recursive: true, force: true });
    }
  });

  it("parses an existing file into structured providers", async () => {
    const agentDir = await mkdtemp(join(tmpdir(), "peakcode-mp-"));
    try {
      const fs = await createTestFs();
      await runWithFs(
        fs.writeFileString(
          join(agentDir, "models.json"),
          JSON.stringify({
            customTopLevelKey: "keep-me",
            providers: {
              mini: {
                api: "openai-completions",
                baseUrl: "https://api.minimaxi.com/v1",
                models: [{ id: "MiniMax-M3" }],
              },
            },
          }),
        ),
      );
      const result = await runWithFs(readModelProvidersFile(agentDir));
      expect(result.providers.mini?.api).toBe("openai-completions");
      expect(result.providers.mini?.models?.[0]?.id).toBe("MiniMax-M3");
    } finally {
      await rm(agentDir, { recursive: true, force: true });
    }
  });

  it("fails on malformed JSON instead of returning garbage", async () => {
    const agentDir = await mkdtemp(join(tmpdir(), "peakcode-mp-"));
    try {
      const fs = await createTestFs();
      await runWithFs(fs.writeFileString(join(agentDir, "models.json"), "{ not json"));
      const error = await runWithFs(readModelProvidersFile(agentDir).pipe(Effect.flip));
      expect(error.message).toContain("Failed to parse");
    } finally {
      await rm(agentDir, { recursive: true, force: true });
    }
  });
});

describe("saveModelProvidersFile", () => {
  it("writes providers and preserves unknown top-level keys", async () => {
    const agentDir = await mkdtemp(join(tmpdir(), "peakcode-mp-"));
    try {
      const fs = await createTestFs();
      await runWithFs(
        fs.writeFileString(
          join(agentDir, "models.json"),
          JSON.stringify({
            customTopLevelKey: "keep-me",
            providers: { old: { api: "openai-completions" } },
          }),
        ),
      );

      const saved = await runWithFs(
        saveModelProvidersFile({
          agentDir,
          providers: {
            new: providerFromJson("new", {
              api: "anthropic-messages",
              baseUrl: "https://example.com",
              models: [{ id: "m1" }],
            })!,
          },
        }),
      );
      expect(saved.providers.new?.baseUrl).toBe("https://example.com");
      expect(saved.providers.old).toBeUndefined();

      const raw = await runWithFs(fs.readFileString(join(agentDir, "models.json")));
      const parsed = JSON.parse(raw) as { customTopLevelKey?: string; providers?: unknown };
      expect(parsed.customTopLevelKey).toBe("keep-me");
      expect(parsed.providers).toHaveProperty("new");
    } finally {
      await rm(agentDir, { recursive: true, force: true });
    }
  });

  it("creates the file from scratch when missing", async () => {
    const agentDir = await mkdtemp(join(tmpdir(), "peakcode-mp-"));
    try {
      const saved = await runWithFs(
        saveModelProvidersFile({
          agentDir,
          providers: {
            local: providerFromJson("local", {
              api: "openai-completions",
              baseUrl: "http://localhost:11434/v1",
              models: [{ id: "llama3.1:8b" }],
            })!,
          },
        }),
      );
      expect(saved.path).toBe(join(agentDir, "models.json"));
      expect(saved.providers.local?.models?.[0]?.id).toBe("llama3.1:8b");
    } finally {
      await rm(agentDir, { recursive: true, force: true });
    }
  });

  it("persists field and model removal and preserves display names", async () => {
    const agentDir = await mkdtemp(join(tmpdir(), "peakcode-mp-"));
    try {
      await runWithFs(saveModelProvidersFile({ agentDir, providers: {
        custom: { name: "Custom Display", apiKey: "old", baseUrl: "https://old.test", models: [{ id: "old" }] },
      } }));
      await runWithFs(saveModelProvidersFile({ agentDir, providers: {
        custom: { name: "Custom Display", extra: { customOption: true } },
      } }));
      const loaded = await runWithFs(readModelProvidersFile(agentDir));
      expect(loaded.providers.custom).toEqual({ name: "Custom Display", extra: { customOption: true } });
    } finally {
      await rm(agentDir, { recursive: true, force: true });
    }
  });

  it("refuses to overwrite malformed files", async () => {
    const agentDir = await mkdtemp(join(tmpdir(), "peakcode-mp-"));
    try {
      const fs = await createTestFs();
      await runWithFs(fs.writeFileString(join(agentDir, "models.json"), "{ broken"));
      const error = await runWithFs(
        saveModelProvidersFile({ agentDir, providers: {} }).pipe(Effect.flip),
      );
      expect(error.message).toContain("Refusing to overwrite");
      // Original content untouched.
      const raw = await runWithFs(fs.readFileString(join(agentDir, "models.json")));
      expect(raw).toBe("{ broken");
    } finally {
      await rm(agentDir, { recursive: true, force: true });
    }
  });
});
