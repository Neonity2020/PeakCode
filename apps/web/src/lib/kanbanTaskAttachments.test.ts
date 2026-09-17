// FILE: kanbanTaskAttachments.test.ts
// Purpose: The board's image picker limits are enforced the same way for the file
//          dialog, paste and drop — these tests pin that behavior.
// Layer: Web logic tests

import { describe, expect, it } from "vitest";

import {
  KANBAN_ATTACHMENT_MAX_MEGABYTES,
  KANBAN_TASK_MAX_ATTACHMENTS,
  selectKanbanAttachmentFiles,
  toKanbanDraftAttachment,
} from "./kanbanTaskAttachments";

const imageFile = (name: string, sizeBytes: number, type = "image/png"): File =>
  new File([new Uint8Array(sizeBytes)], name, { type });

describe("selectKanbanAttachmentFiles", () => {
  it("accepts images within the size limit", () => {
    const { accepted, rejected } = selectKanbanAttachmentFiles(
      [imageFile("a.png", 10), imageFile("b.jpg", 20, "image/jpeg")],
      0,
    );
    expect(accepted.map((file) => file.name)).toEqual(["a.png", "b.jpg"]);
    expect(rejected).toEqual([]);
  });

  it("rejects non-images and oversized files with a reason", () => {
    const oversized = imageFile("big.png", KANBAN_ATTACHMENT_MAX_MEGABYTES * 1024 * 1024 + 1);
    const { accepted, rejected } = selectKanbanAttachmentFiles(
      [
        imageFile("ok.png", 10),
        new File(["pdf"], "doc.pdf", { type: "application/pdf" }),
        oversized,
      ],
      0,
    );
    expect(accepted.map((file) => file.name)).toEqual(["ok.png"]);
    expect(rejected).toEqual([
      { name: "doc.pdf", reason: "type" },
      { name: "big.png", reason: "size" },
    ]);
  });

  it("stops at the shared count limit across existing attachments", () => {
    const files = Array.from({ length: 3 }, (_, index) => imageFile(`f${index}.png`, 5));
    const { accepted, rejected } = selectKanbanAttachmentFiles(
      files,
      KANBAN_TASK_MAX_ATTACHMENTS - 1,
    );
    expect(accepted.map((file) => file.name)).toEqual(["f0.png"]);
    expect(rejected).toEqual([
      { name: "f1.png", reason: "count" },
      { name: "f2.png", reason: "count" },
    ]);
  });
});

describe("toKanbanDraftAttachment", () => {
  it("carries a preview URL and the file metadata", () => {
    const file = imageFile("shot.png", 12);
    const draft = toKanbanDraftAttachment(file, () => "blob:preview");
    expect(draft).toMatchObject({
      name: "shot.png",
      mimeType: "image/png",
      sizeBytes: 12,
      previewUrl: "blob:preview",
    });
    expect(draft.id.length).toBeGreaterThan(0);
  });
});
