import { spawn, type ChildProcess } from 'child_process';
import * as readline from 'readline';
import {
  SCREEN_TIME_PLUGIN_ID,
  classifyApp,
  dayKey,
  emptyScreenTimeSettings,
  normalizeExe,
  prettyAppName,
  type ScreenTimeCategory,
  type ScreenTimeSettings,
  type ScreenTimeState,
  type ScreenTimeReport,
  type ScreenTimeDayStats,
  type ScreenTimeAppEntry,
} from '@shared';
import type { DataService } from './DataService';

interface DayBucket {
  date: string;
  /** exe (normalized) → minutes (float) */
  apps: Map<string, number>;
  /** exe → title → minutes */
  titles: Map<string, Map<string, number>>;
  /** hour-of-day → minutes */
  hours: number[];
}

const FLUSH_INTERVAL_MS = 30_000;
const KEEP_DAYS = 90;

export class ScreenTimeService {
  private settings: ScreenTimeSettings = emptyScreenTimeSettings();
  private bucket: DayBucket;
  private fgProc: ChildProcess | null = null;
  private currentExe = '';
  private currentTitle = '';
  private segmentStart = Date.now();
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private destroyed = false;

  constructor(private dataService: DataService) {
    this.settings = this.loadSettings();
    this.bucket = this.loadBucket(dayKey());
    this.startTracker();
    this.flushTimer = setInterval(() => {
      this.commitPending();
      this.saveBucket();
      this.pruneOldDays();
    }, FLUSH_INTERVAL_MS);
  }

  // --- Public API ---

  getState(): ScreenTimeState {
    this.maybeRollover();
    const { apps, hours, titles } = this.bucket;
    let total = 0;
    const byApp: ScreenTimeAppEntry[] = [];
    for (const [exe, minutes] of apps) {
      total += minutes;
      const titleMap = titles.get(exe);
      const topTitles = titleMap
        ? [...titleMap.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([title, m]) => ({ title, minutes: Math.round(m) }))
        : [];
      byApp.push({
        exe,
        app: prettyAppName(exe),
        category: classifyApp(exe),
        minutes: Math.round(minutes),
        titles: topTitles,
      });
    }
    byApp.sort((a, b) => b.minutes - a.minutes);
    const catTotals = new Map<ScreenTimeCategory, number>();
    for (const entry of byApp) {
      catTotals.set(entry.category, (catTotals.get(entry.category) ?? 0) + entry.minutes);
    }
    const byCategory = [...catTotals.entries()]
      .map(([category, minutes]) => ({ category, minutes: Math.round(minutes) }))
      .sort((a, b) => b.minutes - a.minutes);
    return {
      date: this.bucket.date,
      totalMinutes: Math.round(total),
      appCount: apps.size,
      currentApp: this.currentExe ? prettyAppName(this.currentExe) : '',
      currentTitle: this.currentTitle,
      byHour: hours.map((m) => Math.round(m)),
      byApp: byApp.slice(0, 15),
      byCategory,
      settings: { ...this.settings },
      updatedAt: Date.now(),
    };
  }

  getReport(days: number = 7): ScreenTimeReport {
    this.maybeRollover();
    this.saveBucket();
    const wanted = Math.min(Math.max(Math.round(days) || 7, 1), 90);
    const dates: string[] = [];
    for (let i = wanted - 1; i >= 0; i -= 1) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      dates.push(dayKey(d));
    }
    const dayStats: ScreenTimeDayStats[] = dates.map((date) => this.dayStatsFor(date));
    // streak: consecutive days (ending today) with tracked usage
    let streak = 0;
    for (let i = dayStats.length - 1; i >= 0; i -= 1) {
      if (dayStats[i].totalMinutes > 0) streak += 1;
      else break;
    }
    return {
      today: dayStats[dayStats.length - 1],
      days: dayStats,
      goalMinutes: this.settings.goalMinutes,
      streakDays: streak,
    };
  }

  setSettings(patch: unknown): ScreenTimeState {
    if (!patch || typeof patch !== 'object') throw new Error('无效的设置');
    const o = patch as Record<string, unknown>;
    if ('goalMinutes' in o) {
      const v = Math.round(Number(o.goalMinutes));
      if (!Number.isFinite(v) || v < 0 || v > 1440) throw new Error('目标时长需在 0–1440 分钟之间');
      this.settings.goalMinutes = v;
    }
    if ('excludedExes' in o) {
      if (!Array.isArray(o.excludedExes)) throw new Error('excludedExes 必须是数组');
      this.settings.excludedExes = o.excludedExes
        .map((x) => normalizeExe(String(x)))
        .filter((x) => x.length > 0 && x.length <= 64)
        .slice(0, 50);
    }
    this.dataService.set(SCREEN_TIME_PLUGIN_ID, 'settings', this.settings);
    return this.getState();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.fgProc) {
      try { this.fgProc.kill(); } catch { /* ignore */ }
      this.fgProc = null;
    }
    try {
      this.commitPending();
      this.saveBucket();
    } catch { /* best effort on shutdown */ }
  }

  // --- Tracking ---

  private startTracker(): void {
    if (process.platform !== 'win32') return;
    const script = [
      '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
      "Add-Type @'",
      'using System;',
      'using System.Text;',
      'using System.Runtime.InteropServices;',
      'public class VibeKitST {',
      '  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
      '  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);',
      '  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);',
      '[DllImport("kernel32.dll")] public static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);',
      '  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);',
      '  [DllImport("psapi.dll")] public static extern uint GetModuleFileNameEx(IntPtr h, IntPtr mod, StringBuilder name, int size);',
      '  public static string ExeName(IntPtr hWnd) {',
      '    uint pid; GetWindowThreadProcessId(hWnd, out pid);',
      '    IntPtr h = OpenProcess(0x0410, false, pid);',
      '    if (h == IntPtr.Zero) return "";',
      '    var sb = new StringBuilder(1024);',
      '    GetModuleFileNameEx(h, IntPtr.Zero, sb, 1024);',
      '    CloseHandle(h);',
      '    return System.IO.Path.GetFileName(sb.ToString());',
      '  }',
      '}',
      "'@",
      '$prev = ""',
      'while ($true) {',
      '  $h = [VibeKitST]::GetForegroundWindow()',
      '  if ($h -eq [IntPtr]::Zero) { Start-Sleep -Milliseconds 500; continue }',
      '  $exe = [VibeKitST]::ExeName($h)',
      '  $sb = New-Object System.Text.StringBuilder 512',
      '  [void][VibeKitST]::GetWindowText($h, $sb, 512)',
      '  $key = "$exe|$($sb.ToString())"',
      '  if ($key -ne $prev) { $prev = $key; [Console]::Out.WriteLine($key); [Console]::Out.Flush() }',
      '  Start-Sleep -Milliseconds 900',
      '}',
    ].join('\n');
    try {
      const child = spawn('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        script,
      ], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
      this.fgProc = child;
      const reader = readline.createInterface({ input: child.stdout! });
      reader.on('line', (line) => {
        const idx = line.indexOf('|');
        if (idx < 0) return;
        const exe = normalizeExe(line.slice(0, idx));
        const title = line.slice(idx + 1).trim().slice(0, 100);
        if (!exe) return;
        if (exe !== this.currentExe || title !== this.currentTitle) {
          this.commitPending();
          this.currentExe = exe;
          this.currentTitle = title;
        }
      });
      child.once('exit', () => {
        if (this.fgProc === child) this.fgProc = null;
        // Auto-restart unless shutting down.
        if (!this.destroyed) {
          setTimeout(() => { if (!this.destroyed) this.startTracker(); }, 5000);
        }
      });
      child.once('error', () => {
        if (this.fgProc === child) this.fgProc = null;
      });
    } catch {
      this.fgProc = null;
    }
  }

  /**
   * Attributes elapsed wall-clock time of the current (exe, title) segment
   * to the active day bucket, then re-anchors the segment start.
   */
  private commitPending(): void {
    const now = Date.now();
    const elapsedMin = Math.min((now - this.segmentStart) / 60_000, 5); // cap: sleep/hibernate guard
    this.segmentStart = now;
    if (!this.currentExe || elapsedMin <= 0) return;
    if (this.settings.excludedExes.includes(this.currentExe)) return;
    const hour = new Date(now).getHours();
    this.bucket.apps.set(this.currentExe, (this.bucket.apps.get(this.currentExe) ?? 0) + elapsedMin);
    let titleMap = this.bucket.titles.get(this.currentExe);
    if (!titleMap) {
      titleMap = new Map();
      this.bucket.titles.set(this.currentExe, titleMap);
    }
    const t = this.currentTitle || '(无标题)';
    titleMap.set(t, (titleMap.get(t) ?? 0) + elapsedMin);
    this.bucket.hours[hour] += elapsedMin;
  }

  private maybeRollover(): void {
    const today = dayKey();
    if (this.bucket.date === today) return;
    this.saveBucket();
    this.bucket = this.loadBucket(today);
  }

  // --- Persistence ---

  private loadBucket(date: string): DayBucket {
    const raw = this.dataService.get(SCREEN_TIME_PLUGIN_ID, `day:${date}`) as
      | { apps?: Record<string, number>; titles?: Record<string, Record<string, number>>; hours?: number[] }
      | undefined;
    const apps = new Map<string, number>();
    const titles = new Map<string, Map<string, number>>();
    const hours = new Array(24).fill(0) as number[];
    if (raw && typeof raw === 'object') {
      for (const [exe, m] of Object.entries(raw.apps ?? {})) {
        const v = Number(m);
        if (Number.isFinite(v) && v >= 0) apps.set(exe, v);
      }
      for (const [exe, tm] of Object.entries(raw.titles ?? {})) {
        if (!tm || typeof tm !== 'object') continue;
        const inner = new Map<string, number>();
        for (const [t, m] of Object.entries(tm)) {
          const v = Number(m);
          if (t && Number.isFinite(v) && v >= 0) inner.set(t.slice(0, 100), v);
        }
        if (inner.size) titles.set(exe, inner);
      }
      if (Array.isArray(raw.hours)) {
        for (let i = 0; i < Math.min(24, raw.hours.length); i += 1) {
          const v = Number(raw.hours[i]);
          if (Number.isFinite(v) && v >= 0) hours[i] = v;
        }
      }
    }
    return { date, apps, titles, hours };
  }

  private saveBucket(): void {
    const apps: Record<string, number> = {};
    for (const [exe, m] of this.bucket.apps) apps[exe] = Math.round(m * 10) / 10;
    const titles: Record<string, Record<string, number>> = {};
    for (const [exe, tm] of this.bucket.titles) {
      const inner: Record<string, number> = {};
      for (const [t, m] of tm) inner[t] = Math.round(m * 10) / 10;
      titles[exe] = inner;
    }
    this.dataService.set(SCREEN_TIME_PLUGIN_ID, `day:${this.bucket.date}`, {
      date: this.bucket.date,
      apps,
      titles,
      hours: this.bucket.hours.map((m) => Math.round(m * 10) / 10),
    });
  }

  private dayStatsFor(date: string): ScreenTimeDayStats {
    if (date === this.bucket.date) {
      const state = this.getState();
      return {
        date,
        totalMinutes: state.totalMinutes,
        byCategory: state.byCategory,
        topApp: state.byApp[0]?.app ?? '',
      };
    }
    const raw = this.dataService.get(SCREEN_TIME_PLUGIN_ID, `day:${date}`) as
      | { apps?: Record<string, number> }
      | undefined;
    let total = 0;
    const catTotals = new Map<ScreenTimeCategory, number>();
    let topExe = '';
    let topMinutes = 0;
    for (const [exe, m] of Object.entries(raw?.apps ?? {})) {
      const v = Number(m);
      if (!Number.isFinite(v) || v < 0) continue;
      total += v;
      const cat = classifyApp(exe);
      catTotals.set(cat, (catTotals.get(cat) ?? 0) + v);
      if (v > topMinutes) {
        topMinutes = v;
        topExe = exe;
      }
    }
    const byCategory = [...catTotals.entries()]
      .map(([category, minutes]) => ({ category, minutes: Math.round(minutes) }))
      .sort((a, b) => b.minutes - a.minutes);
    return {
      date,
      totalMinutes: Math.round(total),
      byCategory,
      topApp: topExe ? prettyAppName(topExe) : '',
    };
  }

  private pruneOldDays(): void {
    // Cheap best-effort prune: known keys are per-day, old days beyond
    // KEEP_DAYS are removed lazily via a date marker scan.
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - KEEP_DAYS);
    const cutoffKey = dayKey(cutoff);
    const keys = this.dataService.get(SCREEN_TIME_PLUGIN_ID, '__keys__') as string[] | undefined;
    if (!Array.isArray(keys)) return;
    for (const k of keys) {
      const m = /^day:(\d{4}-\d{2}-\d{2})$/.exec(k);
      if (m && m[1] < cutoffKey) this.dataService.delete(SCREEN_TIME_PLUGIN_ID, k);
    }
  }

  private loadSettings(): ScreenTimeSettings {
    const raw = this.dataService.get(SCREEN_TIME_PLUGIN_ID, 'settings') as Partial<ScreenTimeSettings> | undefined;
    const base = emptyScreenTimeSettings();
    if (!raw || typeof raw !== 'object') return base;
    const out = { ...base };
    const goal = Math.round(Number(raw.goalMinutes));
    if (Number.isFinite(goal) && goal >= 0 && goal <= 1440) out.goalMinutes = goal;
    if (Array.isArray(raw.excludedExes)) {
      out.excludedExes = raw.excludedExes.map((x) => normalizeExe(String(x))).filter(Boolean).slice(0, 50);
    }
    return out;
  }
}
