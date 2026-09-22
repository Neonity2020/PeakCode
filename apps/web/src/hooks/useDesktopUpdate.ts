// FILE: useDesktopUpdate.ts
// Purpose: Own the desktop auto-update state machine for any surface that can
// drive it — currently the sidebar's compact update button and the About
// settings panel. Subscribes to the main process, tracks the optimistic
// "installing" flag, dispatches check/download/install actions, and reports the
// outcome with toasts. Keeping this in one hook means both entry points stay in
// lockstep (same state, same wording) instead of drifting apart.
// Layer: hook

import type { DesktopUpdateState } from "@peakcode/contracts";
import { useCallback, useEffect, useState } from "react";

import {
  getDesktopUpdateActionError,
  isDesktopUpdateButtonDisabled,
  resolveDesktopUpdateButtonAction,
  shouldToastDesktopUpdateActionResult,
  type DesktopUpdateButtonAction,
} from "../components/desktopUpdate.logic";
import { toastManager } from "../components/ui/toast";
import { isElectron } from "../env";
import { useMessages } from "../i18n";

export interface UseDesktopUpdateResult {
  /** Latest state pushed by the main process. `null` until the first read. */
  readonly state: DesktopUpdateState | null;
  /** A download or install is in flight (set optimistically before the round-trip). */
  readonly installing: boolean;
  /** What the primary action button should do right now. */
  readonly action: DesktopUpdateButtonAction;
  /** Whether the primary action button is currently disabled. */
  readonly disabled: boolean;
  /** Whether a desktop bridge exists to talk to at all (false in a browser). */
  readonly available: boolean;
  /**
   * Run the current action (check / download / install). `beforeInstall` lets a
   * caller flush unsaved app state right before the app quits to install.
   */
  readonly requestAction: (options?: { beforeInstall?: () => void }) => void;
}

export function useDesktopUpdate(): UseDesktopUpdateResult {
  const messages = useMessages();
  const [state, setState] = useState<DesktopUpdateState | null>(null);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    if (!isElectron) return;
    const bridge = window.desktopBridge;
    if (
      !bridge ||
      typeof bridge.getUpdateState !== "function" ||
      typeof bridge.onUpdateState !== "function"
    ) {
      return;
    }

    let disposed = false;
    let receivedSubscriptionUpdate = false;
    const unsubscribe = bridge.onUpdateState((nextState) => {
      if (disposed) return;
      receivedSubscriptionUpdate = true;
      setState(nextState);
    });

    void bridge
      .getUpdateState()
      .then((nextState) => {
        if (disposed || receivedSubscriptionUpdate) return;
        setState(nextState);
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  const action = state ? resolveDesktopUpdateButtonAction(state) : "none";
  const disabled = isDesktopUpdateButtonDisabled(state) || installing;
  const available = isElectron;

  const requestAction = useCallback(
    (options?: { beforeInstall?: () => void }) => {
      const bridge = window.desktopBridge;
      if (!bridge || !state) return;

      const currentAction = resolveDesktopUpdateButtonAction(state);
      if (isDesktopUpdateButtonDisabled(state) || installing || currentAction === "none") return;

      const copy = messages.desktopUpdate;

      if (currentAction === "check") {
        void bridge
          .checkForUpdates()
          .then((nextState) => {
            setInstalling(false);
            setState(nextState);
            if (nextState.status === "available") {
              toastManager.add({
                type: "success",
                title: copy.updateAvailable.title,
                description: copy.updateAvailable.description(
                  nextState.availableVersion ?? nextState.currentVersion,
                ),
              });
              return;
            }
            if (nextState.status === "up-to-date") {
              toastManager.add({
                type: "info",
                title: copy.upToDate.title,
                description: copy.upToDate.description(nextState.currentVersion),
              });
              return;
            }
            if (nextState.status === "error") {
              toastManager.add({
                type: "error",
                title: copy.checkFailedTitle,
                description: nextState.message ?? copy.unexpectedError,
              });
            }
          })
          .catch((error) => {
            toastManager.add({
              type: "error",
              title: copy.checkFailedTitle,
              description: error instanceof Error ? error.message : copy.unexpectedError,
            });
          });
        return;
      }

      if (currentAction === "download") {
        void bridge
          .downloadUpdate()
          .then((result) => {
            setInstalling(false);
            setState(result.state);
            if (result.completed) {
              toastManager.add({
                type: "success",
                title: copy.downloaded.title,
                description: copy.downloaded.description,
              });
            }
            if (!shouldToastDesktopUpdateActionResult(result)) return;
            const actionError = getDesktopUpdateActionError(result);
            if (!actionError) return;
            toastManager.add({
              type: "error",
              title: copy.downloadFailedTitle,
              description: actionError,
            });
          })
          .catch((error) => {
            toastManager.add({
              type: "error",
              title: copy.downloadStartFailedTitle,
              description: error instanceof Error ? error.message : copy.unexpectedError,
            });
          });
        return;
      }

      if (currentAction === "install") {
        setInstalling(true);
        options?.beforeInstall?.();
        void bridge
          .installUpdate()
          .then((result) => {
            setState(result.state);
            setInstalling(false);
            if (!shouldToastDesktopUpdateActionResult(result)) return;
            const actionError = getDesktopUpdateActionError(result);
            if (!actionError) return;
            toastManager.add({
              type: "error",
              title: copy.installFailedTitle,
              description: actionError,
            });
          })
          .catch((error) => {
            setInstalling(false);
            toastManager.add({
              type: "error",
              title: copy.installFailedTitle,
              description: error instanceof Error ? error.message : copy.unexpectedError,
            });
          });
      }
    },
    [installing, messages, state],
  );

  return { state, installing, action, disabled, available, requestAction };
}
