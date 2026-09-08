import {
  CommandId,
  type OrchestrationImportThreadInput,
  type ThreadHandoffImportedMessage,
  type ThreadId,
} from "@peakcode/contracts";
import type { FileSystem, Path } from "effect";
import { Data, Effect, Option } from "effect";

import { resolveThreadWorkspaceCwd } from "../checkpointing/Utils";
import type { OrchestrationEngineShape } from "./Services/OrchestrationEngine";
import type { ProjectionSnapshotQueryShape } from "./Services/ProjectionSnapshotQuery";
import type { ProviderAdapterRegistryShape } from "../provider/Services/ProviderAdapterRegistry";
import type { ProviderServiceShape } from "../provider/Services/ProviderService";
import { mapSnapshotMessages } from "./importedThreadMessages";

type ImportThreadRequest = OrchestrationImportThreadInput;

class ImportThreadError extends Data.TaggedError("ImportThreadError")<{
  readonly message: string;
}> {}

function importMessagesError(message: string): ImportThreadError {
  return new ImportThreadError({ message });
}

function mapProviderSessionStatusToOrchestrationStatus(
  status: "connecting" | "ready" | "running" | "error" | "closed",
): "starting" | "ready" | "running" | "error" | "stopped" {
  switch (status) {
    case "connecting":
      return "starting";
    case "running":
      return "running";
    case "error":
      return "error";
    case "closed":
      return "stopped";
    case "ready":
    default:
      return "ready";
  }
}

export interface ImportThreadHandlerOptions {
  readonly fileSystem: FileSystem.FileSystem;
  readonly orchestrationEngine: OrchestrationEngineShape;
  readonly path: Path.Path;
  readonly platform: NodeJS.Platform;
  readonly projectionSnapshotQuery: ProjectionSnapshotQueryShape;
  readonly providerAdapterRegistry: ProviderAdapterRegistryShape;
  readonly providerService: ProviderServiceShape;
}

export function makeImportThreadHandler(options: ImportThreadHandlerOptions) {
  const dispatchImportedMessages = (input: {
    readonly createdAt: string;
    readonly messages: ReadonlyArray<ThreadHandoffImportedMessage>;
    readonly threadId: ThreadId;
  }) =>
    input.messages.length === 0
      ? Effect.void
      : options.orchestrationEngine.dispatch({
          type: "thread.messages.import",
          commandId: CommandId.makeUnsafe(crypto.randomUUID()),
          threadId: input.threadId,
          messages: input.messages,
          createdAt: input.createdAt,
        });

  const importPiThreadHistory = Effect.fn(function* (input: {
    readonly importedAt: string;
    readonly threadId: ThreadId;
  }) {
    const adapter = yield* options.providerAdapterRegistry.getByProvider("pi");
    const snapshot = yield* adapter
      .readThread(input.threadId)
      .pipe(
        Effect.mapError((cause) =>
          importMessagesError(
            cause instanceof Error && cause.message.length > 0
              ? cause.message
              : "Failed to read Pi thread history.",
          ),
        ),
      );

    yield* dispatchImportedMessages({
      threadId: input.threadId,
      messages: mapSnapshotMessages({
        threadId: input.threadId,
        turns: snapshot.turns,
        importedAt: input.importedAt,
      }),
      createdAt: input.importedAt,
    });
  });

  return Effect.fnUntraced(function* (body: ImportThreadRequest) {
    const threadOption = yield* options.projectionSnapshotQuery.getThreadDetailById(body.threadId);
    if (Option.isNone(threadOption)) {
      return yield* Effect.fail(importMessagesError(`Thread '${body.threadId}' was not found.`));
    }
    const thread = threadOption.value;

    if (thread.session && thread.session.status !== "stopped") {
      return yield* Effect.fail(
        importMessagesError(`Thread '${body.threadId}' already has an active provider session.`),
      );
    }

    const projectOption = yield* options.projectionSnapshotQuery.getProjectShellById(
      thread.projectId,
    );
    const project = Option.getOrNull(projectOption);
    const cwd = resolveThreadWorkspaceCwd({
      thread,
      projects: project
        ? [
            {
              id: project.id,
              workspaceRoot: project.workspaceRoot,
            },
          ]
        : [],
    });
    const externalId = body.externalId.trim();

    // Pi resumes an imported thread from its persisted session file. No
    // external thread-context bootstrap applies (that was Codex/OpenCode/Kilo).

    const session = yield* options.providerService.startSession(thread.id, {
      threadId: thread.id,
      provider: thread.modelSelection.provider,
      ...(cwd ? { cwd } : {}),
      modelSelection: thread.modelSelection,
      resumeCursor: externalId,
      runtimeMode: thread.runtimeMode,
    });

    yield* importPiThreadHistory({
      threadId: thread.id,
      importedAt: session.updatedAt,
    });

    yield* options.orchestrationEngine.dispatch({
      type: "thread.session.set",
      commandId: CommandId.makeUnsafe(crypto.randomUUID()),
      threadId: thread.id,
      session: {
        threadId: thread.id,
        status: mapProviderSessionStatusToOrchestrationStatus(session.status),
        providerName: session.provider,
        runtimeMode: thread.runtimeMode,
        activeTurnId: null,
        lastError: session.lastError ?? null,
        updatedAt: session.updatedAt,
      },
      createdAt: session.updatedAt,
    });

    return { threadId: thread.id };
  });
}
