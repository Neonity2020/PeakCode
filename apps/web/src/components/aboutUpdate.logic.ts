// FILE: aboutUpdate.logic.ts
// Purpose: Pure presentation rules for the About panel's update card — which
// label the primary button shows, which one-line hint sits under the version,
// and which release notes belong to a pending update. Kept free of React,
// storage, and the update state machine so it can be unit-tested directly.
// Layer: shared UI logic

import type { DesktopUpdateState, DesktopUpdateStatus } from "@peakcode/contracts";

import { compareVersions, type WhatsNewEntry } from "../whatsNew/logic";

/** The subset of `messages.settings.about.update` the action label needs. */
export interface AboutUpdateActionLabels {
  readonly checkButton: string;
  readonly checkingButton: string;
  readonly downloadButton: string;
  readonly downloadingButton: string;
  readonly installButton: string;
  readonly installingButton: string;
  readonly retryButton: string;
}

/** The subset of `messages.settings.about.update` the hint line needs. */
export interface AboutUpdateHintLabels {
  readonly upToDateHint: (version: string) => string;
  readonly availableHint: string;
  readonly downloadingHint: (percent: string) => string;
  readonly downloadedHint: string;
  readonly errorHint: string;
}

/**
 * The version a pending update would install: a downloaded build outranks a
 * merely-available one, since that's the one the user is about to restart into.
 */
export function resolvePendingUpdateVersion(state: DesktopUpdateState | null): string | null {
  if (!state) return null;
  if (state.status === "downloaded") {
    return state.downloadedVersion ?? state.availableVersion ?? null;
  }
  return state.availableVersion ?? null;
}

/** Whether the About panel should surface the pending release's notes at all. */
export function shouldShowPendingReleaseNotes(
  status: DesktopUpdateStatus,
  pendingVersion: string | null,
): boolean {
  if (pendingVersion === null) return false;
  return (
    status === "available" ||
    status === "downloading" ||
    status === "downloaded" ||
    status === "error"
  );
}

/** Find the curated changelog entry for an exact version, if one exists. */
export function findReleaseEntry(
  entries: readonly WhatsNewEntry[],
  version: string | null,
): WhatsNewEntry | null {
  if (version === null) return null;
  return entries.find((entry) => compareVersions(entry.version, version) === 0) ?? null;
}

/** Localize the primary update button for the current status / action. */
export function resolveAboutUpdateActionLabel(input: {
  readonly installing: boolean;
  readonly status: DesktopUpdateStatus;
  readonly action: string;
  readonly labels: AboutUpdateActionLabels;
}): string {
  const { installing, status, action, labels } = input;
  if (installing) return labels.installingButton;
  if (status === "checking") return labels.checkingButton;
  if (status === "downloading") return labels.downloadingButton;
  if (status === "downloaded") return labels.installButton;
  if (status === "error") return labels.retryButton;
  if (action === "download") return labels.downloadButton;
  if (action === "install") return labels.installButton;
  return labels.checkButton;
}

/**
 * The one-line hint under the version badge. Returns `null` for states that
 * have nothing worth saying (idle / mid-check).
 */
export function resolveAboutUpdateHint(input: {
  readonly status: DesktopUpdateStatus;
  readonly currentVersion: string;
  readonly percent: number | null;
  readonly labels: AboutUpdateHintLabels;
}): string | null {
  const { status, currentVersion, percent, labels } = input;
  if (status === "up-to-date") return labels.upToDateHint(currentVersion);
  if (status === "available") return labels.availableHint;
  if (status === "downloading") {
    const rounded =
      typeof percent === "number" && Number.isFinite(percent)
        ? Math.max(0, Math.min(100, Math.floor(percent)))
        : 0;
    return labels.downloadingHint(`${rounded}%`);
  }
  if (status === "downloaded") return labels.downloadedHint;
  if (status === "error") return labels.errorHint;
  return null;
}
