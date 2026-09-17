import type { GitStackedAction } from "@peakcode/contracts";
import { sanitizeFeatureBranchName } from "@peakcode/shared/git";

export function limitContext(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n\n[truncated]`;
}

export function sanitizeCommitMessage(generated: {
  subject: string;
  body: string;
  branch?: string | undefined;
}): {
  subject: string;
  body: string;
  branch?: string | undefined;
} {
  const rawSubject = generated.subject.trim().split(/\r?\n/g)[0]?.trim() ?? "";
  const subject = rawSubject.replace(/[.]+$/g, "").trim();
  const safeSubject = subject.length > 0 ? subject.slice(0, 72).trimEnd() : "Update project files";
  return {
    subject: safeSubject,
    body: generated.body.trim(),
    ...(generated.branch !== undefined ? { branch: generated.branch } : {}),
  };
}

export function summarizePathForCommitSubject(filePath: string): string {
  const trimmed = filePath.trim();
  if (trimmed.length === 0) {
    return "project files";
  }

  const segments = trimmed.split("/").filter((segment) => segment.length > 0);
  return segments.at(-1) ?? trimmed;
}

export function deriveFallbackCommitSubject(stagedSummary: string): string {
  const lines = stagedSummary
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    return "Update project files";
  }

  const firstEntry = lines[0]?.split("\t") ?? [];
  const rawStatus = firstEntry[0]?.trim().toUpperCase() ?? "";
  const firstPath = firstEntry.at(-1)?.trim() ?? "";
  const fileLabel = summarizePathForCommitSubject(firstPath);

  if (lines.length === 1) {
    if (rawStatus.startsWith("A")) {
      return `Add ${fileLabel}`;
    }
    if (rawStatus.startsWith("D")) {
      return `Remove ${fileLabel}`;
    }
    if (rawStatus.startsWith("R")) {
      return `Rename ${fileLabel}`;
    }
    return `Update ${fileLabel}`;
  }

  const uniqueTopLevelDirs = Array.from(
    new Set(
      lines
        .map((line) => {
          const entry = line.split("\t");
          const filePath = entry.at(-1)?.trim() ?? "";
          return filePath.split("/")[0]?.trim() ?? "";
        })
        .filter((segment) => segment.length > 0),
    ),
  );

  if (uniqueTopLevelDirs.length === 1) {
    return `Update ${uniqueTopLevelDirs[0]} files`;
  }

  return "Update project files";
}

export function createFallbackCommitSuggestion(input: {
  stagedSummary: string;
  includeBranch?: boolean;
}): CommitAndBranchSuggestion {
  const subject = deriveFallbackCommitSubject(input.stagedSummary);
  return {
    subject,
    body: "",
    ...(input.includeBranch ? { branch: sanitizeFeatureBranchName(subject) } : {}),
    commitMessage: formatCommitMessage(subject, ""),
  };
}

export interface CommitAndBranchSuggestion {
  subject: string;
  body: string;
  branch?: string | undefined;
  commitMessage: string;
}

export function isCommitAction(
  action: GitStackedAction,
): action is "commit" | "commit_push" | "commit_push_pr" {
  return action === "commit" || action === "commit_push" || action === "commit_push_pr";
}

export function formatCommitMessage(subject: string, body: string): string {
  const trimmedBody = body.trim();
  if (trimmedBody.length === 0) {
    return subject;
  }
  return `${subject}\n\n${trimmedBody}`;
}

export function parseCustomCommitMessage(raw: string): { subject: string; body: string } | null {
  const normalized = raw.replace(/\r\n/g, "\n").trim();
  if (normalized.length === 0) {
    return null;
  }

  const [firstLine, ...rest] = normalized.split("\n");
  const subject = firstLine?.trim() ?? "";
  if (subject.length === 0) {
    return null;
  }

  return {
    subject,
    body: rest.join("\n").trim(),
  };
}
