// FILE: mobile/replyModel.ts
// Purpose: Which model the phone's reply runs on.
//          A thread can carry a model the provider no longer serves — the desktop shows
//          the error and somebody fixes it there, but the phone has no model picker at
//          all, so it substitutes instead of failing. Pure, so the rule is pinned in tests.
// Layer: Mobile view support
// Depends on: contracts and the shared model matcher.
// Exports: resolveReplyModelSelection

import type { ModelSelection } from "@peakcode/contracts";
import { resolveSelectableModel } from "@peakcode/shared/model";

/**
 * The model to send with a reply, or null to let the thread's own model stand.
 *
 * Null is the answer when the provider could not be asked: an unknown catalogue is not a
 * reason to override a deliberate choice, and the thread's model may well work.
 */
export function resolveReplyModelSelection(input: {
  /** What the thread itself is set to. */
  readonly threadSelection: ModelSelection | null;
  /** What new chats default to; the same setting a fresh phone chat starts on. */
  readonly defaultSelection: ModelSelection | null;
  /** The slugs the provider currently offers; empty when they could not be read. */
  readonly offeredSlugs: ReadonlyArray<string>;
}): ModelSelection | null {
  if (input.offeredSlugs.length === 0) return null;

  const offered = (selection: ModelSelection | null): ModelSelection | null => {
    if (selection === null) return null;
    const slug = resolveSelectableModel(
      selection.provider,
      selection.model,
      input.offeredSlugs.map((entry) => ({ slug: entry, name: entry })),
    );
    return slug === null ? null : { provider: selection.provider, model: slug };
  };

  const threadModel = offered(input.threadSelection);
  if (threadModel !== null) return threadModel;

  const defaultModel = offered(input.defaultSelection);
  if (defaultModel !== null) return defaultModel;

  const first = input.offeredSlugs[0];
  return first === undefined ? null : { provider: "pi", model: first };
}
