import type { ProviderModelDescriptor } from "@peakcode/contracts";
import type {
  ProviderComposerCapabilities,
  ProviderGetComposerCapabilitiesInput,
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
  ProviderReadPluginInput,
  ProviderReadPluginResult,
} from "@peakcode/contracts";
import { Effect, Layer, ServiceMap } from "effect";

import type { ProviderAdapterError, ProviderValidationError } from "../Errors.ts";
import { ProviderUnsupportedError } from "../Errors.ts";

export type ProviderDiscoveryError =
  | ProviderValidationError
  | ProviderUnsupportedError
  | ProviderAdapterError;

export interface ProviderDiscoveryServiceShape {
  readonly getComposerCapabilities: (
    input: ProviderGetComposerCapabilitiesInput,
  ) => Effect.Effect<ProviderComposerCapabilities, ProviderDiscoveryError>;
  readonly listCommands: (
    input: ProviderListCommandsInput,
  ) => Effect.Effect<ProviderListCommandsResult, ProviderDiscoveryError>;
  readonly listSkills: (
    input: ProviderListSkillsInput,
  ) => Effect.Effect<ProviderListSkillsResult, ProviderDiscoveryError>;
  readonly listPlugins: (
    input: ProviderListPluginsInput,
  ) => Effect.Effect<ProviderListPluginsResult, ProviderDiscoveryError>;
  readonly readPlugin: (
    input: ProviderReadPluginInput,
  ) => Effect.Effect<ProviderReadPluginResult, ProviderDiscoveryError>;
  readonly listModels: (
    input: ProviderListModelsInput,
  ) => Effect.Effect<ProviderListModelsResult, ProviderDiscoveryError>;
  readonly listAgents: (
    input: ProviderListAgentsInput,
  ) => Effect.Effect<ProviderListAgentsResult, ProviderDiscoveryError>;
}

export class ProviderDiscoveryService extends ServiceMap.Service<
  ProviderDiscoveryService,
  ProviderDiscoveryServiceShape
>()("t3/provider/Services/ProviderDiscoveryService") {
  /**
   * Test layer: a discovery service that answers `listModels` with a fixed list and dies on
   * everything else. Features that resolve a model for a headless run use it to assert the
   * slug they dispatch with.
   */
  static readonly layerTest = (input: {
    readonly models: ReadonlyArray<ProviderModelDescriptor>;
    readonly fail?: boolean;
  }) =>
    Layer.succeed(
      ProviderDiscoveryService,
      ProviderDiscoveryService.of({
        getComposerCapabilities: () =>
          Effect.die("ProviderDiscoveryService.getComposerCapabilities"),
        listCommands: () => Effect.die("ProviderDiscoveryService.listCommands"),
        listSkills: () => Effect.die("ProviderDiscoveryService.listSkills"),
        listPlugins: () => Effect.die("ProviderDiscoveryService.listPlugins"),
        readPlugin: () => Effect.die("ProviderDiscoveryService.readPlugin"),
        listAgents: () => Effect.die("ProviderDiscoveryService.listAgents"),
        listModels: () =>
          input.fail === true
            ? Effect.fail(new ProviderUnsupportedError({ provider: "pi" }))
            : Effect.succeed({ models: [...input.models] }),
      }),
    );
}
