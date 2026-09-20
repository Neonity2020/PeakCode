import { describe, expect, it } from "vitest";

import { createModelRuntimeCache } from "./modelRuntimeCache";

/** Stand-in for a pi ModelRuntime: identity matters, plus the config it was composed from. */
interface FakeRuntime {
  apiKey: string;
}

function makeHarness() {
  let apiKey = "old";
  let revisionNumber = 1;
  const builds: Array<FakeRuntime> = [];
  const refreshes: Array<FakeRuntime> = [];

  const cache = createModelRuntimeCache<FakeRuntime>({
    create: async () => {
      const runtime = { apiKey };
      builds.push(runtime);
      return runtime;
    },
    revision: async () => `v${revisionNumber}`,
    refresh: async (runtime) => {
      refreshes.push(runtime);
      runtime.apiKey = apiKey;
    },
  });

  return {
    cache,
    builds,
    refreshes,
    /** A save in the settings panel: the file now composes a different provider config. */
    edit(nextApiKey: string) {
      apiKey = nextApiKey;
      revisionNumber += 1;
    },
  };
}

describe("createModelRuntimeCache", () => {
  it("builds one runtime per agent dir and reuses it while the config file is unchanged", async () => {
    const harness = makeHarness();

    const first = await harness.cache.get("/agent");
    const second = await harness.cache.get("/agent");

    expect(harness.builds).toHaveLength(1);
    expect(second).toBe(first);
    expect(harness.refreshes).toEqual([]);
  });

  it("picks up a provider edit without a restart", async () => {
    const harness = makeHarness();
    const runtime = await harness.cache.get("/agent");

    harness.edit("new");

    // The bug this guards: a turn kept talking to the superseded endpoint with the
    // superseded key, so re-configuring the API key appeared to change nothing at all.
    expect((await harness.cache.get("/agent")).apiKey).toBe("new");
    expect(harness.builds).toHaveLength(1);
    expect(harness.refreshes).toEqual([runtime]);
  });

  it("refreshes once no matter how many edits preceded the use", async () => {
    const harness = makeHarness();
    await harness.cache.get("/agent");

    harness.edit("middle");
    harness.edit("final");
    await harness.cache.get("/agent");

    expect(harness.refreshes).toHaveLength(1);
  });

  it("refreshes once when concurrent callers race the same edit", async () => {
    const harness = makeHarness();
    await harness.cache.get("/agent");

    harness.edit("new");
    const [a, b, c] = await Promise.all([
      harness.cache.get("/agent"),
      harness.cache.get("/agent"),
      harness.cache.get("/agent"),
    ]);

    expect(harness.refreshes).toHaveLength(1);
    expect(a.apiKey).toBe("new");
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it("keeps separate agent dirs independent", async () => {
    const harness = makeHarness();

    const first = await harness.cache.get("/one");
    const second = await harness.cache.get("/two");

    expect(second).not.toBe(first);
    expect(harness.builds).toHaveLength(2);
  });

  it("shares one runtime between callers that ask before the build resolves", async () => {
    const harness = makeHarness();

    const [a, b] = await Promise.all([harness.cache.get("/agent"), harness.cache.get("/agent")]);

    expect(harness.builds).toHaveLength(1);
    expect(b).toBe(a);
  });

  it("does not cache a failed build", async () => {
    let attempts = 0;
    const cache = createModelRuntimeCache<string>({
      create: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("unreadable config");
        return "runtime";
      },
      revision: async () => "v1",
      refresh: async () => undefined,
    });

    await expect(cache.get("/agent")).rejects.toThrow("unreadable config");
    expect(await cache.get("/agent")).toBe("runtime");
    expect(attempts).toBe(2);
  });

  it("surfaces a refresh failure instead of silently serving the superseded config", async () => {
    let revision = "v1";
    const cache = createModelRuntimeCache<string>({
      create: async () => "runtime",
      revision: async () => revision,
      refresh: async () => {
        throw new Error("malformed models.json");
      },
    });
    await cache.get("/agent");

    revision = "v2";

    await expect(cache.get("/agent")).rejects.toThrow("malformed models.json");
  });

  it("does not miss an edit that lands while the runtime is being built", async () => {
    // The revision is read before the build reads the file, so a rewrite landing in between
    // leaves the seeded revision older than the build's config — a mismatch, not a blind spot.
    let revision = "v1";
    let composedApiKey = "old";
    const cache = createModelRuntimeCache<FakeRuntime>({
      create: async () => {
        revision = "v2";
        composedApiKey = "new";
        return { apiKey: "old" };
      },
      revision: async () => revision,
      refresh: async (runtime) => {
        runtime.apiKey = composedApiKey;
      },
    });

    expect((await cache.get("/agent")).apiKey).toBe("new");
  });
});
