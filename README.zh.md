<p align="center">
  <img src="./assets/prod/black-universal-1024.png" alt="Peak Code" width="128" />
</p>

<h1 align="center">Peak Code</h1>

<p align="center">
  <strong>AI 编程代理的开源图形界面。</strong><br />
  统一的精美界面，支持 Claude Code、Codex、Gemini、Kilo Code、OpenCode 等。
</p>

<p align="center">
  <a href="https://github.com/PeakCode-AI/PeakCode/blob/main/LICENSE">
    <img src="https://img.shields.io/github/license/PeakCode-AI/PeakCode?style=flat-square" alt="License" />
  </a>
  <a href="https://github.com/PeakCode-AI/PeakCode/stargazers">
    <img src="https://img.shields.io/github/stars/PeakCode-AI/PeakCode?style=flat-square" alt="Stars" />
  </a>
  <a href="https://discord.gg/jn4EGJjrvv">
    <img src="https://img.shields.io/discord/1354019574017490975?style=flat-square&logo=discord&logoColor=white&label=Discord&color=5865F2" alt="Discord" />
  </a>
  <a href="https://github.com/PeakCode-AI/PeakCode/releases">
    <img src="https://img.shields.io/github/v/release/PeakCode-AI/PeakCode?style=flat-square&label=Release" alt="Release" />
  </a>
</p>

<p align="center">
  <a href="#-快速开始">快速开始</a> •
  <a href="#-功能特性">功能特性</a> •
  <a href="https://discord.gg/jn4EGJjrvv">Discord</a> •
  <a href="#-参与贡献">参与贡献</a>
</p>

---

![Peak Code 截图](./assets/prod/readme-screenshot.png)

## 为什么选择 Peak Code？

AI 编程代理功能强大，但通过原始终端使用它们体验很差。Peak Code 为你提供**精致、本地优先的桌面和 Web 界面**，将你喜爱的 AI 代理统一在一个体验中：

- **告别终端切换** — 在一个窗口中管理多个 AI 代理会话
- **实时流式输出** — 实时观看代码生成、审查和应用
- **内置 Git 工作流** — 分支、提交、推送、查看 diff，无需离开应用
- **代码保留在本地** — 一切都在你的机器上运行，绝不接触云端

## 快速开始

### 桌面应用（推荐）

从 [Releases](https://github.com/PeakCode-AI/PeakCode/releases) 下载：

| 平台    | 格式        |
| ------- | ----------- |
| macOS   | `.dmg`      |
| Windows | `.exe`      |
| Linux   | `.AppImage` |

### 从源码构建

```bash
git clone https://github.com/PeakCode-AI/PeakCode.git
cd PeakCode
bun install
bun run dev
```

> **要求：** [Codex CLI](https://github.com/openai/codex)、Node.js 24+ 或 Bun、Git 2.30+、现代浏览器。

#### 从源码构建 - Windows

Windows 上服务器需用 Node.js 运行（Bun 尚未实现 ConPTY）。`dev` 命令已自动处理此问题。克隆项目后：

```powershell
# 安装依赖（如果配了私有 npm 仓库，需指定公网 registry）
bun install --registry https://registry.npmjs.org

# 构建服务器（一次性）
bun run build

# 启动开发环境
bun run dev
```

然后浏览器打开 **`http://localhost:5733`**。

> `bun run dev` 自动检测 Windows 并用 Node.js 运行服务器，同时启动 Vite 前端——和 macOS/Linux 同一个命令。

## 功能特性

### 多代理，统一界面

无需改变工作流即可无缝切换 AI 编程提供商：

| 提供商         | 状态   |
| -------------- | ------ |
| Claude Code    | 已支持 |
| Codex (OpenAI) | 已支持 |
| Gemini         | 已支持 |
| Kilo Code      | 已支持 |
| OpenCode       | 已支持 |

### 运行模式 —— Agent / Plan / Goal

输入区决定这一轮怎么执行，模式随消息一起发送：

- **Agent**（默认）—— 完整工具集，代理直接在工作区里干活。
- **Plan** —— 只读探索加 `write_plan`，工作区保持不变，结果以计划的形式返回给你确认。
- **Goal** —— 完整工具集加 `goal` 工具。目标与验收标准保存在状态里，由服务端在轮次之间持续续跑，直到目标完成、被放弃或用完预算（受 token 预算和续跑次数上限约束）。

目标会显示在输入区的目标面板中，可以暂停、恢复、完成或放弃；因预算耗尽而停止的目标状态为 `budget-limited`。

### 模型提供商

Settings → 模型提供商 直接编辑 pi 运行时加载的 `models.json`，因此可以把 Peak Code 指向任何 OpenAI、Anthropic 或 Google 兼容的端点：

- 内置 OpenAI、Anthropic、Google Gemini、OpenRouter、Ollama、DeepSeek 和智谱 AI（GLM）模板，也支持自定义提供商，并在表单里提示 `ENV_VAR` / `!shell` 两种密钥来源写法。
- 就地添加和编辑模型：模型 ID、上下文窗口、最大输出 token，以及模型支持的输入类型（text、image、video、PDF）。
- 保存不会破坏 pi 读取的文件。pi 会严格校验 `models.json`，遇到不认识的输入类型会拒绝整个文件，所以 `video`/`pdf` 存在 pi 会忽略的字段里；清空某个字段时会从配置中删除它，而不是写入空值。

### Pi 包

Settings → Pi 包 可以在应用内安装 [pi 包](https://github.com/earendil-works/pi/blob/main/docs/packages.md) —— 把一个扩展、技能、提示词模板和主题打包成一个来源 —— 不必回到终端：

- 支持 `pi install` 的两种来源：`npm:@scope/pkg`（通过全局 npm 前缀安装）与 `git:host/user/repo`（克隆进 pi agent 目录），也支持本地路径。
- 列表会显示每个包实际贡献了什么 —— 技能、提示词、扩展、主题 —— 以及落盘位置。
- 安装写入的正是 `pi` 自己读取的那个 `settings.json`，因此命令行与应用始终一致。新线程在下次启动时加载；已打开的线程执行 `/reload` 即可。
- 扩展失败不再静默：包加载失败、或扩展处理函数抛错，都会在线程里以警告形式指出是哪个扩展。

现成例子：**pi-crew**（`npm:@melihmucuk/pi-crew`，或 `git:github.com/melihmucuk/pi-crew`）带来六个 `crew_*` 工具，让子代理并行工作而当前回合保持可交互。它的工具、技能与 `/pi-crew-plan`、`/pi-crew-review` 提示词模板在 Peak Code 中可用；TUI 挂件、快捷键和 `@` 提及补全属于终端专属，保持静默。

### 看板

每个项目在自身目录下都有一块看板，存放在 `.kanban/board.json`，应用、编码代理和其他工具读写的是同一个文件：

- 列为 待开始 / 进行中 / 已完成 / 已阻塞 / 归档，支持拖拽换列。
- 任务进入 进行中（或直接创建在该列）会派发给代理执行。任务的需求是一份带验收标准的敏捷简报，可以由代理根据标题生成。
- 运行结果会写回任务：成功为 已完成，失败为 已阻塞，运行被中断则回到 待开始。
- 任务详情把看板留言与代理在该线程里的消息合并展示，并支持对正在运行的一轮进行引导（steer）或中断。

### 定时任务

一个定时任务 = 一个计划 + 一句指令 + 一个工作区。到点之后，Peak Code 会在那个工作区里开一条真实会话并把指令发过去 —— 所以每次运行都留下一条可以继续追问、也能转给别人的会话：

- 三种计划：**仅一次**、**每天**、**每周**；时间按 IANA 时区里的墙上时间计算，「每天 09:00」在夏令时切换前后都是 09:00。
- 新建任务时选择工作区。运行就在该项目里进行，用项目的默认模型和你选的模式（Agent / Plan / Goal）。
- 每个任务都留有运行记录：这次怎么结束的、最后一条回复的摘要，以及进入那条会话的入口。
- 随时可以暂停、恢复或立即运行。一次性任务跑完会自动关闭；错过超过 6 小时的触发点会被顺延，而不是补跑。
- 也可以直接对着代理说一句话来创建 —— 「每天早上帮我汇总一下这里的改动」会走 `schedule_task` 工具，落到你当前所在的工作区。

### 实时流式输出

实时观看 AI 代理工作——看到代码被编写、工具被调用、结果即时呈现。无需轮询，无需刷新。

### Git 集成

内置版本控制，支持分支管理、暂存、提交和推送——一切都在你与 AI 交互的同一界面中完成。

### 会话持久化

会话在重启后依然保留。智能检查点机制会捕获对话状态，让你可以从中断处精确恢复。

### 集成终端与编辑器

内置终端用于命令执行，基于 Monaco 的代码编辑器支持语法高亮——无需离开窗口即可完成所有操作。

### 跨平台

支持原生 **Electron 桌面应用**（macOS、Windows、Linux）和可自托管的 **Web 应用**。

## 架构

Peak Code 采用分层客户端-服务器架构：

```
浏览器 / 桌面 (React + Vite + Electron)
        │ WebSocket
        ▼
   Node.js 服务器
        │ JSON-RPC over stdio
        ▼
   AI 代理运行时 (codex app-server)
```

| 层             | 关键组件                               |
| -------------- | -------------------------------------- |
| **展示层**     | React UI、Zustand 状态管理、主题系统   |
| **应用层**     | Native API、事件处理器、WebSocket 传输 |
| **领域层**     | 编排引擎、领域事件、状态投影           |
| **基础设施层** | 提供商服务、Git 服务、终端服务         |

详见 [`.docs/architecture.md`](./.docs/architecture.md) 获取完整技术深入分析。

## 开发

```bash
# 完整开发环境（Web UI + 服务器）
bun run dev

# 单独服务
bun run dev:server         # 仅服务器
bun run dev:web            # 仅 Web UI
bun run dev:desktop        # 桌面应用

# 质量检查
bun run test               # Vitest 测试套件
bun run lint               # oxlint
bun run fmt                # oxfmt 格式化
bun run typecheck          # TypeScript 类型检查

# 桌面分发
bun run dist:desktop:dmg   # macOS DMG
bun run dist:desktop:linux # Linux AppImage
bun run dist:desktop:win   # Windows 安装包
```

### Windows 开发

`bun run dev` 自动检测 Windows 并用 Node.js 运行服务器，工作流与 macOS/Linux 一致：

```powershell
# 首次：构建服务器
bun run build

# 一键启动前后端
bun run dev
```

打开 **`http://localhost:5733`**。修改服务器源码后，运行 `bun run build` 重新构建并重启。

> Windows 上 `bun run dev` 会将 Vite（Bun）和 Node.js 服务器作为两个协调进程启动——无需手动开终端或配环境变量。

### 隔离开发

与现有 Peak Code 实例并行运行，避免端口冲突：

```bash
env -u PEAKCODE_AUTH_TOKEN PEAKCODE_PORT_OFFSET=3158 PEAKCODE_NO_BROWSER=1 \
  bun run dev -- --home-dir ./.peakcode-dev --port 58090
```

## 参与贡献

欢迎贡献！在提交 Issue 或 PR 前请先阅读 [CONTRIBUTING.md](./CONTRIBUTING.md)。

**快速指南：**

- 保持 PR 简洁（< 200 行）
- 每个 PR 只关注一个问题
- 说明**什么**改变了以及**为什么**
- UI 变更请附上修改前后的截图
- 为新功能编写测试

## 社区

- **[GitHub Issues](https://github.com/PeakCode-AI/PeakCode/issues)** — 报告 Bug 和请求功能

## Star 历史

如果 Peak Code 对你的工作流有帮助，不妨给它一个 Star——这能帮助更多人发现这个项目。

## 开源许可

[MIT](./LICENSE) — 随意使用、修改和发布。
