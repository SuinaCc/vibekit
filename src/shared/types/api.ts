import type { PluginMeta } from './plugin';
import type { PermissionType, PermissionState } from './permissions';
import type { LanConfig, LanDevice, LanPath } from './lan';
import type { AiWebSite, AiWebState } from './aiWeb';
import type { VoiceConfig, VoiceSessionInfo, VoiceStatus } from './voice';
import type { InvoiceConfig, InvoiceIndexStatus, InvoicePreview, InvoiceResult, InvoiceTreeScanResult } from './invoice';
import type {
  CustomReminder,
  LocalPomodoroState,
  PomodoroReport,
  PomodoroSettings,
  PomodoroTimerAction,
} from './pomodoro';
import type {
  DnsLookupResult,
  DnsRecordType,
  HttpCheckResult,
  NetInfo,
  NetSpeedResult,
  PingResult,
  TcpCheckResult,
} from './netTools';
import type {
  FilePreview,
  SearchMasterStatus,
  SearchQueryParams,
  SearchResponse,
} from './searchMaster';
import type {
  CompareDirOptions,
  CompareDirResult,
  CompareImageFile,
  CompareInspectResult,
  CompareTextFile,
} from './everyCompare';
import type {
  AutomationCommand,
  AutomationCommandInput,
  AutomationRun,
  AutomationSearchCommand,
  AutomationSettings,
  AutomationStartResult,
} from './automation';
import type { ThemeVars } from '../theme';

// The full API exposed to renderer via contextBridge
export interface VibeKitRendererApi {
  plugin: {
    list(): Promise<PluginMeta[]>;
    enable(pluginId: string): Promise<void>;
    disable(pluginId: string): Promise<void>;
    uninstall(pluginId: string): Promise<void>;
    getData(pluginId: string, key: string): Promise<unknown>;
    setData(pluginId: string, key: string, value: unknown): Promise<void>;
    deleteData(pluginId: string, key: string): Promise<void>;
    getPermissions(pluginId: string): Promise<Record<string, PermissionState>>;
  };
  window: {
    showSearch(): Promise<void>;
    hideSearch(): Promise<void>;
    toggleSearch(): Promise<void>;
    createMiniTool(pluginId: string): Promise<number>;
    closeMiniTool(windowId: number): Promise<void>;
    closeCurrent(): Promise<void>;
    /** Fire-and-forget: report a notification-HUD button click to the main process. */
    notifyHudAction(actionId: string): void;
    startDrag(): void;
    endDrag(): void;
  };
  system: {
    readClipboard(): Promise<string>;
    writeClipboard(text: string): Promise<void>;
    getClipboardHistory(): Promise<ClipboardEntry[]>;
    clearClipboardHistory(): Promise<void>;
    readFileAsDataUrl(filePath: string): Promise<string | null>;
    selectFolder(): Promise<string | null>;
    openPath(filePath: string): Promise<string>;
    importPlugin(): Promise<{ success: boolean; pluginId?: string; error?: string }>;
    showNotification(title: string, body: string): Promise<void>;
    selectFile(options?: FileSelectOptions): Promise<string | null>;
    readFile(path: string, pluginId: string): Promise<string>;
    writeFile(path: string, data: string, pluginId: string): Promise<void>;
    getHotkey(action: string): Promise<string>;
    setHotkey(action: string, keys: string): Promise<{ success: boolean; message: string; accelerator: string }>;
    openExternal(url: string): Promise<void>;
    getEnv(): Promise<{ home: string; temp: string; username: string }>;
    getDiskInfo(drivePath?: string): Promise<{ drive: string; total: number; used: number; free: number; error?: string }>;
    scanDirectory(dirPath: string): Promise<{ scanId: string; bytes: number; files: number; error?: string }>;
    trashItem(filePath: string): Promise<{ success: boolean; error?: string }>;
    emptyDir(dirPath: string): Promise<{ success: boolean; freed: number; skipped: number }>;
    scanLargeFiles(threshold: number): Promise<Array<{ name: string; path: string; size: number; danger: string }>>;
    getDirSize(dirPath: string): Promise<{ bytes: number; files: number; error?: string }>;
    // Recorder
    getRecorderSources(): Promise<{ screens: unknown[]; windows: unknown[] }>;
    getRecorderDisplays(): Promise<unknown[]>;
    getRecorderState(): Promise<string>;
    startRecorder(cfg: unknown): Promise<boolean>;
    stopRecorder(): Promise<void>;
    pickRegion(opts?: unknown): Promise<unknown>;
    getRecorderConfig(): Promise<RecorderConfig>;
    setRecorderConfig(cfg: Partial<RecorderConfig>): Promise<boolean>;
    openRecorderPath(path?: string): Promise<boolean>;
    saveRecorderBegin(mimeType?: string): Promise<boolean>;
    saveRecorderChunk(chunk: Uint8Array): Promise<boolean>;
    saveRecorderFinish(mimeType?: string): Promise<string>;
  };
  lan: {
    enable(): Promise<LanConfig>;
    disable(): Promise<void>;
    getDevices(): Promise<LanDevice[]>;
    getConfig(): Promise<LanConfig>;
    setConfig(patch: Partial<Pick<LanConfig, 'deviceName' | 'downloadDir' | 'trustedDevices'>>): Promise<LanConfig>;
    pickPaths(mode: 'files' | 'folders'): Promise<LanPath[]>;
    send(deviceId: string, paths: string[]): Promise<{ transferId: string }>;
    cancel(transferId: string): Promise<void>;
  };
  aiWeb: {
    getSites(): Promise<AiWebSite[]>;
    setSites(sites: AiWebSite[]): Promise<AiWebSite[]>;
    open(siteId?: string): Promise<void>;
    toggle(siteId?: string): Promise<void>;
    getState(): Promise<AiWebState>;
    setDefault(siteId: string | null): Promise<AiWebState>;
  };
  voice: {
    getConfig(): Promise<VoiceConfig>;
    setConfig(patch: Partial<VoiceConfig>): Promise<VoiceConfig>;
    startSession(): Promise<VoiceSessionInfo>;
    stopSession(): Promise<void>;
    getStatus(): Promise<VoiceStatus>;
    getSession(): Promise<VoiceSessionInfo | null>;
  };
  invoice: {
    preview(folder: string, config: InvoiceConfig): Promise<InvoicePreview>;
    generate(folder: string, config: InvoiceConfig): Promise<InvoiceResult>;
    rename(folder: string, config: InvoiceConfig): Promise<InvoiceResult>;
    indexScan(parentFolder: string, options?: { maxFiles?: number }): Promise<InvoiceTreeScanResult>;
    indexStatus(): Promise<InvoiceIndexStatus>;
    indexClear(): Promise<void>;
  };
  pomodoro: {
    getState(): Promise<LocalPomodoroState>;
    setSettings(patch: Partial<PomodoroSettings>): Promise<LocalPomodoroState>;
    timerAction(action: PomodoroTimerAction, label?: string): Promise<LocalPomodoroState>;
    logWater(amountMl: number): Promise<LocalPomodoroState>;
    undoWater(amountMl: number): Promise<LocalPomodoroState>;
    logStand(): Promise<LocalPomodoroState>;
    saveCustomReminder(reminder: Partial<CustomReminder>): Promise<{ state: LocalPomodoroState; id: string }>;
    deleteCustomReminder(id: string): Promise<LocalPomodoroState>;
    getReport(days?: number): Promise<PomodoroReport>;
    testFire(kind: string): Promise<LocalPomodoroState>;
    testNotification(): Promise<void>;
    openNotificationSettings(): Promise<void>;
  };
  net: {
    ping(host: string, count?: number, timeoutMs?: number): Promise<PingResult>;
    tcpCheck(host: string, port: number, timeoutMs?: number): Promise<TcpCheckResult>;
    dns(host: string, type: DnsRecordType): Promise<DnsLookupResult>;
    httpCheck(url: string, method?: 'HEAD' | 'GET'): Promise<HttpCheckResult>;
    speedTest(): Promise<NetSpeedResult>;
    cancelSpeedTest(): Promise<void>;
    info(force?: boolean): Promise<NetInfo>;
  };
  search: {
    status(): Promise<SearchMasterStatus>;
    query(params: SearchQueryParams): Promise<SearchResponse>;
    preview(path: string): Promise<FilePreview>;
    reveal(path: string): Promise<boolean>;
  };
  compare: {
    readText(path: string): Promise<CompareTextFile>;
    readImage(path: string): Promise<CompareImageFile>;
    inspect(leftPath: string, rightPath: string): Promise<CompareInspectResult>;
    compareDirs(leftPath: string, rightPath: string, options?: CompareDirOptions): Promise<CompareDirResult>;
  };
  automation: {
    list(): Promise<AutomationCommand[]>;
    save(command: AutomationCommandInput): Promise<AutomationCommand>;
    remove(id: string): Promise<void>;
    setEnabled(id: string, enabled: boolean): Promise<AutomationCommand>;
    getSettings(): Promise<AutomationSettings>;
    setSettings(patch: Partial<AutomationSettings>): Promise<AutomationSettings>;
    run(commandId: string, args: string): Promise<AutomationRun>;
    listEnabled(): Promise<AutomationSearchCommand[]>;
    startFromSearch(commandId: string, args: string): Promise<AutomationStartResult>;
    getRun(runId: string): Promise<AutomationRun | null>;
    getHistory(): Promise<AutomationRun[]>;
    clearHistory(): Promise<void>;
  };
  theme: {
    apply(vars: ThemeVars): Promise<void>;
  };
  settings: {
    get(path?: string): Promise<unknown>;
    set(path: string, value: unknown): Promise<void>;
    reset(): Promise<void>;
    exportData(): Promise<string>;
    importData(json: string): Promise<void>;
    clearAllData(): Promise<void>;
  };
  onEvent(channel: string, callback: (...args: unknown[]) => void): () => void;
}

export interface FileSelectOptions {
  title?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
  defaultPath?: string;
}

export interface ClipboardEntry {
  id: number;
  text: string;
  timestamp: number;
  type?: string;
  app?: string;
}

export interface RecorderConfig {
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

export interface CurrencyResult {
  fromCode: string;
  fromName: string;
  fromSymbol: string;
  amount: number;
  toCode: string;
  toSymbol: string;
  result: number;
  rate: number;
  updatedAt: number; // timestamp
  display: string;   // "100 美元 ≈ ¥724.50"
  subtitle: string;  // "汇率 1 USD = 7.2450 CNY（刚刚更新）"
}
