import { BrowserWindow, screen } from 'electron';
import * as path from 'path';
import { canUseAcrylic, canUseMica, isMacOS } from '../utils/platform';
import type { ConfigService } from '../services/ConfigService';

export type WindowType = 'search' | 'mini';

export interface WindowConfig {
  type: WindowType;
  width: number;
  height: number;
  transparent: boolean;
  frame: boolean;
  alwaysOnTop: boolean;
  skipTaskbar: boolean;
  resizable: boolean;
  vibrancy?: string;
}

interface SavedPosition {
  x: number;
  y: number;
}

export class WindowManager {
  private windows: Map<string, BrowserWindow> = new Map();
  private pluginOwners: Map<number, string> = new Map();
  private preloadPath: string;
  private rendererBaseUrl: string;
  private isDev: boolean;
  private iconPath = '';
  private configService: ConfigService | null = null;
  private searchPosition: SavedPosition | null = null;
  private pendingSearchHide: ReturnType<typeof setTimeout> | null = null;
  private miniStack: number[] = []; // stack of mini window IDs, newest last
  private lastEscTime = 0; // guard against double-fire
  private suppressSearchBlurUntil = 0;
  private notificationHud: BrowserWindow | null = null;
  private notificationHudTimer: ReturnType<typeof setTimeout> | null = null;
  private miniBoundsTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  constructor() {
    this.preloadPath = '';
    this.rendererBaseUrl = '';
    this.isDev = !!(process.env.ELECTRON_RENDERER_URL);
  }

  // Cancel any pending hide when another VibeKit window takes focus
  private cancelPendingHide(): void {
    if (this.pendingSearchHide) {
      clearTimeout(this.pendingSearchHide);
      this.pendingSearchHide = null;
    }
  }

  setConfigService(cs: ConfigService): void {
    this.configService = cs;
    // Restore saved position from config
    try {
      const saved = cs.getValue<SavedPosition | null>('searchWindowPosition');
      if (saved && typeof saved.x === 'number' && typeof saved.y === 'number') {
        this.searchPosition = saved;
      }
    } catch {
      this.searchPosition = null;
    }
    // Layout v3 centers new plugin windows. Clear bounds saved by the old
    // top-right cascade so they don't keep reopening off-center. (v2 was the
    // first centered attempt; v3 re-clears anything an older running build
    // wrote back after that migration.)
    try {
      const layoutVersion = cs.getValue<number>('pluginWindowBoundsVersion') ?? 1;
      if (layoutVersion < 3) {
        cs.setValue('pluginWindowBounds', {});
        cs.setValue('pluginWindowBoundsVersion', 3);
      }
    } catch {
      // ignore migration failures
    }
  }

  setPreloadPath(preloadPath: string): void {
    this.preloadPath = preloadPath;
  }

  setIconPath(iconPath: string): void {
    this.iconPath = iconPath;
  }

  setRendererBaseUrl(url: string): void {
    this.rendererBaseUrl = url;
  }

  private getUrl(hash: string): string {
    if (this.rendererBaseUrl) {
      return `${this.rendererBaseUrl}#${hash}`;
    }
    return `app://renderer/index.html#${hash}`;
  }

  // Pass the persisted mode to the preload so the first paint uses the right theme.
  private themeModeArgument(): string {
    const mode = this.configService?.getValue('appearance.themeMode') === 'light' ? 'light' : 'dark';
    return `--theme-mode=${mode}`;
  }

  // --- Mini window bounds persistence ---

  private miniBoundsMap(): Record<string, { x: number; y: number; width: number; height: number }> {
    try {
      const value = this.configService?.getValue('pluginWindowBounds');
      return value && typeof value === 'object'
        ? (value as Record<string, { x: number; y: number; width: number; height: number }>)
        : {};
    } catch {
      return {};
    }
  }

  private centeredMiniPosition(width: number, height: number): { x: number; y: number } {
    const searchWin = this.windows.get('search');
    const display = searchWin && !searchWin.isDestroyed()
      ? screen.getDisplayMatching(searchWin.getBounds())
      : screen.getPrimaryDisplay();
    const area = display.workArea;
    const openCount = Array.from(this.windows.entries())
      .filter(([key, win]) => key.startsWith('mini-') && win && !win.isDestroyed() && win.isVisible())
      .length;
    // First window is dead center; additional windows open in a small
    // diagonal ring around the center instead of the old corner cascade.
    const offsets = [0, 28, -28, 56, -56, 84, -84, 112, -112];
    const offset = offsets[openCount % offsets.length];
    const centerX = area.x + Math.round((area.width - width) / 2);
    const centerY = area.y + Math.round((area.height - height) / 2);
    const x = Math.min(Math.max(centerX + offset, area.x), area.x + area.width - width);
    const y = Math.min(Math.max(centerY + offset, area.y), area.y + area.height - height);
    return { x, y };
  }

  private resolveMiniBounds(
    pluginId: string,
    defaultWidth?: number,
    defaultHeight?: number,
  ): { x: number; y: number; width: number; height: number } {
    const saved = this.miniBoundsMap()[pluginId];
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
      const display = screen.getDisplayMatching({
        x: saved.x,
        y: saved.y,
        width: Math.max(1, saved.width || 0),
        height: Math.max(1, saved.height || 0),
      });
      const area = display.workArea;
      const width = Math.min(Math.max(saved.width || 480, 300), area.width);
      const height = Math.min(Math.max(saved.height || 580, 200), area.height);
      const x = Math.min(Math.max(saved.x, area.x), area.x + area.width - width);
      const y = Math.min(Math.max(saved.y, area.y), area.y + area.height - height);
      return { x, y, width, height };
    }
    const area = screen.getPrimaryDisplay().workArea;
    const width = Math.min(Math.max(defaultWidth || 480, 300), area.width);
    const height = Math.min(Math.max(defaultHeight || 580, 200), area.height);
    const position = this.centeredMiniPosition(width, height);
    return { x: position.x, y: position.y, width, height };
  }

  private persistMiniBounds(pluginId: string, win: BrowserWindow): void {
    if (!this.configService || win.isDestroyed()) return;
    try {
      const bounds = win.getBounds();
      const map = { ...this.miniBoundsMap() };
      map[pluginId] = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
      this.configService.setValue('pluginWindowBounds', map);
    } catch {
      // ignore persistence failures
    }
  }

  private schedulePersistMiniBounds(pluginId: string, win: BrowserWindow): void {
    const pending = this.miniBoundsTimers.get(pluginId);
    if (pending) clearTimeout(pending);
    this.miniBoundsTimers.set(pluginId, setTimeout(() => {
      this.miniBoundsTimers.delete(pluginId);
      this.persistMiniBounds(pluginId, win);
    }, 400));
  }

  private ensureWindowVisible(win: BrowserWindow): void {
    if (win.isDestroyed()) return;
    try {
      const bounds = win.getBounds();
      const display = screen.getDisplayMatching(bounds);
      const area = display.workArea;
      const width = Math.min(bounds.width, area.width);
      const height = Math.min(bounds.height, area.height);
      const x = Math.min(Math.max(bounds.x, area.x), area.x + area.width - width);
      const y = Math.min(Math.max(bounds.y, area.y), area.y + area.height - height);
      if (x !== bounds.x || y !== bounds.y || width !== bounds.width || height !== bounds.height) {
        win.setBounds({ x, y, width, height });
      }
    } catch {
      // best effort
    }
  }

  // Called after a drag ends so the new position is persisted immediately.
  persistWindowBounds(win: BrowserWindow): void {
    const pluginId = this.pluginOwners.get(win.id);
    if (pluginId) this.persistMiniBounds(pluginId, win);
  }

  private showSearchWindow(win: BrowserWindow, notifyFocused = true): void {
    this.cancelPendingHide();
    this.suppressSearchBlurUntil = Date.now() + 500;
    try { win.setAlwaysOnTop(true, 'pop-up-menu'); } catch {}
    if (!win.isVisible()) {
      win.showInactive();
    }
    setTimeout(() => {
      if (!win.isDestroyed() && win.isVisible()) {
        this.cancelPendingHide();
        win.focus();
        if (notifyFocused) {
          win.webContents.send('vibekit:search-focused');
        }
      }
    }, 16);
  }

  // --- Search Window (global floating bar) ---
  createSearchWindow(): BrowserWindow {
    const existing = this.windows.get('search');
    if (existing && !existing.isDestroyed()) {
      return existing;
    }

    const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
    const winWidth = 680;
    const winHeight = 480;

    // Use saved position if available, otherwise center
    let x: number;
    let y: number;

    if (this.searchPosition) {
      // Clamp to screen bounds
      x = Math.max(0, Math.min(this.searchPosition.x, screenWidth - winWidth));
      y = Math.max(0, Math.min(this.searchPosition.y, screenHeight - winHeight));
    } else {
      x = Math.round((screenWidth - winWidth) / 2);
      y = Math.round((screenHeight - winHeight) / 2.5);
    }

    const win = new BrowserWindow({
      width: winWidth,
      height: winHeight,
      x,
      y,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      show: false,
      title: 'VibeKit Search',
      icon: this.iconPath,
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        sandbox: false,
        nodeIntegration: false,
        webSecurity: true,
        additionalArguments: ['--window-type=search', this.themeModeArgument()],
      },
      ...this.getBlurOptions('search'),
    });

    // Save position when user moves the window
    win.on('moved', () => {
      const [wx, wy] = win.getPosition();
      this.searchPosition = { x: wx, y: wy };
      // Persist to config
      if (this.configService) {
        try {
          this.configService.setValue('searchWindowPosition', this.searchPosition);
        } catch {
          // ignore config write errors
        }
      }
    });

    // ESC: close newest mini window first, then hide search (stack-based)
    // Guard prevents double-fire when focus shifts between windows
    win.webContents.on('before-input-event', (_event, input) => {
      if (input.key === 'Escape') {
        const now = Date.now();
        if (now - this.lastEscTime < 150) return; // debounce
        this.lastEscTime = now;
        if (this.miniStack.length > 0) {
          const topId = this.miniStack[this.miniStack.length - 1];
          const miniWin = BrowserWindow.fromId(topId);
          if (miniWin && !miniWin.isDestroyed()) {
            miniWin.close();
          } else {
            this.miniStack.pop();
          }
        } else {
          win.hide();
        }
      }
    });

    // Cancel pending hide when search regains focus
    win.on('focus', () => {
      this.cancelPendingHide();
      // Raise all mini tool windows above search
      for (const [key, w] of this.windows) {
        if (key.startsWith('mini-') && w && !w.isDestroyed() && w.isVisible()) {
          w.moveTop();
        }
      }
    });

    // Only hide on blur when NO other VibeKit windows exist
    win.on('blur', () => {
      this.cancelPendingHide();
      if (Date.now() < this.suppressSearchBlurUntil) return;
      const otherWindows = BrowserWindow.getAllWindows().filter(
        w => w.id !== win.id && !w.isDestroyed() && w.isVisible()
      );
      if (otherWindows.length === 0) {
        this.pendingSearchHide = setTimeout(() => {
          this.pendingSearchHide = null;
          win.hide();
        }, 200);
      }
    });

    // Prevent close, just hide
    win.on('close', (e) => {
      e.preventDefault();
      win.hide();
    });

    this.windows.set('search', win);

    win.loadURL(this.getUrl('search')).catch((err) => {
      console.error('Failed to load search window:', err);
    });

    return win;
  }

  // --- Mini Tool Window (floating plugin tool) ---
  createMiniToolWindow(pluginId: string, width?: number, height?: number): number {
    // Don't hide the search window when opening a mini tool
    this.cancelPendingHide();

    // Recorder: special non-iframe window
    if (pluginId === 'local.screen-recorder') {
      return this.createRecorderWindow(pluginId);
    }

    // Single-instance: if a mini window for this pluginId already exists, just focus it
    for (const [key, existingWin] of this.windows) {
      if (key.startsWith(`mini-${pluginId}-`) && existingWin && !existingWin.isDestroyed()) {
        if (existingWin.isMinimized()) existingWin.restore();
        this.ensureWindowVisible(existingWin);
        existingWin.show();
        existingWin.focus();
        existingWin.moveTop();
        existingWin.setAlwaysOnTop(true, 'pop-up-menu');
        return existingWin.id;
      }
    }

    const winKey = `mini-${pluginId}-${Date.now()}`;
    const bounds = this.resolveMiniBounds(pluginId, width, height);

    const win = new BrowserWindow({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      minWidth: 300,
      minHeight: 200,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: false,
      resizable: true,
      maximizable: false,
      show: false,
      title: `VibeKit - ${pluginId}`,
      icon: this.iconPath,
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        sandbox: false,
        nodeIntegration: false,
        webSecurity: true,
        additionalArguments: [`--plugin-id=${pluginId}`, this.themeModeArgument()],
      },
      ...this.getBlurOptions('mini'),
    });

    // Remember where the user puts each plugin window.
    win.on('moved', () => this.schedulePersistMiniBounds(pluginId, win));
    win.on('resized', () => this.schedulePersistMiniBounds(pluginId, win));
    win.on('close', () => this.persistMiniBounds(pluginId, win));

    // Cancel search hide when this mini window gets focus
    win.on('focus', () => {
      this.cancelPendingHide();
    });
    // ESC: close this mini window
    win.webContents.on('before-input-event', (_event, input) => {
      if (input.key === 'Escape') {
        this.lastEscTime = Date.now();
        win.close();
      }
    });

    let miniShownOnce = false;
    const showMiniWindow = () => {
      if (miniShownOnce || win.isDestroyed()) return;
      miniShownOnce = true;
      win.show();
      win.focus();
      win.setAlwaysOnTop(true, 'pop-up-menu');
      // Double-raise to overcome race with search bar z-order
      win.moveTop();
      setTimeout(() => win.moveTop(), 50);
    };

    // Show promptly; plugin iframe loading should not make the window feel dead.
    win.once('ready-to-show', showMiniWindow);
    win.webContents.on('did-finish-load', showMiniWindow);
    setTimeout(showMiniWindow, 350);

    const numericId = win.id;
    this.windows.set(winKey, win);
    this.pluginOwners.set(numericId, pluginId);
    // Push to stack so ESC can close newest first
    this.miniStack.push(numericId);

    win.loadURL(
      this.getUrl(`mini?pluginId=${encodeURIComponent(pluginId)}`)
    ).catch((err) => {
      console.error('Failed to load mini tool window:', err);
    });

    win.on('closed', () => {
      this.miniStack = this.miniStack.filter(id => id !== numericId);
      this.windows.delete(winKey);
      this.pluginOwners.delete(numericId);
      const pending = this.miniBoundsTimers.get(pluginId);
      if (pending) {
        clearTimeout(pending);
        this.miniBoundsTimers.delete(pluginId);
      }
    });

    return numericId;
  }

  // --- Automation result window (floating output panel) ---
  createAutomationResultWindow(runId: string): number {
    const existing = this.windows.get('automation-result');
    if (existing && !existing.isDestroyed()) {
      existing.webContents.send('vibekit:automation-focus-run', runId);
      existing.show();
      existing.focus();
      existing.moveTop();
      existing.setAlwaysOnTop(true, 'pop-up-menu');
      return existing.id;
    }

    const display = screen.getPrimaryDisplay().workArea;
    const width = 720;
    const height = 600;
    const x = Math.round(display.x + (display.width - width) / 2);
    const y = Math.round(display.y + (display.height - height) / 2.2);

    const win = new BrowserWindow({
      x,
      y,
      width,
      height,
      minWidth: 480,
      minHeight: 340,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: false,
      resizable: true,
      maximizable: false,
      show: false,
      title: 'VibeKit - 自动化结果',
      icon: this.iconPath,
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        sandbox: false,
        nodeIntegration: false,
        webSecurity: true,
        additionalArguments: ['--window-type=automation-result', this.themeModeArgument()],
      },
      ...this.getBlurOptions('mini'),
    });

    const winKey = 'automation-result';
    this.windows.set(winKey, win);

    win.webContents.on('before-input-event', (_event, input) => {
      if (input.key === 'Escape') {
        this.lastEscTime = Date.now();
        win.close();
      }
    });

    win.on('focus', () => this.cancelPendingHide());

    let shown = false;
    const showWindow = () => {
      if (shown || win.isDestroyed()) return;
      shown = true;
      win.show();
      win.focus();
      win.setAlwaysOnTop(true, 'pop-up-menu');
      win.moveTop();
    };
    win.once('ready-to-show', showWindow);
    win.webContents.on('did-finish-load', showWindow);
    setTimeout(showWindow, 400);

    win.on('closed', () => {
      this.windows.delete(winKey);
    });

    win.loadURL(this.getUrl(`automation-result?runId=${encodeURIComponent(runId)}`)).catch((err) => {
      console.error('Failed to load automation result window:', err);
    });

    return win.id;
  }

  // --- Window operations ---
  getWindow(typeOrId: string): BrowserWindow | undefined {
    return this.windows.get(typeOrId);
  }

  getPluginIdForWindow(windowId: number): string | undefined {
    return this.pluginOwners.get(windowId);
  }

  getPluginWindows(): Array<{ id: number; pluginId: string }> {
    return Array.from(this.pluginOwners.entries()).map(([id, pluginId]) => ({ id, pluginId }));
  }

  toggleSearch(): void {
    const win = this.windows.get('search');
    if (!win || win.isDestroyed()) {
      const newWin = this.createSearchWindow();
      newWin.once('ready-to-show', () => {
        this.showSearchWindow(newWin);
      });
      return;
    }

    if (win.isVisible()) {
      this.cancelPendingHide();
      win.hide();
    } else {
      this.showSearchWindow(win);
    }
  }

  showSearch(): void {
    const win = this.windows.get('search');
    if (!win || win.isDestroyed()) {
      const newWin = this.createSearchWindow();
      newWin.once('ready-to-show', () => {
        this.showSearchWindow(newWin, false);
      });
      return;
    }
    this.showSearchWindow(win, false);
  }

  hideSearch(): void {
    const win = this.windows.get('search');
    if (win && !win.isDestroyed()) {
      win.hide();
    }
  }

  // Recorder: special window that doesn't use iframe sandbox
  private createRecorderWindow(pluginId: string): number {
    for (const [key, existingWin] of this.windows) {
      if (key.startsWith(`mini-${pluginId}-`) && existingWin && !existingWin.isDestroyed()) {
        existingWin.show();
        existingWin.focus();
        return existingWin.id;
      }
    }

    const winKey = `mini-${pluginId}-${Date.now()}`;
    const bounds = this.resolveMiniBounds(pluginId, 820, 640);
    const win = new BrowserWindow({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      minWidth: 700,
      minHeight: 500,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: false,
      show: false,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        sandbox: false,
        nodeIntegration: false,
        backgroundThrottling: false,
        additionalArguments: ['--window-type=recorder', this.themeModeArgument()],
      },
      ...this.getBlurOptions('recorder'),
    });
    win.on('moved', () => this.schedulePersistMiniBounds(pluginId, win));
    win.on('resized', () => this.schedulePersistMiniBounds(pluginId, win));
    win.on('close', () => this.persistMiniBounds(pluginId, win));

    if (this.iconPath) {
      try { win.setIcon(this.iconPath); } catch {}
    }

    this.windows.set(winKey, win);
    this.pluginOwners.set(win.id, pluginId);

    // Load recorder UI from renderer
    if (this.rendererBaseUrl) {
      win.loadURL(`${this.rendererBaseUrl}/recorder.html`);
    } else {
      const { app: electronApp } = require('electron');
      const recorderPath = path.join(electronApp.getAppPath(), 'out', 'renderer', 'recorder.html');
      win.loadFile(recorderPath);
    }

    win.setMenuBarVisibility(false);

    let recorderShownOnce = false;
    win.once('ready-to-show', () => {
      recorderShownOnce = true;
      win.show();
    });
    // Fallback: show after 2s even if ready-to-show doesn't fire
    setTimeout(() => {
      if (win && !win.isDestroyed() && !win.isVisible() && !recorderShownOnce) {
        recorderShownOnce = true;
        win.show();
      }
    }, 2000);

    win.on('closed', () => {
      this.windows.delete(winKey);
      this.pluginOwners.delete(win.id);
      const pending = this.miniBoundsTimers.get(pluginId);
      if (pending) {
        clearTimeout(pending);
        this.miniBoundsTimers.delete(pluginId);
      }
    });

    return win.id;
  }

  closeMiniTool(windowId: number): void {
    let targetKey: string | null = null;
    let targetWin: BrowserWindow | null = null;
    for (const [key, win] of this.windows) {
      if (win.id === windowId && key.startsWith('mini-')) {
        targetKey = key;
        targetWin = win;
        break;
      }
    }
    if (targetWin) {
      targetWin.close();
      if (targetKey) this.windows.delete(targetKey);
      this.pluginOwners.delete(windowId);
    }
  }

  // --- Broadcast to all renderer windows ---
  broadcastToAll(channel: string, ...args: unknown[]): void {
    for (const win of this.windows.values()) {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, ...args);
      }
    }
  }

  // --- In-app notification fallback (used when Windows blocks toasts) ---

  showNotificationHud(title: string, body: string, pluginId: string): void {
    if (this.notificationHud && !this.notificationHud.isDestroyed()) {
      this.notificationHud.destroy();
    }
    if (this.notificationHudTimer) {
      clearTimeout(this.notificationHudTimer);
      this.notificationHudTimer = null;
    }

    const display = screen.getPrimaryDisplay();
    const width = 380;
    const height = 112;
    const margin = 18;
    const x = display.workArea.x + display.workArea.width - width - margin;
    const y = display.workArea.y + display.workArea.height - height - margin;

    const win = new BrowserWindow({
      x,
      y,
      width,
      height,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: true,
      hasShadow: false,
      webPreferences: {
        preload: this.preloadPath || undefined,
        contextIsolation: true,
        sandbox: false,
        nodeIntegration: false,
      },
    });
    this.notificationHud = win;
    try {
      win.setAlwaysOnTop(true, 'screen-saver');
    } catch { /* best effort */ }

    const payload = JSON.stringify({ title, body, pluginId });
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      *{box-sizing:border-box;margin:0;padding:0}
      html,body{background:transparent;overflow:hidden;font-family:'Segoe UI','Microsoft YaHei',sans-serif}
      .hud{position:absolute;inset:0;display:flex;overflow:hidden;border-radius:14px;
        background:linear-gradient(180deg,rgba(26,27,48,.98),rgba(18,19,36,.98));
        border:1px solid rgba(99,102,241,.28);box-shadow:0 16px 48px rgba(0,0,0,.5);
        animation:hudIn .22s cubic-bezier(.2,.8,.2,1)}
      @keyframes hudIn{from{opacity:0;transform:translateY(10px) scale(.98)}to{opacity:1;transform:none}}
      .accent{width:3px;background:linear-gradient(180deg,#818cf8,#8b5cf6);flex-shrink:0}
      .content{flex:1;padding:12px 14px 11px;min-width:0;display:flex;flex-direction:column;gap:3px}
      .top{display:flex;align-items:center;justify-content:space-between;gap:8px}
      .app{font-size:10px;font-weight:600;color:#a5b4fc;letter-spacing:.08em;text-transform:uppercase}
      .close{width:20px;height:20px;border:0;border-radius:6px;background:transparent;color:#7c7e96;cursor:pointer;font-size:15px;line-height:1;display:flex;align-items:center;justify-content:center}
      .close:hover{background:rgba(255,255,255,.08);color:#f1f2f8}
      .title{font-size:13px;font-weight:600;color:#f1f2f8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .body{font-size:11px;line-height:1.45;color:#a9abc2;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
      .hint{margin-top:auto;font-size:9px;color:#6b6c84}
    </style></head><body>
      <div class="hud" id="hud">
        <div class="accent"></div>
        <div class="content">
          <div class="top"><span class="app">番茄钟</span><button class="close" id="close" title="关闭">×</button></div>
          <div class="title" id="title"></div>
          <div class="body" id="body"></div>
          <div class="hint">系统通知被拦截，已改用应用内提醒 · 点击打开番茄钟</div>
        </div>
      </div>
      <script>
        var data = ${payload};
        document.getElementById('title').textContent = data.title;
        document.getElementById('body').textContent = data.body;
        document.getElementById('close').addEventListener('click', function (e) {
          e.stopPropagation();
          try { window.vibekitAPI.window.closeCurrent(); } catch (err) { window.close(); }
        });
        document.getElementById('hud').addEventListener('click', function () {
          try { window.vibekitAPI.window.createMiniTool(data.pluginId); } catch (e) {}
          try { window.vibekitAPI.window.closeCurrent(); } catch (e) {}
        });
      </script>
    </body></html>`;

    void win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    win.once('ready-to-show', () => {
      if (!win.isDestroyed()) win.showInactive();
    });
    win.on('closed', () => {
      if (this.notificationHud === win) this.notificationHud = null;
      if (this.notificationHudTimer) {
        clearTimeout(this.notificationHudTimer);
        this.notificationHudTimer = null;
      }
    });
    this.notificationHudTimer = setTimeout(() => {
      if (!win.isDestroyed()) win.destroy();
    }, 9000);
  }

  // --- Cleanup ---
  destroyAll(): void {
    if (this.notificationHudTimer) {
      clearTimeout(this.notificationHudTimer);
      this.notificationHudTimer = null;
    }
    if (this.notificationHud && !this.notificationHud.isDestroyed()) {
      this.notificationHud.destroy();
    }
    this.notificationHud = null;
    for (const win of this.windows.values()) {
      if (!win.isDestroyed()) {
        win.destroy();
      }
    }
    this.windows.clear();
  }

  // --- Platform-specific blur options ---
  private getBlurOptions(kind: 'search' | 'mini' | 'recorder'): Record<string, unknown> {
    const materialSetting = this.configService?.get()?.appearance.nativeMaterial ?? 'auto';
    const opts: Record<string, unknown> = {};

    if (isMacOS()) {
      opts.transparent = true;
      opts.vibrancy = kind === 'search' ? 'fullscreen-ui' : 'under-window';
      opts.backgroundColor = '#00000000';
      opts.visualEffectState = 'active';
      return opts;
    }

    if (materialSetting !== 'off' && canUseAcrylic()) {
      // Native material must not be combined with transparent:true or opacity.
      opts.transparent = false;
      opts.backgroundColor = '#00000000';
      opts.backgroundMaterial = kind === 'recorder' ? 'mica' : 'acrylic';
      return opts;
    }

    if (materialSetting !== 'off' && canUseMica() && kind === 'recorder') {
      opts.transparent = false;
      opts.backgroundColor = '#00000000';
      opts.backgroundMaterial = 'mica';
      return opts;
    }

    // Windows 10 / reduced transparency / material disabled: CSS glass fallback.
    opts.transparent = true;
    opts.backgroundColor = '#00000000';
    return opts;
  }
}
