import type { ThemeVars } from '@shared/theme';
import { DEFAULT_ACCENT, DEFAULT_ACCENT_GLOW, themeToCssVars } from '@shared/theme';

let themeEl: HTMLStyleElement | null = null;
const listeners = new Set<(theme: ThemeVars) => void>();
let initialized = false;

function ensureThemeEl(): HTMLStyleElement {
  if (!themeEl || !document.body.contains(themeEl)) {
    themeEl = document.createElement('style');
    themeEl.id = 'app-theme';
    document.body.appendChild(themeEl);
  }
  return themeEl;
}

export function applyTheme(theme: ThemeVars): void {
  const vars = themeToCssVars(theme);
  const rules = Object.entries(vars)
    .map(([key, value]) => `${key}:${value}!important`)
    .join(';');
  ensureThemeEl().textContent = rules ? `:root{${rules}}` : '';
  document.documentElement.dataset.theme = theme.mode === 'light' ? 'light' : 'dark';
  for (const listener of listeners) listener(theme);
}

export async function loadTheme(): Promise<ThemeVars> {
  const [accent, surface, elevated, glass, mode] = await Promise.all([
    window.aeroAPI?.settings.get('appearance.customAccentColor'),
    window.aeroAPI?.settings.get('appearance.customSurfaceColor'),
    window.aeroAPI?.settings.get('appearance.customElevatedColor'),
    window.aeroAPI?.settings.get('appearance.customGlassColor'),
    window.aeroAPI?.settings.get('appearance.themeMode'),
  ]);
  const theme: ThemeVars = {
    accent: (accent as string | null) ?? null,
    surface: (surface as string | null) ?? null,
    elevated: (elevated as string | null) ?? null,
    glass: (glass as string | null) ?? null,
    mode: mode === 'light' ? 'light' : 'dark',
  };
  applyTheme(theme);
  return theme;
}

export function onThemeChange(listener: (theme: ThemeVars) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const MIN_GLASS_OPACITY = 0.3;

// Drives --glass-opacity, used directly as the alpha of every glass surface.
export function applyGlassOpacity(value: unknown): void {
  const raw = typeof value === 'number' && Number.isFinite(value) ? value : 1;
  const opacity = Math.min(1, Math.max(MIN_GLASS_OPACITY, raw));
  document.documentElement.style.setProperty('--glass-opacity', String(opacity));
}

export async function loadGlassOpacity(): Promise<number> {
  const value = await window.aeroAPI?.settings.get('appearance.glassOpacity');
  applyGlassOpacity(value);
  return typeof value === 'number' ? value : 1;
}

export function initThemeSync(): void {
  if (initialized) return;
  initialized = true;
  window.aeroAPI?.onEvent('aero:theme-vars-changed', (value: unknown) => {
    if (value && typeof value === 'object') applyTheme(value as ThemeVars);
  });
  window.aeroAPI?.onEvent('aero:appearance-changed', (value: unknown) => {
    applyGlassOpacity(value);
  });
  void loadTheme().catch(() => {});
  void loadGlassOpacity().catch(() => {});
}

export function getCurrentAccent(): { accent: string; glow: string; surface: string; glass: string; mode: 'dark' | 'light' } {
  const style = getComputedStyle(document.documentElement);
  return {
    accent: style.getPropertyValue('--color-accent').trim() || DEFAULT_ACCENT,
    glow: style.getPropertyValue('--color-accent-glow').trim() || DEFAULT_ACCENT_GLOW,
    surface: style.getPropertyValue('--color-surface').trim() || '#0a0a1a',
    glass: style.getPropertyValue('--color-surface-glass').trim() || 'rgba(18,18,42,0.65)',
    mode: document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
  };
}
