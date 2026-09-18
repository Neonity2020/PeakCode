/**
 * The agent's board bridge: `kanban_comment` (write) and `kanban_task` (read).
 *
 * The behaviour worth pinning down is not "a comment is appended" (the service test covers
 * that) but what the *model* is told back: a conversation that is not a board task has to
 * hear "nothing was written" / "there is no card to read", because a silent success is how a
 * run ends up believing it reported progress — or read context — that never existed.
 */
import { Effect, Layer, Option } from "effect";
import { describe, expect, test } from "vitest";

import { ProjectId, ThreadId } from "@peakcode/contracts";

import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import type { KanbanThreadTaskRecord } from "./boardDocument.ts";
import {
  KanbanService,
  type KanbanServiceShape,
  type KanbanTaskRunCommentInput,
} from "./Services/KanbanService.ts";
import {
  commentOnTaskFromConversation,
  makeKanbanToolHost,
  setKanbanToolHost,
  taskFromConversation,
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
  /** What `readTaskForThread` returns; null = this conversation has no card. */
  record: KanbanThreadTaskRecord | null;
}

const makeHost = async (state: StubState) => {
  const kanban = KanbanService.of({
    recordTaskRunComment: (input: KanbanTaskRunCommentInput) => {
      state.calls.push({ threadId: input.threadId, body: input.body.trim() });
      if (state.failure !== null) return Effect.fail(new Error(state.failure));
      return Effect.succeed(state.written);
    },
    readTaskForThread: () => {
      if (state.failure !== null) return Effect.fail(new Error(state.failure));
      return Effect.succeed(state.record);
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

const emptyState = (): StubState => ({
  calls: [],
  written: true,
  failure: null,
  record: null,
});

/** A card with one user note and one note from a previous run. */
const cardRecord = (): KanbanThreadTaskRecord =>
  ({
    context: {
      projectId: PROJECT_ID,
      projectTitle: "PeakCode",
      workspaceRoot: "/tmp/peakcode",
      boardFilePath: "/tmp/peakcode/.kanban/board.json",
    },
    task: {
      id: "t_29b8116000",
      title: "接上多端同步",
      description: "先把离线队列做出来。",
      status: "in_progress",
      priority: "high",
      pipeline: "",
      assignee: "",
      agentProvider: "pi",
      agentModel: "",
      agentThreadId: THREAD_ID,
      agentRunStatus: "running",
      attachments: [],
      comments: [],
      createdAt: "2026-09-16T04:36:38Z",
      updatedAt: "2026-09-17T01:08:08Z",
    },
    comments: [
      {
        commentId: "c_1",
        author: "agent",
        kind: "note",
        body: "第一版只做了本地队列。",
        createdAt: "2026-09-16T05:00:00Z",
      },
      {
        commentId: "c_2",
        author: "user",
        kind: "note",
        body: "两台设备同时改会互相覆盖，先解决这个。",
        createdAt: "2026-09-17T01:00:00Z",
      },
    ],
  }) as unknown as KanbanThreadTaskRecord;

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

describe("the kanban_task host", () => {
  test("reads the card back with its requirement, history and board path", async () => {
    const state = { ...emptyState(), record: cardRecord() };
    const host = await makeHost(state);

    const text = textOf(await host.readTask({ threadId: THREAD_ID }));

    // The requirement as written, not a paraphrase of it.
    expect(text).toContain("先把离线队列做出来。");
    // Both sides of the history: what a previous run did, and what the user pushed back on.
    expect(text).toContain("第一版只做了本地队列。");
    expect(text).toContain("两台设备同时改会互相覆盖");
    // Named so the model can go past the summary to the raw file and its git history.
    expect(text).toContain("/tmp/peakcode/.kanban/board.json");
  });

  test("tells the model when the conversation has no card", async () => {
    const state = emptyState();
    const host = await makeHost(state);

    const text = textOf(await host.readTask({ threadId: THREAD_ID }));

    // An empty card would read as "this task has no history", which is a different claim.
    expect(text).toContain("not dispatched from a board card");
    expect(text).not.toContain("## 历史");
  });

  test("surfaces a service failure as a tool error the model can read", async () => {
    const state = { ...emptyState(), failure: "看板文件读不出来" };
    const host = await makeHost(state);

    expect(textOf(await host.readTask({ threadId: THREAD_ID }))).toContain("看板文件读不出来");
  });

  test("says so when no host is installed (a session outside the server program)", async () => {
    setKanbanToolHost(null);
    try {
      const text = textOf(await taskFromConversation({ threadId: THREAD_ID }));
      expect(text).toContain("not available");
    } finally {
      setKanbanToolHost(null);
    }
  });
});
