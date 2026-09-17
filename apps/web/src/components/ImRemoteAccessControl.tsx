// FILE: ImRemoteAccessControl.tsx
// Purpose: The Cloudflare quick-tunnel switch, shared by the mobile dialog and the
//          Channels settings card. One component so both surfaces agree on what the
//          tunnel is doing and what the public address currently is.
// Layer: Component
// Depends on: the IM bridge's remote-access routes
import type { ImRemoteAccessStatus } from "@peakcode/contracts";

import { useMessages } from "../i18n";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";
import { Loader2Icon, PlugIcon } from "../lib/icons";
import { imApiErrorMessage } from "../lib/imApi";
import { useStartRemoteAccessMutation, useStopRemoteAccessMutation } from "../lib/imReactQuery";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { toastManager } from "./ui/toast";

export type ImRemoteAccessTone = "default" | "compact";

export function ImRemoteAccessControl({
  status,
  tone = "default",
}: {
  readonly status: ImRemoteAccessStatus | undefined;
  /** `compact` drops the explanatory paragraphs, for the dialog's narrow column. */
  readonly tone?: ImRemoteAccessTone;
}) {
  const messages = useMessages();
  const t = messages.settings.channels.remote;
  const start = useStartRemoteAccessMutation();
  const stop = useStopRemoteAccessMutation();
  const { copyToClipboard, isCopied } = useCopyToClipboard();
  const compact = tone === "compact";

  const state = status?.state ?? "off";
  const busy = start.isPending || stop.isPending;
  const allowed = status?.allowed ?? true;

  const stateLabel =
    state === "connected"
      ? t.connected
      : state === "connecting"
        ? t.connecting
        : state === "failed"
          ? t.failed
          : t.off;

  const runStart = () =>
    start.mutate(undefined, {
      onSuccess: (next) => {
        if (next.state === "failed") {
          toastManager.add({
            type: "error",
            title: t.failed,
            ...(next.error ? { description: next.error } : {}),
          });
          return;
        }
        toastManager.add({
          type: "success",
          title: t.connected,
          ...(next.url ? { description: next.url } : {}),
        });
      },
      onError: (error) =>
        toastManager.add({ type: "error", title: t.failed, description: imApiErrorMessage(error) }),
    });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <PlugIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 text-xs font-medium text-foreground">{t.title}</span>
        <Badge
          variant={
            state === "connected" ? "success" : state === "failed" ? "destructive" : "secondary"
          }
          className="text-[10px]"
        >
          {stateLabel}
        </Badge>
        {state === "connected" ? (
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[11px]"
            disabled={busy}
            onClick={() => stop.mutate()}
          >
            {t.stop}
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 text-[11px]"
            disabled={busy || !allowed}
            onClick={runStart}
          >
            {busy ? <Loader2Icon className="size-3.5 animate-spin" /> : null}
            {busy ? t.starting : t.start}
          </Button>
        )}
      </div>

      {!compact ? (
        <p className="text-xs leading-relaxed text-muted-foreground">{t.description}</p>
      ) : null}

      {status?.url ? (
        <button
          type="button"
          className="flex items-center gap-2 self-start rounded-lg bg-foreground/4 px-2 py-1 text-left"
          onClick={() => copyToClipboard(status.url)}
        >
          <span className="min-w-0 truncate font-mono text-[11px] text-foreground/89">
            {status.url}
          </span>
          <span className="shrink-0 text-[10px] text-muted-foreground">
            {isCopied ? t.copied : t.copy}
          </span>
        </button>
      ) : null}

      {!allowed ? (
        <p className="text-[11px] text-destructive">{status?.reason ?? t.needsToken}</p>
      ) : state === "connected" ? (
        <p className="text-[11px] text-muted-foreground/78">{t.publicWarning}</p>
      ) : state === "failed" && status?.error ? (
        <p className="text-[11px] text-destructive">{status.error}</p>
      ) : (
        <p className="text-[11px] text-muted-foreground/78">{t.openHint}</p>
      )}
    </div>
  );
}
