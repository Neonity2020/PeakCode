// Boots the same `staticAndDevEffectRouteLayer` that `makeEffectHttpRouteLayer` wires into
// `effectServer.ts`, with a stand-in dev web server, and checks the split that matters for
// remote access: a viewer on this machine is redirected to Vite, everyone else is proxied
// to it through this origin.
import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Exit, Layer, Scope } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { afterEach, describe, expect, it } from "vitest";

import { ServerConfig, type ServerConfigShape } from "./config";
import { hostnameFromHostHeader, isLocalDevViewerHost } from "./devWebProxy";
import { staticAndDevEffectRouteLayer } from "./http";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeServerConfig(overrides: Partial<ServerConfigShape> = {}): ServerConfigShape {
  const baseDir = mkdtempSync(path.join(os.tmpdir(), "peakcode-dev-proxy-"));
  tempDirs.push(baseDir);
  return {
    mode: "web",
    port: 0,
    host: undefined,
    cwd: baseDir,
    homeDir: os.homedir(),
    baseDir,
    keybindingsConfigPath: path.join(baseDir, "keybindings.json"),
    serverRuntimeStatePath: path.join(baseDir, "runtime.json"),
    serverSettingsPath: path.join(baseDir, "settings.json"),
    attachmentsDir: path.join(baseDir, "attachments"),
    sqlitePath: path.join(baseDir, "state.sqlite"),
    staticDir: undefined,
    devUrl: undefined,
    noBrowser: true,
    authToken: undefined,
    autoBootstrapProjectFromCwd: false,
    logProviderEvents: false,
    logWebSocketEvents: false,
    ...overrides,
  } as ServerConfigShape;
}

/** A stand-in for the Vite dev server: answers with the path it was asked for. */
async function withFakeDevServer(run: (origin: string) => Promise<void>): Promise<void> {
  const seen: string[] = [];
  const server = http.createServer((request, response) => {
    seen.push(request.url ?? "");
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<main>dev app</main>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address !== "object") throw new Error("expected a listening port");
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function withRouteServer(
  config: ServerConfigShape,
  run: (origin: string) => Promise<void>,
): Promise<void> {
  const scope = await Effect.runPromise(Scope.make("sequential"));
  let nodeServer: http.Server | null = null;
  try {
    await Effect.runPromise(
      Scope.provide(
        Effect.gen(function* () {
          const httpServer = yield* NodeHttpServer.make(
            () => {
              nodeServer = http.createServer();
              return nodeServer;
            },
            { port: 0, host: "127.0.0.1" },
          );
          const httpApp = yield* HttpRouter.toHttpEffect(staticAndDevEffectRouteLayer);
          yield* httpServer.serve(httpApp);
        }).pipe(
          Effect.provide(Layer.mergeAll(Layer.succeed(ServerConfig, config), NodeServices.layer)),
        ),
        scope,
      ),
    );
    const address = (nodeServer as http.Server | null)?.address();
    if (!address || typeof address !== "object") {
      throw new Error("Expected effect server to expose an address");
    }
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await Effect.runPromise(Scope.close(scope, Exit.void));
  }
}

/** Issue a request with an explicit `Host`, which `fetch` will not let a test set. */
function requestWithHost(
  origin: string,
  requestPath: string,
  hostHeader: string,
): Promise<{ status: number; location: string | undefined; body: string }> {
  return new Promise((resolve, reject) => {
    const target = new URL(origin);
    const request = http.request(
      {
        host: target.hostname,
        port: target.port,
        path: requestPath,
        method: "GET",
        headers: { host: hostHeader },
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          body += chunk;
        });
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            location: response.headers.location,
            body,
          }),
        );
      },
    );
    request.once("error", reject);
    request.end();
  });
}

describe("isLocalDevViewerHost", () => {
  it("treats this machine's names as local, with and without a port", () => {
    expect(isLocalDevViewerHost("localhost:8933")).toBe(true);
    expect(isLocalDevViewerHost("127.0.0.1:51623")).toBe(true);
    expect(isLocalDevViewerHost("[::1]:51623")).toBe(true);
    expect(isLocalDevViewerHost("dev.localhost")).toBe(true);
    expect(isLocalDevViewerHost("127.0.0.53:3773")).toBe(true);
    expect(isLocalDevViewerHost(undefined)).toBe(true);
  });

  it("treats tunnel and LAN hosts as remote", () => {
    expect(isLocalDevViewerHost("random-words-here.trycloudflare.com")).toBe(false);
    expect(isLocalDevViewerHost("192.168.1.42:3773")).toBe(false);
    expect(isLocalDevViewerHost("[fd7a::1]:3773")).toBe(false);
  });

  it("parses hostnames out of host headers", () => {
    expect(hostnameFromHostHeader("Example.COM:443")).toBe("example.com");
    expect(hostnameFromHostHeader("[fd7a::1]:3773")).toBe("fd7a::1");
    expect(hostnameFromHostHeader("localhost")).toBe("localhost");
    expect(hostnameFromHostHeader("  ")).toBeNull();
  });
});

describe("staticAndDevEffectRouteLayer with a dev URL", () => {
  it("redirects a browser on this machine to the dev web server", async () => {
    await withFakeDevServer(async (devOrigin) => {
      const config = makeServerConfig({ devUrl: new URL(devOrigin) });
      await withRouteServer(config, async (origin) => {
        const response = await requestWithHost(origin, "/pair?x=1", "localhost:51623");

        expect(response.status).toBe(302);
        expect(response.location).toBe(`${devOrigin}/`);
      });
    });
  });

  it("serves the dev web app to a tunnel viewer instead of redirecting to loopback", async () => {
    await withFakeDevServer(async (devOrigin) => {
      const config = makeServerConfig({ devUrl: new URL(devOrigin) });
      await withRouteServer(config, async (origin) => {
        const response = await requestWithHost(
          origin,
          "/pair",
          "random-words-here.trycloudflare.com",
        );

        expect(response.status).toBe(200);
        expect(response.location).toBeUndefined();
        expect(response.body).toContain("dev app");
      });
    });
  });

  it("proxies the requested path and query to the dev web server", async () => {
    const upstreamPaths: string[] = [];
    const devServer = http.createServer((request, response) => {
      upstreamPaths.push(request.url ?? "");
      response.writeHead(200, { "content-type": "application/javascript" });
      response.end("export default 1;");
    });
    await new Promise<void>((resolve) => devServer.listen(0, "127.0.0.1", resolve));
    const devAddress = devServer.address();
    if (!devAddress || typeof devAddress !== "object") throw new Error("expected a port");
    const config = makeServerConfig({ devUrl: new URL(`http://127.0.0.1:${devAddress.port}/`) });

    try {
      await withRouteServer(config, async (origin) => {
        const response = await requestWithHost(
          origin,
          "/src/main.tsx?import&v=2",
          "192.168.1.42:51623",
        );

        expect(response.status).toBe(200);
        expect(response.body).toBe("export default 1;");
        expect(upstreamPaths).toEqual(["/src/main.tsx?import&v=2"]);
      });
    } finally {
      await new Promise<void>((resolve) => devServer.close(() => resolve()));
    }
  });

  it("answers 502 when the dev web server is not running", async () => {
    const config = makeServerConfig({ devUrl: new URL("http://127.0.0.1:1/") });
    await withRouteServer(config, async (origin) => {
      const response = await requestWithHost(origin, "/", "random-words-here.trycloudflare.com");

      expect(response.status).toBe(502);
      expect(response.body).toContain("Dev web server");
    });
  });
});
