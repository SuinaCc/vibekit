import { app, BrowserWindow, protocol, Tray, Menu, nativeImage, nativeTheme } from 'electron';
import * as path from 'path';
import { DEFAULT_ACCENT, accentGlow } from '@shared/theme';
import { PLUGIN_METHODS } from '@shared/pluginMethods';
import { PLUGIN_EVENTS } from '@shared/pluginEvents';
import { WindowManager } from './windows/WindowManager';
import { ConfigService } from './services/ConfigService';
import { HotkeyService } from './services/HotkeyService';
import { PluginManager } from './services/PluginManager';
import { DataService } from './services/DataService';
import { ClipboardService } from './services/ClipboardService';
import { PermissionsService } from './services/PermissionsService';
import { EventRouter } from './services/EventRouter';
import { Lifecycle } from './services/Lifecycle';
import { LanTransferService } from './services/LanTransferService';
import { AiWebService } from './services/AiWebService';
import { InputInjector } from './services/InputInjector';
import { VoiceService } from './services/VoiceService';
import { InvoiceService } from './services/InvoiceService';
import { RecorderService } from './services/RecorderService';
import { PomodoroService } from './services/PomodoroService';
import { NetToolsService } from './services/NetToolsService';
import { SearchMasterService } from './services/SearchMasterService';
import { CompareService } from './services/CompareService';
import { AutomationService } from './services/AutomationService';
import { registerIpcHandlers } from './ipc/registerHandlers';
import { ensureAppDirectories, getPluginsDir, getCacheDir, getBuiltinPluginsDir, getPluginDataDir } from './utils/paths';
import { isMacOS } from './utils/platform';
import * as fs from 'fs';

// Services
let windowManager: WindowManager;
let configService: ConfigService;
let hotkeyService: HotkeyService;
let pluginManager: PluginManager;
let dataService: DataService;
let clipboardService: ClipboardService;
let permissionsService: PermissionsService;
let eventRouter: EventRouter;
let lanService: LanTransferService;
let aiWebService: AiWebService;
let voiceService: VoiceService;
let invoiceService: InvoiceService;
let lifecycle: Lifecycle | null = null;
let recorderService: RecorderService;
let pomodoroService: PomodoroService;
let netToolsService: NetToolsService;
let searchMasterService: SearchMasterService;
let compareService: CompareService;
let automationService: AutomationService;
let tray: Tray | null = null;

const isDev = !app.isPackaged;

// Windows toast notifications need an AppUserModelID that matches the
// installed Start Menu shortcut. Packaged builds use electron-builder's appId;
// in development, point Windows at the Electron executable itself.
if (process.platform === 'win32') {
  app.setAppUserModelId(isDev ? process.execPath : 'com.vibekit.app');
}

// The renderer and plugins are served through app://. Mark it as a standard,
// secure, CORS-enabled scheme so packaged renderer assets can load.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

// --- Single instance lock ---
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    windowManager?.showSearch();
  });
}

function copyDirSync(src: string, dst: string): void {
  try {
    fs.mkdirSync(dst, { recursive: true });
  } catch {
    return;
  }
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(src, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(s, d);
      continue;
    }
    try {
      fs.copyFileSync(s, d);
    } catch (error) {
      // A still-running key helper (or another process) can temporarily lock
      // an .exe. Keep the previous copy rather than aborting app startup.
      console.warn('Skip locked plugin file:', d, error instanceof Error ? error.message : String(error));
    }
  }
}

// --- Fix disk cache permissions ---
app.setPath('cache', getCacheDir());
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.commandLine.appendSwitch('disable-gpu-vsync');

// --- Protocol registration ---
// vibekit-bridge.js content — injected into plugin iframes
// accent and glow are passed via URL params, applied immediately (no async postMessage needed)
function buildPluginBridgeObject(): string {
  const groups = new Map<string, string[]>();

  for (const method of PLUGIN_METHODS) {
    if (!method.bridge) continue;
    const { namespace, name, params } = method.bridge;
    const args = params.join(', ');
    const props = params.map((param) => `${JSON.stringify(param)}: ${param}`).join(', ');
    const fn = `function(${args}) { return rpc(${JSON.stringify(method.method)}, {${props}}); }`;
    const fns = groups.get(namespace) ?? [];
    fns.push(`${JSON.stringify(name)}: ${fn}`);
    groups.set(namespace, fns);
  }

  const body = Array.from(groups.entries())
    .map(([namespace, fns]) => `    ${JSON.stringify(namespace)}: {\n      ${fns.join(',\n      ')}\n    }`)
    .join(',\n');

  return `{\n${body}\n  }`;
}

function buildPluginEventsObject(): string {
  // The public API documented in docs/PLUGIN-DEV.md is flat:
  //   window.vibekit.events.onScanProgress(cb)
  // Also expose the namespaced form (events.files.onScanProgress) so the
  // previous grouping keeps working.
  const flat: string[] = [];
  const groups = new Map<string, string[]>();

  for (const route of PLUGIN_EVENTS) {
    const fn = `function(cb) { var handler = function(e) { if (e.data && e.data.type === 'vibekit-event' && e.data.event === ${JSON.stringify(route.event)}) cb(e.data.payload); }; window.addEventListener('message', handler); return function() { window.removeEventListener('message', handler); }; }`;
    flat.push(`${JSON.stringify(route.name)}: ${fn}`);
    const fns = groups.get(route.namespace) ?? [];
    fns.push(`${JSON.stringify(route.name)}: ${fn}`);
    groups.set(route.namespace, fns);
  }

  const namespaces = Array.from(groups.entries())
    .map(([namespace, fns]) => `${JSON.stringify(namespace)}: { ${fns.join(', ')} }`)
    .join(',\n  ');

  return `{\n  ${flat.join(',\n  ')}${namespaces ? `,\n  ${namespaces}` : ''}\n}`;
}

const PLUGIN_THEME_PALETTES = {
  dark: {
    text: '#f3f4fb',
    text2: '#b9bbd1',
    text3: '#8386a2',
    border: 'rgba(255,255,255,.075)',
    borderStrong: 'rgba(255,255,255,.135)',
    surface: 'rgba(255,255,255,.032)',
    surface2: 'rgba(255,255,255,.055)',
    solid: '#12122a',
    overlay: 'rgba(20,20,35,.97)',
    hover: 'rgba(255,255,255,.07)',
    active: 'rgba(255,255,255,.12)',
    shadow: '0 18px 50px rgba(2,3,10,.5)',
  },
  light: {
    text: '#1a1a2e',
    text2: '#4b4b63',
    text3: '#7a7a92',
    border: 'rgba(0,0,0,.10)',
    borderStrong: 'rgba(0,0,0,.16)',
    surface: 'rgba(255,255,255,.72)',
    surface2: 'rgba(0,0,0,.04)',
    solid: '#ffffff',
    overlay: 'rgba(255,255,255,.97)',
    hover: 'rgba(0,0,0,.05)',
    active: 'rgba(0,0,0,.09)',
    shadow: '0 12px 36px rgba(0,0,0,.12)',
  },
} as const;

// Shared light-mode base shared by every built-in plugin. Plugin-specific
// gaps are filled by an optional light.css next to view.html.
const PLUGIN_LIGHT_BASE_CSS = `
html[data-vibekit-theme="light"] {
  color-scheme: light;
  --text: var(--vibekit-text);
  --text-2: var(--vibekit-text-2);
  --muted: var(--vibekit-text-3);
  --faint: rgba(26,26,46,.42);
  --border: var(--vibekit-border);
  --border-strong: var(--vibekit-border-strong);
  --surface: var(--vibekit-surface);
  --surface-2: var(--vibekit-surface-2);
  --surface-3: var(--vibekit-hover);
  --shadow-card: var(--vibekit-shadow);
  --shadow-pop: var(--vibekit-shadow);
}
html[data-vibekit-theme="light"] body { color: var(--vibekit-text); }
html[data-vibekit-theme="light"] .card { background: var(--vibekit-surface); border-color: var(--vibekit-border); }
html[data-vibekit-theme="light"] input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]),
html[data-vibekit-theme="light"] textarea,
html[data-vibekit-theme="light"] select { background-color: var(--vibekit-surface-2); border-color: var(--vibekit-border); color: var(--vibekit-text); }
html[data-vibekit-theme="light"] input::placeholder,
html[data-vibekit-theme="light"] textarea::placeholder { color: var(--vibekit-text-3); }
html[data-vibekit-theme="light"] .toast { background: var(--vibekit-overlay); border-color: var(--vibekit-border); color: var(--vibekit-text); }
html[data-vibekit-theme="light"] .hint,
html[data-vibekit-theme="light"] .muted { color: var(--vibekit-text-3); }
html[data-vibekit-theme="light"] .out,
html[data-vibekit-theme="light"] .pre { background: var(--vibekit-surface-2); border-color: var(--vibekit-border); color: var(--vibekit-text-2); }
html[data-vibekit-theme="light"] .modal-box,
html[data-vibekit-theme="light"] .popover,
html[data-vibekit-theme="light"] .ctx,
html[data-vibekit-theme="light"] .ctx-menu { background: var(--vibekit-overlay); border-color: var(--vibekit-border); color: var(--vibekit-text); }
html[data-vibekit-theme="light"] ::-webkit-scrollbar-thumb { background: rgba(0,0,0,.18); }
`.trim();

function getBridgeScript(
  pluginId: string,
  accent?: string,
  glow?: string,
  glass?: string,
  mode?: 'dark' | 'light',
): string {
  const themeMode = mode === 'light' ? 'light' : 'dark';
  return `
(function() {
  var PLUGIN_ID = ${JSON.stringify(pluginId)};
  var ACCENT = ${JSON.stringify(accent || DEFAULT_ACCENT)};
  var GLOW = ${JSON.stringify(glow || accentGlow(DEFAULT_ACCENT))};
  var GLASS = ${JSON.stringify(glass || 'rgba(18,18,42,0.35)')};
  var MODE = ${JSON.stringify(themeMode)};
  var PALETTES = ${JSON.stringify(PLUGIN_THEME_PALETTES)};
  var LIGHT_BASE_CSS = ${JSON.stringify(PLUGIN_LIGHT_BASE_CSS)};

  function applyPalette() {
    var r = document.documentElement;
    var palette = PALETTES[MODE] || PALETTES.dark;
    r.dataset.vibekitTheme = MODE;
    r.style.colorScheme = MODE;
    var vars = {
      '--accent': ACCENT,
      '--color-accent': ACCENT,
      '--accent-light': ACCENT,
      '--accent-glow': GLOW,
      '--color-accent-glow': GLOW,
      '--vibekit-glass-tint': GLASS,
      '--vibekit-text': palette.text,
      '--vibekit-text-2': palette.text2,
      '--vibekit-text-3': palette.text3,
      '--vibekit-border': palette.border,
      '--vibekit-border-strong': palette.borderStrong,
      '--vibekit-surface': palette.surface,
      '--vibekit-surface-2': palette.surface2,
      '--vibekit-surface-solid': palette.solid,
      '--vibekit-overlay': palette.overlay,
      '--vibekit-hover': palette.hover,
      '--vibekit-active': palette.active,
      '--vibekit-shadow': palette.shadow
    };
    Object.keys(vars).forEach(function(key) { r.style.setProperty(key, vars[key]); });

    var head = document.head || document.documentElement;
    var base = document.getElementById('vibekit-light-base');
    var link = document.getElementById('vibekit-light-plugin');
    if (MODE === 'light') {
      if (!base) {
        base = document.createElement('style');
        base.id = 'vibekit-light-base';
        head.appendChild(base);
      }
      if (base.textContent !== LIGHT_BASE_CSS) base.textContent = LIGHT_BASE_CSS;
      if (!link) {
        link = document.createElement('link');
        link.id = 'vibekit-light-plugin';
        link.rel = 'stylesheet';
        link.href = 'light.css';
        head.appendChild(link);
      }
    } else {
      if (base && base.parentNode) base.parentNode.removeChild(base);
      if (link && link.parentNode) link.parentNode.removeChild(link);
    }
  }

  applyPalette();
  // Native window material shows through the iframe; keep the iframe itself transparent.
  (function() {
    var style = document.createElement('style');
    style.id = 'vibekit-glass';
    style.textContent = 'html,body{background:transparent!important}';
    (document.head || document.documentElement).appendChild(style);
  })();
  var pending = {};
  function rpc(method, params) {
    return new Promise(function(resolve, reject) {
      var id = Math.random().toString(36).slice(2);
      pending[id] = { resolve: resolve, reject: reject };
      window.parent.postMessage({ id: id, method: method, params: params, pluginId: PLUGIN_ID, src: 'vibekit-plugin' }, '*');
    });
  }
  // Apply theme variables from parent (received via postMessage)
  function applyTheme(payload) {
    if (!payload || typeof payload !== 'object') return;
    if (payload.accent) ACCENT = payload.accent;
    if (payload.glow) GLOW = payload.glow;
    if (payload.glass) GLASS = payload.glass;
    if (payload.mode) MODE = payload.mode === 'light' ? 'light' : 'dark';
    applyPalette();
  }
  window.addEventListener('message', function(e) {
    if (e.data && e.data.id && pending[e.data.id]) {
      if (e.data.error) pending[e.data.id].reject(e.data.error);
      else pending[e.data.id].resolve(e.data.result);
      delete pending[e.data.id];
    }
    if (e.data && e.data.type === 'vibekit-theme') {
      applyTheme(e.data);
    }
  });
  // Request theme from parent on load
  window.parent.postMessage({ type: 'vibekit-request-theme', pluginId: PLUGIN_ID, src: 'vibekit-plugin' }, '*');
  window.vibekit = ${buildPluginBridgeObject()};
  window.vibekit.events = ${buildPluginEventsObject()};
  console.log('[vibekit-bridge] Plugin ' + PLUGIN_ID + ' ready');
})();
`;
}

function registerAppProtocol(): void {
  protocol.handle('app', (request) => {
    try {
      const url = new URL(request.url);

      // Serve vibekit-bridge.js for plugin iframes — always reads current theme from config
      if (url.host === '__vibekit__' && url.pathname === '/bridge.js') {
        const pluginId = url.searchParams.get('pluginId') || 'unknown';
        const config = configService?.get();
        const accent = config?.appearance?.customAccentColor || DEFAULT_ACCENT;
        const glow = accentGlow(accent);
        const mode = config?.appearance?.themeMode === 'light' ? 'light' : 'dark';
        const glass = config?.appearance?.customGlassColor || (mode === 'light' ? 'rgba(255,255,255,0.72)' : 'rgba(18,18,42,0.35)');
        return new Response(getBridgeScript(pluginId, accent, glow, glass, mode), {
          headers: {
            'Content-Type': 'application/javascript',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
          },
        });
      }

      // Serve clipboard thumbnails — use fs.readFileSync for reliability
      if (url.host === '__vibekit__' && url.pathname.startsWith('/thumb/')) {
        try {
          const fileName = path.basename(url.pathname);
          const thumbDir = path.join(getPluginDataDir(), '_clipboard_thumbs');
          const thumbPath = path.join(thumbDir, fileName);
          if (fs.existsSync(thumbPath)) {
            const data = fs.readFileSync(thumbPath);
            return new Response(data, {
              headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' },
            });
          }
        } catch (e) { console.error('Thumb serve error:', e); }
        return new Response('Not Found', { status: 404 });
      }

      let filePath: string;
      if (url.host === 'plugins') {
        filePath = path.join(getPluginsDir(), decodeURIComponent(url.pathname));
      } else if (url.host === 'renderer') {
        // In both dev and packaged: app.getAppPath() points to the app dir
        const rendererDist = path.join(app.getAppPath(), 'out', 'renderer');
        filePath = path.join(rendererDist, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));
      } else {
        filePath = path.join(getPluginsDir(), url.host, decodeURIComponent(url.pathname));
      }

      filePath = path.normalize(filePath);

      if (!fs.existsSync(filePath)) {
        const indexPath = path.join(filePath, 'index.html');
        if (fs.existsSync(indexPath)) {
          filePath = indexPath;
        } else {
          // Serve a default plugin view.html for plugins without one
          if (!filePath.includes('.')) {
            const config = configService?.get();
            const accent = config?.appearance?.customAccentColor || DEFAULT_ACCENT;
            const glow = accentGlow(accent);
            return new Response(getDefaultPluginHTML(url.host, accent, glow), {
              headers: { 'Content-Type': 'text/html; charset=utf-8' },
            });
          }
          return new Response('Not Found', { status: 404 });
        }
      }

      // Read from disk directly — net.fetch caches file:// responses
      const mimeMap: Record<string, string> = {
        '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
        '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.ico': 'image/x-icon',
        '.woff': 'font/woff', '.woff2': 'font/woff2',
      };
      const ext = path.extname(filePath).toLowerCase();
      const mimeType = mimeMap[ext] || 'application/octet-stream';
      const isPluginFile = url.host !== 'renderer';
      return new Response(fs.readFileSync(filePath), {
        headers: {
          'Content-Type': mimeType,
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': isPluginFile ? 'no-cache, no-store, must-revalidate' : 'public, max-age=3600',
        },
      });
    } catch (err) {
      console.error('Protocol handler error:', err);
      return new Response('Internal Error', { status: 500 });
    }
  });
}

// Default HTML shell for plugins without view.html
function getDefaultPluginHTML(pluginId: string, accent: string, glow: string): string {
  const bridgeUrl = `app://__vibekit__/bridge.js?pluginId=${encodeURIComponent(pluginId)}&accent=${encodeURIComponent(accent)}&glow=${encodeURIComponent(glow)}`;
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  :root{--accent:${accent};--accent-glow:${glow}}
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC',sans-serif;
       background:transparent;color:var(--vibekit-text,#e8e8f0);padding:16px;overflow-y:auto;height:100vh}
  button{background:var(--accent);color:#fff;border:none;padding:8px 16px;
         border-radius:8px;cursor:pointer;font-size:13px;font-family:inherit}
  input{background:var(--vibekit-surface-2,rgba(255,255,255,0.05));border:1px solid var(--vibekit-border,rgba(255,255,255,0.08));color:var(--vibekit-text,#e8e8f0);
         padding:8px 12px;border-radius:8px;font-size:13px;width:100%;outline:none}
  input:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-glow)}
  .card{background:var(--vibekit-surface,rgba(255,255,255,0.03));border:1px solid var(--vibekit-border,rgba(255,255,255,0.08));
        border-radius:12px;padding:12px;margin-bottom:8px}
  ::-webkit-scrollbar{width:5px;height:5px}
  ::-webkit-scrollbar-track{background:transparent}
  ::-webkit-scrollbar-thumb{background:var(--accent);border-radius:3px}
  ::-webkit-scrollbar-thumb:hover{background:var(--accent-glow)}
  ::-webkit-scrollbar-corner{background:transparent}
  *{scrollbar-width:thin;scrollbar-color:var(--accent) transparent}
</style></head>
<body>
  <h2 style="margin-bottom:12px;font-size:16px">${pluginId}</h2>
  <div class="card"><p style="font-size:13px;opacity:0.7">插件已加载。创建 view.html 来自定义界面。</p></div>
  <script src="${bridgeUrl}"></script>
</body>
</html>`;
}

// --- Tray setup ---
function createTray(): void {
  try {
    // 托盘用极简 V 专用图标（16px 下细节图标会糊成一团）
    const iconPath = isDev
      ? path.join(app.getAppPath(), 'build', 'tray.png')
      : path.join(process.resourcesPath, 'tray.png');
    const fallbackPath = isDev
      ? path.join(app.getAppPath(), 'build', 'icon.png')
      : path.join(process.resourcesPath, 'icon.png');
    let trayIcon = nativeImage.createFromPath(iconPath);
    if (trayIcon.isEmpty()) trayIcon = nativeImage.createFromPath(fallbackPath);
    trayIcon = trayIcon.resize({ width: 16, height: 16 });

    tray = new Tray(trayIcon);
    tray.setToolTip('VibeKit - 本地离线效率工具箱');

    const contextMenu = Menu.buildFromTemplate([
      {
        label: '切换搜索框',
        click: () => windowManager?.toggleSearch(),
      },
      {
        label: '设置',
        click: () => windowManager?.createMiniToolWindow('local.settings'),
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          app.quit();
        },
      },
    ]);

    tray.setContextMenu(contextMenu);
    tray.on('click', () => windowManager?.toggleSearch());

    console.log('系统托盘已就绪');
  } catch (err) {
    console.warn('托盘创建失败:', err);
    tray = null;
  }
}

// --- Register hotkey AFTER window is ready ---
function registerHotkeyAfterReady(): void {
  const result = hotkeyService.registerAction('toggleSearch', () => {
    windowManager.toggleSearch();
  });

  if (result.success) {
    console.log('快捷键注册成功:', result.message);
  } else {
    console.warn('快捷键:', result.message);
    console.log('可通过系统托盘图标点击切换搜索框');
  }

  const aiWebResult = hotkeyService.registerAction('toggleAiWeb', () => {
    aiWebService.toggle();
  });
  if (aiWebResult.success) {
    console.log('AI 网页快开快捷键注册成功:', aiWebResult.message);
  } else {
    console.warn('AI 网页快开快捷键:', aiWebResult.message, '（可在设置中更换）');
  }
}

// --- App lifecycle ---
app.whenReady().then(async () => {
  ensureAppDirectories();

  // Remove app-owned built-in plugins that have been retired.
  const retiredBuiltinPlugins = ['local.watch-lock'];
  const userPluginsDir = getPluginsDir();
  for (const id of retiredBuiltinPlugins) {
    try {
      const retiredDir = path.join(userPluginsDir, id);
      if (fs.existsSync(retiredDir)) fs.rmSync(retiredDir, { recursive: true, force: true });
      const dbPath = path.join(getPluginDataDir(), `${id}.db`);
      for (const suffix of ['', '-wal', '-shm']) {
        try { fs.rmSync(dbPath + suffix, { force: true }); } catch { /* locked by an older running instance */ }
      }
    } catch {
      // best effort; the old plugin will disappear after the stale app exits
    }
  }

  // Copy built-in plugins to user plugins dir on first run / update
  const builtinDir = getBuiltinPluginsDir();
  if (fs.existsSync(builtinDir)) {
    for (const entry of fs.readdirSync(builtinDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name.startsWith('_')) continue;
      const src = path.join(builtinDir, entry.name);
      const dst = path.join(userPluginsDir, entry.name);
      // Built-in plugins are app-owned: keep the user copy in sync on every launch.
      copyDirSync(src, dst);
      console.log('Synced built-in plugin:', entry.name);
    }
  }

  // Initialize services
  configService = new ConfigService();
  try {
    const bounds = configService.getValue<Record<string, unknown> | null>('pluginWindowBounds');
    if (bounds && Object.prototype.hasOwnProperty.call(bounds, 'local.watch-lock')) {
      const next = { ...bounds };
      delete next['local.watch-lock'];
      configService.setValue('pluginWindowBounds', next);
    }
  } catch {
    // best effort
  }
  try {
    nativeTheme.themeSource = configService.get().appearance.themeMode === 'light' ? 'light' : 'dark';
  } catch {
    // best effort
  }
  dataService = new DataService();
  clipboardService = new ClipboardService(configService);
  windowManager = new WindowManager();
  windowManager.setConfigService(configService);
  // Set the preload before any service can open a window (e.g. a reminder HUD
  // that fires while the app is starting).
  windowManager.setPreloadPath(
    isDev ? path.join(app.getAppPath(), 'out', 'preload', 'index.js') : path.join(__dirname, '../preload/index.js'),
  );
  hotkeyService = new HotkeyService(configService);
  pluginManager = new PluginManager(configService);
  permissionsService = new PermissionsService(pluginManager, configService);
  eventRouter = new EventRouter(windowManager, permissionsService);
  lanService = new LanTransferService(configService, eventRouter);
  aiWebService = new AiWebService(configService, eventRouter);
  voiceService = new VoiceService(
    configService,
    eventRouter,
    new InputInjector(),
  );
  invoiceService = new InvoiceService(dataService);
  recorderService = new RecorderService();
  pomodoroService = new PomodoroService(dataService, eventRouter, windowManager);
  netToolsService = new NetToolsService(eventRouter);
  searchMasterService = new SearchMasterService();
  compareService = new CompareService();
  automationService = new AutomationService(dataService, netToolsService, windowManager);

  lifecycle = new Lifecycle();
  lifecycle.register(() => hotkeyService.unregisterAll());
  lifecycle.register(() => lanService.stop());
  lifecycle.register(() => aiWebService.destroy());
  lifecycle.register(() => voiceService.destroy());
  lifecycle.register(() => recorderService.cleanup());
  lifecycle.register(() => pomodoroService.destroy());
  lifecycle.register(() => netToolsService.destroy());
  lifecycle.register(() => automationService.destroy());
  lifecycle.register(() => clipboardService.close());
  lifecycle.register(() => dataService.closeAll());
  lifecycle.register(() => windowManager.destroyAll());

  // App icon
  const iconPath = isDev
    ? path.join(app.getAppPath(), 'build', 'icon.png')
    : path.join(process.resourcesPath, 'icon.png');
  windowManager.setIconPath(iconPath);

  if (process.env.ELECTRON_RENDERER_URL) {
    windowManager.setRendererBaseUrl(process.env.ELECTRON_RENDERER_URL);
    console.log('Dev mode: renderer served from', process.env.ELECTRON_RENDERER_URL);
  }

  registerAppProtocol();
  registerIpcHandlers({
    windowManager,
    pluginManager,
    configService,
    hotkeyService,
    dataService,
    clipboardService,
    permissionsService,
    eventRouter,
    lanService,
    aiWebService,
    voiceService,
    invoiceService,
    recorderService,
    pomodoroService,
    netToolsService,
    searchMasterService,
    compareService,
    automationService,
  });

  // Scan plugins
  const plugins = await pluginManager.scanPlugins();
  console.log(`已加载 ${plugins.length} 个插件`);

  // Create tray
  createTray();

  // Create and SHOW the search window first — globalShortcut needs a window with
  // an active message pump on Windows to successfully register hotkeys.
  const searchWin = windowManager.createSearchWindow();

  // Wait for the window to be fully ready, THEN register the hotkey.
  // This is critical: on Windows, RegisterHotKey fails if called before
  // the first window is created and shown.
  searchWin.once('ready-to-show', () => {
    // Small delay ensures the message pump is fully active
    setTimeout(() => {
      registerHotkeyAfterReady();
    }, 200);

    // Don't leave the window visible — just needed it for registration
    // The user invokes search with the hotkey or tray icon
  });

  // macOS dock activation
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      windowManager.createSearchWindow();
    }
  });

  // Start clipboard watching and LAN discovery (if the user enabled it).
  void clipboardService.startWatching();
  void lanService.startIfEnabled();

  console.log('VibeKit 启动成功');
  console.log('插件目录:', getPluginsDir());
});

app.on('window-all-closed', () => {
  if (!isMacOS()) {
    // Keep running for hotkey + tray
  }
});

app.on('before-quit', () => {
  if (lifecycle) lifecycle.stopAll();
  if (tray) {
    tray.destroy();
    tray = null;
  }
});
