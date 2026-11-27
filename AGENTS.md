# AGENTS.md

LocalVibeBox (LVB) — 本地离线插件化效率工具箱。

## Tech stack

Electron 32 + electron-vite 2 + Vite 5 + TypeScript 5 + SolidJS + TailwindCSS

## Project layout

```
local-vibe-box/
├── src/
│   ├── main/       # Electron main process
│   ├── preload/    # contextBridge preload scripts
│   ├── renderer/   # SolidJS UI
│   └── shared/     # shared types, constants, schemas, theme
├── plugins/        # 内置/示例插件
└── electron.vite.config.ts
```

## Key concepts

- **插件 (plugin)**: 文件夹放入 `~/.aero/plugins/` 即加载，iframe 沙箱隔离
- **内置工具 (built-in tool)**: 设置、录屏；由 core 直接提供，不走 iframe 沙箱
- **搜索框 (search bar)**: 全局唤起悬浮窗，输入关键词模糊匹配插件与内置工具
- **局域网传输**: UDP 发现同插件设备，TCP 流式传文件；接收确认 + 可信任设备
- **AI 网页快开**: 独立持久会话窗口，F4 显示/隐藏，站点列表由插件管理
- **手机遥控**: 手机语音输入 + 按键/宏遥控电脑（常用键、自定义组合键）+ 剪贴板/键鼠注入；无需 API Key/证书
- **发票处理**: 本地解析 PDF 发票/行程单，配对编号并生成报销 Excel；可选重命名 + 自动备份
- **本地存储**: `~/.aero/` — 默认零网络请求，零登录；LAN/AI 插件需显式开启

## Agent skills

### Issue tracker

本地 markdown。Issue 存放在 `.scratch/<feature-slug>/`。详见 `docs/agents/issue-tracker.md`。

### Triage labels

中文标签：待评估、等回复、AI就绪、人工处理、不处理。详见 `docs/agents/triage-labels.md`。

### Domain docs

单上下文 — 根目录 `CONTEXT.md` + `docs/adr/`。详见 `docs/agents/domain.md`。
