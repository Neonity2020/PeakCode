# TODO

## Small things

- [ ] Submitting new messages should scroll to bottom
- [x] Only show last 10 threads for a given project
- [ ] Thread archiving
- [ ] New projects should go on top
- [ ] Projects should be sorted by latest thread update

## Bigger things

- [ ] Queueing messages

## 停不下来的那一轮：已修（2026-09-21）

现场（`state.sqlite` 里的事件序列）：一轮 agent 跑到 `ls -la` 之后就没有任何事件了，投影里
`projection_thread_sessions.status` 一直是 `running`，界面上「已工作 2h 1m」一直涨；用户点了 5 次停止
（5 条 `thread.turn-interrupt-requested`），每条都只换来一次「会话被恢复」（`session.started` 的
Pi extensions 警告 + `context-window.updated`），投影没有任何变化。真正的原因是：拥有那一轮的进程
已经没了（应用重启），而中断路径在没有活会话时会 `recoverSessionForThread` —— 起一个**新**会话、
再去 abort 这个空闲会话，于是「成功」了但什么都没停，界面继续显示运行中。

改的六处：

- `ProviderCommandReactor`：中断时若该线程没有活着的 provider 会话，就把这一轮按 `interrupted`
  结掉（清 `activeTurnId` + 写一条 `provider.turn.abandoned` 活动），不再让 provider 去恢复会话。
  会话绑定保留，下一条消息仍然续上原来的对话。
- `ProviderService.interruptTurn`：`allowRecovery: false`。停止永远不该凭空造一个会话来 abort。
- `ProviderService.abandonTurn`（新）：停止变得无条件。先请 provider 停；对方收下了请求但这一轮
  就是不结束（请求/工具不理会 abort）时，改为停掉这个 runtime session —— 保留 resume cursor，
  下一条消息继续同一段对话，而且不会让下一条消息 steer 进那个卡死的 run。停止按钮因此总能结束这一轮。
- `ProviderService` 的 turn 停滞看门狗：一轮只要连续 30 分钟没有任何 provider 事件（`turn.started`
  之后每个事件都会重置这个计时器，`turn.completed`/`turn.aborted`/`session.exited` 会清掉），
  就按失败结掉这一轮并放出 runtime。默认 30 分钟，`PEAKCODE_PROVIDER_TURN_STALL_MS` 可调、`0` 可关。
- `ProviderSessionReaper`：投影说在跑、但活会话没在跑这一轮（或压根没有活会话）时，把这一轮结掉。
  重启后第一次 sweep 就会做这件事，所以再也不用等用户去点停止。顺手把 stale 会话的回收从
  `stopSession`（会连 resume cursor 一起删掉）改成 `stopRuntimeSession`（只放掉运行时）。
- `turnOutcome`：`interrupted` + 无 active turn 也算这一轮的结局，automation / kanban / IM 那些
  「派发了这一轮然后等结果」的流程不会再永久等待。

验证：拿现场那份 `state.sqlite` 的副本（把那一轮改回 running）用新构建的服务端启动，开机后
投影自动变成 `interrupted`、那一轮补上 `completedAt`、并写入 `provider.turn.abandoned` 活动；
provider 绑定与 resume cursor 原样保留。

仍未做（不阻塞）：

- [ ] 看门狗只在「完全没有事件」时生效。如果 provider 每隔几分钟吐一个心跳，但这一轮其实永远
      不会结束，它不会触发。要覆盖那种情况得按「距上次有意义的进展」判断，而不是「距上次事件」。
- [ ] `ProviderSessionReaper` 的 30 分钟空闲回收仍然是「有活会话就跳过」，多个实例共用一个 home
      时彼此会把对方的轮次当成 stale。仓库约定本来就要求各实例用独立 home，暂不处理。
- [ ] 适配器事件在「还没有任何订阅者」时会被丢弃（`PubSub` 没有回放）。服务端自己启动 ingestion
      时不会遇到，但独立的测试 harness 要先订阅或先让一让，否则第一条 `turn.started` 会不见。

## 自动迭代留档（2026-09-18）

IM 渠道（微信 / 飞书 / QQ / 企业微信 / 公众号 / webhook）与手机配对这条线已收口：文档补齐
（`.docs/im-channels.md` + README 中英 + CHANGELOG `[Unreleased]`）、测试缺口补上（`webhooks` 推送器 7 个、
Web 端 `imApi` 契约 8 个）、全仓「拆分文件复制来的旧文件头」清干净（共 21 个文件）。

全量门禁在 2026-09-18 01:01–01:03 全绿：`bun fmt:check`（1321 文件）、`bun lint`（384 warnings / 0 errors）、
`bun typecheck`（9/9 包）、`bun run test`（11/11 任务，3283 个测试）。

仍未做，**都不阻塞，属可选**：

- [ ] IM 设置面板（`ImChannelsSettingsPanel.tsx`）与 `lib/imReactQuery.ts` 只有 API 层契约测试，
      没有组件级 / hook 级测试；要补需引入浏览器测试脚手架，可参考 `KanbanTaskDetailView.browser.tsx`。
- [ ] `whatsNew/`（6 个）与 `mobile/`（7 个）用路径式 `// FILE: <dir>/<file>` 文件头，其余目录一律只写文件名；
      `-chatThreadRoute.logic.ts` 声明 `chatThreadRoute.logic.ts` 属同类。想统一风格可一次改掉。
- [ ] 本机环境（非仓库问题）：Homebrew 版 bun 不带 `bunx` 二进制，已用
      `ln -sf ~/.bun/bin/bun /opt/homebrew/bin/bunx` 补上。换机器或 CI 若同样只装 brew 版 bun，
      `@peakcode/web#test` 会以退出码 127 失败。

## 发布留档：v0.4.0（2026-09-18）

工作区 198 个文件整理成 24 个主题提交（`chore(build)` → 各 `feat(...)` → `docs`），推送到 main 并打
`v0.4.0` tag；CI 预检（lint / typecheck / test）通过，四个平台安装包构建完成，GitHub Release
<https://github.com/PeakCode-AI/PeakCode/releases/tag/v0.4.0> 已发布（macOS arm64/x64 dmg + zip、
Linux AppImage、Windows nsis）。

这一轮踩到的三个坑，都已修掉：

- `.gitignore` 里一行**裸 `SKILL.md`** 把 `plugins/*/skills/*/SKILL.md` 一并忽略了：插件清单提交了、
  技能正文没有，本地有文件所以测试通过，CI 检出后 `generate-bundled-plugins.test.ts` 才炸。已锚定为
  `/SKILL.md` 并把技能文件补上；新增的 `SKILL.md` 也要过 `bun fmt:check`（oxfmt 会改表格与强调符号，
  改完必须重跑 `bun scripts/generate-bundled-plugins.ts`）。
- `ChatView.browser.tsx` 的附件高度测量只抓一次 `[data-timeline-root]`，React 稍后重挂载后抓到的是
  游离节点（`getBoundingClientRect()` 恒为 0），CI 上表现为随机视口失败、本地却稳定通过。改为每轮
  重新解析。
- **ad-hoc 签名从未生效**：`mac.sign` 钩子只有在 electron-builder 找到签名身份之后才会被调用，而
  未签名构建恰恰没有身份，所以 0.4.0 首个产物仍是「签名损坏」状态（`codesign --verify` 报
  `code has no resources but signature indicates they must be present`，子组件是 Electron Framework）。
  改为在 `afterPack` 里签名（`--deep` 修复嵌套代码 → 补回 computer-use helper 的 identifier
  requirement → 重新封外层 → 校验，失败即构建失败），并重新出包验证：

```
codesign --verify --deep --strict  → 通过
helper designated requirement      → identifier "com.peakcode.cua-helper"（保留）
spctl -a -t exec                   → rejected（未公证），不再是签名损坏
应用启动                            → 主进程 / 渲染进程 / 后端都在，窗口正常
```

仍未做，**都不阻塞，属可选**：

- [ ] 发布仍是未公证的 ad-hoc 签名：macOS 会提示「无法验证开发者」，用户在 隐私与安全性 里
      「仍要打开」一次即可。要彻底消掉这一步需要 Developer ID + 公证（仓库 secrets 里配上
      `CSC_LINK` / `APPLE_API_KEY` 系列后 CI 会自动走签名路径）。
- [ ] `PEAKCODE_FINALIZE_RELEASE` / `PEAKCODE_PUBLISH_CLI` 两个仓库变量未开：前者会让 release
      流程把 `package.json` 版本写成 tag 版本并提交到 main（现在 main 上一律是 `0.1.0`，版本由
      `--build-version` 注入），后者会把 CLI 发到 npm。
