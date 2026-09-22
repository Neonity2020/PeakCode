import { Schema } from "effect";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import {
  AgentApprovalModeSetInput,
  AgentApprovalModeSetResult,
  AgentRuntimeGetInput,
  AgentRuntimeGetResult,
} from "./agentRuntime";
import {
  AgentGoalGetInput,
  AgentGoalGetResult,
  AgentGoalSetStatusInput,
  AgentGoalSetStatusResult,
} from "./agentGoal";
import { OpenInEditorInput } from "./editor";
import { FilesystemBrowseInput, FilesystemBrowseResult } from "./filesystem";
import {
  GitCheckoutInput,
  GitActionProgressEvent,
  GitCreateBranchInput,
  GitCreateDetachedWorktreeInput,
  GitCreateDetachedWorktreeResult,
  GitCreateWorktreeInput,
  GitCreateWorktreeResult,
  GitHandoffThreadInput,
  GitHandoffThreadResult,
  GitInitInput,
  GitListBranchesInput,
  GitListBranchesResult,
  GitPreparePullRequestThreadInput,
  GitPreparePullRequestThreadResult,
  GitPullInput,
  GitPullRequestRefInput,
  GitPullResult,
  GitReadWorkingTreeDiffInput,
  GitReadWorkingTreeDiffResult,
  GitRemoveIndexLockInput,
  GitRemoveWorktreeInput,
  GitResolvePullRequestResult,
  GitRunStackedActionInput,
  GitStashAndCheckoutInput,
  GitStashDropInput,
  GitStashInfoInput,
  GitStashInfoResult,
  GitStatusInput,
  GitStatusResult,
  GitSummarizeDiffInput,
  GitSummarizeDiffResult,
} from "./git";
import { KeybindingRule } from "./keybindings";
import {
  KanbanBoard,
  KanbanCreateTaskInput,
  KanbanAddTaskCommentInput,
  KanbanDeleteTaskInput,
  KanbanGetBoardInput,
  KanbanGenerateRequirementDraftInput,
  KanbanGenerateRequirementDraftResult,
  KanbanGenerateTaskRequirementInput,
  KanbanGetTaskDetailInput,
  KanbanListProjectsInput,
  KanbanListProjectsResult,
  KanbanMoveTaskInput,
  KanbanTaskDetail,
  KanbanUpdateTaskInput,
} from "./kanban";
import {
  Automation,
  AutomationRun,
  CreateAutomationInput,
  DeleteAutomationInput,
  GetAutomationInput,
  ListAutomationRunsInput,
  ListAutomationsInput,
  RunAutomationInput,
  UpdateAutomationInput,
} from "./automation";
import {
  ClientOrchestrationCommand,
  ORCHESTRATION_WS_METHODS,
  OrchestrationEvent,
  OrchestrationImportThreadInput,
  OrchestrationImportThreadResult,
  OrchestrationRpcSchemas,
  OrchestrationShellStreamItem,
  OrchestrationThreadStreamItem,
} from "./orchestration";
import { ProviderCompactThreadInput } from "./provider";
import {
  ProviderGetComposerCapabilitiesInput,
  ProviderComposerCapabilities,
  ProviderListAgentsInput,
  ProviderListAgentsResult,
  ProviderListCommandsInput,
  ProviderListCommandsResult,
  ProviderListModelsInput,
  ProviderListModelsResult,
  ProviderListPluginsInput,
  ProviderListPluginsResult,
  ProviderListSkillsInput,
  ProviderListSkillsResult,
  ListLocalUserSkillsResult,
  ListLocalUserSkillsInput,
  SetSkillEnabledInput,
  SetSkillEnabledResult,
  ProviderReadPluginInput,
  ProviderReadPluginResult,
} from "./providerDiscovery";
import {
  ProjectListChangedFilesInput,
  ProjectListChangedFilesResult,
  ProjectListDirectoriesInput,
  ProjectListDirectoriesResult,
  ProjectReadFileInput,
  ProjectReadFileResult,
  ProjectSearchEntriesInput,
  ProjectSearchEntriesResult,
  ProjectSearchLocalEntriesInput,
  ProjectSearchLocalEntriesResult,
  ProjectWriteFileInput,
  ProjectWriteFileResult,
} from "./project";
import {
  ServerConfig,
  ServerConfigStreamEvent,
  ServerDiagnosticsResult,
  ServerGetEnvironmentResult,
  ServerGetProviderUsageSnapshotInput,
  ServerGetProviderUsageSnapshotResult,
  ServerGetUsageStatisticsInput,
  ServerGetUsageStatisticsResult,
  ServerGetUsageSessionDetailInput,
  ServerGetUsageSessionDetailResult,
  ServerLifecycleStreamEvent,
  ServerGetSettingsResult,
  ServerListModelProvidersInput,
  ServerListModelProvidersResult,
  ServerListWorktreesResult,
  ServerProviderUpdateError,
  ServerProviderUpdateInput,
  ServerProviderUpdateResult,
  ServerRefreshProvidersResult,
  ServerTestModelProviderInput,
  ServerTestModelProviderResult,
  ServerListProviderModelsInput,
  ServerListProviderModelsResult,
  ServerInstallPiPackageInput,
  ServerInstallPiPackageResult,
  ServerListPiPackagesInput,
  ServerListPiPackagesResult,
  ServerRemovePiPackageInput,
  ServerRemovePiPackageResult,
  ServerSaveModelProvidersInput,
  ServerSaveModelProvidersResult,
  ServerUpdateSettingsInput,
  ServerUpdateSettingsResult,
  ServerUpsertKeybindingResult,
  ServerVoiceTranscriptionInput,
  ServerVoiceTranscriptionResult,
} from "./server";
import {
  SubAgentsDeleteInput,
  SubAgentsListInput,
  SubAgentsSaveInput,
  SubAgentsSavedInput,
} from "./subAgents";
import { ProviderStopSubagentInput } from "./provider";
import {
  TerminalClearInput,
  TerminalCloseInput,
  TerminalEvent,
  TerminalOpenInput,
  TerminalResizeInput,
  TerminalRestartInput,
  TerminalSessionSnapshot,
  TerminalWriteInput,
} from "./terminal";
import { WS_METHODS } from "./ws";

export class WsRpcError extends Schema.TaggedErrorClass<WsRpcError>()("WsRpcError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {}

export const WsOrchestrationDispatchCommandRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.dispatchCommand,
  {
    payload: ClientOrchestrationCommand,
    success: OrchestrationRpcSchemas.dispatchCommand.output,
    error: WsRpcError,
  },
);

export const WsOrchestrationImportThreadRpc = Rpc.make(ORCHESTRATION_WS_METHODS.importThread, {
  payload: OrchestrationImportThreadInput,
  success: OrchestrationImportThreadResult,
  error: WsRpcError,
});

export const WsOrchestrationGetSnapshotRpc = Rpc.make(ORCHESTRATION_WS_METHODS.getSnapshot, {
  payload: OrchestrationRpcSchemas.getSnapshot.input,
  success: OrchestrationRpcSchemas.getSnapshot.output,
  error: WsRpcError,
});

export const WsOrchestrationGetShellSnapshotRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.getShellSnapshot,
  {
    payload: OrchestrationRpcSchemas.getShellSnapshot.input,
    success: OrchestrationRpcSchemas.getShellSnapshot.output,
    error: WsRpcError,
  },
);

export const WsOrchestrationRepairStateRpc = Rpc.make(ORCHESTRATION_WS_METHODS.repairState, {
  payload: OrchestrationRpcSchemas.repairState.input,
  success: OrchestrationRpcSchemas.repairState.output,
  error: WsRpcError,
});

export const WsOrchestrationGetTurnDiffRpc = Rpc.make(ORCHESTRATION_WS_METHODS.getTurnDiff, {
  payload: OrchestrationRpcSchemas.getTurnDiff.input,
  success: OrchestrationRpcSchemas.getTurnDiff.output,
  error: WsRpcError,
});

export const WsOrchestrationGetFullThreadDiffRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.getFullThreadDiff,
  {
    payload: OrchestrationRpcSchemas.getFullThreadDiff.input,
    success: OrchestrationRpcSchemas.getFullThreadDiff.output,
    error: WsRpcError,
  },
);

export const WsOrchestrationReplayEventsRpc = Rpc.make(ORCHESTRATION_WS_METHODS.replayEvents, {
  payload: OrchestrationRpcSchemas.replayEvents.input,
  success: OrchestrationRpcSchemas.replayEvents.output,
  error: WsRpcError,
});

export const WsOrchestrationSubscribeShellRpc = Rpc.make(ORCHESTRATION_WS_METHODS.subscribeShell, {
  payload: OrchestrationRpcSchemas.subscribeShell.input,
  success: OrchestrationShellStreamItem,
  error: WsRpcError,
  stream: true,
});

export const WsOrchestrationUnsubscribeShellRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.unsubscribeShell,
  {
    payload: OrchestrationRpcSchemas.unsubscribeShell.input,
    success: Schema.Void,
    error: WsRpcError,
  },
);

export const WsOrchestrationSubscribeThreadRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.subscribeThread,
  {
    payload: OrchestrationRpcSchemas.subscribeThread.input,
    success: OrchestrationThreadStreamItem,
    error: WsRpcError,
    stream: true,
  },
);

export const WsOrchestrationSubscribeDomainEventsRpc = Rpc.make(
  WS_METHODS.subscribeOrchestrationDomainEvents,
  {
    payload: Schema.Struct({}),
    success: OrchestrationEvent,
    error: WsRpcError,
    stream: true,
  },
);

export const WsOrchestrationUnsubscribeThreadRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.unsubscribeThread,
  {
    payload: OrchestrationRpcSchemas.unsubscribeThread.input,
    success: Schema.Void,
    error: WsRpcError,
  },
);

export const WsProjectsListDirectoriesRpc = Rpc.make(WS_METHODS.projectsListDirectories, {
  payload: ProjectListDirectoriesInput,
  success: ProjectListDirectoriesResult,
  error: WsRpcError,
});

export const WsProjectsSearchEntriesRpc = Rpc.make(WS_METHODS.projectsSearchEntries, {
  payload: ProjectSearchEntriesInput,
  success: ProjectSearchEntriesResult,
  error: WsRpcError,
});

export const WsProjectsSearchLocalEntriesRpc = Rpc.make(WS_METHODS.projectsSearchLocalEntries, {
  payload: ProjectSearchLocalEntriesInput,
  success: ProjectSearchLocalEntriesResult,
  error: WsRpcError,
});

export const WsProjectsWriteFileRpc = Rpc.make(WS_METHODS.projectsWriteFile, {
  payload: ProjectWriteFileInput,
  success: ProjectWriteFileResult,
  error: WsRpcError,
});

export const WsProjectsReadFileRpc = Rpc.make(WS_METHODS.projectsReadFile, {
  payload: ProjectReadFileInput,
  success: ProjectReadFileResult,
  error: WsRpcError,
});

export const WsProjectsListChangedFilesRpc = Rpc.make(WS_METHODS.projectsListChangedFiles, {
  payload: ProjectListChangedFilesInput,
  success: ProjectListChangedFilesResult,
  error: WsRpcError,
});

export const WsFilesystemBrowseRpc = Rpc.make(WS_METHODS.filesystemBrowse, {
  payload: FilesystemBrowseInput,
  success: FilesystemBrowseResult,
  error: WsRpcError,
});

export const WsShellOpenInEditorRpc = Rpc.make(WS_METHODS.shellOpenInEditor, {
  payload: OpenInEditorInput,
  success: Schema.Void,
  error: WsRpcError,
});

export const WsGitStatusRpc = Rpc.make(WS_METHODS.gitStatus, {
  payload: GitStatusInput,
  success: GitStatusResult,
  error: WsRpcError,
});

export const WsGitReadWorkingTreeDiffRpc = Rpc.make(WS_METHODS.gitReadWorkingTreeDiff, {
  payload: GitReadWorkingTreeDiffInput,
  success: GitReadWorkingTreeDiffResult,
  error: WsRpcError,
});

export const WsGitSummarizeDiffRpc = Rpc.make(WS_METHODS.gitSummarizeDiff, {
  payload: GitSummarizeDiffInput,
  success: GitSummarizeDiffResult,
  error: WsRpcError,
});

export const WsGitPullRpc = Rpc.make(WS_METHODS.gitPull, {
  payload: GitPullInput,
  success: GitPullResult,
  error: WsRpcError,
});

export const WsGitRunStackedActionRpc = Rpc.make(WS_METHODS.gitRunStackedAction, {
  payload: GitRunStackedActionInput,
  success: GitActionProgressEvent,
  error: WsRpcError,
  stream: true,
});

export const WsGitResolvePullRequestRpc = Rpc.make(WS_METHODS.gitResolvePullRequest, {
  payload: GitPullRequestRefInput,
  success: GitResolvePullRequestResult,
  error: WsRpcError,
});

export const WsGitPreparePullRequestThreadRpc = Rpc.make(WS_METHODS.gitPreparePullRequestThread, {
  payload: GitPreparePullRequestThreadInput,
  success: GitPreparePullRequestThreadResult,
  error: WsRpcError,
});

export const WsGitListBranchesRpc = Rpc.make(WS_METHODS.gitListBranches, {
  payload: GitListBranchesInput,
  success: GitListBranchesResult,
  error: WsRpcError,
});

export const WsGitCreateWorktreeRpc = Rpc.make(WS_METHODS.gitCreateWorktree, {
  payload: GitCreateWorktreeInput,
  success: GitCreateWorktreeResult,
  error: WsRpcError,
});

export const WsGitCreateDetachedWorktreeRpc = Rpc.make(WS_METHODS.gitCreateDetachedWorktree, {
  payload: GitCreateDetachedWorktreeInput,
  success: GitCreateDetachedWorktreeResult,
  error: WsRpcError,
});

export const WsGitRemoveWorktreeRpc = Rpc.make(WS_METHODS.gitRemoveWorktree, {
  payload: GitRemoveWorktreeInput,
  success: Schema.Void,
  error: WsRpcError,
});

export const WsGitCreateBranchRpc = Rpc.make(WS_METHODS.gitCreateBranch, {
  payload: GitCreateBranchInput,
  success: Schema.Void,
  error: WsRpcError,
});

export const WsGitCheckoutRpc = Rpc.make(WS_METHODS.gitCheckout, {
  payload: GitCheckoutInput,
  success: Schema.Void,
  error: WsRpcError,
});

export const WsGitStashAndCheckoutRpc = Rpc.make(WS_METHODS.gitStashAndCheckout, {
  payload: GitStashAndCheckoutInput,
  success: Schema.Void,
  error: WsRpcError,
});

export const WsGitStashDropRpc = Rpc.make(WS_METHODS.gitStashDrop, {
  payload: GitStashDropInput,
  success: Schema.Void,
  error: WsRpcError,
});

export const WsGitStashInfoRpc = Rpc.make(WS_METHODS.gitStashInfo, {
  payload: GitStashInfoInput,
  success: GitStashInfoResult,
  error: WsRpcError,
});

export const WsGitRemoveIndexLockRpc = Rpc.make(WS_METHODS.gitRemoveIndexLock, {
  payload: GitRemoveIndexLockInput,
  success: Schema.Void,
  error: WsRpcError,
});

export const WsGitInitRpc = Rpc.make(WS_METHODS.gitInit, {
  payload: GitInitInput,
  success: Schema.Void,
  error: WsRpcError,
});

export const WsGitHandoffThreadRpc = Rpc.make(WS_METHODS.gitHandoffThread, {
  payload: GitHandoffThreadInput,
  success: GitHandoffThreadResult,
  error: WsRpcError,
});

export const WsTerminalOpenRpc = Rpc.make(WS_METHODS.terminalOpen, {
  payload: TerminalOpenInput,
  success: TerminalSessionSnapshot,
  error: WsRpcError,
});

export const WsTerminalWriteRpc = Rpc.make(WS_METHODS.terminalWrite, {
  payload: TerminalWriteInput,
  success: Schema.Void,
  error: WsRpcError,
});

export const WsTerminalResizeRpc = Rpc.make(WS_METHODS.terminalResize, {
  payload: TerminalResizeInput,
  success: Schema.Void,
  error: WsRpcError,
});

export const WsTerminalClearRpc = Rpc.make(WS_METHODS.terminalClear, {
  payload: TerminalClearInput,
  success: Schema.Void,
  error: WsRpcError,
});

export const WsTerminalRestartRpc = Rpc.make(WS_METHODS.terminalRestart, {
  payload: TerminalRestartInput,
  success: TerminalSessionSnapshot,
  error: WsRpcError,
});

export const WsTerminalCloseRpc = Rpc.make(WS_METHODS.terminalClose, {
  payload: TerminalCloseInput,
  success: Schema.Void,
  error: WsRpcError,
});

export const WsSubscribeTerminalEventsRpc = Rpc.make(WS_METHODS.subscribeTerminalEvents, {
  payload: Schema.Struct({}),
  success: TerminalEvent,
  error: WsRpcError,
  stream: true,
});

export const WsServerGetConfigRpc = Rpc.make(WS_METHODS.serverGetConfig, {
  payload: Schema.Struct({}),
  success: ServerConfig,
  error: WsRpcError,
});

export const WsServerGetEnvironmentRpc = Rpc.make(WS_METHODS.serverGetEnvironment, {
  payload: Schema.Struct({}),
  success: ServerGetEnvironmentResult,
  error: WsRpcError,
});

export const WsServerGetSettingsRpc = Rpc.make(WS_METHODS.serverGetSettings, {
  payload: Schema.Struct({}),
  success: ServerGetSettingsResult,
  error: WsRpcError,
});

export const WsServerUpdateSettingsRpc = Rpc.make(WS_METHODS.serverUpdateSettings, {
  payload: ServerUpdateSettingsInput,
  success: ServerUpdateSettingsResult,
  error: WsRpcError,
});

export const WsServerRefreshProvidersRpc = Rpc.make(WS_METHODS.serverRefreshProviders, {
  payload: Schema.Struct({}),
  success: ServerRefreshProvidersResult,
  error: WsRpcError,
});

export const WsServerUpdateProviderRpc = Rpc.make(WS_METHODS.serverUpdateProvider, {
  payload: ServerProviderUpdateInput,
  success: ServerProviderUpdateResult,
  error: ServerProviderUpdateError,
});

export const WsServerListWorktreesRpc = Rpc.make(WS_METHODS.serverListWorktrees, {
  payload: Schema.Struct({}),
  success: ServerListWorktreesResult,
  error: WsRpcError,
});

export const WsServerListModelProvidersRpc = Rpc.make(WS_METHODS.serverListModelProviders, {
  payload: ServerListModelProvidersInput,
  success: ServerListModelProvidersResult,
  error: WsRpcError,
});

export const WsServerSaveModelProvidersRpc = Rpc.make(WS_METHODS.serverSaveModelProviders, {
  payload: ServerSaveModelProvidersInput,
  success: ServerSaveModelProvidersResult,
  error: WsRpcError,
});

export const WsServerTestModelProviderRpc = Rpc.make(WS_METHODS.serverTestModelProvider, {
  payload: ServerTestModelProviderInput,
  success: ServerTestModelProviderResult,
  error: WsRpcError,
});

export const WsServerListProviderModelsRpc = Rpc.make(WS_METHODS.serverListProviderModels, {
  payload: ServerListProviderModelsInput,
  success: ServerListProviderModelsResult,
  error: WsRpcError,
});

export const WsServerListPiPackagesRpc = Rpc.make(WS_METHODS.serverListPiPackages, {
  payload: ServerListPiPackagesInput,
  success: ServerListPiPackagesResult,
  error: WsRpcError,
});

export const WsServerInstallPiPackageRpc = Rpc.make(WS_METHODS.serverInstallPiPackage, {
  payload: ServerInstallPiPackageInput,
  success: ServerInstallPiPackageResult,
  error: WsRpcError,
});

export const WsServerRemovePiPackageRpc = Rpc.make(WS_METHODS.serverRemovePiPackage, {
  payload: ServerRemovePiPackageInput,
  success: ServerRemovePiPackageResult,
  error: WsRpcError,
});

export const WsServerGetProviderUsageSnapshotRpc = Rpc.make(
  WS_METHODS.serverGetProviderUsageSnapshot,
  {
    payload: ServerGetProviderUsageSnapshotInput,
    success: ServerGetProviderUsageSnapshotResult,
    error: WsRpcError,
  },
);

export const WsServerGetUsageStatisticsRpc = Rpc.make(WS_METHODS.serverGetUsageStatistics, {
  payload: ServerGetUsageStatisticsInput,
  success: ServerGetUsageStatisticsResult,
  error: WsRpcError,
});

export const WsServerGetUsageSessionDetailRpc = Rpc.make(WS_METHODS.serverGetUsageSessionDetail, {
  payload: ServerGetUsageSessionDetailInput,
  success: ServerGetUsageSessionDetailResult,
  error: WsRpcError,
});

export const WsServerGetDiagnosticsRpc = Rpc.make(WS_METHODS.serverGetDiagnostics, {
  payload: Schema.Struct({}),
  success: ServerDiagnosticsResult,
  error: WsRpcError,
});

export const WsServerTranscribeVoiceRpc = Rpc.make(WS_METHODS.serverTranscribeVoice, {
  payload: ServerVoiceTranscriptionInput,
  success: ServerVoiceTranscriptionResult,
  error: WsRpcError,
});

export const WsServerUpsertKeybindingRpc = Rpc.make(WS_METHODS.serverUpsertKeybinding, {
  payload: KeybindingRule,
  success: ServerUpsertKeybindingResult,
  error: WsRpcError,
});

export const WsSubscribeServerLifecycleRpc = Rpc.make(WS_METHODS.subscribeServerLifecycle, {
  payload: Schema.Struct({}),
  success: ServerLifecycleStreamEvent,
  error: WsRpcError,
  stream: true,
});

export const WsSubscribeServerConfigRpc = Rpc.make(WS_METHODS.subscribeServerConfig, {
  payload: Schema.Struct({}),
  success: ServerConfigStreamEvent,
  error: WsRpcError,
  stream: true,
});

export const WsSubscribeServerProviderStatusesRpc = Rpc.make(
  WS_METHODS.subscribeServerProviderStatuses,
  {
    payload: Schema.Struct({}),
    success: ServerRefreshProvidersResult,
    error: WsRpcError,
    stream: true,
  },
);

export const WsSubscribeServerSettingsRpc = Rpc.make(WS_METHODS.subscribeServerSettings, {
  payload: Schema.Struct({}),
  success: Schema.Struct({ settings: ServerGetSettingsResult }),
  error: WsRpcError,
  stream: true,
});

export const WsProviderGetComposerCapabilitiesRpc = Rpc.make(
  WS_METHODS.providerGetComposerCapabilities,
  {
    payload: ProviderGetComposerCapabilitiesInput,
    success: ProviderComposerCapabilities,
    error: WsRpcError,
  },
);

export const WsProviderCompactThreadRpc = Rpc.make(WS_METHODS.providerCompactThread, {
  payload: ProviderCompactThreadInput,
  success: Schema.Void,
  error: WsRpcError,
});

export const WsProviderListCommandsRpc = Rpc.make(WS_METHODS.providerListCommands, {
  payload: ProviderListCommandsInput,
  success: ProviderListCommandsResult,
  error: WsRpcError,
});

export const WsProviderListSkillsRpc = Rpc.make(WS_METHODS.providerListSkills, {
  payload: ProviderListSkillsInput,
  success: ProviderListSkillsResult,
  error: WsRpcError,
});

export const WsSkillsListLocalRpc = Rpc.make(WS_METHODS.skillsListLocal, {
  payload: ListLocalUserSkillsInput,
  success: ListLocalUserSkillsResult,
  error: WsRpcError,
});

export const WsSkillsSetEnabledRpc = Rpc.make(WS_METHODS.skillsSetEnabled, {
  payload: SetSkillEnabledInput,
  success: SetSkillEnabledResult,
  error: WsRpcError,
});

export const WsSubAgentsListRpc = Rpc.make(WS_METHODS.subAgentsList, {
  payload: SubAgentsListInput,
  success: SubAgentsSavedInput,
  error: WsRpcError,
});

export const WsSubAgentsSaveRpc = Rpc.make(WS_METHODS.subAgentsSave, {
  payload: SubAgentsSaveInput,
  success: SubAgentsSavedInput,
  error: WsRpcError,
});

export const WsSubAgentsDeleteRpc = Rpc.make(WS_METHODS.subAgentsDelete, {
  payload: SubAgentsDeleteInput,
  success: SubAgentsSavedInput,
  error: WsRpcError,
});

/**
 * End one worker a running Multi-Agent turn has out.
 *
 * `success: Schema.Boolean` is "a live worker was found and stopped", not "the call worked": a
 * worker that already finished is a no-op the UI can ignore, and reporting `true` for it would
 * make a stale card look like it had just been stopped.
 */
export const WsSubAgentsStopRunRpc = Rpc.make(WS_METHODS.subAgentsStopRun, {
  payload: ProviderStopSubagentInput,
  success: Schema.Boolean,
  error: WsRpcError,
});

export const WsProviderListPluginsRpc = Rpc.make(WS_METHODS.providerListPlugins, {
  payload: ProviderListPluginsInput,
  success: ProviderListPluginsResult,
  error: WsRpcError,
});

export const WsProviderReadPluginRpc = Rpc.make(WS_METHODS.providerReadPlugin, {
  payload: ProviderReadPluginInput,
  success: ProviderReadPluginResult,
  error: WsRpcError,
});

export const WsProviderListModelsRpc = Rpc.make(WS_METHODS.providerListModels, {
  payload: ProviderListModelsInput,
  success: ProviderListModelsResult,
  error: WsRpcError,
});

export const WsProviderListAgentsRpc = Rpc.make(WS_METHODS.providerListAgents, {
  payload: ProviderListAgentsInput,
  success: ProviderListAgentsResult,
  error: WsRpcError,
});

export const WsAutomationListRpc = Rpc.make(WS_METHODS.automationList, {
  payload: ListAutomationsInput,
  success: Schema.Array(Automation),
  error: WsRpcError,
});

export const WsAutomationGetRpc = Rpc.make(WS_METHODS.automationGet, {
  payload: GetAutomationInput,
  success: Automation,
  error: WsRpcError,
});

export const WsAutomationCreateRpc = Rpc.make(WS_METHODS.automationCreate, {
  payload: CreateAutomationInput,
  success: Automation,
  error: WsRpcError,
});

export const WsAutomationUpdateRpc = Rpc.make(WS_METHODS.automationUpdate, {
  payload: UpdateAutomationInput,
  success: Automation,
  error: WsRpcError,
});

export const WsAutomationDeleteRpc = Rpc.make(WS_METHODS.automationDelete, {
  payload: DeleteAutomationInput,
  success: Schema.Void,
  error: WsRpcError,
});

export const WsAutomationRunRpc = Rpc.make(WS_METHODS.automationRun, {
  payload: RunAutomationInput,
  success: AutomationRun,
  error: WsRpcError,
});

export const WsAutomationListRunsRpc = Rpc.make(WS_METHODS.automationListRuns, {
  payload: ListAutomationRunsInput,
  success: Schema.Array(AutomationRun),
  error: WsRpcError,
});

export const WsAgentRuntimeGetRpc = Rpc.make(WS_METHODS.agentRuntimeGet, {
  payload: AgentRuntimeGetInput,
  success: AgentRuntimeGetResult,
  error: WsRpcError,
});

export const WsAgentApprovalModeSetRpc = Rpc.make(WS_METHODS.agentApprovalModeSet, {
  payload: AgentApprovalModeSetInput,
  success: AgentApprovalModeSetResult,
  error: WsRpcError,
});

export const WsAgentGoalGetRpc = Rpc.make(WS_METHODS.agentGoalGet, {
  payload: AgentGoalGetInput,
  success: AgentGoalGetResult,
  error: WsRpcError,
});

export const WsAgentGoalSetStatusRpc = Rpc.make(WS_METHODS.agentGoalSetStatus, {
  payload: AgentGoalSetStatusInput,
  success: AgentGoalSetStatusResult,
  error: WsRpcError,
});

export const WsKanbanListProjectsRpc = Rpc.make(WS_METHODS.kanbanListProjects, {
  payload: KanbanListProjectsInput,
  success: KanbanListProjectsResult,
  error: WsRpcError,
});

export const WsKanbanGetBoardRpc = Rpc.make(WS_METHODS.kanbanGetBoard, {
  payload: KanbanGetBoardInput,
  success: KanbanBoard,
  error: WsRpcError,
});

export const WsKanbanCreateTaskRpc = Rpc.make(WS_METHODS.kanbanCreateTask, {
  payload: KanbanCreateTaskInput,
  success: KanbanBoard,
  error: WsRpcError,
});

export const WsKanbanUpdateTaskRpc = Rpc.make(WS_METHODS.kanbanUpdateTask, {
  payload: KanbanUpdateTaskInput,
  success: KanbanBoard,
  error: WsRpcError,
});

export const WsKanbanMoveTaskRpc = Rpc.make(WS_METHODS.kanbanMoveTask, {
  payload: KanbanMoveTaskInput,
  success: KanbanBoard,
  error: WsRpcError,
});

export const WsKanbanDeleteTaskRpc = Rpc.make(WS_METHODS.kanbanDeleteTask, {
  payload: KanbanDeleteTaskInput,
  success: KanbanBoard,
  error: WsRpcError,
});

export const WsKanbanGetTaskDetailRpc = Rpc.make(WS_METHODS.kanbanGetTaskDetail, {
  payload: KanbanGetTaskDetailInput,
  success: KanbanTaskDetail,
  error: WsRpcError,
});

export const WsKanbanAddTaskCommentRpc = Rpc.make(WS_METHODS.kanbanAddTaskComment, {
  payload: KanbanAddTaskCommentInput,
  success: KanbanTaskDetail,
  error: WsRpcError,
});

export const WsKanbanGenerateTaskRequirementRpc = Rpc.make(
  WS_METHODS.kanbanGenerateTaskRequirement,
  {
    payload: KanbanGenerateTaskRequirementInput,
    success: KanbanTaskDetail,
    error: WsRpcError,
  },
);

export const WsKanbanGenerateRequirementDraftRpc = Rpc.make(
  WS_METHODS.kanbanGenerateRequirementDraft,
  {
    payload: KanbanGenerateRequirementDraftInput,
    success: KanbanGenerateRequirementDraftResult,
    error: WsRpcError,
  },
);

export const WsRpcGroup = RpcGroup.make(
  WsOrchestrationDispatchCommandRpc,
  WsOrchestrationImportThreadRpc,
  WsOrchestrationGetSnapshotRpc,
  WsOrchestrationGetShellSnapshotRpc,
  WsOrchestrationRepairStateRpc,
  WsOrchestrationGetTurnDiffRpc,
  WsOrchestrationGetFullThreadDiffRpc,
  WsOrchestrationReplayEventsRpc,
  WsOrchestrationSubscribeShellRpc,
  WsOrchestrationUnsubscribeShellRpc,
  WsOrchestrationSubscribeThreadRpc,
  WsOrchestrationUnsubscribeThreadRpc,
  WsOrchestrationSubscribeDomainEventsRpc,
  WsProjectsListDirectoriesRpc,
  WsProjectsSearchEntriesRpc,
  WsProjectsSearchLocalEntriesRpc,
  WsProjectsWriteFileRpc,
  WsProjectsReadFileRpc,
  WsProjectsListChangedFilesRpc,
  WsFilesystemBrowseRpc,
  WsShellOpenInEditorRpc,
  WsGitStatusRpc,
  WsGitReadWorkingTreeDiffRpc,
  WsGitSummarizeDiffRpc,
  WsGitPullRpc,
  WsGitRunStackedActionRpc,
  WsGitResolvePullRequestRpc,
  WsGitPreparePullRequestThreadRpc,
  WsGitListBranchesRpc,
  WsGitCreateWorktreeRpc,
  WsGitCreateDetachedWorktreeRpc,
  WsGitRemoveWorktreeRpc,
  WsGitCreateBranchRpc,
  WsGitCheckoutRpc,
  WsGitStashAndCheckoutRpc,
  WsGitStashDropRpc,
  WsGitStashInfoRpc,
  WsGitRemoveIndexLockRpc,
  WsGitInitRpc,
  WsGitHandoffThreadRpc,
  WsTerminalOpenRpc,
  WsTerminalWriteRpc,
  WsTerminalResizeRpc,
  WsTerminalClearRpc,
  WsTerminalRestartRpc,
  WsTerminalCloseRpc,
  WsSubscribeTerminalEventsRpc,
  WsServerGetConfigRpc,
  WsServerGetEnvironmentRpc,
  WsServerGetSettingsRpc,
  WsServerUpdateSettingsRpc,
  WsServerRefreshProvidersRpc,
  WsServerUpdateProviderRpc,
  WsServerListModelProvidersRpc,
  WsServerSaveModelProvidersRpc,
  WsServerTestModelProviderRpc,
  WsServerListProviderModelsRpc,
  WsServerListPiPackagesRpc,
  WsServerInstallPiPackageRpc,
  WsServerRemovePiPackageRpc,
  WsServerListWorktreesRpc,
  WsServerGetProviderUsageSnapshotRpc,
  WsServerGetUsageStatisticsRpc,
  WsServerGetUsageSessionDetailRpc,
  WsServerGetDiagnosticsRpc,
  WsServerTranscribeVoiceRpc,
  WsServerUpsertKeybindingRpc,
  WsSubscribeServerLifecycleRpc,
  WsSubscribeServerConfigRpc,
  WsSubscribeServerProviderStatusesRpc,
  WsSubscribeServerSettingsRpc,
  WsProviderGetComposerCapabilitiesRpc,
  WsProviderCompactThreadRpc,
  WsProviderListCommandsRpc,
  WsProviderListSkillsRpc,
  WsProviderListPluginsRpc,
  WsProviderReadPluginRpc,
  WsProviderListModelsRpc,
  WsProviderListAgentsRpc,
  WsSkillsListLocalRpc,
  WsSkillsSetEnabledRpc,
  WsSubAgentsListRpc,
  WsSubAgentsSaveRpc,
  WsSubAgentsDeleteRpc,
  WsSubAgentsStopRunRpc,
  WsAutomationListRpc,
  WsAutomationGetRpc,
  WsAutomationCreateRpc,
  WsAutomationUpdateRpc,
  WsAutomationDeleteRpc,
  WsAutomationRunRpc,
  WsAutomationListRunsRpc,
  WsAgentRuntimeGetRpc,
  WsAgentApprovalModeSetRpc,
  WsAgentGoalGetRpc,
  WsAgentGoalSetStatusRpc,
  WsKanbanListProjectsRpc,
  WsKanbanGetBoardRpc,
  WsKanbanCreateTaskRpc,
  WsKanbanUpdateTaskRpc,
  WsKanbanMoveTaskRpc,
  WsKanbanDeleteTaskRpc,
  WsKanbanGetTaskDetailRpc,
  WsKanbanAddTaskCommentRpc,
  WsKanbanGenerateTaskRequirementRpc,
  WsKanbanGenerateRequirementDraftRpc,
);
