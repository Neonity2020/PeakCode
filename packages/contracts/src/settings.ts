import { Schema } from "effect";
import { TrimmedString } from "./baseSchemas";
import { ModelSelection, ProviderKind, RuntimeMode, ThreadEnvironmentMode } from "./orchestration";
const StringSetting = TrimmedString.check(Schema.isMaxLength(4096));
const CustomModels = Schema.Array(Schema.String.check(Schema.isMaxLength(256))).pipe(
  Schema.withDecodingDefault(() => []),
);

const ProviderSettingsBase = {
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(() => true)),
  binaryPath: StringSetting.pipe(Schema.withDecodingDefault(() => "")),
  customModels: CustomModels,
};

export const PiServerProviderSettings = Schema.Struct({
  ...ProviderSettingsBase,
  binaryPath: StringSetting.pipe(Schema.withDecodingDefault(() => "pi")),
  agentDir: StringSetting.pipe(Schema.withDecodingDefault(() => "")),
});
export type PiServerProviderSettings = typeof PiServerProviderSettings.Type;

const DEFAULT_TEXT_GENERATION_MODEL = "pi-coding-agent";

/** Feishu (China) and Lark (international) speak the same API on different hosts. */
export const IM_FEISHU_DOMAINS = ["feishu", "lark"] as const;
export const ImFeishuDomain = Schema.Literals(IM_FEISHU_DOMAINS);
export type ImFeishuDomain = typeof ImFeishuDomain.Type;

/** Personal-WeChat bridge; its credentials are minted by the QR handshake. */
export const ImWechatChannelSettings = Schema.Struct({
  botToken: StringSetting.pipe(Schema.withDecodingDefault(() => "")),
  botId: StringSetting.pipe(Schema.withDecodingDefault(() => "")),
  baseUrl: StringSetting.pipe(Schema.withDecodingDefault(() => "")),
  /** Long-poll cursor, persisted so a restart does not replay delivered messages. */
  cursor: StringSetting.pipe(Schema.withDecodingDefault(() => "")),
});
export type ImWechatChannelSettings = typeof ImWechatChannelSettings.Type;

export const ImFeishuChannelSettings = Schema.Struct({
  domain: ImFeishuDomain.pipe(Schema.withDecodingDefault(() => "feishu" as const)),
  appId: StringSetting.pipe(Schema.withDecodingDefault(() => "")),
  appSecret: StringSetting.pipe(Schema.withDecodingDefault(() => "")),
});
export type ImFeishuChannelSettings = typeof ImFeishuChannelSettings.Type;

export const ImQqChannelSettings = Schema.Struct({
  appId: StringSetting.pipe(Schema.withDecodingDefault(() => "")),
  appSecret: StringSetting.pipe(Schema.withDecodingDefault(() => "")),
});
export type ImQqChannelSettings = typeof ImQqChannelSettings.Type;

export const ImWecomChannelSettings = Schema.Struct({
  corpId: StringSetting.pipe(Schema.withDecodingDefault(() => "")),
  agentId: StringSetting.pipe(Schema.withDecodingDefault(() => "")),
  secret: StringSetting.pipe(Schema.withDecodingDefault(() => "")),
  callbackToken: StringSetting.pipe(Schema.withDecodingDefault(() => "")),
  encodingAesKey: StringSetting.pipe(Schema.withDecodingDefault(() => "")),
});
export type ImWecomChannelSettings = typeof ImWecomChannelSettings.Type;

export const ImWechatMpChannelSettings = Schema.Struct({
  appId: StringSetting.pipe(Schema.withDecodingDefault(() => "")),
  appSecret: StringSetting.pipe(Schema.withDecodingDefault(() => "")),
  callbackToken: StringSetting.pipe(Schema.withDecodingDefault(() => "")),
  encodingAesKey: StringSetting.pipe(Schema.withDecodingDefault(() => "")),
});
export type ImWechatMpChannelSettings = typeof ImWechatMpChannelSettings.Type;

/**
 * Remote access for phones: a Cloudflare quick tunnel that publishes this server on an
 * `https://*.trycloudflare.com` address. `enabled` starts one at boot; the assigned URL
 * is remembered so the settings screen can show the last one.
 */
export const ImRemoteAccessSettings = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(() => false)),
  binaryPath: StringSetting.pipe(Schema.withDecodingDefault(() => "cloudflared")),
  url: StringSetting.pipe(Schema.withDecodingDefault(() => "")),
});
export type ImRemoteAccessSettings = typeof ImRemoteAccessSettings.Type;

/** Group-robot webhooks (push-only) plus the secret guarding the inbound bridge. */
export const ImWebhookChannelSettings = Schema.Struct({
  wecomUrl: StringSetting.pipe(Schema.withDecodingDefault(() => "")),
  dingtalkUrl: StringSetting.pipe(Schema.withDecodingDefault(() => "")),
  dingtalkSecret: StringSetting.pipe(Schema.withDecodingDefault(() => "")),
  secret: StringSetting.pipe(Schema.withDecodingDefault(() => "")),
});
export type ImWebhookChannelSettings = typeof ImWebhookChannelSettings.Type;

/**
 * Settings for the IM bridge itself: which workspace its threads open in, how long
 * a chat may sit idle before it gets a fresh context, and how much freedom the
 * unattended runs get.
 */
export const ImSettings = Schema.Struct({
  /** Workspace IM threads open in; empty means the most recently used project. */
  defaultProjectId: StringSetting.pipe(Schema.withDecodingDefault(() => "")),
  /** Chats untouched for this many hours start over; 0 keeps one context forever. */
  sessionIdleHours: Schema.Number.pipe(Schema.withDecodingDefault(() => 12)),
  /**
   * Nobody is at the screen during an IM run, so an approval would sit unanswered.
   * Still defaults to the approval gate — granting full access is an explicit choice.
   */
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(() => "approval-required" as const)),
  wechat: ImWechatChannelSettings.pipe(Schema.withDecodingDefault(() => ({}))),
  feishu: ImFeishuChannelSettings.pipe(Schema.withDecodingDefault(() => ({}))),
  qq: ImQqChannelSettings.pipe(Schema.withDecodingDefault(() => ({}))),
  wecom: ImWecomChannelSettings.pipe(Schema.withDecodingDefault(() => ({}))),
  wechatMp: ImWechatMpChannelSettings.pipe(Schema.withDecodingDefault(() => ({}))),
  webhooks: ImWebhookChannelSettings.pipe(Schema.withDecodingDefault(() => ({}))),
  remoteAccess: ImRemoteAccessSettings.pipe(Schema.withDecodingDefault(() => ({}))),
});
export type ImSettings = typeof ImSettings.Type;

export const ServerSettings = Schema.Struct({
  enableAssistantStreaming: Schema.Boolean.pipe(Schema.withDecodingDefault(() => false)),
  defaultThreadEnvMode: ThreadEnvironmentMode.pipe(Schema.withDecodingDefault(() => "local")),
  addProjectBaseDirectory: StringSetting.pipe(Schema.withDecodingDefault(() => "")),
  textGenerationModelSelection: ModelSelection.pipe(
    Schema.withDecodingDefault(() => ({
      provider: "pi" as const,
      model: DEFAULT_TEXT_GENERATION_MODEL,
    })),
  ),
  /**
   * Model a new chat runs on when nothing more specific applies. Absent means "not
   * configured": the first model the provider offers wins, which is what a fresh install
   * has always done.
   *
   * It lives on the server because the clients that need it most have no local state to
   * carry it: a phone that only ever scanned a pairing code starts every composer
   * preference from scratch, and headless runs (IM chats, kanban cards, automations) have
   * no composer at all.
   */
  defaultModelSelection: Schema.optionalKey(ModelSelection),
  providers: Schema.Struct({
    pi: PiServerProviderSettings.pipe(Schema.withDecodingDefault(() => ({}))),
  }).pipe(Schema.withDecodingDefault(() => ({}))),
  im: ImSettings.pipe(Schema.withDecodingDefault(() => ({}))),
});
export type ServerSettings = typeof ServerSettings.Type;

export const DEFAULT_SERVER_SETTINGS: ServerSettings = Schema.decodeSync(ServerSettings)({});

const ModelSelectionPatch = Schema.Struct({
  provider: Schema.optionalKey(ProviderKind),
  model: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(256))),
  options: Schema.optionalKey(Schema.Unknown),
});

const ProviderSettingsBasePatch = {
  enabled: Schema.optionalKey(Schema.Boolean),
  binaryPath: Schema.optionalKey(StringSetting),
  customModels: Schema.optionalKey(CustomModels),
};

/** Channel credentials are written field-by-field; omitted keys keep their value. */
const ImSettingsPatch = Schema.Struct({
  defaultProjectId: Schema.optionalKey(StringSetting),
  sessionIdleHours: Schema.optionalKey(Schema.Number),
  runtimeMode: Schema.optionalKey(RuntimeMode),
  wechat: Schema.optionalKey(
    Schema.Struct({
      botToken: Schema.optionalKey(StringSetting),
      botId: Schema.optionalKey(StringSetting),
      baseUrl: Schema.optionalKey(StringSetting),
      cursor: Schema.optionalKey(StringSetting),
    }),
  ),
  feishu: Schema.optionalKey(
    Schema.Struct({
      domain: Schema.optionalKey(ImFeishuDomain),
      appId: Schema.optionalKey(StringSetting),
      appSecret: Schema.optionalKey(StringSetting),
    }),
  ),
  qq: Schema.optionalKey(
    Schema.Struct({
      appId: Schema.optionalKey(StringSetting),
      appSecret: Schema.optionalKey(StringSetting),
    }),
  ),
  wecom: Schema.optionalKey(
    Schema.Struct({
      corpId: Schema.optionalKey(StringSetting),
      agentId: Schema.optionalKey(StringSetting),
      secret: Schema.optionalKey(StringSetting),
      callbackToken: Schema.optionalKey(StringSetting),
      encodingAesKey: Schema.optionalKey(StringSetting),
    }),
  ),
  wechatMp: Schema.optionalKey(
    Schema.Struct({
      appId: Schema.optionalKey(StringSetting),
      appSecret: Schema.optionalKey(StringSetting),
      callbackToken: Schema.optionalKey(StringSetting),
      encodingAesKey: Schema.optionalKey(StringSetting),
    }),
  ),
  webhooks: Schema.optionalKey(
    Schema.Struct({
      wecomUrl: Schema.optionalKey(StringSetting),
      dingtalkUrl: Schema.optionalKey(StringSetting),
      dingtalkSecret: Schema.optionalKey(StringSetting),
      secret: Schema.optionalKey(StringSetting),
    }),
  ),
  remoteAccess: Schema.optionalKey(
    Schema.Struct({
      enabled: Schema.optionalKey(Schema.Boolean),
      binaryPath: Schema.optionalKey(StringSetting),
      url: Schema.optionalKey(StringSetting),
    }),
  ),
});

export const ServerSettingsPatch = Schema.Struct({
  enableAssistantStreaming: Schema.optionalKey(Schema.Boolean),
  defaultThreadEnvMode: Schema.optionalKey(ThreadEnvironmentMode),
  addProjectBaseDirectory: Schema.optionalKey(StringSetting),
  textGenerationModelSelection: Schema.optionalKey(ModelSelectionPatch),
  /**
   * An empty `model` clears the default instead of storing an empty one: "no default" has
   * to be representable, and `ModelSelection` itself refuses an empty model.
   */
  defaultModelSelection: Schema.optionalKey(ModelSelectionPatch),
  providers: Schema.optionalKey(
    Schema.Struct({
      pi: Schema.optionalKey(
        Schema.Struct({
          ...ProviderSettingsBasePatch,
          binaryPath: Schema.optionalKey(StringSetting),
          agentDir: Schema.optionalKey(StringSetting),
        }),
      ),
    }),
  ),
  im: Schema.optionalKey(ImSettingsPatch),
});
export type ServerSettingsPatch = typeof ServerSettingsPatch.Type;

export class ServerSettingsError extends Schema.TaggedErrorClass<ServerSettingsError>()(
  "ServerSettingsError",
  {
    settingsPath: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message(): string {
    return `Server settings error at ${this.settingsPath}: ${this.detail}`;
  }
}
