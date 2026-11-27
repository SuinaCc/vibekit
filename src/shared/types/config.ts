import type { VoiceMacro } from './voice';

export interface AppConfig {
  version: number;
  general: {
    language: 'en' | 'zh';
    launchAtStartup: boolean;
    minimizeToTray: boolean;
    autoHideSearchOnBlur: boolean;
  };
  hotkeys: {
    toggleSearch: string;
    toggleAiWeb: string;
  };
  appearance: {
    nativeMaterial: 'auto' | 'off';
    glassOpacity: number;
    themeMode: 'dark' | 'light';
    customAccentColor: string | null;
    customSurfaceColor: string | null;
    customElevatedColor: string | null;
    customGlassColor: string | null;
  };
  privacy: {
    clipboardHistoryEnabled: boolean;
    clipboardMaxEntries: number;
  };
  lan: {
    enabled: boolean;
    deviceId: string;
    deviceName: string;
    discoveryPort: number;
    transferPort: number;
    downloadDir: string | null;
    trustedDevices: string[];
  };
  aiWeb: {
    sites: Array<{ id: string; name: string; url: string }>;
    bounds: { x: number; y: number; width: number; height: number } | null;
    defaultSiteId: string | null;
  };
  voice: {
    httpPort: number;
    macros: VoiceMacro[];
  };
  plugins: {
    disabled: string[];
    favorites: string[];
  };
  searchWindowPosition: { x: number; y: number } | null;
  pluginWindowBounds: Record<string, { x: number; y: number; width: number; height: number }>;
  pluginWindowBoundsVersion: number;
}
