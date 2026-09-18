// FILE: listOrder.ts
// Purpose: List-ordering helpers shared by the app's project lists.
// Layer: Web presentation helper
// Exports: moveToEnd

/**
 * Moves every item the predicate matches to the end, leaving the rest in place.
 *
 * Used for the app's built-in workspace project: it is a scratch container
 * created for unassigned threads, not a directory anybody chose, so it belongs
 * at the bottom of every project list whatever that list is ordered by.
 */
export function moveToEnd<T>(items: readonly T[], shouldMove: (item: T) => boolean): T[] {
  const moved = items.filter(shouldMove);
  if (moved.length === 0) return [...items];
  return [...items.filter((item) => !shouldMove(item)), ...moved];
}
