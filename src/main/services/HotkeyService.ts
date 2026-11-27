import { globalShortcut } from 'electron';
import type { ConfigService } from './ConfigService';

type HotkeyCallback = () => void;

interface ActionRegistry {
  callback: HotkeyCallback;
  currentAccelerator: string | null; // the successfully registered one
}

export class HotkeyService {
  private configService: ConfigService;
  // action -> { callback, currentAccelerator }
  private actions: Map<string, ActionRegistry> = new Map();

  constructor(configService: ConfigService) {
    this.configService = configService;
  }

  /**
   * Register a callback for an action. The actual hotkey comes from config.
   * Returns {success, message} for feedback.
   */
  registerAction(
    action: string,
    callback: HotkeyCallback
  ): { success: boolean; message: string } {
    // Store the callback so updateHotkey can use it later
    this.actions.set(action, { callback, currentAccelerator: null });

    // Read the configured accelerator from config
    const config = this.configService.get();
    const hotkeys = config.hotkeys as Record<string, string>;
    const accelerator = hotkeys[action] || '';

    if (!accelerator) {
      return { success: false, message: '未设置快捷键' };
    }

    return this.tryRegister(action, accelerator);
  }

  /**
   * Update the hotkey for an action. Persists to config and re-registers.
   */
  updateHotkey(action: string, newAccelerator: string): { success: boolean; message: string } {
    // Unregister current accelerator for this action
    const registry = this.actions.get(action);
    if (registry?.currentAccelerator) {
      try {
        globalShortcut.unregister(registry.currentAccelerator);
      } catch {
        // ignore
      }
      registry.currentAccelerator = null;
    }

    // Persist to config. The action key must exist in AppConfigSchema.
    this.configService.setValue(`hotkeys.${action}`, newAccelerator);

    // Try to register the new accelerator
    return this.tryRegister(action, newAccelerator);
  }

  /**
   * Actually register with the OS. Internal method.
   */
  private tryRegister(
    action: string,
    accelerator: string
  ): { success: boolean; message: string } {
    const registry = this.actions.get(action);
    if (!registry) {
      return { success: false, message: '回调未注册' };
    }

    if (!accelerator || accelerator.trim() === '') {
      return { success: false, message: '快捷键为空' };
    }

    const normalized = accelerator.trim();

    // Validate basic format
    if (!this.isValidAccelerator(normalized)) {
      return { success: false, message: `"${normalized}" 格式无效` };
    }

    try {
      const registered = globalShortcut.register(normalized, () => {
        registry.callback();
      });

      if (registered) {
        registry.currentAccelerator = normalized;
        console.log(`Hotkey registered: ${normalized} for ${action}`);
        return { success: true, message: `已注册: ${normalized}` };
      } else {
        console.warn(`Hotkey "${normalized}" registration failed (may be in use)`);
        return {
          success: false,
          message: `"${normalized}" 可能被其他应用占用，请换一个`,
        };
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`Hotkey error for ${normalized}:`, msg);
      return { success: false, message: `注册失败: ${msg}` };
    }
  }

  /**
   * Basic validation of accelerator format.
   */
  private isValidAccelerator(accel: string): boolean {
    // Single function keys
    if (/^F([1-9]|1[0-9]|2[0-4])$/i.test(accel)) return true;

    // Must contain at least one modifier + key, or be a special key
    const parts = accel.split('+').map((p) => p.trim());
    if (parts.length < 1) return false;

    // If single part, allow special keys
    const singleKeys = [
      'Tab', 'Space', 'Escape', 'Esc', 'Backspace',
      'Insert', 'Delete', 'Home', 'End', 'PageUp', 'PageDown',
      'Up', 'Down', 'Left', 'Right',
      'CapsLock', 'NumLock', 'ScrollLock', 'Pause',
      'PrintScreen',
    ];
    if (parts.length === 1) {
      const key = parts[0];
      return singleKeys.includes(key) || /^F([1-9]|1[0-9]|2[0-4])$/i.test(key);
    }

    // Multi-part: valid modifiers are Ctrl, Alt, Shift, Cmd/Win/Meta
    const validModifiers = ['Ctrl', 'Alt', 'Shift', 'Cmd', 'Win', 'Meta', 'Command'];
    const nonModifiers = parts.filter((p) => !validModifiers.includes(p));
    return nonModifiers.length === 1; // exactly one non-modifier key
  }

  /**
   * Get the currently active accelerator for an action.
   */
  getAccelerator(action: string): string {
    // Return the actually-registered one, or the config value
    const registry = this.actions.get(action);
    if (registry?.currentAccelerator) {
      return registry.currentAccelerator;
    }

    const config = this.configService.get();
    const hotkeys = config.hotkeys as Record<string, string>;
    return hotkeys[action] || '';
  }

  /**
   * Unregister all hotkeys.
   */
  unregisterAll(): void {
    globalShortcut.unregisterAll();
    for (const [, registry] of this.actions) {
      registry.currentAccelerator = null;
    }
  }
}
