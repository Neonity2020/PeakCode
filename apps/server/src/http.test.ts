import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { DateTime, Effect, FileSystem, Path } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createHttpRequestHandler, isLegacyTokenAuthorized } from "./http";
import type { ServerAuthShape } from "./auth/Services/ServerAuth";
import { deriveServerPaths, type ServerConfigShape } from "./config";
import {
  matchModelGatewayRoute,
  serveEffectModelGatewayRoute,
  serveNodeModelGatewayRoute,
} from "./modelGateway";
import type { ProjectFaviconResolverShape } from "./project/Services/ProjectFaviconResolver";
import { updateRuntimeDeepSeekApiKey } from "./runtimeSecrets";
import type { ServerReadiness } from "./server/readiness";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  vi.unstubAllGlobals();
  updateRuntimeDeepSeekApiKey(null);
  delete process.env.PEAKCODE_GATEWAY_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
});

const readiness: ServerReadiness = {
  awaitServerReady: Effect.void,
  markHttpListening: Effect.void,
  markPushBusReady: Effect.void,
  markKeybindingsReady: Effect.void,
  markTerminalSubscriptionsReady: Effect.void,
  markOrchestrationSubscriptionsReady: Effect.void,
  getSnapshot: Effect.succeed({
    httpListening: true,
    pushBusReady: true,
    keybindingsReady: true,
    terminalSubscriptionsReady: false,
    orchestrationSubscriptionsReady: false,
    startupReady: false,
  }),
};

const projectFaviconResolver: ProjectFaviconResolverShape = {
  resolvePath: () => Effect.succeed(null),
};

async function makeConfig(overrides: Partial<ServerConfigShape> = {}): Promise<ServerConfigShape> {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "peakcode-http-test-"));
  tempDirs.push(baseDir);
  const derivedPaths = await Effect.runPromise(
    deriveServerPaths(baseDir, undefined).pipe(Effect.provide(NodeServices.layer)),
  );
  return {
    mode: "web",
    port: 0,
    host: undefined,
    cwd: baseDir,
    homeDir: os.homedir(),
    baseDir,
    ...derivedPaths,
    staticDir: undefined,
    devUrl: undefined,
    noBrowser: true,
    authToken: undefined,
    autoBootstrapProjectFromCwd: false,
    logProviderEvents: false,
    logWebSocketEvents: false,
    ...overrides,
  };
}

async function makeHandler(
  config: ServerConfigShape,
  auth?: {
    readonly serverAuth: ServerAuthShape;
    readonly cookieName: string;
  },
): Promise<http.RequestListener> {
  const services = await Effect.runPromise(
    Effect.gen(function* () {
      return {
        fileSystem: yield* FileSystem.FileSystem,
        path: yield* Path.Path,
      };
    }).pipe(Effect.provide(NodeServices.layer)),
  );
  return createHttpRequestHandler({
    serverConfig: config,
    readiness,
    fileSystem: services.fileSystem,
    projectFaviconResolver,
    path: services.path,
    ...(auth
      ? {
          serverAuth: auth.serverAuth,
          sessionCredentials: { cookieName: auth.cookieName },
        }
      : {}),
  });
}

function makeAuthDescriptor() {
  return {
    policy: "loopback-browser" as const,
    bootstrapMethods: ["one-time-token" as const],
    sessionMethods: ["browser-session-cookie" as const, "bearer-session-token" as const],
    sessionCookieName: "t3_session",
  };
}

function makeFakeServerAuth(overrides: Partial<ServerAuthShape> = {}): ServerAuthShape {
  const expiresAt = Effect.runSync(DateTime.now);
  const descriptor = makeAuthDescriptor();
  return {
    getDescriptor: () => Effect.succeed(descriptor),
    getSessionState: () =>
      Effect.succeed({
        authenticated: false,
        auth: descriptor,
      }),
    exchangeBootstrapCredential: () =>
      Effect.succeed({
        response: {
          authenticated: true,
          role: "client",
          sessionMethod: "browser-session-cookie",
          expiresAt,
        },
        sessionToken: "session-token",
      }),
    exchangeBootstrapCredentialForBearerSession: () =>
      Effect.succeed({
        authenticated: true,
        role: "client",
        sessionMethod: "bearer-session-token",
        expiresAt,
        sessionToken: "bearer-session-token",
      }),
    issuePairingCredential: () =>
      Effect.succeed({ id: "pairing-id", credential: "PAIRINGTOKEN", expiresAt }),
    listPairingLinks: () => Effect.succeed([]),
    revokePairingLink: () => Effect.succeed(true),
    listClientSessions: () => Effect.succeed([]),
    revokeClientSession: () => Effect.succeed(true),
    revokeOtherClientSessions: () => Effect.succeed(1),
    authenticateHttpRequest: () =>
      Effect.succeed({
        sessionId: "session-id" as never,
        subject: "owner",
        method: "browser-session-cookie",
        role: "owner",
        expiresAt,
      }),
    authenticateWebSocketUpgrade: () =>
      Effect.succeed({
        sessionId: "session-id" as never,
        subject: "owner",
        method: "browser-session-cookie",
        role: "owner",
        expiresAt,
      }),
    issueWebSocketToken: () => Effect.succeed({ token: "ws-token", expiresAt }),
    issueStartupPairingUrl: () => Effect.succeed("http://127.0.0.1:3773/pair#token=PAIRINGTOKEN"),
    ...overrides,
  } satisfies ServerAuthShape;
}

async function withServer<T>(
  handler: http.RequestListener,
  run: (origin: string) => Promise<T>,
): Promise<T> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address === "string" || !address) {
    throw new Error("Expected TCP server address");
  }
  try {
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

describe("createHttpRequestHandler", () => {
  it("recognizes the desktop startup token for legacy attachment requests", async () => {
    const config = await makeConfig({ authToken: "desktop-secret" });

    expect(
      isLegacyTokenAuthorized({
        config,
        url: new URL("http://127.0.0.1:3773/attachments/attachment-id?token=desktop-secret"),
      }),
    ).toBe(true);
    expect(
      isLegacyTokenAuthorized({
        config,
        url: new URL("http://127.0.0.1:3773/attachments/attachment-id?token=wrong"),
      }),
    ).toBe(false);
  });

  it("serves health readiness JSON", async () => {
    const config = await makeConfig();
    const handler = await makeHandler(config);

    await withServer(handler, async (origin) => {
      const response = await fetch(`${origin}/health`);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("application/json");
      await expect(response.json()).resolves.toMatchObject({
        status: "ok",
        startupReady: false,
        pushBusReady: true,
      });
    });
  });

  it("serves local gateway model metadata before dev/static fallback", async () => {
    const config = await makeConfig({ devUrl: new URL("http://localhost:5173/") });
    const handler = await makeHandler(config);

    await withServer(handler, async (origin) => {
      const response = await fetch(`${origin}/gateway/openai/v1/models`);

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        object: "list",
        data: [
          { id: "deepseek-v4-flash", owned_by: "deepseek" },
          { id: "deepseek-v4-pro", owned_by: "deepseek" },
        ],
      });
    });
  });

  it("requires the optional gateway API key for completion requests", async () => {
    process.env.PEAKCODE_GATEWAY_API_KEY = "gateway-secret";
    process.env.DEEPSEEK_API_KEY = "deepseek-secret";
    const config = await makeConfig();
    const handler = await makeHandler(config);

    await withServer(handler, async (origin) => {
      const response = await fetch(`${origin}/gateway/openai/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "deepseek-v4-flash",
          messages: [{ role: "user", content: "hello" }],
        }),
      });

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "invalid_api_key" },
      });
    });
  });

  it("adapts local gateway responses requests to DeepSeek chat completions", async () => {
    process.env.PEAKCODE_GATEWAY_API_KEY = "gateway-secret";
    process.env.DEEPSEEK_API_KEY = "deepseek-secret";
    const originalFetch = globalThis.fetch;
    const upstreamRequests: Array<{ url: string; body: unknown; authorization: string | null }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        upstreamRequests.push({
          url: String(url),
          body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
          authorization:
            init?.headers && "Authorization" in (init.headers as Record<string, string>)
              ? (init.headers as Record<string, string>).Authorization
              : null,
        });
        return new Response(
          JSON.stringify({
            id: "chatcmpl-test",
            model: "deepseek-v4-pro",
            choices: [{ message: { role: "assistant", content: "pong" } }],
            usage: { prompt_tokens: 4, completion_tokens: 1, total_tokens: 5 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    );
    const config = await makeConfig();
    const handler = await makeHandler(config);

    await withServer(handler, async (origin) => {
      const response = await originalFetch(`${origin}/gateway/openai/v1/responses`, {
        method: "POST",
        headers: {
          "Authorization": "Bearer gateway-secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "deepseek-v4-pro",
          input: "ping",
          max_output_tokens: 32,
        }),
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        object: "response",
        status: "completed",
        model: "deepseek-v4-pro",
        output_text: "pong",
      });
    });

    expect(upstreamRequests).toEqual([
      {
        url: "https://api.deepseek.com/v1/chat/completions",
        authorization: "Bearer deepseek-secret",
        body: {
          model: "deepseek-v4-pro",
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 32,
        },
      },
    ]);
  });

  it("uses the runtime DeepSeek API key for local gateway upstream requests", async () => {
    updateRuntimeDeepSeekApiKey("runtime-deepseek-secret");
    const upstreamRequests: Array<{ body: unknown; authorization: string | null }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        upstreamRequests.push({
          body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
          authorization:
            init?.headers && "Authorization" in (init.headers as Record<string, string>)
              ? (init.headers as Record<string, string>).Authorization
              : null,
        });
        return new Response(
          JSON.stringify({
            id: "chatcmpl-runtime-key",
            model: "deepseek-v4-flash",
            choices: [{ message: { role: "assistant", content: "pong" } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    );
    const route = matchModelGatewayRoute(new URL("http://local/gateway/openai/v1/responses"));
    if (!route) {
      throw new Error("Expected gateway route to match.");
    }

    const response = await serveEffectModelGatewayRoute({
      route,
      method: "POST",
      headers: { "content-type": "application/json" },
      bodyText: JSON.stringify({
        model: "deepseek-v4-flash",
        input: [
          {
            role: "developer",
            content: [{ type: "input_text", text: "You are a coding agent." }],
          },
          { role: "user", content: [{ type: "input_text", text: "ping" }] },
        ],
        tools: [
          {
            type: "function",
            name: "shell",
            description: "Run a shell command",
            parameters: {
              type: "object",
              properties: {
                command: { type: "string" },
              },
              required: ["command"],
            },
            strict: true,
          },
        ],
        tool_choice: {
          type: "function",
          name: "shell",
        },
      }),
    });

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      object: "response",
      output_text: "pong",
    });
    expect(upstreamRequests).toEqual([
      {
        authorization: "Bearer runtime-deepseek-secret",
        body: {
          model: "deepseek-v4-flash",
          messages: [
            {
              role: "system",
              content: [{ type: "text", text: "You are a coding agent." }],
            },
            { role: "user", content: [{ type: "text", text: "ping" }] },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "shell",
                description: "Run a shell command",
                parameters: {
                  type: "object",
                  properties: {
                    command: { type: "string" },
                  },
                  required: ["command"],
                },
                strict: true,
              },
            },
          ],
          tool_choice: {
            type: "function",
            function: {
              name: "shell",
            },
          },
        },
      },
    ]);
  });

  it("converts streaming DeepSeek chat completions into Responses SSE events", async () => {
    updateRuntimeDeepSeekApiKey("runtime-deepseek-secret");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const encoder = new TextEncoder();
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  [
                    'data: {"choices":[{"delta":{"content":"hel"}}]}',
                    "",
                    'data: {"choices":[{"delta":{"content":"lo"}}]}',
                    "",
                    "data: [DONE]",
                    "",
                  ].join("\n"),
                ),
              );
              controller.close();
            },
          }),
          { status: 200, headers: { "Content-Type": "text/event-stream" } },
        );
      }),
    );
    const body = JSON.stringify({
      model: "deepseek-v4-flash",
      input: "ping",
      stream: true,
    });
    const req = {
      method: "POST",
      headers: { "content-type": "application/json" },
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(body);
      },
    } as unknown as http.IncomingMessage;
    const chunks: string[] = [];
    const res = {
      writeHead: vi.fn(),
      write: vi.fn((chunk: unknown) => {
        chunks.push(String(chunk));
        return true;
      }),
      end: vi.fn((chunk?: unknown) => {
        if (chunk !== undefined) chunks.push(String(chunk));
      }),
    } as unknown as http.ServerResponse;

    const handled = await serveNodeModelGatewayRoute({
      req,
      res,
      url: new URL("http://local/gateway/openai/v1/responses"),
    });

    expect(handled).toBe(true);
    const output = chunks.join("");
    expect(output).toContain("event: response.output_text.delta");
    expect(output).toContain('"delta":"hel"');
    expect(output).toContain('"delta":"lo"');
    expect(output).toContain("event: response.completed");
    expect(output).toContain('"output_text":"hello"');
  });

  it("converts Effect gateway streaming responses into Responses SSE text", async () => {
    updateRuntimeDeepSeekApiKey("runtime-deepseek-secret");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const encoder = new TextEncoder();
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  [
                    'data: {"choices":[{"delta":{"content":"ok"}}]}',
                    "",
                    "data: [DONE]",
                    "",
                  ].join("\n"),
                ),
              );
              controller.close();
            },
          }),
          { status: 200, headers: { "Content-Type": "text/event-stream" } },
        );
      }),
    );
    const route = matchModelGatewayRoute(new URL("http://local/gateway/openai/v1/responses"));
    if (!route) {
      throw new Error("Expected gateway route to match.");
    }

    const response = await serveEffectModelGatewayRoute({
      route,
      method: "POST",
      headers: { "content-type": "application/json" },
      bodyText: JSON.stringify({
        model: "deepseek-v4-flash",
        input: "ping",
        stream: true,
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers["Content-Type"]).toBe("text/event-stream");
    expect(response.body).toContain("event: response.output_text.delta");
    expect(response.body).toContain('"delta":"ok"');
    expect(response.body).toContain("event: response.completed");
    expect(response.body).toContain('"output_text":"ok"');
  });

  it("preserves dev URL redirect behavior", async () => {
    const config = await makeConfig({ devUrl: new URL("http://localhost:5173/") });
    const handler = await makeHandler(config);

    await withServer(handler, async (origin) => {
      const response = await fetch(`${origin}/anything`, { redirect: "manual" });

      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe("http://localhost:5173/");
    });
  });

  it("serves static files and SPA fallback", async () => {
    const staticDir = fs.mkdtempSync(path.join(os.tmpdir(), "peakcode-static-test-"));
    tempDirs.push(staticDir);
    fs.writeFileSync(path.join(staticDir, "index.html"), "<main>app</main>");
    fs.writeFileSync(path.join(staticDir, "asset.txt"), "asset");
    const config = await makeConfig({ staticDir });
    const handler = await makeHandler(config);

    await withServer(handler, async (origin) => {
      const indexResponse = await fetch(`${origin}/missing-route`);
      expect(indexResponse.status).toBe(200);
      await expect(indexResponse.text()).resolves.toBe("<main>app</main>");

      const assetResponse = await fetch(`${origin}/asset.txt`);
      expect(assetResponse.status).toBe(200);
      await expect(assetResponse.text()).resolves.toBe("asset");
    });
  });

  it("serves attachments by id with immutable cache headers", async () => {
    const config = await makeConfig();
    fs.mkdirSync(config.attachmentsDir, { recursive: true });
    fs.writeFileSync(path.join(config.attachmentsDir, "attachment-id.bin"), "payload");
    const handler = await makeHandler(config);

    await withServer(handler, async (origin) => {
      const response = await fetch(`${origin}/attachments/attachment-id`);

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
      await expect(response.text()).resolves.toBe("payload");
    });
  });

  it("serves auth session state before dev/static fallback", async () => {
    const config = await makeConfig({ devUrl: new URL("http://localhost:5173/") });
    const handler = await makeHandler(config, {
      serverAuth: makeFakeServerAuth(),
      cookieName: "t3_session",
    });

    await withServer(handler, async (origin) => {
      const response = await fetch(`${origin}/api/auth/session`, { redirect: "manual" });

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("application/json");
      await expect(response.json()).resolves.toMatchObject({
        authenticated: false,
        auth: {
          policy: "loopback-browser",
        },
      });
    });
  });

  it("sets a session cookie on auth bootstrap", async () => {
    const config = await makeConfig();
    const handler = await makeHandler(config, {
      serverAuth: makeFakeServerAuth(),
      cookieName: "t3_session",
    });

    await withServer(handler, async (origin) => {
      const response = await fetch(`${origin}/api/auth/bootstrap`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential: "PAIRINGTOKEN" }),
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("set-cookie")).toContain("t3_session=session-token");
      await expect(response.json()).resolves.toMatchObject({
        authenticated: true,
        sessionMethod: "browser-session-cookie",
      });
    });
  });
});
