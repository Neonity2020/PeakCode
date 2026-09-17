import * as NodeServices from "@effect/platform-node/NodeServices";
import { Layer } from "effect";

import { CheckpointDiffQueryLive } from "./checkpointing/Layers/CheckpointDiffQuery";
import { CheckpointStoreLive } from "./checkpointing/Layers/CheckpointStore";
import { CheckpointReactorLive } from "./orchestration/Layers/CheckpointReactor";
import { GoalContinuationReactorLive } from "./orchestration/Layers/GoalContinuationReactor";
import { OrchestrationReactorLive } from "./orchestration/Layers/OrchestrationReactor";
import { ProviderCommandReactorLive } from "./orchestration/Layers/ProviderCommandReactor";
import { ProviderRuntimeIngestionLive } from "./orchestration/Layers/ProviderRuntimeIngestion";
import { RuntimeReceiptBusLive } from "./orchestration/Layers/RuntimeReceiptBus";
import { ThreadDeletionReactorLive } from "./orchestration/Layers/ThreadDeletionReactor";
import { OrchestrationLayerLive } from "./orchestration/runtimeLayer";

import { KeybindingsLive } from "./keybindings";
import { GitCoreLive } from "./git/Layers/GitCore";
import { GitLayerLive, TextGenerationLayerLive } from "./git/runtimeLayer";
import { TerminalLayerLive } from "./terminal/runtimeLayer";
import { AuthControlPlaneLive } from "./auth/Layers/AuthControlPlane";
import { BootstrapCredentialServiceLive } from "./auth/Layers/BootstrapCredentialService";
import { ServerAuthLive } from "./auth/Layers/ServerAuth";
import { ServerAuthPolicyLive } from "./auth/Layers/ServerAuthPolicy";
import { ServerSecretStoreLive } from "./auth/Layers/ServerSecretStore";
import { SessionCredentialServiceLive } from "./auth/Layers/SessionCredentialService";
import { ServerLifecycleEventsLive } from "./serverLifecycleEvents";
import { ServerRuntimeStartupLive } from "./serverRuntimeStartup";
import { ServerSettingsLive } from "./serverSettings";
import { WorkspaceLayerLive } from "./workspace/runtimeLayer";
import { ProjectFaviconResolverLive } from "./project/Layers/ProjectFaviconResolver";
import { ServerEnvironmentLive } from "./environment/Layers/ServerEnvironment";
import { AutomationServiceLive } from "./automation/Layers/AutomationService";
import { AutomationRunReactorLive } from "./automation/Layers/AutomationRunReactor";
import { ImServiceLive } from "./im/Layers/ImService";
import { AutomationRepositoryLive } from "./persistence/Layers/Automations";
import { ImConversationRepositoryLive } from "./persistence/Layers/ImConversations";
import { KanbanRunReactorLive } from "./kanban/Layers/KanbanRunReactor";
import { KanbanServiceLive } from "./kanban/Layers/KanbanService";

import { makeServerProviderLayer } from "./provider/runtimeLayer";

export { makeServerProviderLayer };

/** The provider stack (sessions, discovery) as `main.ts` builds it. */
export type ServerProviderLayer = ReturnType<typeof makeServerProviderLayer>;

export function makeServerRuntimeServicesLayer(providerLayer: ServerProviderLayer) {
  const checkpointStoreLayer = CheckpointStoreLive.pipe(Layer.provide(GitCoreLive));

  const checkpointDiffQueryLayer = CheckpointDiffQueryLive.pipe(
    Layer.provideMerge(OrchestrationLayerLive),
    Layer.provideMerge(checkpointStoreLayer),
  );

  const runtimeServicesLayer = Layer.mergeAll(
    OrchestrationLayerLive,
    checkpointStoreLayer,
    checkpointDiffQueryLayer,
    RuntimeReceiptBusLive,
  );
  const automationServiceLayer = AutomationServiceLive.pipe(
    Layer.provide(AutomationRepositoryLive),
    Layer.provideMerge(runtimeServicesLayer),
    // Scheduled runs resolve a model from the provider, like the IM bridge does — and the
    // default model for runs with no composer comes from the settings.
    Layer.provide(ServerSettingsLive),
    Layer.provide(providerLayer),
  );
  const automationRunReactorLayer = AutomationRunReactorLive.pipe(
    Layer.provideMerge(automationServiceLayer),
  );
  const kanbanServiceLayer = KanbanServiceLive.pipe(
    Layer.provideMerge(runtimeServicesLayer),
    Layer.provideMerge(WorkspaceLayerLive),
    Layer.provideMerge(TextGenerationLayerLive),
    // Board runs resolve a model too, and fall back to the configured default.
    Layer.provide(ServerSettingsLive),
    Layer.provide(providerLayer),
  );
  const kanbanRunReactorLayer = KanbanRunReactorLive.pipe(Layer.provideMerge(kanbanServiceLayer));
  const runtimeIngestionLayer = ProviderRuntimeIngestionLive.pipe(
    Layer.provideMerge(runtimeServicesLayer),
  );
  const providerCommandReactorLayer = ProviderCommandReactorLive.pipe(
    Layer.provideMerge(runtimeServicesLayer),
    Layer.provideMerge(GitCoreLive),
    Layer.provideMerge(TextGenerationLayerLive),
    Layer.provideMerge(ServerSettingsLive),
  );
  const checkpointReactorLayer = CheckpointReactorLive.pipe(
    Layer.provideMerge(runtimeServicesLayer),
  );
  const goalContinuationReactorLayer = GoalContinuationReactorLive.pipe(
    Layer.provideMerge(runtimeServicesLayer),
  );
  const orchestrationReactorLayer = OrchestrationReactorLive.pipe(
    Layer.provideMerge(runtimeIngestionLayer),
    Layer.provideMerge(providerCommandReactorLayer),
    Layer.provideMerge(checkpointReactorLayer),
    Layer.provideMerge(goalContinuationReactorLayer),
  );
  const threadDeletionReactorLayer = ThreadDeletionReactorLive.pipe(
    Layer.provideMerge(OrchestrationLayerLive),
    Layer.provideMerge(TerminalLayerLive),
  );
  const sessionCredentialLayer = SessionCredentialServiceLive.pipe(
    Layer.provide(ServerSecretStoreLive),
  );
  const authControlPlaneLayer = AuthControlPlaneLive.pipe(
    Layer.provide(BootstrapCredentialServiceLive),
    Layer.provide(sessionCredentialLayer),
  );
  const serverAuthLayer = ServerAuthLive.pipe(
    Layer.provide(ServerAuthPolicyLive),
    Layer.provide(BootstrapCredentialServiceLive),
    Layer.provide(sessionCredentialLayer),
    Layer.provide(authControlPlaneLayer),
  );
  const authServicesLayer = Layer.mergeAll(
    ServerAuthPolicyLive,
    ServerSecretStoreLive,
    BootstrapCredentialServiceLive,
    sessionCredentialLayer,
    authControlPlaneLayer,
    serverAuthLayer,
  );

  // The IM bridge dispatches turns through the orchestration engine, reads their results
  // back from the projection, stores its chat→thread index, and mints the phone pairing
  // credential — hence the auth layer alongside the runtime services.
  const imServiceLayer = ImServiceLive.pipe(
    Layer.provide(ImConversationRepositoryLive),
    Layer.provide(runtimeServicesLayer),
    Layer.provide(ServerSettingsLive),
    Layer.provide(authServicesLayer),
    // The bridge asks the provider which models exist before it opens a thread; the
    // caller's stack is reused so there is one pi runtime, not two.
    Layer.provide(providerLayer),
  );

  return Layer.mergeAll(
    orchestrationReactorLayer,
    threadDeletionReactorLayer,
    GitLayerLive,
    TerminalLayerLive,
    KeybindingsLive,
    ServerSettingsLive,
    ServerEnvironmentLive,
    authServicesLayer,
    ServerLifecycleEventsLive,
    ServerRuntimeStartupLive,
    WorkspaceLayerLive,
    ProjectFaviconResolverLive,
    automationServiceLayer,
    automationRunReactorLayer,
    kanbanServiceLayer,
    kanbanRunReactorLayer,
    imServiceLayer,
  ).pipe(Layer.provideMerge(NodeServices.layer));
}
