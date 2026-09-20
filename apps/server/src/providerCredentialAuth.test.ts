/**
 * End-to-end check that a key saved through the settings panel actually authenticates the
 * provider on the next turn.
 *
 * The pieces are unit-tested separately; this pins the contract between them, which is
 * where the bug lived: the panel wrote a key to `models.json`, but pi resolved auth from
 * its own stores, so every turn authenticated as something else (or as nothing) and no
 * amount of re-configuring the key changed that.
 */
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect } from "effect";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { saveModelProvidersFile } from "./modelProviders";

const runWithFs = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.runPromise(effect.pipe(Effect.provide(NodeServices.layer)) as Effect.Effect<A, E, never>);

const withAgentDir = async (body: (agentDir: string) => Promise<void>) => {
  const agentDir = await mkdtemp(join(tmpdir(), "peakcode-keys-e2e-"));
  try {
    await body(agentDir);
  } finally {
    await rm(agentDir, { recursive: true, force: true });
  }
};

/** Build a runtime the way PiAdapter does, and report what a turn would authenticate with. */
async function resolveTurn(
  agentDir: string,
  provider: string,
  modelId: string,
  env?: Record<string, string>,
) {
  const runtime = await ModelRuntime.create({
    authPath: join(agentDir, "auth.json"),
    modelsPath: join(agentDir, "models.json"),
  });
  await runtime.refresh({ allowNetwork: false });
  const model = runtime.getModel(provider, modelId);
  if (!model) throw new Error(`No model ${provider}/${modelId} in the saved configuration.`);
  const auth = await runtime.getAuth(model, env ? { env } : {});
  return {
    baseUrl: model.baseUrl,
    key: auth?.auth.apiKey,
    available: (await runtime.getAvailable()).filter((entry) => entry.provider === provider).length,
  };
}

describe("saved provider keys reach a turn", () => {
  it("authenticates a custom gateway provider with the key the panel stored", async () => {
    await withAgentDir(async (agentDir) => {
      const secret = "sk-opc-real-looking-secret-0Vl1";
      await runWithFs(
        saveModelProvidersFile({
          agentDir,
          providers: {
            deepseek: {
              name: "deepseek",
              api: "openai-completions",
              baseUrl: "https://api.qiyuanapi.cc/v1",
              apiKey: secret,
              models: [{ id: "deepseek-v4.1", name: "deepseek-v4.1" }],
            },
          },
        }),
      );

      const turn = await resolveTurn(agentDir, "deepseek", "deepseek-v4.1");
      expect(turn.key).toBe(secret);
      // The configured endpoint is what the turn talks to: auth and routing come from the
      // same saved provider, so a stale composition cannot send it to the vendor instead.
      expect(turn.baseUrl).toBe("https://api.qiyuanapi.cc/v1");
      // The provider must stay selectable: a key that hides the model is not usable.
      expect(turn.available).toBeGreaterThan(0);
    });
  });

  it("keeps the secret out of the config file and out of the panel payload", async () => {
    await withAgentDir(async (agentDir) => {
      const secret = "sk-should-never-be-in-config";
      const saved = await runWithFs(
        saveModelProvidersFile({
          agentDir,
          providers: {
            deepseek: {
              apiKey: secret,
              baseUrl: "https://api.deepseek.com/v1",
              models: [{ id: "deepseek-v4.1" }],
            },
          },
        }),
      );

      const models = await readFile(join(agentDir, "models.json"), "utf8");
      expect(models).not.toContain(secret);
      expect(JSON.stringify(saved.providers)).not.toContain(secret);
      expect(saved.providers.deepseek?.hasStoredKey).toBe(true);
      // ...but pi still gets it.
      expect((await resolveTurn(agentDir, "deepseek", "deepseek-v4.1")).key).toBe(secret);
    });
  });

  it("resolves an $ENV reference kept in the config file", async () => {
    await withAgentDir(async (agentDir) => {
      await runWithFs(
        saveModelProvidersFile({
          agentDir,
          providers: {
            deepseek: {
              apiKey: "$PEAKCODE_TEST_PROVIDER_KEY",
              baseUrl: "https://api.qiyuanapi.cc/v1",
              models: [{ id: "deepseek-v4.1" }],
            },
          },
        }),
      );

      const models = await readFile(join(agentDir, "models.json"), "utf8");
      expect(models).toContain("$PEAKCODE_TEST_PROVIDER_KEY");
      expect(await readFile(join(agentDir, "auth.json"), "utf8").catch(() => "")).not.toContain(
        "sk-",
      );

      const turn = await resolveTurn(agentDir, "deepseek", "deepseek-v4.1", {
        PEAKCODE_TEST_PROVIDER_KEY: "sk-from-the-environment",
      });
      expect(turn.key).toBe("sk-from-the-environment");
    });
  });

  it("authenticates a key migrated out of a pre-existing models.json", async () => {
    await withAgentDir(async (agentDir) => {
      const legacy = "sk-legacy-literal";
      await runWithFs(
        saveModelProvidersFile({
          agentDir,
          providers: {
            deepseek: {
              baseUrl: "https://api.qiyuanapi.cc/v1",
              apiKey: legacy,
              models: [{ id: "deepseek-v4.1" }],
            },
          },
        }),
      );
      // A later save that never mentions the key (the panel cannot echo it) must not lose it.
      await runWithFs(
        saveModelProvidersFile({
          agentDir,
          providers: {
            deepseek: {
              baseUrl: "https://api.qiyuanapi.cc/v1",
              models: [{ id: "deepseek-v4.1" }],
            },
          },
        }),
      );

      expect((await resolveTurn(agentDir, "deepseek", "deepseek-v4.1")).key).toBe(legacy);
    });
  });
});
