#!/usr/bin/env node
/**
 * Generate the bundled plugin payload Peak Code ships in-tree.
 *
 * A plugin on disk is `<name>/plugin.json` plus `<name>/skills/<skill-id>/…`. The installed
 * server bundles TypeScript only, so the plugin manifests and their skill files are embedded
 * here as strings. At runtime the skills are written into the shared skill library and the
 * manifests are served to plugin discovery — which is what makes a plugin show up in the
 * /plugins view and mentionable in the composer.
 *
 * Run after editing anything under `plugins/`:
 *   bun scripts/generate-bundled-plugins.ts
 *
 * `buildBundledPlugins` is the data half and `renderBundledPlugins` the text half, so a test
 * can compare the payload as data. Comparing the rendered file byte-for-byte would fail the
 * moment the formatter reflowed it, which says nothing about whether the plugins are current.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, posix, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * The payload shape this script emits.
 *
 * Declared here rather than imported from the module it generates: `scripts` and
 * `packages/agent-toolkit` are separate TypeScript projects, and reaching across that
 * boundary is a compile error. The generated module declares the same interfaces for its own
 * consumers, and `registry.test.ts` plus `PiAdapter.plugins.test.ts` assert the payload
 * carries everything those consumers need — so a divergence surfaces as a failing test
 * rather than as a silently thinner payload.
 */
export interface BundledPluginFile {
  readonly path: string;
  readonly content: string;
}

export interface BundledPluginSkill {
  readonly id: string;
  readonly description: string;
  readonly files: readonly BundledPluginFile[];
}

export interface BundledPluginInterface {
  readonly displayName?: string;
  readonly shortDescription?: string;
  readonly longDescription?: string;
  readonly developerName?: string;
  readonly category?: string;
  readonly capabilities?: readonly string[];
  readonly websiteUrl?: string;
  readonly privacyPolicyUrl?: string;
  readonly termsOfServiceUrl?: string;
  readonly brandColor?: string;
  readonly composerIcon?: string;
  readonly defaultPrompt?: readonly string[];
}

export interface BundledPlugin {
  readonly name: string;
  readonly interface: BundledPluginInterface;
  readonly skills: readonly BundledPluginSkill[];
}

const PLUGINS_DIR = resolve(import.meta.dirname, "..", "plugins");
const DEFAULT_OUTPUT = resolve(
  import.meta.dirname,
  "..",
  "packages",
  "agent-toolkit",
  "src",
  "plugins",
  "bundled.generated.ts",
);

interface PluginManifest {
  name: string;
  displayName?: string;
  shortDescription?: string;
  longDescription?: string;
  developerName?: string;
  category?: string;
  capabilities?: string[];
  websiteUrl?: string;
  privacyPolicyUrl?: string;
  termsOfServiceUrl?: string;
  brandColor?: string;
  composerIcon?: string;
  defaultPrompt?: string[];
  /** Skill ids inside this plugin's `skills/` directory. */
  skills: string[];
}

export interface RawPlugin {
  readonly manifest: PluginManifest;
  readonly skills: readonly BundledPluginSkill[];
}

function descriptionOf(skillMd: string): string {
  const match = /^description:\s*(.*)$/m.exec(skillMd);
  return (match?.[1] ?? "").trim().replace(/^["']|["']$/g, "");
}

/** Every file under a directory, as POSIX paths relative to it. */
function filesOf(dir: string): { path: string; content: string }[] {
  const files: { path: string; content: string }[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      if (entry.startsWith(".")) continue;
      const absolute = join(current, entry);
      if (statSync(absolute).isDirectory()) walk(absolute);
      else {
        files.push({
          path: relative(dir, absolute).split(sep).join(posix.sep),
          content: readFileSync(absolute, "utf8"),
        });
      }
    }
  };
  walk(dir);
  return files.toSorted((a, b) => a.path.localeCompare(b.path));
}

/**
 * Read every plugin directory.
 *
 * A malformed plugin is a build failure, not a warning: the payload is generated in CI, and
 * shipping a plugin whose manifest is unreadable would surface as a silently empty plugins
 * view rather than as an error anyone can act on.
 */
export function readPlugins(root = PLUGINS_DIR): RawPlugin[] {
  const names = readdirSync(root)
    .filter((entry) => !entry.startsWith("."))
    .filter((entry) => statSync(join(root, entry)).isDirectory())
    .toSorted((a, b) => a.localeCompare(b));

  return names.map((name) => {
    const manifestPath = join(root, name, "plugin.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as PluginManifest;
    if (manifest.name !== name) {
      throw new Error(`${manifestPath}: "name" must match the directory (${name})`);
    }
    if (!Array.isArray(manifest.skills) || manifest.skills.length === 0) {
      throw new Error(`${manifestPath}: "skills" must list at least one skill id`);
    }

    const skills: BundledPluginSkill[] = manifest.skills.map((id) => {
      const skillDir = join(root, name, "skills", id);
      const files = filesOf(skillDir);
      const skillMd = files.find((file) => file.path === "SKILL.md")?.content;
      if (skillMd === undefined) {
        throw new Error(`${skillDir}: missing SKILL.md`);
      }
      return { id, description: descriptionOf(skillMd), files };
    });

    return { manifest, skills };
  });
}

/** The payload as data: what the generated module must contain for the sources it came from. */
export function buildBundledPlugins(root = PLUGINS_DIR): BundledPlugin[] {
  return readPlugins(root).map(({ manifest, skills }) => ({
    name: manifest.name,
    interface: {
      ...(manifest.displayName === undefined ? {} : { displayName: manifest.displayName }),
      ...(manifest.shortDescription === undefined
        ? {}
        : { shortDescription: manifest.shortDescription }),
      ...(manifest.longDescription === undefined
        ? {}
        : { longDescription: manifest.longDescription }),
      ...(manifest.developerName === undefined ? {} : { developerName: manifest.developerName }),
      ...(manifest.category === undefined ? {} : { category: manifest.category }),
      ...(manifest.capabilities === undefined ? {} : { capabilities: manifest.capabilities }),
      ...(manifest.websiteUrl === undefined ? {} : { websiteUrl: manifest.websiteUrl }),
      ...(manifest.privacyPolicyUrl === undefined
        ? {}
        : { privacyPolicyUrl: manifest.privacyPolicyUrl }),
      ...(manifest.termsOfServiceUrl === undefined
        ? {}
        : { termsOfServiceUrl: manifest.termsOfServiceUrl }),
      ...(manifest.brandColor === undefined ? {} : { brandColor: manifest.brandColor }),
      ...(manifest.composerIcon === undefined ? {} : { composerIcon: manifest.composerIcon }),
      ...(manifest.defaultPrompt === undefined ? {} : { defaultPrompt: manifest.defaultPrompt }),
    },
    skills: [...skills],
  }));
}

const interfaceField = (key: string, value: unknown): string =>
  `      ${key}: ${JSON.stringify(value)},`;

export const renderBundledPlugins = (plugins: readonly BundledPlugin[]): string => {
  const body = plugins
    .map((plugin) => {
      const surface = plugin.interface;
      const interfaceLines = [
        ["displayName", surface.displayName],
        ["shortDescription", surface.shortDescription],
        ["longDescription", surface.longDescription],
        ["developerName", surface.developerName],
        ["category", surface.category],
        ["capabilities", surface.capabilities],
        ["websiteUrl", surface.websiteUrl],
        ["privacyPolicyUrl", surface.privacyPolicyUrl],
        ["termsOfServiceUrl", surface.termsOfServiceUrl],
        ["brandColor", surface.brandColor],
        ["composerIcon", surface.composerIcon],
        ["defaultPrompt", surface.defaultPrompt],
      ]
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => interfaceField(String(key), value))
        .join("\n");

      const skillBody = plugin.skills
        .map(
          (skill) => `      {
        id: ${JSON.stringify(skill.id)},
        description: ${JSON.stringify(skill.description)},
        files: [
${skill.files
  .map(
    (file) =>
      `          { path: ${JSON.stringify(file.path)}, content: ${JSON.stringify(file.content)} },`,
  )
  .join("\n")}
        ],
      },`,
        )
        .join("\n");

      return `  {
    name: ${JSON.stringify(plugin.name)},
    interface: {
${interfaceLines}
    },
    skills: [
${skillBody}
    ],
  },`;
    })
    .join("\n");

  return `// FILE: bundled.generated.ts
// Purpose: In-tree payload of the plugins Peak Code ships as bundled plugins.
// Layer: Agent toolkit plugins
// Generated by: scripts/generate-bundled-plugins.ts from ./plugins
// Exports: BUNDLED_PLUGINS for ./registry.ts. Do not edit by hand.

export interface BundledPluginFile {
  /** POSIX path relative to the skill directory, e.g. \`SKILL.md\`. */
  readonly path: string;
  readonly content: string;
}

export interface BundledPluginSkill {
  readonly id: string;
  readonly description: string;
  readonly files: readonly BundledPluginFile[];
}

export interface BundledPluginInterface {
  readonly displayName?: string;
  readonly shortDescription?: string;
  readonly longDescription?: string;
  readonly developerName?: string;
  readonly category?: string;
  readonly capabilities?: readonly string[];
  readonly websiteUrl?: string;
  readonly privacyPolicyUrl?: string;
  readonly termsOfServiceUrl?: string;
  readonly brandColor?: string;
  readonly composerIcon?: string;
  readonly defaultPrompt?: readonly string[];
}

export interface BundledPlugin {
  readonly name: string;
  readonly interface: BundledPluginInterface;
  readonly skills: readonly BundledPluginSkill[];
}

export const BUNDLED_PLUGINS: readonly BundledPlugin[] = [
${body}
];
`;
};

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  const plugins = buildBundledPlugins();
  const outIndex = process.argv.indexOf("--out");
  const output = outIndex >= 0 ? resolve(process.argv[outIndex + 1] ?? "") : DEFAULT_OUTPUT;
  writeFileSync(output, renderBundledPlugins(plugins));
  console.log(
    `wrote ${output} (${plugins.length} plugin(s), ${plugins.reduce((n, p) => n + p.skills.length, 0)} skill(s))`,
  );
}
