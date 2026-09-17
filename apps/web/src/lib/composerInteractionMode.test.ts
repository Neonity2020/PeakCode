// FILE: composerInteractionMode.test.ts
// Purpose: Verifies composer interaction modes fall back to Agent on unknown or missing input.
// Layer: Unit test

import { describe, expect, it } from "vitest";

import {
  DEFAULT_COMPOSER_INTERACTION_MODE,
  composerInteractionModeLabel,
  normalizeComposerInteractionMode,
} from "./composerInteractionMode";

describe("normalizeComposerInteractionMode", () => {
  it("passes through every known mode", () => {
    expect(normalizeComposerInteractionMode("default")).toBe("default");
    expect(normalizeComposerInteractionMode("plan")).toBe("plan");
    expect(normalizeComposerInteractionMode("goal")).toBe("goal");
  });

  it("falls back to Agent for missing values", () => {
    expect(normalizeComposerInteractionMode(undefined)).toBe(DEFAULT_COMPOSER_INTERACTION_MODE);
    expect(normalizeComposerInteractionMode(null)).toBe(DEFAULT_COMPOSER_INTERACTION_MODE);
    expect(normalizeComposerInteractionMode("")).toBe(DEFAULT_COMPOSER_INTERACTION_MODE);
  });

  it("falls back to Agent for unknown values", () => {
    expect(normalizeComposerInteractionMode("turbo")).toBe(DEFAULT_COMPOSER_INTERACTION_MODE);
    expect(normalizeComposerInteractionMode(42)).toBe(DEFAULT_COMPOSER_INTERACTION_MODE);
    expect(normalizeComposerInteractionMode({ mode: "plan" })).toBe(
      DEFAULT_COMPOSER_INTERACTION_MODE,
    );
  });
});

describe("composerInteractionModeLabel", () => {
  it("maps each mode to its composer menu name", () => {
    expect(composerInteractionModeLabel("default")).toBe("Agent");
    expect(composerInteractionModeLabel("plan")).toBe("Plan");
    expect(composerInteractionModeLabel("goal")).toBe("Goal");
  });
});
