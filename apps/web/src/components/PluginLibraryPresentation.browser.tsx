// FILE: PluginLibraryPresentation.browser.tsx
// Purpose: Pins the plugin glyph resolution the marketplace depends on — the bundled plugins
//          render their own app icons, the art behind those paths is really there, a logo a
//          provider ships still wins over that art, and anything else keeps the accent tile.
// Layer: Browser UI test

import "../index.css";

import type { ProviderPluginDescriptor } from "@peakcode/contracts";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import { PluginGlyph } from "./PluginLibraryPresentation";

function plugin(overrides: Partial<ProviderPluginDescriptor> = {}): ProviderPluginDescriptor {
  return {
    id: "browser-use",
    name: "browser-use",
    source: { type: "local", path: "/plugins/browser-use" },
    installed: true,
    enabled: true,
    installPolicy: "INSTALLED_BY_DEFAULT",
    authPolicy: "ON_INSTALL",
    interface: { displayName: "Browser Use", brandColor: "#2563EB" },
    ...overrides,
  };
}

const computerUse = plugin({
  id: "computer-use",
  name: "computer-use",
  interface: { displayName: "Computer Use", brandColor: "#7C3AED" },
});

const jevUltrafast = plugin({
  id: "jev-ultrafast",
  name: "jev-ultrafast",
  interface: { displayName: "Jev Ultrafast", brandColor: "#F59E0B" },
});

/** The art every bundled plugin points at, in the order the glyphs above are rendered. */
const BUNDLED_ICON_SOURCES = [
  "/plugin-icons/browser-use.png",
  "/plugin-icons/computer-use.png",
  "/plugin-icons/jev-ultrafast.png",
];

/** The icon's natural width, rejecting rather than resolving to 0 when it never loads. */
function loadIconWidth(src: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image.naturalWidth);
    image.onerror = () => reject(new Error(`art missing at ${src}`));
    image.src = src;
  });
}

/** The glyph art for one rendered plugin, as an `<img>` the caller can inspect. */
function appIconSrc(scope: ParentNode): string | null {
  return scope.querySelector('[data-testid="plugin-app-icon"] img')?.getAttribute("src") ?? null;
}

describe("PluginGlyph", () => {
  it("draws a bundled plugin as an app icon instead of the accent tile", async () => {
    const screen = await render(<PluginGlyph plugin={plugin()} />);

    const icon = screen.container.querySelector('[data-testid="plugin-app-icon"]');
    expect(icon).not.toBeNull();
    expect(appIconSrc(screen.container)).toBe("/plugin-icons/browser-use.png");
  });

  it("gives each bundled plugin its own art", async () => {
    const screen = await render(
      <>
        <PluginGlyph plugin={plugin()} />
        <PluginGlyph plugin={computerUse} />
        <PluginGlyph plugin={jevUltrafast} />
      </>,
    );

    const sources = [
      ...screen.container.querySelectorAll('[data-testid="plugin-app-icon"] img'),
    ].map((icon) => icon.getAttribute("src"));
    expect(sources).toEqual([...BUNDLED_ICON_SOURCES]);
    expect(new Set(sources).size, `two plugins share one icon: ${sources.join(", ")}`).toBe(
      sources.length,
    );
  });

  it("ships the art those paths point at", async () => {
    // The check above pins the strings; this is the half that catches a path left behind by a
    // renamed or forgotten file. A missing PNG renders as a broken image rather than falling
    // back to the accent tile, so nothing else would notice.
    for (const src of BUNDLED_ICON_SOURCES) {
      expect(await loadIconWidth(src), src).toBe(128);
    }
  });

  it("still prefers the logo a provider ships over the built-in art", async () => {
    const logo = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E";
    const screen = await render(
      <PluginGlyph plugin={plugin({ interface: { displayName: "Browser Use", logo } })} />,
    );

    expect(screen.container.querySelector("img")?.getAttribute("src")).toBe(logo);
    expect(screen.container.querySelector('[data-testid="plugin-app-icon"]')).toBeNull();
  });

  it("falls back to the accent tile for a plugin with no art of its own", async () => {
    const screen = await render(
      <PluginGlyph
        plugin={plugin({
          id: "acme-thing",
          name: "acme-thing",
          interface: { displayName: "Acme Thing", brandColor: "#FF8800" },
        })}
      />,
    );

    expect(screen.container.querySelector('[data-testid="plugin-app-icon"]')).toBeNull();
    expect(screen.container.querySelector("img")).toBeNull();
    expect(screen.container.querySelector("svg")).not.toBeNull();
  });
});
