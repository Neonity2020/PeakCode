// FILE: ComposerExtrasMenu.browser.tsx
// Purpose: Verifies the composer `+` menu exposes image upload, the multi-select plugin
//          picker and the mode/speed controls.
// Layer: Browser UI test
// Depends on: vitest browser rendering helpers, the i18n provider, and ComposerExtrasMenu.

import "../../index.css";

import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { I18nProvider } from "../../i18n";
import { ComposerExtrasMenu, type ComposerExtrasPluginOption } from "./ComposerExtrasMenu";

const BROWSER_USE_PLUGIN: ComposerExtrasPluginOption = {
  reference: { name: "browser-use", path: "plugin://browser-use@peakcode" },
  key: "plugin://browser-use@peakcode",
  label: "Browser Use",
  description: "Drive a real browser tab.",
};

const COMPUTER_USE_PLUGIN: ComposerExtrasPluginOption = {
  reference: { name: "computer-use", path: "plugin://computer-use@peakcode" },
  key: "plugin://computer-use@peakcode",
  label: "Computer Use",
  description: "Work a macOS app through the shell.",
};

async function mountMenu(props?: {
  fastModeEnabled?: boolean;
  supportsFastMode?: boolean;
  plugins?: ComposerExtrasPluginOption[];
  selectedPluginKeys?: string[];
}) {
  const onAddPhotos = vi.fn();
  const onToggleFastMode = vi.fn();
  const onTogglePlugin = vi.fn();
  const host = document.createElement("div");
  document.body.append(host);
  const screen = await render(
    <I18nProvider language="en">
      <ComposerExtrasMenu
        supportsFastMode={props?.supportsFastMode ?? true}
        fastModeEnabled={props?.fastModeEnabled ?? false}
        plugins={props?.plugins ?? []}
        selectedPluginKeys={new Set(props?.selectedPluginKeys ?? [])}
        onAddPhotos={onAddPhotos}
        onToggleFastMode={onToggleFastMode}
        onTogglePlugin={onTogglePlugin}
      />
    </I18nProvider>,
    { container: host },
  );

  const cleanup = async () => {
    await screen.unmount();
    host.remove();
  };

  return {
    [Symbol.asyncDispose]: cleanup,
    cleanup,
    onAddPhotos,
    onToggleFastMode,
    onTogglePlugin,
  };
}

describe("ComposerExtrasMenu", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("uses an image-only file picker and forwards selected images", async () => {
    await using menu = await mountMenu();

    const input = document.querySelector<HTMLInputElement>("[data-testid='composer-photo-input']");
    expect(input).not.toBeNull();
    expect(input?.accept).toBe("image/*");

    const files = new DataTransfer();
    files.items.add(new File(["photo"], "photo.png", { type: "image/png" }));
    Object.defineProperty(input, "files", {
      configurable: true,
      value: files.files,
    });
    input?.dispatchEvent(new Event("change", { bubbles: true }));

    expect(menu.onAddPhotos).toHaveBeenCalledTimes(1);
    expect(menu.onAddPhotos.mock.calls[0]?.[0]?.[0]?.name).toBe("photo.png");
  });

  it("keeps uploads on the top level and leaves the mode dial out", async () => {
    await using _ = await mountMenu({ fastModeEnabled: true, plugins: [BROWSER_USE_PLUGIN] });

    await page.getByLabelText("Composer extras").click();

    await vi.waitFor(() => {
      const text = document.body.textContent ?? "";
      expect(text).toContain("Add image");
      expect(text).toContain("Plugins");
      expect(text).toContain("Fast");
      // The Agent/Plan/Goal dial lives in the always-visible composer toolbar
      // (ComposerModeChip), not behind this menu.
      expect(text).not.toContain("Agent");
      expect(text).not.toContain("Goal");
    });
  });

  it("attaches several plugins in one visit to the submenu", async () => {
    await using menu = await mountMenu({
      plugins: [BROWSER_USE_PLUGIN, COMPUTER_USE_PLUGIN],
      selectedPluginKeys: [BROWSER_USE_PLUGIN.key],
    });

    await page.getByLabelText("Composer extras").click();
    await page.getByText("Plugins").click();

    await expect
      .element(page.getByRole("menuitemcheckbox", { name: /Browser Use/ }))
      .toHaveAttribute("aria-checked", "true");
    await expect
      .element(page.getByRole("menuitemcheckbox", { name: /Computer Use/ }))
      .toHaveAttribute("aria-checked", "false");

    // Checkbox items do not close the menu, so both toggles happen without reopening it.
    await page.getByRole("menuitemcheckbox", { name: /Computer Use/ }).click();
    await page.getByRole("menuitemcheckbox", { name: /Browser Use/ }).click();

    expect(menu.onTogglePlugin).toHaveBeenCalledTimes(2);
    expect(menu.onTogglePlugin.mock.calls[0]?.[0]?.key).toBe(COMPUTER_USE_PLUGIN.key);
    expect(menu.onTogglePlugin.mock.calls[1]?.[0]?.key).toBe(BROWSER_USE_PLUGIN.key);
  });

  it("wires the speed control", async () => {
    await using menu = await mountMenu();

    await page.getByLabelText("Composer extras").click();
    await page.getByText("Fast").click();
    await page.getByRole("menuitemradio", { name: "Fast" }).click();

    expect(menu.onToggleFastMode).toHaveBeenCalledTimes(1);
  });
});
