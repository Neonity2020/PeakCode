// FILE: composerInteractionMode.ts
// Purpose: Normalize the composer's Plan/Goal/Agent interaction mode from untrusted input.
// Layer: Shared web helper
// Depends on: contracts interaction-mode schema

import {
  ProviderInteractionMode as ProviderInteractionModeSchema,
  type ProviderInteractionMode,
} from "@peakcode/contracts";
import * as Schema from "effect/Schema";

/** The mode the composer falls back to whenever a value is missing or unrecognized. */
export const DEFAULT_COMPOSER_INTERACTION_MODE: ProviderInteractionMode = "default";

/**
 * Coerce any value into a valid interaction mode.
 *
 * Server snapshots, persisted drafts, and queued turns can all carry a mode this build does
 * not know about (older/newer clients, hand-edited storage). Anything that is not
 * `default` / `plan` / `goal` resolves to `default` (Agent) instead of leaving the radio
 * group with no selection.
 */
export function normalizeComposerInteractionMode(value: unknown): ProviderInteractionMode {
  return Schema.is(ProviderInteractionModeSchema)(value)
    ? value
    : DEFAULT_COMPOSER_INTERACTION_MODE;
}

const INTERACTION_MODE_LABELS: Record<ProviderInteractionMode, string> = {
  default: "Agent",
  plan: "Plan",
  goal: "Goal",
};

/** The user-facing name for a mode, matching the composer menu. */
export function composerInteractionModeLabel(mode: ProviderInteractionMode): string {
  return INTERACTION_MODE_LABELS[mode];
}
