import { createEffect, createSignal } from 'solid-js';
import { THEME_PRESETS, type ThemeVars } from '@shared/theme';

interface ThemePickerProps {
  accentColor: string | null;
  surfaceColor: string | null;
  mode?: 'dark' | 'light';
  onSave: (colors: ThemeVars) => Promise<void>;
  onClose: () => void;
  embedded?: boolean;
}

export default function ThemePicker(props: ThemePickerProps) {
  const [status, setStatus] = createSignal<'idle' | 'saved'>('idle');
  const [mode, setMode] = createSignal<'dark' | 'light'>(props.mode === 'light' ? 'light' : 'dark');
  const currentAccent = () => props.accentColor || '#6366f1';
  const presets = () => THEME_PRESETS.filter((preset) => (preset.mode ?? 'dark') === mode());

  createEffect(() => {
    setMode(props.mode === 'light' ? 'light' : 'dark');
  });

  const handlePreset = async (preset: (typeof THEME_PRESETS)[number]) => {
    await props.onSave({
      accent: preset.accent,
      surface: preset.surface,
      elevated: preset.elevated,
      glass: preset.glass,
      mode: preset.mode === 'light' ? 'light' : 'dark',
    });
    setStatus('saved');
    setTimeout(() => props.onClose(), 500);
  };

  const handleReset = async () => {
    await props.onSave({ accent: null, surface: null, elevated: null, glass: null, mode: 'dark' });
    setStatus('saved');
    setTimeout(() => props.onClose(), 500);
  };

  const isActive = (preset: (typeof THEME_PRESETS)[number]) => {
    if ((preset.mode ?? 'dark') !== (props.mode === 'light' ? 'light' : 'dark')) return false;
    if (preset.accent === null && props.accentColor === null) return true;
    return preset.accent === currentAccent();
  };

  return (
    <div class="theme-picker" classList={{ 'embedded-panel': props.embedded }}>
      {!props.embedded && (
        <div class="theme-picker-header">
          <span class="text-sm font-medium text-text-primary">主题颜色</span>
          <button class="hotkey-close-btn" onClick={props.onClose}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>
      )}

      <div class="theme-picker-body">
        <div class="theme-mode-toggle" role="group" aria-label="明暗模式">
          <button
            class="theme-mode-btn"
            classList={{ active: mode() === 'dark' }}
            onClick={() => setMode('dark')}
          >
            深色
          </button>
          <button
            class="theme-mode-btn"
            classList={{ active: mode() === 'light' }}
            onClick={() => setMode('light')}
          >
            浅色
          </button>
        </div>
        <p class="text-xs text-text-secondary mb-2 mt-3">选择预设主题（强调色 + 背景色）：</p>
        <div class="theme-swatches">
          {presets().map((preset) => (
            <button
              class="theme-swatch"
              classList={{ 'theme-swatch-active': isActive(preset) }}
              onClick={() => handlePreset(preset)}
              title={preset.name}
            >
              <span class="theme-swatch-row">
                <span
                  class="theme-swatch-dot"
                  style={{ background: preset.accent || '#6366f1' }}
                />
                <span
                  class="theme-swatch-dot"
                  style={{
                    background: preset.surface || ((preset.mode ?? 'dark') === 'light' ? '#ffffff' : '#0a0a1a'),
                    border: `1px solid ${(preset.mode ?? 'dark') === 'light' ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.15)'}`,
                  }}
                />
              </span>
              <span class="theme-swatch-label">{preset.name}</span>
            </button>
          ))}
        </div>

        <button class="theme-reset-btn mt-3" onClick={handleReset}>恢复默认</button>
        {status() === 'saved' && <p class="text-xs text-accent text-center mt-2 animate-fade-in">✓ 已保存</p>}
      </div>
    </div>
  );
}
