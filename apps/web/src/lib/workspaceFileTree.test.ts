import { assert, describe, it } from "vitest";

import type { ProjectChangedFile, ProjectFileSystemEntry } from "@peakcode/contracts";
import {
  basenameOfWorkspacePath,
  buildChangedDecoration,
  buildVisibleWorkspaceTreeRows,
  buildWorkspaceBreadcrumb,
  describeWorkspaceRelativePath,
  filterEntriesByPathQuery,
  isWorkspaceEntryChanged,
  joinWorkspacePath,
  resolveAncestorDirectoryPaths,
  resolveChangedDirectorySet,
  resolveDirectoriesToExpand,
  resolveChangedStatusByPath,
} from "./workspaceFileTree";

function dir(path: string, name: string, hasChildren = true): ProjectFileSystemEntry {
  return { path, name, kind: "directory", hasChildren };
}

function file(path: string, name: string): ProjectFileSystemEntry {
  return { path, name, kind: "file" };
}

function changed(path: string, status: ProjectChangedFile["status"]): ProjectChangedFile {
  return { path, status };
}

describe("joinWorkspacePath", () => {
  it("joins with the root separator", () => {
    assert.equal(
      joinWorkspacePath("/Users/me/repo", "src/index.ts"),
      "/Users/me/repo/src/index.ts",
    );
    assert.equal(joinWorkspacePath("C:\\repo", "src/index.ts"), "C:\\repo\\src\\index.ts");
  });

  it("returns the root when the relative path is empty", () => {
    assert.equal(joinWorkspacePath("/Users/me/repo", ""), "/Users/me/repo");
  });

  it("does not double up a trailing separator", () => {
    assert.equal(joinWorkspacePath("/Users/me/repo/", "src"), "/Users/me/repo/src");
  });
});

describe("basenameOfWorkspacePath", () => {
  it("returns the last segment", () => {
    assert.equal(basenameOfWorkspacePath("src/components/App.tsx"), "App.tsx");
    assert.equal(basenameOfWorkspacePath("README.md"), "README.md");
  });
});

describe("buildWorkspaceBreadcrumb", () => {
  it("puts the root label first", () => {
    assert.deepEqual(
      buildWorkspaceBreadcrumb({ rootLabel: "PeakCode", relativePath: "src/a.ts" }),
      ["PeakCode", "src", "a.ts"],
    );
  });
});

describe("describeWorkspaceRelativePath", () => {
  it("splits a nested path into name and parent", () => {
    assert.deepEqual(describeWorkspaceRelativePath("src/lib/util.ts"), {
      name: "util.ts",
      parentPath: "src/lib",
    });
  });

  it("reports an empty parent for a root-level file", () => {
    assert.deepEqual(describeWorkspaceRelativePath("README.md"), {
      name: "README.md",
      parentPath: "",
    });
  });
});

describe("resolveAncestorDirectoryPaths", () => {
  it("lists every directory on the way to the file", () => {
    assert.deepEqual(resolveAncestorDirectoryPaths("a/b/c/d.ts"), ["a", "a/b", "a/b/c"]);
  });

  it("returns nothing for a root-level file", () => {
    assert.deepEqual(resolveAncestorDirectoryPaths("d.ts"), []);
  });
});

describe("resolveDirectoriesToExpand", () => {
  it("returns every ancestor of a deep path when nothing is open", () => {
    assert.deepEqual(
      resolveDirectoriesToExpand({ relativePath: "a/b/c.ts", expandedPaths: new Set() }),
      ["a", "a/b"],
    );
  });

  it("skips ancestors the user already expanded", () => {
    assert.deepEqual(
      resolveDirectoriesToExpand({ relativePath: "a/b/c.ts", expandedPaths: new Set(["a"]) }),
      ["a/b"],
    );
  });

  it("returns nothing for a path that is already fully revealed", () => {
    assert.deepEqual(
      resolveDirectoriesToExpand({
        relativePath: "a/b/c.ts",
        expandedPaths: new Set(["a", "a/b"]),
      }),
      [],
    );
  });

  it("returns nothing for a root-level file", () => {
    assert.deepEqual(
      resolveDirectoriesToExpand({ relativePath: "README.md", expandedPaths: new Set() }),
      [],
    );
  });
});

describe("resolveChangedDirectorySet", () => {
  it("collects every ancestor directory of the changed paths", () => {
    const directories = resolveChangedDirectorySet(["src/lib/a.ts", "docs/b.md"]);
    assert.deepEqual([...directories].toSorted(), ["docs", "src", "src/lib"]);
  });
});

describe("resolveChangedStatusByPath", () => {
  it("keeps the first status reported for a path", () => {
    const statusByPath = resolveChangedStatusByPath([
      changed("src/a.ts", "modified"),
      changed("src/a.ts", "untracked"),
    ]);
    assert.equal(statusByPath.get("src/a.ts"), "modified");
  });
});

describe("isWorkspaceEntryChanged", () => {
  it("matches files by path and directories by descendant", () => {
    const decoration = buildChangedDecoration([changed("src/lib/a.ts", "modified")]);
    assert.isTrue(isWorkspaceEntryChanged(file("src/lib/a.ts", "a.ts"), decoration));
    assert.isTrue(isWorkspaceEntryChanged(dir("src", "src"), decoration));
    assert.isTrue(isWorkspaceEntryChanged(dir("src/lib", "lib"), decoration));
    assert.isFalse(isWorkspaceEntryChanged(dir("docs", "docs"), decoration));
    assert.isFalse(isWorkspaceEntryChanged(file("src/lib/b.ts", "b.ts"), decoration));
  });

  it("does not treat a shared name prefix as a descendant", () => {
    const decoration = buildChangedDecoration([changed("src/lib/a.ts", "modified")]);
    assert.isFalse(isWorkspaceEntryChanged(dir("src/l", "l"), decoration));
  });

  it("stays empty for a clean workspace", () => {
    const decoration = buildChangedDecoration([]);
    assert.isFalse(isWorkspaceEntryChanged(file("src/a.ts", "a.ts"), decoration));
    assert.equal(decoration.changedPaths.size, 0);
  });
});

describe("buildVisibleWorkspaceTreeRows", () => {
  const entriesByParent = {
    "": [dir("src", "src"), file("README.md", "README.md")],
    src: [file("src/index.ts", "index.ts"), dir("src/lib", "lib")],
    "src/lib": [file("src/lib/util.ts", "util.ts")],
  };

  it("returns only the root level while everything is collapsed", () => {
    const rows = buildVisibleWorkspaceTreeRows({ entriesByParent, expandedPaths: new Set() });
    assert.deepEqual(
      rows.map((row) => [row.entry.path, row.depth]),
      [
        ["src", 0],
        ["README.md", 0],
      ],
    );
  });

  it("descends one level per expanded directory", () => {
    const rows = buildVisibleWorkspaceTreeRows({
      entriesByParent,
      expandedPaths: new Set(["src"]),
    });
    assert.deepEqual(
      rows.map((row) => [row.entry.path, row.depth]),
      [
        ["src", 0],
        ["src/index.ts", 1],
        ["src/lib", 1],
        ["README.md", 0],
      ],
    );
  });

  it("nests deeper directories under their parent", () => {
    const rows = buildVisibleWorkspaceTreeRows({
      entriesByParent,
      expandedPaths: new Set(["src", "src/lib"]),
    });
    assert.deepEqual(
      rows.map((row) => row.entry.path),
      ["src", "src/index.ts", "src/lib", "src/lib/util.ts", "README.md"],
    );
  });

  it("ignores expanded paths that have no loaded children yet", () => {
    const rows = buildVisibleWorkspaceTreeRows({
      entriesByParent,
      expandedPaths: new Set(["src", "not-loaded"]),
    });
    assert.deepEqual(
      rows.map((row) => row.entry.path),
      ["src", "src/index.ts", "src/lib", "README.md"],
    );
  });
});

describe("filterEntriesByPathQuery", () => {
  const entries = [
    { path: "src/components/FileViewer.tsx" },
    { path: "src/lib/util.ts" },
    { path: "README.md" },
  ];

  it("matches on the basename or the full path, case-insensitively", () => {
    assert.deepEqual(
      filterEntriesByPathQuery(entries, "fileviewer").map((entry) => entry.path),
      ["src/components/FileViewer.tsx"],
    );
    assert.deepEqual(
      filterEntriesByPathQuery(entries, "SRC/LIB").map((entry) => entry.path),
      ["src/lib/util.ts"],
    );
  });

  it("returns every entry for a blank query", () => {
    assert.equal(filterEntriesByPathQuery(entries, "  ").length, 3);
  });

  it("returns nothing when there is no match", () => {
    assert.deepEqual(filterEntriesByPathQuery(entries, "nope"), []);
  });
});
