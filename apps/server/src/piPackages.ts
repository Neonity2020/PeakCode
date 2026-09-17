/**
 * Pi packages — the `pi install npm:@scope/pkg` / `pi install git:host/user/repo` surface,
 * driven from Peak Code instead of a terminal.
 *
 * A pi package bundles extensions, skills, prompt templates, and themes behind one source
 * recorded in `<agentDir>/settings.json`. Sessions already load whatever is recorded there,
 * so this module only has to answer three questions for the settings GUI: what is
 * configured, install one more, and remove one.
 *
 * Everything here delegates to pi's own `DefaultPackageManager`. Re-implementing source
 * parsing, npm/git layout, or the settings write would drift from the CLI's behavior
 * (`pi install`, `pi remove`, `pi list`) that users already rely on.
 */
import path from "node:path";

import {
  DefaultPackageManager,
  SettingsManager,
  getAgentDir,
  type PackageManager,
  type ResolvedPaths,
} from "@earendil-works/pi-coding-agent";
import type {
  PiPackageResourceCounts,
  PiPackageSourceKind,
  PiPackageSummary,
  PiPackagesSnapshot,
} from "@peakcode/contracts";
import { Effect } from "effect";

/** One entry from the settings-backed package list. */
type ConfiguredPackage = ReturnType<PackageManager["listConfiguredPackages"]>[number];

/** Directory a package source is anchored to when the caller does not pick one. */
export function piPackagesAgentDir(agentDir: string | undefined): string {
  return agentDir?.trim() || getAgentDir();
}

/**
 * Classify a source the way pi's installer does. Kept in sync with
 * `docs/packages.md`: an `npm:` prefix, a `git:` prefix or a protocol URL, otherwise a
 * local path.
 */
export function piPackageSourceKind(source: string): PiPackageSourceKind {
  const trimmed = source.trim();
  if (trimmed.startsWith("npm:")) return "npm";
  if (trimmed.startsWith("git:")) return "git";
  if (/^(https?|ssh|git):\/\//.test(trimmed) || /^git@[^/]+:/.test(trimmed)) return "git";
  return "local";
}

const EMPTY_RESOURCE_COUNTS: PiPackageResourceCounts = {
  extensions: 0,
  skills: 0,
  prompts: 0,
  themes: 0,
};

/**
 * Group resolved resources by the package source that contributed them.
 *
 * `resolve()` returns project/global/user resources together — auto-discovered skills from
 * `~/.agents/skills` carry the source `"auto"` — so only paths whose metadata source matches
 * a configured package are counted.
 */
function countResourcesBySource(resolved: ResolvedPaths): Map<string, PiPackageResourceCounts> {
  const counts = new Map<string, PiPackageResourceCounts>();
  const bump = (source: string, key: keyof PiPackageResourceCounts) => {
    const current = counts.get(source) ?? { ...EMPTY_RESOURCE_COUNTS };
    counts.set(source, { ...current, [key]: current[key] + 1 });
  };
  for (const resource of resolved.extensions) bump(resource.metadata.source, "extensions");
  for (const resource of resolved.skills) bump(resource.metadata.source, "skills");
  for (const resource of resolved.prompts) bump(resource.metadata.source, "prompts");
  for (const resource of resolved.themes) bump(resource.metadata.source, "themes");
  return counts;
}

function withPackageManager<T>(
  agentDir: string,
  use: (manager: DefaultPackageManager) => Promise<T>,
): Promise<T> {
  // `cwd` only matters for project-scoped sources (`.pi/settings.json`); user-scoped
  // installs anchor to the agent dir and the global npm root.
  const settingsManager = SettingsManager.create(agentDir, agentDir);
  const manager = new DefaultPackageManager({ cwd: agentDir, agentDir, settingsManager });
  return use(manager);
}

/**
 * Every configured package plus what it currently resolves to.
 *
 * Missing sources are skipped rather than installed: opening a settings page must not
 * trigger network installs behind the user's back.
 */
async function snapshot(agentDir: string): Promise<PiPackagesSnapshot> {
  return withPackageManager(agentDir, async (manager) => {
    const configured = manager.listConfiguredPackages();
    const resolved = await manager.resolve(async () => "skip");
    const counts = countResourcesBySource(resolved);
    return {
      agentDir,
      settingsPath: path.join(agentDir, "settings.json"),
      packages: configured.map(
        (entry) =>
          ({
            source: entry.source,
            kind: piPackageSourceKind(entry.source),
            scope: entry.scope,
            filtered: entry.filtered,
            installedPath: installedPathOf(entry, manager),
            resources: counts.get(entry.source) ?? { ...EMPTY_RESOURCE_COUNTS },
          }) satisfies PiPackageSummary,
      ),
    };
  });
}

function installedPathOf(entry: ConfiguredPackage, manager: PackageManager): string | undefined {
  if (entry.installedPath) return entry.installedPath;
  return manager.getInstalledPath(entry.source, entry.scope);
}

/**
 * Read the configured packages. Never installs, never mutates settings.
 */
export const listPiPackages = (
  agentDirInput: string | undefined,
): Effect.Effect<PiPackagesSnapshot, Error> =>
  Effect.tryPromise({
    try: () => snapshot(piPackagesAgentDir(agentDirInput)),
    catch: (cause) =>
      new Error(
        `Failed to read pi packages: ${cause instanceof Error ? cause.message : String(cause)}`,
        { cause },
      ),
  });

/**
 * Install a source and record it in settings, then re-read the listing.
 *
 * The install is what makes the package usable — pi resolves it from the global npm root,
 * `<agentDir>/git/<host>/<path>`, or the given path — and the settings write is what makes
 * the next session load it.
 */
export const installPiPackage = (input: {
  readonly agentDir?: string | undefined;
  readonly source: string;
}): Effect.Effect<PiPackagesSnapshot, Error> =>
  Effect.tryPromise({
    try: async () => {
      const agentDir = piPackagesAgentDir(input.agentDir);
      const source = input.source.trim();
      await withPackageManager(agentDir, (manager) => manager.installAndPersist(source));
      return snapshot(agentDir);
    },
    catch: (cause) =>
      new Error(
        `Failed to install "${input.source.trim()}": ${cause instanceof Error ? cause.message : String(cause)}`,
        { cause },
      ),
  });

/**
 * Uninstall a source and drop it from settings.
 *
 * Removing an unknown source is not an error: `removeAndPersist` reports whether the
 * settings entry existed, and the caller gets the refreshed listing either way.
 */
export const removePiPackage = (input: {
  readonly agentDir?: string | undefined;
  readonly source: string;
}): Effect.Effect<PiPackagesSnapshot, Error> =>
  Effect.tryPromise({
    try: async () => {
      const agentDir = piPackagesAgentDir(input.agentDir);
      const source = input.source.trim();
      await withPackageManager(agentDir, (manager) => manager.removeAndPersist(source));
      return snapshot(agentDir);
    },
    catch: (cause) =>
      new Error(
        `Failed to remove "${input.source.trim()}": ${cause instanceof Error ? cause.message : String(cause)}`,
        { cause },
      ),
  });
