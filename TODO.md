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
