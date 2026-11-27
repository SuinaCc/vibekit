export type VoiceState = 'idle' | 'starting' | 'listening' | 'typing' | 'error';

export interface VoiceMacro {
  id: string;
  label: string;
  /** Key combo or comma-separated sequence, e.g. "ctrl+s" or "ctrl+a, ctrl+c, sleep:150, alt+tab, ctrl+v". */
  keys: string;
}

export const DEFAULT_VOICE_MACROS: ReadonlyArray<VoiceMacro> = [
  { id: 'copy', label: '复制', keys: 'ctrl+c' },
  { id: 'paste', label: '粘贴', keys: 'ctrl+v' },
  { id: 'undo', label: '撤销', keys: 'ctrl+z' },
  { id: 'save', label: '保存', keys: 'ctrl+s' },
  { id: 'switch-window', label: '切换窗口', keys: 'alt+tab' },
  { id: 'desktop', label: '显示桌面', keys: 'win+d' },
  { id: 'lock', label: '锁屏', keys: 'win+l' },
  { id: 'screenshot', label: '截图', keys: 'win+shift+s' },
];

export interface VoiceConfig {
  httpPort: number;
  macros: VoiceMacro[];
}

export interface VoiceSessionInfo {
  phoneUrl: string;
  qrDataUrl: string;
  networkName?: string;
}

export interface VoiceStatus {
  state: VoiceState;
  message?: string;
}

export interface VoiceTranscript {
  text: string;
}
