import type { DesktopUpdateState, DesktopUpdateStatus } from "@peakcode/contracts";
import { describe, expect, it } from "vitest";

import {
  findReleaseEntry,
  resolveAboutUpdateActionLabel,
  resolveAboutUpdateHint,
  resolvePendingUpdateVersion,
  shouldShowPendingReleaseNotes,
} from "./aboutUpdate.logic";
import type { WhatsNewEntry } from "../whatsNew/logic";

const actionLabels = {
  checkButton: "check",
  checkingButton: "checking",
  downloadButton: "download",
  downloadingButton: "downloading",
  installButton: "install",
  installingButton: "installing",
  retryButton: "retry",
};

const hintLabels = {
  upToDateHint: (version: string) => `up-to-date:${version}`,
  availableHint: "available",
  downloadingHint: (percent: string) => `downloading:${percent}`,
  downloadedHint: "downloaded",
  errorHint: "error",
};

function buildState(overrides: Partial<DesktopUpdateState> = {}): DesktopUpdateState {
  return {
    enabled: true,
    status: "idle",
    currentVersion: "0.7.1",
    hostArch: "arm64",
    appArch: "arm64",
    runningUnderArm64Translation: false,
    availableVersion: null,
    downloadedVersion: null,
    downloadPercent: null,
    checkedAt: null,
    message: null,
    errorContext: null,
    canRetry: false,
    ...overrides,
  };
}

describe("resolvePendingUpdateVersion", () => {
  it("prefers the downloaded version over the available one", () => {
    expect(
      resolvePendingUpdateVersion(
        buildState({ status: "downloaded", availableVersion: "0.7.2", downloadedVersion: "0.7.2" }),
      ),
    ).toBe("0.7.2");
  });

  it("falls back to the available version and handles a null state", () => {
    expect(
      resolvePendingUpdateVersion(buildState({ status: "available", availableVersion: "0.7.3" })),
    ).toBe("0.7.3");
    expect(resolvePendingUpdateVersion(null)).toBeNull();
  });
});

describe("shouldShowPendingReleaseNotes", () => {
  it("shows notes only while an update is actually pending", () => {
    expect(shouldShowPendingReleaseNotes("available", "0.7.2")).toBe(true);
    expect(shouldShowPendingReleaseNotes("downloaded", "0.7.2")).toBe(true);
    expect(shouldShowPendingReleaseNotes("idle", "0.7.2")).toBe(false);
    expect(shouldShowPendingReleaseNotes("available", null)).toBe(false);
  });
});

describe("findReleaseEntry", () => {
  const entries: readonly WhatsNewEntry[] = [
    { version: "0.7.1", date: "Jun 1", features: [] },
    { version: "0.7.2", date: "Jun 8", features: [] },
  ];

  it("matches an entry by exact version", () => {
    expect(findReleaseEntry(entries, "0.7.2")?.version).toBe("0.7.2");
  });

  it("returns null for unknown or missing versions", () => {
    expect(findReleaseEntry(entries, "9.9.9")).toBeNull();
    expect(findReleaseEntry(entries, null)).toBeNull();
  });
});

describe("resolveAboutUpdateActionLabel", () => {
  it("maps status transitions to the right button label", () => {
    const label = (status: DesktopUpdateStatus, action: string, installing = false) =>
      resolveAboutUpdateActionLabel({ installing, status, action, labels: actionLabels });

    expect(label("idle", "check")).toBe("check");
    expect(label("checking", "check")).toBe("checking");
    expect(label("available", "download")).toBe("download");
    expect(label("downloading", "none")).toBe("downloading");
    expect(label("downloaded", "install")).toBe("install");
    expect(label("downloaded", "install", true)).toBe("installing");
    expect(label("error", "download")).toBe("retry");
  });
});

describe("resolveAboutUpdateHint", () => {
  it("renders the progress percent for downloads", () => {
    expect(
      resolveAboutUpdateHint({
        status: "downloading",
        currentVersion: "0.7.1",
        percent: 42.7,
        labels: hintLabels,
      }),
    ).toBe("downloading:42%");
  });

  it("clamps out-of-range and missing percentages", () => {
    expect(
      resolveAboutUpdateHint({
        status: "downloading",
        currentVersion: "0.7.1",
        percent: null,
        labels: hintLabels,
      }),
    ).toBe("downloading:0%");
  });

  it("stays quiet for idle and checking states", () => {
    expect(
      resolveAboutUpdateHint({
        status: "idle",
        currentVersion: "0.7.1",
        percent: null,
        labels: hintLabels,
      }),
    ).toBeNull();
    expect(
      resolveAboutUpdateHint({
        status: "checking",
        currentVersion: "0.7.1",
        percent: null,
        labels: hintLabels,
      }),
    ).toBeNull();
  });

  it("includes the current version when up to date", () => {
    expect(
      resolveAboutUpdateHint({
        status: "up-to-date",
        currentVersion: "0.7.1",
        percent: null,
        labels: hintLabels,
      }),
    ).toBe("up-to-date:0.7.1");
  });
});
