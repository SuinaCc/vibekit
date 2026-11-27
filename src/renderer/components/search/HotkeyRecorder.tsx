import { createSignal, createEffect, onCleanup, onMount } from 'solid-js';

interface HotkeyRecorderProps {
  initialHotkey: string;
  onSave: (hotkey: string) => Promise<{ success: boolean; message?: string }>;
  onClose: () => void;
  embedded?: boolean;
}

function normalizeKeyName(key: string): string {
  const map: Record<string, string> = {
    ' ': '空格',
    'Space': '空格',
    'ArrowUp': '↑',
    'ArrowDown': '↓',
    'ArrowLeft': '←',
    'ArrowRight': '→',
    'Control': 'Ctrl',
    'Escape': 'Esc',
    'Tab': 'Tab',
    'Backspace': '退格',
    'Delete': 'Del',
    'Insert': 'Ins',
    'Home': 'Home',
    'End': 'End',
    'PageUp': 'PgUp',
    'PageDown': 'PgDn',
    'CapsLock': '大写',
    'Enter': '回车',
  };
  return map[key] || (key.length === 1 ? key.toUpperCase() : key);
}

function buildAccelerator(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (e.metaKey) parts.push(isMac() ? 'Cmd' : 'Win');

  const key = e.key;
  if (!['Control', 'Alt', 'Shift', 'Meta'].includes(key)) {
    parts.push(normalizeKeyName(key));
  }

  return parts.join('+');
}

function isMac(): boolean {
  return navigator.platform.toUpperCase().includes('MAC');
}

export default function HotkeyRecorder(props: HotkeyRecorderProps) {
  const [recording, setRecording] = createSignal(false);
  const [currentKeys, setCurrentKeys] = createSignal(props.initialHotkey);
  const [status, setStatus] = createSignal<'idle' | 'recording' | 'saving' | 'saved' | 'error'>('idle');

  // Sync from parent when async getHotkey resolves after mount
  createEffect(() => { setCurrentKeys(props.initialHotkey); });
  const [errorMsg, setErrorMsg] = createSignal('');

  const startRecording = () => {
    setRecording(true);
    setCurrentKeys('');
    setStatus('recording');
    setErrorMsg('');
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (!recording()) return;
    e.preventDefault();
    e.stopPropagation();

    if (e.key === 'Escape') {
      setRecording(false);
      setCurrentKeys(props.initialHotkey);
      setStatus('idle');
      return;
    }

    const accelerator = buildAccelerator(e);
    const hasNonModifier = !['Control', 'Alt', 'Shift', 'Meta'].includes(e.key);
    const modifierCount = [e.ctrlKey, e.altKey, e.shiftKey, e.metaKey].filter(Boolean).length;

    if (hasNonModifier || modifierCount >= 2) {
      setCurrentKeys(accelerator);
      setRecording(false);
      handleSave(accelerator);
    } else if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) {
      setCurrentKeys(accelerator + '+…');
    }
  };

  const handleSave = async (accelerator: string) => {
    setStatus('saving');
    const result = await props.onSave(accelerator);
    if (result.success) {
      setStatus('saved');
      setCurrentKeys(accelerator);
      setTimeout(() => props.onClose(), 800);
    } else {
      setStatus('error');
      setErrorMsg(result.message || `"${accelerator}" 注册失败，请换一组按键`);
    }
  };

  onMount(() => {
    const handler = (e: KeyboardEvent) => handleKeyDown(e);
    window.addEventListener('keydown', handler, true);
    onCleanup(() => window.removeEventListener('keydown', handler, true));
  });

  return (
    <div class="hotkey-recorder" classList={{ 'embedded-panel': props.embedded }}>
      {!props.embedded && (
      <div class="hotkey-recorder-header">
        <span class="text-sm font-medium text-text-primary">设置唤起快捷键</span>
        <button class="hotkey-close-btn" onClick={props.onClose}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6 6 18" /><path d="m6 6 12 12" />
          </svg>
        </button>
      </div>
      )}

      <div class="hotkey-recorder-body">
        <p class="text-xs text-text-secondary mb-3">
          支持单键 (如 F1) 或组合键 (如 Ctrl+.)
        </p>

        <button
          class={`hotkey-recorder-btn ${recording() ? 'recording' : ''} ${status() === 'error' ? 'error' : ''} ${status() === 'saved' ? 'saved' : ''}`}
          onClick={startRecording}
          disabled={status() === 'saving'}
        >
          {recording() ? (
            <span class="flex items-center gap-2">
              <span class="recording-dot" />
              请按下按键…
            </span>
          ) : (
            <span class="flex items-center gap-2">
              <kbd class="kbd-lg">{currentKeys() || '点击录制'}</kbd>
              {status() === 'saved' && <span class="text-accent text-xs">✓ 已保存</span>}
            </span>
          )}
        </button>

        {status() === 'error' && (
          <p class="text-xs text-red-400 mt-2">{errorMsg()}</p>
        )}

        <div class="hotkey-presets mt-3">
          <span class="text-xs text-text-muted mb-1 block">快速选择：</span>
          <div class="flex flex-wrap gap-1">
            {['Ctrl+.', 'Ctrl+Shift+K', 'F2', 'Ctrl+Alt+K', 'Alt+Space'].map((hk) => (
              <button
                class="hotkey-preset-chip"
                onClick={() => {
                  setCurrentKeys(hk);
                  handleSave(hk);
                }}
              >
                {hk}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
