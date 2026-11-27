import type { PluginCategory } from './types/plugin';

export interface BuiltinTool {
  id: string;
  name: string;
  desc: string;
  icon?: string;
  keywords: string[];
  category: PluginCategory;
}

// Tools that live in the core app, not as sandboxed plugins.
export const BUILTIN_TOOLS: readonly BuiltinTool[] = [
  {
    id: 'local.settings',
    name: '设置',
    desc: '快捷键、主题颜色、透明度与插件导入',
    keywords: ['设置', '配置', '快捷键', '主题', '颜色', '透明度', '热键', 'settings', 'config', 'opacity'],
    category: 'system',
  },
  {
    id: 'local.screen-recorder',
    name: '录屏',
    desc: '全屏/窗口/区域录制，支持系统音频、F10 停止',
    keywords: ['录屏', '录制', '屏幕录制', '录像', 'screen', 'record', 'capture'],
    category: 'tools',
  },
];

export const BUILTIN_TOOL_IDS = new Set(BUILTIN_TOOLS.map((tool) => tool.id));
