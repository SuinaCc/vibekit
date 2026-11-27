export const POMODORO_PLUGIN_ID = 'local.pomodoro';

export type PomodoroPhase = 'focus' | 'shortBreak' | 'longBreak';
export type PomodoroTimerStatus = 'idle' | 'running' | 'paused';
export type PomodoroTimerAction = 'start' | 'pause' | 'resume' | 'skip' | 'reset';

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
  /** Oldest → newest, always 7 entries including today. */
  days: DailyStats[];
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

export function emptyDailyStats(date: string): DailyStats {
  return { date, pomodoros: 0, focusMinutes: 0, waterMl: 0, standUps: 0, remindersFired: 0 };
}
