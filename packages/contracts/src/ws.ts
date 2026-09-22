import { Schema } from "effect";
import { NonNegativeInt, ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas";

import {
  OrchestrationEvent,
  OrchestrationShellStreamItem,
  OrchestrationThreadStreamItem,
  ORCHESTRATION_WS_CHANNELS,
} from "./orchestration";
import { GitActionProgressEvent } from "./git";
import { TerminalEvent } from "./terminal";
import {
  ServerConfigUpdatedPayload,
  ServerLifecycleStreamEvent,
  ServerProviderStatusesUpdatedPayload,
  ServerSettingsUpdatedPayload,
} from "./server";

// ── WebSocket RPC Method Names ───────────────────────────────────────

export const WS_METHODS = {
  // Project registry methods
  projectsList: "projects.list",
  projectsAdd: "projects.add",
  projectsRemove: "projects.remove",
  projectsListDirectories: "projects.listDirectories",
  projectsSearchEntries: "projects.searchEntries",
  projectsSearchLocalEntries: "projects.searchLocalEntries",
  projectsReadFile: "projects.readFile",
  projectsWriteFile: "projects.writeFile",
  projectsListChangedFiles: "projects.listChangedFiles",

  // Filesystem browse methods
  filesystemBrowse: "filesystem.browse",

  // Shell methods
  shellOpenInEditor: "shell.openInEditor",

  // Git methods
  gitPull: "git.pull",
  gitStatus: "git.status",
  gitReadWorkingTreeDiff: "git.readWorkingTreeDiff",
  gitSummarizeDiff: "git.summarizeDiff",
  gitRunStackedAction: "git.runStackedAction",
  gitListBranches: "git.listBranches",
  gitCreateWorktree: "git.createWorktree",
  gitCreateDetachedWorktree: "git.createDetachedWorktree",
  gitRemoveWorktree: "git.removeWorktree",
  gitCreateBranch: "git.createBranch",
  gitCheckout: "git.checkout",
  gitStashAndCheckout: "git.stashAndCheckout",
  gitStashDrop: "git.stashDrop",
  gitStashInfo: "git.stashInfo",
  gitRemoveIndexLock: "git.removeIndexLock",
  gitInit: "git.init",
  gitHandoffThread: "git.handoffThread",
  gitResolvePullRequest: "git.resolvePullRequest",
  gitPreparePullRequestThread: "git.preparePullRequestThread",

  // Terminal methods
  terminalOpen: "terminal.open",
  terminalWrite: "terminal.write",
  terminalResize: "terminal.resize",
  terminalClear: "terminal.clear",
  terminalRestart: "terminal.restart",
  terminalClose: "terminal.close",

  // Server meta
  serverGetConfig: "server.getConfig",
  serverGetEnvironment: "server.getEnvironment",
  serverGetSettings: "server.getSettings",
  serverUpdateSettings: "server.updateSettings",
  serverRefreshProviders: "server.refreshProviders",
  serverUpdateProvider: "server.updateProvider",
  serverListModelProviders: "server.listModelProviders",
  serverSaveModelProviders: "server.saveModelProviders",
  serverTestModelProvider: "server.testModelProvider",
  serverListProviderModels: "server.listProviderModels",
  serverListPiPackages: "server.listPiPackages",
  serverInstallPiPackage: "server.installPiPackage",
  serverRemovePiPackage: "server.removePiPackage",
  serverListWorktrees: "server.listWorktrees",
  serverGetProviderUsageSnapshot: "server.getProviderUsageSnapshot",
  serverGetUsageStatistics: "server.getUsageStatistics",
  serverGetUsageSessionDetail: "server.getUsageSessionDetail",
  serverGetDiagnostics: "server.getDiagnostics",
  serverTranscribeVoice: "server.transcribeVoice",
  serverUpsertKeybinding: "server.upsertKeybinding",
  subscribeServerLifecycle: "server.subscribeLifecycle",
  subscribeServerConfig: "server.subscribeConfig",
  subscribeServerProviderStatuses: "server.subscribeProviderStatuses",
  subscribeServerSettings: "server.subscribeSettings",

  // Streaming subscriptions
  subscribeTerminalEvents: "terminal.subscribeEvents",
  subscribeOrchestrationDomainEvents: "orchestration.subscribeDomainEvents",
  subscribeGitActionProgress: "git.subscribeActionProgress",

  // Provider discovery
  providerGetComposerCapabilities: "provider.getComposerCapabilities",
  providerCompactThread: "provider.compactThread",
  providerListCommands: "provider.listCommands",
  providerListSkills: "provider.listSkills",
  providerListPlugins: "provider.listPlugins",
  providerReadPlugin: "provider.readPlugin",
  providerListModels: "provider.listModels",
  providerListAgents: "provider.listAgents",

  // Local user skills (home-dir scan, independent of provider)
  skillsListLocal: "skills.listLocal",
  skillsSetEnabled: "skills.setEnabled",

  // Sub-agents (multi-agent worker registry)
  subAgentsList: "subAgents.list",
  subAgentsSave: "subAgents.save",
  subAgentsDelete: "subAgents.delete",
  /** End one worker a Multi-Agent turn currently has out. */
  subAgentsStopRun: "subAgents.stopRun",

  // Kanban methods
  agentRuntimeGet: "agentRuntime.get",
  agentApprovalModeSet: "agentApprovalMode.set",
  agentGoalGet: "agentGoal.get",
  agentGoalSetStatus: "agentGoal.setStatus",
  kanbanListProjects: "kanban.listProjects",
  kanbanGetBoard: "kanban.getBoard",
  kanbanCreateTask: "kanban.createTask",
  kanbanUpdateTask: "kanban.updateTask",
  kanbanMoveTask: "kanban.moveTask",
  kanbanDeleteTask: "kanban.deleteTask",
  kanbanGetTaskDetail: "kanban.getTaskDetail",
  kanbanAddTaskComment: "kanban.addTaskComment",
  kanbanGenerateTaskRequirement: "kanban.generateTaskRequirement",
  kanbanGenerateRequirementDraft: "kanban.generateRequirementDraft",

  // Automation methods
  automationList: "automation.list",
  automationGet: "automation.get",
  automationCreate: "automation.create",
  automationUpdate: "automation.update",
  automationDelete: "automation.delete",
  automationRun: "automation.run",
  automationListRuns: "automation.listRuns",
} as const;

// ── Push Event Channels ──────────────────────────────────────────────

export const WS_CHANNELS = {
  gitActionProgress: "git.actionProgress",
  terminalEvent: "terminal.event",
  serverWelcome: "server.welcome",
  serverMaintenanceUpdated: "server.maintenanceUpdated",
  serverConfigUpdated: "server.configUpdated",
  serverProviderStatusesUpdated: "server.providerStatusesUpdated",
  serverSettingsUpdated: "server.settingsUpdated",
} as const;

export const WsPushSequence = NonNegativeInt;
export type WsPushSequence = typeof WsPushSequence.Type;

export const WsWelcomePayload = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  homeDir: Schema.optional(TrimmedNonEmptyString),
  projectName: TrimmedNonEmptyString,
  bootstrapProjectId: Schema.optional(ProjectId),
  bootstrapThreadId: Schema.optional(ThreadId),
});
export type WsWelcomePayload = typeof WsWelcomePayload.Type;

export interface WsPushPayloadByChannel {
  readonly [WS_CHANNELS.serverWelcome]: WsWelcomePayload;
  readonly [WS_CHANNELS.serverMaintenanceUpdated]: ServerLifecycleStreamEvent;
  readonly [WS_CHANNELS.serverConfigUpdated]: typeof ServerConfigUpdatedPayload.Type;
  readonly [WS_CHANNELS.serverProviderStatusesUpdated]: typeof ServerProviderStatusesUpdatedPayload.Type;
  readonly [WS_CHANNELS.serverSettingsUpdated]: typeof ServerSettingsUpdatedPayload.Type;
  readonly [WS_CHANNELS.gitActionProgress]: typeof GitActionProgressEvent.Type;
  readonly [WS_CHANNELS.terminalEvent]: typeof TerminalEvent.Type;
  readonly [ORCHESTRATION_WS_CHANNELS.domainEvent]: OrchestrationEvent;
  readonly [ORCHESTRATION_WS_CHANNELS.shellEvent]: OrchestrationShellStreamItem;
  readonly [ORCHESTRATION_WS_CHANNELS.threadEvent]: OrchestrationThreadStreamItem;
}

export type WsPushChannel = keyof WsPushPayloadByChannel;
export type WsPushData<C extends WsPushChannel> = WsPushPayloadByChannel[C];

const makeWsPushSchema = <const Channel extends string, Payload extends Schema.Schema<any>>(
  channel: Channel,
  payload: Payload,
) =>
  Schema.Struct({
    type: Schema.Literal("push"),
    sequence: WsPushSequence,
    channel: Schema.Literal(channel),
    data: payload,
  });

export const WsPushServerWelcome = makeWsPushSchema(WS_CHANNELS.serverWelcome, WsWelcomePayload);
export const WsPushServerMaintenanceUpdated = makeWsPushSchema(
  WS_CHANNELS.serverMaintenanceUpdated,
  ServerLifecycleStreamEvent,
);
export const WsPushServerConfigUpdated = makeWsPushSchema(
  WS_CHANNELS.serverConfigUpdated,
  ServerConfigUpdatedPayload,
);
export const WsPushServerProviderStatusesUpdated = makeWsPushSchema(
  WS_CHANNELS.serverProviderStatusesUpdated,
  ServerProviderStatusesUpdatedPayload,
);
export const WsPushServerSettingsUpdated = makeWsPushSchema(
  WS_CHANNELS.serverSettingsUpdated,
  ServerSettingsUpdatedPayload,
);
export const WsPushGitActionProgress = makeWsPushSchema(
  WS_CHANNELS.gitActionProgress,
  GitActionProgressEvent,
);
export const WsPushTerminalEvent = makeWsPushSchema(WS_CHANNELS.terminalEvent, TerminalEvent);
export const WsPushOrchestrationDomainEvent = makeWsPushSchema(
  ORCHESTRATION_WS_CHANNELS.domainEvent,
  OrchestrationEvent,
);
export const WsPushOrchestrationShellEvent = makeWsPushSchema(
  ORCHESTRATION_WS_CHANNELS.shellEvent,
  OrchestrationShellStreamItem,
);
export const WsPushOrchestrationThreadEvent = makeWsPushSchema(
  ORCHESTRATION_WS_CHANNELS.threadEvent,
  OrchestrationThreadStreamItem,
);

export const WsPush = Schema.Union([
  WsPushServerWelcome,
  WsPushServerMaintenanceUpdated,
  WsPushServerConfigUpdated,
  WsPushServerProviderStatusesUpdated,
  WsPushServerSettingsUpdated,
  WsPushGitActionProgress,
  WsPushTerminalEvent,
  WsPushOrchestrationDomainEvent,
  WsPushOrchestrationShellEvent,
  WsPushOrchestrationThreadEvent,
]);
export type WsPush = typeof WsPush.Type;

export type WsPushMessage<C extends WsPushChannel> = Extract<WsPush, { channel: C }>;
