import { describe, expect, it } from "vitest";

import type { ServerProviderStatus } from "@peakcode/contracts";
import {
  isProviderUsable,
  normalizeProviderStatusForLocalConfig,
  providerUnavailableReason,
} from "./providerAvailability";

const BASE_STATUS: ServerProviderStatus = {
  provider: "pi",
  status: "error",
  available: false,
  authStatus: "unknown",
  checkedAt: "2026-04-17T10:00:00.000Z",
  message: "Pi Agent (`pi`) is not installed or not on PATH.",
};

describe("normalizeProviderStatusForLocalConfig", () => {
  it("keeps Pi interactive when a custom binary path is configured locally", () => {
    expect(
      normalizeProviderStatusForLocalConfig({
        provider: "pi",
        status: BASE_STATUS,
        customBinaryPath: "/opt/homebrew/bin/pi",
      }),
    ).toEqual({
      ...BASE_STATUS,
      available: true,
      status: "warning",
      message:
        "Pi uses a custom local binary path in this app. Availability will be confirmed when you start a session.",
    });
  });

  it("marks a custom-path provider ready after a successful session confirms it", () => {
    expect(
      normalizeProviderStatusForLocalConfig({
        provider: "pi",
        status: {
          ...BASE_STATUS,
          provider: "pi",
          message: "Pi Agent (`pi`) is not installed or not on PATH.",
        },
        customBinaryPath: "/custom/bin/pi",
        confirmedCustomBinaryPath: "/custom/bin/pi",
      }),
    ).toEqual({
      provider: "pi",
      authStatus: "unknown",
      available: true,
      checkedAt: BASE_STATUS.checkedAt,
      status: "ready",
    });
  });

  it("keeps warning when a different custom path was confirmed", () => {
    expect(
      normalizeProviderStatusForLocalConfig({
        provider: "pi",
        status: {
          ...BASE_STATUS,
          provider: "pi",
          message: "Pi Agent (`pi`) is not installed or not on PATH.",
        },
        customBinaryPath: "/custom/bin/pi-next",
        confirmedCustomBinaryPath: "/custom/bin/pi",
      }),
    ).toEqual({
      ...BASE_STATUS,
      provider: "pi",
      available: true,
      status: "warning",
      message:
        "Pi uses a custom local binary path in this app. Availability will be confirmed when you start a session.",
    });
  });

  it("preserves authenticated and unauthenticated statuses", () => {
    expect(
      normalizeProviderStatusForLocalConfig({
        provider: "pi",
        status: { ...BASE_STATUS, available: true, status: "ready", authStatus: "authenticated" },
        customBinaryPath: "/opt/homebrew/bin/pi",
      }),
    ).toEqual({ ...BASE_STATUS, available: true, status: "ready", authStatus: "authenticated" });

    expect(
      normalizeProviderStatusForLocalConfig({
        provider: "pi",
        status: { ...BASE_STATUS, authStatus: "unauthenticated" },
        customBinaryPath: "/opt/homebrew/bin/pi",
      }),
    ).toEqual({ ...BASE_STATUS, authStatus: "unauthenticated" });
  });
});

describe("isProviderUsable", () => {
  it("blocks unavailable or unauthenticated providers", () => {
    expect(isProviderUsable(null)).toBe(false);
    expect(isProviderUsable(undefined)).toBe(false);
    expect(isProviderUsable(BASE_STATUS)).toBe(false);
    expect(
      isProviderUsable({ ...BASE_STATUS, available: true, authStatus: "unauthenticated" }),
    ).toBe(false);
    expect(isProviderUsable({ ...BASE_STATUS, available: true, authStatus: "authenticated" })).toBe(
      true,
    );
  });
});

describe("providerUnavailableReason", () => {
  it("returns provider-specific guidance", () => {
    expect(providerUnavailableReason({ ...BASE_STATUS, authStatus: "unauthenticated" })).toBe(
      "Pi is not authenticated yet.",
    );
    expect(providerUnavailableReason(BASE_STATUS)).toBe(BASE_STATUS.message);
  });
});
