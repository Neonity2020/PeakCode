/**
 * ChatViewProviderStatusLogic - Provider health/rate-limit banner keys and dismissed-banner helpers.
 *
 * @module ChatViewProviderStatusLogic
 */
import type {
  ProviderKind,
  ProviderStartOptions,
  ServerProviderStatus,
  EditorId,
} from "@peakcode/contracts";

import { normalizeCustomBinaryPath } from "~/lib/providerAvailability";

import type { PendingUserInputDraftAnswer } from "../pendingUserInput";

import type { Thread } from "../types";

import type { RateLimitStatus } from "./chat/RateLimitBanner";

export const EMPTY_AVAILABLE_EDITORS: EditorId[] = [];
export const EMPTY_PROVIDER_STATUSES: ServerProviderStatus[] = [];
export const EMPTY_PENDING_USER_INPUT_ANSWERS: Record<string, PendingUserInputDraftAnswer> = {};
export const MAX_DISMISSED_PROVIDER_HEALTH_BANNERS = 50;

export function getThreadProviderCustomBinaryPathKey(
  threadId: Thread["id"],
  provider: ProviderKind,
) {
  return `${threadId}:${provider}`;
}

export function getConfirmedCustomBinarySessionKey(
  thread: Thread | null | undefined,
  provider: ProviderKind,
): string | null {
  const session = thread?.session;
  if (!thread || session?.provider !== provider) {
    return null;
  }
  if (session.status !== "ready" && session.status !== "running") {
    return null;
  }
  return getThreadProviderCustomBinaryPathKey(thread.id, provider);
}

export function getProviderStartOptionsCustomBinaryPath(
  providerOptions: ProviderStartOptions | undefined,
  provider: ProviderKind,
): string | null {
  switch (provider) {
    case "pi":
      return normalizeCustomBinaryPath(providerOptions?.pi?.binaryPath);
  }
}

export function getProviderHealthBannerDismissalKey(
  status: ServerProviderStatus | null,
): string | null {
  if (!status || status.status === "ready") {
    return null;
  }
  return [
    status.provider,
    status.status,
    status.available ? "available" : "unavailable",
    status.authStatus,
    status.message?.trim() ?? "",
  ].join("\u001f");
}

export function getRateLimitBannerDismissalKey(
  status: RateLimitStatus | null,
  threadId: Thread["id"] | null,
): string | null {
  if (!status || !threadId) {
    return null;
  }
  return [
    threadId,
    status.status,
    status.resetsAt ?? "",
    typeof status.utilization === "number" ? String(Math.round(status.utilization * 100)) : "",
  ].join("\u001f");
}
