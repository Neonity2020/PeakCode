// FILE: resolveHeadlessModelSelection.ts
// Purpose: One answer to "which model does a run with no composer behind it use?".
// Layer: Provider support
// Exports: resolveHeadlessModelSelection

import type { ModelSelection } from "@peakcode/contracts";
import { resolveSelectableModel } from "@peakcode/shared/model";
import { Effect } from "effect";

import { ServerSettingsService, type ServerSettingsShape } from "../serverSettings.ts";
import { ProviderDiscoveryService } from "./Services/ProviderDiscoveryService.ts";

const HEADLESS_PROVIDER = "pi" as const;

/**
 * The server-wide default for new chats, or null when nobody configured one.
 *
 * Settings that cannot be read are treated as "no default": this decides *which* model a
 * background run uses, and the first discoverable model is a fine answer for that.
 */
const readDefaultModelSelection = (
  settingsService: Pick<ServerSettingsShape, "getSettings">,
): Effect.Effect<ModelSelection | null> =>
  settingsService.getSettings.pipe(
    Effect.map((settings) => settings.defaultModelSelection ?? null),
    Effect.catch(() => Effect.succeed(null)),
  );

/**
 * Which model a run should use, or null when there is nothing usable yet.
 *
 * Automations, kanban cards and IM chats all open a thread and send it a message without a
 * person picking a model. The constant `pi/default` slug they used to fall back to does not
 * exist on a real install — the turn died on its first request with "model is not
 * available". So: the workspace default wins when it is set, then the server-wide default
 * somebody configured, and otherwise the first model the provider offers.
 *
 * A configured default is only used while the provider still offers it. Endpoints come and
 * go — a gateway stops serving the slug it served last week — and a headless run that keeps
 * the stale slug fails every single time with nobody there to change it, which reads as
 * "the bot never answers". Falling back to an offered model keeps the reply coming; the
 * choice itself is left alone so the settings screen can still show what was configured.
 */
export const resolveHeadlessModelSelection = (input: {
  readonly projectDefault: ModelSelection | null;
}): Effect.Effect<ModelSelection | null, never, ProviderDiscoveryService | ServerSettingsService> =>
  Effect.gen(function* () {
    const settingsService = yield* ServerSettingsService;
    const serverDefault =
      input.projectDefault === null ? yield* readDefaultModelSelection(settingsService) : null;
    const discovery = yield* ProviderDiscoveryService;
    const discoveredSlugs = yield* discovery.listModels({ provider: HEADLESS_PROVIDER }).pipe(
      Effect.map((result) => result.models.map((model) => model.slug)),
      Effect.catch(() => Effect.succeed([] as ReadonlyArray<string>)),
    );
    return pickHeadlessModelSelection({
      projectDefault: input.projectDefault,
      serverDefault,
      discoveredSlugs,
    });
  });

/** The same decision, without the effect: used by tests and by callers that already know the slugs. */
export function pickHeadlessModelSelection(input: {
  readonly projectDefault: ModelSelection | null;
  readonly serverDefault?: ModelSelection | null;
  readonly discoveredSlugs: ReadonlyArray<string>;
}): ModelSelection | null {
  const offered = offeredSlugFor(input.projectDefault, input.discoveredSlugs);
  if (offered !== null) return { provider: HEADLESS_PROVIDER, model: offered };
  if (input.projectDefault !== null && input.discoveredSlugs.length === 0) {
    return input.projectDefault;
  }

  const offeredDefault = offeredSlugFor(input.serverDefault ?? null, input.discoveredSlugs);
  if (offeredDefault !== null) return { provider: HEADLESS_PROVIDER, model: offeredDefault };
  if (
    input.serverDefault !== undefined &&
    input.serverDefault !== null &&
    input.discoveredSlugs.length === 0
  ) {
    return input.serverDefault;
  }

  const first = input.discoveredSlugs[0];
  return first === undefined ? null : { provider: HEADLESS_PROVIDER, model: first };
}

/**
 * The discovered slug a configured selection refers to, or null when it is not on offer.
 *
 * Matching goes through the same alias resolution the composer uses, so a stored
 * `5.3`-style short name still finds `anthropic/claude-…`; an empty catalogue means the
 * provider could not be asked, which is not the same as "not offered".
 */
function offeredSlugFor(
  selection: ModelSelection | null,
  discoveredSlugs: ReadonlyArray<string>,
): string | null {
  if (selection === null || discoveredSlugs.length === 0) return null;
  return resolveSelectableModel(
    HEADLESS_PROVIDER,
    selection.model,
    discoveredSlugs.map((slug) => ({ slug, name: slug })),
  );
}

/**
 * A resolver a service can hold: it captures the provider once at layer construction, so
 * callers do not carry the discovery service through every effect they return.
 */
export interface HeadlessModelResolver {
  /** The model a headless run should use, or null when there is nothing usable yet. */
  readonly resolve: (projectDefault: ModelSelection | null) => Effect.Effect<ModelSelection | null>;
}

export const makeHeadlessModelResolver: Effect.Effect<
  HeadlessModelResolver,
  never,
  ProviderDiscoveryService | ServerSettingsService
> = Effect.gen(function* () {
  const discovery = yield* ProviderDiscoveryService;
  const settingsService = yield* ServerSettingsService;
  const discover = discovery.listModels({ provider: HEADLESS_PROVIDER }).pipe(
    Effect.map((result) => result.models.map((model) => model.slug)),
    Effect.catch(() => Effect.succeed([] as ReadonlyArray<string>)),
  );
  return {
    resolve: (projectDefault) =>
      Effect.gen(function* () {
        // Read at call time: the default can be changed while the server runs.
        const serverDefault =
          projectDefault === null ? yield* readDefaultModelSelection(settingsService) : null;
        const discoveredSlugs = yield* discover;
        return pickHeadlessModelSelection({
          projectDefault,
          serverDefault,
          discoveredSlugs,
        });
      }),
  } satisfies HeadlessModelResolver;
});
