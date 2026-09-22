import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeStallWatchdog } from "./piSubagentWatchdog.ts";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("makeStallWatchdog", () => {
  it("fires once the silence window is used up, not before", () => {
    const stalls: number[] = [];
    makeStallWatchdog({ timeoutMs: 1000, onStall: () => stalls.push(Date.now()) });

    vi.advanceTimersByTime(999);
    expect(stalls).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(stalls).toHaveLength(1);
  });

  it("treats any activity as a fresh window", () => {
    // This is what keeps the timeout generous without killing real work: a worker that keeps
    // emitting tool events is never "silent", however long it runs.
    const stalls: number[] = [];
    const watchdog = makeStallWatchdog({ timeoutMs: 1000, onStall: () => stalls.push(1) });

    for (let elapsed = 0; elapsed < 5000; elapsed += 500) {
      vi.advanceTimersByTime(500);
      watchdog.touch();
    }
    expect(stalls).toHaveLength(0);

    vi.advanceTimersByTime(1000);
    expect(stalls).toHaveLength(1);
  });

  it("stops counting once disarmed, however often that is called", () => {
    const stalls: number[] = [];
    const watchdog = makeStallWatchdog({ timeoutMs: 1000, onStall: () => stalls.push(1) });

    watchdog.stop();
    watchdog.stop();
    vi.advanceTimersByTime(60_000);
    expect(stalls).toHaveLength(0);
  });

  it("only fires once per silence window", () => {
    // A stalled worker is aborted by the handler; a second tick would report it twice.
    const stalls: number[] = [];
    const watchdog = makeStallWatchdog({ timeoutMs: 1000, onStall: () => stalls.push(1) });

    vi.advanceTimersByTime(1000);
    expect(stalls).toHaveLength(1);
    vi.advanceTimersByTime(10_000);
    expect(stalls).toHaveLength(1);
    // ...unless it is touched again, which means it came back to life.
    watchdog.touch();
    vi.advanceTimersByTime(1000);
    expect(stalls).toHaveLength(2);
  });
});
