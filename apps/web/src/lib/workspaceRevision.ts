// FILE: workspaceRevision.ts
// Purpose: Broadcast when a turn may have changed files, so plain filesystem views that are not
//          React Query caches (the lazy file tree) can refresh themselves.
// Layer: Web runtime utility
// Exports: workspace revision snapshot, subscribe, bump, and the React reader

import { useSyncExternalStore } from "react";

let revision = 0;
const listeners = new Set<() => void>();

export function getWorkspaceRevision(): number {
  return revision;
}

export function subscribeToWorkspaceRevision(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Called at turn boundaries — the same events that invalidate the project query caches. */
export function bumpWorkspaceRevision(): void {
  revision += 1;
  for (const listener of listeners) {
    listener();
  }
}

export function useWorkspaceRevision(): number {
  return useSyncExternalStore(subscribeToWorkspaceRevision, getWorkspaceRevision, () => 0);
}

/** Test seam: drop every subscriber so a spec starts from a clean registry. */
export function resetWorkspaceRevisionForTest(): void {
  revision = 0;
  listeners.clear();
}
