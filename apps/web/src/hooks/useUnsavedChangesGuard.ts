// FILE: useUnsavedChangesGuard.ts
// Purpose: Keep unsaved input from disappearing silently. One place decides how a
//          route change (sidebar, keyboard, history) or a closed editor asks before
//          discarding what the user typed, instead of each screen inventing its own
//          answer — or, worse, having none.
// Layer: Web hook
// Depends on: @tanstack/react-router's blocker.

import { useBlocker } from "@tanstack/react-router";
import { useCallback, useRef } from "react";

export interface UnsavedChangesGuard {
  /**
   * Whether the current input would be lost. `false` disables the guard entirely, so a
   * clean form navigates without a prompt.
   */
  readonly confirmDiscard: () => boolean;
  /** Let the next navigation through: call right before a deliberate, already-confirmed one. */
  readonly allowNextNavigation: () => void;
}

/**
 * Guard a screen that holds unsaved input.
 *
 * `useBlocker` covers every navigation the router performs — a sidebar click, a keyboard
 * shortcut, history — while `enableBeforeUnload` covers closing or reloading the tab. Both
 * ask the same question, and both are disabled while there is nothing to lose.
 *
 * A screen whose own Cancel/Back button already asked should call `allowNextNavigation()`
 * before navigating, or the user is asked twice.
 */
export function useUnsavedChangesGuard(input: {
  readonly shouldConfirm: boolean;
  readonly confirmMessage: string;
}): UnsavedChangesGuard {
  const { shouldConfirm, confirmMessage } = input;
  /** Set right before a deliberate navigation so the blocker stays quiet for exactly one. */
  const allowedRef = useRef(false);

  const allowNextNavigation = useCallback(() => {
    allowedRef.current = true;
  }, []);

  const confirmDiscard = useCallback(() => {
    if (!shouldConfirm) return true;
    if (!window.confirm(confirmMessage)) return false;
    allowedRef.current = true;
    return true;
  }, [confirmMessage, shouldConfirm]);

  useBlocker({
    disabled: !shouldConfirm,
    enableBeforeUnload: shouldConfirm,
    shouldBlockFn: () => {
      if (allowedRef.current) {
        // One pass only: a navigation that never happened must not disarm the guard.
        allowedRef.current = false;
        return false;
      }
      return !window.confirm(confirmMessage);
    },
  });

  return { confirmDiscard, allowNextNavigation };
}
