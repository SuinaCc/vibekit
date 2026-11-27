export const SCREEN_TIME_PLUGIN_ID = 'local.screen-time';

export type ScreenTimeCategory =
  | 'ide'
  | 'browser'
  | 'chat'
  | 'docs'
  | 'media'
  | 'game'
  | 'design'
  | 'terminal'
  | 'vibekit'
  | 'other';

export const SCREEN_TIME_CATEGORY_META: Record<ScreenTimeCategory, { label: string; color: string }> = {
  ide: { label: '编程开发', color: '#818cf8' },
  browser: { label: '浏览器', color: '#60a5fa' },
  chat: { label: '聊天沟通', color: '#34d399' },
  docs: { label: '文档办公', color: '#fbbf24' },
  media: { label: '影音娱乐', color: '#f87171' },
  game: { label: '游戏', color: '#fb923c' },
  design: { label: '设计创作', color: '#e879f9' },
  terminal: { label: '终端命令行', color: '#94a3b8' },
  vibekit: { label: 'VibeKit', color: '#a5b4fc' },
  other: { label: '其他', color: '#7c7e96' },
};

export interface ScreenTimeSettings {
  /** Daily screen-time goal in minutes (0 = no goal). */
  goalMinutes: number;
  /** Process names (lowercase, without .exe) whose usage is not counted. */
  excludedExes: string[];
}

export const DEFAULT_SCREEN_TIME_SETTINGS: ScreenTimeSettings = {
  goalMinutes: 0,
  excludedExes: [],
};

export interface ScreenTimeAppEntry {
  /** Lowercase process name without extension, e.g. "chrome". */
  exe: string;
  /** Display name, e.g. "Chrome". */
  app: string;
  category: ScreenTimeCategory;
  minutes: number;
  /** Most-used window titles, capped at 3. */
  titles: Array<{ title: string; minutes: number }>;
}

export interface ScreenTimeState {
  date: string;
  /** Total tracked minutes today. */
  totalMinutes: number;
  /** Number of distinct apps used today. */
  appCount: number;
  /** Current foreground app (display name), empty when unknown. */
  currentApp: string;
  /** Current window title, empty when unknown. */
  currentTitle: string;
  /** Minutes per hour-of-day, 24 entries. */
  byHour: number[];
  /** Per-app breakdown, sorted by minutes desc, top 15. */
  byApp: ScreenTimeAppEntry[];
  /** Per-category totals, sorted by minutes desc. */
  byCategory: Array<{ category: ScreenTimeCategory; minutes: number }>;
  settings: ScreenTimeSettings;
  updatedAt: number;
}

export interface ScreenTimeDayStats {
  date: string;
  totalMinutes: number;
  byCategory: Array<{ category: ScreenTimeCategory; minutes: number }>;
  topApp: string;
}

export interface ScreenTimeReport {
  today: ScreenTimeDayStats;
  /** Oldest → newest, includes today. */
  days: ScreenTimeDayStats[];
  goalMinutes: number;
  /** Longest streak of days with any tracked usage, ending today. */
  streakDays: number;
}

export function normalizeExe(exe: string): string {
  const raw = String(exe || '').trim().toLowerCase();
  return raw.endsWith('.exe') ? raw.slice(0, -4) : raw;
}

export function prettyAppName(exe: string): string {
  const key = normalizeExe(exe);
  const SPECIALS: Record<string, string> = {
    code: 'VS Code',
    chrome: 'Chrome',
    msedge: 'Edge',
    firefox: 'Firefox',
    qq: 'QQ',
    wechat: '微信',
    weixin: '微信',
    dingtalk: '钉钉',
    feishu: '飞书',
    lark: '飞书',
    cmd: '命令提示符',
    conhost: '终端宿主',
    windowsterminal: 'Windows Terminal',
    wt: 'Windows Terminal',
    powershell: 'PowerShell',
    pwsh: 'PowerShell',
    explorer: '资源管理器',
   devenv: 'Visual Studio',
    winword: 'Word',
    excel: 'Excel',
    powerpnt: 'PowerPoint',
    wps: 'WPS',
    wpscloudsvr: 'WPS 云服务',
    cloudmusic: '网易云音乐',
    potplayer: 'PotPlayer',
    'vibekit': 'VibeKit',
  };
  if (SPECIALS[key]) return SPECIALS[key];
  return key.charAt(0).toUpperCase() + key.slice(1);
}

export function classifyApp(exe: string): ScreenTimeCategory {
  const key = normalizeExe(exe);
  if (!key) return 'other';
  if (key === 'vibekit') return 'vibekit';
  const IDE = ['code', 'devenv', 'idea64', 'webstorm64', 'pycharm64', 'goland64', 'clion64', 'rider64', 'datagrip64', 'sublime_text', 'notepad++', 'notepadpp', 'cursor', 'windsurf', 'jetbrains'];
  const BROWSER = ['chrome', 'msedge', 'firefox', 'opera', 'brave', 'vivaldi', '360se', '360chrome', 'sogouexplorer', 'qqbrowser', 'ucbrowser'];
  const CHAT = ['wechat', 'weixin', 'qq', 'dingtalk', 'feishu', 'lark', 'telegram', 'discord', 'slack', 'teams', 'wemeet', 'telegramdesktop'];
  const DOCS = ['winword', 'excel', 'powerpnt', 'wps', 'et', 'wpp', 'notion', 'obsidian', 'typora', 'acrobat', 'acrord32', 'sumatrapdf'];
  const MEDIA = ['cloudmusic', 'qqmusic', 'kugou', 'kuwo', 'potplayer', 'vlc', 'mpv', 'spotify', 'bilibili', 'iqiyi', 'youtube', 'netease'];
  const GAME = ['steam', 'steamwebhelper', 'epicgameslauncher', 'riotclientservices', 'wegame', 'javaw', 'yw5zq', 'client'];
  const DESIGN = ['photoshop', 'figma', 'illustrator', 'afterfx', 'premiere', 'blender', 'gimp', 'krita', 'inkscape', 'audition', 'davinci'];
  const TERMINAL = ['windowsterminal', 'wt', 'cmd', 'powershell', 'pwsh', 'conhost', 'mintty', 'alacritty', 'wezterm', 'openconsole'];
  if (IDE.some((k) => key === k)) return 'ide';
  if (BROWSER.some((k) => key === k)) return 'browser';
  if (CHAT.some((k) => key === k)) return 'chat';
  if (DOCS.some((k) => key === k)) return 'docs';
  if (MEDIA.some((k) => key === k)) return 'media';
  if (GAME.some((k) => key === k)) return 'game';
  if (DESIGN.some((k) => key === k)) return 'design';
  if (TERMINAL.some((k) => key === k)) return 'terminal';
  return 'other';
}

export function emptyScreenTimeSettings(): ScreenTimeSettings {
  return { ...DEFAULT_SCREEN_TIME_SETTINGS, excludedExes: [] };
}

export function dayKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
