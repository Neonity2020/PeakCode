// Bundled plugin registry.
//
// Peak Code ships two kinds of plugin sources: the provider's own marketplaces (Codex's, when
// a Codex runtime is present) and the in-tree plugins under `./plugins`, which are embedded
// into the server bundle by `scripts/generate-bundled-plugins.ts`. This module is the read
// path for the second kind.
//
// A bundled plugin is not a sandbox: it is a manifest plus skills. The skills are installed
// into the shared skill library so the agent can read them and the composer can reference
// them; the manifest is what plugin discovery and the composer's mention list are built from.
import {
  BUNDLED_PLUGINS,
  type BundledPlugin,
  type BundledPluginSkill,
} from "./bundled.generated.ts";

/**
 * Marketplace name for everything Peak Code ships itself.
 *
 * Deliberately distinct from a provider marketplace name so the /plugins view can tell the
 * two apart, and so an id from one is never mistaken for an id from the other.
 */
export const BUNDLED_PLUGIN_MARKETPLACE = "Peak Code";

/**
 * Path of the bundled marketplace.
 *
 * Not a filesystem location: the plugins are embedded in the server bundle, and the path
 * exists so a bundled plugin is addressable by the same (marketplacePath, pluginName) pair
 * the provider's own plugins use. `readPlugin` matches on it, and the UI shows it, so it
 * reads as a location rather than as an opaque id.
 */
export const BUNDLED_PLUGIN_MARKETPLACE_PATH = "bundled";

/** Every bundled plugin, newest-first irrelevant: the order is the manifest order on disk. */
export function listBundledPlugins(): readonly BundledPlugin[] {
  return BUNDLED_PLUGINS;
}

/** One bundled plugin by name, or `null` when nothing ships under that name. */
export function readBundledPlugin(name: string): BundledPlugin | null {
  const wanted = name.trim().toLowerCase();
  return BUNDLED_PLUGINS.find((plugin) => plugin.name.toLowerCase() === wanted) ?? null;
}

/**
 * Every skill every bundled plugin declares, flattened.
 *
 * The installer takes this list directly: a plugin's skill is installed exactly like any
 * other bundled skill, into the shared library, where `listSkills`, `read_skill` and the
 * `/skills` view all pick it up without knowing plugins exist.
 */
export function bundledPluginSkills(): readonly BundledPluginSkill[] {
  return BUNDLED_PLUGINS.flatMap((plugin) => plugin.skills);
}

/** The stable id plugin discovery reports for a bundled plugin. */
export function bundledPluginId(name: string): string {
  return `${BUNDLED_PLUGIN_MARKETPLACE.toLowerCase().replace(/\s+/g, "-")}/${name}`;
}
