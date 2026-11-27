import { app, desktopCapturer, screen, BrowserWindow, globalShortcut, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { EventEmitter } from 'events';
import { execFile, spawn, type ChildProcess } from 'child_process';

export interface RecorderConfig {
  mode: 'fullscreen' | 'window' | 'region';
  sourceId?: string;       // screen or window source id
  sourceName?: string;      // display name
  displayBounds?: Electron.Rectangle;  // target display bounds for overlays
  windowBounds?: Electron.Rectangle;   // target app window bounds for window mode overlays
  regionBounds?: { x: number; y: number; width: number; height: number };
  audioSystem: boolean;
  audioMic: boolean;
  captureCursor: boolean;
  captureClicks: boolean;
  captureKeystrokes: boolean;
  countdown: number;       // seconds
  savePath: string;
  resolution: '2k60' | '2k30' | '1080p60';
  fps: number;
}

export type RecorderState = 'idle' | 'countdown' | 'recording' | 'saving';

export class RecorderService extends EventEmitter {
  private state: RecorderState = 'idle';
  private mediaRecorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];
  private overlayWindow: BrowserWindow | null = null;
  private borderWindows: BrowserWindow[] = [];
  private countdownWindows: BrowserWindow[] = [];
  private config: RecorderConfig | null = null;
  private _sourceDisplayMap: Map<string, Electron.Rectangle> = new Map();
  private recordingStartTime = 0;
  private borderKeepAliveTimer: NodeJS.Timeout | null = null;
  private inputHookProcess: ChildProcess | null = null;
  private inputHookBuffer = '';

  constructor() {
    super();
  }

  getState(): RecorderState { return this.state; }

  async getSources(): Promise<{ screens: any[]; windows: any[] }> {
    const displays = screen.getAllDisplays();
    const primaryId = screen.getPrimaryDisplay().id;

    // Screens: return displays in Screen API order, but bind each display to
    // the matching desktopCapturer source by display_id. Capturer source order
    // is not stable on multi-monitor Windows setups.
    let screens: any[] = [];
    this._sourceDisplayMap = new Map(); // sourceId -> displayBounds
    try {
      const screenSources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 320, height: 180 } });
      const sourcesByDisplayId = new Map<string, Electron.DesktopCapturerSource>();
      for (const source of screenSources) {
        if (source.display_id) {
          sourcesByDisplayId.set(source.display_id, source);
        }
      }

      for (let i = 0; i < displays.length; i++) {
        const d = displays[i];
        const s = sourcesByDisplayId.get(String(d.id)) ?? screenSources[i];
        if (!s) continue;
        const thumbnail = s.thumbnail;
        const thumbDataURL = (thumbnail && !thumbnail.isEmpty()) ? thumbnail.toDataURL() : '';

        this._sourceDisplayMap.set(s.id, d.bounds);

        screens.push({
          id: s.id,
          name: s.name,
          thumbnail: thumbDataURL || null,
          displayIndex: i,
          displayId: d.id,
          sourceDisplayId: s.display_id || null,
          displayBounds: d.bounds,
          displayLabel: `${d.bounds.width}×${d.bounds.height}`,
          isPrimary: d.id === primaryId,
        });
      }
    } catch (err) {
      console.warn('Recorder: screen sources failed:', String(err).split('\n')[0]);
      screens = displays.map((d, i) => ({
        id: `screen:${d.id}:0`,
        name: d.label || `显示器 ${d.id}`,
        thumbnail: null,
        displayIndex: i,
        displayBounds: d.bounds,
        displayLabel: `${d.bounds.width}×${d.bounds.height}`,
        isPrimary: d.id === primaryId,
      }));
      for (let i = 0; i < screens.length; i++) {
        this._sourceDisplayMap.set(screens[i].id, screens[i].displayBounds);
      }
    }

    // Windows: try desktopCapturer with icons
    let windows: any[] = [];
    try {
      const winSources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 160, height: 90 }, fetchWindowIcons: true });
      windows = await Promise.all(winSources.map(async (s: any) => ({
        id: s.id,
        name: s.name,
        thumbnail: s.thumbnail,
        appIcon: (s.appIcon && !s.appIcon.isEmpty()) ? s.appIcon.toDataURL() : null,
        windowBounds: await this.getWindowBoundsFromSourceId(s.id),
      })));
    } catch (err) {
      console.warn('Recorder: window sources unavailable:', String(err).split('\n')[0]);
    }

    return { screens, windows };
  }

  getDisplays(): Electron.Display[] {
    return screen.getAllDisplays();
  }

  private async getWindowBoundsFromSourceId(sourceId: string): Promise<Electron.Rectangle | null> {
    if (process.platform !== 'win32') return null;
    const match = /^window:(\d+):/.exec(sourceId);
    if (!match) return null;

    const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32Rect {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
}
"@
$rect = New-Object Win32Rect+RECT
$ok = [Win32Rect]::GetWindowRect([IntPtr]${match[1]}, [ref]$rect)
if ($ok) { "$($rect.Left),$($rect.Top),$($rect.Right),$($rect.Bottom)" }
`;

    return new Promise((resolve) => {
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true }, (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }
        const nums = stdout.trim().split(',').map((part) => Number(part));
        if (nums.length !== 4 || nums.some((n) => !Number.isFinite(n))) {
          resolve(null);
          return;
        }
        const physicalRect = {
          x: nums[0],
          y: nums[1],
          width: Math.max(1, nums[2] - nums[0]),
          height: Math.max(1, nums[3] - nums[1]),
        };
        const rect = screen.screenToDipRect(null, physicalRect);
        resolve({
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.max(1, Math.round(rect.width)),
          height: Math.max(1, Math.round(rect.height)),
        });
      });
    });
  }

  // Utility: get the bounds where overlays (countdown, borders, etc.) should appear
  private getTargetBounds(config: RecorderConfig): Electron.Rectangle {
    if (config.mode === 'region' && config.regionBounds) {
      return config.regionBounds;
    }
    if (config.mode === 'window' && config.windowBounds) {
      return config.windowBounds;
    }
    // Fullscreen: look up by sourceId from the Map built during getSources
    if (config.sourceId && this._sourceDisplayMap.has(config.sourceId)) {
      return this._sourceDisplayMap.get(config.sourceId)!;
    }
    // Fallback
    if (config.displayBounds) {
      return config.displayBounds;
    }
    return screen.getPrimaryDisplay().bounds;
  }

  private normalizeOverlayBounds(bounds: Electron.Rectangle): Electron.Rectangle {
    return {
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.max(1, Math.round(bounds.width)),
      height: Math.max(1, Math.round(bounds.height)),
    };
  }

  private protectOverlayWindow(win: BrowserWindow): void {
    try { win.setContentProtection(true); } catch {}
    try { win.setIgnoreMouseEvents(true); } catch {}
    try { win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch {}
  }

  private pinOverlayWindow(win: BrowserWindow, bounds: Electron.Rectangle): void {
    const targetBounds = this.normalizeOverlayBounds(bounds);
    try { win.setBounds(targetBounds, false); } catch {}
    try { win.setAlwaysOnTop(true, 'screen-saver'); } catch {}
    try { win.moveTop(); } catch {}
  }

  // --- Region picker ---
  async pickRegion(pluginWindowId: number, opts: {audioSystem:boolean;audioMic:boolean;captureCursor:boolean;captureClicks:boolean;captureKeystrokes:boolean}): Promise<any | null> {
    const bw = BrowserWindow.fromId(pluginWindowId);
    if (bw && !bw.isDestroyed()) bw.hide();

    const displays = screen.getAllDisplays();
    const overlayWindows: BrowserWindow[] = [];

    return new Promise(async (resolve) => {
      const html = this.getRegionPickerHTMLWithOptions(opts);
      let resolved = false;

      // Listen for IPC from overlay windows (they use nodeIntegration to send)
      const ipcMain = require('electron').ipcMain;
      const handler = (_event: any, result: any) => {
        if (resolved) return;
        resolved = true;
        for (const w of overlayWindows) {
          try { if (!w.isDestroyed()) w.close(); } catch {}
        }
        if (bw && !bw.isDestroyed()) bw.show();
        resolve(result);
      };
      ipcMain.once('region-selected', handler);

      // Create one overlay per display
      for (const display of displays) {
        const { x, y, width, height } = display.bounds;
        const win = new BrowserWindow({
          x, y, width, height,
          transparent: true,
          frame: false,
          alwaysOnTop: true,
          skipTaskbar: true,
          resizable: false,
          focusable: true,
          fullscreenable: false,
          hasShadow: false,
          webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false },
        });
        win.setAlwaysOnTop(true, 'screen-saver');
        overlayWindows.push(win);
        // Inject display offset before the picker script reads it.
        const offsetHtml = html.replace('<script>', `<script>window.__DISPLAY_OFFSET__={x:${x},y:${y}};`);
        await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(offsetHtml)}`);
        win.show();
        if (overlayWindows.length === 1) win.focus();
      }

      // Timeout + ESC fallback: clean up after 60s
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          ipcMain.removeListener('region-selected', handler);
          for (const w of overlayWindows) {
            try { if (!w.isDestroyed()) w.close(); } catch {}
          }
          if (bw && !bw.isDestroyed()) bw.show();
          resolve(null);
        }
      }, 60000);
    });
  }

  // --- Start Recording (main process: show overlays only) ---
  async startRecording(recorderWindowId: number, config: RecorderConfig): Promise<boolean> {
    if (this.state !== 'idle') return false;
    this.config = config;

    try {
      // Hide all windows (recorder, search, etc.)
      BrowserWindow.getAllWindows().forEach(w => {
        try { if (!w.isDestroyed()) w.hide(); } catch {}
      });

      // Show countdown
      if (config.countdown > 0) {
        await this.showCountdown(config.countdown);
      }

      // Show recording border overlay
      this.showBorders(config);
      this.startInputHook(recorderWindowId, config);

      this.state = 'recording';
      this.recordingStartTime = Date.now();

      // Register F10 global shortcut
      globalShortcut.register('F10', () => {
        this.stopRecording(recorderWindowId);
      });
      globalShortcut.register('Esc', () => {
        this.stopRecording(recorderWindowId);
      });

      this.emit('state-changed', 'recording');
      return true;
    } catch (err) {
      console.error('Recorder: start failed:', err);
      this.state = 'idle';
      this.emit('state-changed', 'idle');
      return false;
    }
  }

  async stopRecording(recorderWindowId: number): Promise<void> {
    if (this.state !== 'recording') return;
    this.state = 'saving';
    this.emit('state-changed', 'saving');

    // Unregister shortcuts
    globalShortcut.unregister('F10');
    globalShortcut.unregister('Esc');

    // Remove overlays
    this.removeBorders();
    this.stopInputHook();

    // Signal recorder window to stop and send blob
    const bw = BrowserWindow.fromId(recorderWindowId);
    if (bw && !bw.isDestroyed()) {
      bw.webContents.send('recorder:end-capture');
    }
  }

  async saveRecording(buffer: Buffer, inputMimeType = 'video/webm'): Promise<string> {
    if (!this.config) return '';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const baseName = `recording-${this.config.mode}-${timestamp}`;
    const webmPath = path.join(this.config.savePath, `${baseName}.webm`);
    const mp4Path = path.join(this.config.savePath, `${baseName}.mp4`);

    fs.mkdirSync(this.config.savePath, { recursive: true });

    let filePath = mp4Path;
    if (inputMimeType.includes('video/mp4')) {
      fs.writeFileSync(mp4Path, buffer);
    } else {
      fs.writeFileSync(webmPath, buffer);
      filePath = webmPath;
      try {
        const ffmpegPath = this.findFfmpeg();
        if (ffmpegPath) {
          await this.transcodeToMp4(ffmpegPath, webmPath, mp4Path);
          filePath = mp4Path;
          try { fs.unlinkSync(webmPath); } catch {}
        } else {
          console.warn('Recorder: ffmpeg.exe not found; kept WebM recording:', webmPath);
        }
      } catch (err) {
        console.warn('Recorder: MP4 transcode failed; kept WebM recording:', String(err).split('\n')[0]);
      }
    }

    this.state = 'idle';
    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.config = null;

    this.emit('recording-saved', filePath);

    // Open save directory
    const saveDir = path.dirname(filePath);
    shell.openPath(saveDir);

    // Restore recorder window
    this.emit('state-changed', 'idle');
    return filePath;
  }

  private findFfmpeg(): string | null {
    const exeName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
    const candidates = [
      process.env.FFMPEG_PATH,
      this.getBundledFfmpegPath(),
      this.config ? path.join(this.config.savePath, exeName) : undefined,
      path.join(process.cwd(), exeName),
      path.join(app.getAppPath(), exeName),
      path.join(process.resourcesPath, exeName),
      path.join(process.resourcesPath, 'bin', exeName),
    ].filter(Boolean) as string[];

    for (const candidate of candidates) {
      try {
        if (fs.existsSync(candidate)) return candidate;
      } catch {}
    }

    const pathDirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
    for (const dir of pathDirs) {
      const candidate = path.join(dir, exeName);
      try {
        if (fs.existsSync(candidate)) return candidate;
      } catch {}
    }
    return null;
  }

  private getBundledFfmpegPath(): string | undefined {
    try {
      const ffmpeg = require('@ffmpeg-installer/ffmpeg') as { path?: string };
      return ffmpeg.path;
    } catch {
      return undefined;
    }
  }

  private transcodeToMp4(ffmpegPath: string, inputPath: string, outputPath: string): Promise<void> {
    const args = [
      '-y',
      '-i', inputPath,
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-crf', '26',
      '-pix_fmt', 'yuv420p',
      '-vsync', 'cfr',
      '-r', String(this.config?.fps || 60),
      '-movflags', '+faststart',
      '-c:a', 'aac',
      '-b:a', '160k',
      outputPath,
    ];

    return new Promise((resolve, reject) => {
      execFile(ffmpegPath, args, { windowsHide: true }, (error, _stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
          return;
        }
        resolve();
      });
    });
  }

  // --- Overlays ---
  private async showCountdown(seconds: number): Promise<void> {
    const config = this.config;
    const allBounds: Electron.Rectangle[] = [this.getTargetBounds(config!)];
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      *{margin:0;padding:0;box-sizing:border-box}
      body{background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;height:100vh;font-family:-apple-system,sans-serif}
      #num{font-size:180px;color:#fff;font-weight:700;text-shadow:0 0 60px rgba(99,102,241,0.6);transition:transform 0.3s}
    </style></head><body><div id="num">${seconds}</div>
    <script>let n=${seconds};const el=document.getElementById('num');const t=setInterval(()=>{n--;el.textContent=n;el.style.transform='scale(1.3)';setTimeout(()=>el.style.transform='scale(1)',150);if(n<=0){clearInterval(t);document.body.style.opacity='0'}},1000);setTimeout(()=>{clearInterval(t);document.body.style.opacity='0'},${seconds*1000+300});</script></body></html>`;

    for (const b of allBounds) {
      const bounds = this.normalizeOverlayBounds(b);
      const win = new BrowserWindow({
        x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
        transparent: true, frame: false, alwaysOnTop: true,
        skipTaskbar: true, resizable: false, fullscreenable: false,
        hasShadow: false, show: false,
        webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: false },
      });
      this.protectOverlayWindow(win);
      await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      this.pinOverlayWindow(win, bounds);
      win.showInactive();
      this.countdownWindows.push(win);
    }

    return new Promise((resolve) => {
      setTimeout(() => {
        for (const w of this.countdownWindows) { try { if (!w.isDestroyed()) w.close(); } catch {} }
        this.countdownWindows = [];
        resolve();
      }, seconds * 1000 + 500);
    });
  }

  private showBorders(config: RecorderConfig): void {
    const allBounds: Electron.Rectangle[] = [this.getTargetBounds(config)];

    for (const bounds of allBounds) {
      const overlayBounds = this.normalizeOverlayBounds(bounds);
      const cornerSize = 40, borderColor = '#6366f1', borderWidth = 3;
      const bw = borderWidth;
      const cs = cornerSize;
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
        *{margin:0;padding:0;box-sizing:border-box}
        body{background:transparent;width:100vw;height:100vh;position:relative;overflow:hidden}
        .border{position:absolute;background:${borderColor};box-shadow:0 0 8px rgba(99,102,241,0.5)}
        .top{top:0;left:0;right:0;height:${bw}px}.bottom{bottom:0;left:0;right:0;height:${bw}px}
        .left{left:0;top:0;bottom:0;width:${bw}px}.right{right:0;top:0;bottom:0;width:${bw}px}
        .corner{position:absolute;width:${cs}px;height:${cs}px;border-color:${borderColor};border-style:solid;box-shadow:0 0 12px rgba(99,102,241,0.4)}
        .tl{top:${bw}px;left:${bw}px;border-width:${bw+1}px 0 0 ${bw+1}px}
        .tr{top:${bw}px;right:${bw}px;border-width:${bw+1}px ${bw+1}px 0 0}
        .bl{bottom:${bw}px;left:${bw}px;border-width:0 0 ${bw+1}px ${bw+1}px}
        .br{bottom:${bw}px;right:${bw}px;border-width:0 ${bw+1}px ${bw+1}px 0}
        .timer{position:absolute;top:16px;left:50%;transform:translateX(-50%);color:#fff;font-size:14px;font-family:-apple-system,sans-serif;background:rgba(0,0,0,0.6);padding:4px 12px;border-radius:8px;backdrop-filter:blur(8px)}
      </style></head><body>
        <div class="border top"></div><div class="border bottom"></div><div class="border left"></div><div class="border right"></div>
        <div class="corner tl"></div><div class="corner tr"></div><div class="corner bl"></div><div class="corner br"></div>
        <div class="timer" id="timer">00:00</div>
        <script>let start=${Date.now()};setInterval(()=>{const s=Math.floor((Date.now()-start)/1000);document.getElementById('timer').textContent=String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0')},1000);</script></body></html>`;

      const win = new BrowserWindow({
        x: overlayBounds.x, y: overlayBounds.y,
        width: overlayBounds.width, height: overlayBounds.height,
        transparent: true, frame: false, alwaysOnTop: true,
        skipTaskbar: true, resizable: false, focusable: false,
        fullscreenable: false, hasShadow: false, show: false,
        webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: false },
      });
      this.protectOverlayWindow(win);
      void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).then(() => {
        if (win.isDestroyed()) return;
        this.pinOverlayWindow(win, overlayBounds);
        win.showInactive();
      }).catch(() => {});
      this.borderWindows.push(win);
    }
    this.startBorderKeepAlive();
  }

  private removeBorders(): void {
    if (this.borderKeepAliveTimer) {
      clearInterval(this.borderKeepAliveTimer);
      this.borderKeepAliveTimer = null;
    }
    for (const w of this.borderWindows) { try { if (!w.isDestroyed()) w.close(); } catch {} }
    this.borderWindows = [];
  }

  private startBorderKeepAlive(): void {
    if (this.borderKeepAliveTimer) {
      clearInterval(this.borderKeepAliveTimer);
    }
    this.borderKeepAliveTimer = setInterval(() => {
      for (const w of this.borderWindows) {
        try {
          if (!w.isDestroyed()) {
            w.setAlwaysOnTop(true, 'screen-saver');
            w.moveTop();
          }
        } catch {}
      }
    }, 1000);
  }

  private startInputHook(recorderWindowId: number, config: RecorderConfig): void {
    if (process.platform !== 'win32') return;
    if (!config.captureClicks && !config.captureKeystrokes) return;
    this.stopInputHook();

    const script = this.getInputHookPowerShell(config.captureClicks, config.captureKeystrokes);
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.inputHookProcess = child;
    this.inputHookBuffer = '';

    child.stdout.on('data', (chunk) => {
      this.inputHookBuffer += chunk.toString('utf8');
      let newlineIndex = this.inputHookBuffer.indexOf('\n');
      while (newlineIndex >= 0) {
        const line = this.inputHookBuffer.slice(0, newlineIndex).trim();
        this.inputHookBuffer = this.inputHookBuffer.slice(newlineIndex + 1);
        this.forwardInputHookLine(recorderWindowId, line);
        newlineIndex = this.inputHookBuffer.indexOf('\n');
      }
    });
    child.on('exit', () => {
      if (this.inputHookProcess === child) this.inputHookProcess = null;
    });
  }

  private forwardInputHookLine(recorderWindowId: number, line: string): void {
    if (!line) return;
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      if (typeof event.x === 'number' && typeof event.y === 'number') {
        const rect = screen.screenToDipRect(null, { x: event.x, y: event.y, width: 1, height: 1 });
        event.x = Math.round(rect.x);
        event.y = Math.round(rect.y);
      }
      const bw = BrowserWindow.fromId(recorderWindowId);
      if (bw && !bw.isDestroyed()) {
        bw.webContents.send('recorder:input-event', event);
      }
    } catch {}
  }

  private stopInputHook(): void {
    if (!this.inputHookProcess) return;
    try { this.inputHookProcess.kill(); } catch {}
    this.inputHookProcess = null;
    this.inputHookBuffer = '';
  }

  private getInputHookPowerShell(captureClicks: boolean, captureKeystrokes: boolean): string {
    const mouseEnabled = captureClicks ? 'true' : 'false';
    const keyboardEnabled = captureKeystrokes ? 'true' : 'false';
    return `
Add-Type @"
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;

public class VibeKitInputHook {
  private const int WH_KEYBOARD_LL = 13;
  private const int WH_MOUSE_LL = 14;
  private const int WM_KEYDOWN = 0x0100;
  private const int WM_SYSKEYDOWN = 0x0104;
  private const int WM_LBUTTONDOWN = 0x0201;
  private const int WM_RBUTTONDOWN = 0x0204;
  private const int WM_MBUTTONDOWN = 0x0207;

  private static LowLevelKeyboardProc keyboardProc = KeyboardCallback;
  private static LowLevelMouseProc mouseProc = MouseCallback;
  private static IntPtr keyboardHook = IntPtr.Zero;
  private static IntPtr mouseHook = IntPtr.Zero;
  private static bool mouseEnabled = false;
  private static bool keyboardEnabled = false;

  [StructLayout(LayoutKind.Sequential)]
  private struct POINT { public int x; public int y; }

  [StructLayout(LayoutKind.Sequential)]
  private struct MSLLHOOKSTRUCT {
    public POINT pt;
    public uint mouseData;
    public uint flags;
    public uint time;
    public IntPtr dwExtraInfo;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct KBDLLHOOKSTRUCT {
    public uint vkCode;
    public uint scanCode;
    public uint flags;
    public uint time;
    public IntPtr dwExtraInfo;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct MSG {
    public IntPtr hwnd;
    public uint message;
    public UIntPtr wParam;
    public IntPtr lParam;
    public uint time;
    public POINT pt;
  }

  private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);
  private delegate IntPtr LowLevelMouseProc(int nCode, IntPtr wParam, IntPtr lParam);

  [DllImport("user32.dll", SetLastError = true)]
  private static extern IntPtr SetWindowsHookEx(int idHook, Delegate lpfn, IntPtr hMod, uint dwThreadId);

  [DllImport("user32.dll", SetLastError = true)]
  private static extern bool UnhookWindowsHookEx(IntPtr hhk);

  [DllImport("user32.dll")]
  private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

  [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
  private static extern IntPtr GetModuleHandle(string lpModuleName);

  [DllImport("user32.dll")]
  private static extern sbyte GetMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);

  public static void Run(bool enableMouse, bool enableKeyboard) {
    mouseEnabled = enableMouse;
    keyboardEnabled = enableKeyboard;
    IntPtr module = GetModuleHandle(Process.GetCurrentProcess().MainModule.ModuleName);
    if (mouseEnabled) mouseHook = SetWindowsHookEx(WH_MOUSE_LL, mouseProc, module, 0);
    if (keyboardEnabled) keyboardHook = SetWindowsHookEx(WH_KEYBOARD_LL, keyboardProc, module, 0);
    try {
      MSG msg;
      while (GetMessage(out msg, IntPtr.Zero, 0, 0) != 0) {}
    } finally {
      if (mouseHook != IntPtr.Zero) UnhookWindowsHookEx(mouseHook);
      if (keyboardHook != IntPtr.Zero) UnhookWindowsHookEx(keyboardHook);
    }
  }

  private static IntPtr MouseCallback(int nCode, IntPtr wParam, IntPtr lParam) {
    if (nCode >= 0 && mouseEnabled) {
      int message = wParam.ToInt32();
      if (message == WM_LBUTTONDOWN || message == WM_RBUTTONDOWN || message == WM_MBUTTONDOWN) {
        MSLLHOOKSTRUCT data = (MSLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(MSLLHOOKSTRUCT));
        string button = message == WM_RBUTTONDOWN ? "right" : (message == WM_MBUTTONDOWN ? "middle" : "left");
        Console.WriteLine("{\\"type\\":\\"mouseDown\\",\\"x\\":" + data.pt.x + ",\\"y\\":" + data.pt.y + ",\\"button\\":\\"" + button + "\\"}");
        Console.Out.Flush();
      }
    }
    return CallNextHookEx(mouseHook, nCode, wParam, lParam);
  }

  private static IntPtr KeyboardCallback(int nCode, IntPtr wParam, IntPtr lParam) {
    if (nCode >= 0 && keyboardEnabled) {
      int message = wParam.ToInt32();
      if (message == WM_KEYDOWN || message == WM_SYSKEYDOWN) {
        KBDLLHOOKSTRUCT data = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
        Console.WriteLine("{\\"type\\":\\"keyDown\\",\\"vk\\":" + data.vkCode + "}");
        Console.Out.Flush();
      }
    }
    return CallNextHookEx(keyboardHook, nCode, wParam, lParam);
  }
}
"@
[VibeKitInputHook]::Run(${mouseEnabled}, ${keyboardEnabled})
`;
  }

  // New region picker: gray mask + clear selection + inline controls
  // All coordinates are window-relative (clientX/clientY), offset added by pickRegion()
  getRegionPickerHTMLWithOptions(opts: {audioSystem:boolean;audioMic:boolean;captureCursor:boolean;captureClicks:boolean;captureKeystrokes:boolean}): string {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      *{margin:0;padding:0;box-sizing:border-box;font-family:-apple-system,sans-serif}
      body{background:transparent;width:100vw;height:100vh;overflow:hidden;cursor:crosshair}
      canvas{position:fixed;top:0;left:0;z-index:1;pointer-events:none}
      #controls{position:fixed;z-index:10;display:none}
      #controls .row{display:flex;gap:8px;background:rgba(0,0,0,0.78);border-radius:8px;padding:8px 12px;backdrop-filter:blur(10px)}
      #controls .row label{font-size:11px;color:#ccc;display:flex;align-items:center;gap:4px;cursor:pointer}
      #controls .row input[type=checkbox]{width:14px;height:14px;accent-color:#6366f1}
      #startBtn{position:fixed;z-index:20;display:none;background:#6366f1;color:#fff;border:none;padding:10px 28px;border-radius:8px;font-size:14px;cursor:pointer;box-shadow:0 4px 20px rgba(0,0,0,0.5)}
      #startBtn:hover{opacity:0.9}
      #sizeLabel{position:fixed;z-index:5;display:none;color:#fff;font-size:12px;background:rgba(0,0,0,0.6);padding:3px 8px;border-radius:4px;pointer-events:none}
    </style></head><body>
    <canvas id="mask"></canvas>
    <div id="controls"><div class="row">
      <label><input type="checkbox" id="optAudio" ${opts.audioSystem?'checked':''}> 系统音频</label>
      <label><input type="checkbox" id="optMic" ${opts.audioMic?'checked':''}> Mic</label>
      <label><input type="checkbox" id="optCursor" ${opts.captureCursor?'checked':''}> 鼠标</label>
      <label><input type="checkbox" id="optClicks" ${opts.captureClicks?'checked':''}> 点击</label>
      <label><input type="checkbox" id="optKeys" ${opts.captureKeystrokes?'checked':''}> 按键</label>
    </div></div>
    <div id="sizeLabel"></div>
    <button id="startBtn">开始录制</button>
    <script>
      var canvas=document.getElementById('mask'),ctx=canvas.getContext('2d');
      var ctrl=document.getElementById('controls'),btn=document.getElementById('startBtn'),sLbl=document.getElementById('sizeLabel');
      var startX,startY,isDrawing=false;
      var sel={x:0,y:0,width:0,height:0};
      var ox=window.__DISPLAY_OFFSET__?window.__DISPLAY_OFFSET__.x:0;
      var oy=window.__DISPLAY_OFFSET__?window.__DISPLAY_OFFSET__.y:0;
      function resize(){canvas.width=window.innerWidth;canvas.height=window.innerHeight;draw()}
      resize();window.addEventListener('resize',resize);
      function draw(){
        ctx.clearRect(0,0,canvas.width,canvas.height);
        ctx.fillStyle='rgba(0,0,0,0.45)';ctx.fillRect(0,0,canvas.width,canvas.height);
        if(sel.width>0&&sel.height>0){
          ctx.clearRect(sel.x,sel.y,sel.width,sel.height);
          ctx.strokeStyle='#6366f1';ctx.lineWidth=2;ctx.setLineDash([6,3]);
          ctx.strokeRect(sel.x+1,sel.y+1,sel.width-2,sel.height-2);
          ctx.setLineDash([]);
        }
      }
      function clampBtn(){
        var bw=110,bh=36,pad=8;
        var l=sel.x+sel.width-bw,t=sel.y+sel.height+pad;
        l=Math.max(pad,Math.min(l,window.innerWidth-bw-pad));
        t=Math.max(pad,Math.min(t,window.innerHeight-bh-pad));
        btn.style.left=l+'px';btn.style.top=t+'px';
        ctrl.style.left=Math.max(pad,sel.x)+'px';
        ctrl.style.top=Math.max(pad,sel.y+sel.height+pad+44)+'px';
        if(sel.y+sel.height+pad+100>window.innerHeight)ctrl.style.top=Math.max(pad,sel.y-100)+'px';
      }
      function sendResult(){
        var r={
          x:Math.round(ox+sel.x),y:Math.round(oy+sel.y),
          width:Math.round(sel.width),height:Math.round(sel.height),
          audioSystem:document.getElementById('optAudio').checked,
          audioMic:document.getElementById('optMic').checked,
          captureCursor:document.getElementById('optCursor').checked,
          captureClicks:document.getElementById('optClicks').checked,
          captureKeystrokes:document.getElementById('optKeys').checked
        };
        require('electron').ipcRenderer.send('region-selected',r);
      }
      function isControlTarget(e){
        return !!(e.target&&e.target.closest&&e.target.closest('#controls,#startBtn'));
      }
      function stopControlEvent(e){
        e.stopPropagation();
      }
      document.body.addEventListener('mousedown',function(e){
        if(isControlTarget(e))return;
        isDrawing=true;startX=e.clientX;startY=e.clientY;
        sel={x:startX,y:startY,width:0,height:0};
        btn.style.display='none';ctrl.style.display='none';sLbl.style.display='none';
        draw();
      });
      document.body.addEventListener('mousemove',function(e){
        if(!isDrawing)return;
        var w=e.clientX-startX,h=e.clientY-startY;
        sel.x=w<0?e.clientX:startX;sel.y=h<0?e.clientY:startY;
        sel.width=Math.abs(w);sel.height=Math.abs(h);
        sLbl.textContent=sel.width+' x '+sel.height;
        sLbl.style.left=(sel.x+4)+'px';sLbl.style.top=(sel.y+sel.height+4)+'px';
        sLbl.style.display='block';draw();
      });
      document.body.addEventListener('mouseup',function(e){
        if(isControlTarget(e))return;
        if(!isDrawing)return;isDrawing=false;
        if(sel.width<20||sel.height<20){sel={x:0,y:0,width:0,height:0};draw();return}
        clampBtn();btn.style.display='block';ctrl.style.display='block';draw();
      });
      document.body.addEventListener('keydown',function(e){
        if(e.key==='Escape'){require('electron').ipcRenderer.send('region-selected',null)}
      });
      ['pointerdown','mousedown','mouseup','click'].forEach(function(type){
        ctrl.addEventListener(type,stopControlEvent);
        btn.addEventListener(type,stopControlEvent);
      });
      btn.addEventListener('click',function(e){
        e.stopPropagation();e.preventDefault();
        if(sel.width>=20&&sel.height>=20)sendResult();
      });
    </script></body></html>`;
  }

  // Clean up any residual overlays
  cleanup(): void {
    this.removeBorders();
    this.stopInputHook();
    for (const w of this.countdownWindows) { try { if (!w.isDestroyed()) w.close(); } catch {} }
    this.countdownWindows = [];
    globalShortcut.unregister('F10');
    globalShortcut.unregister('Esc');
  }

  // --- Cursor/Click/Keystroke recording ---
  // These are handled in the renderer side via canvas overlay during recording
  // The borderWindow webContents can track cursor position and key events
}
