import { ThreadId } from "@peakcode/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MAX_OPEN_FILE_TABS,
  readThreadExplorerState,
  useFilesExplorerStore,
} from "./filesExplorerStore";

const THREAD_A = ThreadId.makeUnsafe("thread-a");
const THREAD_B = ThreadId.makeUnsafe("thread-b");

function explorerStateFor(threadId: ThreadId) {
  return readThreadExplorerState(useFilesExplorerStore.getState(), threadId);
}

describe("filesExplorerStore", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
    useFilesExplorerStore.setState({
      sidebarTarget: null,
      sidebarChangedOnly: false,
      stateByThreadId: {},
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("tracks which workspace the sidebar explorer is browsing", () => {
    useFilesExplorerStore.getState().openSidebar({ rootPath: "/repo", label: "repo" });
    expect(useFilesExplorerStore.getState().sidebarTarget).toEqual({
      rootPath: "/repo",
      label: "repo",
    });

    useFilesExplorerStore.getState().closeSidebar();
    expect(useFilesExplorerStore.getState().sidebarTarget).toBeNull();
  });

  it("replaces the target when a different workspace is opened", () => {
    useFilesExplorerStore.getState().openSidebar({ rootPath: "/repo", label: "repo" });
    useFilesExplorerStore.getState().openSidebar({ rootPath: "/other", label: "other" });
    expect(useFilesExplorerStore.getState().sidebarTarget).toEqual({
      rootPath: "/other",
      label: "other",
    });
  });

  it("opens a file as a new active tab", () => {
    const store = useFilesExplorerStore.getState();
    store.openFile(THREAD_A, "src/a.ts");
    store.openFile(THREAD_A, "src/b.ts");

    expect(explorerStateFor(THREAD_A)).toEqual({
      openFilePaths: ["src/a.ts", "src/b.ts"],
      activeFilePath: "src/b.ts",
    });
  });

  it("re-activating an open file keeps its tab position", () => {
    const store = useFilesExplorerStore.getState();
    store.openFile(THREAD_A, "src/a.ts");
    store.openFile(THREAD_A, "src/b.ts");
    useFilesExplorerStore.getState().setActiveFile(THREAD_A, "src/a.ts");

    expect(explorerStateFor(THREAD_A)).toEqual({
      openFilePaths: ["src/a.ts", "src/b.ts"],
      activeFilePath: "src/a.ts",
    });
  });

  it("closing the active tab activates the neighbouring tab", () => {
    const store = useFilesExplorerStore.getState();
    store.openFile(THREAD_A, "src/a.ts");
    store.openFile(THREAD_A, "src/b.ts");
    useFilesExplorerStore.getState().closeFile(THREAD_A, "src/b.ts");

    expect(explorerStateFor(THREAD_A)).toEqual({
      openFilePaths: ["src/a.ts"],
      activeFilePath: "src/a.ts",
    });
  });

  it("closing a background tab leaves the active file alone", () => {
    const store = useFilesExplorerStore.getState();
    store.openFile(THREAD_A, "src/a.ts");
    store.openFile(THREAD_A, "src/b.ts");
    useFilesExplorerStore.getState().closeFile(THREAD_A, "src/a.ts");

    expect(explorerStateFor(THREAD_A)).toEqual({
      openFilePaths: ["src/b.ts"],
      activeFilePath: "src/b.ts",
    });
  });

  it("closing the last tab clears the active file", () => {
    useFilesExplorerStore.getState().openFile(THREAD_A, "src/a.ts");
    useFilesExplorerStore.getState().closeFile(THREAD_A, "src/a.ts");

    expect(explorerStateFor(THREAD_A).activeFilePath).toBeNull();
    expect(explorerStateFor(THREAD_A).openFilePaths).toEqual([]);
  });

  it("caps open tabs and drops the oldest", () => {
    for (let index = 0; index <= MAX_OPEN_FILE_TABS; index += 1) {
      useFilesExplorerStore.getState().openFile(THREAD_A, `src/file-${index}.ts`);
    }

    const state = explorerStateFor(THREAD_A);
    expect(state.openFilePaths).toHaveLength(MAX_OPEN_FILE_TABS);
    expect(state.openFilePaths[0]).toBe("src/file-1.ts");
    expect(state.activeFilePath).toBe(`src/file-${MAX_OPEN_FILE_TABS}.ts`);
  });

  it("keeps tabs scoped to their thread", () => {
    const store = useFilesExplorerStore.getState();
    store.openFile(THREAD_A, "src/a.ts");
    store.openFile(THREAD_B, "src/b.ts");

    expect(explorerStateFor(THREAD_A).openFilePaths).toEqual(["src/a.ts"]);
    expect(explorerStateFor(THREAD_B).openFilePaths).toEqual(["src/b.ts"]);
  });

  it("returns a stable empty state for unknown threads", () => {
    expect(readThreadExplorerState(useFilesExplorerStore.getState(), null)).toEqual({
      openFilePaths: [],
      activeFilePath: null,
    });
    expect(readThreadExplorerState(useFilesExplorerStore.getState(), THREAD_B)).toBe(
      readThreadExplorerState(useFilesExplorerStore.getState(), THREAD_B),
    );
  });

  it("clearing a thread drops its tabs without closing the explorer", () => {
    useFilesExplorerStore.getState().openSidebar({ rootPath: "/repo", label: "repo" });
    useFilesExplorerStore.getState().openFile(THREAD_A, "src/a.ts");

    useFilesExplorerStore.getState().clearThreadExplorer(THREAD_A);

    // The sidebar browses a workspace, not a chat, so deleting a chat keeps it open.
    expect(useFilesExplorerStore.getState().sidebarTarget).not.toBeNull();
    expect(useFilesExplorerStore.getState().stateByThreadId[THREAD_A]).toBeUndefined();
  });

  it("toggles the changed-only filter", () => {
    expect(useFilesExplorerStore.getState().sidebarChangedOnly).toBe(false);
    useFilesExplorerStore.getState().setSidebarChangedOnly(true);
    expect(useFilesExplorerStore.getState().sidebarChangedOnly).toBe(true);
  });
});
