import type { AppConfig } from '../types/config';
import { DEFAULT_VOICE_MACROS } from '../types/voice';

export const DEFAULT_CONFIG: AppConfig = {
  version: 1,
  general: {
    language: 'zh',
    launchAtStartup: false,
    minimizeToTray: true,
    autoHideSearchOnBlur: true,
  },
  hotkeys: {
    toggleSearch: 'Ctrl+Shift+K',
    toggleAiWeb: 'F4',
  },
  appearance: {
    nativeMaterial: 'auto',
    glassOpacity: 1,
    themeMode: 'dark',
    customAccentColor: null,
    customSurfaceColor: null,
    customElevatedColor: null,
    customGlassColor: null,
  },
  privacy: {
    clipboardHistoryEnabled: true,
    clipboardMaxEntries: 500,
  },
  lan: {
    enabled: false,
    deviceId: '',
    deviceName: '',
    discoveryPort: 47631,
    transferPort: 47632,
    downloadDir: null,
    trustedDevices: [],
  },
  aiWeb: {
    sites: [
      { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/' },
      { id: 'claude', name: 'Claude', url: 'https://claude.ai/' },
      { id: 'gemini', name: 'Gemini', url: 'https://gemini.google.com/app' },
      { id: 'deepseek', name: 'DeepSeek', url: 'https://chat.deepseek.com/' },
      { id: 'kimi', name: 'Kimi', url: 'https://kimi.moonshot.cn/' },
      { id: 'doubao', name: '豆包', url: 'https://www.doubao.com/chat/' },
      { id: 'tongyi', name: '通义', url: 'https://tongyi.aliyun.com/qianwen/' },
      { id: 'wenxin', name: '文心一言', url: 'https://yiyan.baidu.com/' },
    ],
    bounds: null,
    defaultSiteId: null,
  },
  voice: {
    httpPort: 47640,
    macros: [...DEFAULT_VOICE_MACROS],
  },
  plugins: {
    disabled: [],
    favorites: [],
  },
  searchWindowPosition: null,
  pluginWindowBounds: {},
  pluginWindowBoundsVersion: 1,
};

export const APP_DATA_DIR = '.vibekit';
export const PLUGINS_DIR_NAME = 'plugins';
export const PLUGIN_DATA_DIR_NAME = 'plugin-data';
export const CONFIG_DIR_NAME = 'config';
export const CACHE_DIR_NAME = 'cache';
