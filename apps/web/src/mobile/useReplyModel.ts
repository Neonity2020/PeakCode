// FILE: mobile/useReplyModel.ts
// Purpose: The phone's copy of "what may this reply run on": the provider's current model
//          list plus the configured default, fetched once per page and shared by every
//          conversation the phone opens.
// Layer: Mobile data
// Depends on: the WS native API (`provider.listModels`, `server.getSettings`).
// Exports: useReplyModelDefaults, resolvePhoneReplyModel

import type { ModelSelection } from "@peakcode/contracts";
import { useEffect, useState } from "react";

import { readNativeApi } from "../nativeApi";
import { resolveReplyModelSelection } from "./replyModel";

interface ReplyModelDefaults {
  readonly offeredSlugs: ReadonlyArray<string>;
  readonly defaultSelection: ModelSelection | null;
}

const EMPTY_DEFAULTS: ReplyModelDefaults = { offeredSlugs: [], defaultSelection: null };

/** One fetch per page load: the catalogue does not change while a phone replies. */
let cachedDefaults: Promise<ReplyModelDefaults> | null = null;

async function loadReplyModelDefaults(): Promise<ReplyModelDefaults> {
  const api = readNativeApi();
  if (!api) return EMPTY_DEFAULTS;
  const [models, settings] = await Promise.all([
    api.provider
      .listModels({ provider: "pi" })
      .then((result) => result.models.map((model) => model.slug))
      .catch(() => [] as ReadonlyArray<string>),
    api.server
      .getSettings()
      .then((current) => current.defaultModelSelection ?? null)
      .catch(() => null),
  ]);
  return { offeredSlugs: models, defaultSelection: settings };
}

export function useReplyModelDefaults(): ReplyModelDefaults {
  const [defaults, setDefaults] = useState<ReplyModelDefaults>(EMPTY_DEFAULTS);

  useEffect(() => {
    let cancelled = false;
    cachedDefaults ??= loadReplyModelDefaults();
    void cachedDefaults.then((loaded) => {
      if (!cancelled) setDefaults(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return defaults;
}

/** What this phone should send with a reply, given the thread it is replying into. */
export function resolvePhoneReplyModel(
  threadSelection: ModelSelection | null,
  defaults: ReplyModelDefaults,
): ModelSelection | null {
  return resolveReplyModelSelection({
    threadSelection,
    defaultSelection: defaults.defaultSelection,
    offeredSlugs: defaults.offeredSlugs,
  });
}
