import { Notification } from 'electron';
import {
  DEFAULT_POMODORO_SETTINGS,
  POMODORO_PLUGIN_ID,
  emptyDailyStats,
  type ActiveHours,
  type CustomReminder,
  type DailyStats,
  type LocalPomodoroState,
  type PomodoroPhase,
  type PomodoroReminderPayload,
  type PomodoroRemindersState,
  type PomodoroReport,
  type PomodoroSettings,
  type PomodoroTimerAction,
  type PomodoroTimerState,
  type ReminderScheduleState,
} from '@shared';
import type { DataService } from './DataService';
import type { EventRouter } from './EventRouter';
import type { WindowManager } from '../windows/WindowManager';

const TICK_MS = 1000;
const REMINDER_GRACE_MS = 10 * 60 * 1000;
const KEEP_DAYS = 8;
const MAX_CUSTOM_REMINDERS = 50;

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function dayKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function sanitizeHours(value: unknown, fallback: ActiveHours): ActiveHours {
  if (!value || typeof value !== 'object') return { ...fallback };
  const v = value as Record<string, unknown>;
  const start = clampInt(v.start, 0, 23, fallback.start);
  const end = clampInt(v.end, 1, 24, fallback.end);
  return start < end ? { start, end } : { ...fallback };
}

function sanitizeSettings(input: unknown, base: PomodoroSettings): PomodoroSettings {
  if (!input || typeof input !== 'object') return { ...base };
  const o = input as Record<string, unknown>;
  return {
    focusMinutes: clampInt(o.focusMinutes, 1, 180, base.focusMinutes),
    shortBreakMinutes: clampInt(o.shortBreakMinutes, 1, 60, base.shortBreakMinutes),
    longBreakMinutes: clampInt(o.longBreakMinutes, 1, 120, base.longBreakMinutes),
    longBreakInterval: clampInt(o.longBreakInterval, 1, 12, base.longBreakInterval),
    autoStartNextPhase: typeof o.autoStartNextPhase === 'boolean' ? o.autoStartNextPhase : base.autoStartNextPhase,
    notifySound: typeof o.notifySound === 'boolean' ? o.notifySound : base.notifySound,

    heightCm: clampInt(o.heightCm, 100, 230, base.heightCm),
    weightKg: clampInt(o.weightKg, 30, 200, base.weightKg),
    waterManualGoalMl:
      o.waterManualGoalMl === null
        ? null
        : o.waterManualGoalMl === undefined
          ? base.waterManualGoalMl
          : clampInt(o.waterManualGoalMl, 500, 6000, base.waterManualGoalMl ?? 2000),
    waterReminderEnabled: typeof o.waterReminderEnabled === 'boolean' ? o.waterReminderEnabled : base.waterReminderEnabled,
    waterIntervalMinutes: clampInt(o.waterIntervalMinutes, 15, 240, base.waterIntervalMinutes),
    waterActiveHours: sanitizeHours(o.waterActiveHours, base.waterActiveHours),

    standReminderEnabled: typeof o.standReminderEnabled === 'boolean' ? o.standReminderEnabled : base.standReminderEnabled,
    standIntervalMinutes: clampInt(o.standIntervalMinutes, 15, 240, base.standIntervalMinutes),
    standActiveHours: sanitizeHours(o.standActiveHours, base.standActiveHours),
  };
}

function phaseMs(phase: PomodoroPhase, settings: PomodoroSettings): number {
  const minutes =
    phase === 'focus'
      ? settings.focusMinutes
      : phase === 'shortBreak'
        ? settings.shortBreakMinutes
        : settings.longBreakMinutes;
  return minutes * 60_000;
}

function sanitizeTimer(input: unknown, settings: PomodoroSettings): PomodoroTimerState {
  const fallbackTotal = phaseMs('focus', settings);
  if (!input || typeof input !== 'object') {
    return {
      phase: 'focus',
      status: 'idle',
      totalMs: fallbackTotal,
      remainingMs: fallbackTotal,
      endsAt: null,
      focusCountInCycle: 0,
      updatedAt: Date.now(),
    };
  }
  const o = input as Record<string, unknown>;
  const phase: PomodoroPhase =
    o.phase === 'shortBreak' || o.phase === 'longBreak' ? o.phase : 'focus';
  const defaultTotal = phaseMs(phase, settings);
  const totalMs = clampInt(o.totalMs, 60_000, 24 * 60 * 60_000, defaultTotal);
  let status: PomodoroTimerState['status'] =
    o.status === 'running' || o.status === 'paused' ? o.status : 'idle';
  let endsAt = numberOrNull(o.endsAt);
  if (status === 'running' && endsAt == null) status = 'paused';
  if (status !== 'running') endsAt = null;
  const remainingMs =
    status === 'idle'
      ? totalMs
      : clampInt(o.remainingMs, 0, totalMs, totalMs);
  return {
    phase,
    status,
    totalMs,
    remainingMs,
    endsAt,
    focusCountInCycle: clampInt(o.focusCountInCycle, 0, 12, 0),
    updatedAt: Date.now(),
  };
}

function sanitizeReminderList(input: unknown): CustomReminder[] {
  if (!Array.isArray(input)) return [];
  const out: CustomReminder[] = [];
  for (const raw of input) {
    const item = sanitizeCustomReminder(raw);
    if (item) out.push(item);
    if (out.length >= MAX_CUSTOM_REMINDERS) break;
  }
  return out;
}

function sanitizeCustomReminder(input: unknown, forcedId?: string): CustomReminder | null {
  if (!input || typeof input !== 'object') return null;
  const o = input as Record<string, unknown>;
  const label = (typeof o.label === 'string' ? o.label.trim() : '').slice(0, 30) || '提醒';
  const message = (typeof o.message === 'string' ? o.message.trim() : '').slice(0, 80);
  const type: CustomReminder['type'] = o.type === 'daily' ? 'daily' : 'interval';
  const timeRaw = typeof o.time === 'string' ? o.time.trim() : '';
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(timeRaw) ? timeRaw : '09:00';
  let id = forcedId ?? (typeof o.id === 'string' ? o.id.trim() : '');
  id = id.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 64);
  if (!id) id = `rem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  return {
    id,
    label,
    message,
    enabled: o.enabled !== false,
    type,
    intervalMinutes: type === 'interval' ? clampInt(o.intervalMinutes, 5, 720, 30) : null,
    time: type === 'daily' ? time : null,
    activeHours: sanitizeHours(o.activeHours, { start: 9, end: 21 }),
  };
}

function sanitizeSchedule(input: unknown): ReminderScheduleState {
  if (!input || typeof input !== 'object') return { nextAt: null, lastFiredAt: null };
  const o = input as Record<string, unknown>;
  return { nextAt: numberOrNull(o.nextAt), lastFiredAt: numberOrNull(o.lastFiredAt) };
}

function sanitizeReminders(input: unknown): PomodoroRemindersState {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const customRaw = o.custom && typeof o.custom === 'object' ? (o.custom as Record<string, unknown>) : {};
  const custom: Record<string, ReminderScheduleState> = {};
  for (const [id, value] of Object.entries(customRaw)) {
    custom[id] = sanitizeSchedule(value);
  }
  return {
    water: sanitizeSchedule(o.water),
    stand: sanitizeSchedule(o.stand),
    custom,
  };
}

function sanitizeHistory(input: unknown): Record<string, DailyStats> {
  const out: Record<string, DailyStats> = {};
  if (!input || typeof input !== 'object') return out;
  for (const [date, value] of Object.entries(input as Record<string, unknown>)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !value || typeof value !== 'object') continue;
    const v = value as Record<string, unknown>;
    out[date] = {
      date,
      pomodoros: clampInt(v.pomodoros, 0, 1000, 0),
      focusMinutes: clampInt(v.focusMinutes, 0, 100000, 0),
      waterMl: clampInt(v.waterMl, 0, 100000, 0),
      standUps: clampInt(v.standUps, 0, 1000, 0),
      remindersFired: clampInt(v.remindersFired, 0, 10000, 0),
    };
  }
  return out;
}

export function computeWaterGoal(heightCm: number, weightKg: number): number {
  const h = clampInt(heightCm, 100, 230, 170);
  const w = clampInt(weightKg, 30, 200, 65);
  const bmi = w / Math.pow(h / 100, 2);
  const factor = bmi < 24 ? 35 : bmi < 28 ? 32 : 30;
  const ml = Math.round((w * factor) / 50) * 50;
  return Math.min(4000, Math.max(1200, ml));
}

export class PomodoroService {
  private settings: PomodoroSettings;
  private timer: PomodoroTimerState;
  private reminders: PomodoroRemindersState;
  private custom: CustomReminder[];
  private history: Record<string, DailyStats>;
  private today: string;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private destroyed = false;
  private activeNotifications = new Set<Notification>();

  constructor(
    private dataService: DataService,
    private eventRouter: EventRouter,
    private windowManager: WindowManager,
  ) {
    this.settings = sanitizeSettings(this.read('settings'), { ...DEFAULT_POMODORO_SETTINGS });
    this.custom = sanitizeReminderList(this.read('customReminders'));
    this.timer = sanitizeTimer(this.read('timer'), this.settings);
    this.reminders = sanitizeReminders(this.read('reminders'));
    this.history = sanitizeHistory(this.read('history'));
    this.today = dayKey();
    this.ensureToday();
    this.pruneHistory();

    if (this.timer.status === 'idle') {
      const duration = phaseMs(this.timer.phase, this.settings);
      this.timer.totalMs = duration;
      this.timer.remainingMs = duration;
    }

    const now = Date.now();
    if (this.reconcileTimer(now)) {
      this.saveTimer();
      this.saveHistory();
    }
    this.initSchedules(now);
    this.saveReminders();

    this.tickTimer = setInterval(() => this.tick(), TICK_MS);
  }

  // --- Public API (called from IPC handlers) ---

  getState(): LocalPomodoroState {
    this.maybeRollover();
    const now = Date.now();
    const timer = { ...this.timer };
    if (timer.status === 'running' && timer.endsAt != null) {
      timer.remainingMs = Math.max(0, timer.endsAt - now);
    }
    return {
      today: { ...this.todayStats() },
      waterGoalMl: this.waterGoal(),
      settings: {
        ...this.settings,
        waterActiveHours: { ...this.settings.waterActiveHours },
        standActiveHours: { ...this.settings.standActiveHours },
      },
      timer,
      reminders: this.copyReminders(),
      customReminders: this.custom.map((reminder) => ({ ...reminder, activeHours: { ...reminder.activeHours } })),
      serverTime: now,
    };
  }

  setSettings(patch: unknown): LocalPomodoroState {
    this.maybeRollover();
    const now = Date.now();
    const input = patch && typeof patch === 'object' ? (patch as Partial<PomodoroSettings>) : {};
    this.settings = sanitizeSettings({ ...this.settings, ...input }, this.settings);

    if (this.timer.status === 'idle') {
      const duration = phaseMs(this.timer.phase, this.settings);
      this.timer.totalMs = duration;
      this.timer.remainingMs = duration;
      this.timer.updatedAt = now;
    }

    if (
      'waterReminderEnabled' in input ||
      'waterIntervalMinutes' in input ||
      'waterActiveHours' in input
    ) {
      this.resetIntervalSchedule('water', now);
    }
    if (
      'standReminderEnabled' in input ||
      'standIntervalMinutes' in input ||
      'standActiveHours' in input
    ) {
      this.resetIntervalSchedule('stand', now);
    }

    this.saveSettings();
    this.saveTimer();
    this.saveReminders();
    this.emitState();
    return this.getState();
  }

  timerAction(action: PomodoroTimerAction): LocalPomodoroState {
    const now = Date.now();
    const timer = this.timer;
    switch (action) {
      case 'start':
        if (timer.status === 'running') break;
        if (timer.status === 'paused' && timer.remainingMs > 0) {
          timer.status = 'running';
          timer.endsAt = now + timer.remainingMs;
        } else {
          timer.status = 'running';
          timer.totalMs = phaseMs(timer.phase, this.settings);
          timer.remainingMs = timer.totalMs;
          timer.endsAt = now + timer.remainingMs;
        }
        break;
      case 'resume':
        if (timer.status !== 'paused') break;
        timer.status = 'running';
        timer.endsAt = now + Math.max(0, timer.remainingMs);
        break;
      case 'pause':
        if (timer.status !== 'running') break;
        timer.remainingMs = Math.max(0, (timer.endsAt ?? now) - now);
        timer.endsAt = null;
        timer.status = timer.remainingMs > 0 ? 'paused' : 'idle';
        if (timer.remainingMs <= 0) this.completePhase(now, true);
        break;
      case 'skip':
        this.completePhase(now, false);
        break;
      case 'reset':
        timer.phase = 'focus';
        timer.status = 'idle';
        timer.totalMs = phaseMs('focus', this.settings);
        timer.remainingMs = timer.totalMs;
        timer.endsAt = null;
        timer.focusCountInCycle = 0;
        break;
      default:
        throw new Error(`未知计时操作: ${String(action)}`);
    }
    timer.updatedAt = now;
    this.saveTimer();
    this.saveHistory();
    this.emitState();
    return this.getState();
  }

  logWater(amountMl: unknown): LocalPomodoroState {
    this.maybeRollover();
    if (typeof amountMl !== 'number' || !Number.isFinite(amountMl)) {
      throw new Error('请输入有效的饮水量');
    }
    const amount = Math.round(amountMl);
    if (amount < 10 || amount > 3000) throw new Error('单次饮水量需在 10–3000 ml 之间');
    const stats = this.todayStats();
    stats.waterMl += amount;
    this.saveHistory();
    this.emitState();
    return this.getState();
  }

  logStand(): LocalPomodoroState {
    this.maybeRollover();
    const now = Date.now();
    this.todayStats().standUps += 1;
    this.reminders.stand.lastFiredAt = now;
    this.resetIntervalSchedule('stand', now);
    this.saveHistory();
    this.saveReminders();
    this.emitState();
    return this.getState();
  }

  saveCustomReminder(input: unknown): { state: LocalPomodoroState; id: string } {
    this.maybeRollover();
    const now = Date.now();
    const patch = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
    const requestedId = typeof patch.id === 'string' ? patch.id : '';
    const existing = requestedId ? this.custom.find((item) => item.id === requestedId) : undefined;
    const sanitized = sanitizeCustomReminder(patch, existing?.id);
    if (!sanitized) throw new Error('提醒格式错误');

    if (existing) {
      const index = this.custom.indexOf(existing);
      this.custom[index] = sanitized;
    } else {
      if (this.custom.length >= MAX_CUSTOM_REMINDERS) throw new Error('提醒数量已达上限');
      if (this.custom.some((item) => item.id === sanitized.id)) {
        sanitized.id = `rem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      }
      this.custom.push(sanitized);
    }

    this.reminders.custom[sanitized.id] = this.initialCustomSchedule(sanitized, now);
    this.saveCustomReminders();
    this.saveReminders();
    this.emitState();
    return { state: this.getState(), id: sanitized.id };
  }

  deleteCustomReminder(id: unknown): LocalPomodoroState {
    if (typeof id !== 'string' || !id) throw new Error('提醒 ID 无效');
    this.custom = this.custom.filter((item) => item.id !== id);
    delete this.reminders.custom[id];
    this.saveCustomReminders();
    this.saveReminders();
    this.emitState();
    return this.getState();
  }

  getReport(): PomodoroReport {
    this.maybeRollover();
    const today = { ...this.todayStats() };
    const days: DailyStats[] = [];
    for (let i = 6; i >= 0; i -= 1) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const key = dayKey(date);
      days.push({ ...(this.history[key] ?? emptyDailyStats(key)) });
    }
    return { today, days, waterGoalMl: this.waterGoal() };
  }

  testNotification(): void {
    this.notify('番茄钟测试通知', '如果你看到这条通知，说明系统提醒工作正常。');
  }

  testFire(kind: unknown): LocalPomodoroState {
    const now = Date.now();
    if (kind === 'phase') {
      this.completePhase(now, true);
      this.saveTimer();
      this.saveHistory();
      this.saveReminders();
      this.emitState();
      return this.getState();
    }
    if (kind === 'water') {
      this.fireWater(now);
    } else if (kind === 'stand') {
      this.fireStand(now);
    } else if (typeof kind === 'string') {
      const reminder = this.custom.find((item) => item.id === kind);
      if (!reminder) throw new Error('提醒不存在');
      this.fireCustom(reminder, now);
    } else {
      throw new Error('未知测试类型');
    }
    this.saveHistory();
    this.saveReminders();
    this.emitState();
    return this.getState();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    this.saveSettings();
    this.saveTimer();
    this.saveReminders();
    this.saveCustomReminders();
    this.saveHistory();
  }

  // --- Tick loop ---

  private tick(): void {
    if (this.destroyed) return;
    const now = Date.now();
    let dirty = false;
    let fired = false;

    if (dayKey() !== this.today) {
      this.rollover();
      dirty = true;
    }
    if (this.reconcileTimer(now)) {
      this.saveTimer();
      this.saveHistory();
      dirty = true;
    }
    if (this.checkReminders(now)) {
      this.saveHistory();
      this.saveReminders();
      fired = true;
    } else if (this.remindersDirty) {
      this.saveReminders();
      this.remindersDirty = false;
      dirty = true;
    }
    if (dirty || fired) this.emitState();
  }

  private remindersDirty = false;

  // --- Timer state machine ---

  private reconcileTimer(now: number): boolean {
    if (this.timer.status !== 'running' || this.timer.endsAt == null) return false;
    if (now < this.timer.endsAt) {
      this.timer.remainingMs = this.timer.endsAt - now;
      return false;
    }
    this.completePhase(now, true);
    return true;
  }

  private completePhase(now: number, natural: boolean): void {
    const finished = this.timer.phase;
    let cycle = this.timer.focusCountInCycle;
    let next: PomodoroPhase;

    if (finished === 'focus') {
      if (natural) {
        cycle += 1;
        const stats = this.todayStats();
        const finishedMinutes = Math.max(1, Math.round(this.timer.totalMs / 60_000));
        stats.pomodoros += 1;
        stats.focusMinutes += finishedMinutes;
      }
      const isLong = cycle > 0 && cycle % this.settings.longBreakInterval === 0;
      next = isLong ? 'longBreak' : 'shortBreak';
      if (natural) {
        const breakMinutes = isLong ? this.settings.longBreakMinutes : this.settings.shortBreakMinutes;
        this.notify('专注完成 🍅', `休息 ${breakMinutes} 分钟，${isLong ? '喝点水、走一走。' : '稍微放松一下。'}`);
      }
    } else {
      if (finished === 'longBreak') cycle = 0;
      next = 'focus';
      if (natural) this.notify('休息结束', '准备好开始下一轮专注了吗？');
    }

    this.setPhase(next, now, cycle);
  }

  private setPhase(phase: PomodoroPhase, now: number, cycle: number): void {
    const duration = phaseMs(phase, this.settings);
    const autoStart = this.settings.autoStartNextPhase;
    this.timer = {
      phase,
      status: autoStart ? 'running' : 'idle',
      totalMs: duration,
      remainingMs: duration,
      endsAt: autoStart ? now + duration : null,
      focusCountInCycle: cycle,
      updatedAt: now,
    };
  }

  // --- Reminders ---

  private resetIntervalSchedule(kind: 'water' | 'stand', now: number): void {
    const enabled =
      kind === 'water' ? this.settings.waterReminderEnabled : this.settings.standReminderEnabled;
    if (!enabled) {
      this.reminders[kind].nextAt = null;
      return;
    }
    const interval =
      kind === 'water' ? this.settings.waterIntervalMinutes : this.settings.standIntervalMinutes;
    const hours =
      kind === 'water' ? this.settings.waterActiveHours : this.settings.standActiveHours;
    this.reminders[kind].nextAt = this.advanceIntoActiveHours(now + interval * 60_000, hours);
  }

  private initSchedules(now: number): void {
    this.reminders.water = this.scheduleFromPersisted(
      this.reminders.water,
      this.settings.waterReminderEnabled,
      this.settings.waterIntervalMinutes,
      this.settings.waterActiveHours,
      now,
    );
    this.reminders.stand = this.scheduleFromPersisted(
      this.reminders.stand,
      this.settings.standReminderEnabled,
      this.settings.standIntervalMinutes,
      this.settings.standActiveHours,
      now,
    );

    const custom: Record<string, ReminderScheduleState> = {};
    for (const reminder of this.custom) {
      const prev = this.reminders.custom[reminder.id] ?? { nextAt: null, lastFiredAt: null };
      if (!reminder.enabled) {
        custom[reminder.id] = { nextAt: null, lastFiredAt: prev.lastFiredAt };
        continue;
      }
      custom[reminder.id] = this.scheduleCustomFromPersisted(reminder, prev, now);
    }
    this.reminders.custom = custom;
  }

  private scheduleCustomFromPersisted(
    reminder: CustomReminder,
    prev: ReminderScheduleState,
    now: number,
  ): ReminderScheduleState {
    if (!reminder.enabled) return { nextAt: null, lastFiredAt: prev.lastFiredAt };
    if (reminder.type === 'daily') {
      return { nextAt: this.nextDailyAt(reminder.time ?? '09:00', now), lastFiredAt: prev.lastFiredAt };
    }
    const intervalMs = (reminder.intervalMinutes ?? 30) * 60_000;
    if (prev.nextAt != null) {
      if (prev.nextAt > now) {
        return {
          nextAt: this.advanceIntoActiveHours(prev.nextAt, reminder.activeHours),
          lastFiredAt: prev.lastFiredAt,
        };
      }
      if (now - prev.nextAt <= REMINDER_GRACE_MS && this.isActive(now, reminder.activeHours)) {
        return { nextAt: prev.nextAt, lastFiredAt: prev.lastFiredAt };
      }
    }
    if (prev.lastFiredAt != null) {
      const due = prev.lastFiredAt + intervalMs;
      if (due > now) {
        return {
          nextAt: this.advanceIntoActiveHours(due, reminder.activeHours),
          lastFiredAt: prev.lastFiredAt,
        };
      }
      if (now - due <= REMINDER_GRACE_MS && this.isActive(now, reminder.activeHours)) {
        return { nextAt: due, lastFiredAt: prev.lastFiredAt };
      }
    }
    return {
      nextAt: this.advanceIntoActiveHours(now + intervalMs, reminder.activeHours),
      lastFiredAt: prev.lastFiredAt,
    };
  }

  private scheduleFromPersisted(
    current: ReminderScheduleState,
    enabled: boolean,
    intervalMinutes: number,
    hours: ActiveHours,
    now: number,
  ): ReminderScheduleState {
    if (!enabled) return { nextAt: null, lastFiredAt: current.lastFiredAt };
    const intervalMs = intervalMinutes * 60_000;

    // Preserve a pending schedule across restarts, but drop stale ones so a
    // long absence does not produce a burst of overdue reminders.
    if (current.nextAt != null) {
      if (current.nextAt > now) {
        return { nextAt: this.advanceIntoActiveHours(current.nextAt, hours), lastFiredAt: current.lastFiredAt };
      }
      if (now - current.nextAt <= REMINDER_GRACE_MS && this.isActive(now, hours)) {
        return { nextAt: current.nextAt, lastFiredAt: current.lastFiredAt };
      }
    }

    const due = current.lastFiredAt != null ? current.lastFiredAt + intervalMs : null;
    if (due != null && due > now) {
      return { nextAt: this.advanceIntoActiveHours(due, hours), lastFiredAt: current.lastFiredAt };
    }
    if (due != null && now - due <= REMINDER_GRACE_MS && this.isActive(now, hours)) {
      return { nextAt: due, lastFiredAt: current.lastFiredAt };
    }
    return {
      nextAt: this.advanceIntoActiveHours(now + intervalMs, hours),
      lastFiredAt: current.lastFiredAt,
    };
  }

  private initialCustomSchedule(
    reminder: CustomReminder,
    now: number,
    lastFiredAt: number | null = null,
  ): ReminderScheduleState {
    if (!reminder.enabled) return { nextAt: null, lastFiredAt };
    if (reminder.type === 'daily') {
      return { nextAt: this.nextDailyAt(reminder.time ?? '09:00', now), lastFiredAt };
    }
    const intervalMs = (reminder.intervalMinutes ?? 30) * 60_000;
    return {
      nextAt: this.advanceIntoActiveHours(now + intervalMs, reminder.activeHours),
      lastFiredAt,
    };
  }

  private checkReminders(now: number): boolean {
    let fired = false;
    this.remindersDirty = false;

    if (this.settings.waterReminderEnabled) {
      const schedule = this.reminders.water;
      if (schedule.nextAt == null) {
        this.resetIntervalSchedule('water', now);
        this.remindersDirty = true;
      } else if (schedule.nextAt <= now) {
        if (this.isActive(now, this.settings.waterActiveHours)) {
          this.fireWater(now);
          fired = true;
        } else {
          this.resetIntervalSchedule('water', now);
          this.remindersDirty = true;
        }
      }
    } else if (this.reminders.water.nextAt != null) {
      this.reminders.water.nextAt = null;
      this.remindersDirty = true;
    }

    if (this.settings.standReminderEnabled) {
      const schedule = this.reminders.stand;
      if (schedule.nextAt == null) {
        this.resetIntervalSchedule('stand', now);
        this.remindersDirty = true;
      } else if (schedule.nextAt <= now) {
        if (this.isActive(now, this.settings.standActiveHours)) {
          this.fireStand(now);
          fired = true;
        } else {
          this.resetIntervalSchedule('stand', now);
          this.remindersDirty = true;
        }
      }
    } else if (this.reminders.stand.nextAt != null) {
      this.reminders.stand.nextAt = null;
      this.remindersDirty = true;
    }

    for (const reminder of this.custom) {
      const schedule = this.reminders.custom[reminder.id] ?? { nextAt: null, lastFiredAt: null };
      this.reminders.custom[reminder.id] = schedule;
      if (!reminder.enabled) {
        if (schedule.nextAt != null) {
          schedule.nextAt = null;
          this.remindersDirty = true;
        }
        continue;
      }
      if (schedule.nextAt == null) {
        this.reminders.custom[reminder.id] = this.initialCustomSchedule(reminder, now, schedule.lastFiredAt);
        this.remindersDirty = true;
        continue;
      }
      if (schedule.nextAt > now) continue;

      const overdue = now - schedule.nextAt;
      if (overdue <= REMINDER_GRACE_MS) {
        if (reminder.type === 'daily' || this.isActive(now, reminder.activeHours)) {
          this.fireCustom(reminder, now);
          fired = true;
        } else {
          schedule.nextAt = this.advanceIntoActiveHours(now + (reminder.intervalMinutes ?? 30) * 60_000, reminder.activeHours);
          this.remindersDirty = true;
        }
      } else {
        schedule.nextAt =
          reminder.type === 'daily'
            ? this.nextDailyAt(reminder.time ?? '09:00', now)
            : this.advanceIntoActiveHours(now + (reminder.intervalMinutes ?? 30) * 60_000, reminder.activeHours);
        this.remindersDirty = true;
      }
    }

    return fired;
  }

  private fireWater(now: number): void {
    const goal = this.waterGoal();
    const stats = this.todayStats();
    if (stats.waterMl < goal) {
      const body = `今天已喝 ${stats.waterMl} / ${goal} ml，补充一点水分吧。`;
      this.notify('该喝水啦 💧', body);
      stats.remindersFired += 1;
      this.emitReminder({ kind: 'water', title: '该喝水啦 💧', body, at: now });
    }
    this.reminders.water.lastFiredAt = now;
    this.reminders.water.nextAt = this.advanceIntoActiveHours(
      now + this.settings.waterIntervalMinutes * 60_000,
      this.settings.waterActiveHours,
    );
  }

  private fireStand(now: number): void {
    const body = `已经坐了 ${this.settings.standIntervalMinutes} 分钟，起身走动一下。`;
    this.notify('该起身活动了 🧍', body);
    this.todayStats().remindersFired += 1;
    this.reminders.stand.lastFiredAt = now;
    this.reminders.stand.nextAt = this.advanceIntoActiveHours(
      now + this.settings.standIntervalMinutes * 60_000,
      this.settings.standActiveHours,
    );
    this.emitReminder({ kind: 'stand', title: '该起身活动了 🧍', body, at: now });
  }

  private fireCustom(reminder: CustomReminder, now: number): void {
    const body = reminder.message || '自定义提醒到了。';
    this.notify(reminder.label, body);
    this.todayStats().remindersFired += 1;
    const schedule = this.reminders.custom[reminder.id] ?? { nextAt: null, lastFiredAt: null };
    schedule.lastFiredAt = now;
    schedule.nextAt =
      reminder.type === 'daily'
        ? this.nextDailyAt(reminder.time ?? '09:00', now)
        : this.advanceIntoActiveHours(
            now + (reminder.intervalMinutes ?? 30) * 60_000,
            reminder.activeHours,
          );
    this.reminders.custom[reminder.id] = schedule;
    this.emitReminder({ kind: 'custom', title: reminder.label, body, at: now });
  }

  private isActive(now: number, hours: ActiveHours): boolean {
    const date = new Date(now);
    const hour = date.getHours() + date.getMinutes() / 60;
    return hour >= hours.start && hour < hours.end;
  }

  private advanceIntoActiveHours(timestamp: number, hours: ActiveHours): number {
    const date = new Date(timestamp);
    const hour = date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
    if (hour < hours.start) {
      date.setHours(hours.start, 0, 0, 0);
      return date.getTime();
    }
    if (hour >= hours.end) {
      date.setDate(date.getDate() + 1);
      date.setHours(hours.start, 0, 0, 0);
      return date.getTime();
    }
    return timestamp;
  }

  private nextDailyAt(time: string, from: number): number {
    const [hours, minutes] = time.split(':').map((part) => parseInt(part, 10));
    const date = new Date(from);
    date.setHours(Number.isFinite(hours) ? hours : 9, Number.isFinite(minutes) ? minutes : 0, 0, 0);
    if (date.getTime() <= from) date.setDate(date.getDate() + 1);
    return date.getTime();
  }

  // --- History ---

  private ensureToday(): void {
    if (!this.history[this.today]) this.history[this.today] = emptyDailyStats(this.today);
  }

  private todayStats(): DailyStats {
    this.ensureToday();
    return this.history[this.today];
  }

  private maybeRollover(): void {
    if (dayKey() === this.today) return;
    this.rollover();
  }

  private rollover(): void {
    this.today = dayKey();
    this.ensureToday();
    this.pruneHistory();
    this.saveHistory();
  }

  private pruneHistory(): void {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - (KEEP_DAYS - 1));
    cutoff.setHours(0, 0, 0, 0);
    for (const key of Object.keys(this.history)) {
      const date = new Date(`${key}T00:00:00`);
      if (Number.isNaN(date.getTime()) || date.getTime() < cutoff.getTime()) {
        delete this.history[key];
      }
    }
  }

  private waterGoal(): number {
    if (this.settings.waterManualGoalMl != null) return this.settings.waterManualGoalMl;
    return computeWaterGoal(this.settings.heightCm, this.settings.weightKg);
  }

  // --- Notifications & events ---

  private notify(title: string, body: string): void {
    const showFallback = () => {
      try {
        this.windowManager.showNotificationHud(title, body, POMODORO_PLUGIN_ID);
      } catch (err) {
        console.warn('Pomodoro notification HUD failed:', err);
      }
    };
    try {
      if (!Notification.isSupported()) {
        showFallback();
        return;
      }
      const notification = new Notification({
        title,
        body,
        silent: !this.settings.notifySound,
        timeoutType: 'default',
      });
      // Keep a reference until Windows is done with it; a GC'd Notification
      // can be dropped before it is shown or clicked.
      this.activeNotifications.add(notification);
      const release = () => this.activeNotifications.delete(notification);
      notification.on('close', release);
      notification.on('failed', (_event, error) => {
        console.warn('Pomodoro notification failed to show:', error);
        release();
        // Windows policy/Focus Assist can silently block toasts. Show an
        // in-app popup so the reminder is never lost.
        showFallback();
      });
      notification.on('click', () => {
        try {
          this.windowManager.createMiniToolWindow(POMODORO_PLUGIN_ID, 940, 780);
        } catch { /* ignore */ }
        release();
      });
      notification.show();
    } catch (err) {
      console.warn('Pomodoro notification failed:', err);
      showFallback();
    }
  }

  private emitState(): void {
    const state = this.getState();
    for (const { id, pluginId } of this.windowManager.getPluginWindows()) {
      if (pluginId !== POMODORO_PLUGIN_ID) continue;
      this.eventRouter.emit('vibekit:pomodoroState', state, { windowId: id });
    }
  }

  private emitReminder(payload: PomodoroReminderPayload): void {
    for (const { id, pluginId } of this.windowManager.getPluginWindows()) {
      if (pluginId !== POMODORO_PLUGIN_ID) continue;
      this.eventRouter.emit('vibekit:pomodoroReminder', payload, { windowId: id });
    }
  }

  private copyReminders(): PomodoroRemindersState {
    const custom: Record<string, ReminderScheduleState> = {};
    for (const [id, value] of Object.entries(this.reminders.custom)) {
      custom[id] = { ...value };
    }
    return {
      water: { ...this.reminders.water },
      stand: { ...this.reminders.stand },
      custom,
    };
  }

  // --- Persistence ---

  private read(key: string): unknown {
    try {
      return this.dataService.get(POMODORO_PLUGIN_ID, key);
    } catch {
      return null;
    }
  }

  private write(key: string, value: unknown): void {
    try {
      this.dataService.set(POMODORO_PLUGIN_ID, key, value);
    } catch (err) {
      console.warn(`Pomodoro persist failed (${key}):`, err);
    }
  }

  private saveSettings(): void {
    this.write('settings', this.settings);
  }

  private saveTimer(): void {
    this.write('timer', this.timer);
  }

  private saveReminders(): void {
    this.write('reminders', this.reminders);
  }

  private saveCustomReminders(): void {
    this.write('customReminders', this.custom);
  }

  private saveHistory(): void {
    this.write('history', this.history);
  }
}
