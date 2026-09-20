// FILE: modelRuntimeCache.ts
// Purpose: Keep one Pi model/auth runtime per agent dir, without ever serving a
// configuration that `models.json` has already replaced. The settings panel edits that
// file, but a runtime composes its providers (base URL, API key, model list) once, so a
// saved edit would otherwise stay invisible to a running session: the turn keeps talking
// to the old endpoint with the superseded key and fails with an authentication error that
// no amount of re-configuring the key can clear.
// Layer: Server provider support

export interface ModelRuntimeCacheOptions<Runtime> {
  /** Build a runtime for an agent dir. Called once per dir unless the build fails. */
  readonly create: (agentDir: string) => Promise<Runtime>;
  /** Cheap identity of the runtime's config file. Any content change must alter it. */
  readonly revision: (agentDir: string) => Promise<string>;
  /** Re-read the config file into an existing runtime. */
  readonly refresh: (runtime: Runtime, agentDir: string) => Promise<void>;
}

export interface ModelRuntimeCache<Runtime> {
  /**
   * The runtime for `agentDir`, composed from the config file as it exists now.
   *
   * Rejects when the config cannot be re-read: a runtime that silently keeps a superseded
   * configuration is how an edited key appears to have no effect at all.
   */
  get(agentDir: string): Promise<Runtime>;
}

export function createModelRuntimeCache<Runtime>(
  options: ModelRuntimeCacheOptions<Runtime>,
): ModelRuntimeCache<Runtime> {
  const runtimes = new Map<string, Promise<Runtime>>();
  const seededRevisions = new Map<string, string>();
  /** Serializes the freshness pass per dir so concurrent callers refresh at most once. */
  const freshness = new Map<string, Promise<void>>();

  const ensureFresh = (agentDir: string, runtime: Runtime): Promise<void> => {
    const queued = (freshness.get(agentDir) ?? Promise.resolve())
      .catch(() => undefined)
      .then(async () => {
        const revision = await options.revision(agentDir);
        if (seededRevisions.get(agentDir) === revision) return;
        await options.refresh(runtime, agentDir);
        seededRevisions.set(agentDir, revision);
      });
    freshness.set(agentDir, queued);
    return queued;
  };

  return {
    get: (agentDir) => {
      const cached = runtimes.get(agentDir);
      if (cached !== undefined) {
        return cached.then(async (runtime) => {
          await ensureFresh(agentDir, runtime);
          return runtime;
        });
      }

      const built = (async () => {
        // Read the revision before the build reads the file: the seeded value must never be
        // newer than the configuration the runtime loaded, or an edit landing mid-build
        // would compare equal later and never be picked up.
        const revision = await options.revision(agentDir);
        const runtime = await options.create(agentDir);
        seededRevisions.set(agentDir, revision);
        return runtime;
      })();
      const guarded = built.catch((cause: unknown) => {
        // A failed build must not be cached, or the dir stays broken until restart.
        runtimes.delete(agentDir);
        throw cause;
      });
      runtimes.set(agentDir, guarded);
      return guarded.then(async (runtime) => {
        await ensureFresh(agentDir, runtime);
        return runtime;
      });
    },
  };
}
