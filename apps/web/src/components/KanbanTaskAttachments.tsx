// FILE: KanbanTaskAttachments.tsx
// Purpose: Thumbnail strip for the images attached to a kanban task's
//          requirement. The create page passes object-URL previews and can
//          remove items; the detail page passes local-image URLs for stored
//          files. Presentation only.
// Layer: Component
// Exports: KanbanTaskAttachments

import { XIcon } from "../lib/icons";

export interface KanbanAttachmentThumbnail {
  readonly key: string;
  /** Fully resolved image URL. */
  readonly src: string;
  readonly name: string;
}

export function KanbanTaskAttachments(props: {
  items: ReadonlyArray<KanbanAttachmentThumbnail>;
  onRemove?: ((key: string) => void) | undefined;
  removeLabel?: string | undefined;
}) {
  const { items, onRemove, removeLabel } = props;
  if (items.length === 0) return null;

  return (
    <ul className="flex flex-wrap gap-2" data-kanban-attachments={items.length}>
      {items.map((item) => (
        <li key={item.key} className="group relative">
          <a
            href={item.src}
            target="_blank"
            rel="noreferrer"
            title={item.name}
            className="block size-20 overflow-hidden rounded-md border border-border/60 bg-background/60"
          >
            <img
              src={item.src}
              alt={item.name}
              loading="lazy"
              decoding="async"
              className="size-full object-cover"
            />
          </a>
          {onRemove ? (
            <button
              type="button"
              onClick={() => onRemove(item.key)}
              aria-label={removeLabel}
              title={removeLabel}
              className="absolute -top-1.5 -right-1.5 inline-flex size-5 items-center justify-center rounded-full border border-border/60 bg-background text-foreground/70 shadow-xs transition-colors hover:text-destructive"
            >
              <XIcon className="size-3" />
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
