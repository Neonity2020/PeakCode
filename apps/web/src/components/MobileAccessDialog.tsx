// FILE: MobileAccessDialog.tsx
// Purpose: The phone entry next to Settings opens this: a QR hand-off that opens this
//          workspace on a phone, plus the chat-bot channels that keep a session alive
//          after that one-off link. Layout mirrors the reference screen — pairing on the
//          left, bot channels and bot management on the right.
// Layer: Component
// Depends on: the IM bridge routes (`/api/im/mobile-link`, `/api/im/conversations`)
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";

import type { ImChannelId, ImMobileLink } from "@peakcode/contracts";

import { resolveDefaultModelSelection, useAppSettings } from "../appSettings";
import { useFocusedChatContext } from "../focusedChatContext";
import { useMessages } from "../i18n";
import { providerModelsQueryOptions } from "../lib/providerDiscoveryReactQuery";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";
import { DeviceMobileIcon, Loader2Icon, PlugIcon, QrCodeIcon } from "../lib/icons";
import { imApi, imApiErrorMessage } from "../lib/imApi";
import {
  useForgetConversationMutation,
  useImConversationsQuery,
  useImStatusQuery,
} from "../lib/imReactQuery";
import { cn } from "~/lib/utils";
import { Badge } from "./ui/badge";
import { ImRemoteAccessControl } from "./ImRemoteAccessControl";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";

/** Channels offered as bot entries, in the order the reference screen lists them. */
const BOT_CHANNELS: ReadonlyArray<{
  id: ImChannelId;
  labelKey: "wechat" | "feishu" | "qq" | "wecom";
}> = [
  { id: "wechat", labelKey: "wechat" },
  { id: "feishu", labelKey: "feishu" },
  { id: "qq", labelKey: "qq" },
  { id: "wecom", labelKey: "wecom" },
];

export function MobileAccessDialog({
  open,
  onOpenChange,
  onOpenChannels,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Jump to Settings → Channels, where the bot credentials live. */
  readonly onOpenChannels: () => void;
}) {
  const messages = useMessages();
  const t = messages.settings.channels.mobile;
  const { activeProject, activeThread } = useFocusedChatContext();
  const { settings } = useAppSettings();
  const defaultModelSelection = resolveDefaultModelSelection(settings);
  // Same query the composer uses, so this shares its cached catalogue instead of asking
  // the provider again just to show a name.
  const defaultModelOptionsQuery = useQuery(
    providerModelsQueryOptions({
      provider: "pi",
      binaryPath: settings.piBinaryPath || null,
      agentDir: settings.piAgentDir || null,
      enabled: open && defaultModelSelection !== null,
    }),
  );
  const statusQuery = useImStatusQuery();
  const conversationsQuery = useImConversationsQuery();
  const forgetConversation = useForgetConversationMutation();
  const { copyToClipboard, isCopied } = useCopyToClipboard();
  const [link, setLink] = useState<ImMobileLink | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);

  const issueLink = useCallback(async () => {
    setIssuing(true);
    setLinkError(null);
    try {
      // The link carries whatever is open here, so the phone continues this conversation
      // (or at least this project) instead of starting from an empty workspace.
      setLink(
        await imApi.createMobileLink({
          ...(activeThread === null ? {} : { threadId: activeThread.id }),
          ...(activeProject === null ? {} : { projectId: activeProject.id }),
        }),
      );
    } catch (error) {
      setLink(null);
      setLinkError(imApiErrorMessage(error));
    } finally {
      setIssuing(false);
    }
  }, [activeProject, activeThread]);

  // A pairing credential is one-time and short-lived, so a fresh one is minted every
  // time the dialog opens rather than reusing a stale code.
  useEffect(() => {
    if (!open) return;
    void issueLink();
  }, [open, issueLink]);

  const statusById = new Map((statusQuery.data?.channels ?? []).map((entry) => [entry.id, entry]));
  const conversations = conversationsQuery.data ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-3xl gap-0 p-0">
        <DialogHeader className="flex-row items-center gap-3 p-4 pr-12">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-foreground/8 text-foreground/89">
            <DeviceMobileIcon className="size-4.5" />
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <DialogTitle className="text-sm font-semibold">{t.title}</DialogTitle>
            <DialogDescription className="text-xs">{t.description}</DialogDescription>
          </div>
        </DialogHeader>

        <DialogPanel className="max-h-[min(72vh,620px)] px-4 pb-4">
          <div className="grid gap-3 md:grid-cols-2">
            {/* ---------- Phone pairing ---------- */}
            <section className="flex flex-col gap-3 rounded-xl border border-border/70 p-4">
              <header className="flex items-center gap-2">
                <QrCodeIcon className="size-4 text-muted-foreground" />
                <h3 className="flex-1 text-[13px] font-semibold text-foreground">{t.phoneTitle}</h3>
              </header>
              <p className="text-xs text-muted-foreground">{t.phoneDescription}</p>

              <div className="rounded-lg bg-foreground/4 px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="flex-1 text-xs text-foreground/89">{t.waiting}</span>
                  <Badge variant={link === null ? "secondary" : "success"} className="text-[10px]">
                    <span
                      className={cn(
                        "me-1 inline-block size-1.5 rounded-full",
                        link === null ? "bg-muted-foreground/50" : "bg-success-foreground",
                      )}
                    />
                    {link === null ? t.waiting : t.ready}
                  </Badge>
                  {link !== null ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-[11px]"
                      onClick={() => setLink(null)}
                    >
                      {t.stop}
                    </Button>
                  ) : null}
                </div>
              </div>

              {/* What the code opens on the other device, so "continue this chat" is
                  something the user can see before walking away from the desk. */}
              {activeThread !== null ? (
                <p className="text-[11px] font-medium text-foreground/89">
                  {t.opensThread(activeThread.title)}
                </p>
              ) : activeProject !== null ? (
                <p className="text-[11px] font-medium text-foreground/89">
                  {t.opensProject(activeProject.name)}
                </p>
              ) : null}

              {/* Which model the phone's messages will run on: the one thing about the
                  other device that is decided here and cannot be seen from there. */}
              <p className="text-[11px] text-muted-foreground/78">
                {defaultModelSelection === null
                  ? t.defaultModelUnset
                  : t.defaultModelSet(
                      defaultModelOptionsQuery.data?.models.find(
                        (model) => model.slug === defaultModelSelection.model,
                      )?.name ?? defaultModelSelection.model,
                    )}
              </p>

              <p className="text-[11px] text-muted-foreground/78">{t.linkHint}</p>
              <p className="text-[11px] text-muted-foreground/78">
                {messages.settings.channels.remote.openHint}
              </p>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5"
                  disabled={issuing}
                  onClick={() => void issueLink()}
                >
                  {issuing ? (
                    <Loader2Icon className="size-3.5 animate-spin" />
                  ) : (
                    <QrCodeIcon className="size-3.5" />
                  )}
                  {t.refresh}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8"
                  disabled={link === null}
                  onClick={() => {
                    if (link === null) return;
                    copyToClipboard(link.url);
                  }}
                >
                  {isCopied ? t.copied : t.copyLink}
                </Button>
              </div>

              <div className="rounded-lg border border-border/70 px-3 py-2.5">
                <ImRemoteAccessControl status={statusQuery.data?.remoteAccess} tone="compact" />
              </div>

              <div className="flex min-h-56 items-center justify-center rounded-xl border border-dashed border-border/70 bg-background p-4">
                {linkError !== null ? (
                  <p className="max-w-56 text-center text-[11px] text-destructive">{linkError}</p>
                ) : link?.image ? (
                  <img
                    src={link.image}
                    alt={t.phoneTitle}
                    className="size-52 rounded-lg bg-white p-2"
                  />
                ) : (
                  <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
                )}
              </div>
            </section>

            {/* ---------- Bot channels ---------- */}
            <section className="flex flex-col gap-3 rounded-xl border border-border/70 p-4">
              <header className="flex items-center gap-2">
                <PlugIcon className="size-4 text-muted-foreground" />
                <h3 className="flex-1 text-[13px] font-semibold text-foreground">{t.botTitle}</h3>
              </header>
              <p className="text-xs text-muted-foreground">{t.botDescription}</p>

              <ul className="flex flex-col gap-2">
                {BOT_CHANNELS.map((channel) => {
                  const status = statusById.get(channel.id);
                  const label = messages.settings.channels.names[channel.id];
                  return (
                    <li
                      key={channel.id}
                      className="flex flex-col gap-1.5 rounded-lg border border-border/70 bg-foreground/4 px-3 py-2.5"
                    >
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                          {label}
                        </span>
                        {status?.configured ? (
                          <Badge
                            variant={status.state === "connected" ? "success" : "secondary"}
                            className="text-[10px]"
                          >
                            {status.state === "connected"
                              ? messages.settings.channels.status.connected
                              : messages.settings.channels.status.notConfigured}
                          </Badge>
                        ) : null}
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        {messages.settings.channels[channel.labelKey].description}
                      </p>
                      <button
                        type="button"
                        className="self-start text-[11px] font-medium text-foreground/89 underline-offset-2 hover:underline"
                        onClick={() => {
                          onOpenChange(false);
                          onOpenChannels();
                        }}
                      >
                        {t.openSettings}
                      </button>
                    </li>
                  );
                })}
              </ul>

              <div className="mt-auto flex flex-col gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  onClick={() => setManageOpen((previous) => !previous)}
                >
                  {t.manageTitle}
                </Button>
                {manageOpen ? (
                  <div className="flex flex-col gap-1.5 rounded-lg bg-foreground/4 px-3 py-2">
                    <p className="text-[11px] text-muted-foreground">{t.manageDescription}</p>
                    {conversations.length === 0 ? (
                      <p className="text-[11px] text-muted-foreground/78">{t.manageEmpty}</p>
                    ) : (
                      <ul className="flex flex-col gap-1">
                        {conversations.map((conversation) => (
                          <li
                            key={conversation.conversationKey}
                            className="flex items-center gap-2"
                          >
                            <span className="min-w-0 flex-1 truncate text-[11px] text-foreground/89">
                              <span className="text-muted-foreground">
                                {messages.settings.channels.names[conversation.channel]}
                              </span>{" "}
                              {conversation.peerLabel || conversation.peerId}
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 text-[10px]"
                              onClick={() =>
                                forgetConversation.mutate(conversation.conversationKey)
                              }
                            >
                              {messages.settings.channels.conversations.forget}
                            </Button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : null}
              </div>
            </section>
          </div>

          {statusQuery.isError ? (
            <p className="mt-3 text-[11px] text-destructive">{t.loadFailed}</p>
          ) : null}
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
