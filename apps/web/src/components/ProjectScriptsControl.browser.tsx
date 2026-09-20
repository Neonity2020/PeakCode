// FILE: ProjectScriptsControl.browser.tsx
// Purpose: Locks in that closing the action dialog by accident does not throw away a
//          half-written action. Escape, the close button and a click on the backdrop all
//          dismiss it, and the dialog holds a name, a command line and a keybinding.
// Layer: Component browser tests

import "../index.css";

import { expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { I18nProvider } from "../i18n";
import ProjectScriptsControl from "./ProjectScriptsControl";

/** The parent opens the shared dialog by bumping this nonce. */
async function mountWithDialog() {
  const element = (nonce: number) => (
    <I18nProvider language="en">
      <ProjectScriptsControl
        scripts={[]}
        keybindings={[]}
        openAddActionNonce={nonce}
        onRunScript={() => {}}
        onAddScript={() => {}}
        onUpdateScript={() => {}}
        onDeleteScript={() => {}}
      />
    </I18nProvider>
  );
  const screen = await render(element(1));
  await screen.rerender(element(2));

  const name = page.getByRole("textbox", { name: "Name", exact: true });
  await expect.element(name).toBeVisible();
  return name;
}

it("asks before Escape throws a half-written action away", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  const name = await mountWithDialog();
  await name.fill("Deploy");

  await userEvent.keyboard("{Escape}");
  // Declining keeps the dialog open with the name in it.
  await expect.element(name).toHaveValue("Deploy");

  confirm.mockReturnValue(true);
  await userEvent.keyboard("{Escape}");
  await expect.element(name).not.toBeInTheDocument();
  confirm.mockRestore();
});

it("closes an untouched dialog without asking", async () => {
  const confirm = vi.spyOn(window, "confirm");
  const name = await mountWithDialog();

  await userEvent.keyboard("{Escape}");

  await expect.element(name).not.toBeInTheDocument();
  expect(confirm).not.toHaveBeenCalled();
  confirm.mockRestore();
});
