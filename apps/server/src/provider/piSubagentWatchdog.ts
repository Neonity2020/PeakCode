/**
 * PiSubagentWatchdog - Ends a delegated worker that has gone quiet.
 *
 * @module PiSubagentWatchdog
 */

/**
 * Why this exists.
 *
 * A worker's session can stop producing anything without ever failing: the provider stops
 * responding, a request is black-holed, a tool wedges. Nothing in the SDK turns that into an
 * error, and the orchestrator's turn is parked inside the `task` call waiting for it — so one
 * silent worker holds the whole turn open, forever, with the card reading "Working". That is the
 * state a user cannot escape or even explain: nothing finished, nothing continued, no more
 * messages.
 *
 * The signal worth watching is therefore not total runtime but *silence*. A worker reading a big
 * tree, or waiting on a 6-minute build, is busy and emits tool events the whole time; a worker
 * that has said nothing for ten minutes is not slow, it is stuck. Watching liveness rather than
 * duration is what lets the timeout be long enough never to kill real work.
 *
 * The caller decides what "stuck" means; this only keeps the clock.
 */
export interface StallWatchdog {
  /** Note activity: restart the silence window. */
  touch(): void;
  /** Disarm. Safe to call more than once. */
  stop(): void;
}

export function makeStallWatchdog(input: {
  readonly timeoutMs: number;
  readonly onStall: () => void;
}): StallWatchdog {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const disarm = () => {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
  };

  const arm = () => {
    disarm();
    timer = setTimeout(() => {
      timer = undefined;
      input.onStall();
    }, input.timeoutMs);
    // A watchdog must never be the reason the process stays alive.
    (timer as { unref?: () => void }).unref?.();
  };

  arm();

  return { touch: arm, stop: disarm };
}
