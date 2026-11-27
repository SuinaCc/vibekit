import { z } from 'zod';
import { DEFAULT_VOICE_MACROS } from '../types/voice';

const VoiceMacroSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(40),
  keys: z.string().min(1).max(500),
});

export const AppConfigSchema = z.object({
  version: z.literal(1),
  general: z.object({
    language: z.enum(['en', 'zh']).default('zh'),
    launchAtStartup: z.boolean().default(false),
    minimizeToTray: z.boolean().default(true),
    autoHideSearchOnBlur: z.boolean().default(true),
  }),
  hotkeys: z.object({
    toggleSearch: z.string().default('Ctrl+Shift+K'),
    toggleAiWeb: z.string().default('F4'),
  }),
  appearance: z.object({
    nativeMaterial: z.enum(['auto', 'off']).default('auto'),
    glassOpacity: z.number().min(0.3).max(1).default(1),
    themeMode: z.enum(['dark', 'light']).default('dark'),
    customAccentColor: z.string().nullable().default(null),
    customSurfaceColor: z.string().nullable().default(null),
    customElevatedColor: z.string().nullable().default(null),
    customGlassColor: z.string().nullable().default(null),
  }),
  privacy: z.object({
    clipboardHistoryEnabled: z.boolean().default(true),
    clipboardMaxEntries: z.number().min(10).max(5000).default(500),
  }),
  lan: z.object({
    enabled: z.boolean().default(false),
    deviceId: z.string().default(''),
    deviceName: z.string().max(64).default(''),
    discoveryPort: z.number().int().min(1024).max(65535).default(47631),
    transferPort: z.number().int().min(1024).max(65535).default(47632),
    downloadDir: z.string().nullable().default(null),
    trustedDevices: z.array(z.string()).default([]),
  }).default({}),
  aiWeb: z.object({
    sites: z.array(z.object({
      id: z.string().min(1).max(64),
      name: z.string().min(1).max(80),
      url: z.string().url(),
    })).default([
      { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/' },
      { id: 'claude', name: 'Claude', url: 'https://claude.ai/' },
      { id: 'gemini', name: 'Gemini', url: 'https://gemini.google.com/app' },
      { id: 'deepseek', name: 'DeepSeek', url: 'https://chat.deepseek.com/' },
      { id: 'kimi', name: 'Kimi', url: 'https://kimi.moonshot.cn/' },
      { id: 'doubao', name: '豆包', url: 'https://www.doubao.com/chat/' },
      { id: 'tongyi', name: '通义', url: 'https://tongyi.aliyun.com/qianwen/' },
      { id: 'wenxin', name: '文心一言', url: 'https://yiyan.baidu.com/' },
    ]),
    bounds: z.object({
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
    }).nullable().default(null),
    defaultSiteId: z.string().nullable().default(null),
  }).default({}),
  voice: z.object({
    httpPort: z.number().int().min(1024).max(65535).default(47640),
    macros: z.array(VoiceMacroSchema).max(30).default([...DEFAULT_VOICE_MACROS]),
  }).default({}),
  plugins: z.object({
    disabled: z.array(z.string()).default([]),
    favorites: z.array(z.string()).default([]),
  }),
  // UI state (non-critical, can be missing)
  searchWindowPosition: z
    .object({
      x: z.number(),
      y: z.number(),
    })
    .nullable()
    .default(null),
  pluginWindowBounds: z
    .record(
      z.string(),
      z.object({
        x: z.number(),
        y: z.number(),
        width: z.number().int().min(300).max(4000),
        height: z.number().int().min(200).max(4000),
      })
    )
    .default({}),
  pluginWindowBoundsVersion: z.number().int().default(1),
});

export type AppConfigParsed = z.infer<typeof AppConfigSchema>;
