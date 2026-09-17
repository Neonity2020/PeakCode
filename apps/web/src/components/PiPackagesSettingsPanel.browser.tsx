import "../index.css";
import type { PiPackagesSnapshot } from "@peakcode/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { I18nProvider } from "../i18n";
import { PiPackagesSettingsPanel } from "./PiPackagesSettingsPanel";

const api = vi.hoisted(() => ({
  listPiPackages: vi.fn(),
  installPiPackage: vi.fn(),
  removePiPackage: vi.fn(),
}));
vi.mock("../nativeApi", () => ({ ensureNativeApi: () => ({ server: api }) }));

afterEach(() => vi.resetAllMocks());

const emptySnapshot: PiPackagesSnapshot = {
  agentDir: "/custom",
  settingsPath: "/custom/settings.json",
  packages: [],
};

async function mountPanel(snapshot: PiPackagesSnapshot = emptySnapshot) {
  api.listPiPackages.mockResolvedValue(snapshot);
  api.installPiPackage.mockResolvedValue(snapshot);
  api.removePiPackage.mockResolvedValue(emptySnapshot);
  await page.viewport(1164, 900);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await render(
    <QueryClientProvider client={client}>
      <I18nProvider language="en">
        <PiPackagesSettingsPanel agentDir="/custom" />
      </I18nProvider>
    </QueryClientProvider>,
  );
}

it("installs a typed source into the configured agent directory", async () => {
  await mountPanel();
  await expect.element(page.getByText("No packages installed")).toBeVisible();

  const field = page.getByRole("textbox", { name: "Package source" });
  await field.fill("npm:@melihmucuk/pi-crew");
  await page.getByRole("button", { name: "Install", exact: true }).click();

  // The request must carry the same agent dir the panel was opened with, or the package
  // would land in a different pi profile than the one sessions read.
  await vi.waitFor(() =>
    expect(api.installPiPackage).toHaveBeenCalledWith({
      agentDir: "/custom",
      source: "npm:@melihmucuk/pi-crew",
    }),
  );
});

it("fills the field from a suggested source", async () => {
  await mountPanel();
  await page.getByRole("button", { name: "git:github.com/melihmucuk/pi-crew" }).click();
  await expect
    .element(page.getByRole("textbox", { name: "Package source" }))
    .toHaveValue("git:github.com/melihmucuk/pi-crew");
});

it("lists a package with its resources and removes it after confirmation", async () => {
  await mountPanel({
    agentDir: "/custom",
    settingsPath: "/custom/settings.json",
    packages: [
      {
        source: "npm:@melihmucuk/pi-crew",
        kind: "npm",
        scope: "user",
        filtered: false,
        installedPath: "/custom/npm/node_modules/@melihmucuk/pi-crew",
        resources: { extensions: 1, skills: 1, prompts: 2, themes: 0 },
      },
    ],
  });
  await expect.element(page.getByText("npm:@melihmucuk/pi-crew")).toBeVisible();
  await expect.element(page.getByText("2 prompts")).toBeVisible();
  await expect.element(page.getByText("1 extensions")).toBeVisible();

  vi.spyOn(window, "confirm").mockReturnValue(true);
  await page.getByRole("button", { name: "Uninstall npm:@melihmucuk/pi-crew" }).click();
  await vi.waitFor(() =>
    expect(api.removePiPackage).toHaveBeenCalledWith({
      agentDir: "/custom",
      source: "npm:@melihmucuk/pi-crew",
    }),
  );
  vi.mocked(window.confirm).mockRestore();
});
