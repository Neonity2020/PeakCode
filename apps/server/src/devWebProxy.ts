// FILE: devWebProxy.ts
// Purpose: Hand the dev web app to viewers that are not on this machine.
//          In dev the browser UI is served by Vite on its own loopback port, so a browser
//          running here is redirected to it (the fast path, HMR socket and all). A phone
//          that arrives through a tunnel — or a tablet on the LAN — cannot resolve this
//          machine's loopback, so for those viewers the server proxies the dev web server:
//          the published address then serves the app itself instead of redirecting to a
//          `localhost` that only exists on the host.
// Layer: Server HTTP support
// Exports: hostnameFromHostHeader, isLocalDevViewerHost, proxyToDevWebServer

import http from "node:http";

import { Effect, Stream } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { resolveWebEntryFilePath } from "./webEntryPaths.ts";

/** Names that a browser on this machine resolves to this machine. */
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

/** Request headers that describe this hop, or a body we re-encode, and never travel on. */
const HOP_BY_HOP_HEADERS = new Set([
  "accept-encoding",
  "connection",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

/** Hostname of a `Host` header (port and IPv6 brackets removed), or null when unusable. */
export function hostnameFromHostHeader(hostHeader: string | undefined): string | null {
  if (hostHeader === undefined) return null;
  const trimmed = hostHeader.trim().toLowerCase();
  if (trimmed.length === 0) return null;
  if (trimmed.startsWith("[")) {
    const end = trimmed.indexOf("]");
    return end === -1 ? null : trimmed.slice(1, end);
  }
  const portSeparator = trimmed.indexOf(":");
  return portSeparator === -1 ? trimmed : trimmed.slice(0, portSeparator);
}

/**
 * Whether the request came from a viewer on this machine.
 *
 * Only those viewers can follow the redirect to the dev web server; everyone else has to
 * be served through this origin. A request without a `Host` header has no remote viewer
 * behind it, so it keeps the local behavior.
 */
export function isLocalDevViewerHost(hostHeader: string | undefined): boolean {
  const hostname = hostnameFromHostHeader(hostHeader);
  if (hostname === null) return true;
  return (
    LOOPBACK_HOSTNAMES.has(hostname) ||
    hostname.endsWith(".localhost") ||
    hostname.startsWith("127.")
  );
}

/**
 * Fetch `url` from the dev web server and return its answer unchanged.
 *
 * The response body is streamed rather than buffered: the dev server sends long-lived
 * responses (SSE, and the bundle graph in watch mode) that must not be held to completion.
 */
export function proxyToDevWebServer(input: {
  readonly request: HttpServerRequest.HttpServerRequest;
  readonly devUrl: URL;
  readonly url: URL;
}): Effect.Effect<HttpServerResponse.HttpServerResponse> {
  // The dev server serves the phone page from its own file name, while the published
  // address uses the short route; map it here so both modes behave the same.
  const upstreamPath = resolveWebEntryFilePath(input.url.pathname) ?? input.url.pathname;
  const target = new URL(`${upstreamPath}${input.url.search}`, input.devUrl);
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(input.request.headers)) {
    if (value === undefined || HOP_BY_HOP_HEADERS.has(name.toLowerCase())) continue;
    headers[name] = value;
  }

  return Effect.tryPromise({
    try: (signal) =>
      new Promise<http.IncomingMessage>((resolve, reject) => {
        const upstream = http.request(
          target,
          { method: input.request.method, headers, signal },
          resolve,
        );
        upstream.once("error", reject);
        upstream.end();
      }),
    catch: (error) => error,
  }).pipe(
    Effect.map((upstream) =>
      HttpServerResponse.stream(
        Stream.fromAsyncIterable(upstream, (error) =>
          error instanceof Error ? error : new Error(String(error)),
        ),
        { status: upstream.statusCode ?? 502, headers: upstream.headers },
      ),
    ),
    Effect.catch(() =>
      Effect.succeed(
        HttpServerResponse.text(
          `Dev web server at ${input.devUrl.origin} did not answer. Start it and retry.`,
          { status: 502 },
        ),
      ),
    ),
  );
}
