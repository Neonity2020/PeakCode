import { describe, expect, it } from "vitest";

import type { OrchestrationShellStreamItem } from "@peakcode/contracts";

import { applyShellStreamItem } from "./useDeviceSnapshot";

const project = (id: string, title: string) => ({ id, title }) as never;
const thread = (id: string, title: string) => ({ id, title }) as never;

describe("applyShellStreamItem", () => {
  it("replaces everything on the opening snapshot", () => {
    expect(
      applyShellStreamItem({ projects: [project("p1", "old")], threads: [thread("t1", "old")] }, {
        kind: "snapshot",
        snapshot: {
          snapshotSequence: 1,
          updatedAt: "2026-09-17T15:00:00.000Z",
          projects: [project("p2", "new")],
          threads: [thread("t2", "new")],
        },
      } as OrchestrationShellStreamItem),
    ).toEqual({ projects: [project("p2", "new")], threads: [thread("t2", "new")] });
  });

  it("adds and updates one task at a time", () => {
    const added = applyShellStreamItem({ projects: [], threads: [thread("t1", "first")] }, {
      kind: "thread-upserted",
      sequence: 2,
      thread: thread("t2", "second"),
    } as never);
    expect(added.threads.map((entry) => (entry as { id: string }).id)).toEqual(["t1", "t2"]);

    const updated = applyShellStreamItem(added, {
      kind: "thread-upserted",
      sequence: 3,
      thread: thread("t1", "renamed"),
    } as never);
    expect(updated.threads).toEqual([thread("t1", "renamed"), thread("t2", "second")]);
  });

  it("removes tasks and workspaces that are gone", () => {
    const removed = applyShellStreamItem(
      { projects: [project("p1", "one")], threads: [thread("t1", "one"), thread("t2", "two")] },
      { kind: "thread-removed", sequence: 4, threadId: "t1" } as never,
    );
    expect(removed.threads).toEqual([thread("t2", "two")]);

    const withoutProject = applyShellStreamItem(removed, {
      kind: "project-removed",
      sequence: 5,
      projectId: "p1",
    } as never);
    expect(withoutProject.projects).toEqual([]);
  });
});
