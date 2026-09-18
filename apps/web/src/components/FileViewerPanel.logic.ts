// FILE: FileViewerPanel.logic.ts
// Purpose: Pure helpers for the file preview panel — pick a preview mode per file type.
// Layer: Web panel logic
// Exports: preview-kind resolvers

import { basenameOfWorkspacePath } from "~/lib/workspaceFileTree";

export type FilePreviewKind = "markdown" | "image" | "code";

const MARKDOWN_EXTENSIONS: ReadonlySet<string> = new Set(["md", "mdx", "markdown"]);

// Mirrors the server's /api/local-image extension allowlist so the panel only offers an
// image preview for paths that route can actually serve.
const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  "avif",
  "bmp",
  "gif",
  "heic",
  "heif",
  "ico",
  "jpeg",
  "jpg",
  "png",
  "svg",
  "tiff",
  "webp",
]);

function extensionOf(relativePath: string): string {
  const name = basenameOfWorkspacePath(relativePath);
  const dotIndex = name.lastIndexOf(".");
  return dotIndex > 0 ? name.slice(dotIndex + 1).toLowerCase() : "";
}

export function isMarkdownFilePath(relativePath: string): boolean {
  return MARKDOWN_EXTENSIONS.has(extensionOf(relativePath));
}

export function isPreviewableImagePath(relativePath: string): boolean {
  return IMAGE_EXTENSIONS.has(extensionOf(relativePath));
}

export function resolveFilePreviewKind(relativePath: string): FilePreviewKind {
  if (isMarkdownFilePath(relativePath)) {
    return "markdown";
  }
  if (isPreviewableImagePath(relativePath)) {
    return "image";
  }
  return "code";
}
