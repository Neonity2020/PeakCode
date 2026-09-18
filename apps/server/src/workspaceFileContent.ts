// FILE: workspaceFileContent.ts
// Purpose: Classify raw workspace file bytes into something a preview surface can render.
// Layer: Server workspace utilities
// Exports: classifyWorkspaceFileContents, decodeTextFileContents, containsNullByte

import { PROJECT_READ_FILE_MAX_BYTES, type ProjectReadFileKind } from "@peakcode/contracts";

export interface ClassifiedWorkspaceFile {
  kind: ProjectReadFileKind;
  contents: string;
  byteLength: number;
}

// Git and most tooling treat a NUL byte in the first block as the binary signal; a
// truncated multi-byte sequence would otherwise decode to replacement characters.
const BINARY_SNIFF_BYTES = 8 * 1024;

export function containsNullByte(bytes: Uint8Array, limit = BINARY_SNIFF_BYTES): boolean {
  const end = Math.min(bytes.byteLength, limit);
  for (let index = 0; index < end; index += 1) {
    if (bytes[index] === 0) {
      return true;
    }
  }
  return false;
}

export function decodeTextFileContents(bytes: Uint8Array): string {
  // Strip a UTF-8 BOM so the viewer does not render an invisible leading character.
  const hasByteOrderMark =
    bytes.byteLength >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const view = hasByteOrderMark ? bytes.subarray(3) : bytes;
  return new TextDecoder("utf-8", { fatal: false }).decode(view);
}

export function classifyWorkspaceFileContents(input: {
  bytes: Uint8Array;
  byteLength: number;
  maxBytes?: number;
}): ClassifiedWorkspaceFile {
  const maxBytes = input.maxBytes ?? PROJECT_READ_FILE_MAX_BYTES;
  if (input.byteLength > maxBytes) {
    return { kind: "too-large", contents: "", byteLength: input.byteLength };
  }
  if (containsNullByte(input.bytes)) {
    return { kind: "binary", contents: "", byteLength: input.byteLength };
  }
  return {
    kind: "text",
    contents: decodeTextFileContents(input.bytes),
    byteLength: input.byteLength,
  };
}
