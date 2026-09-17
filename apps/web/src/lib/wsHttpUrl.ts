// FILE: wsHttpUrl.ts
// Purpose: Resolves server HTTP URLs from the active WebSocket bridge so desktop <img>/download
// requests carry the same legacy startup token already used for the WS connection.
// Layer: Web utility
// Exports: resolveWsHttpUrl, toAttachmentPreviewUrl

import { resolveServerHttpUrl } from "./serverEndpoint";

// Build a fully-qualified HTTP URL for `rawPath` against the same server the WS connection
// uses — see `serverEndpoint` for how that origin is chosen on desktop, in dev, and on a
// phone that reached the app through a tunnel (where relative paths are already correct).
export function resolveWsHttpUrl(rawPath: string): string {
  return resolveServerHttpUrl(rawPath);
}

export function toAttachmentPreviewUrl(rawUrl: string): string {
  if (rawUrl.startsWith("/")) {
    return resolveWsHttpUrl(rawUrl);
  }
  return rawUrl;
}
