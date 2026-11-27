import { createSignal, createEffect, onCleanup, onMount } from 'solid-js';
import SearchInput from '../components/search/SearchInput';
import SearchResults from '../components/search/SearchResults';
import MiniDragStrip from '../components/MiniDragStrip';
import type { MenuItem } from '../components/search/ContextMenu';
import type { AutomationSearchCommand, PluginMeta, SearchItem, CurrencyResult } from '@shared';
import { BUILTIN_TOOLS } from '@shared/builtinTools';
import { searchTools, searchAutomation, AUTOMATION_ITEM_PREFIX, type SearchableTool } from '../search';
import { convertCurrency, parseCurrencyQuery } from '../currency';
import settingsIcon from '../assets/icons/settings.svg?url';
import recorderIcon from '../assets/icons/recorder.svg?url';

const BUILTIN_ICON_URLS: Record<string, string> = {
  'local.settings': settingsIcon,
  'local.screen-recorder': recorderIcon,
};

function ipcErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
}

function toSearchItem(tool: SearchableTool): SearchItem {
  return {
    pluginId: tool.id,
    title: tool.name,
    subtitle: tool.desc,
    icon: tool.icon,
    category: tool.category,
    score: 0,
  };
}

export default function SearchBar() {
  const [query, setQuery] = createSignal('');
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [plugins, setPlugins] = createSignal<PluginMeta[]>([]);
  const [automationCommands, setAutomationCommands] = createSignal<AutomationSearchCommand[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [favorites, setFavorites] = createSignal<string[]>([]);

  const tools = (): SearchableTool[] => [
    ...BUILTIN_TOOLS.map((tool) => ({ ...tool, icon: BUILTIN_ICON_URLS[tool.id] ?? tool.icon })),
    ...plugins(),
  ];

  const currencyResult = (): CurrencyResult | null => {
    const q = query().trim();
    if (!q) return null;
    const parsed = parseCurrencyQuery(q);
    return parsed ? convertCurrency(parsed.currency, parsed.amount) : null;
  };

  const loadFavorites = async () => {
    try {
      const favs = await window.vibekitAPI?.settings.get('plugins.favorites');
      if (Array.isArray(favs)) setFavorites(favs);
    } catch {}
  };

  const loadPlugins = async () => {
    try {
      const list = await window.vibekitAPI?.plugin.list();
      setPlugins(list ?? []);
    } catch {
      setPlugins([]);
    } finally {
      setLoading(false);
    }
  };

  const loadAutomation = async () => {
    try {
      const list = await window.vibekitAPI?.automation.listEnabled();
      setAutomationCommands(list ?? []);
    } catch {
      setAutomationCommands([]);
    }
  };

  onMount(() => {
    void loadPlugins();
    void loadFavorites();
    void loadAutomation();

    const onFocus = () => {
      void loadPlugins();
      void loadFavorites();
      void loadAutomation();
    };
    window.addEventListener('focus', onFocus);
    const unsub = window.vibekitAPI?.onEvent('vibekit:search-focused', onFocus);
    onCleanup(() => {
      window.removeEventListener('focus', onFocus);
      if (unsub) unsub();
    });

    const onKey = (e: KeyboardEvent) => {
      const results = filtered();
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, Math.max(0, results.length - 1)));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(0, i - 1));
      } else if (e.key === 'Enter') {
        const item = results[selectedIndex()];
        if (item) {
          e.preventDefault();
          openPlugin(item);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    onCleanup(() => window.removeEventListener('keydown', onKey));
  });

  createEffect(() => {
    const count = filtered().length;
    if (selectedIndex() >= count) setSelectedIndex(Math.max(0, count - 1));
  });

  const filtered = (): SearchItem[] => {
    const q = query().trim();
    const favs = favorites();

    let base: SearchItem[];
    if (!q) {
      base = tools()
        .filter((tool) => favs.includes(tool.id))
        .sort((a, b) => favs.indexOf(a.id) - favs.indexOf(b.id))
        .map(toSearchItem);
    } else {
      const automation = searchAutomation(automationCommands(), q);
      const pluginsMatched = searchTools(tools(), q);
      base = [...automation, ...pluginsMatched].sort(
        (a, b) => b.score - a.score || a.title.localeCompare(b.title),
      );
    }

    const cr = currencyResult();
    if (cr && q) {
      const currencyItem: SearchItem = {
        pluginId: '__currency__',
        title: cr.display,
        subtitle: cr.subtitle,
        icon: cr.fromSymbol,
        score: 999,
      };
      return [currencyItem, ...base];
    }
    return base;
  };

  const openPlugin = (item: SearchItem) => {
    const id = item.pluginId;
    if (id === '__currency__') {
      const cr = currencyResult();
      if (cr) {
        window.vibekitAPI?.system.writeClipboard(cr.result.toString());
        window.vibekitAPI?.system.showNotification('已复制', cr.display);
      }
      return;
    }
    if (item.automation?.commandId) {
      const action = item.automation;
      void (async () => {
        try {
          await window.vibekitAPI?.automation.startFromSearch(action.commandId, action.args);
          window.vibekitAPI?.window.hideSearch();
          setQuery('');
        } catch (error) {
          window.vibekitAPI?.system.showNotification('自动化助手', ipcErrorMessage(error));
        }
      })();
      return;
    }
    if (id.startsWith(AUTOMATION_ITEM_PREFIX)) return;
    window.vibekitAPI?.window.hideSearch();
    window.vibekitAPI?.window.createMiniTool(id);
    setQuery('');
  };

  const handleContextMenu = async (pluginId: string, items: MenuItem[]) => {
    const favs = [...favorites()];
    const isFav = favs.includes(pluginId);

    if (isFav) {
      items.push({
        label: '移到顶部',
        action: () => {
          const rest = favs.filter(f => f !== pluginId);
          const updated = [pluginId, ...rest];
          setFavorites(updated);
          window.vibekitAPI?.settings.set('plugins.favorites', updated);
        },
      });
    }

    items.push({
      label: isFav ? '取消收藏' : '收藏插件',
      action: () => {
        const updated = isFav ? favs.filter(f => f !== pluginId) : [...favs, pluginId];
        setFavorites(updated);
        window.vibekitAPI?.settings.set('plugins.favorites', updated);
      },
    });
  };

  return (
    <div class="search-bar-root glass-panel glass-glow">
      <div class="search-bg-vignette" />
      <MiniDragStrip class="search-bar-drag-handle" />
      <div class="search-content">
        <div class="search-header"><span class="search-brand no-drag">VibeKit</span></div>
        <SearchInput value={query()} onInput={(q: string) => { setQuery(q); setSelectedIndex(0); }} />
        {loading() && <div class="search-results-empty"><p class="text-sm text-text-muted">加载中...</p></div>}
        {!loading() && (
          <SearchResults
            results={filtered()}
            selectedIndex={selectedIndex()}
            favorites={favorites()}
            query={query()}
            onSelect={openPlugin}
            onHover={setSelectedIndex}
            onContextMenu={handleContextMenu}
          />
        )}
      </div>
    </div>
  );
}
