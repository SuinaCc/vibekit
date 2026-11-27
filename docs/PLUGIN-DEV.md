# Aero 插件开发指南

Aero 插件是一个独立的文件夹，包含 `plugin.json` 声明文件和 `view.html` 入口页面。插件运行在沙箱化 iframe 中，通过 Bridge API 与 Aero 主程序通信。

## 快速开始

1. 复制 `plugins/_template/` 文件夹，重命名为你的插件 ID（如 `my.awesome-tool`）
2. 编辑 `plugin.json`，修改 id/name/desc
3. 编辑 `view.html`，编写你的 UI 和逻辑
4. 将插件文件夹放入 Aero 数据目录的 `plugins/`（默认 `~/.aero/plugins/`），重启 Aero 即可看到

## plugin.json 结构

```json
{
  "id": "my.awesome-tool",          // 唯一标识，格式：作者.插件名
  "name": "我的工具",                // 显示名称
  "desc": "简短描述",                // 搜索时显示在标题下方
  "version": "1.0.0",
  "author": "Your Name",
  "icon": "assets/icon.svg",        // 可选，建议 24x24 viewBox 的 SVG，显示在搜索框；每个插件应有独特图标
  "keywords": ["关键词1", "关键词2"], // 搜索匹配
  "category": "tools",              // code / text / image / system / vibe / tools / dev
  "permissions": [],                // 见下方权限列表
  "windowWidth": 480,               // 可选，默认 480
  "windowHeight": 400               // 可选，默认 580
}
```

## 权限列表

| 权限 | 可用 API |
|------|----------|
| `clipboard` | `window.aero.clipboard.*` |
| `file-read` | `window.aero.file.read/select/selectFolder/readDataUrl/scanDir/scanLarge/getSize`、`window.aero.shell.openPath`、`window.aero.system.diskInfo` |
| `file-write` | `window.aero.file.write/trashItem/emptyDir` |
| `lan` | 局域网设备发现、发送/接收文件、传输进度事件 |
| `network` | AI 网页窗口、手机语音本地 HTTP 会话 |
| `input` | 语音转写后的系统级文字注入 |
| 无 | `window.aero.storage.*`、`window.aero.system.getEnv` |

插件必须在 `plugin.json` 中声明它要调用的权限；未声明的调用会被拒绝。`permissions.json` 里的显式 `denied` 也会阻止调用。

## Bridge API 参考

插件通过 `app://__aero__/bridge.js` 桥接脚本获得 `window.aero` 对象。所有方法都返回 Promise。

### 存储 (Storage) — 无需权限

```js
var data = await window.aero.storage.get('myKey');
await window.aero.storage.set('myKey', { hello: 'world' });
await window.aero.storage.delete('myKey');
```

### 剪贴板 (Clipboard) — 需 `clipboard` 权限

```js
var text = await window.aero.clipboard.read();
await window.aero.clipboard.write('要复制的文本');
var history = await window.aero.clipboard.history();
await window.aero.clipboard.clear();
```

### 文件操作 (File) — 需 `file-read` / `file-write` 权限

```js
var content = await window.aero.file.read('C:\\path\\to\\file.txt');
await window.aero.file.write('C:\\path\\to\\file.txt', '写入内容');

var file = await window.aero.file.select({ filters: [{ name: '文本', extensions: ['txt'] }] });
var folder = await window.aero.file.selectFolder();
var dataUrl = await window.aero.file.readDataUrl('C:\\path\\to\\image.png');
```

### 系统能力

```js
await window.aero.shell.openPath('C:\\path\\to\\folder');
var env = await window.aero.system.getEnv();       // { home, temp, username }
var disk = await window.aero.system.diskInfo('C:\\');
```

## 推送事件

长时间任务通过 `window.aero.events` 订阅，返回 unsubscribe：

```js
var off = window.aero.events.onScanProgress(function (data) {
  console.log(data.dirPath, data.bytes, data.files, data.done);
});
// 不再需要时
off();
```

当前事件：`onScanProgress`、`onCleanProgress`、`onDevices`、`onIncoming`、`onProgress`、`onComplete`、`onError`、`onStatus`、`onTranscript`、`onState`。事件只会送到声明了对应权限的插件窗口。

## 高级：直接 postMessage

Bridge 脚本没有覆盖的方法可以直接 postMessage。Aero 会按同一张 `PLUGIN_METHODS` 路由表校验 method 与权限：

```js
var id = 'rpc-' + Date.now();
window.parent.postMessage({
  id: id,
  method: 'file:scanDir',
  params: { path: 'C:\\path' },
  pluginId: 'my.plugin-id',    // 必须为你的 plugin.json 中声明的 id
  src: 'aero-plugin'
}, '*');

window.addEventListener('message', function handler(e) {
  if (e.data && e.data.id === id && e.data.src === 'aero-plugin') {
    window.removeEventListener('message', handler);
    // e.data.result 是返回值
  }
});
```

可用的 postMessage 方法与 `window.aero` 一一对应，权限检查完全相同。

## 主题适配

Bridge 脚本会自动注入主题 CSS 变量到 `:root`，并在 `<html>` 上设置 `data-aero-theme="dark|light"`。基础色请直接使用语义变量，而不是写死深浅色：

```css
body { color: var(--aero-text); }
.card { background: var(--aero-surface); border-color: var(--aero-border); }
.hint, .muted { color: var(--aero-text-3); }
.button { background: var(--aero-hover); color: var(--aero-text); }
.button-accent { background: var(--accent); color: #fff; }
.glow { box-shadow: 0 0 12px var(--accent-glow); }
```

可用的语义变量：

| 变量 | 用途 |
| --- | --- |
| `--aero-text` / `--aero-text-2` / `--aero-text-3` | 主文字 / 次要文字 / 弱化文字 |
| `--aero-border` / `--aero-border-strong` | 常规边框 / 强调边框 |
| `--aero-surface` / `--aero-surface-2` | 卡片表面 / 输入框等内凹表面 |
| `--aero-surface-solid` / `--aero-overlay` | 实色表面 / 弹层与 toast 背景 |
| `--aero-hover` / `--aero-active` | hover / active 背景 |
| `--aero-shadow` | 浮层阴影 |

浅色模式细节可在插件目录放一个 `light.css`，Bridge 会在 `<html data-aero-theme="light">` 时自动加载；文件不存在时静默忽略。建议所有规则加 `html[data-aero-theme="light"]` 前缀：

```css
html[data-aero-theme="light"] .my-popover {
  background: var(--aero-overlay);
  border-color: var(--aero-border);
  color: var(--aero-text);
}
```

**不要**对图片、二维码、画布、Excel 预览表等业务内容做反色；只调整窗口 chrome 与文字/卡片表面。运行中切换深/浅色时，Bridge 会更新 `data-aero-theme`、CSS 变量并自动增删 `light.css`。

## 设计约束

- 插件窗口默认 480×580，可通过 plugin.json 自定义
- 窗口透明背景 + 毛玻璃效果，不要设纯色背景
- 滚动条已全局美化，直接用 `overflow-y: auto` 即可
- 字体栈：`-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC'`
- 不支持 `<script type="module">`，使用传统 `<script>` 标签
- 不支持 `import` / `require`，所有代码写在一个 HTML 文件里

## 调试

开发时在 Aero 插件窗口右键 → 检查（需要启动时开启 DevTools），或使用 `console.log` 输出到主进程终端。
