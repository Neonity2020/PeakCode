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
  /**
   * The task the worker was given. `resolveSubagentIdentityFromDirectory` carries it through (it
   * comes off the same payload as the nickname), and the child thread's title uses it to tell
   * same-named workers apart.
   */
  readonly prompt?: string;
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

/**
 * A child thread's title.
 *
 * The delegated task is appended when the payload carries one, because identity alone does not
 * distinguish workers: a Multi-Agent turn can dispatch the same `explore` worker eight times, and
 * eight child threads all titled "Explore [explore]" are unusable in the sidebar. The task is
 * what tells them apart.
 */
export function subagentThreadTitle(identity: {
  nickname?: string | undefined;
  role?: string | undefined;
  providerThreadId?: string | undefined;
  prompt?: string | undefined;
}): string {
  const base =
    identity.nickname && identity.role
      ? `${identity.nickname} [${identity.role}]`
      : identity.nickname
        ? identity.nickname
        : identity.role
          ? `Subagent [${identity.role}]`
          : identity.providerThreadId
            ? `Subagent ${identity.providerThreadId}`
            : "Subagent";
  const task = identity.prompt?.trim();
  return task ? `${base} · ${task}` : base;
}
