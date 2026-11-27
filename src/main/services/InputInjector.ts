import { clipboard } from 'electron';
import { execFile, spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { buildKeyScript, keyStepsToTokens, PASTE_KEY_TOKENS, parseKeySequence } from '../utils/keyboard';
import { getPluginDir } from '../utils/paths';

const VOICE_PLUGIN_ID = 'local.voice-typing';

const CTRL_V_SCRIPT = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class LvbKeys {
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
}
"@
[LvbKeys]::keybd_event(0x11, 0, 0, [UIntPtr]::Zero)
[LvbKeys]::keybd_event(0x56, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 30
[LvbKeys]::keybd_event(0x56, 0, 2, [UIntPtr]::Zero)
[LvbKeys]::keybd_event(0x11, 0, 2, [UIntPtr]::Zero)
`;

export class InputInjector {
  private helper: ChildProcess | null = null;
  private helperReady: Promise<void> | null = null;
  private helperReader: readline.Interface | null = null;
  private helperWaiter: ((line: string) => void) | null = null;
  private queue: Promise<void> = Promise.resolve();
  private disposed = false;

  /** Start the persistent key helper before the first phone action so there is no cold-start lag. */
  async warmup(): Promise<void> {
    try {
      await this.ensureHelper();
    } catch {
      // Per-action PowerShell fallback is used if the helper is unavailable.
    }
  }

  async inject(text: string): Promise<void> {
    if (!text) return;
    const previous = await clipboard.readText();
    await clipboard.writeText(text);
    await this.runHelperOrFallback(PASTE_KEY_TOKENS, CTRL_V_SCRIPT);
    setTimeout(() => {
      void (async () => {
        try {
          const current = await clipboard.readText();
          if (current === text) await clipboard.writeText(previous);
        } catch { /* clipboard restore is best-effort */ }
      })();
    }, 300);
  }

  async pressKeys(sequence: string): Promise<void> {
    const normalized = String(sequence || '').replace(/\s+/g, '').toLowerCase();
    // Windows ignores synthetic Win+L for security; use the supported
    // LockWorkStation API so the phone's lock button actually locks.
    if (normalized === 'win+l' || normalized === 'lock') {
      await this.lockWorkstation();
      return;
    }
    const steps = parseKeySequence(sequence);
    await this.runHelperOrFallback(keyStepsToTokens(steps), buildKeyScript(steps));
  }

  private lockWorkstation(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (process.platform !== 'win32') {
        reject(new Error('锁屏仅支持 Windows'));
        return;
      }
      execFile('rundll32.exe', ['user32.dll,LockWorkStation'], { windowsHide: true }, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  destroy(): void {
    this.disposed = true;
    try { this.helper?.stdin?.write('Q\n'); } catch { /* ignore */ }
    try { this.helper?.kill(); } catch { /* ignore */ }
    this.resetHelper();
  }

  private async runHelperOrFallback(tokens: string, fallbackScript: string): Promise<void> {
    if (this.disposed) return;
    try {
      await this.enqueueHelperCommand(tokens);
    } catch {
      await this.runPowerShell(fallbackScript);
    }
  }

  private enqueueHelperCommand(tokens: string): Promise<void> {
    const execute = () => this.execHelper(tokens);
    const run = this.queue.then(execute, execute);
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }

  private async execHelper(tokens: string): Promise<void> {
    await this.ensureHelper();
    const helper = this.helper;
    if (!helper || !helper.stdin || helper.stdin.destroyed) throw new Error('按键助手不可用');
    const stdin = helper.stdin;
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (this.helperWaiter === waiter) this.helperWaiter = null;
        if (error) reject(error);
        else resolve();
      };
      const waiter = (line: string) => {
        if (line === 'OK') finish();
        else finish(new Error(line.replace(/^ERR\s*/, '') || '按键失败'));
      };
      const timer = setTimeout(() => finish(new Error('按键助手超时')), 4000);
      this.helperWaiter = waiter;
      stdin.write(`K ${tokens}\n`, (error) => {
        if (error) finish(error);
      });
    });
  }

  private ensureHelper(): Promise<void> {
    if (this.helperReady) return this.helperReady;
    const ready = this.startHelper();
    this.helperReady = ready;
    ready.catch(() => {
      if (this.helperReady === ready) this.helperReady = null;
    });
    return ready;
  }

  private startHelper(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const exePath = path.join(getPluginDir(VOICE_PLUGIN_ID), 'bin', 'AeroKeys.exe');
      if (!fs.existsSync(exePath)) {
        reject(new Error('未找到按键助手'));
        return;
      }

      const child = spawn(exePath, ['--parent', String(process.pid)], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      this.helper = child;
      let started = false;
      const reader = readline.createInterface({ input: child.stdout! });
      this.helperReader = reader;
      const timer = setTimeout(() => {
        if (started) return;
        this.resetHelper();
        reject(new Error('按键助手启动超时'));
      }, 5000);

      reader.on('line', (line) => {
        if (!started) {
          if (line === 'READY') {
            started = true;
            clearTimeout(timer);
            resolve();
          }
          return;
        }
        const waiter = this.helperWaiter;
        if (waiter) {
          this.helperWaiter = null;
          waiter(line);
        }
      });

      child.once('error', (error) => {
        if (!started) {
          clearTimeout(timer);
          this.resetHelper();
          reject(error);
        } else {
          this.resetHelper();
        }
      });
      child.once('exit', () => {
        if (!started) {
          clearTimeout(timer);
          this.resetHelper();
          reject(new Error('按键助手已退出'));
        } else {
          this.resetHelper();
        }
      });
    });
  }

  private resetHelper(): void {
    const waiter = this.helperWaiter;
    this.helperWaiter = null;
    if (waiter) waiter('ERR 按键助手已退出');
    try { this.helperReader?.close(); } catch { /* ignore */ }
    this.helperReader = null;
    this.helper = null;
    this.helperReady = null;
  }

  private runPowerShell(script: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const child = spawn('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        script,
      ], { windowsHide: true, stdio: 'ignore' });
      child.once('error', reject);
      child.once('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`PowerShell exit ${code}`));
      });
    });
  }
}
