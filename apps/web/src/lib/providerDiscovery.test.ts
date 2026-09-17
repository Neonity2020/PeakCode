/**
 * The two filters the composer's `@` menu and the /plugins view apply to a plugin before it
 * is offered to the user.
 *
 * These are cheap predicates, but they are the boundary between "the server reports a
 * plugin" and "the user can reference it in the composer": a descriptor that fails either
 * one is fetched, listed nowhere, and looks like a plugin that does not exist. The shapes
 * below mirror what `describeBundledPlugin` in the Pi adapter produces for a bundled
 * plugin.
 */
import { describe, expect, it } from "vitest";

import type { ProviderPluginDescriptor } from "@peakcode/contracts";

import {
  buildPluginSearchBlob,
  isInstalledProviderPlugin,
  normalizeProviderDiscoveryText,
} from "./providerDiscovery";

/** Exactly the fields `describeBundledPlugin` sets for a bundled plugin. */
const bundledPlugin = (
  overrides: Partial<ProviderPluginDescriptor> = {},
): ProviderPluginDescriptor => ({
  id: "peak-code/browser-use",
  name: "browser-use",
  source: { type: "local", path: "bundled/browser-use" },
  installed: true,
  enabled: true,
  installPolicy: "INSTALLED_BY_DEFAULT",
  authPolicy: "ON_USE",
  interface: {
    displayName: "Browser Use",
    shortDescription:
      "Give the agent the app's own browser: open pages, read them, and act on them.",
    longDescription: "The agent drives the same browser pane you are looking at.",
    developerName: "Peak Code",
    category: "Automation",
    capabilities: ["browser", "screenshots"],
    defaultPrompt: ["Check the login form on localhost:5173 actually submits."],
  },
  ...overrides,
});

describe("isInstalledProviderPlugin", () => {
  it("accepts a bundled plugin, so it reaches the composer menu", () => {
    expect(isInstalledProviderPlugin(bundledPlugin())).toBe(true);
  });

  it("accepts it on any one of the three signals the server sets", () => {
    // The server sets all three; the predicate is an OR, so each one alone is enough. This
    // pins that a future change dropping one of them does not silently hide the plugin.
    for (const signal of [
      { installed: true, enabled: false, installPolicy: "NOT_AVAILABLE" as const },
      { installed: false, enabled: true, installPolicy: "NOT_AVAILABLE" as const },
      { installed: false, enabled: false, installPolicy: "INSTALLED_BY_DEFAULT" as const },
    ]) {
      expect(isInstalledProviderPlugin(bundledPlugin(signal)), JSON.stringify(signal)).toBe(true);
    }
  });
});

describe("buildPluginSearchBlob", () => {
  it("makes a plugin findable by its name, title, category and developer", () => {
    const blob = buildPluginSearchBlob(bundledPlugin());

    // The menu normalizes the typed query with the same function before comparing, so this
    // is the round trip a user actually goes through when they type `@browser-use`.
    for (const term of ["browser-use", "Browser Use", "Automation", "Peak Code"]) {
      expect(blob, `searching for "${term}"`).toContain(normalizeProviderDiscoveryText(term));
    }
  });

  it("matches what the composer menu does with a typed mention query", () => {
    const blob = buildPluginSearchBlob(bundledPlugin());

    // This is the comparison from useComposerCommandMenuItems, run for real.
    expect(blob.includes(normalizeProviderDiscoveryText("browser-use"))).toBe(true);
    expect(blob.includes(normalizeProviderDiscoveryText("browser"))).toBe(true);
    expect(blob.includes(normalizeProviderDiscoveryText("definitely-not-a-plugin"))).toBe(false);
  });

  it("is lowercase, so a typed query matches regardless of case", () => {
    expect(buildPluginSearchBlob(bundledPlugin())).toBe(
      buildPluginSearchBlob(bundledPlugin()).toLowerCase(),
    );
  });

  it("keeps a plugin with no interface searchable by name alone", () => {
    const bare = bundledPlugin();
    delete (bare as { interface?: unknown }).interface;

    expect(buildPluginSearchBlob(bare)).toContain(normalizeProviderDiscoveryText("browser-use"));
  });
});
