// FILE: ImChannelsSettingsPanel.tsx
// Purpose: Settings → Channels. Configures every way a chat app can drive this
//          workspace: personal WeChat (QR login), Feishu/Lark, QQ, the two Tencent
//          callback channels, group-robot webhooks, and the inbound HTTP bridge.
// Layer: Route screen support
// Depends on: the server's IM bridge routes plus the existing settings plumbing
import { useState } from "react";

import type {
  ImChannelId,
  ImChannelStatus,
  ImSettings,
  ServerSettingsPatch,
} from "@peakcode/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { cn } from "~/lib/utils";
import { useMessages } from "../i18n";
import { imApi, imApiErrorMessage } from "../lib/imApi";
import {
  useDisconnectWechatMutation,
  useForgetConversationMutation,
  useImConversationsQuery,
  useImStatusQuery,
  useTestChannelMutation,
  useWechatQrCodeMutation,
  useWechatQrStatusMutation,
} from "../lib/imReactQuery";
import { serverQueryKeys, serverSettingsQueryOptions } from "../lib/serverReactQuery";
import { ensureNativeApi } from "../nativeApi";
import { useStore } from "../store";
import { toastManager } from "./ui/toast";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { ImRemoteAccessControl } from "./ImRemoteAccessControl";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "./ui/select";

const PANEL_CONTROL_CLASS = "rounded-xl border-foreground/9 bg-foreground/4 shadow-none";
const PANEL_LABEL_CLASS = "block text-xs font-medium text-foreground";
const PANEL_SELECT_CLASS =
  "h-8 w-full rounded-xl border-transparent bg-foreground/8 px-3 shadow-none [&_svg]:opacity-45";
const CARD_CLASS = "rounded-xl border border-border/70 bg-background";

/** Which credential fields each channel owns, in the order the form shows them. */
const CHANNEL_FIELD_ORDER: Record<ImChannelId, ReadonlyArray<string>> = {
  wechat: [],
  feishu: ["domain", "appId", "appSecret"],
  qq: ["appId", "appSecret"],
  wecom: ["corpId", "agentId", "secret", "callbackToken", "encodingAesKey"],
  wechatMp: ["appId", "appSecret", "callbackToken", "encodingAesKey"],
  webhook: ["wecomUrl", "dingtalkUrl", "dingtalkSecret", "secret"],
};

/** Connected channels read as live, failures as broken, everything else as neutral. */
function badgeVariant(status: ImChannelStatus | undefined) {
  if (status?.state === "connected" && status.configured) return "default" as const;
  if (status?.state === "failed") return "destructive" as const;
  return "secondary" as const;
}

const SECRET_FIELDS = new Set([
  "appSecret",
  "secret",
  "encodingAesKey",
  "dingtalkSecret",
  "inboundSecret",
]);

/** The settings key a channel's credentials live under. */
const settingsKeyFor = (channel: ImChannelId): keyof ImSettings => {
  switch (channel) {
    case "wechat":
      return "wechat";
    case "feishu":
      return "feishu";
    case "qq":
      return "qq";
    case "wecom":
      return "wecom";
    case "wechatMp":
      return "wechatMp";
    case "webhook":
      return "webhooks";
  }
};

type FieldValues = Record<string, string>;

export function ImChannelsSettingsPanel() {
  const messages = useMessages();
  const t = messages.settings.channels;
  const queryClient = useQueryClient();
  const statusQuery = useImStatusQuery();
  const conversationsQuery = useImConversationsQuery();
  const testChannel = useTestChannelMutation();
  const forgetConversation = useForgetConversationMutation();
  const settingsQuery = useQuery(serverSettingsQueryOptions());
  const projects = useStore((store) => store.projects);
  const [editing, setEditing] = useState<ImChannelId | null>(null);
  const [draft, setDraft] = useState<FieldValues>({});
  const [savingChannel, setSavingChannel] = useState<ImChannelId | null>(null);

  const settings = settingsQuery.data;
  const im: ImSettings | undefined = settings?.im;
  const statusById = new Map<ImChannelId, ImChannelStatus>(
    (statusQuery.data?.channels ?? []).map((channel) => [channel.id, channel]),
  );

  const patchSettings = async (patch: NonNullable<ServerSettingsPatch["im"]>) => {
    const api = ensureNativeApi();
    const next = await api.server.updateSettings({ im: patch });
    queryClient.setQueryData(serverQueryKeys.settings(), next);
    void queryClient.invalidateQueries({ queryKey: ["im"] });
  };

  const saveChannel = async (channel: ImChannelId) => {
    const fields = CHANNEL_FIELD_ORDER[channel];
    // Field names come from CHANNEL_FIELD_ORDER, so the per-channel patch shape is
    // assembled dynamically and asserted once at the call site.
    const payload: Record<string, string> = {};
    for (const field of fields) {
      const value = draft[field];
      // An empty secret field means "keep what is stored", so it is never written back.
      if (value === undefined || value === "") continue;
      payload[field] = value;
    }
    if (Object.keys(payload).length === 0) {
      setEditing(null);
      return;
    }
    setSavingChannel(channel);
    try {
      await patchSettings({ [settingsKeyFor(channel)]: payload } as NonNullable<
        ServerSettingsPatch["im"]
      >);
      toastManager.add({ type: "success", title: t.actions.saved });
      setEditing(null);
      setDraft({});
    } catch (error) {
      toastManager.add({ type: "error", title: imApiErrorMessage(error) });
    } finally {
      setSavingChannel(null);
    }
  };

  const runTest = (channel: ImChannelId) => {
    testChannel.mutate(channel, {
      onSuccess: (result) => {
        toastManager.add({
          type: "success",
          title: `${t.names[channel]} · ${t.status.connected}`,
          ...(result.detail ? { description: result.detail } : {}),
        });
      },
      onError: (error) => {
        toastManager.add({
          type: "error",
          title: `${t.names[channel]} · ${t.status.failed}`,
          description: imApiErrorMessage(error),
        });
      },
    });
  };

  const statusLabel = (status: ImChannelStatus | undefined): string => {
    if (!status) return t.status.off;
    if (!status.configured) return t.status.notConfigured;
    if (status.state === "connected") return t.status.connected;
    if (status.state === "connecting") return t.status.connecting;
    if (status.state === "failed") return t.status.failed;
    return t.status.off;
  };

  const renderField = (channel: ImChannelId, field: string) => {
    const label = fieldLabel(t, channel, field);
    if (field === "domain") {
      const value = draft.domain ?? im?.feishu.domain ?? "feishu";
      return (
        <label key={field} className="block">
          <span className={PANEL_LABEL_CLASS}>{t.feishu.domain}</span>
          <Select
            value={value}
            onValueChange={(next) => {
              if (typeof next === "string") setDraft((prev) => ({ ...prev, domain: next }));
            }}
          >
            <SelectTrigger className={cn("mt-1", PANEL_SELECT_CLASS)}>
              <SelectValue>
                {value === "lark" ? t.feishu.domainLark : t.feishu.domainFeishu}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value="feishu">{t.feishu.domainFeishu}</SelectItem>
              <SelectItem value="lark">{t.feishu.domainLark}</SelectItem>
            </SelectPopup>
          </Select>
        </label>
      );
    }
    const isSecret = SECRET_FIELDS.has(field);
    return (
      <label key={field} className="block">
        <span className={PANEL_LABEL_CLASS}>{label}</span>
        <Input
          className={cn("mt-1 font-mono text-xs", PANEL_CONTROL_CLASS)}
          type={isSecret ? "password" : "text"}
          spellCheck={false}
          value={draft[field] ?? ""}
          placeholder={
            isSecret || isFieldStored(im, channel, field) ? t.feishu.secretPlaceholder : ""
          }
          onChange={(event) => setDraft((prev) => ({ ...prev, [field]: event.target.value }))}
        />
      </label>
    );
  };

  if (!im) {
    return (
      <div className="flex min-h-0 w-full flex-1 flex-col gap-3 px-5 py-4">
        <h2 className="text-sm font-medium text-foreground">{t.heading}</h2>
        <p className="text-xs text-muted-foreground">{t.mobile.loadFailed}</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium text-foreground">{t.heading}</h2>
        <p className="text-xs text-muted-foreground">{t.description}</p>
      </div>

      {/* How IM runs behave: where threads open and how much freedom they get. */}
      <section className={cn(CARD_CLASS, "flex flex-col gap-3 px-4 py-3")}>
        <div>
          <h3 className="text-[13px] font-semibold text-foreground">{t.behavior.title}</h3>
          <p className="text-xs text-muted-foreground">{t.behavior.description}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className={PANEL_LABEL_CLASS}>{t.behavior.project}</span>
            <Select
              value={im.defaultProjectId === "" ? "__auto__" : im.defaultProjectId}
              onValueChange={(next) => {
                if (typeof next !== "string") return;
                void patchSettings({
                  defaultProjectId: next === "__auto__" ? "" : next,
                }).catch((error) =>
                  toastManager.add({ type: "error", title: imApiErrorMessage(error) }),
                );
              }}
            >
              <SelectTrigger className={cn("mt-1", PANEL_SELECT_CLASS)}>
                <SelectValue>
                  {im.defaultProjectId === ""
                    ? t.behavior.projectAuto
                    : (projects.find((project) => project.id === im.defaultProjectId)?.name ??
                      t.behavior.projectAuto)}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value="__auto__">{t.behavior.projectAuto}</SelectItem>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </label>
          <label className="block">
            <span className={PANEL_LABEL_CLASS}>{t.behavior.idleHours}</span>
            <Input
              className={cn("mt-1", PANEL_CONTROL_CLASS)}
              type="number"
              min={0}
              value={String(im.sessionIdleHours)}
              onChange={(event) => {
                const hours = Number(event.target.value);
                if (!Number.isFinite(hours) || hours < 0) return;
                void patchSettings({ sessionIdleHours: hours }).catch(() => undefined);
              }}
            />
            <span className="mt-1 block text-[11px] text-muted-foreground/78">
              {t.behavior.idleHoursHint}
            </span>
          </label>
          <label className="block">
            <span className={PANEL_LABEL_CLASS}>{t.behavior.runtimeMode}</span>
            <Select
              value={im.runtimeMode}
              onValueChange={(next) => {
                if (typeof next !== "string") return;
                void patchSettings({ runtimeMode: next }).catch((error) =>
                  toastManager.add({ type: "error", title: imApiErrorMessage(error) }),
                );
              }}
            >
              <SelectTrigger className={cn("mt-1", PANEL_SELECT_CLASS)}>
                <SelectValue>
                  {im.runtimeMode === "full-access" ? t.behavior.modeFull : t.behavior.modeApproval}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value="approval-required">{t.behavior.modeApproval}</SelectItem>
                <SelectItem value="full-access">{t.behavior.modeFull}</SelectItem>
              </SelectPopup>
            </Select>
            <span className="mt-1 block text-[11px] text-muted-foreground/78">
              {t.behavior.runtimeModeHint}
            </span>
          </label>
        </div>
      </section>

      {/* Public door for the phone: a Cloudflare quick tunnel in front of this port. */}
      <section className={cn(CARD_CLASS, "flex flex-col gap-3 px-4 py-3")}>
        <ImRemoteAccessControl status={statusQuery.data?.remoteAccess} />
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={im.remoteAccess.enabled}
              onChange={(event) => {
                const enabled = event.target.checked;
                void patchSettings({ remoteAccess: { enabled } })
                  .then(() => {
                    // Turning it on also opens it now; turning it off closes it.
                    return enabled ? imApi.startRemoteAccess() : imApi.stopRemoteAccess();
                  })
                  .catch((error) =>
                    toastManager.add({ type: "error", title: imApiErrorMessage(error) }),
                  );
              }}
            />
            <span>
              <span className={PANEL_LABEL_CLASS}>{t.remote.autoStart}</span>
              <span className="mt-0.5 block text-[11px] text-muted-foreground/78">
                {t.remote.autoStartHint}
              </span>
            </span>
          </label>
          <label className="block">
            <span className={PANEL_LABEL_CLASS}>{t.remote.binaryPath}</span>
            <Input
              className={cn("mt-1 font-mono text-xs", PANEL_CONTROL_CLASS)}
              defaultValue={im.remoteAccess.binaryPath}
              spellCheck={false}
              onBlur={(event) => {
                const binaryPath = event.target.value.trim();
                if (binaryPath === im.remoteAccess.binaryPath || binaryPath.length === 0) return;
                void patchSettings({ remoteAccess: { binaryPath } }).catch((error) =>
                  toastManager.add({ type: "error", title: imApiErrorMessage(error) }),
                );
              }}
            />
            <span className="mt-1 block text-[11px] text-muted-foreground/78">
              {t.remote.binaryPathHint}
            </span>
          </label>
        </div>
      </section>

      <WechatChannelCard
        status={statusById.get("wechat")}
        statusLabel={statusLabel(statusById.get("wechat"))}
        badgeVariant={badgeVariant(statusById.get("wechat"))}
      />

      {(["feishu", "qq", "wecom", "wechatMp", "webhook"] as const).map((channel) => {
        const status = statusById.get(channel);
        const fields = CHANNEL_FIELD_ORDER[channel];
        const editingThis = editing === channel;
        return (
          <section key={channel} className={cn(CARD_CLASS, "flex flex-col gap-3 px-4 py-3")}>
            <header className="flex items-center gap-2">
              <h3 className="flex-1 text-[13px] font-semibold text-foreground">
                {t.names[channel]}
              </h3>
              <Badge variant={badgeVariant(status)} className="text-[10px]">
                {statusLabel(status)}
              </Badge>
            </header>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {channelDescription(t, channel)}
            </p>
            {channel === "wecom" || channel === "wechatMp" ? (
              <p className="text-[11px] text-muted-foreground/78">
                {t[channel].callbackHint}:{" "}
                <code className="rounded bg-foreground/8 px-1 font-mono text-[10px]">
                  {window.location.origin}
                  {channel === "wecom" ? "/api/im/wecom/events" : "/api/im/wechat-mp/events"}
                </code>
              </p>
            ) : null}
            {channel === "webhook" ? (
              <p className="text-[11px] text-muted-foreground/78">{t.webhooks.taskHint}</p>
            ) : null}
            {status?.error ? <p className="text-[11px] text-destructive">{status.error}</p> : null}
            {status?.detail ? (
              <p className="text-[11px] text-muted-foreground/78">{status.detail}</p>
            ) : null}

            {editingThis ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {fields.map((field) => renderField(channel, field))}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              {editingThis ? (
                <>
                  <Button
                    size="sm"
                    className="h-8"
                    disabled={savingChannel === channel}
                    onClick={() => void saveChannel(channel)}
                  >
                    {savingChannel === channel ? t.actions.saving : t.actions.save}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8"
                    onClick={() => {
                      setEditing(null);
                      setDraft({});
                    }}
                  >
                    {messages.common.cancel}
                  </Button>
                </>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  onClick={() => {
                    setEditing(channel);
                    setDraft({});
                  }}
                >
                  {t.actions.save}
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="h-8"
                disabled={testChannel.isPending}
                onClick={() => runTest(channel)}
              >
                {testChannel.isPending ? t.actions.testing : t.actions.test}
              </Button>
            </div>
          </section>
        );
      })}

      <section className={cn(CARD_CLASS, "flex flex-col gap-2 px-4 py-3")}>
        <h3 className="text-[13px] font-semibold text-foreground">{t.conversations.title}</h3>
        <p className="text-xs text-muted-foreground">{t.conversations.description}</p>
        {(conversationsQuery.data ?? []).length === 0 ? (
          <p className="text-xs text-muted-foreground/78">{t.conversations.empty}</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {(conversationsQuery.data ?? []).map((conversation) => (
              <li
                key={conversation.conversationKey}
                className="flex items-center gap-2 rounded-lg bg-foreground/4 px-3 py-2"
              >
                <span className="min-w-0 flex-1 truncate text-xs text-foreground">
                  <span className="text-muted-foreground">{t.names[conversation.channel]}</span>{" "}
                  {conversation.peerLabel || conversation.peerId}
                </span>
                <span className="text-[10px] text-muted-foreground/78">
                  {conversation.lastMessageAt.slice(5, 16).replace("T", " ")}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-[11px]"
                  onClick={() => forgetConversation.mutate(conversation.conversationKey)}
                >
                  {t.conversations.forget}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={cn(CARD_CLASS, "flex flex-col gap-2 px-4 py-3")}>
        <h3 className="text-[13px] font-semibold text-foreground">{t.log.title}</h3>
        {(statusQuery.data?.log ?? []).length === 0 ? (
          <p className="text-xs text-muted-foreground/78">{t.log.empty}</p>
        ) : (
          <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
            {(statusQuery.data?.log ?? []).slice(0, 50).map((entry) => (
              <li
                key={`${entry.at}-${entry.channel}-${entry.direction}-${entry.text.slice(0, 24)}`}
                className="flex items-start gap-2 text-[11px]"
              >
                <span className="shrink-0 tabular-nums text-muted-foreground/78">
                  {entry.at.slice(11, 19)}
                </span>
                <span className="shrink-0 text-muted-foreground">{t.names[entry.channel]}</span>
                <span
                  className={cn(
                    "shrink-0",
                    entry.direction === "error" ? "text-destructive" : "text-muted-foreground/78",
                  )}
                >
                  {entry.direction === "in"
                    ? t.log.incoming
                    : entry.direction === "out"
                      ? t.log.outgoing
                      : t.log.error}
                </span>
                <span className="min-w-0 flex-1 break-words text-foreground/89">{entry.text}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** The personal-WeChat card owns the QR handshake as well as its status. */
function WechatChannelCard({
  status,
  statusLabel,
  badgeVariant,
}: {
  readonly status: ImChannelStatus | undefined;
  readonly statusLabel: string;
  readonly badgeVariant: "default" | "secondary" | "destructive";
}) {
  const messages = useMessages();
  const t = messages.settings.channels;
  const qrCode = useWechatQrCodeMutation();
  const qrStatus = useWechatQrStatusMutation();
  const disconnect = useDisconnectWechatMutation();
  const [polling, setPolling] = useState(false);

  const startScan = () => {
    qrCode.mutate(undefined, {
      onSuccess: (code) => {
        setPolling(true);
        void pollLoop(code.qrcode);
      },
      onError: (error) => toastManager.add({ type: "error", title: imApiErrorMessage(error) }),
    });
  };

  const pollLoop = async (qrcode: string) => {
    try {
      while (true) {
        const result = await qrStatus.mutateAsync(qrcode);
        if (result.status === "confirmed") {
          setPolling(false);
          toastManager.add({ type: "success", title: t.wechat.confirmed });
          return;
        }
        if (result.status === "expired") {
          setPolling(false);
          toastManager.add({ type: "info", title: t.wechat.expired });
          return;
        }
      }
    } catch (error) {
      setPolling(false);
      toastManager.add({ type: "error", title: imApiErrorMessage(error) });
    }
  };

  return (
    <section className={cn(CARD_CLASS, "flex flex-col gap-3 px-4 py-3")}>
      <header className="flex items-center gap-2">
        <h3 className="flex-1 text-[13px] font-semibold text-foreground">{t.wechat.title}</h3>
        <Badge variant={badgeVariant} className="text-[10px]">
          {statusLabel}
        </Badge>
      </header>
      <p className="text-xs leading-relaxed text-muted-foreground">{t.wechat.description}</p>
      {status?.error ? <p className="text-[11px] text-destructive">{status.error}</p> : null}

      {polling && qrCode.data ? (
        <div className="flex flex-col items-center gap-2 rounded-xl bg-foreground/4 p-4">
          {qrCode.data.image ? (
            <img
              src={qrCode.data.image}
              alt={t.wechat.scan}
              className="size-48 rounded-lg bg-white p-1"
            />
          ) : null}
          <p className="text-xs text-muted-foreground">{t.wechat.scanHint}</p>
          <p className="text-[11px] text-muted-foreground/78">
            {qrStatus.data?.status === "scanned" ? t.wechat.scanned : t.wechat.waiting}
          </p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" className="h-8" disabled={qrCode.isPending} onClick={startScan}>
          {status?.configured ? t.wechat.rescan : t.wechat.scan}
        </Button>
        {status?.configured ? (
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            disabled={disconnect.isPending}
            onClick={() => {
              if (!window.confirm(t.wechat.disconnectConfirm)) return;
              disconnect.mutate(undefined, {
                onError: (error) =>
                  toastManager.add({ type: "error", title: imApiErrorMessage(error) }),
              });
            }}
          >
            {t.actions.disconnect}
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function fieldLabel(
  t: ReturnType<typeof useMessages>["settings"]["channels"],
  channel: ImChannelId,
  field: string,
): string {
  const channelLabels =
    channel === "feishu"
      ? t.feishu
      : channel === "qq"
        ? t.qq
        : channel === "wecom"
          ? t.wecom
          : channel === "wechatMp"
            ? t.wechatMp
            : t.webhooks;
  const labels = channelLabels as unknown as Record<string, string | undefined>;
  return labels[field] ?? field;
}

function channelDescription(
  t: ReturnType<typeof useMessages>["settings"]["channels"],
  channel: ImChannelId,
): string {
  switch (channel) {
    case "feishu":
      return t.feishu.description;
    case "qq":
      return t.qq.description;
    case "wecom":
      return t.wecom.description;
    case "wechatMp":
      return t.wechatMp.description;
    case "webhook":
      return t.webhooks.description;
    case "wechat":
      return t.wechat.description;
  }
}

/** Whether a field already holds a value, so the form can say "leave empty to keep it". */
function isFieldStored(im: ImSettings | undefined, channel: ImChannelId, field: string): boolean {
  if (!im) return false;
  const group = im[settingsKeyFor(channel)] as unknown as Record<string, unknown> | undefined;
  const value = group?.[field];
  return typeof value === "string" && value.length > 0;
}
