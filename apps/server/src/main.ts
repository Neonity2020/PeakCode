/**
 * CliConfig - CLI/runtime bootstrap service definitions.
 *
 * Defines startup-only service contracts used while resolving process config
 * and constructing server runtime layers.
 *
 * @module CliConfig
 */
import OS from "node:os";
import { Config, Data, Effect, FileSystem, Layer, Option, Path, Schema, ServiceMap } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { NetService } from "@peakcode/shared/Net";
import { createFileShellEnvironmentCache } from "@peakcode/shared/shellEnvironment";
import {
  DEFAULT_PORT,
  deriveServerPaths,
  resolveStaticDir,
  ServerConfig,
  type RuntimeMode,
  type ServerConfigShape,
} from "./config";
import { configureAgentToolkit, openAgentToolkitStore } from "./agentToolkit";
import {
  ensureDefaultSkillPacks,
  type SkillPackResult,
} from "@peakcode/agent-toolkit/skills/default-pack";
import { installBundledSkills } from "@peakcode/agent-toolkit/skills/bundled";
import { bundledPluginSkills } from "@peakcode/agent-toolkit/plugins/registry";
import { makeAutomationToolHost, setAutomationToolHost } from "./automation/automationTool";
import { makeBrowserToolHost, setBrowserToolHost } from "./browser/browserTool";
import { createComputerUseClient } from "./computer/computerUseClient";
import { DefaultComputerToolHost, setComputerToolHost } from "./computer/computerTool";
import { makeKanbanToolHost, setKanbanToolHost } from "./kanban/kanbanTool";
import { createLogger } from "./logger";
import { migrateLegacyHomeIfNeeded } from "./homeMigration";
import { fixPath, resolveBaseDir } from "./os-jank";
import { Open } from "./open";
import * as SqlitePersistence from "./persistence/Layers/Sqlite";
import { makeServerProviderLayer, makeServerRuntimeServicesLayer } from "./serverLayers";
import { ProjectionSnapshotQuery } from "./orchestration/Services/ProjectionSnapshotQuery";
import { ProviderHealthLive } from "./provider/Layers/ProviderHealth";
import { ProviderSessionReaperLive } from "./provider/Layers/ProviderSessionReaper";
import { Server } from "./effectServer";
import { ServerLoggerLive } from "./serverLogger";
import { formatHostForUrl, isWildcardHost } from "./startupAccess";
import { AnalyticsServiceLayerLive } from "./telemetry/Layers/AnalyticsService";
import { AnalyticsService } from "./telemetry/Services/AnalyticsService";
import { OrchestrationEngineService } from "./orchestration/Services/OrchestrationEngine";
import { startThreadRetentionJob } from "./threadRetention";

export class StartupError extends Data.TaggedError("StartupError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

interface CliInput {
  readonly mode: Option.Option<RuntimeMode>;
  readonly port: Option.Option<number>;
  readonly host: Option.Option<string>;
  readonly peakcodeHome: Option.Option<string>;
  readonly devUrl: Option.Option<URL>;
  readonly noBrowser: Option.Option<boolean>;
  readonly authToken: Option.Option<string>;
  readonly autoBootstrapProjectFromCwd: Option.Option<boolean>;
  readonly logProviderEvents: Option.Option<boolean>;
  readonly logWebSocketEvents: Option.Option<boolean>;
}

/**
 * CliConfigShape - Startup helpers required while building server layers.
 */
export interface CliConfigShape {
  /**
   * Current process working directory.
   */
  readonly cwd: string;

  /**
   * Apply OS-specific PATH normalization.
   */
  readonly fixPath: Effect.Effect<void>;

  /**
   * Resolve static web asset directory for server mode.
   */
  readonly resolveStaticDir: Effect.Effect<string | undefined>;
}

/**
 * CliConfig - Service tag for startup CLI/runtime helpers.
 */
export class CliConfig extends ServiceMap.Service<CliConfig, CliConfigShape>()(
  "t3/main/CliConfig",
) {
  static readonly layer = Layer.effect(
    CliConfig,
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      return {
        cwd: process.cwd(),
        // Reuse the capture the desktop wrote for this launch (and the one from the last
        // launch when the shell's startup files are unchanged) instead of starting a login
        // shell on every boot.
        fixPath: Effect.sync(() => fixPath({ cache: createFileShellEnvironmentCache() })),
        resolveStaticDir: resolveStaticDir().pipe(
          Effect.provideService(FileSystem.FileSystem, fileSystem),
          Effect.provideService(Path.Path, path),
        ),
      } satisfies CliConfigShape;
    }),
  );
}

const CliEnvConfig = Config.all({
  mode: Config.string("PEAKCODE_MODE").pipe(
    Config.option,
    Config.map(
      Option.match<RuntimeMode, string>({
        onNone: () => "web",
        onSome: (value) => (value === "desktop" ? "desktop" : "web"),
      }),
    ),
  ),
  port: Config.port("PEAKCODE_PORT").pipe(Config.option, Config.map(Option.getOrUndefined)),
  host: Config.string("PEAKCODE_HOST").pipe(Config.option, Config.map(Option.getOrUndefined)),
  peakcodeHome: Config.string("PEAKCODE_HOME").pipe(
    Config.option,
    Config.map(Option.getOrUndefined),
  ),
  devUrl: Config.url("VITE_DEV_SERVER_URL").pipe(Config.option, Config.map(Option.getOrUndefined)),
  noBrowser: Config.boolean("PEAKCODE_NO_BROWSER").pipe(
    Config.option,
    Config.map(Option.getOrUndefined),
  ),
  browserUsePipePath: Config.string("PEAKCODE_BROWSER_USE_PIPE_PATH").pipe(
    Config.option,
    Config.map(Option.getOrUndefined),
  ),
  authToken: Config.string("PEAKCODE_AUTH_TOKEN").pipe(
    Config.option,
    Config.map(Option.getOrUndefined),
  ),
  autoBootstrapProjectFromCwd: Config.boolean("PEAKCODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD").pipe(
    Config.option,
    Config.map(Option.getOrUndefined),
  ),
  logProviderEvents: Config.boolean("PEAKCODE_LOG_PROVIDER_EVENTS").pipe(
    Config.option,
    Config.map(Option.getOrUndefined),
  ),
  logWebSocketEvents: Config.boolean("PEAKCODE_LOG_WS_EVENTS").pipe(
    Config.option,
    Config.map(Option.getOrUndefined),
  ),
});

const resolveBooleanFlag = (flag: Option.Option<boolean>, envValue: boolean) =>
  Option.getOrElse(Option.filter(flag, Boolean), () => envValue);

const ServerConfigLive = (input: CliInput) =>
  Layer.effect(
    ServerConfig,
    Effect.gen(function* () {
      const cliConfig = yield* CliConfig;
      const { findAvailablePort } = yield* NetService;
      const env = yield* CliEnvConfig.asEffect().pipe(
        Effect.mapError(
          (cause) =>
            new StartupError({ message: "Failed to read environment configuration", cause }),
        ),
      );

      const mode = Option.getOrElse(input.mode, () => env.mode);

      const port = yield* Option.match(input.port, {
        onSome: (value) => Effect.succeed(value),
        onNone: () => {
          if (env.port) {
            return Effect.succeed(env.port);
          }
          if (mode === "desktop") {
            return Effect.succeed(DEFAULT_PORT);
          }
          return findAvailablePort(DEFAULT_PORT);
        },
      });

      const devUrl = Option.getOrElse(input.devUrl, () => env.devUrl);
      const baseDir = yield* resolveBaseDir(
        Option.getOrUndefined(input.peakcodeHome) ?? env.peakcodeHome,
      );
      // Import legacy ~/.t3 state before runtime paths are derived under ~/.peakcode.
      yield* migrateLegacyHomeIfNeeded({
        baseDir,
        homeDir: OS.homedir(),
        devUrl,
      }).pipe(
        Effect.mapError(
          (cause) =>
            new StartupError({
              message: "Failed to migrate legacy T3 home directory",
              cause,
            }),
        ),
      );
      const derivedPaths = yield* deriveServerPaths(baseDir, devUrl);
      const noBrowser = resolveBooleanFlag(input.noBrowser, env.noBrowser ?? mode === "desktop");
      const authToken = Option.getOrUndefined(input.authToken) ?? env.authToken;
      const autoBootstrapProjectFromCwd = resolveBooleanFlag(
        input.autoBootstrapProjectFromCwd,
        env.autoBootstrapProjectFromCwd ?? mode === "web",
      );
      // Provider event NDJSON logging is helpful for debugging, but it is too
      // expensive to keep enabled on the streaming hot path by default.
      const logProviderEvents = resolveBooleanFlag(
        input.logProviderEvents,
        env.logProviderEvents ?? false,
      );
      // Keep websocket payload logging opt-in in dev. Terminal/TUI traffic is
      // high-volume enough that automatic logging adds noticeable CPU and I/O.
      const logWebSocketEvents = resolveBooleanFlag(
        input.logWebSocketEvents,
        env.logWebSocketEvents ?? false,
      );
      const staticDir = devUrl ? undefined : yield* cliConfig.resolveStaticDir;
      const host =
        Option.getOrUndefined(input.host) ??
        env.host ??
        (mode === "desktop" ? "127.0.0.1" : undefined);
      // Present only under the desktop app: the window that hosts the browser pane creates
      // the pipe and passes its path down. Absent means "this session has no browser", which
      // is why the tool is registered from this value rather than from a setting.
      const browserUsePipePath = env.browserUsePipePath?.trim();

      const config: ServerConfigShape = {
        mode,
        port,
        cwd: cliConfig.cwd,
        homeDir: OS.homedir(),
        host,
        baseDir,
        ...derivedPaths,
        staticDir,
        devUrl,
        noBrowser,
        authToken,
        autoBootstrapProjectFromCwd,
        logProviderEvents,
        logWebSocketEvents,
        ...(browserUsePipePath === undefined || browserUsePipePath.length === 0
          ? {}
          : { browserUsePipePath }),
      } satisfies ServerConfigShape;

      return config;
    }),
  );

const LayerLive = (input: CliInput) => {
  // One provider stack (sessions, discovery) for the whole app: the server's own fibers
  // resolve it here, and the runtime services hand the same instance to the IM bridge.
  const providerLayer = makeServerProviderLayer();
  const runtimeServicesLayer = makeServerRuntimeServicesLayer(providerLayer);
  const providerHealthLayer = ProviderHealthLive.pipe(
    // Provider health reads persisted provider settings while constructing its
    // cache, so build it with the same runtime services layer exposed to Server.
    Layer.provideMerge(runtimeServicesLayer),
  );
  const providerSessionReaperLayer = ProviderSessionReaperLive.pipe(
    // The reaper coordinates orchestration state with live provider sessions,
    // so it belongs at the top level where both layers are available.
    Layer.provideMerge(runtimeServicesLayer),
    Layer.provideMerge(providerLayer),
  );

  return Layer.empty.pipe(
    Layer.provideMerge(runtimeServicesLayer),
    Layer.provideMerge(providerLayer),
    Layer.provideMerge(providerHealthLayer),
    Layer.provideMerge(providerSessionReaperLayer),
    Layer.provideMerge(SqlitePersistence.layerConfig),
    Layer.provideMerge(ServerLoggerLive),
    Layer.provideMerge(AnalyticsServiceLayerLive),
    Layer.provideMerge(ServerConfigLive(input)),
  );
};

export const recordStartupHeartbeat = Effect.gen(function* () {
  const analytics = yield* AnalyticsService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;

  const { threadCount, projectCount } = yield* projectionSnapshotQuery.getCounts().pipe(
    Effect.catch((cause) =>
      Effect.logWarning("failed to gather startup projection counts for telemetry", { cause }).pipe(
        Effect.as({
          threadCount: 0,
          projectCount: 0,
        }),
      ),
    ),
  );

  yield* analytics.record("server.boot.heartbeat", {
    threadCount,
    projectCount,
  });
});

const makeServerProgram = (input: CliInput) =>
  Effect.gen(function* () {
    const cliConfig = yield* CliConfig;
    const { start, stopSignal } = yield* Server;
    const openDeps = yield* Open;
    yield* cliConfig.fixPath;

    const config = yield* ServerConfig;

    // Point the agent toolkit at this server's state directory and route its diagnostics
    // into the server log. Must happen before any provider session starts.
    yield* Effect.sync(() => {
      const agentToolkitLog = createLogger("agent-toolkit");
      const store = openAgentToolkitStore(config.dbPath);
      if (!store) {
        agentToolkitLog.warn(
          "agent toolkit state is falling back to memory (state.sqlite could not be opened)",
        );
      }
      configureAgentToolkit({
        stateDir: config.stateDir,
        store: store ?? undefined,
        log: (entry) => {
          const context =
            entry.detail === undefined ? undefined : { detail: JSON.stringify(entry.detail) };
          switch (entry.level) {
            case "error":
              agentToolkitLog.error(`${entry.event}: ${entry.message}`, context);
              break;
            case "warn":
              agentToolkitLog.warn(`${entry.event}: ${entry.message}`, context);
              break;
            default:
              agentToolkitLog.info(`${entry.event}: ${entry.message}`, context);
          }
        },
      });
    });

    // Bind the `schedule_task` tool to the running server, next to the toolkit store above.
    // It has to be in place before any provider session starts: the tool reads it when the
    // model calls it, so a session that outlived a rebind would hold a stale host.
    const automationToolHost = yield* makeAutomationToolHost;
    yield* Effect.sync(() => setAutomationToolHost(automationToolHost));

    // Same for `kanban_comment`: a board-dispatched run reports each finished step onto its
    // card through this host, so it has to exist before the first task is handed to an agent.
    const kanbanToolHost = yield* makeKanbanToolHost;
    yield* Effect.sync(() => setKanbanToolHost(kanbanToolHost));

    /**
     * `browser` is installed only when the desktop handed us a pipe path.
     *
     * No path means no pane, and the provider registers the tool from whether this host
     * exists — so a headless or CLI server never advertises a browser it cannot drive.
     */
    yield* Effect.sync(() => {
      const pipePath = config.browserUsePipePath;
      setBrowserToolHost(pipePath === undefined ? null : makeBrowserToolHost({ pipePath }));
    });

    /**
     * `computer` is installed only when the native helper answers.
     *
     * The helper is a separate app that the desktop installs and starts, so the server probes
     * for it rather than assuming: a socket that nobody is listening on, a closed socket, or a
     * helper from an older protocol all resolve to "no tool", and the provider then never
     * advertises desktop control this session cannot carry out. The probe is bounded, so a
     * helper that is slow to appear costs a start-up pause rather than a hang.
     */
    yield* Effect.promise(async () => {
      const client = createComputerUseClient();
      try {
        const status = await client.statusOrNull();
        setComputerToolHost(status === null ? null : new DefaultComputerToolHost(client));
      } catch {
        setComputerToolHost(null);
      }
    });

    // Keep the default engineering-workflow skill pack present in the shared library the
    // agent reads (`~/.agents/skills`). The workflow section of the system prompt names those
    // skills, so an install that has never run the skills CLI would otherwise advertise
    // skills the model cannot open. Forked on purpose: it may reach the network through npx,
    // and a fresh machine paying for that must not hold up the server.
    yield* Effect.forkChild(
      Effect.gen(function* () {
        const results = yield* Effect.tryPromise({
          try: () => ensureDefaultSkillPacks(),
          catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
        }).pipe(
          Effect.catch((error) =>
            Effect.logWarning("default skill pack check failed", { cause: error.message }).pipe(
              Effect.as<SkillPackResult[]>([]),
            ),
          ),
        );
        for (const result of results) {
          if (result.status === "installed") {
            yield* Effect.logInfo("default skill pack installed", { pack: result.pack });
          } else if (result.status === "failed") {
            yield* Effect.logWarning("default skill pack unavailable", {
              pack: result.pack,
              detail: result.detail,
            });
          }
        }

        // The in-tree oh-my-pi skills cannot come from the GitHub pack, so they are written
        // from the embedded payload. Same switch (`AGENT_SKILL_PACKS`) and same create-only
        // contract; this path never touches the network.
        for (const result of installBundledSkills()) {
          if (result.status === "installed") {
            yield* Effect.logInfo("bundled skill installed", { skill: result.skill });
          } else if (result.status === "failed") {
            yield* Effect.logWarning("bundled skill unavailable", {
              skill: result.skill,
              detail: result.detail,
            });
          }
        }

        // Skills that belong to a bundled plugin (browser-use, computer-use) ride the same
        // installer and the same library. A plugin's manifest is served from the embedded
        // registry, but its skill has to be on disk for the agent to read it and for the
        // composer to offer it, so it is written exactly like any other bundled skill.
        for (const result of installBundledSkills({ skills: bundledPluginSkills() })) {
          if (result.status === "installed") {
            yield* Effect.logInfo("bundled plugin skill installed", { skill: result.skill });
          } else if (result.status === "failed") {
            yield* Effect.logWarning("bundled plugin skill unavailable", {
              skill: result.skill,
              detail: result.detail,
            });
          }
        }
      }),
    );

    if (!config.devUrl && !config.staticDir) {
      yield* Effect.logWarning(
        "web bundle missing and no VITE_DEV_SERVER_URL; web UI unavailable",
        {
          hint: "Run `bun run --cwd apps/web build` or set VITE_DEV_SERVER_URL for dev mode.",
        },
      );
    }

    yield* start;
    const orchestrationEngine = yield* OrchestrationEngineService;
    const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
    // Start the retention loop after the server is live so startup can serve
    // existing history first, then prune inactive threads in the background.
    yield* startThreadRetentionJob(orchestrationEngine, projectionSnapshotQuery);
    yield* Effect.forkChild(recordStartupHeartbeat);

    const localUrl = `http://localhost:${config.port}`;
    const bindUrl =
      config.host && !isWildcardHost(config.host)
        ? `http://${formatHostForUrl(config.host)}:${config.port}`
        : localUrl;
    const { authToken, devUrl, ...safeConfig } = config;
    yield* Effect.logInfo("Peak Code running", {
      ...safeConfig,
      devUrl: devUrl?.toString(),
      authEnabled: Boolean(authToken),
    });

    if (!config.noBrowser) {
      const target = config.devUrl?.toString() ?? bindUrl;
      yield* openDeps.openBrowser(target).pipe(
        Effect.catch(() =>
          Effect.logInfo("browser auto-open unavailable", {
            hint: `Open ${target} in your browser.`,
          }),
        ),
      );
    }

    return yield* stopSignal;
  }).pipe(Effect.provide(LayerLive(input)));

/**
 * These flags mirrors the environment variables and the config shape.
 */

const modeFlag = Flag.choice("mode", ["web", "desktop"]).pipe(
  Flag.withDescription("Runtime mode. `desktop` keeps loopback defaults unless overridden."),
  Flag.optional,
);
const portFlag = Flag.integer("port").pipe(
  Flag.withSchema(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 }))),
  Flag.withDescription("Port for the HTTP/WebSocket server."),
  Flag.optional,
);
const hostFlag = Flag.string("host").pipe(
  Flag.withDescription("Host/interface to bind (for example 127.0.0.1, 0.0.0.0, or a Tailnet IP)."),
  Flag.optional,
);
const peakcodeHomeFlag = Flag.string("home-dir").pipe(
  Flag.withDescription("Base directory for all Peak Code data (equivalent to PEAKCODE_HOME)."),
  Flag.optional,
);
const devUrlFlag = Flag.string("dev-url").pipe(
  Flag.withSchema(Schema.URLFromString),
  Flag.withDescription("Dev web URL to proxy/redirect to (equivalent to VITE_DEV_SERVER_URL)."),
  Flag.optional,
);
const noBrowserFlag = Flag.boolean("no-browser").pipe(
  Flag.withDescription("Disable automatic browser opening."),
  Flag.optional,
);
const authTokenFlag = Flag.string("auth-token").pipe(
  Flag.withDescription("Auth token required for WebSocket connections."),
  Flag.withAlias("token"),
  Flag.optional,
);
const autoBootstrapProjectFromCwdFlag = Flag.boolean("auto-bootstrap-project-from-cwd").pipe(
  Flag.withDescription(
    "Create a project for the current working directory on startup when missing.",
  ),
  Flag.optional,
);
const logProviderEventsFlag = Flag.boolean("log-provider-events").pipe(
  Flag.withDescription(
    "Emit native/canonical provider NDJSON logs for debugging (equivalent to PEAKCODE_LOG_PROVIDER_EVENTS).",
  ),
  Flag.optional,
);
const logWebSocketEventsFlag = Flag.boolean("log-websocket-events").pipe(
  Flag.withDescription(
    "Emit server-side logs for outbound WebSocket push traffic (equivalent to PEAKCODE_LOG_WS_EVENTS).",
  ),
  Flag.withAlias("log-ws-events"),
  Flag.optional,
);

export const peakcodeCli = Command.make("peakcode", {
  mode: modeFlag,
  port: portFlag,
  host: hostFlag,
  peakcodeHome: peakcodeHomeFlag,
  devUrl: devUrlFlag,
  noBrowser: noBrowserFlag,
  authToken: authTokenFlag,
  autoBootstrapProjectFromCwd: autoBootstrapProjectFromCwdFlag,
  logProviderEvents: logProviderEventsFlag,
  logWebSocketEvents: logWebSocketEventsFlag,
}).pipe(
  Command.withDescription("Run the Peak Code server."),
  Command.withHandler((input) => Effect.scoped(makeServerProgram(input))),
);
