// FILE: ChatView.composer.logic.test.ts
// Purpose: Pin the composer's plugin mention merge — the point where `@name` tokens and
//          `+` menu chips become one list of plugins for the turn.
// Layer: Unit test

import { describe, expect, it } from "vitest";

import {
  mergePluginMentions,
  resolvePromptPluginMentions,
  type ComposerPluginSuggestion,
} from "./ChatView.composer.logic";

const browserUse = { name: "browser-use", path: "plugin://browser-use@peakcode" };
const computerUse = { name: "computer-use", path: "plugin://computer-use@peakcode" };
const browserUseSuggestions: ComposerPluginSuggestion[] = [
  {
    plugin: {
      id: "browser-use",
      name: "browser-use",
      source: { type: "local", path: "/plugins/browser-use" },
      installed: true,
      enabled: true,
      installPolicy: "INSTALLED_BY_DEFAULT",
      authPolicy: "ON_INSTALL",
    },
    mention: browserUse,
  },
];

describe("mergePluginMentions", () => {
  it("keeps chips that the prompt never names", () => {
    expect(mergePluginMentions([], [browserUse, computerUse])).toEqual([browserUse, computerUse]);
  });

  it("sends one plugin once when the prompt names it and a chip carries it", () => {
    expect(mergePluginMentions([browserUse], [browserUse])).toEqual([browserUse]);
  });

  it("keeps the mention list order: prompt mentions first, chips after", () => {
    expect(mergePluginMentions([computerUse], [browserUse])).toEqual([computerUse, browserUse]);
  });

  it("drops entries without a path rather than sending an unusable reference", () => {
    expect(mergePluginMentions([{ name: "broken", path: "  " }], [])).toEqual([]);
  });
});

describe("resolvePromptPluginMentions", () => {
  it("resolves a plugin named in the prompt to its discovered mention", () => {
    expect(
      resolvePromptPluginMentions({
        prompt: "use @browser-use for this",
        existingMentions: [],
        providerPlugins: browserUseSuggestions,
      }),
    ).toEqual([browserUse]);
  });

  it("returns nothing when the prompt names no plugin", () => {
    expect(
      resolvePromptPluginMentions({
        prompt: "no mention here",
        existingMentions: [browserUse],
        providerPlugins: browserUseSuggestions,
      }),
    ).toEqual([]);
  });
});
