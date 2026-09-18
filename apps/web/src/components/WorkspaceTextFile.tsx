// FILE: WorkspaceTextFile.tsx
// Purpose: Render one workspace text file with syntax highlighting and line numbers.
// Layer: Workspace files UI
// Exports: default WorkspaceTextFile
// Depends on: @pierre/diffs/react (same highlighter the diff panel uses)

import { type FileContents, File as DiffFile } from "@pierre/diffs/react";
import { useMemo } from "react";

import { buildWorkspaceCodeUnsafeCSS, resolveDiffThemeName } from "~/lib/diffRendering";

// Above this size the tokenizer cost stops being worth it, so the file renders as plain
// text with line numbers instead of blocking the main thread on syntax parsing.
const MAX_HIGHLIGHTED_FILE_BYTES = 120 * 1024;

export default function WorkspaceTextFile(props: {
  filePath: string;
  contents: string;
  wordWrap: boolean;
  theme: "light" | "dark";
}) {
  const { filePath, contents, wordWrap, theme } = props;
  const shouldHighlight = contents.length <= MAX_HIGHLIGHTED_FILE_BYTES;
  const file = useMemo<FileContents>(
    () => ({
      name: filePath,
      contents,
      ...(shouldHighlight ? {} : { lang: "text" as const }),
      cacheKey: `${filePath}:${contents.length}`,
    }),
    [contents, filePath, shouldHighlight],
  );

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <DiffFile
        file={file}
        options={{
          theme: resolveDiffThemeName(theme),
          themeType: theme,
          overflow: wordWrap ? "wrap" : "scroll",
          // The panel supplies its own breadcrumb header, so the library header would duplicate it.
          disableFileHeader: true,
          preferredHighlighter: "shiki-js",
          unsafeCSS: buildWorkspaceCodeUnsafeCSS(theme),
        }}
      />
    </div>
  );
}
