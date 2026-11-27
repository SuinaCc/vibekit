import { createSignal, onMount } from 'solid-js';
import type { ThemeVars } from '@shared/theme';
import HotkeyRecorder from './HotkeyRecorder';
import ThemePicker from './ThemePicker';
import { applyGlassOpacity, loadGlassOpacity, MIN_GLASS_OPACITY } from '../../theme';

type SettingsTab = 'hotkey' | 'theme' | 'plugins';

interface SettingsPanelProps {
  currentHotkey: string;
  aiWebHotkey: string;
  accentColor: string | null;
  surfaceColor: string | null;
  themeMode?: 'dark' | 'light';
  onSaveHotkey: (hk: string) => Promise<{ success: boolean }>;
  onSaveAiWebHotkey: (hk: string) => Promise<{ success: boolean }>;
  onSaveTheme: (colors: ThemeVars) => Promise<void>;
  onClose: () => void;
}

export default function SettingsPanel(props: SettingsPanelProps) {
  const [tab, setTab] = createSignal<SettingsTab>('hotkey');
  const [importStatus, setImportStatus] = createSignal('');
  const [glassOpacity, setGlassOpacity] = createSignal(1);

  onMount(() => {
    void loadGlassOpacity().then(setGlassOpacity).catch(() => {});
  });

  const handleOpacityInput = (value: number) => {
    const opacity = value / 100;
    setGlassOpacity(opacity);
    applyGlassOpacity(opacity); // live preview in this window
  };

  const handleOpacityCommit = () => {
    void window.vibekitAPI?.settings.set('appearance.glassOpacity', glassOpacity());
  };

  const handleImport = async () => {
    setImportStatus('导入中…');
    const result = await window.vibekitAPI?.system.importPlugin();
    if (result?.success) setImportStatus('✓ 已导入: ' + result.pluginId);
    else setImportStatus('✗ 导入失败' + (result?.error ? ': ' + result.error : ''));
  };

  return (
    <div class="settings-panel">
      {/* Header with tabs + close */}
      <div class="settings-panel-header">
        <div class="settings-tabs">
          <button
            class="settings-tab"
            classList={{ active: tab() === 'hotkey' }}
            onClick={() => setTab('hotkey')}
          >
            快捷键
          </button>
          <button
            class="settings-tab"
            classList={{ active: tab() === 'theme' }}
            onClick={() => setTab('theme')}
          >
            外观
          </button>
          <button
            class="settings-tab"
            classList={{ active: tab() === 'plugins' }}
            onClick={() => setTab('plugins')}
          >
            插件
          </button>
        </div>
        <button class="hbtn" onClick={props.onClose} title="关闭">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>
      </div>

      {/* Content */}
      <div class="settings-panel-body">
        {tab() === 'hotkey' && (
          <div>
            <p class="text-xs text-text-secondary mb-1">搜索框</p>
            <HotkeyRecorder
              initialHotkey={props.currentHotkey}
              onSave={props.onSaveHotkey}
              onClose={() => {}}
              embedded
            />
            <p class="text-xs text-text-secondary mt-4 mb-1">AI 网页快开</p>
            <HotkeyRecorder
              initialHotkey={props.aiWebHotkey}
              onSave={props.onSaveAiWebHotkey}
              onClose={() => {}}
              embedded
            />
          </div>
        )}
        {tab() === 'theme' && (
          <div>
            <div class="appearance-opacity">
              <div class="appearance-opacity-head">
                <span>窗口不透明度</span>
                <span class="appearance-opacity-value">{Math.round(glassOpacity() * 100)}%</span>
              </div>
              <input
                class="appearance-slider"
                type="range"
                min={Math.round(MIN_GLASS_OPACITY * 100)}
                max={100}
                step={1}
                value={Math.round(glassOpacity() * 100)}
                onInput={(e) => handleOpacityInput(Number(e.currentTarget.value))}
                onChange={handleOpacityCommit}
              />
              <p class="appearance-opacity-hint">100% 为完全不透明，数值越低窗口越透明</p>
            </div>
            <ThemePicker
              accentColor={props.accentColor}
              surfaceColor={null}
              mode={props.themeMode}
              onSave={props.onSaveTheme}
              onClose={() => {}}
              embedded
            />
          </div>
        )}
        {tab() === 'plugins' && (
          <div style={{'text-align':'center','padding':'16px 0'}}>
            <p style={{'font-size':'13px','margin-bottom':'16px','opacity':'0.7'}}>从 .zip 文件导入插件</p>
            <button class="hotkey-recorder-btn" onClick={handleImport} style={{'min-width':'160px','padding':'10px 20px'}}>
              📦 选择插件包
            </button>
            {importStatus() && (
              <p style={{'font-size':'12px','margin-top':'12px','opacity':'0.7','color':importStatus().startsWith('✓')?'#22c55e':'#fca5a5'}}>
                {importStatus()}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
