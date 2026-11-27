import { ipcMain, shell, clipboard, BrowserWindow, Notification, dialog, screen, nativeTheme, type IpcMainInvokeEvent } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import AdmZip from 'adm-zip';
import { IPC } from '@shared/constants';
import { AUTOMATION_PLUGIN_ID, EVERY_COMPARE_PLUGIN_ID, NETWORK_TOOLS_PLUGIN_ID, POMODORO_PLUGIN_ID, SCREEN_TIME_PLUGIN_ID, SEARCH_MASTER_PLUGIN_ID } from '@shared';
import type { ScreenTimeService } from '../services/ScreenTimeService';
import type { FileSelectOptions, PermissionType, ThemeVars } from '@shared';
import { getPluginsDir } from '../utils/paths';
import type { WindowManager } from '../windows/WindowManager';
import type { PluginManager } from '../services/PluginManager';
import type { ConfigService } from '../services/ConfigService';
import type { HotkeyService } from '../services/HotkeyService';
import type { DataService } from '../services/DataService';
import type { ClipboardService } from '../services/ClipboardService';
import type { PermissionsService } from '../services/PermissionsService';
import type { EventRouter } from '../services/EventRouter';
import type { LanTransferService } from '../services/LanTransferService';
import type { AiWebService } from '../services/AiWebService';
import type { VoiceService } from '../services/VoiceService';
import type { InvoiceService, InvoiceProgressCallback } from '../services/InvoiceService';
import type { RecorderService } from '../services/RecorderService';
import type { PomodoroService } from '../services/PomodoroService';
import type { NetToolsService } from '../services/NetToolsService';
import type { SearchMasterService } from '../services/SearchMasterService';
import type { CompareService } from '../services/CompareService';
import type { AutomationService } from '../services/AutomationService';

const RECORDER_PLUGIN_ID = 'local.screen-recorder';
const RECORDER_SETTINGS_KEY = 'settings';

interface RecorderSettings {
  savePath: string;
  resolution: string;
  fps: number;
  videoBitrate: number;
  countdown: number;
  audioSystem: boolean;
  audioMic: boolean;
  captureCursor: boolean;
  captureClicks: boolean;
  captureKeystrokes: boolean;
}

const DEFAULT_RECORDER_SETTINGS: RecorderSettings = {
  savePath: '',
  resolution: '2k60',
  fps: 60,
  videoBitrate: 8000000,
  countdown: 3,
  audioSystem: true,
  audioMic: false,
  captureCursor: true,
  captureClicks: true,
  captureKeystrokes: true,
};

function normalizeRecorderSettings(value: unknown): RecorderSettings {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    savePath: typeof raw.savePath === 'string' ? raw.savePath : DEFAULT_RECORDER_SETTINGS.savePath,
    resolution: typeof raw.resolution === 'string' ? raw.resolution : DEFAULT_RECORDER_SETTINGS.resolution,
    fps: typeof raw.fps === 'number' ? raw.fps : DEFAULT_RECORDER_SETTINGS.fps,
    videoBitrate: typeof raw.videoBitrate === 'number' ? raw.videoBitrate : DEFAULT_RECORDER_SETTINGS.videoBitrate,
    countdown: typeof raw.countdown === 'number' ? raw.countdown : DEFAULT_RECORDER_SETTINGS.countdown,
    audioSystem: typeof raw.audioSystem === 'boolean' ? raw.audioSystem : DEFAULT_RECORDER_SETTINGS.audioSystem,
    audioMic: typeof raw.audioMic === 'boolean' ? raw.audioMic : DEFAULT_RECORDER_SETTINGS.audioMic,
    captureCursor: typeof raw.captureCursor === 'boolean' ? raw.captureCursor : DEFAULT_RECORDER_SETTINGS.captureCursor,
    captureClicks: typeof raw.captureClicks === 'boolean' ? raw.captureClicks : DEFAULT_RECORDER_SETTINGS.captureClicks,
    captureKeystrokes: typeof raw.captureKeystrokes === 'boolean' ? raw.captureKeystrokes : DEFAULT_RECORDER_SETTINGS.captureKeystrokes,
  };
}

interface IpcDependencies {
  windowManager: WindowManager;
  pluginManager: PluginManager;
  configService: ConfigService;
  hotkeyService: HotkeyService;
  dataService: DataService;
  clipboardService: ClipboardService;
  permissionsService: PermissionsService;
  eventRouter: EventRouter;
  lanService: LanTransferService;
  aiWebService: AiWebService;
  voiceService: VoiceService;
  invoiceService: InvoiceService;
  recorderService?: RecorderService;
  pomodoroService: PomodoroService;
  netToolsService: NetToolsService;
  searchMasterService: SearchMasterService;
  compareService: CompareService;
  automationService: AutomationService;
  screenTimeService: ScreenTimeService;
}

export function registerIpcHandlers(deps: IpcDependencies): void {
  const {
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
    screenTimeService,
  } = deps;
  const assertPluginPermission = (event: IpcMainInvokeEvent, permission: PermissionType): string => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const pluginId = win ? windowManager.getPluginIdForWindow(win.id) : undefined;
    if (!pluginId) throw new Error('未找到插件窗口');
    permissionsService.assert(pluginId, permission);
    return pluginId;
  };
  const assertLan = (event: IpcMainInvokeEvent): string => assertPluginPermission(event, 'lan');
  const assertAiWeb = (event: IpcMainInvokeEvent): string => assertPluginPermission(event, 'network');
  const assertPomodoro = (event: IpcMainInvokeEvent): void => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const pluginId = win ? windowManager.getPluginIdForWindow(win.id) : undefined;
    if (pluginId !== POMODORO_PLUGIN_ID) throw new Error('该接口仅供番茄钟插件使用');
  };
  const assertScreenTime = (event: IpcMainInvokeEvent): void => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const pluginId = win ? windowManager.getPluginIdForWindow(win.id) : undefined;
    if (pluginId !== SCREEN_TIME_PLUGIN_ID) throw new Error('该接口仅供屏幕足迹插件使用');
  };
  const assertNetTools = (event: IpcMainInvokeEvent): void => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const pluginId = win ? windowManager.getPluginIdForWindow(win.id) : undefined;
    if (pluginId !== NETWORK_TOOLS_PLUGIN_ID) throw new Error('该接口仅供网络工具箱插件使用');
    permissionsService.assert(pluginId, 'network');
  };
  const assertSearchMaster = (event: IpcMainInvokeEvent): void => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const pluginId = win ? windowManager.getPluginIdForWindow(win.id) : undefined;
    if (pluginId !== SEARCH_MASTER_PLUGIN_ID) throw new Error('该接口仅供搜索大师插件使用');
    permissionsService.assert(pluginId, 'file-read');
  };
  const assertEveryCompare = (event: IpcMainInvokeEvent): void => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const pluginId = win ? windowManager.getPluginIdForWindow(win.id) : undefined;
    if (pluginId !== EVERY_COMPARE_PLUGIN_ID) throw new Error('该接口仅供 everyCompare 插件使用');
    permissionsService.assert(pluginId, 'file-read');
  };
  const assertAutomation = (event: IpcMainInvokeEvent, allowCore = false): void => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) throw new Error('未找到窗口');
    const pluginId = windowManager.getPluginIdForWindow(win.id);
    if (pluginId === AUTOMATION_PLUGIN_ID) return;
    if (!pluginId && allowCore) return;
    throw new Error('该接口仅供自动化助手使用');
  };
  // --- Plugin handlers ---
  ipcMain.handle(IPC.PLUGIN_LIST, () => pluginManager.getAllPlugins());
  ipcMain.handle(IPC.PLUGIN_ENABLE, (_e, id: string) => pluginManager.enablePlugin(id));
  ipcMain.handle(IPC.PLUGIN_DISABLE, (_e, id: string) => pluginManager.disablePlugin(id));
  ipcMain.handle(IPC.PLUGIN_UNINSTALL, (_e, id: string) => pluginManager.uninstallPlugin(id));

  // Import plugin from .zip
  ipcMain.handle('plugin:import', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options = {
      filters: [{ name: '插件包', extensions: ['zip'] }],
      properties: ['openFile' as const],
    };
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths.length) return { success: false };
    const zipPath = result.filePaths[0];
    try {
      const zip = new AdmZip(zipPath);
      const entries = zip.getEntries();
      // Find plugin.json to get pluginId
      let pluginJsonEntry = entries.find(e => e.entryName.endsWith('plugin.json') && !e.entryName.includes('__MACOSX'));
      if (!pluginJsonEntry) return { success: false, error: '未找到 plugin.json' };
      const manifest = JSON.parse(pluginJsonEntry.getData().toString('utf-8'));
      const pluginId = manifest.id;
      if (!pluginId) return { success: false, error: 'plugin.json 缺少 id' };
      // Extract to plugins dir
      const pluginsDir = getPluginsDir();
      const destDir = path.join(pluginsDir, pluginId);
      if (fs.existsSync(destDir)) {
        // Overwrite: remove old then extract
        fs.rmSync(destDir, { recursive: true, force: true });
      }
      zip.extractAllTo(destDir, true);
      // Re-scan plugins
      await pluginManager.scanPlugins();
      return { success: true, pluginId };
    } catch (err) {
      console.error('Import plugin error:', err);
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle(IPC.PLUGIN_DATA_READ, (_e, pluginId: string, key: string) => {
    return dataService.get(pluginId, key);
  });
  ipcMain.handle(IPC.PLUGIN_DATA_WRITE, (_e, pluginId: string, key: string, value: unknown) => {
    dataService.set(pluginId, key, value);
    return true;
  });
  ipcMain.handle(IPC.PLUGIN_DATA_DELETE, (_e, pluginId: string, key: string) => {
    dataService.delete(pluginId, key);
    return true;
  });

  ipcMain.handle(IPC.PLUGIN_PERMISSIONS_GET, (_e, pluginId: string) => {
    const permissions = configService.getPluginPermissions();
    return permissions[pluginId] || {};
  });

  // --- LAN transfer handlers ---
  ipcMain.handle(IPC.LAN_ENABLE, async (event) => {
    assertLan(event);
    return lanService.enable();
  });
  ipcMain.handle(IPC.LAN_DISABLE, (event) => {
    assertLan(event);
    lanService.disable();
    return true;
  });
  ipcMain.handle(IPC.LAN_GET_DEVICES, (event) => {
    assertLan(event);
    return lanService.getDevices();
  });
  ipcMain.handle(IPC.LAN_GET_CONFIG, (event) => {
    assertLan(event);
    return lanService.getConfig();
  });
  ipcMain.handle(IPC.LAN_SET_CONFIG, (event, patch: Parameters<LanTransferService['setConfig']>[0]) => {
    assertLan(event);
    return lanService.setConfig(patch);
  });
  ipcMain.handle(IPC.LAN_PICK_PATHS, async (event, mode: 'files' | 'folders') => {
    assertLan(event);
    return lanService.pickPaths(mode);
  });
  ipcMain.handle(IPC.LAN_SEND, (event, deviceId: string, paths: string[]) => {
    assertLan(event);
    return lanService.send(deviceId, paths);
  });
  ipcMain.handle(IPC.LAN_CANCEL, (event, transferId: string) => {
    assertLan(event);
    lanService.cancel(transferId);
    return true;
  });

  // --- AI web quick-open handlers ---
  ipcMain.handle(IPC.AIWEB_GET_SITES, (event) => {
    assertAiWeb(event);
    return aiWebService.getSites();
  });
  ipcMain.handle(IPC.AIWEB_SET_SITES, (event, sites: Parameters<AiWebService['setSites']>[0]) => {
    assertAiWeb(event);
    return aiWebService.setSites(sites);
  });
  ipcMain.handle(IPC.AIWEB_OPEN, (event, siteId?: string) => {
    assertAiWeb(event);
    aiWebService.open(siteId);
  });
  ipcMain.handle(IPC.AIWEB_TOGGLE, (event, siteId?: string) => {
    assertAiWeb(event);
    aiWebService.toggle(siteId);
  });
  ipcMain.handle(IPC.AIWEB_GET_STATE, (event) => {
    assertAiWeb(event);
    return aiWebService.getState();
  });
  ipcMain.handle(IPC.AIWEB_SET_DEFAULT, (event, siteId: string | null) => {
    assertAiWeb(event);
    return aiWebService.setDefaultSite(siteId);
  });

  // --- Pomodoro handlers (only the pomodoro plugin window may call these) ---
  ipcMain.handle(IPC.POMODORO_GET_STATE, (event) => {
    assertPomodoro(event);
    return pomodoroService.getState();
  });
  ipcMain.handle(IPC.POMODORO_SET_SETTINGS, (event, patch: unknown) => {
    assertPomodoro(event);
    return pomodoroService.setSettings(patch);
  });
  ipcMain.handle(IPC.POMODORO_TIMER_ACTION, (event, action: Parameters<PomodoroService['timerAction']>[0], label?: unknown) => {
    assertPomodoro(event);
    return pomodoroService.timerAction(action, label);
  });
  ipcMain.handle(IPC.POMODORO_LOG_WATER, (event, amountMl: unknown) => {
    assertPomodoro(event);
    return pomodoroService.logWater(amountMl);
  });
  ipcMain.handle(IPC.POMODORO_UNDO_WATER, (event, amountMl: unknown) => {
    assertPomodoro(event);
    return pomodoroService.undoWater(amountMl);
  });
  ipcMain.handle(IPC.POMODORO_LOG_STAND, (event) => {
    assertPomodoro(event);
    return pomodoroService.logStand();
  });
  ipcMain.handle(IPC.POMODORO_CUSTOM_SAVE, (event, reminder: unknown) => {
    assertPomodoro(event);
    return pomodoroService.saveCustomReminder(reminder);
  });
  ipcMain.handle(IPC.POMODORO_CUSTOM_DELETE, (event, id: unknown) => {
    assertPomodoro(event);
    return pomodoroService.deleteCustomReminder(id);
  });
  ipcMain.handle(IPC.POMODORO_REPORT, (event, days?: unknown) => {
    assertPomodoro(event);
    return pomodoroService.getReport(days);
  });
  ipcMain.handle(IPC.POMODORO_TEST_FIRE, (event, kind: unknown) => {
    assertPomodoro(event);
    return pomodoroService.testFire(kind);
  });
  ipcMain.handle(IPC.POMODORO_TEST_NOTIFICATION, (event) => {
    assertPomodoro(event);
    return pomodoroService.testNotification();
  });
  ipcMain.handle(IPC.POMODORO_OPEN_NOTIFICATION_SETTINGS, (event) => {
    assertPomodoro(event);
    return shell.openExternal('ms-settings:notifications');
  });

  // Notification-HUD action buttons (fire-and-forget, no permission needed).
  ipcMain.on(IPC.WINDOW_HUD_ACTION, (_event, actionId: unknown) => {
    if (typeof actionId === 'string' && actionId) {
      windowManager.emitHudAction(actionId);
    }
  });

  // --- Screen time (屏幕足迹) handlers ---
  ipcMain.handle(IPC.SCREEN_TIME_GET_STATE, (event) => {
    assertScreenTime(event);
    return screenTimeService.getState();
  });
  ipcMain.handle(IPC.SCREEN_TIME_REPORT, (event, days?: unknown) => {
    assertScreenTime(event);
    return screenTimeService.getReport(typeof days === 'number' ? days : undefined);
  });
  ipcMain.handle(IPC.SCREEN_TIME_SET_SETTINGS, (event, patch: Parameters<ScreenTimeService['setSettings']>[0]) => {
    assertScreenTime(event);
    return screenTimeService.setSettings(patch);
  });

  // --- Network tools handlers ---
  ipcMain.handle(IPC.NET_PING, (event, host: unknown, count: unknown, timeoutMs: unknown) => {
    assertNetTools(event);
    return netToolsService.ping(host, count, timeoutMs);
  });
  ipcMain.handle(IPC.NET_TCP_CHECK, (event, host: unknown, port: unknown, timeoutMs: unknown) => {
    assertNetTools(event);
    return netToolsService.tcpCheck(host, port, timeoutMs);
  });
  ipcMain.handle(IPC.NET_DNS, (event, host: unknown, type: unknown) => {
    assertNetTools(event);
    return netToolsService.dnsLookup(host, type);
  });
  ipcMain.handle(IPC.NET_HTTP_CHECK, (event, url: unknown, method: unknown) => {
    assertNetTools(event);
    return netToolsService.httpCheck(url, method);
  });
  ipcMain.handle(IPC.NET_SPEED_TEST, (event) => {
    assertNetTools(event);
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) throw new Error('未找到测试窗口');
    return netToolsService.speedTest(win.id);
  });
  ipcMain.handle(IPC.NET_SPEED_CANCEL, (event) => {
    assertNetTools(event);
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) netToolsService.cancelSpeedTest(win.id);
  });
  ipcMain.handle(IPC.NET_INFO, (event, force: unknown) => {
    assertNetTools(event);
    return netToolsService.info(force === true);
  });

  // --- Search Master handlers ---
  ipcMain.handle(IPC.SEARCHMASTER_STATUS, (event) => {
    assertSearchMaster(event);
    return searchMasterService.status();
  });
  ipcMain.handle(IPC.SEARCHMASTER_QUERY, (event, params: unknown) => {
    assertSearchMaster(event);
    return searchMasterService.query(params);
  });
  ipcMain.handle(IPC.SEARCHMASTER_PREVIEW, (event, pathValue: unknown) => {
    assertSearchMaster(event);
    return searchMasterService.preview(pathValue);
  });
  ipcMain.handle(IPC.SEARCHMASTER_REVEAL, (event, pathValue: unknown) => {
    assertSearchMaster(event);
    if (typeof pathValue !== 'string' || !pathValue.trim()) throw new Error('文件路径无效');
    shell.showItemInFolder(pathValue);
    return true;
  });

  // --- everyCompare handlers ---
  ipcMain.handle(IPC.COMPARE_READ_TEXT, (event, pathValue: unknown) => {
    assertEveryCompare(event);
    return compareService.readText(pathValue);
  });
  ipcMain.handle(IPC.COMPARE_READ_IMAGE, (event, pathValue: unknown) => {
    assertEveryCompare(event);
    return compareService.readImage(pathValue);
  });
  ipcMain.handle(IPC.COMPARE_INSPECT, (event, leftPath: unknown, rightPath: unknown) => {
    assertEveryCompare(event);
    return compareService.inspect(leftPath, rightPath);
  });
  ipcMain.handle(IPC.COMPARE_DIRS, (event, leftPath: unknown, rightPath: unknown, options: unknown) => {
    assertEveryCompare(event);
    return compareService.compareDirs(leftPath, rightPath, options);
  });

  // --- Automation assistant handlers ---
  ipcMain.handle(IPC.AUTOMATION_LIST, (event) => {
    assertAutomation(event);
    return automationService.list();
  });
  ipcMain.handle(IPC.AUTOMATION_SAVE, (event, command: unknown) => {
    assertAutomation(event);
    return automationService.saveCommand(command as Parameters<AutomationService['saveCommand']>[0]);
  });
  ipcMain.handle(IPC.AUTOMATION_DELETE, (event, id: unknown) => {
    assertAutomation(event);
    if (typeof id !== 'string') throw new Error('命令 ID 无效');
    automationService.deleteCommand(id);
  });
  ipcMain.handle(IPC.AUTOMATION_SET_ENABLED, (event, id: unknown, enabled: unknown) => {
    assertAutomation(event);
    if (typeof id !== 'string') throw new Error('命令 ID 无效');
    return automationService.setEnabled(id, enabled === true);
  });
  ipcMain.handle(IPC.AUTOMATION_GET_SETTINGS, (event) => {
    assertAutomation(event);
    return automationService.getSettings();
  });
  ipcMain.handle(IPC.AUTOMATION_SET_SETTINGS, (event, patch: unknown) => {
    assertAutomation(event);
    return automationService.setSettings(patch as Parameters<AutomationService['setSettings']>[0]);
  });
  ipcMain.handle(IPC.AUTOMATION_RUN, (event, commandId: unknown, args: unknown) => {
    assertAutomation(event);
    if (typeof commandId !== 'string') throw new Error('命令 ID 无效');
    return automationService.runAndWait(commandId, typeof args === 'string' ? args : '');
  });
  ipcMain.handle(IPC.AUTOMATION_HISTORY, (event) => {
    assertAutomation(event);
    return automationService.getHistory();
  });
  ipcMain.handle(IPC.AUTOMATION_CLEAR_HISTORY, (event) => {
    assertAutomation(event);
    automationService.clearHistory();
  });
  ipcMain.handle(IPC.AUTOMATION_LIST_ENABLED, (event) => {
    assertAutomation(event, true);
    return automationService.listEnabled();
  });
  ipcMain.handle(IPC.AUTOMATION_START_SEARCH, (event, commandId: unknown, args: unknown) => {
    assertAutomation(event, true);
    if (typeof commandId !== 'string') throw new Error('命令 ID 无效');
    const run = automationService.start(
      commandId,
      typeof args === 'string' ? args : '',
      'search',
      true,
    );
    return { runId: run.id };
  });
  ipcMain.handle(IPC.AUTOMATION_GET_RUN, (event, runId: unknown) => {
    assertAutomation(event, true);
    if (typeof runId !== 'string') return null;
    return automationService.getRun(runId);
  });

  // --- Phone voice typing handlers ---
  ipcMain.handle(IPC.VOICE_GET_CONFIG, (event) => {
    assertPluginPermission(event, 'network');
    return voiceService.getConfig();
  });
  ipcMain.handle(IPC.VOICE_SET_CONFIG, (event, patch: Parameters<VoiceService['setConfig']>[0]) => {
    assertPluginPermission(event, 'network');
    return voiceService.setConfig(patch);
  });
  ipcMain.handle(IPC.VOICE_START_SESSION, async (event) => {
    assertPluginPermission(event, 'network');
    assertPluginPermission(event, 'input');
    return voiceService.startSession();
  });
  ipcMain.handle(IPC.VOICE_STOP_SESSION, (event) => {
    assertPluginPermission(event, 'network');
    voiceService.stopSession();
    return true;
  });
  ipcMain.handle(IPC.VOICE_GET_STATUS, (event) => {
    assertPluginPermission(event, 'network');
    return voiceService.getStatus();
  });
  ipcMain.handle(IPC.VOICE_GET_SESSION, (event) => {
    assertPluginPermission(event, 'network');
    return voiceService.getSession();
  });

  // --- Invoice reimbursement organizer handlers ---
  // Progress is pushed to the owning plugin window via EventRouter so the
  // iframe can render a live progress bar (window.vibekit.events.onProgress).
  const invoiceProgressEmit = (event: IpcMainInvokeEvent): InvoiceProgressCallback | undefined => {
    const windowId = BrowserWindow.fromWebContents(event.sender)?.id;
    if (windowId == null) return undefined;
    return (progress) => eventRouter.emit('vibekit:invoiceProgress', progress, { windowId });
  };
  ipcMain.handle(IPC.INVOICE_PREVIEW, async (event, folder: string, config: Parameters<InvoiceService['preview']>[1]) => {
    assertPluginPermission(event, 'file-read');
    return invoiceService.preview(folder, config, invoiceProgressEmit(event));
  });
  ipcMain.handle(IPC.INVOICE_GENERATE, async (event, folder: string, config: Parameters<InvoiceService['generate']>[1]) => {
    assertPluginPermission(event, 'file-write');
    return invoiceService.generate(folder, config, invoiceProgressEmit(event));
  });
  ipcMain.handle(IPC.INVOICE_RENAME, async (event, folder: string, config: Parameters<InvoiceService['rename']>[1]) => {
    assertPluginPermission(event, 'file-write');
    return invoiceService.rename(folder, config, invoiceProgressEmit(event));
  });
  ipcMain.handle(IPC.INVOICE_INDEX_SCAN, async (event, parentFolder: string, options?: { maxFiles?: number }) => {
    assertPluginPermission(event, 'file-read');
    return invoiceService.scanTree(parentFolder, { ...options, onProgress: invoiceProgressEmit(event) });
  });
  ipcMain.handle(IPC.INVOICE_INDEX_STATUS, (_event) => invoiceService.indexStatus());
  ipcMain.handle(IPC.INVOICE_INDEX_CLEAR, (event) => {
    assertPluginPermission(event, 'file-write');
    invoiceService.clearIndex();
    return true;
  });

  // --- Window handlers ---
  ipcMain.handle(IPC.WINDOW_SEARCH_SHOW, () => windowManager.showSearch());
  ipcMain.handle(IPC.WINDOW_SEARCH_HIDE, () => windowManager.hideSearch());
  ipcMain.handle(IPC.WINDOW_SEARCH_TOGGLE, () => windowManager.toggleSearch());
  ipcMain.handle(IPC.WINDOW_MINI_CREATE, (_e, pluginId: string) => {
    const meta = pluginManager.getPlugin(pluginId);
    return windowManager.createMiniToolWindow(pluginId, meta?.windowWidth, meta?.windowHeight);
  });
  ipcMain.handle(IPC.WINDOW_MINI_CLOSE, (_e, windowId: number) => windowManager.closeMiniTool(windowId));
  ipcMain.handle(IPC.WINDOW_CLOSE_CURRENT, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) win.close();
  });

  // Manual window dragging: the renderer starts/ends the gesture, the main
  // process follows the cursor. Works regardless of -webkit-app-region and
  // lets any window (plugin iframe included) be moved from its top strip.
  const dragTimers = new Map<number, ReturnType<typeof setInterval>>();
  const stopWindowDrag = (winId: number) => {
    const timer = dragTimers.get(winId);
    if (timer) {
      clearInterval(timer);
      dragTimers.delete(winId);
    }
  };
  ipcMain.on(IPC.WINDOW_DRAG_START, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return;
    stopWindowDrag(win.id);
    const [wx, wy] = win.getPosition();
    const cursor = screen.getCursorScreenPoint();
    const offsetX = wx - cursor.x;
    const offsetY = wy - cursor.y;
    let lastX = wx;
    let lastY = wy;
    const timer = setInterval(() => {
      if (win.isDestroyed() || !win.isFocused()) {
        stopWindowDrag(win.id);
        return;
      }
      const point = screen.getCursorScreenPoint();
      const nextX = point.x + offsetX;
      const nextY = point.y + offsetY;
      if (nextX === lastX && nextY === lastY) return;
      lastX = nextX;
      lastY = nextY;
      win.setPosition(nextX, nextY);
    }, 16);
    dragTimers.set(win.id, timer);
  });
  ipcMain.on(IPC.WINDOW_DRAG_END, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      stopWindowDrag(win.id);
      windowManager.persistWindowBounds(win);
    }
  });

  // --- System handlers ---
  ipcMain.handle(IPC.SYSTEM_CLIPBOARD_READ, async () => {
    return clipboard.readText();
  });
  ipcMain.handle(IPC.SYSTEM_CLIPBOARD_WRITE, async (_e, text: string) => {
    await clipboard.writeText(text);
    // Also save to history
    const config = configService.get();
    if (config.privacy.clipboardHistoryEnabled) {
      try { clipboardService.addEntry(text, config.privacy.clipboardMaxEntries); } catch {}
    }
    return true;
  });
  ipcMain.handle(IPC.SYSTEM_CLIPBOARD_HISTORY, () => {
    return clipboardService.getHistory();
  });
  // Clear clipboard history
  ipcMain.handle(IPC.SYSTEM_CLIPBOARD_CLEAR, () => {
    clipboardService.clearHistory();
    return true;
  });

  // Read a file and return as base64 data URL
  ipcMain.handle('system:file:readDataUrl', (_e, filePath: string) => {
    try {
      const fs = require('fs');
      const path = require('path');
      const ext = path.extname(filePath).toLowerCase();
      const mime = ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
      const data = fs.readFileSync(filePath);
      const base64 = data.toString('base64');
      return `data:${mime};base64,${base64}`;
    } catch (e) {
      return null;
    }
  });

  ipcMain.handle(IPC.SYSTEM_NOTIFY, (_e, title: string, body: string) => {
    if (Notification.isSupported()) {
      new Notification({ title, body }).show();
    }
    return true;
  });

  ipcMain.handle(IPC.SYSTEM_FILE_SELECT, async (event, options?: FileSelectOptions) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const dialogOptions = {
      title: options?.title,
      filters: options?.filters,
      defaultPath: options?.defaultPath,
      properties: ['openFile' as const],
    };
    const result = win
      ? await dialog.showOpenDialog(win, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  ipcMain.handle(IPC.SYSTEM_FILE_READ, async (_e, filePath: string, pluginId: string) => {
    permissionsService.assert(pluginId, 'file-read');
    const fs = require('fs');
    return fs.readFileSync(filePath, 'utf-8');
  });
  ipcMain.handle(IPC.SYSTEM_FILE_WRITE, async (_e, filePath: string, data: string, pluginId: string) => {
    permissionsService.assert(pluginId, 'file-write');
    const fs = require('fs');
    fs.writeFileSync(filePath, data, 'utf-8');
    return true;
  });

  ipcMain.handle(IPC.SYSTEM_HOTKEY_GET, (_e, action: string) => hotkeyService.getAccelerator(action));
  ipcMain.handle(IPC.SYSTEM_HOTKEY_SET, (_e, action: string, accelerator: string) => {
    const result = hotkeyService.updateHotkey(action, accelerator);
    return { success: result.success, message: result.message, accelerator: hotkeyService.getAccelerator(action) };
  });
  ipcMain.handle(IPC.SYSTEM_OPEN_EXTERNAL, (_e, url: string) => shell.openExternal(url));

  // Folder selection dialog
  ipcMain.handle('system:file:selectFolder', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = win
      ? await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return result.canceled ? null : (result.filePaths[0] || null);
  });

  // Open path in system file manager (Explorer/Finder)
  ipcMain.handle('system:shell:openPath', (_e, filePath: string) => {
    return shell.openPath(filePath);
  });

  // Get user environment paths (home, temp, username)
  ipcMain.handle('system:env:get', () => ({
    home: os.homedir(),
    temp: os.tmpdir(),
    username: os.userInfo().username,
  }));

  // --- Disk & File Cleanup handlers ---

  // Get disk space info
  ipcMain.handle('system:disk:info', (_e, drivePath?: string) => {
    try {
      const target = drivePath || 'C:\\';
      const stats = fs.statfsSync(target);
      // Available to non-root users (may differ from free)
      const free = stats.bsize * stats.bavail;
      const total = stats.bsize * stats.blocks;
      const used = total - free;
      return { drive: target, total, used, free };
    } catch (err) {
      console.error('disk:info error:', err);
      return { drive: drivePath || 'C:\\', total: 0, used: 0, free: 0, error: String(err) };
    }
  });

  // Scan directory recursively, push progress events
  ipcMain.handle('system:file:scanDir', async (_e, dirPath: string) => {
    const windowId = BrowserWindow.fromWebContents(_e.sender)?.id;
    const emitProgress = (payload: unknown) => {
      if (windowId != null) eventRouter.emit('vibekit:scanProgress', payload, { windowId });
    };
    const scanId = `scan-${Date.now()}`;
    let totalSize = 0;
    let fileCount = 0;

    function scanRecursive(dir: string) {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          try {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              scanRecursive(fullPath);
            } else if (entry.isFile()) {
              const stat = fs.statSync(fullPath);
              totalSize += stat.size;
              fileCount++;
              // Push progress every 50 files
              if (fileCount % 50 === 0) {
                emitProgress({ scanId, dirPath, bytes: totalSize, files: fileCount, done: false });
              }
            }
          } catch { /* skip inaccessible entries */ }
        }
      } catch { /* skip inaccessible dirs */ }
    }

    try {
      scanRecursive(dirPath);
      emitProgress({ scanId, dirPath, bytes: totalSize, files: fileCount, done: true });
      return { scanId, bytes: totalSize, files: fileCount };
    } catch (err) {
      console.error('scanDir error:', err);
      return { scanId, bytes: 0, files: 0, error: String(err) };
    }
  });

  // Move file/directory to trash (Recycle Bin)
  ipcMain.handle('system:file:trashItem', async (event, filePath: string) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    try {
      if (win && !win.isDestroyed()) win.setAlwaysOnTop(false);
      await shell.trashItem(filePath);
      return { success: true };
    } catch (err) {
      console.warn('trashItem skipped:', filePath, String(err).split('\n')[0]);
      return { success: false, error: String(err) };
    } finally {
      if (win && !win.isDestroyed()) win.setAlwaysOnTop(true, 'pop-up-menu');
    }
  });

  // Recursively empty a directory by deleting its contents with fs.rmSync.
  // Does NOT delete the root directory itself — only its contents.
  // Uses permanent delete (not Recycle Bin) for speed (10K files in seconds).
  ipcMain.handle('system:file:emptyDir', async (event, dirPath: string) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const windowId = win?.id;
    const emitProgress = (payload: unknown) => {
      if (windowId != null) eventRouter.emit('vibekit:cleanProgress', payload, { windowId });
    };
    const emptyId = 'empty-' + Date.now();
    let freed = 0, skipped = 0, processed = 0;

    // Lower always-on-top once so any UAC dialogs appear above
    if (win && !win.isDestroyed()) win.setAlwaysOnTop(false);

    function deleteRecursive(itemPath: string, depth: number): void {
      try {
        const st = fs.statSync(itemPath);
        if (st.isDirectory()) {
          let entries: fs.Dirent[] = [];
          try { entries = fs.readdirSync(itemPath, { withFileTypes: true }); } catch { skipped++; return; }
          for (const entry of entries) {
            deleteRecursive(path.join(itemPath, entry.name), depth + 1);
          }
          // Remove the subdirectory itself (but NEVER the root dirPath)
          if (depth > 0) {
            try { fs.rmdirSync(itemPath); } catch { skipped++; }
          }
        } else {
          freed += st.size;
          try { fs.rmSync(itemPath, { force: true }); } catch { skipped++; return; }
        }
        processed++;
        if (processed % 200 === 0) {
          emitProgress({ emptyId, dirPath, freed, skipped, processed, done: false });
        }
      } catch { skipped++; processed++; }
    }

    try {
      let topEntries: fs.Dirent[] = [];
      try { topEntries = fs.readdirSync(dirPath, { withFileTypes: true }); } catch { /* dir gone */ }
      for (const entry of topEntries) {
        deleteRecursive(path.join(dirPath, entry.name), 0);
      }
      emitProgress({ emptyId, dirPath, freed, skipped, processed, done: true });
    } catch (err) {
      console.warn('emptyDir error:', dirPath, String(err).split('\n')[0]);
    } finally {
      if (win && !win.isDestroyed()) win.setAlwaysOnTop(true, 'pop-up-menu');
    }
    return { success: true, freed, skipped };
  });

  // Get size of a single directory (fast, for custom paths)
  ipcMain.handle('system:file:getSize', async (_e, dirPath: string) => {
    let total = 0;
    let files = 0;
    function walk(dir: string) {
      try {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          try {
            const fp = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(fp);
            else if (entry.isFile()) { total += fs.statSync(fp).size; files++; }
          } catch { /* skip */ }
        }
      } catch { /* skip */ }
    }
    try {
      walk(dirPath);
      return { bytes: total, files };
    } catch (err) {
      return { bytes: 0, files: 0, error: String(err) };
    }
  });

  // Scan C drive for large files above threshold, sorted by size descending
  ipcMain.handle('system:file:scanLarge', async (_e, thresholdBytes: number) => {
    const results: Array<{ name: string; path: string; size: number; danger: string }> = [];
    const home = os.homedir();
    const skipDirs = new Set([
      'C:\\Windows', 'C:\\Program Files', 'C:\\Program Files (x86)',
      'C:\\$Recycle.Bin', 'C:\\System Volume Information',
      path.join(home, 'AppData'), path.join(home, '.vibekit'),
    ]);

    function dangerLevel(fp: string): string {
      const p = fp.toLowerCase();
      if (p.includes('\\windows\\') || p.includes('\\program files')) return 'danger';
      if (p.includes('\\appdata\\') || p.includes('\\programdata\\') || p === 'c:\\') return 'warning';
      return 'safe';
    }

    function scanDir(dir: string, depth: number) {
      if (depth > 8 || results.length >= 1000) return;
      const lower = dir.toLowerCase();
      if (skipDirs.has(dir) || lower.startsWith('c:\\windows') || lower.startsWith('c:\\program files')) return;
      try {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const fp = path.join(dir, entry.name);
          try {
            if (entry.isDirectory()) { scanDir(fp, depth + 1); }
            else if (entry.isFile()) {
              const st = fs.statSync(fp);
              if (st.size >= thresholdBytes) {
                results.push({ name: entry.name, path: fp, size: st.size, danger: dangerLevel(fp) });
              }
            }
          } catch { /* skip */ }
        }
      } catch { /* skip */ }
    }

    try {
      // Scan user home (excluding AppData)
      if (fs.existsSync(home)) {
        for (const entry of fs.readdirSync(home, { withFileTypes: true })) {
          if (entry.name === 'AppData' || entry.name.startsWith('.')) continue;
          const fp = path.join(home, entry.name);
          if (entry.isDirectory()) scanDir(fp, 0);
          else if (entry.isFile()) {
            try {
              const st = fs.statSync(fp);
              if (st.size >= thresholdBytes) results.push({ name: entry.name, path: fp, size: st.size, danger: 'safe' });
            } catch { /* skip */ }
          }
        }
      }
      // Scan C:\ root files only (not subdirs)
      for (const entry of fs.readdirSync('C:\\', { withFileTypes: true })) {
        if (entry.isFile()) {
          const fp = 'C:\\' + entry.name;
          try {
            const st = fs.statSync(fp);
            if (st.size >= thresholdBytes) results.push({ name: entry.name, path: fp, size: st.size, danger: 'warning' });
          } catch { /* skip */ }
        }
      }
    } catch (err) {
      console.warn('scanLarge error:', String(err).split('\n')[0]);
    }

    results.sort((a, b) => b.size - a.size);
    return results.slice(0, 500);
  });

  // Current appearance as ThemeVars — shared by apply/reset/import
  const currentThemeVars = (): ThemeVars => {
    const appearance = configService.get().appearance;
    return {
      accent: appearance.customAccentColor,
      surface: appearance.customSurfaceColor,
      elevated: appearance.customElevatedColor,
      glass: appearance.customGlassColor,
      mode: appearance.themeMode === 'light' ? 'light' : 'dark',
    };
  };
  const applyNativeTheme = (mode: 'dark' | 'light') => {
    try {
      nativeTheme.themeSource = mode;
    } catch {
      // best effort
    }
  };
  const broadcastTheme = () => {
    const vars = currentThemeVars();
    applyNativeTheme(vars.mode === 'light' ? 'light' : 'dark');
    windowManager.broadcastToAll('vibekit:theme-vars-changed', vars);
  };

  // Theme apply — saves all colors at once then broadcasts
  ipcMain.handle(IPC.THEME_APPLY, (_e, vars: ThemeVars) => {
    configService.setValue('appearance.customAccentColor', vars.accent);
    configService.setValue('appearance.customSurfaceColor', vars.surface);
    configService.setValue('appearance.customElevatedColor', vars.elevated);
    configService.setValue('appearance.customGlassColor', vars.glass);
    configService.setValue('appearance.themeMode', vars.mode === 'light' ? 'light' : 'dark');
    broadcastTheme();
    return true;
  });

  // --- Settings handlers ---
  ipcMain.handle(IPC.SETTINGS_GET, (_e, dotPath?: string) => configService.getValue(dotPath));
  const broadcastGlassOpacity = () => {
    windowManager.broadcastToAll('vibekit:appearance-changed', configService.getValue('appearance.glassOpacity'));
  };
  ipcMain.handle(IPC.SETTINGS_SET, (_e, dotPath: string, value: unknown) => {
    configService.setValue(dotPath, value);
    if (dotPath === 'appearance.glassOpacity') broadcastGlassOpacity();
    if (dotPath === 'appearance.themeMode') broadcastTheme();
    return true;
  });
  ipcMain.handle(IPC.SETTINGS_RESET, () => { configService.reset(); broadcastGlassOpacity(); broadcastTheme(); return true; });
  ipcMain.handle(IPC.SETTINGS_EXPORT, () => configService.exportAll());
  ipcMain.handle(IPC.SETTINGS_IMPORT, (_e, json: string) => { configService.importAll(json); broadcastGlassOpacity(); broadcastTheme(); return true; });
  ipcMain.handle(IPC.SETTINGS_CLEAR_DATA, () => { configService.reset(); broadcastGlassOpacity(); broadcastTheme(); return true; });

  // --- Recorder handlers ---
  ipcMain.handle(IPC.RECORDER_GET_SOURCES, async () => {
    if (!recorderService) return { screens: [], windows: [] };
    return recorderService.getSources();
  });
  ipcMain.handle(IPC.RECORDER_GET_DISPLAYS, () => {
    if (!recorderService) return [];
    return recorderService.getDisplays();
  });
  ipcMain.handle(IPC.RECORDER_GET_STATE, () => {
    return recorderService?.getState() ?? 'idle';
  });
  ipcMain.handle(IPC.RECORDER_START, (event, config: any) => {
    if (!recorderService) return false;
    const win = BrowserWindow.fromWebContents(event.sender);
    const winId = win?.id ?? 0;
    return recorderService.startRecording(winId, config);
  });
  ipcMain.handle(IPC.RECORDER_STOP, (event) => {
    if (!recorderService) return;
    const win = BrowserWindow.fromWebContents(event.sender);
    const winId = win?.id ?? 0;
    // Show recorder window if hidden
    if (win && !win.isDestroyed()) win.show();
    return recorderService.stopRecording(winId);
  });
  ipcMain.handle(IPC.RECORDER_BEGIN_SAVE, (_e, payload: { mimeType?: string }) => {
    if (!recorderService) return false;
    return recorderService.beginSaveStream(payload?.mimeType);
  });
  ipcMain.handle(IPC.RECORDER_APPEND_CHUNK, (_e, chunk: Uint8Array) => {
    if (!recorderService) return false;
    return recorderService.appendSaveChunk(Buffer.from(chunk));
  });
  ipcMain.handle(IPC.RECORDER_FINISH_SAVE, (_e, payload: { mimeType?: string }) => {
    if (!recorderService) return '';
    return recorderService.finishSaveStream(payload?.mimeType);
  });
  ipcMain.handle(IPC.RECORDER_PICK_REGION, (event, opts) => {
    if (!recorderService) return null;
    const win = BrowserWindow.fromWebContents(event.sender);
    const winId = win?.id ?? 0;
    return recorderService.pickRegion(winId, opts || {audioSystem:true,audioMic:false,captureCursor:true,captureClicks:true,captureKeystrokes:true});
  });
  ipcMain.handle(IPC.RECORDER_GET_CONFIG, () => {
    const settings = dataService.get(RECORDER_PLUGIN_ID, RECORDER_SETTINGS_KEY);
    return normalizeRecorderSettings(settings);
  });
  ipcMain.handle(IPC.RECORDER_SET_CONFIG, (_e, cfg: any) => {
    const current = normalizeRecorderSettings(dataService.get(RECORDER_PLUGIN_ID, RECORDER_SETTINGS_KEY));
    const next = normalizeRecorderSettings({ ...current, ...(cfg || {}) });
    dataService.set(RECORDER_PLUGIN_ID, RECORDER_SETTINGS_KEY, next);
    return true;
  });
  ipcMain.handle(IPC.RECORDER_OPEN_PATH, (_e, filePath?: string) => {
    const settings = normalizeRecorderSettings(dataService.get(RECORDER_PLUGIN_ID, RECORDER_SETTINGS_KEY));
    const p = filePath || settings.savePath || '';
    if (p) shell.openPath(p);
    return true;
  });
}
