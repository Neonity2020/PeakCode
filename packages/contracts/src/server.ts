import { Schema } from "effect";
import {
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas";
import { KeybindingRule, ResolvedKeybindingsConfig } from "./keybindings";
import { EditorId } from "./editor";
import { ProviderKind } from "./orchestration";
import { ServerSettings, ServerSettingsPatch } from "./settings";
import { ModelProvidersFile } from "./modelProviders";
import { PiPackagesSnapshot } from "./piPackages";
import { ExecutionEnvironmentDescriptor } from "./environment";

const SERVER_VOICE_TRANSCRIPTION_MAX_AUDIO_BASE64_CHARS = 14_000_000;

const KeybindingsMalformedConfigIssue = Schema.Struct({
  kind: Schema.Literal("keybindings.malformed-config"),
  message: TrimmedNonEmptyString,
});

const KeybindingsInvalidEntryIssue = Schema.Struct({
  kind: Schema.Literal("keybindings.invalid-entry"),
  message: TrimmedNonEmptyString,
  index: Schema.Number,
});

export const ServerConfigIssue = Schema.Union([
  KeybindingsMalformedConfigIssue,
  KeybindingsInvalidEntryIssue,
]);
export type ServerConfigIssue = typeof ServerConfigIssue.Type;

const ServerConfigIssues = Schema.Array(ServerConfigIssue);

export const ServerProviderStatusState = Schema.Literals(["ready", "warning", "error"]);
export type ServerProviderStatusState = typeof ServerProviderStatusState.Type;

export const ServerProviderAuthStatus = Schema.Literals([
  "authenticated",
  "unauthenticated",
  "unknown",
]);
export type ServerProviderAuthStatus = typeof ServerProviderAuthStatus.Type;

export const ServerProviderStatus = Schema.Struct({
  provider: ProviderKind,
  status: ServerProviderStatusState,
  available: Schema.Boolean,
  authStatus: ServerProviderAuthStatus,
  authType: Schema.optional(TrimmedNonEmptyString),
  authLabel: Schema.optional(TrimmedNonEmptyString),
  voiceTranscriptionAvailable: Schema.optional(Schema.Boolean),
  version: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  checkedAt: IsoDateTime,
  message: Schema.optional(TrimmedNonEmptyString),
  versionAdvisory: Schema.optionalKey(
    Schema.Struct({
      status: Schema.Literals(["unknown", "current", "behind_latest"]),
      currentVersion: Schema.NullOr(TrimmedNonEmptyString),
      latestVersion: Schema.NullOr(TrimmedNonEmptyString),
      updateCommand: Schema.NullOr(TrimmedNonEmptyString),
      canUpdate: Schema.Boolean,
      checkedAt: Schema.NullOr(IsoDateTime),
      message: Schema.NullOr(TrimmedNonEmptyString),
    }),
  ),
  updateState: Schema.optionalKey(
    Schema.Struct({
      status: Schema.Literals(["idle", "queued", "running", "succeeded", "failed", "unchanged"]),
      startedAt: Schema.NullOr(IsoDateTime),
      finishedAt: Schema.NullOr(IsoDateTime),
      message: Schema.NullOr(TrimmedNonEmptyString),
      output: Schema.NullOr(Schema.String.check(Schema.isMaxLength(10_000))),
    }),
  ),
});
export type ServerProviderStatus = typeof ServerProviderStatus.Type;

export type ServerProviderVersionAdvisory = NonNullable<ServerProviderStatus["versionAdvisory"]>;
export type ServerProviderUpdateState = NonNullable<ServerProviderStatus["updateState"]>;

const ServerProviderStatuses = Schema.Array(ServerProviderStatus);

export const ServerConfig = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  homeDir: Schema.optional(TrimmedNonEmptyString),
  worktreesDir: TrimmedNonEmptyString,
  keybindingsConfigPath: TrimmedNonEmptyString,
  keybindings: ResolvedKeybindingsConfig,
  issues: ServerConfigIssues,
  providers: ServerProviderStatuses,
  availableEditors: Schema.Array(EditorId),
});
export type ServerConfig = typeof ServerConfig.Type;

export const ServerManagedWorktree = Schema.Struct({
  path: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
});
export type ServerManagedWorktree = typeof ServerManagedWorktree.Type;

export const ServerListWorktreesResult = Schema.Struct({
  worktrees: Schema.Array(ServerManagedWorktree),
});
export type ServerListWorktreesResult = typeof ServerListWorktreesResult.Type;

export const ServerProviderUsageLimit = Schema.Struct({
  window: TrimmedNonEmptyString,
  usedPercent: Schema.optional(
    Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)).check(Schema.isLessThanOrEqualTo(100)),
  ),
  resetsAt: Schema.optional(IsoDateTime),
  windowDurationMins: Schema.optional(NonNegativeInt),
});
export type ServerProviderUsageLimit = typeof ServerProviderUsageLimit.Type;

export const ServerProviderUsageLine = Schema.Struct({
  label: TrimmedNonEmptyString,
  value: TrimmedNonEmptyString,
  subtitle: Schema.optional(TrimmedNonEmptyString),
});
export type ServerProviderUsageLine = typeof ServerProviderUsageLine.Type;

export const ServerProviderUsageSnapshot = Schema.Struct({
  provider: ProviderKind,
  updatedAt: IsoDateTime,
  limits: Schema.Array(ServerProviderUsageLimit),
  usageLines: Schema.Array(ServerProviderUsageLine),
  source: TrimmedNonEmptyString,
});
export type ServerProviderUsageSnapshot = typeof ServerProviderUsageSnapshot.Type;

export const ServerGetProviderUsageSnapshotInput = Schema.Struct({
  provider: ProviderKind,
  homePath: Schema.optional(TrimmedNonEmptyString),
});
export type ServerGetProviderUsageSnapshotInput = typeof ServerGetProviderUsageSnapshotInput.Type;

export const ServerGetProviderUsageSnapshotResult = Schema.NullOr(ServerProviderUsageSnapshot);
export type ServerGetProviderUsageSnapshotResult = typeof ServerGetProviderUsageSnapshotResult.Type;

/** Every local coding agent the usage page can account for. */
export const ServerUsageStatisticsSourceId = Schema.Literals([
  "claude-code",
  "codex",
  "zcode",
  "workbuddy",
  "pi",
  "opencode",
  "ccmr",
  "grok",
  "dsh",
]);
export type ServerUsageStatisticsSourceId = typeof ServerUsageStatisticsSourceId.Type;

const ServerUsageStatisticsSourceUsage = Schema.Struct({
  source: ServerUsageStatisticsSourceId,
  tokens: NonNegativeInt,
  responses: NonNegativeInt,
  models: Schema.Array(
    Schema.Struct({
      model: TrimmedNonEmptyString,
      tokens: NonNegativeInt,
    }),
  ),
});

/**
 * One day of usage in the server's local calendar, present only when that day had
 * activity. `bySource` carries the tool split for that day, which is what lets the
 * panel filter and re-trend without asking the server for a second pass.
 */
export const ServerUsageStatisticsDay = Schema.Struct({
  date: TrimmedNonEmptyString,
  tokens: NonNegativeInt,
  responses: NonNegativeInt,
  bySource: Schema.Array(ServerUsageStatisticsSourceUsage),
});
export type ServerUsageStatisticsDay = typeof ServerUsageStatisticsDay.Type;

export const ServerUsageStatisticsModel = Schema.Struct({
  model: TrimmedNonEmptyString,
  tokens: NonNegativeInt,
  responses: NonNegativeInt,
  /** Tools that reported this model id. */
  sources: Schema.Array(ServerUsageStatisticsSourceId),
  lastUsedAt: IsoDateTime,
});
export type ServerUsageStatisticsModel = typeof ServerUsageStatisticsModel.Type;

export const ServerUsageStatisticsSource = Schema.Struct({
  id: ServerUsageStatisticsSourceId,
  label: TrimmedNonEmptyString,
  /** Where this tool keeps its records; shown when nothing was found for it. */
  roots: Schema.Array(TrimmedNonEmptyString),
  /** Whether any record of this tool was found inside the window. */
  active: Schema.Boolean,
  tokens: NonNegativeInt,
  responses: NonNegativeInt,
  sessions: NonNegativeInt,
  models: NonNegativeInt,
  lastUsedAt: Schema.NullOr(IsoDateTime),
});
export type ServerUsageStatisticsSource = typeof ServerUsageStatisticsSource.Type;

export const ServerUsageStatisticsSession = Schema.Struct({
  source: ServerUsageStatisticsSourceId,
  sessionId: TrimmedNonEmptyString,
  project: Schema.NullOr(TrimmedNonEmptyString),
  startedAt: IsoDateTime,
  endedAt: IsoDateTime,
  tokens: NonNegativeInt,
  responses: NonNegativeInt,
  models: Schema.Array(TrimmedNonEmptyString),
  /** False once the session aged out of request-log retention. */
  hasRequestDetail: Schema.Boolean,
});
export type ServerUsageStatisticsSession = typeof ServerUsageStatisticsSession.Type;

export const ServerUsageStatisticsTotals = Schema.Struct({
  tokens: NonNegativeInt,
  inputTokens: NonNegativeInt,
  outputTokens: NonNegativeInt,
  cacheReadTokens: NonNegativeInt,
  cacheWriteTokens: NonNegativeInt,
  reasoningTokens: NonNegativeInt,
  peakDayTokens: NonNegativeInt,
  peakDay: Schema.NullOr(TrimmedNonEmptyString),
  /** Longest single conversation, measured from its first to its last record. */
  longestChatMs: NonNegativeInt,
  currentStreakDays: NonNegativeInt,
  longestStreakDays: NonNegativeInt,
  activeDays: NonNegativeInt,
  sessions: NonNegativeInt,
  responses: NonNegativeInt,
});
export type ServerUsageStatisticsTotals = typeof ServerUsageStatisticsTotals.Type;

export const ServerUsageStatisticsResult = Schema.Struct({
  generatedAt: IsoDateTime,
  source: TrimmedNonEmptyString,
  /** How far back records were read; older history is outside every total here. */
  windowDays: NonNegativeInt,
  earliestAt: Schema.NullOr(IsoDateTime),
  latestAt: Schema.NullOr(IsoDateTime),
  totals: ServerUsageStatisticsTotals,
  /** Always the full tool list, even when the aggregates below are filtered. */
  sources: Schema.Array(ServerUsageStatisticsSource),
  /** Ascending, sparse: only days with usage appear. */
  days: Schema.Array(ServerUsageStatisticsDay),
  /** Descending by tokens consumed. */
  models: Schema.Array(ServerUsageStatisticsModel),
  /** Most recent sessions first, for the drill-down table. */
  sessions: Schema.Array(ServerUsageStatisticsSession),
});
export type ServerUsageStatisticsResult = typeof ServerUsageStatisticsResult.Type;

export const ServerGetUsageStatisticsInput = Schema.Struct({
  /** Restrict the aggregates to one tool; omit for the whole machine. */
  source: Schema.optional(ServerUsageStatisticsSourceId),
  /** How far back to read; defaults to the server's window. */
  windowDays: Schema.optional(NonNegativeInt),
  /** Bypass the short server-side cache when the user asks for fresh numbers. */
  refresh: Schema.optional(Schema.Boolean),
});
export type ServerGetUsageStatisticsInput = typeof ServerGetUsageStatisticsInput.Type;

export const ServerGetUsageStatisticsResult = ServerUsageStatisticsResult;
export type ServerGetUsageStatisticsResult = typeof ServerGetUsageStatisticsResult.Type;

export const ServerUsageStatisticsRequest = Schema.Struct({
  /** 1-based position of this request in the session, counting requests retention dropped. */
  sequence: NonNegativeInt,
  timestamp: IsoDateTime,
  model: TrimmedNonEmptyString,
  tokens: NonNegativeInt,
  inputTokens: NonNegativeInt,
  outputTokens: NonNegativeInt,
  cacheReadTokens: NonNegativeInt,
  cacheWriteTokens: NonNegativeInt,
});
export type ServerUsageStatisticsRequest = typeof ServerUsageStatisticsRequest.Type;

export const ServerGetUsageSessionDetailInput = Schema.Struct({
  source: ServerUsageStatisticsSourceId,
  sessionId: TrimmedNonEmptyString,
  windowDays: Schema.optional(NonNegativeInt),
});
export type ServerGetUsageSessionDetailInput = typeof ServerGetUsageSessionDetailInput.Type;

export const ServerGetUsageSessionDetailResult = Schema.Struct({
  source: ServerUsageStatisticsSourceId,
  sessionId: TrimmedNonEmptyString,
  project: Schema.NullOr(TrimmedNonEmptyString),
  tokens: NonNegativeInt,
  responses: NonNegativeInt,
  /** Requests dropped by retention, so the panel can say the list is partial. */
  droppedRequests: NonNegativeInt,
  requests: Schema.Array(ServerUsageStatisticsRequest),
});
export type ServerGetUsageSessionDetailResult = typeof ServerGetUsageSessionDetailResult.Type;

export const ServerDiagnosticsMemory = Schema.Struct({
  rssBytes: NonNegativeInt,
  heapTotalBytes: NonNegativeInt,
  heapUsedBytes: NonNegativeInt,
  externalBytes: NonNegativeInt,
  arrayBuffersBytes: NonNegativeInt,
});
export type ServerDiagnosticsMemory = typeof ServerDiagnosticsMemory.Type;

export const ServerDiagnosticsChildProcess = Schema.Struct({
  pid: NonNegativeInt,
  ppid: NonNegativeInt,
  rssBytes: NonNegativeInt,
  virtualSizeBytes: NonNegativeInt,
  command: Schema.String,
  args: Schema.String,
});
export type ServerDiagnosticsChildProcess = typeof ServerDiagnosticsChildProcess.Type;

export const ServerDiagnosticsResult = Schema.Struct({
  generatedAt: IsoDateTime,
  process: Schema.Struct({
    pid: NonNegativeInt,
    uptimeSeconds: NonNegativeInt,
    memory: ServerDiagnosticsMemory,
  }),
  childProcesses: Schema.Array(ServerDiagnosticsChildProcess),
  childProcessTotalCount: NonNegativeInt,
  childProcessTotalRssBytes: NonNegativeInt,
  projection: Schema.Struct({
    projectCount: NonNegativeInt,
    threadCount: NonNegativeInt,
  }),
});
export type ServerDiagnosticsResult = typeof ServerDiagnosticsResult.Type;

export const ServerVoiceTranscriptionInput = Schema.Struct({
  provider: ProviderKind,
  cwd: TrimmedNonEmptyString,
  threadId: Schema.optional(ThreadId),
  mimeType: TrimmedNonEmptyString.check(Schema.isMaxLength(100)),
  sampleRateHz: NonNegativeInt,
  durationMs: NonNegativeInt,
  audioBase64: TrimmedNonEmptyString.check(
    Schema.isMaxLength(SERVER_VOICE_TRANSCRIPTION_MAX_AUDIO_BASE64_CHARS),
  ),
});
export type ServerVoiceTranscriptionInput = typeof ServerVoiceTranscriptionInput.Type;

export const ServerVoiceTranscriptionResult = Schema.Struct({
  text: TrimmedNonEmptyString,
});
export type ServerVoiceTranscriptionResult = typeof ServerVoiceTranscriptionResult.Type;

export const ServerUpsertKeybindingInput = KeybindingRule;
export type ServerUpsertKeybindingInput = typeof ServerUpsertKeybindingInput.Type;

export const ServerUpsertKeybindingResult = Schema.Struct({
  keybindings: ResolvedKeybindingsConfig,
  issues: ServerConfigIssues,
});
export type ServerUpsertKeybindingResult = typeof ServerUpsertKeybindingResult.Type;

export const ServerConfigUpdatedPayload = Schema.Struct({
  issues: ServerConfigIssues,
  providers: ServerProviderStatuses,
});
export type ServerConfigUpdatedPayload = typeof ServerConfigUpdatedPayload.Type;

export const ServerProviderStatusesUpdatedPayload = Schema.Struct({
  providers: ServerProviderStatuses,
});
export type ServerProviderStatusesUpdatedPayload = typeof ServerProviderStatusesUpdatedPayload.Type;

export const ServerSettingsUpdatedPayload = Schema.Struct({
  settings: ServerSettings,
});
export type ServerSettingsUpdatedPayload = typeof ServerSettingsUpdatedPayload.Type;

export const ServerLifecycleWelcomePayload = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  homeDir: Schema.optional(TrimmedNonEmptyString),
  projectName: TrimmedNonEmptyString,
  bootstrapProjectId: Schema.optional(ProjectId),
  bootstrapThreadId: Schema.optional(ThreadId),
});
export type ServerLifecycleWelcomePayload = typeof ServerLifecycleWelcomePayload.Type;

export const ServerLifecycleStreamEvent = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("welcome"),
    payload: ServerLifecycleWelcomePayload,
  }),
  Schema.Struct({
    type: Schema.Literal("ready"),
    payload: Schema.Struct({
      at: IsoDateTime,
    }),
  }),
  Schema.Struct({
    type: Schema.Literal("maintenance"),
    payload: Schema.Struct({
      task: Schema.Literal("thread-retention"),
      state: Schema.Literals(["started", "progress", "compacting", "completed", "failed"]),
      at: IsoDateTime,
      deletedCount: Schema.optional(Schema.Number),
      purgedCount: Schema.optional(Schema.Number),
      totalCount: Schema.optional(Schema.Number),
      freePageCount: Schema.optional(Schema.Number),
      error: Schema.optional(Schema.String),
    }),
  }),
]);
export type ServerLifecycleStreamEvent = typeof ServerLifecycleStreamEvent.Type;

export const ServerConfigStreamEvent = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("snapshot"),
    config: ServerConfig,
  }),
  Schema.Struct({
    type: Schema.Literal("configUpdated"),
    payload: ServerConfigUpdatedPayload,
  }),
  Schema.Struct({
    type: Schema.Literal("providerStatuses"),
    payload: ServerProviderStatusesUpdatedPayload,
  }),
  Schema.Struct({
    type: Schema.Literal("settingsUpdated"),
    payload: ServerSettingsUpdatedPayload,
  }),
]);
export type ServerConfigStreamEvent = typeof ServerConfigStreamEvent.Type;

export const ServerRefreshProvidersResult = ServerProviderStatusesUpdatedPayload;
export type ServerRefreshProvidersResult = typeof ServerRefreshProvidersResult.Type;

export const ServerProviderUpdateInput = Schema.Struct({
  provider: ProviderKind,
});
export type ServerProviderUpdateInput = typeof ServerProviderUpdateInput.Type;

export class ServerProviderUpdateError extends Schema.TaggedErrorClass<ServerProviderUpdateError>()(
  "ServerProviderUpdateError",
  {
    provider: ProviderKind,
    reason: TrimmedNonEmptyString,
  },
) {
  override get message(): string {
    return `Provider update failed for ${this.provider}: ${this.reason}`;
  }
}

export const ServerProviderUpdateResult = ServerProviderStatusesUpdatedPayload;
export type ServerProviderUpdateResult = typeof ServerProviderUpdateResult.Type;

export const ServerGetSettingsResult = ServerSettings;
export type ServerGetSettingsResult = typeof ServerGetSettingsResult.Type;

export const ServerGetEnvironmentResult = ExecutionEnvironmentDescriptor;
export type ServerGetEnvironmentResult = typeof ServerGetEnvironmentResult.Type;

export const ServerUpdateSettingsInput = ServerSettingsPatch;
export type ServerUpdateSettingsInput = typeof ServerUpdateSettingsInput.Type;

export const ServerUpdateSettingsResult = ServerSettings;
export type ServerUpdateSettingsResult = typeof ServerUpdateSettingsResult.Type;

export const ServerListModelProvidersInput = Schema.Struct({
  agentDir: Schema.optional(TrimmedNonEmptyString),
});
export type ServerListModelProvidersInput = typeof ServerListModelProvidersInput.Type;

export const ServerListModelProvidersResult = ModelProvidersFile;
export type ServerListModelProvidersResult = typeof ServerListModelProvidersResult.Type;

export const ServerSaveModelProvidersInput = Schema.Struct({
  agentDir: Schema.optional(TrimmedNonEmptyString),
  providers: ModelProvidersFile.fields.providers,
});
export type ServerSaveModelProvidersInput = typeof ServerSaveModelProvidersInput.Type;

export const ServerSaveModelProvidersResult = ModelProvidersFile;
export type ServerSaveModelProvidersResult = typeof ServerSaveModelProvidersResult.Type;

export const ServerTestModelProviderInput = Schema.Struct({
  agentDir: Schema.optional(TrimmedNonEmptyString),
  provider: TrimmedNonEmptyString,
  modelId: Schema.optional(TrimmedNonEmptyString),
});
export type ServerTestModelProviderInput = typeof ServerTestModelProviderInput.Type;

export const ServerTestModelProviderResult = Schema.Struct({
  status: Schema.Literals([
    "success",
    "invalid-config",
    "model-not-found",
    "auth-missing",
    "timeout",
    "request-failed",
  ]),
  model: Schema.optional(Schema.String),
});
export type ServerTestModelProviderResult = typeof ServerTestModelProviderResult.Type;

export const ServerListPiPackagesInput = Schema.Struct({
  agentDir: Schema.optional(TrimmedNonEmptyString),
});
export type ServerListPiPackagesInput = typeof ServerListPiPackagesInput.Type;

export const ServerListPiPackagesResult = PiPackagesSnapshot;
export type ServerListPiPackagesResult = typeof ServerListPiPackagesResult.Type;

export const ServerInstallPiPackageInput = Schema.Struct({
  agentDir: Schema.optional(TrimmedNonEmptyString),
  /** A pi source: `npm:@scope/pkg`, `git:host/user/repo`, or an absolute/relative path. */
  source: TrimmedNonEmptyString,
});
export type ServerInstallPiPackageInput = typeof ServerInstallPiPackageInput.Type;

export const ServerInstallPiPackageResult = PiPackagesSnapshot;
export type ServerInstallPiPackageResult = typeof ServerInstallPiPackageResult.Type;

export const ServerRemovePiPackageInput = Schema.Struct({
  agentDir: Schema.optional(TrimmedNonEmptyString),
  source: TrimmedNonEmptyString,
});
export type ServerRemovePiPackageInput = typeof ServerRemovePiPackageInput.Type;

export const ServerRemovePiPackageResult = PiPackagesSnapshot;
export type ServerRemovePiPackageResult = typeof ServerRemovePiPackageResult.Type;
