// FILE: PiAdapter.plugins.test.ts
// Purpose: Pins the mapping from a bundled plugin to the descriptor plugin discovery serves.
// Layer: Provider adapter tests
// Depends on: PiAdapter's bundling helpers and the agent-toolkit plugin registry.

import { describe, expect, it } from "vitest";

import {
  BUNDLED_PLUGIN_MARKETPLACE_PATH,
  bundledPluginId,
  listBundledPlugins,
  readBundledPlugin,
} from "@peakcode/agent-toolkit/plugins/registry";
import type { BundledPlugin } from "@peakcode/agent-toolkit/plugins/bundled.generated";

import { describeBundledPlugin } from "./PiAdapter";

describe("describeBundledPlugin", () => {
  const browserUse = readBundledPlugin("browser-use") as BundledPlugin;

  it("reports the plugin as already installed, so the UI offers no install step", () => {
    const descriptor = describeBundledPlugin(browserUse);

    expect(descriptor.installed).toBe(true);
    expect(descriptor.enabled).toBe(true);
    expect(descriptor.installPolicy).toBe("INSTALLED_BY_DEFAULT");
    expect(descriptor.authPolicy).toBe("ON_USE");
  });

  it("addresses the plugin the way readPlugin does", () => {
    const descriptor = describeBundledPlugin(browserUse);

    // `readPlugin` takes a (marketplacePath, pluginName) pair, so the descriptor has to
    // publish the same path or the detail view cannot open what the list just showed.
    expect(descriptor.source).toEqual({
      type: "local",
      path: `${BUNDLED_PLUGIN_MARKETPLACE_PATH}/${browserUse.name}`,
    });
    expect(descriptor.name).toBe(browserUse.name);
  });

  it("carries an id that is stable, unique and marketplace-qualified", () => {
    const descriptor = describeBundledPlugin(browserUse);

    // The id is the composer menu's item key and the plugin browser's key, so it has to be
    // unique per plugin and stable across runs.
    expect(descriptor.id).toBe(bundledPluginId("browser-use"));
    expect(descriptor.id).toBe("peak-code/browser-use");
    expect(descriptor.id).toContain(browserUse.name);

    const ids = listBundledPlugins().map((plugin) => describeBundledPlugin(plugin).id);
    expect(new Set(ids).size, `duplicate plugin ids: ${ids.join(", ")}`).toBe(ids.length);
  });

  it("passes through everything the plugin browser renders", () => {
    const descriptor = describeBundledPlugin(browserUse);

    expect(descriptor.interface?.displayName).toBe("Browser Use");
    // A machine key, not display text: the view translates it (and falls back to the raw
    // value for a key it does not know), so the manifest must not carry a language.
    expect(descriptor.interface?.category).toBe("developer-tools");
    expect(descriptor.interface?.shortDescription).toBeTruthy();
    expect(descriptor.interface?.longDescription).toBeTruthy();
    expect(descriptor.interface?.capabilities).toContain("browser");
    expect(descriptor.interface?.defaultPrompt?.length).toBeGreaterThan(0);
    // The tile accent: without it every plugin falls back to a hash of its name.
    expect(descriptor.interface?.brandColor).toBeTruthy();
  });

  it("omits interface fields the manifest did not set instead of sending undefined", () => {
    // The contract marks each of these optional; sending explicit `undefined` would fail
    // schema decoding on the wire rather than simply being absent.
    const minimal: BundledPlugin = {
      name: "minimal",
      interface: { displayName: "Minimal" },
      skills: [],
    };

    const descriptor = describeBundledPlugin(minimal);

    expect(descriptor.interface).toEqual({ displayName: "Minimal" });
    expect("category" in (descriptor.interface ?? {})).toBe(false);
  });

  it("describes every bundled plugin", () => {
    for (const plugin of listBundledPlugins()) {
      const descriptor = describeBundledPlugin(plugin);
      expect(descriptor.name, plugin.name).toBeTruthy();
      expect(descriptor.id, plugin.name).toBeTruthy();
      expect(descriptor.interface?.shortDescription, plugin.name).toBeTruthy();
    }
  });
});
