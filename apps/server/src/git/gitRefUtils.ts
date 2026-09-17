import { realpathSync } from "node:fs";

export function extractBranchFromRef(ref: string): string {
  const normalized = ref.trim();

  if (normalized.startsWith("refs/remotes/")) {
    const withoutPrefix = normalized.slice("refs/remotes/".length);
    const firstSlash = withoutPrefix.indexOf("/");
    if (firstSlash === -1) {
      return withoutPrefix.trim();
    }
    return withoutPrefix.slice(firstSlash + 1).trim();
  }

  const firstSlash = normalized.indexOf("/");
  if (firstSlash === -1) {
    return normalized;
  }
  return normalized.slice(firstSlash + 1).trim();
}

export function prioritizeRemoteNames(remoteNames: readonly string[]): string[] {
  const normalized = remoteNames
    .map((remoteName) => remoteName.trim())
    .filter((remoteName) => remoteName.length > 0);
  if (!normalized.includes("origin")) {
    return normalized;
  }
  return ["origin", ...normalized.filter((remoteName) => remoteName !== "origin")];
}

export function appendUnique(values: string[], next: string | null | undefined): void {
  const trimmed = next?.trim() ?? "";
  if (trimmed.length === 0 || values.includes(trimmed)) {
    return;
  }
  values.push(trimmed);
}

export function canonicalizeExistingPath(value: string): string {
  try {
    return realpathSync.native(value);
  } catch {
    return value;
  }
}

export function combineGitMessages(stdout: string, stderr: string): string | null {
  const parts = [stdout.trim(), stderr.trim()].filter((part) => part.length > 0);
  if (parts.length === 0) {
    return null;
  }
  return parts.join("\n").trim();
}
