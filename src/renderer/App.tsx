import { createSignal, onCleanup, onMount, Switch, Match } from 'solid-js';
import type { ThemeVars } from '@shared/theme';
import SearchBar from './windows/SearchBar';
import AutomationResult from './windows/AutomationResult';
import SettingsPanel from './components/search/SettingsPanel';
import PluginFrame from './components/plugin/PluginFrame';
import MiniDragStrip from './components/MiniDragStrip';
import { applyTheme, loadTheme, onThemeChange } from './theme';

type WindowType = 'search' | 'mini' | 'automation-result';

function getWindowType(): WindowType {
  const hash = window.location.hash;
  if (hash.startsWith('#automation-result')) return 'automation-result';
  return hash.startsWith('#mini') ? 'mini' : 'search';
}

function getMiniPluginId(): string | null {
  const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
  return params.get('pluginId');
}

// Settings mini-window
function MiniSettings() {
  const [currentHotkey, setCurrentHotkey] = createSignal('Ctrl+Shift+K');
  const [aiWebHotkey, setAiWebHotkey] = createSignal('F4');
  const [accentColor, setAccentColor] = createSignal<string | null>(null);
  const [themeMode, setThemeMode] = createSignal<'dark' | 'light'>('dark');

  onMount(() => {
    window.vibekitAPI?.system.getHotkey('toggleSearch').then((hk) => {
      if (hk) setCurrentHotkey(hk);
    }).catch(() => {});
    window.vibekitAPI?.system.getHotkey('toggleAiWeb').then((hk) => {
      if (hk) setAiWebHotkey(hk);
    }).catch(() => {});

    void loadTheme().then((theme) => {
      setAccentColor(theme.accent);
      setThemeMode(theme.mode === 'light' ? 'light' : 'dark');
    }).catch(() => {});
    const unsub = onThemeChange((theme) => {
      setAccentColor(theme.accent);
      setThemeMode(theme.mode === 'light' ? 'light' : 'dark');
    });
    onCleanup(unsub);
  });

  const handleSaveHotkey = async (hk: string): Promise<{ success: boolean }> => {
    try {
      const r = await window.vibekitAPI?.system.setHotkey('toggleSearch', hk);
      if (r?.success) { setCurrentHotkey(hk); return { success: true }; }
      return { success: false };
    } catch { return { success: false }; }
  };

  const handleSaveAiWebHotkey = async (hk: string): Promise<{ success: boolean }> => {
    try {
      const r = await window.vibekitAPI?.system.setHotkey('toggleAiWeb', hk);
      if (r?.success) { setAiWebHotkey(hk); return { success: true }; }
      return { success: false };
    } catch { return { success: false }; }
  };

  const handleSaveTheme = async (colors: ThemeVars) => {
    setAccentColor(colors.accent);
    setThemeMode(colors.mode === 'light' ? 'light' : 'dark');
    applyTheme(colors);
    await window.vibekitAPI?.theme.apply(colors);
  };

  return (
    <div class="mini-window-root">
      <MiniDragStrip />
      <div class="mini-window-body mini-settings-body">
        <SettingsPanel
          currentHotkey={currentHotkey()}
          aiWebHotkey={aiWebHotkey()}
          accentColor={accentColor()}
          surfaceColor={null}
          themeMode={themeMode()}
          onSaveHotkey={handleSaveHotkey}
          onSaveAiWebHotkey={handleSaveAiWebHotkey}
          onSaveTheme={handleSaveTheme}
          onClose={() => window.vibekitAPI?.window.closeCurrent()}
        />
      </div>
    </div>
  );
}

export default function App() {
  const [windowType] = createSignal<WindowType>(getWindowType());
  const pluginId = getMiniPluginId();

  // ESC to close mini window
  if (windowType() === 'mini') {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { window.vibekitAPI?.window.closeCurrent(); }
    };
    window.addEventListener('keydown', onKey);
    onCleanup(() => window.removeEventListener('keydown', onKey));
  }

  return (
    <Switch>
      <Match when={windowType() === 'search'}>
        <SearchBar />
      </Match>
      <Match when={windowType() === 'automation-result'}>
        <AutomationResult />
      </Match>
      <Match when={windowType() === 'mini' && pluginId === 'local.settings'}>
        <MiniSettings />
      </Match>
      <Match when={windowType() === 'mini' && pluginId !== 'local.settings' && pluginId != null}>
        <PluginFrame pluginId={pluginId!} />
      </Match>
      <Match when={windowType() === 'mini' && pluginId == null}>
        <div class="mini-root"><p class="text-text-primary p-4 text-sm">插件: 未知</p></div>
      </Match>
    </Switch>
  );
}
