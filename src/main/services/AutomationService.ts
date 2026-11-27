import { exec, execFile, type ChildProcess } from 'child_process';
import { clipboard } from 'electron';
import { createHash, randomUUID } from 'crypto';
import * as os from 'os';
import {
  AUTOMATION_PLUGIN_ID,
  DEFAULT_AUTOMATION_SETTINGS,
  type AutomationArgMode,
  type AutomationCommand,
  type AutomationCommandGroup,
  type AutomationCommandInput,
  type AutomationRun,
  type AutomationRunTrigger,
  type AutomationSearchCommand,
  type AutomationSettings,
  type AutomationShell,
  type DnsRecordType,
  type PingResult,
} from '@shared';
import type { DataService } from './DataService';
import type { NetToolsService } from './NetToolsService';
import type { WindowManager } from '../windows/WindowManager';

const STORE_KEY = 'automation-state';
const HISTORY_KEY = 'automation-history';
const HISTORY_LIMIT = 30;
const HISTORY_OUTPUT_LIMIT = 20_000;
const MAX_OUTPUT = 200_000;
const MAX_ARGS = 8_000;
const MAX_SCRIPT = 20_000;
const SHELL_TIMEOUT_MS = 60_000;
const MAX_BUFFER = 4 * 1024 * 1024;
const DNS_TYPES: DnsRecordType[] = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'PTR'];

interface SystemCommandDef {
  builtinId: string;
  token: string;
  name: string;
  description: string;
  aliases: string[];
  argHint: string;
  argMode: AutomationArgMode;
  group: AutomationCommandGroup;
}

const SYSTEM_COMMANDS: SystemCommandDef[] = [
  {
    builtinId: 'public-ip',
    token: 'ip',
    name: '获取公网 IP',
    description: '查询当前网络的公网 IP、地区、运营商和出口节点',
    aliases: ['公网ip', '我的ip', 'public-ip', 'myip'],
    argHint: '',
    argMode: 'none',
    group: 'network',
  },
  {
    builtinId: 'ping',
    token: 'ping',
    name: 'Ping 地址',
    description: '检测主机连通性，返回丢包率与延迟分布',
    aliases: ['ping地址', '延迟', '连通性'],
    argHint: '域名/IP [次数]',
    argMode: 'required',
    group: 'network',
  },
  {
    builtinId: 'dns',
    token: 'dns',
    name: 'DNS 查询',
    description: '查询域名的 A、AAAA、CNAME、MX、TXT 等记录',
    aliases: ['解析', '域名解析'],
    argHint: '域名 [记录类型]',
    argMode: 'required',
    group: 'network',
  },
  {
    builtinId: 'http',
    token: 'http',
    name: 'HTTP 检测',
    description: '请求一个网址，返回状态码、耗时与最终地址',
    aliases: ['状态码', '网址检测'],
    argHint: 'URL',
    argMode: 'required',
    group: 'network',
  },
  {
    builtinId: 'upper',
    token: 'upper',
    name: '文本转大写',
    description: '把输入文本转为大写；留空时处理剪贴板内容',
    aliases: ['大写', '转大写', 'uppercase'],
    argHint: '文本（留空则读取剪贴板）',
    argMode: 'optional',
    group: 'text',
  },
  {
    builtinId: 'lower',
    token: 'lower',
    name: '文本转小写',
    description: '把输入文本转为小写；留空时处理剪贴板内容',
    aliases: ['小写', '转小写', 'lowercase'],
    argHint: '文本（留空则读取剪贴板）',
    argMode: 'optional',
    group: 'text',
  },
  {
    builtinId: 'trim',
    token: 'trim',
    name: '清理空白',
    description: '去掉每行行尾空白与多余空行；留空时处理剪贴板内容',
    aliases: ['清理', '去空白', '整理文本'],
    argHint: '文本（留空则读取剪贴板）',
    argMode: 'optional',
    group: 'text',
  },
  {
    builtinId: 'sort',
    token: 'sort',
    name: '文本行排序',
    description: '按行排序文本；留空时处理剪贴板内容',
    aliases: ['排序', '行排序'],
    argHint: '多行文本（留空则读取剪贴板）',
    argMode: 'optional',
    group: 'text',
  },
  {
    builtinId: 'dedupe',
    token: 'dedupe',
    name: '文本行去重',
    description: '删除重复行并保留首次出现的顺序；留空时处理剪贴板内容',
    aliases: ['去重', '行去重'],
    argHint: '多行文本（留空则读取剪贴板）',
    argMode: 'optional',
    group: 'text',
  },
  {
    builtinId: 'json',
    token: 'json',
    name: 'JSON 格式化',
    description: '把压缩的 JSON 格式化为两空格缩进；留空时处理剪贴板内容',
    aliases: ['格式化', 'json格式化', '格式化json'],
    argHint: 'JSON（留空则读取剪贴板）',
    argMode: 'optional',
    group: 'text',
  },
  {
    builtinId: 'count',
    token: 'count',
    name: '文本统计',
    description: '统计字符、行、词与 UTF-8 字节数；留空时处理剪贴板内容',
    aliases: ['统计', '字数', '文本统计'],
    argHint: '文本（留空则读取剪贴板）',
    argMode: 'optional',
    group: 'text',
  },
  {
    builtinId: 'b64e',
    token: 'b64e',
    name: 'Base64 编码',
    description: '把文本编码为 Base64；留空时处理剪贴板内容',
    aliases: ['base64编码', '编码'],
    argHint: '文本（留空则读取剪贴板）',
    argMode: 'optional',
    group: 'util',
  },
  {
    builtinId: 'b64d',
    token: 'b64d',
    name: 'Base64 解码',
    description: '解码 Base64 文本；留空时处理剪贴板内容',
    aliases: ['base64解码', '解码'],
    argHint: 'Base64（留空则读取剪贴板）',
    argMode: 'optional',
    group: 'util',
  },
  {
    builtinId: 'urlenc',
    token: 'urlenc',
    name: 'URL 编码',
    description: '对文本做 URL 组件编码；留空时处理剪贴板内容',
    aliases: ['url编码', '链接编码'],
    argHint: '文本（留空则读取剪贴板）',
    argMode: 'optional',
    group: 'util',
  },
  {
    builtinId: 'urldec',
    token: 'urldec',
    name: 'URL 解码',
    description: '还原 URL 编码的文本；留空时处理剪贴板内容',
    aliases: ['url解码', '链接解码'],
    argHint: 'URL 编码文本（留空则读取剪贴板）',
    argMode: 'optional',
    group: 'util',
  },
  {
    builtinId: 'uuid',
    token: 'uuid',
    name: '生成 UUID',
    description: '生成一个随机的 UUID v4',
    aliases: ['随机id', '生成uuid'],
    argHint: '',
    argMode: 'none',
    group: 'util',
  },
  {
    builtinId: 'sha256',
    token: 'sha256',
    name: 'SHA-256 摘要',
    description: '计算文本的 SHA-256 哈希；留空时处理剪贴板内容',
    aliases: ['哈希', '摘要'],
    argHint: '文本（留空则读取剪贴板）',
    argMode: 'optional',
    group: 'util',
  },
];

interface StoredState {
  enabled: Record<string, boolean>;
  stats: Record<string, { usageCount: number; lastRunAt: number | null }>;
  custom: AutomationCommand[];
  settings: AutomationSettings;
}

class AutomationError extends Error {
  constructor(
    message: string,
    public readonly output = '',
  ) {
    super(message);
  }
}

function clampText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

// cmd.exe writes redirected pipes in the OEM code page (GBK on Chinese
// Windows), even after `chcp 65001`. Try strict UTF-8 first, then fall back
// to GBK so localized command output doesn't turn into replacement chars.
function decodeWindowsOutput(buffer: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    try {
      return new TextDecoder('gbk').decode(buffer);
    } catch {
      return buffer.toString('latin1');
    }
  }
}

// powershell.exe serializes its error stream as CLIXML when stderr is a pipe.
// Turn those records back into readable text for the result window.
function decodePowerShellStderr(text: string): string {
  if (!text.includes('#< CLIXML')) return text;
  const decodeEntities = (value: string) =>
    value
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&');
  const errors: string[] = [];
  const pattern = /<S S="Error">([\s\S]*?)<\/S>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    errors.push(decodeEntities(match[1]).replace(/_x000D__x000A_/g, '\n'));
  }
  return errors.join('\n').trim();
}

function normalizeAliases(value: unknown): string[] {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,，]/) : [];
  const seen = new Set<string>();
  const aliases: string[] = [];
  for (const item of list) {
    if (typeof item !== 'string') continue;
    const alias = item.trim();
    const key = alias.toLowerCase();
    if (!alias || alias.length > 24 || /\s/.test(alias) || seen.has(key)) continue;
    seen.add(key);
    aliases.push(alias);
    if (aliases.length >= 8) break;
  }
  return aliases;
}

function normalizeArgMode(value: unknown): AutomationArgMode {
  return value === 'none' || value === 'required' ? value : 'optional';
}

function normalizeShell(value: unknown): AutomationShell {
  return value === 'powershell' ? 'powershell' : 'cmd';
}

function splitArgs(raw: string): string[] {
  const args: string[] = [];
  let current = '';
  let quote: string | null = null;
  for (const char of raw) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }
  if (current) args.push(current);
  return args;
}

function unwrapText(raw: string): string {
  const text = raw.trim();
  if (text.length >= 2) {
    const first = text[0];
    if ((first === '"' || first === "'") && text[text.length - 1] === first) {
      return text.slice(1, -1);
    }
  }
  return text;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export class AutomationService {
  private state: StoredState;
  private history: AutomationRun[];
  private runs = new Map<string, AutomationRun>();
  private pending = new Map<string, Promise<void>>();
  private children = new Map<string, ChildProcess>();

  constructor(
    private readonly dataService: DataService,
    private readonly netToolsService: NetToolsService,
    private readonly windowManager: WindowManager,
  ) {
    this.state = this.loadState();
    this.history = this.loadHistory();
  }

  // --- Command library ---

  list(): AutomationCommand[] {
    const system = SYSTEM_COMMANDS.map((def) => this.toSystemCommand(def));
    const custom = [...this.state.custom].sort((a, b) => b.createdAt - a.createdAt);
    return [...system, ...custom];
  }

  listEnabled(): AutomationSearchCommand[] {
    return this.list()
      .filter((command) => command.enabled)
      .map((command) => ({
        id: command.id,
        token: command.token,
        name: command.name,
        description: command.description,
        aliases: [...command.aliases],
        argHint: command.argHint,
        argMode: command.argMode,
      }));
  }

  saveCommand(input: AutomationCommandInput): AutomationCommand {
    if (!input || typeof input !== 'object') throw new Error('命令数据无效');
    const token = clampText(input.token, 24).trim();
    if (!/^[\p{L}\p{N}_-]+$/u.test(token)) {
      throw new Error('命令名称只能包含文字、数字、下划线或短横线');
    }
    const name = clampText(input.name, 40).trim();
    if (!name) throw new Error('请填写显示名称');
    const description = clampText(input.description, 200).trim();
    const argHint = clampText(input.argHint, 60).trim();
    const aliases = normalizeAliases(input.aliases);
    const shell = normalizeShell(input.shell);
    const script = clampText(input.script, MAX_SCRIPT).trim();
    if (!script) throw new Error('请填写脚本内容');
    const argMode = normalizeArgMode(input.argMode);

    const existing = input.id ? this.state.custom.find((command) => command.id === input.id) : undefined;
    if (input.id && !existing) throw new Error('自定义命令不存在');

    const tokenKey = token.toLowerCase();
    const aliasKeys = new Set(aliases.map((alias) => alias.toLowerCase()));
    for (const command of this.list()) {
      if (command.id === existing?.id) continue;
      const keys = [command.token, ...command.aliases].map((key) => key.toLowerCase());
      if (keys.includes(tokenKey)) throw new Error(`命令名称「${token}」已被占用`);
      if (keys.some((key) => aliasKeys.has(key))) throw new Error('别名与其他命令冲突');
    }

    const now = Date.now();
    const command: AutomationCommand = existing
      ? {
          ...existing,
          token,
          name,
          description,
          aliases,
          argHint,
          argMode,
          shell,
          script,
          enabled: typeof input.enabled === 'boolean' ? input.enabled : existing.enabled,
          updatedAt: now,
        }
      : {
          id: `custom.${randomUUID()}`,
          token,
          name,
          description,
          aliases,
          argHint,
          argMode,
          group: 'custom',
          source: 'custom',
          shell,
          script,
          enabled: typeof input.enabled === 'boolean' ? input.enabled : true,
          createdAt: now,
          updatedAt: now,
          usageCount: 0,
          lastRunAt: null,
        };

    if (existing) {
      this.state.custom = this.state.custom.map((item) => (item.id === existing.id ? command : item));
    } else {
      this.state.custom.push(command);
    }
    this.persistState();
    return { ...command };
  }

  deleteCommand(id: string): void {
    const command = this.state.custom.find((item) => item.id === id);
    if (!command) throw new Error('只能删除自定义命令');
    this.state.custom = this.state.custom.filter((item) => item.id !== id);
    this.persistState();
  }

  setEnabled(id: string, enabled: boolean): AutomationCommand {
    const systemDef = SYSTEM_COMMANDS.find((def) => `sys.${def.builtinId}` === id);
    if (systemDef) {
      this.state.enabled[id] = enabled === true;
      this.persistState();
      return this.toSystemCommand(systemDef);
    }
    const custom = this.state.custom.find((item) => item.id === id);
    if (!custom) throw new Error('命令不存在');
    custom.enabled = enabled === true;
    custom.updatedAt = Date.now();
    this.persistState();
    return { ...custom };
  }

  getSettings(): AutomationSettings {
    return { ...this.state.settings };
  }

  setSettings(patch: Partial<AutomationSettings>): AutomationSettings {
    const next: AutomationSettings = {
      autoCopy: typeof patch?.autoCopy === 'boolean' ? patch.autoCopy : this.state.settings.autoCopy,
    };
    this.state.settings = next;
    this.persistState();
    return { ...next };
  }

  getHistory(): AutomationRun[] {
    return this.history.map((run) => ({ ...run }));
  }

  clearHistory(): void {
    this.history = [];
    this.dataService.set(AUTOMATION_PLUGIN_ID, HISTORY_KEY, []);
  }

  getRun(runId: string): AutomationRun | null {
    const run = this.runs.get(runId);
    return run ? { ...run } : null;
  }

  // --- Execution ---

  start(
    commandId: string,
    rawArgs: string,
    trigger: AutomationRunTrigger,
    openWindow: boolean,
  ): AutomationRun {
    const command = this.list().find((item) => item.id === commandId);
    if (!command) throw new Error('命令不存在');
    if (!command.enabled && trigger === 'search') throw new Error('该命令已关闭');
    const args = clampText(rawArgs, MAX_ARGS).trim();
    if (command.argMode === 'required' && !args) {
      throw new Error(`请填写参数：${command.argHint || '参数'}`);
    }

    const run: AutomationRun = {
      id: randomUUID(),
      commandId: command.id,
      token: command.token,
      name: command.name,
      args,
      commandLine: `${command.token}${args ? ` ${args}` : ''}`,
      status: 'running',
      output: '',
      startedAt: Date.now(),
      autoCopied: false,
      trigger,
    };
    this.runs.set(run.id, run);
    this.broadcast(run);
    this.pruneRuns();
    if (openWindow) this.windowManager.createAutomationResultWindow(run.id);

    const task = this.executeRun(command, run)
      .catch(() => {
        /* failures are reflected on the run */
      })
      .finally(() => {
        this.pending.delete(run.id);
      });
    this.pending.set(run.id, task);
    return { ...run };
  }

  async runAndWait(commandId: string, rawArgs: string): Promise<AutomationRun> {
    const run = this.start(commandId, rawArgs, 'panel', false);
    await this.pending.get(run.id);
    return { ...(this.runs.get(run.id) ?? run) };
  }

  destroy(): void {
    for (const child of this.children.values()) {
      try {
        child.kill();
      } catch {
        // already gone
      }
    }
    this.children.clear();
  }

  // --- Internals ---

  private async executeRun(command: AutomationCommand, run: AutomationRun): Promise<void> {
    try {
      const result =
        command.source === 'system' && command.builtinId
          ? await this.runBuiltin(command.builtinId, run.args)
          : await this.runShell(command, run.args, run.id);
      run.output = this.clampOutput(result.output);
      run.exitCode = result.exitCode ?? null;
      run.status = 'success';
      if (this.state.settings.autoCopy && run.output.trim()) {
        await clipboard.writeText(run.output);
        run.autoCopied = true;
      }
    } catch (err) {
      run.status = 'error';
      run.error = err instanceof Error ? err.message : String(err);
      if (err instanceof AutomationError && err.output) {
        run.output = this.clampOutput(err.output);
      }
    } finally {
      run.finishedAt = Date.now();
      run.durationMs = run.finishedAt - run.startedAt;
      this.bumpUsage(command, run.finishedAt);
      this.pushHistory(run);
      this.broadcast(run);
    }
  }

  private async runBuiltin(
    builtinId: string,
    rawArgs: string,
  ): Promise<{ output: string; exitCode?: number | null }> {
    switch (builtinId) {
      case 'public-ip': {
        const info = await this.netToolsService.info(true);
        if (!info.ip) throw new Error(info.error ? `获取公网 IP 失败：${info.error}` : '无法获取公网 IP');
        const location = [info.country, info.city].filter(Boolean).join(' · ') || '—';
        const lines = [
          `公网 IP    ${info.ip}`,
          `地区       ${location}`,
          `运营商     ${info.isp || '—'}`,
          `出口节点   ${info.colo || '—'}`,
        ];
        return { output: lines.join('\n') };
      }
      case 'ping': {
        const tokens = splitArgs(rawArgs);
        const host = tokens[0];
        if (!host) throw new Error('请填写要 Ping 的域名或 IP');
        const count = tokens[1] ? Number.parseInt(tokens[1], 10) : 4;
        const result = await this.netToolsService.ping(host, Number.isFinite(count) ? count : 4);
        const output = this.formatPing(result);
        if (!result.received) {
          throw new AutomationError(result.error || '无法 Ping 通目标主机', output);
        }
        return { output };
      }
      case 'dns': {
        const tokens = splitArgs(rawArgs);
        const host = tokens[0];
        if (!host) throw new Error('请填写要查询的域名');
        const typeArg = (tokens[1] || 'A').toUpperCase() as DnsRecordType;
        const type = DNS_TYPES.includes(typeArg) ? typeArg : 'A';
        const result = await this.netToolsService.dnsLookup(host, type);
        const header = `${host} · ${type} 记录 · ${result.durationMs} ms`;
        if (result.error) {
          throw new AutomationError(`DNS 查询失败：${result.error}`, header);
        }
        const records = result.records.length
          ? result.records.map((record, index) => `${String(index + 1).padStart(2, ' ')}. ${record}`).join('\n')
          : '（没有记录）';
        return { output: `${header}\n\n${records}` };
      }
      case 'http': {
        const tokens = splitArgs(rawArgs);
        const url = tokens[0];
        if (!url) throw new Error('请填写要检测的 URL');
        const result = await this.netToolsService.httpCheck(url);
        if (result.error) throw new Error(`HTTP 检测失败：${result.error}`);
        return {
          output: [
            `${result.method} ${result.url}`,
            `状态       ${result.status} ${result.statusText}`.trimEnd(),
            `耗时       ${result.durationMs} ms`,
            `最终地址   ${result.finalUrl}`,
          ].join('\n'),
        };
      }
      case 'upper':
        return { output: (await this.readTextInput(rawArgs)).toLocaleUpperCase() };
      case 'lower':
        return { output: (await this.readTextInput(rawArgs)).toLocaleLowerCase() };
      case 'trim': {
        const input = await this.readTextInput(rawArgs);
        const output = input
          .split(/\r?\n/)
          .map((line) => line.replace(/\s+$/u, ''))
          .join('\n')
          .replace(/^\n+/u, '')
          .replace(/\n+$/u, '')
          .replace(/\n{3,}/gu, '\n\n');
        return { output };
      }
      case 'sort': {
        const input = await this.readTextInput(rawArgs);
        const output = input
          .split(/\r?\n/)
          .sort((a, b) => a.localeCompare(b))
          .join('\n');
        return { output };
      }
      case 'dedupe': {
        const input = await this.readTextInput(rawArgs);
        const seen = new Set<string>();
        const output = input
          .split(/\r?\n/)
          .filter((line) => {
            if (seen.has(line)) return false;
            seen.add(line);
            return true;
          })
          .join('\n');
        return { output };
      }
      case 'json': {
        const input = await this.readTextInput(rawArgs);
        try {
          return { output: JSON.stringify(JSON.parse(input), null, 2) };
        } catch {
          throw new Error('JSON 格式无效，无法格式化');
        }
      }
      case 'count': {
        const input = await this.readTextInput(rawArgs);
        const lines = input ? input.split(/\r?\n/).length : 0;
        const words = input.trim() ? input.trim().split(/\s+/u).length : 0;
        const chars = [...input].length;
        return {
          output: [
            `字符       ${chars}`,
            `行         ${lines}`,
            `词         ${words}`,
            `UTF-8 字节 ${formatBytes(Buffer.byteLength(input, 'utf8'))}`,
          ].join('\n'),
        };
      }
      case 'b64e':
        return { output: Buffer.from(await this.readTextInput(rawArgs), 'utf8').toString('base64') };
      case 'b64d': {
        const input = (await this.readTextInput(rawArgs)).replace(/\s+/gu, '');
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(input)) throw new Error('不是有效的 Base64 文本');
        return { output: Buffer.from(input, 'base64').toString('utf8') };
      }
      case 'urlenc':
        return { output: encodeURIComponent(await this.readTextInput(rawArgs)) };
      case 'urldec': {
        const input = await this.readTextInput(rawArgs);
        try {
          return { output: decodeURIComponent(input) };
        } catch {
          throw new Error('不是有效的 URL 编码文本');
        }
      }
      case 'uuid':
        return { output: randomUUID() };
      case 'sha256':
        return {
          output: createHash('sha256').update(await this.readTextInput(rawArgs), 'utf8').digest('hex'),
        };
      default:
        throw new Error('未知的系统命令');
    }
  }

  private async runShell(
    command: AutomationCommand,
    rawArgs: string,
    runId: string,
  ): Promise<{ output: string; exitCode?: number | null }> {
    const script = await this.renderScript(command, rawArgs);
    return new Promise((resolve, reject) => {
      const baseOptions = {
        cwd: os.homedir(),
        timeout: SHELL_TIMEOUT_MS,
        maxBuffer: MAX_BUFFER,
        windowsHide: true,
        env: process.env,
      };
      const callback = (error: Error | null, stdout: string, stderr: string) => {
        this.children.delete(runId);
        const stderrText = decodePowerShellStderr(stderr).trimEnd();
        const output = [stdout.trimEnd(), stderrText ? `[stderr]\n${stderrText}` : '']
          .filter(Boolean)
          .join('\n\n');
        if (!error) {
          resolve({ output, exitCode: 0 });
          return;
        }
        const failed = error as Error & { code?: number | string; killed?: boolean };
        const exitCode = typeof failed.code === 'number' ? failed.code : null;
        let message: string;
        if (failed.killed || /timed out/i.test(failed.message)) {
          message = `脚本执行超时（${Math.round(SHELL_TIMEOUT_MS / 1000)} 秒）`;
        } else if (/maxBuffer/i.test(failed.message)) {
          message = '脚本输出过大，已终止';
        } else if (exitCode != null) {
          message = `脚本执行失败（退出码 ${exitCode}）`;
        } else {
          message = `脚本执行失败：${failed.message}`;
        }
        reject(new AutomationError(message, output));
      };

      let child: ChildProcess;
      if (command.shell === 'powershell') {
        if (process.platform !== 'win32') {
          reject(new Error('PowerShell 脚本仅支持 Windows'));
          return;
        }
        const psScript = `$ProgressPreference='SilentlyContinue'; [Console]::OutputEncoding=[Text.Encoding]::UTF8; $OutputEncoding=[Text.Encoding]::UTF8; ${script}`;
        // -EncodedCommand avoids Node's Windows argument quoting mangling
        // scripts that contain quotes, dollar signs or newlines.
        const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
        child = execFile(
          'powershell.exe',
          ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
          { ...baseOptions, encoding: 'utf8' as const },
          callback,
        );
      } else if (process.platform === 'win32') {
        child = exec(
          `chcp 65001>nul & ${script}`,
          { ...baseOptions, encoding: 'buffer' as const },
          (error, stdout: Buffer, stderr: Buffer) =>
            callback(error, decodeWindowsOutput(stdout), decodeWindowsOutput(stderr)),
        );
      } else {
        child = exec(script, { ...baseOptions, encoding: 'utf8' as const }, callback);
      }
      this.children.set(runId, child);
    });
  }

  private async renderScript(command: AutomationCommand, rawArgs: string): Promise<string> {
    if (command.argMode === 'required' && !rawArgs.trim()) {
      throw new Error(`请填写参数：${command.argHint || '参数'}`);
    }
    const tokens = splitArgs(rawArgs);
    const escape = (value: string) => this.quoteShellArg(value, command.shell);
    const clipboardText = await clipboard.readText();
    return (command.script || '')
      .replace(/\{clipboard\}/gi, () => clipboardText)
      .replace(/\{args\}/gi, () => rawArgs)
      .replace(/\{(\d+)\}/g, (_, index: string) => escape(tokens[Number(index) - 1] ?? ''));
  }

  private quoteShellArg(value: string, shell?: AutomationShell): string {
    if (shell === 'powershell') return `'${value.replace(/'/g, "''")}'`;
    if (process.platform !== 'win32') return `'${value.replace(/'/g, `'\\''`)}'`;
    return `"${value.replace(/%/g, '%%').replace(/"/g, '\\"')}"`;
  }

  private async readTextInput(rawArgs: string): Promise<string> {
    if (rawArgs.trim()) return unwrapText(rawArgs);
    const text = await clipboard.readText();
    if (!text) throw new Error('没有参数，剪贴板也为空');
    return text;
  }

  private formatPing(result: PingResult): string {
    const latency = result.avgMs == null
      ? '—'
      : `最小 ${result.minMs} ms · 平均 ${result.avgMs} ms · 最大 ${result.maxMs} ms · 抖动 ${result.jitterMs ?? '—'} ms`;
    const lines = [
      `Ping ${result.host}（${result.sent} 次）`,
      `解析地址   ${result.resolvedIp || '—'}`,
      `丢包       ${result.lossPercent}%`,
      `延迟       ${latency}`,
    ];
    if (result.rtts.length) {
      lines.push('', ...result.rtts.map((rtt, index) => `#${index + 1}         ${rtt} ms`));
    }
    if (result.error) lines.push('', result.error);
    return lines.join('\n');
  }

  private toSystemCommand(def: SystemCommandDef): AutomationCommand {
    const id = `sys.${def.builtinId}`;
    const stats = this.state.stats[id];
    return {
      id,
      token: def.token,
      name: def.name,
      description: def.description,
      aliases: [...def.aliases],
      argHint: def.argHint,
      argMode: def.argMode,
      group: def.group,
      source: 'system',
      builtinId: def.builtinId,
      enabled: this.state.enabled[id] !== false,
      createdAt: 0,
      updatedAt: 0,
      usageCount: stats?.usageCount ?? 0,
      lastRunAt: stats?.lastRunAt ?? null,
    };
  }

  private loadState(): StoredState {
    const fallback: StoredState = {
      enabled: {},
      stats: {},
      custom: [],
      settings: { ...DEFAULT_AUTOMATION_SETTINGS },
    };
    const raw = this.dataService.get(AUTOMATION_PLUGIN_ID, STORE_KEY);
    if (!raw || typeof raw !== 'object') return fallback;
    const value = raw as Record<string, unknown>;
    const storedEnabled = value.enabled && typeof value.enabled === 'object'
      ? (value.enabled as Record<string, unknown>)
      : {};
    const enabled: Record<string, boolean> = {};
    for (const [key, item] of Object.entries(storedEnabled)) {
      if (typeof item === 'boolean') enabled[key] = item;
    }
    const stats: StoredState['stats'] = {};
    if (value.stats && typeof value.stats === 'object') {
      for (const [key, item] of Object.entries(value.stats as Record<string, unknown>)) {
        if (!item || typeof item !== 'object') continue;
        const entry = item as Record<string, unknown>;
        stats[key] = {
          usageCount: typeof entry.usageCount === 'number' ? entry.usageCount : 0,
          lastRunAt: typeof entry.lastRunAt === 'number' ? entry.lastRunAt : null,
        };
      }
    }
    const custom: AutomationCommand[] = [];
    if (Array.isArray(value.custom)) {
      for (const item of value.custom) {
        if (!item || typeof item !== 'object') continue;
        const entry = item as Record<string, unknown>;
        const token = typeof entry.token === 'string' ? entry.token : '';
        const script = typeof entry.script === 'string' ? entry.script : '';
        if (!token || !script) continue;
        custom.push({
          id: typeof entry.id === 'string' ? entry.id : `custom.${randomUUID()}`,
          token,
          name: typeof entry.name === 'string' ? entry.name : token,
          description: typeof entry.description === 'string' ? entry.description : '',
          aliases: normalizeAliases(entry.aliases),
          argHint: typeof entry.argHint === 'string' ? entry.argHint : '',
          argMode: normalizeArgMode(entry.argMode),
          group: 'custom',
          source: 'custom',
          shell: normalizeShell(entry.shell),
          script,
          enabled: entry.enabled !== false,
          createdAt: typeof entry.createdAt === 'number' ? entry.createdAt : Date.now(),
          updatedAt: typeof entry.updatedAt === 'number' ? entry.updatedAt : Date.now(),
          usageCount: typeof entry.usageCount === 'number' ? entry.usageCount : 0,
          lastRunAt: typeof entry.lastRunAt === 'number' ? entry.lastRunAt : null,
        });
      }
    }
    const settingsRaw = value.settings && typeof value.settings === 'object'
      ? (value.settings as Record<string, unknown>)
      : {};
    return {
      enabled,
      stats,
      custom,
      settings: {
        autoCopy: typeof settingsRaw.autoCopy === 'boolean'
          ? settingsRaw.autoCopy
          : DEFAULT_AUTOMATION_SETTINGS.autoCopy,
      },
    };
  }

  private loadHistory(): AutomationRun[] {
    const raw = this.dataService.get(AUTOMATION_PLUGIN_ID, HISTORY_KEY);
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((item): item is AutomationRun =>
        !!item
        && typeof item === 'object'
        && typeof (item as AutomationRun).id === 'string'
        && typeof (item as AutomationRun).output === 'string'
        && (item as AutomationRun).status !== 'running',
      )
      .slice(0, HISTORY_LIMIT)
      .map((run) => ({ ...run }));
  }

  private persistState(): void {
    this.dataService.set(AUTOMATION_PLUGIN_ID, STORE_KEY, this.state);
  }

  private bumpUsage(command: AutomationCommand, timestamp: number): void {
    if (command.source === 'system') {
      const current = this.state.stats[command.id];
      this.state.stats[command.id] = {
        usageCount: (current?.usageCount ?? 0) + 1,
        lastRunAt: timestamp,
      };
    } else {
      const custom = this.state.custom.find((item) => item.id === command.id);
      if (custom) {
        custom.usageCount += 1;
        custom.lastRunAt = timestamp;
      }
    }
    this.persistState();
  }

  private pushHistory(run: AutomationRun): void {
    const entry: AutomationRun = {
      ...run,
      output: run.output.slice(0, HISTORY_OUTPUT_LIMIT),
    };
    this.history = [entry, ...this.history.filter((item) => item.id !== run.id)].slice(0, HISTORY_LIMIT);
    this.dataService.set(AUTOMATION_PLUGIN_ID, HISTORY_KEY, this.history);
  }

  private broadcast(run: AutomationRun): void {
    this.windowManager.broadcastToAll('aero:automation-run', { ...run });
  }

  private clampOutput(output: string): string {
    if (output.length <= MAX_OUTPUT) return output;
    return `${output.slice(0, MAX_OUTPUT)}\n\n…（输出已截断）`;
  }

  private pruneRuns(): void {
    if (this.runs.size <= 40) return;
    const finished = [...this.runs.values()]
      .filter((run) => run.status !== 'running')
      .sort((a, b) => (a.finishedAt ?? 0) - (b.finishedAt ?? 0));
    for (const run of finished.slice(0, this.runs.size - 30)) {
      this.runs.delete(run.id);
    }
  }
}
