# TODO

## Small things

- [ ] Submitting new messages should scroll to bottom
- [x] Only show last 10 threads for a given project
- [ ] Thread archiving
- [ ] New projects should go on top
- [ ] Projects should be sorted by latest thread update

## Bigger things

- [ ] Queueing messages

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
