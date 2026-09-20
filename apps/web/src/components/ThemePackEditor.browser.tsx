// FILE: ThemePackEditor.browser.tsx
// Purpose: Locks in when the colour pill writes a colour through. The picker buffers edits
//          and commits them after a short idle so the live CSS-var projection stays smooth,
//          which is only safe if every exit from the component commits — including the one
//          that never blurs and never closes the popover.
// Layer: Component browser tests

import "../index.css";

import { expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { I18nProvider } from "../i18n";
import { ColorPill } from "./ThemePackEditor";

it("commits a colour typed in the moment before the editor is unmounted", async () => {
  const onChange = vi.fn();
  const screen = await render(
    <I18nProvider language="en">
      <ColorPill color="#111111" ariaLabel="Accent" onChange={onChange} />
    </I18nProvider>,
  );

  await page.getByRole("button", { name: "Accent", exact: true }).click();
  // Typing a valid hex buffers it; the commit is a 220 ms timer behind the input.
  await page.getByRole("textbox", { name: "Accent hex value" }).fill("#abcdef");
  expect(onChange).not.toHaveBeenCalled();

  // Unmounting clears that timer, so it has to commit on the way out instead of dropping
  // the colour the user just picked.
  await screen.unmount();
  expect(onChange).toHaveBeenCalledWith("#abcdef");
});

it("leaves the stored colour alone when nothing was picked", async () => {
  const onChange = vi.fn();
  const screen = await render(
    <I18nProvider language="en">
      <ColorPill color="#111111" ariaLabel="Accent" onChange={onChange} />
    </I18nProvider>,
  );

  await page.getByRole("button", { name: "Accent", exact: true }).click();
  await screen.unmount();

  expect(onChange).not.toHaveBeenCalled();
});
