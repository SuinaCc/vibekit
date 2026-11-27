interface ModifierKey {
  code: number;
  extended: boolean;
}

interface KeyDefinition {
  code: number;
  extended: boolean;
}

export type KeyStep =
  | { type: 'combo'; modifiers: ModifierKey[]; key: KeyDefinition }
  | { type: 'sleep'; ms: number };

const MODIFIERS: Record<string, ModifierKey> = {
  ctrl: { code: 0x11, extended: false },
  control: { code: 0x11, extended: false },
  shift: { code: 0x10, extended: false },
  alt: { code: 0x12, extended: false },
  win: { code: 0x5B, extended: true },
  meta: { code: 0x5B, extended: true },
  cmd: { code: 0x5B, extended: true },
};

const EXTENDED = new Set([
  'insert', 'ins', 'delete', 'del', 'home', 'end', 'pageup', 'pgup', 'pagedown', 'pgdn',
  'up', 'down', 'left', 'right', 'printscreen', 'prtsc', 'numlock', 'apps',
  'volume_mute', 'mute', 'volume_down', 'voldown', 'volume_up', 'volup',
  'media_next', 'media_prev', 'media_stop', 'media_play_pause', 'playpause',
]);

const NAMED_KEYS: Record<string, number> = {
  enter: 0x0D,
  return: 0x0D,
  esc: 0x1B,
  escape: 0x1B,
  tab: 0x09,
  space: 0x20,
  backspace: 0x08,
  insert: 0x2D,
  ins: 0x2D,
  delete: 0x2E,
  del: 0x2E,
  home: 0x24,
  end: 0x23,
  pageup: 0x21,
  pgup: 0x21,
  pagedown: 0x22,
  pgdn: 0x22,
  up: 0x26,
  down: 0x28,
  left: 0x25,
  right: 0x27,
  capslock: 0x14,
  numlock: 0x90,
  scrolllock: 0x91,
  printscreen: 0x2C,
  prtsc: 0x2C,
  pause: 0x13,
  apps: 0x5D,
  comma: 0xBC,
  period: 0xBE,
  slash: 0xBF,
  minus: 0xBD,
  equals: 0xBB,
  semicolon: 0xBA,
  quote: 0xDE,
  backtick: 0xC0,
  bracketleft: 0xDB,
  bracketright: 0xDD,
  backslash: 0xDC,
  volume_mute: 0xAD,
  mute: 0xAD,
  volume_down: 0xAE,
  voldown: 0xAE,
  volume_up: 0xAF,
  volup: 0xAF,
  media_next: 0xB0,
  media_prev: 0xB1,
  media_stop: 0xB2,
  media_play_pause: 0xB3,
  playpause: 0xB3,
};

const MAX_STEPS = 50;
const MAX_SLEEP_MS = 5000;

function keyDefinition(token: string): KeyDefinition | null {
  const key = token.toLowerCase();
  if (key.length === 1) {
    if (/^[a-z]$/.test(key)) return { code: key.toUpperCase().charCodeAt(0), extended: false };
    if (/^[0-9]$/.test(key)) return { code: key.charCodeAt(0), extended: false };
  }
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(key)) {
    return { code: 0x70 + Number(key.slice(1)) - 1, extended: false };
  }
  if (key in NAMED_KEYS) {
    return { code: NAMED_KEYS[key], extended: EXTENDED.has(key) };
  }
  if (key in MODIFIERS) {
    const modifier = MODIFIERS[key];
    return { code: modifier.code, extended: modifier.extended };
  }
  return null;
}

function parseCombo(raw: string): KeyStep {
  const parts = raw.split('+').map((part) => part.trim()).filter(Boolean);
  if (!parts.length) throw new Error('按键组合为空');
  const keyToken = parts.pop()!;
  const modifiers: ModifierKey[] = [];
  for (const part of parts) {
    const modifier = MODIFIERS[part.toLowerCase()];
    if (!modifier) throw new Error(`不支持的修饰键: ${part}`);
    if (!modifiers.some((item) => item.code === modifier.code)) modifiers.push(modifier);
  }
  const key = keyDefinition(keyToken);
  if (!key) throw new Error(`不支持的按键: ${keyToken}`);
  return { type: 'combo', modifiers, key };
}

export function parseKeySequence(sequence: string): KeyStep[] {
  const value = String(sequence || '').trim();
  if (!value) throw new Error('按键不能为空');
  if (value.length > 500) throw new Error('按键序列过长');
  const rawSteps = value.split(/[,;]+/).map((step) => step.trim()).filter(Boolean);
  if (!rawSteps.length) throw new Error('按键不能为空');
  if (rawSteps.length > MAX_STEPS) throw new Error(`最多 ${MAX_STEPS} 个动作`);

  return rawSteps.map((step) => {
    const sleep = step.match(/^sleep\s*:\s*(\d{1,4})$/i);
    if (sleep) {
      const ms = Number(sleep[1]);
      if (!Number.isFinite(ms) || ms < 0 || ms > MAX_SLEEP_MS) {
        throw new Error(`sleep 必须在 0-${MAX_SLEEP_MS} 毫秒之间`);
      }
      return { type: 'sleep', ms };
    }
    return parseCombo(step);
  });
}

export function keyStepsToTokens(steps: KeyStep[]): string {
  const tokens: string[] = [];
  for (const step of steps) {
    if (step.type === 'sleep') {
      tokens.push(`s:${step.ms}`);
      continue;
    }
    for (const modifier of step.modifiers) tokens.push(`d:${modifier.code}:${modifier.extended ? 1 : 0}`);
    tokens.push(`d:${step.key.code}:${step.key.extended ? 1 : 0}`);
    tokens.push('s:20');
    tokens.push(`u:${step.key.code}:${step.key.extended ? 1 : 0}`);
    for (const modifier of [...step.modifiers].reverse()) {
      tokens.push(`u:${modifier.code}:${modifier.extended ? 1 : 0}`);
    }
    tokens.push('s:12');
  }
  return tokens.join(';');
}

export const PASTE_KEY_TOKENS = 'd:17:0;d:86:0;s:30;u:86:0;u:17:0';

export function buildKeyScript(steps: KeyStep[]): string {
  const lines = [
    'Add-Type @"',
    'using System;',
    'using System.Runtime.InteropServices;',
    'public class VibeKitKeys {',
    '  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);',
    '}',
    '"@',
  ];
  const down = (code: number, extended: boolean) =>
    `[VibeKitKeys]::keybd_event(0x${code.toString(16)}, 0, ${extended ? '0x1' : '0'}, [UIntPtr]::Zero)`;
  const up = (code: number, extended: boolean) =>
    `[VibeKitKeys]::keybd_event(0x${code.toString(16)}, 0, ${extended ? '0x3' : '0x2'}, [UIntPtr]::Zero)`;

  for (const step of steps) {
    if (step.type === 'sleep') {
      lines.push(`Start-Sleep -Milliseconds ${step.ms}`);
      continue;
    }
    for (const modifier of step.modifiers) lines.push(down(modifier.code, modifier.extended));
    lines.push(down(step.key.code, step.key.extended));
    lines.push('Start-Sleep -Milliseconds 20');
    lines.push(up(step.key.code, step.key.extended));
    for (const modifier of [...step.modifiers].reverse()) lines.push(up(modifier.code, modifier.extended));
    lines.push('Start-Sleep -Milliseconds 12');
  }
  return lines.join('\n');
}
