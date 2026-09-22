import path from "node:path";

import { isPathInside } from "@peakcode/shared/pathSafety";

export const ATTACHMENTS_ROUTE_PREFIX = "/attachments";

export function normalizeAttachmentRelativePath(rawRelativePath: string): string | null {
  const normalized = path.normalize(rawRelativePath).replace(/^[/\\]+/, "");
  if (normalized.length === 0 || normalized.startsWith("..") || normalized.includes("\0")) {
    return null;
  }
  return normalized.replace(/\\/g, "/");
}

export function resolveAttachmentRelativePath(input: {
  readonly attachmentsDir: string;
  readonly relativePath: string;
}): string | null {
  const normalizedRelativePath = normalizeAttachmentRelativePath(input.relativePath);
  if (!normalizedRelativePath) {
    return null;
  }

  const attachmentsRoot = path.resolve(input.attachmentsDir);
  const filePath = path.resolve(path.join(attachmentsRoot, normalizedRelativePath));
  if (!isPathInside(filePath, attachmentsRoot)) {
    return null;
  }
  return filePath;
}
