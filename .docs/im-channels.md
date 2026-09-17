# IM channels

An IM channel turns a chat app into a remote control for the agent. A message sent from WeChat,
Feishu, QQ or 企业微信 opens (or continues) a thread in this workspace, and the answer is sent back
into the chat. The thread is a real one: it shows up in the sidebar with a title, streams live, and
can be opened and continued in the app afterwards. Nothing here is a chat-only side channel — the
point is that the run stays reviewable.

## The six channels

| id         | how it connects                                        | what it needs                                                                 | replies go via                    |
| ---------- | ------------------------------------------------------ | ----------------------------------------------------------------------------- | --------------------------------- |
| `wechat`   | personal account, via the iLink bridge; long-polls out | `botToken` + `botId`, minted by the QR handshake; optional `baseUrl`          | the sender's context token        |
| `feishu`   | outbound long-lived socket, no public URL              | `domain` (`feishu` or `lark`), `appId`, `appSecret`                           | the chat's id                     |
| `qq`       | outbound long-lived socket, no public URL              | `appId`, `appSecret`                                                          | a passive-reply message id        |
| `wecom`    | Tencent posts to you; **needs public HTTPS**           | `corpId`, `agentId`, `secret`, `callbackToken`, `encodingAesKey`              | pushes to the sender's user id    |
| `wechatMp` | Tencent posts to you; **needs public HTTPS**           | `appId`, `appSecret`, `callbackToken`, optional `encodingAesKey` (safe mode)  | pushes to the sender's open id    |
| `webhook`  | push-only robots **and** the inbound task bridge       | `wecomUrl`, `dingtalkUrl`, `dingtalkSecret`, and `secret` for inbound `POST`s | n/a — it is the announcement side |

The `webhook` id carries two directions on purpose: group robots (企业微信 group bot, DingTalk
custom robot) are where a finished task announces itself when nobody is watching the UI — including
every IM task, see `resolvePending` — while the same settings hold the shared secret that guards the
inbound `POST /api/im/task` bridge. Robots cannot receive; the bridge cannot push.

`wechat` is the only channel whose credentials are minted rather than pasted: `createWechatQrCode`
fetches a `deepLink` from the iLink bridge and renders it as a PNG data URL, the phone scans it, and
`pollWechatQrStatus` turns `confirmed` into stored `botToken`/`botId` plus a cleared cursor (a new
account must not resume the old account's cursor). The long-poll cursor is written back to settings
through its own fiber, throttled to one write per 15 seconds (`CURSOR_FLUSH_INTERVAL`), because the
value only has to be roughly current.

## How a message becomes a task

`ImService.handleInbound` is the single entry point every channel calls. The bridge identifies a
conversation by `imConversationKey` — `channel:peerScope:peerId`, where `peerScope` disambiguates id
spaces that collide (QQ's `c2c` vs `group`) — and stores it in `im_conversations` (migration
`042_ImConversations`, one row per chat, pointing at its thread). The key deliberately has no foreign
key to the thread projection: the mapping is written the moment a turn is dispatched, while the
thread row only appears once the projection pipeline has processed that command.

- **Idle expiry.** A chat untouched for `sessionIdleHours` (default 12, `0` = keep one context
  forever) starts a fresh thread on its next message, and the chat is told so. This is the only way
  context is dropped; there is no `/new` command.
- **Project.** `defaultProjectId` when it resolves, otherwise the most recently updated non-chat
  project. A workspace with no project at all produces a chat-visible error rather than a silent
  drop.
- **Model.** Resolved per turn through the headless model resolver, project default first. No model
  configured anywhere means the message comes back as "先在 Peak Code 里给工作区选一个模型" — a
  headless resolver is required because an IM turn has no composer to pick one.
- **Title.** `<channel label> · <peer label> · <first non-empty line>`, capped at 120 characters, so
  the sidebar entry says where the request came from.
- **Runtime mode.** `im.runtimeMode` travels with the turn. It defaults to `approval-required` on
  purpose: nobody is at the screen during an IM run, so widening it is an explicit choice.

The reply slot is claimed _before_ the turn is dispatched (`enqueuePending`), because a fast turn must
not be able to finish before its answer has somewhere to go. The queue is per thread and FIFO; a
second message that arrives while one is running is told it is queued (`reply.ack(busy)`), and the
transient notice is withdrawn before the real answer lands, via `recallAck` on channels that have a
recall API. When the turn ends, `turnOutcomeForEvent` classifies it and the chat gets: the last
assistant text (completed), `❌ 执行出错：…` plus the session's last error (failed), or
`⏹ 这一轮被中断了。` (interrupted).

Anything that goes wrong inside `handleInbound` is reported twice — into the chat and into the
bridge's traffic log (the settings screen's 200-entry buffer, `LOG_LIMIT`) — instead of escaping into
a channel's callback.

## The HTTP surface

The bridge is plain JSON routes rather than WS RPC because the Tencent callbacks have to be plain HTTP
anyway, and the phone hand-off link is fetched before any chat surface exists.

| route                                         | who may call it                                  |
| --------------------------------------------- | ------------------------------------------------ |
| `GET`/`POST` `/api/im/wecom/events`           | Tencent, authenticated by the callback signature |
| `GET`/`POST` `/api/im/wechat-mp/events`       | Tencent, authenticated by the callback signature |
| `POST /api/im/task`                           | any tool holding the inbound `secret`            |
| `GET /api/im/status`                          | owner only                                       |
| `GET /api/im/conversations`                   | owner only                                       |
| `POST /api/im/conversations/forget`           | owner only                                       |
| `POST /api/im/wechat/qrcode`                  | owner only                                       |
| `GET /api/im/wechat/qrcode-status`            | owner only                                       |
| `POST /api/im/wechat/disconnect`              | owner only                                       |
| `POST /api/im/test`                           | owner only                                       |
| `POST /api/im/mobile-link`                    | owner only                                       |
| `POST /api/im/remote-access/start` / `…/stop` | owner only                                       |

"Owner" is the same rule the WebSocket upgrade and the attachment routes use
(`requireOwner` → `isLegacyTokenAuthorized` from `?token=`, else an owner session): these endpoints
hand out a pairing link that opens the workspace, so a paired client must not be able to mint one for
itself. Config and status traffic is owner-only for the same reason the rest of the auth control plane
is.

CORS is on for the `/api/im/*` prefix because the desktop shell serves its window from `t3://app`
while the backend listens on its own loopback port. The allowlist is that scheme plus loopback
origins — a public site is not on it, and even if it were, it holds no token. Credentials are never
allowed cross-origin: the browser/phone flow is same-origin. Failures carry the CORS headers too, so a
wrong token reads as a 4xx body rather than an opaque "server down".

### Tencent callbacks

Tencent gives a callback five seconds and retries afterwards, so the route parses and verifies the
message, hands it to the bridge with `Effect.forkChild`, and answers immediately (`wecom` → empty body,
`wechatMp` → `success`). Retries make duplicate delivery normal, so a message id may only ever start
one turn: `acceptWechatCallbackMessage` keeps a 2000-entry set of seen ids and drops repeats. Only
`text` messages with non-empty text are accepted.

Signature scheme (`wechatCallback.ts`), matching Tencent's own definition:

- URL verification (`GET`): `sha1` over the sorted `[token, timestamp, nonce]` joined — `wechatMp`
  returns the `echostr` as-is; `wecom` returns the `echostr` **decrypted**, which is what its
  URL-setup probe expects, so that route fails if the `encodingAesKey` is wrong.
- Messages (`POST`): `msg_signature` = `sha1` over the sorted `[token, timestamp, nonce, ciphertext]`;
  the body is AES-256-CBC with the key from `base64(encodingAesKey + "=")`, IV = the key's first 16
  bytes, PKCS#7 padding stripped. `wechatMp` also accepts plaintext mode when no `encodingAesKey` is
  configured, and refuses a ciphertext body without one.

### The inbound task bridge

`POST /api/im/task` with `{ message, session?, secret? }` runs one agent turn and answers
`{ reply, threadId }` — the reply wait is capped at 30 minutes (`WEBHOOK_WAIT`), after which the caller
is told the task is still running and to look at the thread. Any tool that can send an HTTP request can
drive the agent this way: a WeChat framework, an iOS shortcut, a cron script.

`session` is the conversation identity (default `"default"`), so a caller can keep several contexts
apart. The secret rule is asymmetric on purpose: a server that anything on the network can reach
(`--host 0.0.0.0` or a non-loopback bind) **refuses without a configured secret** (403) even before one
is set, because the route runs agent turns on demand; a loopback-only server may run without one, since
only the machine itself can call it.

## Remote access: the tunnel

`ImRemoteAccessSettings` is a Cloudflare quick tunnel: the server dials out (`cloudflared`, path from
`binaryPath`) and gets an `https://*.trycloudflare.com` address that forwards back to the local port,
so a phone reaches the app without port forwarding or a public IP. `enabled` starts one at boot; the
assigned URL is persisted so the settings screen can show the last one.

A quick tunnel publishes the **whole** server, so it is refused unless the server requires
authentication (`remoteAccessAllowed`, 403 with a reason). The address is unguessable but public:
without a token, the H5 app would be readable and the agent drivable by anyone who learns it.

Two rules keep the tunnel from thrashing:

- **Only transitions act.** `reconcileRemoteAccess` ignores `enabled` values that did not change,
  because the bridge itself writes settings while it works (the assigned URL, the WeChat cursor) and
  those emissions would otherwise tear down a working tunnel and hand out a new address.
- **`startRemoteAccess` persists `enabled: true` only after the tunnel is up**, and returns the
  already-running address instead of opening a second one — otherwise the QR code on screen would
  point at an address that is already gone. A finalizer stops the tunnel on shutdown, so a restarted
  backend cannot leave an orphan publishing a port nobody listens on.

## The phone hand-off

`POST /api/im/mobile-link` mints a one-time pairing credential (`issuePairingCredential`, role
`owner`) and returns a URL plus its QR rendering. The address is the connected tunnel when there is
one, otherwise the LAN address — and a server bound to loopback fails loudly with the `--host 0.0.0.0`
hint rather than handing out a link that cannot work (`resolveMobileBaseUrl`).

The hand-off shape matches the desktop's own bootstrap: `/pair`, with the credential in the URL
**hash** so it never reaches a server log, plus optional `thread` and `project` so the phone opens the
conversation that was on screen instead of an empty workspace. `expiresAt` comes back with it.

## Settings

Everything the bridge reads lives under `im` in the server settings: `defaultProjectId`,
`sessionIdleHours`, `runtimeMode`, one object per channel, and `remoteAccess`. Nothing in this
feature needs an environment variable.

Settings → 频道 renders it: the bridge-level row (default project, with "auto" meaning the most
recently used one; idle hours; runtime mode), then one card per channel — status badge, description,
the callback URL to paste into the Tencent console for `wecom`/`wechatMp`, the channel's own fields,
and Save / Test buttons. `wechat` gets its own card because it owns the QR handshake. Below them: the
conversations the bridge remembers (one row per chat, with Forget, which makes the next message start
a fresh thread) and the recent traffic, newest first, 50 of the 200 buffered entries.

`POST /api/im/test` is what the Test button calls: it probes the channel's credentials and rebuilds
the connection (`feishu` reports the bot's name, `qq` re-dials its socket, `wecom`/`wechatMp` ask
Tencent for a token, the robots push a real message into the group).

## Where it lives

| area        | files                                                                                                                                                                                                               |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| contracts   | `packages/contracts/src/im.ts`; `ImSettings` and friends in `settings.ts`                                                                                                                                           |
| bridge      | `apps/server/src/im/Layers/ImService.ts` (behaviour), `Services/ImService.ts` (the service shape)                                                                                                                   |
| routes      | `apps/server/src/im/http.ts`, mounted in `apps/server/src/http.ts`; the service in `serverLayers.ts`                                                                                                                |
| channels    | `apps/server/src/im/channels/`: `ilink.ts` (personal WeChat), `feishu.ts`, `qq.ts`, `wechatCallback.ts` (WeCom + official account), `webhooks.ts` (robots), `cloudflare.ts` (tunnel), `types.ts` (adapter contract) |
| persistence | migration `042_ImConversations`; `persistence/{Services,Layers}/ImConversations.ts`                                                                                                                                 |
| web         | `components/ImChannelsSettingsPanel.tsx`, `ImRemoteAccessControl.tsx`, `MobileAccessDialog.tsx` (sidebar), `lib/imApi.ts`, `lib/imReactQuery.ts`                                                                    |
| tests       | `im/Layers/ImService.test.ts`, `im/channels/{ilink,messaging,wechatCallback}.test.ts` under `apps/server`                                                                                                           |

Turn-outcome classification lives in `apps/server/src/orchestration/turnOutcome.ts`; the headless model
resolver in `apps/server/src/provider/resolveHeadlessModelSelection.ts`.
