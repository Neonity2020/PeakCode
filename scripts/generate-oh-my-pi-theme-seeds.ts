#!/usr/bin/env node
/**
 * Generate the oh-my-pi theme seeds consumed by the web appearance catalog.
 *
 * oh-my-pi's themes are pi TUI themes: colors may be hex literals, `vars` references, or
 * 256-color palette indices, and the "background" lives in the optional `export` block
 * rather than in `colors`. Peak Code's web themes are a different shape (ChromeTheme:
 * accent / surface / ink / diff colors / skill color), so this script resolves and maps
 * the parts that carry over and drops the TUI-only tokens.
 *
 * Usage:
 *   bun scripts/generate-oh-my-pi-theme-seeds.ts --source /path/to/oh-my-pi
 *
 * The result is committed; `bun fmt` then normalizes it like any other source file.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  UPSTREAM_SOURCE,
  gitHead,
  resolveOhMyPiSource,
  upstreamAttribution,
} from "./lib/oh-my-pi-source.ts";

const OUTPUT = resolve(
  import.meta.dirname,
  "..",
  "apps",
  "web",
  "src",
  "theme",
  "oh-my-pi.seed.generated.ts",
);

interface OhMyPiTheme {
  readonly name: string;
  readonly vars?: Record<string, string | number>;
  readonly colors: Record<string, string | number>;
  readonly export?: Record<string, string | number>;
}

type Rgb = { red: number; green: number; blue: number };

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** Resolve a color token the way oh-my-pi's loader does: hex, `vars` ref, or palette index. */
function resolveColor(
  value: string | number | undefined,
  vars: Record<string, string | number>,
  seen = new Set<string>(),
): string | null {
  if (value === undefined || value === "") return null;
  if (typeof value === "number") return null; // 256-color index: no hex equivalent to map
  if (HEX_RE.test(value)) return value.toLowerCase();
  const referenced = vars[value];
  if (referenced === undefined || seen.has(value)) return null;
  seen.add(value);
  return resolveColor(referenced, vars, seen);
}

function toRgb(hex: string): Rgb {
  return {
    red: Number.parseInt(hex.slice(1, 3), 16),
    green: Number.parseInt(hex.slice(3, 5), 16),
    blue: Number.parseInt(hex.slice(5, 7), 16),
  };
}

function srgbChannel(value: number): number {
  const scaled = value / 255;
  return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const { red, green, blue } = toRgb(hex);
  return 0.2126 * srgbChannel(red) + 0.7152 * srgbChannel(green) + 0.0722 * srgbChannel(blue);
}

function contrastRatio(a: string, b: string): number {
  const lighter = Math.max(relativeLuminance(a), relativeLuminance(b));
  const darker = Math.min(relativeLuminance(a), relativeLuminance(b));
  return (lighter + 0.05) / (darker + 0.05);
}

function pickFirst(candidates: readonly (string | null)[]): string | null {
  return candidates.find((candidate): candidate is string => candidate !== null) ?? null;
}

function titleCase(value: string): string {
  return value
    .split("-")
    .map((part) => (part.length > 0 ? part[0]!.toUpperCase() + part.slice(1) : part))
    .join(" ");
}

/** Map one oh-my-pi theme to Peak Code's ChromeTheme fields for its variant. */
function convert(theme: OhMyPiTheme): {
  variant: "light" | "dark";
  chrome: Record<string, unknown>;
} {
  const vars = theme.vars ?? {};
  const colors = theme.colors;
  const exported = theme.export ?? {};
  const color = (key: string): string | null => resolveColor(colors[key], vars);

  const surface =
    pickFirst([resolveColor(exported.pageBg, vars), color("toolPendingBg"), color("selectedBg")]) ??
    "#181818";

  const variant: "light" | "dark" = relativeLuminance(surface) > 0.4 ? "light" : "dark";
  const fallbackInk = variant === "light" ? "#1a1c1f" : "#ffffff";

  // `text` is usually "" in oh-my-pi themes (terminal default). Fall back to tokens that
  // hold a readable foreground, and only accept them when they actually contrast with the
  // surface — a dim comment color would otherwise become unreadable body text.
  const inkCandidates = [
    color("text"),
    color("syntaxVariable"),
    color("userMessageText"),
    color("toolOutput"),
  ].filter((candidate): candidate is string => candidate !== null);
  const ink =
    inkCandidates.find((candidate) => contrastRatio(candidate, surface) >= 4.5) ?? fallbackInk;

  const accent =
    pickFirst([color("accent"), color("mdCode"), color("customMessageLabel")]) ?? fallbackInk;
  const diffAdded = pickFirst([color("toolDiffAdded"), color("success")]) ?? "#40c977";
  const diffRemoved = pickFirst([color("toolDiffRemoved"), color("error")]) ?? "#fa423e";
  const skill = pickFirst([color("mdCode"), color("customMessageLabel")]) ?? accent;

  return {
    variant,
    chrome: {
      accent,
      contrast: variant === "dark" ? 60 : 45,
      fonts: { code: null, ui: null },
      ink,
      opaqueWindows: false,
      semanticColors: { diffAdded, diffRemoved, skill },
      surface,
    },
  };
}

function loadThemes(source: string): { file: string; theme: OhMyPiTheme }[] {
  const themeDir = join(source, "packages", "coding-agent", "src", "modes", "theme");
  const defaultsDir = join(themeDir, "defaults");
  const files: string[] = [
    join(themeDir, "dark.json"),
    join(themeDir, "light.json"),
    ...readdirSync(defaultsDir)
      .filter((name) => name.endsWith(".json"))
      .toSorted()
      .map((name) => join(defaultsDir, name)),
  ];
  return files.map((file) => ({
    file: file.slice(themeDir.length + 1),
    theme: JSON.parse(readFileSync(file, "utf8")) as OhMyPiTheme,
  }));
}

function render(upstreamCommit: string, themes: { file: string; theme: OhMyPiTheme }[]): string {
  const entries: { id: string; label: string; variant: string; chrome: Record<string, unknown> }[] =
    [];
  for (const { file, theme } of themes) {
    const basename = file
      .replace(/^defaults\//, "")
      .replace(/\.json$/, "")
      .replaceAll("/", "-");
    const { variant, chrome } = convert(theme);
    entries.push({ id: `omp-${basename}`, label: `OMP ${titleCase(basename)}`, variant, chrome });
  }
  entries.sort((a, b) => a.id.localeCompare(b.id));

  const options = entries.map(
    ({ id, label, variant }) =>
      `  { id: ${JSON.stringify(id)}, label: ${JSON.stringify(label)}, variants: [${JSON.stringify(variant)}] },`,
  );
  const seeds: string[] = [];
  for (const { id, variant, chrome } of entries) {
    seeds.push(
      `  ${JSON.stringify(id)}: {\n    ${variant}: ${indent(JSON.stringify(chrome, null, 2), 4)},\n  },`,
    );
  }

  return `// FILE: oh-my-pi.seed.generated.ts
// Purpose: Peak Code ChromeTheme seeds derived from the ${UPSTREAM_SOURCE} theme collection.
// Layer: Web appearance generated catalog
// Generated by: scripts/generate-oh-my-pi-theme-seeds.ts --source <oh-my-pi checkout>
// Upstream: ${upstreamAttribution(upstreamCommit)}
// Exports: OH_MY_PI_CODE_THEME_OPTIONS and OH_MY_PI_THEME_SEEDS, merged into the catalog
// by ./theme.logic.ts.

import type { ChromeTheme, ThemeVariant } from "./theme.logic";

export const OH_MY_PI_CODE_THEME_OPTIONS = [
${options.join("\n")}
] as const satisfies readonly { id: string; label: string; variants: readonly ThemeVariant[] }[];

export const OH_MY_PI_THEME_SEEDS: Record<string, Partial<Record<ThemeVariant, ChromeTheme>>> = {
${seeds.join("\n")}
};
`;
}

function indent(text: string, spaces: number): string {
  const prefix = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line, index) => (index === 0 ? line : `${prefix}${line}`))
    .join("\n");
}

function main(): void {
  const source = resolveOhMyPiSource(process.argv.slice(2));
  const themes = loadThemes(source);
  writeFileSync(OUTPUT, render(gitHead(source), themes));
  console.log(`wrote ${OUTPUT} (${themes.length} themes)`);
}

main();
