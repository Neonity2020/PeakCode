// FILE: SettingsNav.browser.tsx
// Purpose: Locks in that the settings navigation column, which replaces the
//          workspace sidebar in the desktop shell, keeps the back-to-app action
//          clear of the macOS window controls.
// Layer: Component browser tests

import "../index.css";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { I18nProvider } from "../i18n";
import { MESSAGES } from "../i18n/messages";
import { buildSettingsNavGroups, buildSettingsNavItems } from "../settingsNavigation";
import { SettingsNav } from "./SettingsNav";

// The settings surface is rendered in the desktop shell; whether a browser
// build reserves the gutter at all is covered by the pure helper's unit tests.
vi.mock("../env", () => ({ isElectron: true }));

/** The native traffic light cluster spans x=16 → 68 in the desktop window. */
const TRAFFIC_LIGHT_CLEARANCE_PX = 68;

async function mountSettingsNav() {
  const messages = MESSAGES.en;
  const screen = await render(
    <I18nProvider language="en">
      <SettingsNav
        items={buildSettingsNavItems(messages)}
        groups={buildSettingsNavGroups(messages)}
        activeSection="general"
        onSelectSection={() => {}}
        onBack={() => {}}
      />
    </I18nProvider>,
  );
  const backButton = screen.container.querySelector('[data-testid="settings-back-to-app"]');
  expect(backButton).not.toBeNull();
  return backButton!;
}

describe("SettingsNav window controls", () => {
  beforeEach(() => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the back-to-app action clear of the macOS traffic lights", async () => {
    const backButton = await mountSettingsNav();

    expect(backButton.getBoundingClientRect().left).toBeGreaterThanOrEqual(
      TRAFFIC_LIGHT_CLEARANCE_PX,
    );
    // The strip beside the window controls is the drag handle for that corner.
    expect(backButton.closest(".drag-region")).not.toBeNull();
  });

  it("still fits inside the navigation column", async () => {
    const backButton = await mountSettingsNav();
    const column = backButton.closest("nav");

    expect(column).not.toBeNull();
    expect(backButton.getBoundingClientRect().right).toBeLessThanOrEqual(
      column!.getBoundingClientRect().right,
    );
  });
});
