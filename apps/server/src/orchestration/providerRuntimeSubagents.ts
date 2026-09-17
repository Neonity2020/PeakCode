import { asObject, runtimePayloadRecord } from "./providerRuntimeEventFields.ts";
/**
 * ProviderRuntimeSubagents - Resolves subagent identity and thread titles from provider runtime payloads.
 *
 * @module ProviderRuntimeSubagents
 */
import type { ProviderRuntimeEvent } from "@peakcode/contracts";

import {
  buildSubagentIdentityDirectory,
  extractSubagentIdentityHints,
  resolveSubagentIdentityFromDirectory,
} from "@peakcode/shared/subagents";

export interface SubagentIdentity {
  readonly providerThreadId: string;
  readonly agentId?: string;
  readonly nickname?: string;
  readonly role?: string;
  readonly model?: string;
  readonly modelIsRequestedHint?: boolean;
}

export function extractCollabPayload(
  event: ProviderRuntimeEvent,
): Record<string, unknown> | undefined {
  const payload = runtimePayloadRecord(event);
  return asObject(payload?.data);
}

export function extractSubagentIdentity(
  event: ProviderRuntimeEvent,
  providerThreadId: string,
): SubagentIdentity | undefined {
  const collabPayload = extractCollabPayload(event);
  const item = asObject(collabPayload?.item) ?? collabPayload;
  if (!item) {
    return undefined;
  }
  return resolveSubagentIdentityFromDirectory(
    buildSubagentIdentityDirectory(extractSubagentIdentityHints(item)),
    {
      providerThreadId,
    },
  ) as SubagentIdentity | undefined;
}

export function subagentThreadTitle(identity: {
  nickname?: string | undefined;
  role?: string | undefined;
  providerThreadId?: string | undefined;
}): string {
  if (identity.nickname && identity.role) {
    return `${identity.nickname} [${identity.role}]`;
  }
  if (identity.nickname) {
    return identity.nickname;
  }
  if (identity.role) {
    return `Subagent [${identity.role}]`;
  }
  return identity.providerThreadId ? `Subagent ${identity.providerThreadId}` : "Subagent";
}
