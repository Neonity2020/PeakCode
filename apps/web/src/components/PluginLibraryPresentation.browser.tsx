// FILE: PluginLibraryPresentation.browser.tsx
// Purpose: Pins the plugin glyph resolution the marketplace depends on — the bundled plugins
//          render their own app icons, a logo a provider ships still wins over that art, and
//          anything else keeps the accent tile.
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
      </>,
    );

    const icons = [...screen.container.querySelectorAll('[data-testid="plugin-app-icon"] img')];
    expect(icons).toHaveLength(2);
    expect(icons[0]?.getAttribute("src")).not.toBe(icons[1]?.getAttribute("src"));
    expect(icons[1]?.getAttribute("src")).toBe("/plugin-icons/computer-use.png");
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
