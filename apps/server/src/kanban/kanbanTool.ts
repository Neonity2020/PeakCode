/**
 * The bridge between a board-dispatched run and its card.
 *
 * A task sent to an agent from 进行中 becomes a normal conversation in that project. The
 * card, however, is what the user watches: conversation text never reaches it, so a run that
 * only talks in its thread looks like it did nothing until the final outcome lands. The
 * toolkit declares `kanban_comment` (write) and `kanban_task` (read); this module is the host
 * that implements both against the card **the thread was dispatched from**.
 *
 * The read side exists because the card is the project's memory: the requirement, what
 * earlier runs decided and did, and what the user pushed back on all live in its description
 * and comments, not in the fresh conversation a later run starts with. Reading it is how a
 * second pass starts informed instead of starting over.
 *
 * The card is resolved from the thread id, never from tool arguments: the model cannot point
 * a comment at a card that is not its own, and it does not have to know any board ids.
 *
 * Installed once at server startup, the way the toolkit store and the automation host are —
 * that keeps the provider layer free of a kanban dependency: `PiAdapter` only asks for the
 * tools' callbacks, never for the service behind them.
 */
import { Effect } from "effect";

import {
  errorResult,
  textResult,
  type KanbanCommentToolParams,
  type ToolOutcome,
} from "@peakcode/agent-toolkit/agent-tools";
import type { ThreadId } from "@peakcode/contracts";

import { kanbanThreadTaskText } from "./boardDocument.ts";
import { KanbanService } from "./Services/KanbanService.ts";

export interface KanbanToolHost {
  /** Record one `kanban_comment` call for the thread it was made in. */
  readonly commentOnTask: (input: {
    readonly threadId: ThreadId;
    readonly params: KanbanCommentToolParams;
  }) => Promise<ToolOutcome>;
  /** Read the card this conversation was dispatched from, with its whole timeline. */
  readonly readTask: (input: { readonly threadId: ThreadId }) => Promise<ToolOutcome>;
}

let installedHost: KanbanToolHost | null = null;

/** Install the host the tool callback resolves against. Called once per server start. */
export function setKanbanToolHost(host: KanbanToolHost | null): void {
  installedHost = host;
}

/**
 * Comment on the card of the conversation the call was made in.
 *
 * Wired as the toolkit's `onKanbanComment` callback. Without an installed host (a session in
 * a test, or outside the server program) the model is told, rather than left guessing why the
 * comment vanished.
 */
export function commentOnTaskFromConversation(input: {
  readonly threadId: ThreadId;
  readonly params: KanbanCommentToolParams;
}): Promise<ToolOutcome> {
  if (installedHost === null) {
    return Promise.resolve(errorResult("Board comments are not available in this session."));
  }
  return installedHost.commentOnTask(input);
}

/** Read the card the conversation was dispatched from. See {@link commentOnTaskFromConversation}. */
export function taskFromConversation(input: { readonly threadId: ThreadId }): Promise<ToolOutcome> {
  if (installedHost === null) {
    return Promise.resolve(errorResult("The board is not available in this session."));
  }
  return installedHost.readTask(input);
}

export const makeKanbanToolHost = Effect.gen(function* () {
  const kanbanService = yield* KanbanService;

  return {
    commentOnTask: ({ threadId, params }) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const body = params.body?.trim() ?? "";
          if (body.length === 0) return errorResult("A board comment needs a `body`.");

          const written = yield* kanbanService.recordTaskRunComment({ threadId, body });
          // A chat that never came from the board can call the tool (it is registered in
          // every session). Say so plainly: reporting success would leave the model
          // believing a card was updated.
          if (!written) {
            return textResult(
              "This conversation is not a running board task, so nothing was written to a board. " +
                "Continue normally; there is no card to report to.",
            );
          }
          return textResult(`Recorded on the board card: ${body}`);
        }).pipe(
          Effect.catch((cause) =>
            Effect.succeed(errorResult(cause instanceof Error ? cause.message : String(cause))),
          ),
        ),
      ),

    readTask: ({ threadId }) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const record = yield* kanbanService.readTaskForThread({ threadId });
          if (record === null) {
            return textResult(
              "This conversation was not dispatched from a board card, so there is no card to " +
                "read. Continue normally, or ask the user for the context you need.",
            );
          }
          return textResult(kanbanThreadTaskText(record));
        }).pipe(
          Effect.catch((cause) =>
            Effect.succeed(errorResult(cause instanceof Error ? cause.message : String(cause))),
          ),
        ),
      ),
  } satisfies KanbanToolHost;
});
