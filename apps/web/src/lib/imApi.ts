// FILE: imApi.ts
// Purpose: Typed client for the IM bridge's HTTP surface (`/api/im/*`).
// Layer: Web data access
// Exports: imApi
//
// The bridge lives behind plain JSON routes rather than WS RPC methods because the
// channel callbacks (WeChat / official account) have to be plain HTTP anyway, and the
// phone hand-off link is fetched and rendered before any chat surface exists.

import { resolveWsHttpUrl } from "./wsHttpUrl";
import type {
  ImChannelId,
  ImConversation,
  ImMobileLink,
  ImMobileLinkInput,
  ImRemoteAccessStatus,
  ImStatusSnapshot,
  ImTestChannelResult,
  ImWechatQrCode,
  ImWechatQrStatus,
} from "@peakcode/contracts";

async function requestImJson<T>(
  path: string,
  options: { readonly method?: "GET" | "POST"; readonly body?: unknown } = {},
): Promise<T> {
  // Desktop serves the page from a custom scheme and authenticates with the legacy token
  // carried on the WS URL; this helper forwards it, exactly like image/attachment URLs.
  const response = await fetch(resolveWsHttpUrl(path), {
    method: options.method ?? "GET",
    credentials: "same-origin",
    ...(options.body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(options.body),
        }),
  });
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error: unknown }).error)
        : `IM request failed with status ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
}

const errorMessageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const imApi = {
  getStatus: () => requestImJson<ImStatusSnapshot>("/api/im/status"),

  listConversations: () => requestImJson<ReadonlyArray<ImConversation>>("/api/im/conversations"),

  forgetConversation: (conversationKey: string) =>
    requestImJson<{ forgotten: boolean }>("/api/im/conversations/forget", {
      method: "POST",
      body: { conversationKey },
    }),

  createWechatQrCode: () =>
    requestImJson<ImWechatQrCode>("/api/im/wechat/qrcode", { method: "POST" }),

  pollWechatQrStatus: (qrcode: string) =>
    requestImJson<ImWechatQrStatus>(
      `/api/im/wechat/qrcode-status?qrcode=${encodeURIComponent(qrcode)}`,
    ),

  disconnectWechat: () =>
    requestImJson<{ disconnected: boolean }>("/api/im/wechat/disconnect", { method: "POST" }),

  testChannel: (channel: ImChannelId) =>
    requestImJson<ImTestChannelResult>("/api/im/test", { method: "POST", body: { channel } }),

  /** Mint a phone hand-off link that opens the given conversation on the other device. */
  createMobileLink: (input: ImMobileLinkInput = {}) =>
    requestImJson<ImMobileLink>("/api/im/mobile-link", { method: "POST", body: input }),

  startRemoteAccess: () =>
    requestImJson<ImRemoteAccessStatus>("/api/im/remote-access/start", { method: "POST" }),

  stopRemoteAccess: () =>
    requestImJson<ImRemoteAccessStatus>("/api/im/remote-access/stop", { method: "POST" }),
} as const;

/** Human-readable failure text for a bridge call. */
export const imApiErrorMessage = errorMessageOf;
