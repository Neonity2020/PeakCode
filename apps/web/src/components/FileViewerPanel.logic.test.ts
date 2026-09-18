import { describe, expect, it } from "vitest";

import {
  isMarkdownFilePath,
  isPreviewableImagePath,
  resolveFilePreviewKind,
} from "./FileViewerPanel.logic";

describe("resolveFilePreviewKind", () => {
  it("treats markdown extensions as markdown", () => {
    expect(resolveFilePreviewKind("README.md")).toBe("markdown");
    expect(resolveFilePreviewKind("docs/guide.MDX")).toBe("markdown");
    expect(resolveFilePreviewKind("notes.markdown")).toBe("markdown");
  });

  it("treats image extensions as images", () => {
    expect(resolveFilePreviewKind("assets/logo.png")).toBe("image");
    expect(resolveFilePreviewKind("assets/icon.SVG")).toBe("image");
  });

  it("falls back to code for everything else", () => {
    expect(resolveFilePreviewKind("src/index.ts")).toBe("code");
    expect(resolveFilePreviewKind("Dockerfile")).toBe("code");
    expect(resolveFilePreviewKind("archive.tar.gz")).toBe("code");
  });

  it("does not treat a dotfile name as an extension", () => {
    expect(isMarkdownFilePath(".md")).toBe(false);
    expect(isPreviewableImagePath(".png")).toBe(false);
    expect(resolveFilePreviewKind(".gitignore")).toBe("code");
  });
});
