import { assert, describe, it } from "vitest";

import { PROJECT_READ_FILE_MAX_BYTES } from "@peakcode/contracts";
import {
  classifyWorkspaceFileContents,
  containsNullByte,
  decodeTextFileContents,
} from "./workspaceFileContent";

function bytesOf(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

describe("containsNullByte", () => {
  it("detects a null byte inside the sniff window", () => {
    assert.isTrue(containsNullByte(new Uint8Array([0x61, 0x00, 0x62])));
  });

  it("ignores null bytes past the sniff window", () => {
    const bytes = new Uint8Array(16);
    bytes.fill(0x61);
    bytes[12] = 0;
    assert.isFalse(containsNullByte(bytes, 8));
  });

  it("returns false for plain text", () => {
    assert.isFalse(containsNullByte(bytesOf("hello world")));
  });
});

describe("decodeTextFileContents", () => {
  it("strips a UTF-8 byte order mark", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x68, 0x69]);
    assert.equal(decodeTextFileContents(bytes), "hi");
  });

  it("keeps multi-byte characters intact", () => {
    assert.equal(decodeTextFileContents(bytesOf("你好, world")), "你好, world");
  });
});

describe("classifyWorkspaceFileContents", () => {
  it("classifies UTF-8 text and reports its byte length", () => {
    const bytes = bytesOf("const a = 1;\n");
    assert.deepEqual(classifyWorkspaceFileContents({ bytes, byteLength: bytes.byteLength }), {
      kind: "text",
      contents: "const a = 1;\n",
      byteLength: bytes.byteLength,
    });
  });

  it("classifies binary content without returning any payload", () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]);
    assert.deepEqual(classifyWorkspaceFileContents({ bytes, byteLength: bytes.byteLength }), {
      kind: "binary",
      contents: "",
      byteLength: bytes.byteLength,
    });
  });

  it("reports oversized files as too-large without decoding them", () => {
    const bytes = bytesOf("payload");
    assert.deepEqual(
      classifyWorkspaceFileContents({ bytes, byteLength: PROJECT_READ_FILE_MAX_BYTES + 1 }),
      {
        kind: "too-large",
        contents: "",
        byteLength: PROJECT_READ_FILE_MAX_BYTES + 1,
      },
    );
  });

  it("treats an empty file as empty text", () => {
    assert.deepEqual(classifyWorkspaceFileContents({ bytes: new Uint8Array(), byteLength: 0 }), {
      kind: "text",
      contents: "",
      byteLength: 0,
    });
  });
});
