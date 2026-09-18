import { afterEach, describe, expect, it, vi } from "vitest";

import {
  bumpWorkspaceRevision,
  getWorkspaceRevision,
  resetWorkspaceRevisionForTest,
  subscribeToWorkspaceRevision,
} from "./workspaceRevision";

describe("workspaceRevision", () => {
  afterEach(() => {
    resetWorkspaceRevisionForTest();
  });

  it("starts at zero", () => {
    expect(getWorkspaceRevision()).toBe(0);
  });

  it("increments on every bump", () => {
    bumpWorkspaceRevision();
    bumpWorkspaceRevision();
    expect(getWorkspaceRevision()).toBe(2);
  });

  it("notifies every subscriber and stops after unsubscribe", () => {
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = subscribeToWorkspaceRevision(first);
    const unsubscribeSecond = subscribeToWorkspaceRevision(second);

    bumpWorkspaceRevision();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    unsubscribeFirst();
    bumpWorkspaceRevision();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);

    unsubscribeSecond();
    bumpWorkspaceRevision();
    expect(second).toHaveBeenCalledTimes(2);
  });

  it("drops every subscriber when reset for tests", () => {
    const listener = vi.fn();
    subscribeToWorkspaceRevision(listener);

    resetWorkspaceRevisionForTest();
    bumpWorkspaceRevision();

    expect(listener).not.toHaveBeenCalled();
    expect(getWorkspaceRevision()).toBe(1);
  });
});
