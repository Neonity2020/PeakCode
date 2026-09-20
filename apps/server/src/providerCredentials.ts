// FILE: providerCredentials.ts
// Purpose: Read and write provider API keys in pi's credential store
// (`<agentDir>/auth.json`).
//
// A provider key is a secret, so it is not kept in `models.json`: that file is
// configuration, it is what users read, copy between machines and commit, and pi itself
// offers a credential store for exactly this. A stored credential also outranks a key
// configured in `models.json`, so the two are kept mutually exclusive — see
// `applyProviderCredentialChanges` and the provider save path.
// Module: server
import { readFile } from "node:fs/promises";
import path from "node:path";

import { getAgentDir } from "@earendil-works/pi-coding-agent";

export function authFilePath(agentDir: string | undefined): string {
  return path.join(agentDir?.trim() || getAgentDir(), "auth.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isApiKeyCredential(value: unknown): boolean {
  return isRecord(value) && value.type === "api_key";
}

function hasUsableKey(value: unknown): boolean {
  return isApiKeyCredential(value) && typeof (value as { key?: unknown }).key === "string";
}

/**
 * Every entry in the credential store, verbatim.
 *
 * pi keeps OAuth logins here too, so callers must treat this as a read-modify-write of
 * unrelated data rather than a file they own. Missing file yields `{}`; malformed content
 * throws, matching pi, which would otherwise replace it on its next write.
 */
export async function readProviderCredentials(
  agentDir: string | undefined,
): Promise<Record<string, unknown>> {
  const filePath = authFilePath(agentDir);
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw cause;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.replace(/^\uFEFF/u, ""));
  } catch (cause) {
    throw new Error(
      `Failed to parse ${filePath}: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
  if (!isRecord(parsed)) {
    throw new Error(`Invalid ${filePath}: expected a JSON object`);
  }
  return parsed;
}

/** Provider ids that hold a usable stored key, so the UI can show "configured". */
export function storedKeyProviderIds(credentials: Record<string, unknown>): ReadonlySet<string> {
  return new Set(
    Object.entries(credentials)
      .filter(([, credential]) => hasUsableKey(credential))
      .map(([providerId]) => providerId),
  );
}

export interface ProviderCredentialChange {
  readonly providerId: string;
  /** A key to store, or `undefined` to forget the stored key. */
  readonly apiKey: string | undefined;
}

/**
 * The credential map a set of key changes produces, plus whether anything moved.
 *
 * Pure, so the caller owns the write: every other credential (OAuth logins, other
 * providers) rides along untouched, and a save that touches no key leaves the file alone
 * rather than rewriting — or creating — it.
 */
export function planProviderCredentialChanges(
  credentials: Record<string, unknown>,
  changes: ReadonlyArray<ProviderCredentialChange>,
): { readonly credentials: Record<string, unknown>; readonly changed: boolean } {
  const next = { ...credentials };
  let changed = false;

  for (const change of changes) {
    const existing = next[change.providerId];
    if (change.apiKey === undefined) {
      // Forgetting a key must not log the provider out: an OAuth credential is a
      // different login and stays.
      if (isApiKeyCredential(existing)) {
        delete next[change.providerId];
        changed = true;
      }
      continue;
    }
    const current = hasUsableKey(existing) ? (existing as { key: string }).key : undefined;
    if (current === change.apiKey) continue;
    next[change.providerId] = { type: "api_key", key: change.apiKey };
    changed = true;
  }

  return { credentials: next, changed };
}
