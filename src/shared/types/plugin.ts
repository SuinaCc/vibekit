import type { PermissionType } from './permissions';

// Plugin manifest as defined in plugin.json
export interface PluginMeta {
  id: string; // globally unique plugin ID (e.g., "local.encode-decode")
  name: string; // display name
  desc: string; // short description
  version: string; // semver
  author: string;
  icon: string; // path relative to plugin folder (e.g., "assets/icon.svg")
  keywords: string[]; // search keywords
  category: PluginCategory; // classification
  permissions: PermissionType[]; // required permissions
  minAppVersion?: string; // optional minimum Aero version
  windowWidth?: number; // preferred mini-tool window width (default 480)
  windowHeight?: number; // preferred mini-tool window height (default 580)
}

export type PluginCategory = 'code' | 'text' | 'image' | 'system' | 'vibe' | 'tools' | 'dev';

export interface SearchAutomationAction {
  commandId: string;
  args: string;
}

export interface SearchItem {
  pluginId: string;
  title: string;
  subtitle: string;
  icon?: string;
  category?: PluginCategory;
  score: number; // relevance score from the search module
  /** Set for inline automation commands; selecting the item runs it. */
  automation?: SearchAutomationAction;
}
