export const POMODORO_PLUGIN_ID = 'local.pomodoro';

export type PomodoroPhase = 'focus' | 'shortBreak' | 'longBreak';
export type PomodoroTimerStatus = 'idle' | 'running' | 'paused';
export type PomodoroTimerAction = 'start' | 'pause' | 'resume' | 'skip' | 'reset' | 'interrupt';

export type PomodoroSoundStyle = 'chime' | 'ding' | 'pulse';

export interface ActiveHours {
  /** Whole hour, 0–24. `start` must be lower than `end`. */
  start: number;
  end: number;
}

export interface PomodoroTimerState {
  phase: PomodoroPhase;
  status: PomodoroTimerStatus;
  totalMs: number;
  remainingMs: number;
  /** Absolute epoch ms while running, null when idle/paused. */
  endsAt: number | null;
  focusCountInCycle: number;
  /** Optional task name for the current focus round ("这轮做什么"). */
  label: string;
  updatedAt: number;
}

export type CustomReminderType = 'interval' | 'daily';

export interface CustomReminder {
  id: string;
  label: string;
  message: string;
  enabled: boolean;
  type: CustomReminderType;
  /** Interval reminders only. */
  intervalMinutes: number | null;
  /** Daily reminders only, 'HH:MM'. */
  time: string | null;
  /** Interval reminders only. */
  activeHours: ActiveHours;
}

export interface PomodoroSettings {
  focusMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  longBreakInterval: number;
  autoStartNextPhase: boolean;
  notifySound: boolean;
  /** Notification/HUD tone style. */
  soundStyle: PomodoroSoundStyle;
  /** Ctrl+Alt+P global start/pause hotkey. */
  globalShortcutEnabled: boolean;
  /** Desktop always-on-top mini widget visibility. */
  showFloatingWidget: boolean;

  heightCm: number;
  weightKg: number;
  /** null = follow the height/weight recommendation. */
  waterManualGoalMl: number | null;
  waterReminderEnabled: boolean;
  waterIntervalMinutes: number;
  waterActiveHours: ActiveHours;

  standReminderEnabled: boolean;
  standIntervalMinutes: number;
  standActiveHours: ActiveHours;
}

export interface DailyStats {
  date: string;
  pomodoros: number;
  focusMinutes: number;
  waterMl: number;
  standUps: number;
  remindersFired: number;
  /** Focus interruptions logged during focus phases. */
  interruptions: number;
  /** Focus minutes per hour of day, index 0–23. */
  focusByHour: number[];
}

/** Aggregate focusByHour across days → 24-slot minute totals. */
export function aggregateFocusByHour(days: Array<Pick<DailyStats, 'focusByHour'>>): number[] {
  const out = new Array<number>(24).fill(0);
  for (const day of days) {
    const hours = Array.isArray(day.focusByHour) && day.focusByHour.length === 24 ? day.focusByHour : [];
    for (let h = 0; h < 24; h += 1) {
      const v = hours[h];
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[h] += v;
    }
  }
  return out;
}

export interface ReminderScheduleState {
  nextAt: number | null;
  lastFiredAt: number | null;
}

export interface PomodoroRemindersState {
  water: ReminderScheduleState;
  stand: ReminderScheduleState;
  custom: Record<string, ReminderScheduleState>;
}

export interface LocalPomodoroState {
  today: DailyStats;
  waterGoalMl: number;
  settings: PomodoroSettings;
  timer: PomodoroTimerState;
  reminders: PomodoroRemindersState;
  customReminders: CustomReminder[];
  serverTime: number;
}

export interface PomodoroReport {
  today: DailyStats;
  /** Oldest → newest, `days` entries including today. */
  days: DailyStats[];
  /** Requested range in days (7 / 30 / 90). */
  rangeDays: number;
  waterGoalMl: number;
}

export interface PomodoroReminderPayload {
  kind: 'water' | 'stand' | 'custom';
  title: string;
  body: string;
  at: number;
}

export const DEFAULT_POMODORO_SETTINGS: PomodoroSettings = {
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  longBreakInterval: 4,
  autoStartNextPhase: false,
  notifySound: true,
  soundStyle: 'chime',
  globalShortcutEnabled: true,
  showFloatingWidget: false,

  heightCm: 170,
  weightKg: 65,
  waterManualGoalMl: null,
  waterReminderEnabled: true,
  waterIntervalMinutes: 60,
  waterActiveHours: { start: 9, end: 21 },

  standReminderEnabled: true,
  standIntervalMinutes: 45,
  standActiveHours: { start: 9, end: 18 },
};

/** Recommended daily water intake (ml) from height/weight via BMI factor. */
export function computeWaterGoal(heightCm: number, weightKg: number): number {
  const clampInt = (value: number, min: number, max: number, fallback: number): number => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, Math.round(value)));
  };
  const h = clampInt(heightCm, 100, 230, 170);
  const w = clampInt(weightKg, 30, 200, 65);
  const bmi = w / Math.pow(h / 100, 2);
  const factor = bmi < 24 ? 35 : bmi < 28 ? 32 : 30;
  const ml = Math.round((w * factor) / 50) * 50;
  return Math.min(4000, Math.max(1200, ml));
}

export function emptyDailyStats(date: string): DailyStats {
  return { date, pomodoros: 0, focusMinutes: 0, waterMl: 0, standUps: 0, remindersFired: 0, interruptions: 0, focusByHour: new Array<number>(24).fill(0) };
}
