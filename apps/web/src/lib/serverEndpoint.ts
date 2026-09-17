// FILE: serverEndpoint.ts
// Purpose: Which origin this browser reaches the Peak Code server on, for the WebSocket
//          RPC connection and for the HTTP routes that mirror it (attachments, local
//          images, project favicons). Three cases, in order: the Electron shell injects
//          the loopback URL of the server it spawned; a page served by the Vite dev
//          server on this machine may use that dev address; a page served from anywhere
//          else — a phone through a tunnel, a tablet on the LAN — has to talk back to the
//          origin it came from, because `localhost` there means the device itself.
// Layer: Web utility
// Exports: resolveServerWsUrl, resolveServerOrigin, resolveServerWsToken, resolveServerHttpUrl

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return LOOPBACK_HOSTNAMES.has(host) || host.endsWith(".localhost") || host.startsWith("127.");
}

/** The origin this page was served from, as a WebSocket URL. */
function pageOriginAsWebSocketUrl(): string {
  const location = window.location;
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${location.host}`;
}

/** WebSocket URL of the server: an injected dev/desktop address, or the page's own origin. */
export function resolveServerWsUrl(): string {
  if (typeof window === "undefined") return "";
  const bridgeUrl = window.desktopBridge?.getWsUrl?.();
  if (typeof bridgeUrl === "string" && bridgeUrl.length > 0) return bridgeUrl;
  // `VITE_WS_URL` is baked in when the dev server starts and points at the loopback port of
  // the machine that ran it, so only a page that is itself on that machine can use it.
  if (isLoopbackHostname(window.location.hostname)) {
    const envUrl = import.meta.env.VITE_WS_URL as string | undefined;
    if (typeof envUrl === "string" && envUrl.length > 0) return envUrl;
  }
  return pageOriginAsWebSocketUrl();
}

function toHttpOrigin(webSocketUrl: string): string {
  const parsed = new URL(webSocketUrl);
  const protocol =
    parsed.protocol === "wss:" ? "https:" : parsed.protocol === "ws:" ? "http:" : parsed.protocol;
  return `${protocol}//${parsed.host}`;
}

/** Origin of the server, for callers that build their own URL from it. */
export function resolveServerOrigin(): string {
  if (typeof window === "undefined") return "";
  const serverUrl = resolveServerWsUrl();
  try {
    return toHttpOrigin(serverUrl);
  } catch {
    return window.location.origin;
  }
}

/** The legacy token carried by the injected WebSocket URL, if it has one. */
export function resolveServerWsToken(): string | null {
  const serverUrl = resolveServerWsUrl();
  if (serverUrl.length === 0) return null;
  try {
    return new URL(serverUrl).searchParams.get("token");
  } catch {
    return null;
  }
}

/**
 * Fully-qualified URL for a server route, keeping the desktop bridge's legacy token.
 *
 * On desktop the page is served from a custom protocol scheme, so `<img>` and `<a download>`
 * with a relative path never reach the server. Mirroring the connection host and forwarding
 * its token is what lets authenticated GET routes authorize the request without cookies.
 */
export function resolveServerHttpUrl(rawPath: string): string {
  if (typeof window === "undefined") return rawPath;
  let origin: string;
  try {
    origin = toHttpOrigin(resolveServerWsUrl());
  } catch {
    origin = window.location.origin;
  }
  const url = new URL(rawPath, origin);
  const legacyToken = resolveServerWsToken();
  if (legacyToken && !url.searchParams.has("token")) {
    url.searchParams.set("token", legacyToken);
  }
  return url.toString();
}
