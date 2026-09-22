// FILE: disposeTerminalRuntime.ts
// Purpose: Dispose xterm runtime entries on demand without pulling the xterm stack into a
// first-paint chunk.
// Layer: Terminal runtime infrastructure
// Depends on: terminalRuntimeRegistry.ts (loaded lazily on first use).

/**
 * The runtime registry owns live xterm instances, so importing it eagerly from always-mounted
 * surfaces (chat, workspace, sidebar) would drag the whole xterm stack into their first-paint
 * chunks. Callers only need the registry when a terminal tab or thread is closed, so these
 * helpers load it lazily. When a terminal has actually been opened the module is already cached
 * and the dispose runs on the next microtask; otherwise the registry is empty and the call is a
 * no-op.
 */
function disposeWhenReady(dispose: (registry: TerminalRuntimeRegistry) => void): void {
  void import("./terminalRuntimeRegistry").then(({ terminalRuntimeRegistry }) => {
    dispose(terminalRuntimeRegistry);
  });
}

type TerminalRuntimeRegistry =
  (typeof import("./terminalRuntimeRegistry"))["terminalRuntimeRegistry"];

/** Dispose a single terminal runtime entry for a thread. */
export function disposeThreadTerminalRuntime(threadId: string, terminalId: string): void {
  disposeWhenReady((registry) => registry.disposeTerminal(threadId, terminalId));
}

/** Dispose every terminal runtime entry belonging to a thread. */
export function disposeThreadTerminalRuntimes(threadId: string): void {
  disposeWhenReady((registry) => registry.disposeThread(threadId));
}
