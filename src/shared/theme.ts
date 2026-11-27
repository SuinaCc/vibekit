export type ThemeMode = 'dark' | 'light';

export interface ThemeVars {
  accent: string | null;
  surface: string | null;
  elevated: string | null;
  glass: string | null;
  mode?: ThemeMode;
}

export const DEFAULT_ACCENT = '#6366f1';
export const DEFAULT_ACCENT_GLOW = 'rgba(99,102,241,0.35)';

export const THEME_PRESETS: ReadonlyArray<{ name: string } & ThemeVars> = [
  { name: '默认', mode: 'dark', accent: null, surface: null, elevated: null, glass: null },
  { name: '霓虹暗夜', mode: 'dark', accent: '#6366f1', surface: '#0a0a1a', elevated: '#12122a', glass: 'rgba(18,18,42,0.65)' },
  { name: '赛博紫', mode: 'dark', accent: '#a855f7', surface: '#0f0a1a', elevated: '#1a1228', glass: 'rgba(26,18,40,0.65)' },
  { name: '极客绿', mode: 'dark', accent: '#22c55e', surface: '#0a1a0f', elevated: '#0f1f14', glass: 'rgba(15,31,20,0.65)' },
  { name: '深海蓝', mode: 'dark', accent: '#06b6d4', surface: '#0a141a', elevated: '#0f1e28', glass: 'rgba(15,30,40,0.65)' },
  { name: '珊瑚橙', mode: 'dark', accent: '#f97316', surface: '#1a0f0a', elevated: '#281510', glass: 'rgba(40,21,16,0.65)' },
  { name: '玫瑰粉', mode: 'dark', accent: '#f43f5e', surface: '#1a0a10', elevated: '#280f18', glass: 'rgba(40,15,24,0.65)' },
  { name: '琥珀金', mode: 'dark', accent: '#f59e0b', surface: '#1a1408', elevated: '#261e0c', glass: 'rgba(38,30,12,0.65)' },
  { name: '皓白', mode: 'light', accent: '#4f46e5', surface: '#f4f5f9', elevated: '#ffffff', glass: 'rgba(255,255,255,0.72)' },
  { name: '暖白', mode: 'light', accent: '#d97706', surface: '#faf8f4', elevated: '#ffffff', glass: 'rgba(255,255,255,0.78)' },
];

export function hexToRgb(hex: string): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m ? `${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)}` : '99,102,241';
}

export function accentGlow(accent: string): string {
  return `rgba(${hexToRgb(accent)},0.35)`;
}

export function themeToCssVars(theme: ThemeVars): Record<string, string> {
  const vars: Record<string, string> = {};
  if (theme.accent) {
    const glow = accentGlow(theme.accent);
    vars['--accent'] = theme.accent;
    vars['--accent-glow'] = glow;
    vars['--accent-light'] = theme.accent;
    vars['--color-accent'] = theme.accent;
    vars['--color-accent-glow'] = glow;
    vars['--color-accent-light'] = theme.accent;
  }
  if (theme.surface) vars['--color-surface'] = theme.surface;
  if (theme.elevated) vars['--color-surface-elevated'] = theme.elevated;
  if (theme.glass) vars['--color-surface-glass'] = theme.glass;
  return vars;
}
