// Guards the oh-my-pi theme port: every generated option must have a seed for each variant
// it advertises, ids must stay namespaced, and the mapped ink must actually be readable on
// the mapped surface (oh-my-pi's `text` token is usually the terminal default, so the
// generator falls back to other foreground tokens).
import { describe, expect, it } from "vitest";

import { OH_MY_PI_CODE_THEME_OPTIONS, OH_MY_PI_THEME_SEEDS } from "./oh-my-pi.seed.generated";
import {
  CODE_THEME_OPTIONS,
  getCodeThemeSeed,
  normalizeChromeTheme,
  normalizeCodeThemeId,
} from "./theme.logic";

function srgbChannel(value: number): number {
  const scaled = value / 255;
  return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const red = Number.parseInt(hex.slice(1, 3), 16);
  const green = Number.parseInt(hex.slice(3, 5), 16);
  const blue = Number.parseInt(hex.slice(5, 7), 16);
  return 0.2126 * srgbChannel(red) + 0.7152 * srgbChannel(green) + 0.0722 * srgbChannel(blue);
}

function contrastRatio(a: string, b: string): number {
  const lighter = Math.max(relativeLuminance(a), relativeLuminance(b));
  const darker = Math.min(relativeLuminance(a), relativeLuminance(b));
  return (lighter + 0.05) / (darker + 0.05);
}

describe("oh-my-pi theme seeds", () => {
  it("ports the whole upstream collection under a namespace", () => {
    expect(OH_MY_PI_CODE_THEME_OPTIONS).toHaveLength(100);
    for (const option of OH_MY_PI_CODE_THEME_OPTIONS) {
      expect(option.id.startsWith("omp-"), option.id).toBe(true);
    }
  });

  it("does not shadow the peak code catalog ids", () => {
    const baseIds = new Set(
      CODE_THEME_OPTIONS.filter((option) => !option.id.startsWith("omp-")).map((o) => o.id),
    );
    for (const option of OH_MY_PI_CODE_THEME_OPTIONS) {
      expect(baseIds.has(option.id), option.id).toBe(false);
    }
    // The merged catalog is what the picker sees, so ids have to be unique there too.
    const ids = CODE_THEME_OPTIONS.map((option) => option.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has a seed for every advertised variant", () => {
    for (const option of OH_MY_PI_CODE_THEME_OPTIONS) {
      for (const variant of option.variants) {
        expect(OH_MY_PI_THEME_SEEDS[option.id]?.[variant], `${option.id}/${variant}`).toBeDefined();
      }
    }
  });

  it("keeps every mapped ink readable on its surface", () => {
    for (const option of OH_MY_PI_CODE_THEME_OPTIONS) {
      for (const variant of option.variants) {
        const theme = getCodeThemeSeed(option.id, variant);
        const ratio = contrastRatio(theme.surface, theme.ink);
        expect(
          ratio,
          `${option.id}/${variant} contrast ${ratio.toFixed(2)}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("resolves through the normal catalog path", () => {
    const option = OH_MY_PI_CODE_THEME_OPTIONS[0]!;
    const variant = option.variants[0]!;
    expect(normalizeCodeThemeId(option.id, variant)).toBe(option.id);
    expect(getCodeThemeSeed(option.id, variant).accent).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("serves the ported seed itself, never the default", () => {
    // Every other check here passes on a payload that the catalog layer never reaches: a
    // merge regression would serve DEFAULT_CHROME_THEME_BY_VARIANT for all 100 ids and the
    // contrast guard would still be satisfied. Pin the resolution path end to end.
    for (const option of OH_MY_PI_CODE_THEME_OPTIONS) {
      for (const variant of option.variants) {
        const payload = OH_MY_PI_THEME_SEEDS[option.id]?.[variant];
        expect(payload, `${option.id}/${variant} payload`).toBeDefined();
        expect(getCodeThemeSeed(option.id, variant), `${option.id}/${variant}`).toEqual(
          normalizeChromeTheme(payload, variant),
        );
      }
    }
  });
});
