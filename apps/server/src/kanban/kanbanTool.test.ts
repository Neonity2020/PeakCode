/**
 * The agent's `kanban_comment` bridge.
 *
 * The behaviour worth pinning down is not "a comment is appended" (the service test covers
 * that) but what the *model* is told back: a conversation that is not a board task has to
 * hear "nothing was written", because a silent success is how a run ends up believing it
 * reported progress that never landed.
 */
import { Effect, Layer, Option } from "effect";
import { describe, expect, test } from "vitest";

import { ProjectId, ThreadId } from "@peakcode/contracts";

import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import {
  KanbanService,
  type KanbanServiceShape,
  type KanbanTaskRunCommentInput,
} from "./Services/KanbanService.ts";
import {
  commentOnTaskFromConversation,
  makeKanbanToolHost,
  setKanbanToolHost,
} from "./kanbanTool.ts";

const THREAD_ID = ThreadId.makeUnsafe("thread_board_run");
const PROJECT_ID = ProjectId.makeUnsafe("project_board");

const textOf = (outcome: { content: { text: string }[] }) => outcome.content[0]!.text;

interface StubState {
  readonly calls: Array<{ threadId: string; body: string }>;
  /** What the service reports back: false = no running task owns this thread. */
  written: boolean;
  /** When set, the service fails with this message. */
  failure: string | null;
}

const makeHost = async (state: StubState) => {
  const kanban = KanbanService.of({
    recordTaskRunComment: (input: KanbanTaskRunCommentInput) => {
      state.calls.push({ threadId: input.threadId, body: input.body.trim() });
      if (state.failure !== null) return Effect.fail(new Error(state.failure));
      return Effect.succeed(state.written);
    },
  } as unknown as KanbanServiceShape);

  const projection = ProjectionSnapshotQuery.of({
    getCommandReadModel: () => Effect.die("not used"),
    getSnapshot: () => Effect.die("not used"),
    getCounts: () => Effect.die("not used"),
    getSnapshotSequence: () => Effect.die("not used"),
    getShellSnapshot: () => Effect.die("not used"),
    getActiveProjectByWorkspaceRoot: () => Effect.succeed(Option.none()),
    getProjectShellById: () => Effect.succeed(Option.none()),
    getFirstActiveThreadIdByProjectId: () => Effect.succeed(Option.none()),
    getThreadCheckpointContext: () => Effect.succeed(Option.none()),
    getFullThreadDiffContext: () => Effect.succeed(Option.none()),
    getThreadShellById: () => Effect.succeed(Option.none()),
    findSyntheticSubagentParentThread: () => Effect.succeed(Option.none()),
    getThreadDetailById: () => Effect.succeed(Option.none()),
    getThreadDetailSnapshotById: () => Effect.succeed(Option.none()),
  });

  return Effect.runPromise(
    makeKanbanToolHost.pipe(
      Effect.provide(
        Layer.merge(
          Layer.succeed(KanbanService, kanban),
          Layer.succeed(ProjectionSnapshotQuery, projection),
        ),
      ),
    ),
  );
};

const emptyState = (): StubState => ({ calls: [], written: true, failure: null });

describe("the kanban_comment host", () => {
  test("hands the step note to the service for this thread and confirms it landed", async () => {
    const state = emptyState();
    const host = await makeHost(state);

    const outcome = await host.commentOnTask({
      threadId: THREAD_ID,
      params: { body: "  验证：bun run test 全绿  " },
    });

    expect(state.calls).toEqual([{ threadId: THREAD_ID, body: "验证：bun run test 全绿" }]);
    expect(textOf(outcome)).toContain("Recorded on the board card");
  });

  test("tells the model when no card owns the conversation", async () => {
    const state = { ...emptyState(), written: false };
    const host = await makeHost(state);

    const outcome = await host.commentOnTask({ threadId: THREAD_ID, params: { body: "进展" } });

    // Reporting success here would be a lie the model then repeats to the user.
    expect(textOf(outcome)).toContain("not a running board task");
    expect(textOf(outcome)).not.toContain("Recorded");
  });

  test("surfaces a service failure as a tool error the model can read", async () => {
    const state = { ...emptyState(), failure: "看板文件写不进去" };
    const host = await makeHost(state);

    const outcome = await host.commentOnTask({ threadId: THREAD_ID, params: { body: "进展" } });
    expect(textOf(outcome)).toContain("看板文件写不进去");
  });

  test("refuses an empty body before touching the board", async () => {
    const state = emptyState();
    const host = await makeHost(state);

    const outcome = await host.commentOnTask({ threadId: THREAD_ID, params: { body: "   " } });
    expect(state.calls).toHaveLength(0);
    expect(textOf(outcome)).toContain("body");
  });

  test("says so when no host is installed (a session outside the server program)", async () => {
    setKanbanToolHost(null);
    try {
      const outcome = await commentOnTaskFromConversation({
        threadId: THREAD_ID,
        params: { body: "进展" },
      });
      expect(textOf(outcome)).toContain("not available");
    } finally {
      setKanbanToolHost(null);
    }
  });
});
