// FILE: kanbanTaskAttachments.ts
// Purpose: Pure helpers behind the kanban task requirement's image picker: which
//          files the board accepts, and how a picked file becomes a draft
//          attachment with a local preview. Kept out of the view so the size /
//          type / count limits are testable without a browser.
// Layer: Web logic helpers

import { KANBAN_TASK_MAX_ATTACHMENT_BYTES, KANBAN_TASK_MAX_ATTACHMENTS } from "@peakcode/contracts";

export { KANBAN_TASK_MAX_ATTACHMENTS };

/** A file the user picked, held in memory until the task is created. */
export interface KanbanDraftAttachment {
  readonly id: string;
  readonly file: File;
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  /** Object URL for the thumbnail; callers revoke it when the draft is dropped. */
  readonly previewUrl: string;
}

export const KANBAN_ATTACHMENT_MAX_MEGABYTES = KANBAN_TASK_MAX_ATTACHMENT_BYTES / (1024 * 1024);

export type KanbanAttachmentRejectionReason = "type" | "size" | "count";

export interface KanbanAttachmentRejection {
  readonly name: string;
  readonly reason: KanbanAttachmentRejectionReason;
}

export interface KanbanAttachmentSelection {
  readonly accepted: Array<File>;
  readonly rejected: Array<KanbanAttachmentRejection>;
}

function isImageFile(file: File): boolean {
  return file.type.toLowerCase().startsWith("image/");
}

/**
 * Splits picked files into the ones the board can store and the ones it cannot.
 * `existingCount` is how many images the draft already holds, so the shared
 * count limit is enforced across file-picker, paste and drop alike.
 */
export function selectKanbanAttachmentFiles(
  files: ReadonlyArray<File>,
  existingCount: number,
): KanbanAttachmentSelection {
  const accepted: Array<File> = [];
  const rejected: Array<KanbanAttachmentRejection> = [];
  let remaining = Math.max(0, KANBAN_TASK_MAX_ATTACHMENTS - existingCount);

  for (const file of files) {
    if (!isImageFile(file)) {
      rejected.push({ name: file.name, reason: "type" });
      continue;
    }
    if (file.size > KANBAN_TASK_MAX_ATTACHMENT_BYTES) {
      rejected.push({ name: file.name, reason: "size" });
      continue;
    }
    if (remaining <= 0) {
      rejected.push({ name: file.name, reason: "count" });
      continue;
    }
    remaining -= 1;
    accepted.push(file);
  }

  return { accepted, rejected };
}

/** Wraps an accepted file for preview; the caller owns revoking `previewUrl`. */
export function toKanbanDraftAttachment(
  file: File,
  createPreviewUrl: (file: File) => string = (value) => URL.createObjectURL(value),
): KanbanDraftAttachment {
  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    file,
    name: file.name || "image",
    mimeType: file.type,
    sizeBytes: file.size,
    previewUrl: createPreviewUrl(file),
  };
}

/** Files the user pasted, ignoring clipboard payloads that carry no file. */
export function imageFilesFromClipboard(items: DataTransferItemList | null): Array<File> {
  if (!items) return [];
  const files: Array<File> = [];
  for (const item of Array.from(items)) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (file && isImageFile(file)) files.push(file);
  }
  return files;
}

export function readKanbanAttachmentDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const result = reader.result;
      if (typeof result === "string" && result.length > 0) {
        resolve(result);
      } else {
        reject(new Error(`Could not read '${file.name}'.`));
      }
    });
    reader.addEventListener("error", () =>
      reject(reader.error ?? new Error(`Could not read '${file.name}'.`)),
    );
    reader.readAsDataURL(file);
  });
}

export function revokeKanbanAttachmentPreviews(
  attachments: ReadonlyArray<KanbanDraftAttachment>,
): void {
  for (const attachment of attachments) {
    URL.revokeObjectURL(attachment.previewUrl);
  }
}
