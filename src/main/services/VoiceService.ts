import { app } from 'electron';
import * as crypto from 'crypto';
import * as dgram from 'dgram';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import QRCode from 'qrcode';
import type { VoiceConfig, VoiceMacro, VoiceSessionInfo, VoiceStatus } from '@shared';
import type { ConfigService } from './ConfigService';
import type { EventRouter } from './EventRouter';
import type { InputInjector } from './InputInjector';

const MAX_TEXT_BYTES = 64 * 1024;
const MAX_TEXT_LENGTH = 20_000;
const MAX_MACROS = 24;

const VIRTUAL_ADAPTER_RE = /vmware|vmnet|virtualbox|virtual box|vbox|hyper-?v|vethernet|wsl|docker|virtual|loopback|tap-windows|\btap\b|tunnel|tun\b|vpn|tailscale|zerotier|radmin|clash|mihomo|sing-?box|hiddify|openvpn|wireguard|host-only|teredo|isatap|npcap|km-test|wan miniport|wi-?fi direct|hosted network|移动热点|蓝牙网络|bluetooth network|sangfor|easyconnect|anyconnect|fortinet|pppoe|utun/i;
const ETHERNET_ADAPTER_RE = /以太网|ethernet|本地连接|local area connection|gbe|gigabit|千兆|万兆/i;
const WIFI_ADAPTER_RE = /wlan|wi-?fi|wireless|无线/i;

interface LanCandidate {
  name: string;
  address: string;
  score: number;
  virtual: boolean;
}

function isPrivateIpv4(address: string): boolean {
  if (/^10\./.test(address)) return true;
  if (/^192\.168\./.test(address)) return true;
  return /^172\.(1[6-9]|2\d|3[01])\./.test(address);
}

function sanitizeMacros(input: unknown): VoiceMacro[] {
  if (!Array.isArray(input)) return [];
  const macros: VoiceMacro[] = [];
  const seen = new Set<string>();
  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Record<string, unknown>;
    const label = typeof raw.label === 'string' ? raw.label.trim().slice(0, 40) : '';
    const keys = typeof raw.keys === 'string' ? raw.keys.trim().slice(0, 500) : '';
    if (!label || !keys) continue;
    let id = typeof raw.id === 'string' ? raw.id.trim().slice(0, 64) : '';
    if (!id || seen.has(id)) id = `m${macros.length + 1}-${Date.now().toString(36)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    macros.push({ id, label, keys });
    if (macros.length >= MAX_MACROS) break;
  }
  return macros;
}

/**
 * Phone-as-keyboard relay: the phone page is a plain HTTP form. The user
 * dictates into a textarea with their phone IME (e.g. Doubao voice input),
 * the page posts the committed text here, and we paste it into the focused PC
 * window. No microphone access, no HTTPS, no STT API key.
 */
export class VoiceService {
  private httpServer: http.Server | null = null;
  private token = '';
  private session: VoiceSessionInfo | null = null;
  private status: VoiceStatus = { state: 'idle' };
  private phoneHtmlCache: { content: string; mtimeMs: number } | null = null;

  constructor(
    private configService: ConfigService,
    private eventRouter: EventRouter,
    private inputInjector: InputInjector,
  ) {}

  getConfig(): VoiceConfig {
    const voice = this.configService.get().voice;
    return {
      httpPort: voice.httpPort,
      macros: voice.macros.map((macro) => ({ ...macro })),
    };
  }

  setConfig(patch: Partial<VoiceConfig>): VoiceConfig {
    if (patch.httpPort !== undefined) {
      this.configService.setValue('voice.httpPort', this.validPort(patch.httpPort));
    }
    if (patch.macros !== undefined) {
      this.configService.setValue('voice.macros', sanitizeMacros(patch.macros));
    }
    return this.getConfig();
  }

  getStatus(): VoiceStatus {
    return { ...this.status };
  }

  async startSession(): Promise<VoiceSessionInfo> {
    if (this.session) return this.session;
    await this.startServer();
    await this.inputInjector.warmup();
    this.token = crypto.randomBytes(18).toString('hex');
    const config = this.getConfig();
    const candidates = this.lanCandidates();
    // The OS routing table is the strongest signal: it is the address an
    // outbound connection would actually leave from, so on a machine with
    // VMware/WSL adapters it still points at the real Ethernet/Wi-Fi NIC.
    const defaultAddress = await this.preferredAddress();
    if (defaultAddress) {
      const match = candidates.find((candidate) => candidate.address === defaultAddress);
      if (match) {
        if (!match.virtual) match.score += 200;
        // If the default route runs through a tunnel (VPN), trusting it would
        // hand the phone an address it cannot reach from the same LAN, so only
        // physical-looking adapters get the routing bonus.
      }
    }
    candidates.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    const chosen = candidates.find((candidate) => !candidate.virtual) ?? candidates[0];
    const ip = chosen?.address ?? '127.0.0.1';
    const phoneUrl = `http://${ip}:${config.httpPort}/?t=${this.token}`;
    const qrDataUrl = await QRCode.toDataURL(phoneUrl, { margin: 1, width: 280 });
    this.session = {
      phoneUrl,
      qrDataUrl,
      networkName: chosen ? `${chosen.name} · ${chosen.address}` : undefined,
    };
    this.emitStatus('listening', '等待手机输入');
    return this.session;
  }

  getSession(): VoiceSessionInfo | null {
    return this.session ? { ...this.session } : null;
  }

  stopSession(): void {
    this.closeServer();
    this.token = '';
    this.session = null;
    this.emitStatus('idle');
  }

  destroy(): void {
    this.stopSession();
    this.inputInjector.destroy();
  }

  private async startServer(): Promise<void> {
    if (this.httpServer) return;
    const config = this.getConfig();
    const server = http.createServer((req, res) => {
      void this.handleHttpRequest(req, res);
    });

    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(config.httpPort, '0.0.0.0', () => {
          server.off('error', reject);
          resolve();
        });
      });
    } catch (error) {
      try { server.close(); } catch { /* ignore */ }
      this.emitStatus('error', error instanceof Error ? error.message : String(error));
      throw error;
    }
    this.httpServer = server;
  }

  private closeServer(): void {
    if (!this.httpServer) return;
    try { this.httpServer.close(); } catch { /* ignore */ }
    this.httpServer = null;
  }

  private async handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url || '/', 'http://localhost');
    const token = url.searchParams.get('t') || '';
    if (!this.token || token !== this.token) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('无效或过期的会话 token');
      return;
    }

    if (url.pathname === '/' && req.method === 'GET') {
      const html = await this.phonePageHtml();
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(html);
      return;
    }

    // PWA home-screen icon for the phone page
    if (url.pathname === '/icon.png' && req.method === 'GET') {
      const iconPath = process.env.ELECTRON_IS_DEV || !app.isPackaged
        ? path.join(app.getAppPath(), 'build', 'icon.png')
        : path.join(process.resourcesPath, 'icon.png');
      try {
        const icon = fs.readFileSync(iconPath);
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
        res.end(icon);
      } catch {
        res.writeHead(404);
        res.end();
      }
      return;
    }

    if (url.pathname === '/api/input' && req.method === 'POST') {
      void this.handleInput(req, res);
      return;
    }

    if (url.pathname === '/api/send' && req.method === 'POST') {
      void this.handleSend(req, res);
      return;
    }

    if (url.pathname === '/api/key' && req.method === 'POST') {
      void this.handleKey(req, res);
      return;
    }

    if (url.pathname === '/api/state' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(JSON.stringify({ macros: this.getConfig().macros }));
      return;
    }

    res.writeHead(404);
    res.end('Not Found');
  }

  private async handleInput(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const body = await this.readBody(req);
      let text = '';
      try {
        const data = JSON.parse(body.toString('utf8')) as { text?: unknown };
        text = typeof data.text === 'string' ? data.text.trim() : '';
      } catch {
        throw new Error('请求内容不是合法 JSON');
      }
      if (!text) throw new Error('没有收到文字');
      if (text.length > MAX_TEXT_LENGTH) throw new Error('文字过长');

      this.emitStatus('typing', '正在输入…');
      await this.inputInjector.inject(text);
      this.eventRouter.emit('vibekit:voiceTranscript', { text });
      this.emitStatus('idle');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, length: text.length }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emitStatus('error', message);
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: message }));
    }
  }

  private async handleSend(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const body = await this.readBody(req);
      let text = '';
      try {
        const data = JSON.parse(body.toString('utf8')) as { text?: unknown };
        text = typeof data.text === 'string' ? data.text.trim() : '';
      } catch {
        throw new Error('请求内容不是合法 JSON');
      }
      if (text.length > MAX_TEXT_LENGTH) throw new Error('文字过长');

      this.emitStatus('typing', text ? '正在发送…' : '正在回车…');
      if (text) {
        await this.inputInjector.inject(text);
        this.eventRouter.emit('vibekit:voiceTranscript', { text });
      }
      await this.inputInjector.pressKeys('enter');
      this.emitStatus('idle');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, length: text.length }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emitStatus('error', message);
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: message }));
    }
  }

  private async handleKey(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const body = await this.readBody(req);
      let keys = '';
      try {
        const data = JSON.parse(body.toString('utf8')) as { keys?: unknown };
        keys = typeof data.keys === 'string' ? data.keys.trim() : '';
      } catch {
        throw new Error('请求内容不是合法 JSON');
      }
      if (!keys) throw new Error('没有收到按键');
      this.emitStatus('typing', '正在按键…');
      await this.inputInjector.pressKeys(keys);
      this.emitStatus('idle');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emitStatus('error', message);
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: message }));
    }
  }

  private readBody(req: http.IncomingMessage): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let total = 0;
      req.on('data', (chunk: Buffer) => {
        total += chunk.length;
        if (total > MAX_TEXT_BYTES) {
          reject(new Error('文字过长'));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }

  private async phonePageHtml(): Promise<string> {
    const filePath = path.join(app.getAppPath(), 'out', 'renderer', 'phone.html');
    // Cache by mtime: repeated page loads don't hit the disk, but dev-mode
    // edits are still picked up.
    try {
      const stat = fs.statSync(filePath);
      if (this.phoneHtmlCache && this.phoneHtmlCache.mtimeMs === stat.mtimeMs) {
        return this.phoneHtmlCache.content;
      }
      const content = fs.readFileSync(filePath, 'utf-8');
      this.phoneHtmlCache = { content, mtimeMs: stat.mtimeMs };
      return content;
    } catch {
      // fall through to dev/fallback
    }
    const devUrl = process.env.ELECTRON_RENDERER_URL;
    if (devUrl) {
      try {
        const response = await fetch(`${devUrl.replace(/\/$/, '')}/phone.html`);
        if (response.ok) return await response.text();
      } catch {
        // fall through
      }
    }
    return '<!doctype html><html><body style="background:#0d1117;color:#fff;font-family:sans-serif;padding:24px">phone.html 未构建，请重新运行 build。</body></html>';
  }

  private lanCandidates(): LanCandidate[] {
    const list: LanCandidate[] = [];
    for (const [name, entries] of Object.entries(os.networkInterfaces())) {
      for (const entry of entries ?? []) {
        if (entry.family !== 'IPv4' || entry.internal) continue;
        if (!entry.address || entry.address.startsWith('127.')) continue;
        const virtual = VIRTUAL_ADAPTER_RE.test(name);
        // Name hints only apply to adapters that don't look virtual, otherwise
        // "Hyper-V Virtual Ethernet Adapter" would collect the ethernet bonus.
        let score = virtual ? -200 : 20;
        if (!virtual) {
          if (ETHERNET_ADAPTER_RE.test(name)) score += 70;
          else if (WIFI_ADAPTER_RE.test(name)) score += 50;
        }
        if (isPrivateIpv4(entry.address)) score += 5;
        if (entry.address.startsWith('169.254.')) score -= 40;
        // A host address ending in .1 is usually the host side of a virtual
        // network (VMware VMnet, VirtualBox host-only) or a router, not this PC.
        if (entry.address.endsWith('.1')) score -= 30;
        list.push({ name, address: entry.address, score, virtual });
      }
    }
    return list;
  }

  // Ask the OS which local address it would use for an outbound route.
  // No packet is sent; this is a route lookup. It disambiguates multiple
  // physical adapters and ignores VMware/WSL-only networks.
  private preferredAddress(): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      const socket = dgram.createSocket('udp4');
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const finish = (value: string | null) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        try { socket.close(); } catch { /* ignore */ }
        resolve(value);
      };
      timer = setTimeout(() => finish(null), 250);
      socket.once('error', () => finish(null));
      try {
        socket.connect(53, '8.8.8.8', () => {
          try {
            const address = socket.address();
            finish(address && address.address && address.address !== '0.0.0.0' ? address.address : null);
          } catch {
            finish(null);
          }
        });
      } catch {
        finish(null);
      }
    });
  }

  private emitStatus(state: VoiceStatus['state'], message?: string): void {
    this.status = { state, message };
    this.eventRouter.emit('vibekit:voiceStatus', this.status);
  }

  private validPort(port: number): number {
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('端口必须在 1024-65535 之间');
    return port;
  }
}
