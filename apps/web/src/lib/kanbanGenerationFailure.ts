// FILE: kanbanGenerationFailure.ts
// Purpose: Reads a failed requirement generation (or agent run) back to the user
//          in their own language. Providers report failures as free-form text —
//          a 403 JSON blob, a timeout, a missing key — and the pi runtime hands
//          that text through verbatim, so the wording is all there is to go on
//          when deciding what to tell the user to do about it.
// Layer: Web logic helper
// Exports: classifyGenerationFailure, generationFailureReasonText, describeGenerationFailure

import type { Messages } from "../i18n";

export const GENERATION_FAILURE_REASONS = [
  "model-access-denied",
  "auth",
  "model-not-found",
  "timeout",
  "provider-error",
] as const;
export type GenerationFailureReason = (typeof GENERATION_FAILURE_REASONS)[number];

/** A key that may not call the model it was pointed at. */
const MODEL_ACCESS_PATTERNS = [
  /key_model_access_denied/i,
  /not allowed to access model/i,
  /cannot access model/i,
  /model[_ ]access[_ ]denied/i,
  /permission denied/i,
];

const AUTH_PATTERNS = [
  /invalid[_ -]?api[_ -]?key/i,
  /incorrect api key/i,
  /invalid credentials/i,
  /unauthorized/i,
  /authentication/i,
  /\b401\b/,
];

const MODEL_NOT_FOUND_PATTERNS = [
  /model[_ -]not[_ -]found/i,
  /unknown model/i,
  /no such model/i,
  /does not exist/i,
  /model is not available/i,
  /\b404\b/,
];

const TIMEOUT_PATTERNS = [/timed out/i, /timeout/i, /etimedout/i];

const matchesAny = (patterns: ReadonlyArray<RegExp>, message: string): boolean =>
  patterns.some((pattern) => pattern.test(message));

/**
 * What went wrong, as far as the provider's own text says. Ordered so the most
 * specific permission failure wins over the generic status codes it shares.
 */
export function classifyGenerationFailure(message: string): GenerationFailureReason {
  if (matchesAny(MODEL_ACCESS_PATTERNS, message)) return "model-access-denied";
  if (matchesAny(TIMEOUT_PATTERNS, message)) return "timeout";
  if (matchesAny(AUTH_PATTERNS, message)) return "auth";
  if (matchesAny(MODEL_NOT_FOUND_PATTERNS, message)) return "model-not-found";
  return "provider-error";
}

/** The one-line explanation for a failure, naming what the user can do about it. */
export function generationFailureReasonText(messages: Messages, message: string): string {
  const reason = messages.kanban.failure;
  switch (classifyGenerationFailure(message)) {
    case "model-access-denied":
      return reason.modelAccessDenied;
    case "auth":
      return reason.authFailed;
    case "model-not-found":
      return reason.modelNotFound;
    case "timeout":
      return reason.timeout;
    default:
      return reason.providerError;
  }
}

/**
 * Toast content for a failed generation: the explanation as the title, the
 * explanation plus the model it was asked for as the description. Callers keep
 * the raw provider text for the toast's copy action.
 */
export function describeGenerationFailure(
  messages: Messages,
  message: string,
  model?: string | undefined,
): { readonly title: string; readonly description: string } {
  const reason = generationFailureReasonText(messages, message);
  const named = model?.trim() ?? "";
  return {
    title: messages.kanban.failure.requirementTitle,
    description: named.length > 0 ? `${reason} · ${messages.kanban.failure.model(named)}` : reason,
  };
}
