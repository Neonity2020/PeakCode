// FILE: mobile/useDeviceSnapshot.ts
// Purpose: What this device is running right now — its workspaces and tasks — streamed to
//          the phone over the same WebSocket the desktop uses. The phone renders a list and
//          nothing else, so it reads the shell stream directly instead of dragging the
//          desktop's store, timeline and panels along with it.
// Layer: Mobile data
// Depends on: the WS native API (`orchestration.subscribeShell` + shell events).
// Exports: useDeviceSnapshot, type DeviceSnapshot

import type {
  OrchestrationProjectShell,
  OrchestrationShellStreamItem,
  OrchestrationThreadShell,
} from "@peakcode/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

import { readNativeApi } from "../nativeApi";

/** `unavailable` means the phone reached the page but not the desktop behind it. */
export type DeviceConnection = "connecting" | "connected" | "unavailable";

export interface DeviceSnapshot {
  readonly connection: DeviceConnection;
  readonly projects: ReadonlyArray<OrchestrationProjectShell>;
  readonly threads: ReadonlyArray<OrchestrationThreadShell>;
  readonly refresh: () => void;
  readonly refreshing: boolean;
}

/** Fold one shell stream item into the list the phone holds. */
export function applyShellStreamItem(
  state: {
    projects: ReadonlyArray<OrchestrationProjectShell>;
    threads: ReadonlyArray<OrchestrationThreadShell>;
  },
  item: OrchestrationShellStreamItem,
): {
  projects: ReadonlyArray<OrchestrationProjectShell>;
  threads: ReadonlyArray<OrchestrationThreadShell>;
} {
  if (item.kind === "snapshot") {
    return { projects: item.snapshot.projects, threads: item.snapshot.threads };
  }
  const upsert = <Entry extends { id: string }>(
    entries: ReadonlyArray<Entry>,
    entry: Entry,
  ): ReadonlyArray<Entry> => {
    const index = entries.findIndex((candidate) => candidate.id === entry.id);
    if (index === -1) return [...entries, entry];
    const next = entries.slice();
    next[index] = entry;
    return next;
  };

  switch (item.kind) {
    case "project-upserted":
      return { ...state, projects: upsert(state.projects, item.project) };
    case "project-removed":
      return {
        ...state,
        projects: state.projects.filter((project) => project.id !== item.projectId),
      };
    case "thread-upserted":
      return { ...state, threads: upsert(state.threads, item.thread) };
    case "thread-removed":
      return { ...state, threads: state.threads.filter((thread) => thread.id !== item.threadId) };
    default:
      return state;
  }
}

interface DeviceLists {
  readonly projects: ReadonlyArray<OrchestrationProjectShell>;
  readonly threads: ReadonlyArray<OrchestrationThreadShell>;
}

const EMPTY_LISTS: DeviceLists = { projects: [], threads: [] };

export function useDeviceSnapshot(): DeviceSnapshot {
  const [connection, setConnection] = useState<DeviceConnection>("connecting");
  const [lists, setLists] = useState<DeviceLists>(EMPTY_LISTS);
  const [refreshing, setRefreshing] = useState(false);
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    const api = readNativeApi();
    if (!api) {
      setConnection("unavailable");
      return;
    }
    try {
      const snapshot = await api.orchestration.getShellSnapshot();
      if (!mountedRef.current) return;
      setLists({ projects: snapshot.projects, threads: snapshot.threads });
      setConnection("connected");
    } catch {
      if (mountedRef.current) setConnection("unavailable");
    }
  }, []);

  const refresh = useCallback(() => {
    setRefreshing(true);
    void load().finally(() => {
      if (mountedRef.current) setRefreshing(false);
    });
  }, [load]);

  useEffect(() => {
    mountedRef.current = true;
    const api = readNativeApi();
    if (!api) {
      setConnection("unavailable");
      return;
    }

    const unsubscribe = api.orchestration.onShellEvent((item) => {
      setLists((current) => applyShellStreamItem(current, item));
      setConnection("connected");
    });

    // Subscribing is what makes the snapshot arrive; the explicit fetch covers a dropped
    // first push, and a rejected subscription means this phone is not paired any more.
    void api.orchestration
      .subscribeShell()
      .then(load)
      .catch(() => {
        if (mountedRef.current) setConnection("unavailable");
      });

    return () => {
      mountedRef.current = false;
      unsubscribe();
      void api.orchestration.unsubscribeShell().catch(() => {});
    };
  }, [load]);

  return {
    connection,
    projects: lists.projects,
    threads: lists.threads,
    refresh,
    refreshing,
  };
}
