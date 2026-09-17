/**
 * ProjectionSnapshotRows - Row schemas, decoded row types and row decoders for projection snapshot reads.
 *
 * @module ProjectionSnapshotRows
 */
import {
  ChatAttachment,
  CheckpointRef,
  IsoDateTime,
  MessageId,
  NonNegativeInt,
  OrchestrationCheckpointFile,
  OrchestrationProposedPlanId,
  OrchestrationReadModel,
  OrchestrationShellSnapshot,
  OrchestrationThreadDetailSnapshot,
  OrchestrationThreadPullRequest,
  ProjectScript,
  ProjectId,
  ProviderMentionReference,
  ProviderSkillReference,
  ThreadId,
  ThreadEnvironmentMode,
  TurnDispatchMode,
  TurnId,
  OrchestrationThread,
  ThreadHandoff,
  ModelSelection,
} from "@peakcode/contracts";
import { Effect, Option, Schema, Struct } from "effect";

import { toPersistenceDecodeError, type ProjectionRepositoryError } from "../persistence/Errors.ts";
import { normalizePersistedModelSelection } from "../persistence/modelSelectionCompatibility.ts";
import { ProjectionCheckpoint } from "../persistence/Services/ProjectionCheckpoints.ts";
import { ProjectionProject } from "../persistence/Services/ProjectionProjects.ts";
import { ProjectionState } from "../persistence/Services/ProjectionState.ts";
import { ProjectionThreadActivity } from "../persistence/Services/ProjectionThreadActivities.ts";
import { ProjectionThreadMessage } from "../persistence/Services/ProjectionThreadMessages.ts";
import { ProjectionThreadProposedPlan } from "../persistence/Services/ProjectionThreadProposedPlans.ts";
import { ProjectionThreadSession } from "../persistence/Services/ProjectionThreadSessions.ts";
import { ProjectionThread } from "../persistence/Services/ProjectionThreads.ts";

export const decodeReadModel = Schema.decodeUnknownEffect(OrchestrationReadModel);
export const decodeShellSnapshot = Schema.decodeUnknownEffect(OrchestrationShellSnapshot);
export const decodeThreadDetail = Schema.decodeUnknownEffect(OrchestrationThread);
export const decodeThreadDetailSnapshot = Schema.decodeUnknownEffect(
  OrchestrationThreadDetailSnapshot,
);
export const decodeModelSelection = Schema.decodeUnknownEffect(ModelSelection);
export const ModelSelectionJsonUnknown = Schema.fromJsonString(Schema.Unknown);
export const MAX_THREAD_MESSAGES = 2_000;
export const MAX_THREAD_ACTIVITIES = 500;
export const ProjectionProjectDbRowSchema = ProjectionProject.mapFields(
  Struct.assign({
    defaultModelSelection: Schema.NullOr(ModelSelectionJsonUnknown),
    scripts: Schema.fromJsonString(Schema.Array(ProjectScript)),
  }),
);
export const ProjectionThreadMessageDbRowSchema = ProjectionThreadMessage.mapFields(
  Struct.assign({
    isStreaming: Schema.Number,
    attachments: Schema.NullOr(Schema.fromJsonString(Schema.Array(ChatAttachment))),
    skills: Schema.NullOr(Schema.fromJsonString(Schema.Array(ProviderSkillReference))),
    mentions: Schema.NullOr(Schema.fromJsonString(Schema.Array(ProviderMentionReference))),
    dispatchMode: Schema.NullOr(TurnDispatchMode),
  }),
);
export const ProjectionThreadProposedPlanDbRowSchema = ProjectionThreadProposedPlan;
export const ProjectionThreadDbRowSchema = ProjectionThread.mapFields(
  Struct.assign({
    createBranchFlowCompleted: Schema.Number,
    isPinned: Schema.Number,
    handoff: Schema.NullOr(Schema.fromJsonString(ThreadHandoff)),
    lastKnownPr: Schema.NullOr(Schema.fromJsonString(OrchestrationThreadPullRequest)),
    modelSelection: ModelSelectionJsonUnknown,
  }),
);
export const ProjectionThreadActivityDbRowSchema = ProjectionThreadActivity.mapFields(
  Struct.assign({
    payload: Schema.fromJsonString(Schema.Unknown),
    sequence: Schema.NullOr(NonNegativeInt),
  }),
);
export const ProjectionThreadSessionDbRowSchema = ProjectionThreadSession;
export const ProjectionCheckpointDbRowSchema = ProjectionCheckpoint.mapFields(
  Struct.assign({
    files: Schema.fromJsonString(Schema.Array(OrchestrationCheckpointFile)),
  }),
);
export const ProjectionLatestTurnDbRowSchema = Schema.Struct({
  threadId: ProjectionThread.fields.threadId,
  turnId: TurnId,
  state: Schema.String,
  requestedAt: IsoDateTime,
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
  assistantMessageId: Schema.NullOr(MessageId),
  sourceProposedPlanThreadId: Schema.NullOr(ThreadId),
  sourceProposedPlanId: Schema.NullOr(OrchestrationProposedPlanId),
});
export const ProjectionStateDbRowSchema = ProjectionState;
export const ProjectionCountsRowSchema = Schema.Struct({
  projectCount: Schema.Number,
  threadCount: Schema.Number,
});
export const WorkspaceRootLookupInput = Schema.Struct({
  workspaceRoot: Schema.String,
});
export const ProjectIdLookupInput = Schema.Struct({
  projectId: ProjectId,
});
export const ThreadIdLookupInput = Schema.Struct({
  threadId: ThreadId,
});
export const SyntheticSubagentParentLookupInput = Schema.Struct({
  threadId: ThreadId,
});
export const FullThreadDiffContextLookupInput = Schema.Struct({
  threadId: ThreadId,
  checkpointTurnCount: NonNegativeInt,
});
export const ProjectionProjectLookupRowSchema = ProjectionProjectDbRowSchema;
export const ProjectionThreadIdLookupRowSchema = Schema.Struct({
  threadId: ThreadId,
});
export const ProjectionThreadCheckpointContextThreadRowSchema = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  workspaceRoot: Schema.String,
  envMode: ThreadEnvironmentMode,
  worktreePath: Schema.NullOr(Schema.String),
});
export const ProjectionFullThreadDiffContextRowSchema = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  workspaceRoot: Schema.String,
  envMode: ThreadEnvironmentMode,
  worktreePath: Schema.NullOr(Schema.String),
  latestCheckpointTurnCount: Schema.NullOr(NonNegativeInt),
  toCheckpointRef: Schema.NullOr(CheckpointRef),
});

export type ProjectionThreadDbRowRaw = Schema.Schema.Type<typeof ProjectionThreadDbRowSchema>;
export type ProjectionProjectDbRowRaw = Schema.Schema.Type<typeof ProjectionProjectDbRowSchema>;
export type ProjectionThreadDbRow = Omit<ProjectionThreadDbRowRaw, "modelSelection"> & {
  readonly modelSelection: typeof ModelSelection.Type;
};
export type ProjectionProjectDbRow = Omit<ProjectionProjectDbRowRaw, "defaultModelSelection"> & {
  readonly defaultModelSelection: typeof ModelSelection.Type | null;
};
export type ProjectionThreadMessageDbRow = Schema.Schema.Type<
  typeof ProjectionThreadMessageDbRowSchema
>;
export type ProjectionThreadProposedPlanDbRow = Schema.Schema.Type<
  typeof ProjectionThreadProposedPlanDbRowSchema
>;
export type ProjectionThreadActivityDbRow = Schema.Schema.Type<
  typeof ProjectionThreadActivityDbRowSchema
>;
export type ProjectionCheckpointDbRow = Schema.Schema.Type<typeof ProjectionCheckpointDbRowSchema>;
export type ProjectionLatestTurnDbRow = Schema.Schema.Type<typeof ProjectionLatestTurnDbRowSchema>;
export type ProjectionThreadSessionDbRow = Schema.Schema.Type<
  typeof ProjectionThreadSessionDbRowSchema
>;

export function decodeProjectionProjectRow(
  row: ProjectionProjectDbRowRaw,
): Effect.Effect<ProjectionProjectDbRow, Schema.SchemaError> {
  if (row.defaultModelSelection === null) {
    return Effect.succeed({ ...row, defaultModelSelection: null });
  }
  return decodeModelSelection(normalizePersistedModelSelection(row.defaultModelSelection)).pipe(
    Effect.map((defaultModelSelection) => ({ ...row, defaultModelSelection })),
  );
}

export function decodeProjectionThreadRow(
  row: ProjectionThreadDbRowRaw,
): Effect.Effect<ProjectionThreadDbRow, Schema.SchemaError> {
  return decodeModelSelection(normalizePersistedModelSelection(row.modelSelection)).pipe(
    Effect.map((modelSelection) => ({ ...row, modelSelection })),
  );
}

export function decodeProjectionProjectRows(
  rows: ReadonlyArray<ProjectionProjectDbRowRaw>,
  operation: string,
): Effect.Effect<ReadonlyArray<ProjectionProjectDbRow>, ProjectionRepositoryError> {
  return Effect.forEach(rows, decodeProjectionProjectRow).pipe(
    Effect.mapError(toPersistenceDecodeError(operation)),
  );
}

export function decodeProjectionThreadRows(
  rows: ReadonlyArray<ProjectionThreadDbRowRaw>,
  operation: string,
): Effect.Effect<ReadonlyArray<ProjectionThreadDbRow>, ProjectionRepositoryError> {
  return Effect.forEach(rows, decodeProjectionThreadRow).pipe(
    Effect.mapError(toPersistenceDecodeError(operation)),
  );
}

export function decodeProjectionProjectOption(
  option: Option.Option<ProjectionProjectDbRowRaw>,
  operation: string,
): Effect.Effect<Option.Option<ProjectionProjectDbRow>, ProjectionRepositoryError> {
  if (Option.isNone(option)) {
    return Effect.succeed(Option.none());
  }
  return decodeProjectionProjectRow(option.value).pipe(
    Effect.map(Option.some),
    Effect.mapError(toPersistenceDecodeError(operation)),
  );
}

export function decodeProjectionThreadOption(
  option: Option.Option<ProjectionThreadDbRowRaw>,
  operation: string,
): Effect.Effect<Option.Option<ProjectionThreadDbRow>, ProjectionRepositoryError> {
  if (Option.isNone(option)) {
    return Effect.succeed(Option.none());
  }
  return decodeProjectionThreadRow(option.value).pipe(
    Effect.map(Option.some),
    Effect.mapError(toPersistenceDecodeError(operation)),
  );
}
