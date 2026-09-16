// FILE: kanbanDrag.ts
// Purpose: Pure index math for kanban drag-and-drop, kept out of the view so
//          the slot arithmetic can be tested directly.
// Layer: Web utility
// Exports: dropIndexFromMiddles, resolveDropIndex

/**
 * Index of the slot the pointer sits above. `cardMiddles` holds each rendered
 * card's vertical midpoint, in visual order; dropping below the last card
 * returns the list length (append).
 */
export function dropIndexFromMiddles(cardMiddles: ReadonlyArray<number>, clientY: number): number {
  for (let index = 0; index < cardMiddles.length; index += 1) {
    const middle = cardMiddles[index]!;
    if (clientY < middle) return index;
  }
  return cardMiddles.length;
}

/**
 * Convert the pointer slot into a server order. While a card is dragged inside
 * its own column it is still rendered, so every slot after its original
 * position is one too high once the card is lifted out.
 */
export function resolveDropIndex(input: {
  readonly rawIndex: number;
  /** Index of the dragged task inside the target column, or null when it comes from another column. */
  readonly originalIndex: number | null;
}): number {
  const { rawIndex, originalIndex } = input;
  if (originalIndex === null || originalIndex >= rawIndex) return rawIndex;
  return rawIndex - 1;
}
