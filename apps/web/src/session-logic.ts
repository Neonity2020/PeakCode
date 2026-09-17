// FILE: session-logic.ts
// Purpose: Index of the session derivation helpers, split by concern.
// Exports: Session work-log, pending-request, plan, collab, command and timing derivations.

// The derivations below live in sibling modules; this file keeps the historical
// import path for consumers.

export { PROVIDER_OPTIONS, WORK_LOG_PRESENTATION_VERSION } from "./session-logic.types";
export type {
  ActiveBackgroundTasksState,
  ActiveTaskListState,
  CommandAction,
  CommandActionDisplay,
  DerivedWorkLogEntry,
  LatestProposedPlanState,
  PendingApproval,
  PendingUserInput,
  ProviderPickerKind,
  TimelineEntry,
  WorkLogEntry,
  WorkLogSubagent,
  WorkLogSubagentAction,
} from "./session-logic.types";
export {
  deriveActiveWorkStartedAt,
  formatDuration,
  formatElapsed,
  hasLiveLatestTurn,
  hasLiveTurnTailWork,
  isLatestTurnSettled,
} from "./session-timing.logic";
export type { LatestTurnTiming, SessionActivityState } from "./session-timing.logic";
export {
  deriveActiveBackgroundTasksState,
  deriveActiveTaskListState,
  derivePendingApprovals,
  derivePendingUserInputs,
  isStalePendingRequestFailureDetail,
  parseUserInputQuestions,
  requestKindFromRequestType,
  toActiveTaskListState,
} from "./session-pending.logic";
export {
  findLatestProposedPlan,
  findSidebarProposedPlan,
  hasActionableProposedPlan,
  isCollabAgentToolActivity,
  toLatestProposedPlanState,
} from "./session-plan.logic";
export {
  areToolLifecycleChangedFilesCompatible,
  areToolLifecycleCommandsCompatible,
  collapseDerivedWorkLogEntries,
  deriveToolLifecycleCollapseCommand,
  deriveToolLifecycleCollapseKey,
  deriveWorkLogEntries,
  isPlanBoundaryToolActivity,
  isRenderableToolLifecycleActivity,
  isUninformativeCommandStartActivity,
  mergeChangedFiles,
  mergeDerivedWorkLogEntries,
  shouldCollapseToolLifecycleEntries,
  summarizeToolPayloadOutput,
  toDerivedWorkLogEntry,
} from "./session-work-logic";
export {
  asCommandArgumentRecord,
  asRecord,
  asTrimmedString,
  collabPayloadItem,
  extractCollabAction,
  extractCollabSubagents,
  inferSubagentActionTool,
  isCommandLikeDetail,
  normalizeCollabIdentifier,
  normalizeCommandValue,
  summarizeSubagentAction,
} from "./session-collab.logic";
export {
  collectChangedFiles,
  collectCommandActions,
  commandActionListPreview,
  commandActionSearchPreview,
  commandActionTarget,
  compactWorkLogPath,
  compareActivitiesByOrder,
  compareActivityLifecycleRank,
  deriveCommandActionDisplay,
  derivePhase,
  deriveTimelineEntries,
  extractChangedFiles,
  extractDetailCollapseHint,
  extractPrimaryCommandAction,
  extractToolCallId,
  extractToolCommand,
  extractToolName,
  extractToolTitle,
  extractWorkLogItemType,
  extractWorkLogRequestKind,
  hasToolActivityForTurn,
  inferCheckpointTurnCountByTurnId,
  isLikelyFilePath,
  makeCommandActionDisplay,
  normalizeCommandActionType,
  pushChangedFile,
  stripTrailingExitCode,
} from "./session-command.logic";
