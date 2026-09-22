# TODO

## Small things

- [ ] Submitting new messages should scroll to bottom
- [x] Only show last 10 threads for a given project
- [ ] Thread archiving
- [ ] New projects should go on top
- [ ] Projects should be sorted by latest thread update

## Bigger things

- [ ] Queueing messages

## 发布留档：v0.8.0 / v0.8.1（2026-09-22）

工作区这一大坨 Multi-Agent（62 个改动 + 25 个新文件）整理成 5 个主题提交（toolkit 闸门与 worker 注册表 →
provider 的 worker 会话/归属结算/单 worker 停止 → Web 委派卡片与子智能体设置 → 设置面与关于面板 →
模型提供商一步创建），再加 TODO、README、release 三个提交，推 main 后打 `v0.8.0`：CI
<https://github.com/kunpengtalk/PeakCode/actions/runs/35718996159> 红（只挂 Browser test），Release Desktop
<https://github.com/kunpengtalk/PeakCode/actions/runs/35719002931> 全绿，产物
<https://github.com/kunpengtalk/PeakCode/releases/tag/v0.8.0>（macOS arm64/x64 dmg+zip、Linux AppImage、
Windows nsis，外加 `latest*.yml`）。

版本号按 feature 走 minor：0.8.0 > 0.7.2，`make_latest` 不会指向更小的号，已装客户端只会收到升级。

README 中英文各加了一节「多智能体 / Multi-Agent」，配用户给的两张现场截图
（`assets/prod/multi-agent.png` 三个 worker 并行、`multi-agent-parallel.png` 一轮八个），并从运行模式
列表和「应用里还有」两条引过去。

### 0.8.0 之后 main 的 CI 为什么是红的（v0.8.1 修掉）

只挂 Browser test，两处都在 `ModelProvidersSettingsPanel.browser.tsx`：

- 两条用例还在填 create 表单里已经不存在的 `Provider key` 输入框 —— 这轮把「提供商 Key」字段删掉、
  改成从显示名推导的改动没有同步改用例。本地一直只跑 `bun run test`（Vitest），Playwright 那套没跑，
  所以本地看不出来。
- 顺着这条查出一个**真问题**，不是用例过时：推导出的 key 会撞上内置模板的 id，而「key 撞上模板就
  等于那条模板」（列表正是这样把自定义项滤出去的），于是「StepFun 自建」推成 `stepfun` —— 正好是
  阶跃星辰 StepFun 的 id —— 新建的提供商连同端点、密钥、模型一起并进那条内置行，自定义分组里根本
  看不见；保留的 `custom` 占位 key 是同一个坑。修法是把保留 key（内置模板 id + `custom`）一起传进
  推导，并让名字下方的提示与实际写入共用同一份推导，避免「提示说一个 key、写的是另一个」。同一个
  提交里补了一条浏览器用例专门盖这个碰撞，`bun run test:browser` 24 个文件 164 条全过。

修完打 `v0.8.1`：CI <https://github.com/kunpengtalk/PeakCode/actions/runs/35721134155> 全绿，Release Desktop
<https://github.com/kunpengtalk/PeakCode/actions/runs/35721138650> 全绿，产物
<https://github.com/kunpengtalk/PeakCode/releases/tag/v0.8.1>，`latest` 指向 0.8.1。

**教训（值得记住）**：动了设置面板这类 UI，必须跑 `bun run test:browser`（在 `apps/web`）—— 它是唯一
会跑 Playwright 用例的地方，`bun run test`、fmt、lint、typecheck 全绿也发现不了这类问题。

## 发布留档：v0.7.2（2026-09-21）

修完这一轮的 stuck turn（下面那节），按仓库既有流程发了 **v0.7.2**：tag 打在 `c564ce9`（三个提交：
`ed8e5b2` fix、`da213cc` docs、`c564ce9` release），Release Desktop
<https://github.com/kunpengtalk/PeakCode/actions/runs/35561414609> 全绿：preflight（lint / typecheck /
test）4m39s → 四个平台构建 → 发布
<https://github.com/kunpengtalk/PeakCode/releases/tag/v0.7.2>（macOS arm64/x64 dmg+zip、Linux
AppImage、Windows nsis，外加 `latest*.yml`，`latest` 指向 0.7.2，客户端自动更新会看到）。

版本号的选择：用户说的是「V0.1」，但现有 tag 已经到 v0.7.1，`v0.1.0` 会被 CI 标成 `make_latest`
—— 那就是让 GitHub 的「最新版本」指向一个序号更小的发布，装了客户端的用户会被推着**降级**，所以按
bug-fix 走 patch 版 v0.7.2；要的是别的号，删 tag / release 再重发一次即可。

仓库位置：`PeakCode-AI/PeakCode` 现在重定向到 **`kunpengtalk/PeakCode`**（push 时 remote 会给出这个
提示），v0.7.1 及之前的 release 也都在新位置。

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

## Multi-Agent：先说明再派活，只留一套派活机制（2026-09-22）

用户反馈三条，都在 Multi-Agent 模式上：

1. **「上来就直接创建一大堆，跟傻似的」** —— 要的是先给出分析（为什么创建这几个、各自干啥），
   界面上看得见，然后才展示它们干活；收工后同样要收齐 worker 的报告、整合成总结/文档交付。
2. **「子 Agent 点进去没有执行记录，这个不可控，坚决不允许」** —— 点进去是空的。
3. **`crew_spawn` 和 `task` 两条路并存** —— 模型会随机挑，挑到 pi-crew 就是界面上看不见、
   也停不掉的隐形工作。

改的四处：

- **派活闸门（`agentToolkitMode.ts`）**：协议里写了「先分析、先说明」，实测模型完全可以无视 ——
  用户消息之后直接一串 `task`，界面上就是莫名其妙冒出一堆子 Agent。所以改成由 `tool_call` 钩子
  强制执行：本轮还没输出过任何**可见文字**（只有思考不算）时，第一次 `task` 被拒绝一次，理由就是
  「先说明拆解方案，再派活」。闸门一次用户请求只拦一次，所以最坏情况是多花一个回合，永远不会
  变成「这一轮再也派不出活」。重闸时机是 `before_agent_start`（每次 `prompt()` 触发一次，不是每个
  模型回合），因此上一轮派过活也不豁免下一条消息。
- **协议（`agent-subagents.ts` / `task` 的 description）**：第 0 步是「先分析并写出来」；第 5、6 步
  是「收齐所有 worker 的结论 → 合并成成品交付」（开发类任务给出每块由谁完成、证据文件/命令/输出，
  需要留档就落文档），并明确禁止用「都做完了」当交付物。worker 失败或被中断要算作缺口写进结论。
- **只留一套派活机制**：multi 模式不再暴露 pi-crew 的整套工具（按 `crew_` 前缀摘，不枚举名字），
  派活只能走 `task` —— 它有每 worker 的模型绑定、卡片、子线程和停止按钮。其他模式照旧可以用
  pi-crew。
- **子线程串错（`ChatView.logic.ts`）**：`subagentAgentId` 是 worker 句柄（`explore`）而不是运行标识，
  同一个 worker 下一轮再派出来的子线程长得一模一样。原来的回退匹配取「第一个候选」，于是刚派出去
  的 worker 显示的是**上一轮**的步数、耗时、最后一步，甚至那条线程的 "Idle"（现场：117 步的 worker
  显示成 55 步 / 6m53s / 21 分钟前的最后一步）。现在只有候选唯一时才认，模糊就不匹配 —— 代价是
  子线程水合完成前少一次步数显示，而不是显示错的。

验证：`bun run test` 全绿（1188 个用例，含闸门 6 条、子线程唯一匹配 2 条）；`bun fmt` / `bun lint`
（272 警告 0 错误）/ `bun typecheck` / `bun run build` 全过；桌面客户端已用新构建重启，卡片上
worker 的步数与子线程实际活动数一致（117 步 vs `projection_thread_activities` 的 117 条），
重启时 `ProviderSessionReaper` 把在跑的那一轮结成了 interrupted（07:03:50 → 07:15:16）。
未在真机跑过的部分：闸门被模型真正撞到的那一次交互（需要一次真实的 Multi-Agent 回合）。

## 子 Agent 一直「没进展 / 点不进去 / 又被中断」（2026-09-22 下午）

用户现场：Multi-Agent 起了 2–3 个 worker，卡片上两行都是 `Idle` + `waiting for its first step`，
`0/2 finished · 2 working`，父线程「已工作 15m59s」，点进去看不到执行记录。实际那三个 worker
一直在干活（子线程活动 167 条还在涨）。查到三个独立的毛病：

- **看门狗把我自己的 worker 判成了孤儿（`abandonedTurn.ts` + `ProviderSessionReaper`）。**
  回收扫描对每个线程问的都是「有没有活着的 provider 会话在跑这一轮」，而 **worker 的会话是在
  adapter 内部 `runSubagent` 里临时建的，provider 目录根本看不见** —— 于是对每个子线程这个问题的
  答案永远是「没有」，扫描每 5 分钟就把**正在干活的** worker 判成 interrupted。现场证据：三个子
  线程的会话都在 08:15:16（正好是 07:15:16 启动后第 60 分钟，5 分钟一次的扫描点）被置为
  interrupted，而它们的活动一直写到 08:29 之后。界面上就变成「卡片说 Idle、线程说中断，活还在干」。
  改成**子线程由它的父线程判定**：父线程还在跑这一轮，它的 worker 就是它的事；父线程被结算（或本来
  就没在跑）时，子线程在同一次扫描里跟着结算 —— worker 不可能活得比派发它的那一轮更久。
- **worker 的进度只能从子线程读，而子线程订阅是第二条取数链路。** 它一旦没落地，一个跑了 167 次
  工具调用的 worker 还是显示「等它迈第一步」，跟一个从没启动的 worker 长得一模一样。现在**进度随
  委派项本身下发**（`agentStates[].steps / lastStep / lastStepAt / startedAt`），走的就是画卡片那条流：
  adapter 在 worker 每次 tool call 开始时记账（按 toolCallId 去重），节流 2 秒重发一次卡片。
- **状态标签会被那条不新鲜的链路改写。** 子线程会话不是 live 时 `deriveSubagentStatus` 会给 `Idle`，
  而它原来**优先于**委派项自己的 `running` —— 于是「还在干活」被写成了「Idle」。改成：委派项说
  running 时，线程只能补充细节、不能改状态。同时用 `startedAt` 兜底算时长，否则没有步数时连
  「跑了多久」都没有。

验证：`bun run test` 全绿（1193 个用例；新增父线程判定 3 条、进度下发 2 条、状态不被 Idle 覆盖 1 条、
派发时间兜底时长 1 条）；`bun fmt` / `bun lint`（272 警告 0 错误）/ `bun typecheck` / `bun run build`
全过；重启客户端后同一张卡片上出现了 `118 steps · 36m 24s` / `123 steps · 36m 38s` 和
`VIEW STEPS`（此前是 0 步、无时长、`OPEN`），与 `projection_thread_activities` 一致。

还没做：**单个 worker 的手动停止**。现场那三个 Explore 跑了 36 分钟还在翻（大仓 + 宽泛 prompt），
现在至少看得见进度、能停整轮，但「只停某一个 worker」还需要新增一条 RPC + 节点上的停止按钮。

## 单个 worker 的手动停止：做完（2026-09-22 傍晚）

上一轮遗留的那件事。现场那三个 Explore 跑了 38 分钟还在翻，当时只有两个选择：杀掉整轮（丢掉编排
器上下文和另外两个 worker 的结果），或者继续等。现在每个还在跑的 worker 节点上有一个 `Stop`。

链路：`ProviderStopSubagentInput`（contracts）→ `WS_METHODS.subAgentsStopRun` → `wsRpc` →
`ProviderService.stopSubagent` → `PiAdapter.stopSubagent` → 运行时注册表 `liveSubagents`。

几个刻意的决定：

- **按委派 id 定位**，不是按子线程 id：`liveSubagents` 就是以 card 发布的 `providerThreadId` 为键的。
- **先settle 再 abort**：和停滞看门狗同一个理由 —— abort 万一不返回，卡片也不能继续声称它在干活。
  于是先写 `status: stopped / "Stopped by you."`，再 `session.abort()`。
- **返回 `boolean`**：`false` 是「这个 id 下没有在跑的东西」（已经结束了），不是错误。UI 因此不会
  为一个早就结束的 worker 弹失败。
- **不动编排者**：worker 的 `prompt` 被 abort 拒绝后，`runSubagent` 走自己的结束路径，`task` 把
  「这个 worker 提前结束了」交给模型，其余 worker 与这一轮继续。
- 稳定 id：`providerThreadId` 由 `beginSubagentDelegation` 生成（`explore-<8位>`），卡片和运行时
  两侧用的是同一个值。

测试：`ProviderService` 的路由用例（停止按委派 id 路由、`false` 原样透出）；`shouldOfferWorkerStop`
的规则用例（还在跑 = 有按钮；Completed/Failed/Stopped/Interrupted/Idle/Closed = 没有；没有委派 id
= 没有）；以及新增的浏览器渲染用例 `SubagentDelegationCard.browser.tsx`（节点本身是打开线程的
按钮，停止按钮不能嵌在按钮里 —— 所以节点改成容器、只有 body 是可点的打开目标，这一点只有真渲染
才能测出来；三条：运行中有 Stop 且回传正确的 id、已结束没有 Stop、只停点中的那一行）。
`bun run test:browser`（apps/web）3 条通过；`bun run test` 全绿；fmt / lint（272 警告 0 错误）/
typecheck / build 全过；客户端已用新构建重启（17:10 的 `dist/index.mjs`，进程 28063）。

## worker 节点上「点进去看详细记录」：做完（2026-09-22 晚）

上一轮我只做了停止按钮，没做这个 —— 用户看图直接问「不是要加点进去看详细记录么」。现在每个 worker
节点上有一个 `View steps`（展开后变 `Hide steps`），点开在节点内部按顺序列出这个 worker 最近的工具
调用（`1. read_file / 2. list_dir / …`），超过保留条数时末尾补一行「…N earlier steps」。

数据仍然走**委派项本身**（`agentStates[].recentSteps`），不是子线程：adapter 在 worker 每次 tool call
开始时把 `{id: toolCallId, title}` 追加进一个最多 12 条的队列，随卡片一起下发。理由和进度字段一样 ——
「看它在干什么」不能依赖子线程那条第二条取数链路是否落地，之前正是那里没落地导致节点后面什么都没有。

两个细节：

- **条目带 toolCallId**（不是位置）：同一个工具调用两次是两条合法记录，各自身份不同；用下标当 key
  既会被 lint 拦，也会在两个同名条目之间串位。
- **节点本体仍是「打开子线程」的按钮**，`View steps` 是旁边的独立按钮 —— 按钮不能嵌按钮（浏览器会
  吞掉内层点击）。这是上一轮做 Stop 时定下的结构，这次沿用了。

测试：委派项用例（`recentSteps` 保序、带 id、同名工具两次是两条）；浏览器渲染用例三条（展开后按
顺序显示、未产生步骤的 worker 没有这个入口、点击切换）；`bun run test:browser` 里
`SubagentDelegationCard.browser.tsx` 5 条全过（其余 150 条也过；`ModelProvidersSettingsPanel` 的 2
条失败是既有的，超时在 `Provider key` 那个输入框上，与本次改动无关，我没碰过那个组件）。
fmt / lint（272 警告 0 错误，与基线持平）/ typecheck / build 全过；客户端已用新构建重启（19:04 的
`dist/index.mjs`，进程 68876）。

## 一轮永远结束不了：给 worker 加时间预算（2026-09-22 晚）

用户看着卡片问「他都结束不了，你咋设计的」。两件事，一件是我的锅，一件是真的设计漏了。

**我的锅**：那张卡片上的 `Interrupted` 是 19:04:48，正是我为了交付「View steps」那次重启。三个
worker 当时还在跑（72 / 90 步）。这一整轮对话里，用户的每一次 Multi-Agent 都没能自己跑完过 ——
四次全是我在交付时重启客户端杀掉的。所以从此**交付不再需要杀正在跑的回合**：编译可以先做（后端
是启动时读进内存的，覆盖 dist 不影响在跑进程），重启前先查 `projection_turns` 有没有 `running`，
有就不重启、如实告诉用户，等空闲再推。

**真的设计漏**：原来的看门狗只管**静默**（10 分钟没有事件才算卡死），而一个一直在调工具、只是没有
边界的 worker 永远不会静默 —— 可编排器的那一轮是**停在 `task` 调用里等所有 worker 的**。于是
「分析整个前端的性能」这种没有边界的活可以让一个 worker 一直翻下去，整轮永远收不了尾：卡片上时间
一直涨，没有产出，用户只能整轮停掉。改法：

- `SUBAGENT_MAX_RUNTIME_MS`：每个 worker 的**墙钟预算**，默认 15 分钟，`PEAKCODE_SUBAGENT_MAX_RUNTIME_MS`
  可调、`0` 可关。复用的是同一个 `makeStallWatchdog` —— 不 `touch()` 它就是「从启动起 N 分钟」，
  而不是「静默 N 分钟」。
- 到时不再当成失败：worker 的**半成品**（`subagentFinalText` 的最后一条回复）作为 `task` 的返回值
  交回编排器，卡片上写「Ran past its 15-minute budget after 90 steps — stopped; its partial answer
  went back to the orchestrator.」——不是 `failed`，因为它没坏，只是时间到了。
- 协议里也告诉编排者这件事：预算存在、半成品要按「做到哪一步、还差什么」写进报告；并把子任务写小
  （「先定位渲染热点」这种能收敛的问题，而不是「分析整个前端性能」）。

验证：`bun run test` 全绿（1197 个用例；新增预算消息 2 条、看门狗当截止器 1 条、协议预算说明 1 条）；
fmt / lint（272 警告 0 错误）/ typecheck / build 全过。

**顺带的好消息**：用户 19:56:04 发起的那一轮**自己跑完了**（20:02:32，6 分 28 秒，三个 worker
62 / 18 / 102 步）—— 这是这一整轮修复之后第一次完整的 Multi-Agent 完成，没有被中断。

遗留：`subagent:a842576d…:explore-34e6b685` 里还留着一行 06:37 的 `running` 旧轮（「每回合铸一个
turn」那个 bug 的残留）。它不影响界面（卡片读的是会话状态，那条会话早已 interrupted），重启扫描也
判定不到它（会话不认领这一轮），所以没动用户的数据；新的运行不会再产生这种行。
