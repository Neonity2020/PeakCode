import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, FileSystem } from "effect";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  isProviderKeyReference,
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

  it("round-trips the inputTypes extension without touching pi's input", () => {
    const json = {
      id: "my-model",
      input: ["text", "image"],
      inputTypes: ["text", "image", "video", "pdf"],
    };
    const entry = modelEntryFromJson(json);
    expect(entry!.input).toEqual(["text", "image"]);
    expect(entry!.inputTypes).toEqual(["text", "image", "video", "pdf"]);
    expect(modelEntryToJson(entry!)).toEqual(json);
  });

  it("keeps inputTypes out of pi's input and drops unknown kinds", () => {
    const entry = modelEntryFromJson({
      id: "x",
      input: ["text", "video"],
      inputTypes: ["text", "video", "audio"],
    });
    expect(entry!.input).toEqual(["text"]);
    expect(entry!.inputTypes).toEqual(["text", "video"]);
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
      await runWithFs(
        saveModelProvidersFile({
          agentDir,
          providers: {
            custom: {
              name: "Custom Display",
              apiKey: "old",
              baseUrl: "https://old.test",
              models: [{ id: "old" }],
            },
          },
        }),
      );
      await runWithFs(
        saveModelProvidersFile({
          agentDir,
          providers: {
            custom: { name: "Custom Display", extra: { customOption: true } },
          },
        }),
      );
      const loaded = await runWithFs(readModelProvidersFile(agentDir));
      // The key is not a config field: it survives the edit as a stored credential, so the
      // provider still authenticates.
      expect(loaded.providers.custom).toEqual({
        name: "Custom Display",
        extra: { customOption: true },
        hasStoredKey: true,
      });
      expect(await readAuthJson(agentDir)).toEqual({
        custom: { type: "api_key", key: "old" },
      });
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

/** The credential file is plain JSON; read it directly so tests assert real bytes. */
async function readAuthJson(agentDir: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(join(agentDir, "auth.json"), "utf8"));
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw cause;
  }
}

async function readModelsJson(agentDir: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(agentDir, "models.json"), "utf8"));
}

/** One provider entry as it sits on disk, for asserting what a save wrote. */
async function readModelsProvider(
  agentDir: string,
  name: string,
): Promise<Record<string, unknown>> {
  const parsed = await readModelsJson(agentDir);
  const providers = (parsed.providers ?? {}) as Record<string, Record<string, unknown>>;
  return providers[name] ?? {};
}

describe("provider API key storage", () => {
  /** One temp agent dir per test; keys live next to models.json exactly as pi expects. */
  const withAgentDir = async (body: (agentDir: string) => Promise<void>) => {
    const agentDir = await mkdtemp(join(tmpdir(), "peakcode-mp-keys-"));
    try {
      await body(agentDir);
    } finally {
      await rm(agentDir, { recursive: true, force: true });
    }
  };

  it("stores a literal key in the credential store, never in the config file", async () => {
    await withAgentDir(async (agentDir) => {
      const saved = await runWithFs(
        saveModelProvidersFile({
          agentDir,
          providers: {
            deepseek: {
              name: "deepseek",
              api: "openai-completions",
              baseUrl: "https://api.qiyuanapi.cc/v1",
              apiKey: "sk-literal-secret",
              models: [{ id: "deepseek-v4.1" }],
            },
          },
        }),
      );

      expect(await readAuthJson(agentDir)).toEqual({
        deepseek: { type: "api_key", key: "sk-literal-secret" },
      });
      const models = await readModelsJson(agentDir);
      expect(JSON.stringify(models)).not.toContain("sk-literal-secret");
      expect((await readModelsProvider(agentDir, "deepseek")).apiKey).toBeUndefined();
      // The UI is told a key exists, but never receives the key itself.
      expect(saved.providers.deepseek?.hasStoredKey).toBe(true);
      expect(saved.providers.deepseek?.apiKey).toBeUndefined();
    });
  });

  it("keeps an $ENV / !command reference in the config file instead", async () => {
    await withAgentDir(async (agentDir) => {
      await runWithFs(
        saveModelProvidersFile({
          agentDir,
          providers: {
            deepseek: { apiKey: "$DEEPSEEK_API_KEY" },
            rotated: { apiKey: "!op read op://vault/key" },
          },
        }),
      );

      expect((await readModelsProvider(agentDir, "deepseek")).apiKey).toBe("$DEEPSEEK_API_KEY");
      expect((await readModelsProvider(agentDir, "rotated")).apiKey).toBe(
        "!op read op://vault/key",
      );
      // A reference is not a secret, so nothing lands in the credential store.
      expect(await readAuthJson(agentDir)).toEqual({});
    });
  });

  it("replaces a stored key when a reference is saved, so the reference is not shadowed", async () => {
    await withAgentDir(async (agentDir) => {
      await runWithFs(
        saveModelProvidersFile({ agentDir, providers: { deepseek: { apiKey: "sk-old" } } }),
      );
      await runWithFs(
        saveModelProvidersFile({
          agentDir,
          providers: { deepseek: { apiKey: "$DEEPSEEK_API_KEY" } },
        }),
      );

      // A stored credential outranks a configured key, so leaving it would make the
      // reference appear to do nothing.
      expect(await readAuthJson(agentDir)).toEqual({});
      expect((await readModelsProvider(agentDir, "deepseek")).apiKey).toBe("$DEEPSEEK_API_KEY");
    });
  });

  it("keeps an existing key when the panel submits no key", async () => {
    await withAgentDir(async (agentDir) => {
      await runWithFs(
        saveModelProvidersFile({ agentDir, providers: { deepseek: { apiKey: "sk-keep-me" } } }),
      );
      // The UI never receives the stored key, so a later save sends the provider back
      // without one — that must mean "unchanged", not "forget it".
      await runWithFs(
        saveModelProvidersFile({
          agentDir,
          providers: { deepseek: { name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1" } },
        }),
      );

      expect(await readAuthJson(agentDir)).toEqual({
        deepseek: { type: "api_key", key: "sk-keep-me" },
      });
    });
  });

  it("migrates a literal key already sitting in models.json", async () => {
    await withAgentDir(async (agentDir) => {
      const fs = await createTestFs();
      await runWithFs(
        fs.writeFileString(
          join(agentDir, "models.json"),
          JSON.stringify({
            providers: {
              deepseek: { apiKey: "sk-legacy", baseUrl: "https://api.deepseek.com/v1" },
            },
          }),
        ),
      );

      // A save that does not mention the key still moves it out of the config file.
      await runWithFs(
        saveModelProvidersFile({
          agentDir,
          providers: { deepseek: { baseUrl: "https://api.deepseek.com/v1" } },
        }),
      );

      expect(await readAuthJson(agentDir)).toEqual({
        deepseek: { type: "api_key", key: "sk-legacy" },
      });
      expect((await readModelsProvider(agentDir, "deepseek")).apiKey).toBeUndefined();
    });
  });

  it("forgets the key on request, and never writes the intent flags to disk", async () => {
    await withAgentDir(async (agentDir) => {
      await runWithFs(
        saveModelProvidersFile({ agentDir, providers: { deepseek: { apiKey: "sk-drop-me" } } }),
      );
      const saved = await runWithFs(
        saveModelProvidersFile({
          agentDir,
          providers: { deepseek: { clearStoredKey: true } },
        }),
      );

      expect(await readAuthJson(agentDir)).toEqual({});
      expect(saved.providers.deepseek?.hasStoredKey).toBeUndefined();
      const raw = await readFile(join(agentDir, "models.json"), "utf8");
      expect(raw).not.toContain("clearStoredKey");
      expect(raw).not.toContain("hasStoredKey");
    });
  });

  it("drops the stored key of a provider removed from the map", async () => {
    await withAgentDir(async (agentDir) => {
      await runWithFs(
        saveModelProvidersFile({
          agentDir,
          providers: { deepseek: { apiKey: "sk-a" }, other: { apiKey: "sk-b" } },
        }),
      );
      await runWithFs(saveModelProvidersFile({ agentDir, providers: { other: {} } }));

      // A key left behind would silently authenticate a provider that is added again later.
      expect(await readAuthJson(agentDir)).toEqual({
        other: { type: "api_key", key: "sk-b" },
      });
    });
  });

  it("leaves OAuth logins and other credentials untouched", async () => {
    await withAgentDir(async (agentDir) => {
      const fs = await createTestFs();
      await runWithFs(
        fs.writeFileString(
          join(agentDir, "auth.json"),
          JSON.stringify({
            anthropic: { type: "oauth", access: "token", refresh: "r", expires: 1 },
          }),
        ),
      );

      await runWithFs(
        saveModelProvidersFile({ agentDir, providers: { deepseek: { apiKey: "sk-new" } } }),
      );
      // Forgetting a key must not log the provider out either.
      await runWithFs(
        saveModelProvidersFile({
          agentDir,
          providers: { deepseek: { clearStoredKey: true } },
        }),
      );

      expect(await readAuthJson(agentDir)).toEqual({
        anthropic: { type: "oauth", access: "token", refresh: "r", expires: 1 },
      });
    });
  });

  it("reports a stored key on read without echoing it", async () => {
    await withAgentDir(async (agentDir) => {
      const fs = await createTestFs();
      await runWithFs(
        fs.writeFileString(
          join(agentDir, "models.json"),
          JSON.stringify({
            providers: { deepseek: { baseUrl: "https://api.qiyuanapi.cc/v1" } },
          }),
        ),
      );
      await runWithFs(
        fs.writeFileString(
          join(agentDir, "auth.json"),
          JSON.stringify({ deepseek: { type: "api_key", key: "sk-hidden" } }),
        ),
      );

      const result = await runWithFs(readModelProvidersFile(agentDir));
      expect(result.providers.deepseek?.hasStoredKey).toBe(true);
      expect(JSON.stringify(result)).not.toContain("sk-hidden");
    });
  });

  it("surfaces an unreadable credential file instead of pretending no key is stored", async () => {
    await withAgentDir(async (agentDir) => {
      const fs = await createTestFs();
      await runWithFs(fs.writeFileString(join(agentDir, "auth.json"), "{ not json"));

      const error = await runWithFs(readModelProvidersFile(agentDir).pipe(Effect.flip));
      expect(error.message).toContain("auth.json");
    });
  });
});

describe("isProviderKeyReference", () => {
  it("separates references from literal secrets", () => {
    // pi expands $NAME/${NAME}/!cmd and sends anything else verbatim, so a bare
    // environment-variable *name* must be treated as a secret, not as a reference.
    expect(isProviderKeyReference("$DEEPSEEK_API_KEY")).toBe(true);
    expect(isProviderKeyReference("${DEEPSEEK_API_KEY}")).toBe(true);
    expect(isProviderKeyReference("!op read op://vault/key")).toBe(true);
    expect(isProviderKeyReference("prefix-$ENV")).toBe(true);
    expect(isProviderKeyReference("DEEPSEEK_API_KEY")).toBe(false);
    expect(isProviderKeyReference("sk-opc1234567890")).toBe(false);
    expect(isProviderKeyReference("ollama")).toBe(false);
  });
});
