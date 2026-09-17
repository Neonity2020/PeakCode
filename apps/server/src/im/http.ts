import { Schema } from "effect";
import { Effect } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { ImMobileLinkInput, ImTestChannelInput } from "@peakcode/contracts";

import { makeEffectAuthRequest } from "../auth/http.ts";
import { ServerConfig } from "../config.ts";
import { isLegacyTokenAuthorized } from "../http.ts";
import { ServerAuth } from "../auth/Services/ServerAuth.ts";
import { ImService } from "./Services/ImService.ts";

/**
 * IM bridge HTTP surface.
 *
 * Config/status traffic is owner-only, exactly like the rest of the auth control plane:
 * these endpoints hand out a pairing link that opens the workspace, so they are not
 * something a paired client should be able to mint for itself.
 *
 * The Tencent callbacks are the exception — Tencent cannot present a session, so those
 * two routes authenticate by signature inside the channel adapter, and the generic
 * `/api/im/task` bridge authenticates with its own configured secret.
 */

const decodeTestChannelInput = Schema.decodeUnknownEffect(ImTestChannelInput);
const decodeMobileLinkInput = Schema.decodeUnknownEffect(ImMobileLinkInput);
const decodeForgetConversationInput = Schema.decodeUnknownEffect(
  Schema.Struct({ conversationKey: Schema.String.check(Schema.isNonEmpty()) }),
);
const decodeWebhookTaskInput = Schema.decodeUnknownEffect(
  Schema.Struct({
    message: Schema.String.check(Schema.isNonEmpty()),
    session: Schema.optionalKey(Schema.String),
    secret: Schema.optionalKey(Schema.String),
  }),
);

const errorMessageOf = (error: unknown): string =>
  error instanceof Error
    ? error.message
    : String((error as { message?: unknown })?.message ?? error);

const jsonError = (error: unknown, status = 400) =>
  HttpServerResponse.jsonUnsafe({ error: errorMessageOf(error) }, { status });

const readJson = <A>(
  request: HttpServerRequest.HttpServerRequest,
  decode: (input: unknown) => Effect.Effect<A, unknown>,
) =>
  request.json.pipe(
    Effect.mapError(() => new Error("请求体不是合法的 JSON。")),
    Effect.flatMap((body) =>
      decode(body).pipe(Effect.mapError(() => new Error("请求参数不合法。"))),
    ),
  );

/**
 * Origins allowed to read IM responses cross-origin, or null to leave CORS off.
 *
 * The desktop window is never served by this server: the packaged shell loads
 * `t3://app/index.html` and the dev shell loads the Vite dev origin, while the backend
 * listens on its own loopback port. Both authenticate with the startup token carried in
 * the request URL, which is why this allowlist is limited to the shell's own scheme and
 * to loopback origins: a public site is not on the list, and even if it were it has no
 * token. Credentials are never allowed cross-origin — the phone/browser flow is
 * same-origin cookies, which needs no CORS at all.
 */
export function corsOriginFor(requestOrigin: string | undefined): string | null {
  if (!requestOrigin || requestOrigin.length === 0 || requestOrigin === "null") return null;
  let origin: URL;
  try {
    origin = new URL(requestOrigin);
  } catch {
    return null;
  }
  // The packaged shell's own scheme (t3://app and friends).
  if (origin.protocol !== "http:" && origin.protocol !== "https:") return requestOrigin;
  const host = origin.hostname.replace(/^\[|\]$/g, "");
  const isLoopback = host === "localhost" || host === "127.0.0.1" || host === "::1";
  return isLoopback ? requestOrigin : null;
}

const requestOriginOf = (request: HttpServerRequest.HttpServerRequest): string | undefined => {
  const header = request.headers.origin;
  return Array.isArray(header) ? header[0] : header;
};

/** Attach CORS headers for an allowed origin; a no-op for every other request. */
const withCors = (
  response: HttpServerResponse.HttpServerResponse,
  origin: string | null,
): HttpServerResponse.HttpServerResponse =>
  origin === null
    ? response
    : HttpServerResponse.setHeaders(response, {
        "Access-Control-Allow-Origin": origin,
        Vary: "Origin",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "600",
      });

const callbackQuery = (url: URL): Record<string, string | undefined> => {
  const query: Record<string, string | undefined> = {};
  for (const [key, value] of url.searchParams) query[key] = value;
  return query;
};

/**
 * Who may manage channels: whoever may already manage this server.
 *
 * That is the rule the WebSocket upgrade and the attachment routes apply — no token
 * configured means the server is local-only and trusted, a token configured means the
 * caller has to present it (the desktop shell carries `?token=<authToken>`) or hold an
 * owner session (what a paired phone gets). Reusing the same helper keeps the IM surface
 * from inventing a third rule for the same question.
 */
const requireOwner = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const url = HttpServerRequest.toURL(request);
  const config = yield* ServerConfig;
  if (isLegacyTokenAuthorized({ config, url: url ?? new URL("http://localhost/") })) return;

  const serverAuth = yield* ServerAuth;
  const session = yield* serverAuth.authenticateHttpRequest(makeEffectAuthRequest(request));
  if (session.role !== "owner") {
    return yield* Effect.fail({
      message: "Only owner sessions can manage IM channels.",
      status: 403 as const,
    });
  }
});

/** Shared shape of a WeChat-side callback route (GET = URL check, POST = message). */
const serveWechatCallback = (
  channel: "wecom" | "wechatMp",
  request: HttpServerRequest.HttpServerRequest,
  url: URL,
) =>
  Effect.gen(function* () {
    const im = yield* ImService;
    const query = callbackQuery(url);
    if (request.method === "GET") {
      const challenge = yield* im.verifyWechatCallback({ channel, query });
      return HttpServerResponse.text(challenge, {
        status: 200,
        contentType: "text/plain",
      });
    }
    const rawBody = yield* request.text.pipe(Effect.orElseSucceed(() => ""));
    const message = yield* im.parseWechatCallback({ channel, query, rawBody });
    // Tencent gives the callback five seconds and retries otherwise, so the message is
    // handed to the bridge in the background and answered for immediately.
    yield* Effect.forkChild(
      im
        .acceptWechatCallbackMessage({ channel, message })
        .pipe(
          Effect.catch((cause) =>
            Effect.logWarning("IM callback handling failed", { cause: String(cause) }),
          ),
        ),
    );
    return HttpServerResponse.text(channel === "wecom" ? "" : "success", {
      status: 200,
      contentType: "text/plain",
    });
  }).pipe(Effect.catch((error) => Effect.succeed(jsonError(error))));

const serveImRequest = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const url = HttpServerRequest.toURL(request);
  if (!url) return HttpServerResponse.text("Bad Request", { status: 400 });
  const im = yield* ImService;
  const path = url.pathname;

  // --- Callbacks and the secret-authenticated bridge: no session, no owner check. ---
  if (path === "/api/im/wecom/events" || path === "/api/im/wechat-mp/events") {
    const channel = path === "/api/im/wecom/events" ? "wecom" : "wechatMp";
    return yield* serveWechatCallback(channel, request, url);
  }

  if (request.method === "POST" && path === "/api/im/task") {
    const payload = yield* readJson(request, decodeWebhookTaskInput);
    const result = yield* im.runWebhookTask({
      text: payload.message,
      session: payload.session,
      secret: payload.secret,
    });
    return HttpServerResponse.jsonUnsafe(result);
  }

  // --- Everything else is owner-only. ---
  yield* requireOwner;

  if (request.method === "GET" && path === "/api/im/status") {
    return HttpServerResponse.jsonUnsafe(yield* im.status);
  }

  if (request.method === "GET" && path === "/api/im/conversations") {
    return HttpServerResponse.jsonUnsafe(yield* im.listConversations);
  }

  if (request.method === "POST" && path === "/api/im/conversations/forget") {
    const payload = yield* readJson(request, decodeForgetConversationInput);
    yield* im.forgetConversation(payload.conversationKey);
    return HttpServerResponse.jsonUnsafe({ forgotten: true });
  }

  if (request.method === "POST" && path === "/api/im/wechat/qrcode") {
    return HttpServerResponse.jsonUnsafe(yield* im.createWechatQrCode());
  }

  if (request.method === "GET" && path === "/api/im/wechat/qrcode-status") {
    const qrcode = url.searchParams.get("qrcode");
    if (!qrcode) return jsonError(new Error("缺少 qrcode 参数。"));
    return HttpServerResponse.jsonUnsafe(yield* im.pollWechatQrStatus(qrcode));
  }

  if (request.method === "POST" && path === "/api/im/wechat/disconnect") {
    yield* im.disconnectWechat();
    return HttpServerResponse.jsonUnsafe({ disconnected: true, ...(yield* im.status) });
  }

  if (request.method === "POST" && path === "/api/im/test") {
    const payload = yield* readJson(request, decodeTestChannelInput);
    return HttpServerResponse.jsonUnsafe(yield* im.testChannel(payload.channel));
  }

  if (request.method === "POST" && path === "/api/im/mobile-link") {
    // The conversation to carry is described by an optional body; a caller that only wants
    // the link at all (scripts, older clients) still gets one.
    const payload = yield* readJson(request, decodeMobileLinkInput).pipe(
      Effect.orElseSucceed(() => ({}) as ImMobileLinkInput),
    );
    return HttpServerResponse.jsonUnsafe(yield* im.createMobileLink(payload));
  }

  if (request.method === "POST" && path === "/api/im/remote-access/start") {
    return HttpServerResponse.jsonUnsafe(yield* im.startRemoteAccess());
  }

  if (request.method === "POST" && path === "/api/im/remote-access/stop") {
    return HttpServerResponse.jsonUnsafe(yield* im.stopRemoteAccess());
  }

  return HttpServerResponse.text("Not Found", { status: 404 });
});

/**
 * Every IM route, with the cross-origin handling a desktop shell needs: its window is
 * served from another origin, so the browser asks for a preflight and only reads the
 * response when it carries the matching header.
 */
export const imEffectRouteLayer = HttpRouter.add(
  "*",
  "/api/im/*",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const corsOrigin = corsOriginFor(requestOriginOf(request));

    if (request.method === "OPTIONS") {
      return corsOrigin === null
        ? HttpServerResponse.text("Forbidden", { status: 403 })
        : withCors(HttpServerResponse.empty({ status: 204 }), corsOrigin);
    }

    return withCors(yield* serveImRequest, corsOrigin);
  }).pipe(
    // Failures carry the CORS headers too: without them the browser reports a blocked
    // request instead of the 4xx body, and "wrong token" would look like "server down".
    Effect.catch((error) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const status =
          typeof error === "object" &&
          error !== null &&
          typeof (error as { status?: unknown }).status === "number"
            ? (error as { status: number }).status
            : 500;
        return withCors(jsonError(error, status), corsOriginFor(requestOriginOf(request)));
      }),
    ),
  ),
);
