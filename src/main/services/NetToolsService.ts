import { execFile } from 'child_process';
import * as dns from 'dns';
import * as net from 'net';
import * as https from 'https';
import * as http from 'http';
import type {
  DnsLookupResult,
  DnsRecordType,
  HttpCheckResult,
  NetInfo,
  NetSpeedProgress,
  NetSpeedResult,
  PingResult,
  TcpCheckResult,
} from '@shared';
import type { EventRouter } from './EventRouter';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const SPEED_DOWN_BASE = 'https://speed.cloudflare.com/__down?bytes=';
const SPEED_UP_URL = 'https://speed.cloudflare.com/__up';
const SPEED_SERVER = 'Cloudflare';
const DOWNLOAD_MS = 6000;
const UPLOAD_MS = 5000;
const MAX_DOWN_BYTES = 100 * 1024 * 1024;
const MAX_UP_BYTES = 50 * 1024 * 1024;
const DOWNLOAD_CHUNK = 8 * 1024 * 1024;
const UPLOAD_CHUNK = 2 * 1024 * 1024;
const DNS_TYPES: readonly DnsRecordType[] = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'PTR'];

const keepAliveAgent = new https.Agent({ keepAlive: true, maxSockets: 10 });

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function validateHost(value: unknown): string {
  const host = typeof value === 'string' ? value.trim() : '';
  if (!host || host.length > 253) throw new Error('请输入有效的域名或 IP');
  if (!/^[a-zA-Z0-9._:-]+$/.test(host) || host.startsWith('-') || host.startsWith('.')) {
    throw new Error('域名/IP 格式不正确');
  }
  return host;
}

function validatePort(value: unknown): number {
  const port = typeof value === 'string' ? Number(value) : value;
  if (typeof port !== 'number' || !Number.isFinite(port) || port < 1 || port > 65535) {
    throw new Error('端口需在 1–65535 之间');
  }
  return Math.round(port);
}

function validateUrl(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) throw new Error('请输入 URL');
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('URL 格式不正确');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('只支持 http/https');
  }
  if (raw.length > 2048) throw new Error('URL 过长');
  return parsed.toString();
}

function execFileCapture(file: string, args: string[], timeout: number): Promise<string> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout, windowsHide: true, maxBuffer: 256 * 1024 }, (error, stdout, stderr) => {
      const text = `${stdout ?? ''}\n${stderr ?? ''}`;
      if (text.trim()) {
        resolve(text);
      } else {
        resolve(error ? String(error.message) : '');
      }
    });
  });
}

function average(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stddev(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = average(values) as number;
  const variance = values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

function round(value: number, digits = 2): number {
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getText(url: string, timeoutMs = 12000): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { 'user-agent': USER_AGENT, accept: '*/*' } }, (res) => {
      if (res.statusCode && res.statusCode >= 400) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        data += chunk;
        if (data.length > 512 * 1024) request.destroy();
      });
      res.on('end', () => resolve(data));
      res.on('error', reject);
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error('请求超时')));
    request.on('error', reject);
  });
}

export class NetToolsService {
  private speedControllers = new Map<number, AbortController>();
  private infoCache: NetInfo | null = null;
  private infoCachedAt = 0;

  constructor(private eventRouter: EventRouter) {}

  // --- Ping (ICMP via the system ping command) ---

  async ping(hostValue: unknown, countValue?: unknown, timeoutValue?: unknown): Promise<PingResult> {
    const host = validateHost(hostValue);
    const count = clampInt(countValue, 1, 20, 4);
    const timeoutMs = clampInt(timeoutValue, 200, 5000, 1000);
    const isWindows = process.platform === 'win32';
    const waitArgs = isWindows
      ? ['-w', String(timeoutMs)]
      : process.platform === 'darwin'
        ? ['-W', String(timeoutMs)]
        : ['-W', String(Math.max(1, Math.ceil(timeoutMs / 1000)))];
    const args = isWindows
      ? ['-n', String(count), ...waitArgs, host]
      : ['-c', String(count), ...waitArgs, host];
    const output = await execFileCapture('ping', args, count * timeoutMs + 4000);
    const rtts: number[] = [];
    for (const line of output.split(/\r?\n/)) {
      if (!/TTL=/i.test(line)) continue;
      if (/<\s*1\s*ms/i.test(line)) {
        rtts.push(0.5);
      } else {
        const match = line.match(/([0-9]+(?:\.[0-9]+)?)\s*ms/i);
        if (match) rtts.push(Number(match[1]));
      }
    }
    const ipMatch = output.match(/\[([0-9a-fA-F:.]+)\]/);
    const avgMs = average(rtts);
    const jitterMs = stddev(rtts);
    const result: PingResult = {
      host,
      resolvedIp: ipMatch ? ipMatch[1] : null,
      sent: count,
      received: rtts.length,
      lossPercent: Math.round(((count - rtts.length) / count) * 100),
      minMs: rtts.length ? Math.min(...rtts) : null,
      avgMs: avgMs == null ? null : round(avgMs),
      maxMs: rtts.length ? Math.max(...rtts) : null,
      jitterMs: jitterMs == null ? null : round(jitterMs),
      rtts: rtts.map((value) => round(value)),
      timestamp: Date.now(),
    };
    if (!rtts.length) {
      const firstLine = output.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
      result.error = firstLine && firstLine.length < 200 ? firstLine : '无法 Ping 通目标主机';
    }
    return result;
  }

  // --- TCP / Telnet port check ---

  tcpCheck(hostValue: unknown, portValue: unknown, timeoutValue?: unknown): Promise<TcpCheckResult> {
    const host = validateHost(hostValue);
    const port = validatePort(portValue);
    const timeoutMs = clampInt(timeoutValue, 300, 15000, 3000);
    const started = Date.now();
    return new Promise((resolve) => {
      const socket = new net.Socket();
      let settled = false;
      const finish = (status: TcpCheckResult['status'], error?: string) => {
        if (settled) return;
        settled = true;
        const result: TcpCheckResult = {
          host,
          port,
          status,
          ok: status === 'open',
          connectMs: status === 'open' ? Date.now() - started : null,
          remoteAddress: socket.remoteAddress || null,
          error,
          timestamp: Date.now(),
        };
        socket.destroy();
        resolve(result);
      };
      socket.setTimeout(timeoutMs);
      socket.once('connect', () => finish('open'));
      socket.once('timeout', () => finish('timeout', '连接超时'));
      socket.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'ECONNREFUSED') finish('closed', '端口未开放（连接被拒绝）');
        else if (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN') finish('error', '域名解析失败');
        else if (err.code === 'ETIMEDOUT') finish('timeout', '连接超时');
        else finish('error', err.message);
      });
      try {
        socket.connect({ host, port });
      } catch (err) {
        finish('error', err instanceof Error ? err.message : String(err));
      }
    });
  }

  // --- DNS ---

  async dnsLookup(hostValue: unknown, typeValue: unknown): Promise<DnsLookupResult> {
    const host = validateHost(hostValue);
    const type: DnsRecordType = DNS_TYPES.includes(typeValue as DnsRecordType)
      ? (typeValue as DnsRecordType)
      : 'A';
    const started = Date.now();
    try {
      let records: string[] = [];
      if (type === 'A') records = await dns.promises.resolve4(host);
      else if (type === 'AAAA') records = await dns.promises.resolve6(host);
      else if (type === 'CNAME') records = await dns.promises.resolveCname(host);
      else if (type === 'NS') records = await dns.promises.resolveNs(host);
      else if (type === 'PTR') records = await dns.promises.reverse(host);
      else if (type === 'MX') {
        records = (await dns.promises.resolveMx(host)).map((entry) => `${entry.priority} ${entry.exchange}`);
      } else {
        records = (await dns.promises.resolveTxt(host)).map((parts) => parts.join(''));
      }
      return { host, type, records, durationMs: Date.now() - started, timestamp: Date.now() };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return { host, type, records: [], durationMs: Date.now() - started, error, timestamp: Date.now() };
    }
  }

  // --- HTTP check ---

  async httpCheck(urlValue: unknown, methodValue?: unknown): Promise<HttpCheckResult> {
    const url = validateUrl(urlValue);
    const method: 'HEAD' | 'GET' = methodValue === 'HEAD' ? 'HEAD' : 'GET';
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, {
        method,
        redirect: 'follow',
        signal: controller.signal,
        headers: { 'user-agent': USER_AGENT, accept: '*/*' },
      });
      const durationMs = Date.now() - started;
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => { headers[key] = value; });
      try {
        await response.body?.cancel();
      } catch { /* body already gone */ }
      return {
        url,
        finalUrl: response.url || url,
        method,
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        durationMs,
        headers,
        timestamp: Date.now(),
      };
    } catch (err) {
      const message = controller.signal.aborted ? '请求超时' : err instanceof Error ? err.message : String(err);
      return {
        url,
        finalUrl: url,
        method,
        status: 0,
        statusText: '',
        ok: false,
        durationMs: Date.now() - started,
        headers: {},
        error: message,
        timestamp: Date.now(),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  // --- Public IP / network info ---

  async info(force = false): Promise<NetInfo> {
    if (!force && this.infoCache && Date.now() - this.infoCachedAt < 5 * 60_000) return this.infoCache;
    let ip = '';
    let country: string | null = null;
    let colo: string | null = null;
    let city: string | null = null;
    let region: string | null = null;
    let isp: string | null = null;
    let error: string | undefined;
    try {
      const trace = await getText('https://www.cloudflare.com/cdn-cgi/trace');
      const map: Record<string, string> = {};
      for (const line of trace.split('\n')) {
        const index = line.indexOf('=');
        if (index > 0) map[line.slice(0, index)] = line.slice(index + 1).trim();
      }
      ip = map.ip || '';
      country = map.loc || null;
      colo = map.colo || null;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    try {
      const raw = await getText('https://ipinfo.io/json');
      const data = JSON.parse(raw) as Record<string, unknown>;
      if (!ip && typeof data.ip === 'string') ip = data.ip;
      if (!city && typeof data.city === 'string') city = data.city;
      if (!region && typeof data.region === 'string') region = data.region;
      if (typeof data.org === 'string') isp = data.org;
      if (!country && typeof data.country === 'string') country = data.country;
    } catch {
      /* ipinfo is optional */
    }
    const result: NetInfo = { ip, country, city, region, isp, colo, timestamp: Date.now(), error };
    if (ip) {
      this.infoCache = result;
      this.infoCachedAt = Date.now();
    }
    return result;
  }

  // --- Speed test ---

  async speedTest(windowId: number): Promise<NetSpeedResult> {
    const previous = this.speedControllers.get(windowId);
    if (previous) previous.abort();
    const controller = new AbortController();
    this.speedControllers.set(windowId, controller);
    const started = Date.now();

    let pingMs: number | null = null;
    let jitterMs: number | null = null;
    let bytesDown = 0;
    let bytesUp = 0;
    let downloadMbps = 0;
    let uploadMbps = 0;
    let info: NetInfo | null = null;

    const emit = (progress: Partial<NetSpeedProgress>) => {
      const payload: NetSpeedProgress = {
        phase: progress.phase ?? 'ping',
        elapsedMs: Date.now() - started,
        downloadMbps: progress.downloadMbps ?? downloadMbps,
        uploadMbps: progress.uploadMbps ?? uploadMbps,
        pingMs: progress.pingMs ?? pingMs,
        jitterMs: progress.jitterMs ?? jitterMs,
        bytesDown: progress.bytesDown ?? bytesDown,
        bytesUp: progress.bytesUp ?? bytesUp,
        message: progress.message,
      };
      this.eventRouter.emit('vibekit:netSpeedProgress', payload, { windowId });
    };

    try {
      emit({ phase: 'ping', message: '正在测量延迟…' });
      const infoPromise = this.info().catch(() => null);
      const samples = await this.measureLatency(controller.signal, (partialPing, partialJitter) => {
        pingMs = partialPing;
        jitterMs = partialJitter;
        emit({ phase: 'ping', pingMs, jitterMs, message: '正在测量延迟…' });
      });
      pingMs = samples.pingMs;
      jitterMs = samples.jitterMs;
      info = await infoPromise;
      if (controller.signal.aborted) throw new Error('测速已取消');

      emit({ phase: 'download', pingMs, jitterMs, message: '正在测试下载速度…' });
      const download = await this.runDownload(controller.signal, (bytes, mbps) => {
        bytesDown = bytes;
        downloadMbps = mbps;
        emit({ phase: 'download', bytesDown, downloadMbps, pingMs, jitterMs, message: '正在测试下载速度…' });
      });
      bytesDown = download.bytes;
      downloadMbps = download.mbps;
      if (controller.signal.aborted) throw new Error('测速已取消');

      emit({ phase: 'upload', pingMs, jitterMs, bytesDown, downloadMbps, message: '正在测试上传速度…' });
      const upload = await this.runUpload(controller.signal, (bytes, mbps) => {
        bytesUp = bytes;
        uploadMbps = mbps;
        emit({ phase: 'upload', bytesDown, downloadMbps, bytesUp, uploadMbps, pingMs, jitterMs, message: '正在测试上传速度…' });
      });
      bytesUp = upload.bytes;
      uploadMbps = upload.mbps;

      const result: NetSpeedResult = {
        downloadMbps: round(downloadMbps, 2),
        uploadMbps: round(uploadMbps, 2),
        pingMs: pingMs == null ? null : round(pingMs),
        jitterMs: jitterMs == null ? null : round(jitterMs),
        bytesDown,
        bytesUp,
        durationMs: Date.now() - started,
        server: SPEED_SERVER,
        colo: info?.colo ?? null,
        publicIp: info?.ip || null,
        city: info?.city ?? null,
        isp: info?.isp ?? null,
        timestamp: Date.now(),
      };
      emit({ phase: 'done', bytesDown, bytesUp, downloadMbps, uploadMbps, pingMs, jitterMs, message: '测速完成' });
      return result;
    } catch (err) {
      if (controller.signal.aborted) throw new Error('测速已取消');
      const result: NetSpeedResult = {
        downloadMbps: round(downloadMbps, 2),
        uploadMbps: round(uploadMbps, 2),
        pingMs: pingMs == null ? null : round(pingMs),
        jitterMs: jitterMs == null ? null : round(jitterMs),
        bytesDown,
        bytesUp,
        durationMs: Date.now() - started,
        server: SPEED_SERVER,
        colo: info?.colo ?? null,
        publicIp: info?.ip || null,
        city: info?.city ?? null,
        isp: info?.isp ?? null,
        timestamp: Date.now(),
        error: err instanceof Error ? err.message : String(err),
      };
      emit({ phase: 'done', downloadMbps: result.downloadMbps, uploadMbps: result.uploadMbps, pingMs, jitterMs, bytesDown, bytesUp, message: '测速失败' });
      return result;
    } finally {
      this.speedControllers.delete(windowId);
    }
  }

  cancelSpeedTest(windowId: number): void {
    const controller = this.speedControllers.get(windowId);
    if (controller) controller.abort();
  }

  destroy(): void {
    for (const controller of this.speedControllers.values()) controller.abort();
    this.speedControllers.clear();
  }

  private mbps(bytes: number, seconds: number): number {
    if (seconds <= 0) return 0;
    return (bytes * 8) / seconds / 1_000_000;
  }

  private async measureLatency(
    signal: AbortSignal,
    onSample: (pingMs: number | null, jitterMs: number | null) => void,
  ): Promise<{ pingMs: number | null; jitterMs: number | null }> {
    const samples: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      if (signal.aborted) throw new Error('测速已取消');
      const started = Date.now();
      await this.httpGet(`${SPEED_DOWN_BASE}0`, signal, 15000);
      samples.push(Date.now() - started);
      const used = samples.length > 1 ? samples.slice(1) : samples;
      onSample(average(used) == null ? null : round(average(used) as number), stddev(used) == null ? null : round(stddev(used) as number));
    }
    const used = samples.length > 1 ? samples.slice(1) : samples;
    return {
      pingMs: average(used) == null ? null : round(average(used) as number),
      jitterMs: stddev(used) == null ? null : round(stddev(used) as number),
    };
  }

  private httpGet(url: string, signal: AbortSignal, timeoutMs = 15000): Promise<number> {
    return new Promise((resolve, reject) => {
      const request = https.get(url, {
        agent: keepAliveAgent,
        signal,
        headers: { 'user-agent': USER_AGENT, accept: '*/*' },
      }, (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        let bytes = 0;
        res.on('data', (chunk: Buffer) => { bytes += chunk.length; });
        res.on('end', () => resolve(bytes));
        res.on('error', reject);
      });
      request.setTimeout(timeoutMs, () => request.destroy(new Error('请求超时')));
      request.on('error', reject);
    });
  }

  private async runDownload(
    signal: AbortSignal,
    onProgress: (bytes: number, mbps: number) => void,
  ): Promise<{ bytes: number; mbps: number }> {
    const phaseController = new AbortController();
    const onAbort = () => phaseController.abort();
    signal.addEventListener('abort', onAbort);
    const started = Date.now();
    const deadline = started + DOWNLOAD_MS;
    let bytes = 0;
    let lastEmit = 0;

    const ticker = setInterval(() => {
      const elapsed = Math.max(0.35, (Date.now() - started) / 1000);
      if (Date.now() - lastEmit >= 240) {
        lastEmit = Date.now();
        onProgress(bytes, this.mbps(bytes, elapsed));
      }
      if (Date.now() >= deadline || bytes >= MAX_DOWN_BYTES) phaseController.abort();
    }, 100);

    const worker = async () => {
      while (!phaseController.signal.aborted && !signal.aborted && Date.now() < deadline && bytes < MAX_DOWN_BYTES) {
        try {
          await this.downloadOnce(phaseController.signal, (chunkBytes) => { bytes += chunkBytes; });
        } catch {
          if (phaseController.signal.aborted || signal.aborted) break;
          await sleep(120);
        }
      }
    };

    try {
      await Promise.allSettled([worker(), worker(), worker(), worker()]);
    } finally {
      clearInterval(ticker);
      signal.removeEventListener('abort', onAbort);
      phaseController.abort();
    }
    const seconds = Math.max(1, (Date.now() - started) / 1000);
    const mbps = this.mbps(bytes, seconds);
    onProgress(bytes, mbps);
    return { bytes, mbps };
  }

  private downloadOnce(signal: AbortSignal, onBytes: (bytes: number) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = https.get(`${SPEED_DOWN_BASE}${DOWNLOAD_CHUNK}`, {
        agent: keepAliveAgent,
        signal,
        headers: { 'user-agent': USER_AGENT, accept: 'application/octet-stream' },
      }, (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        res.on('data', (chunk: Buffer) => onBytes(chunk.length));
        res.on('end', () => resolve());
        res.on('error', reject);
      });
      request.setTimeout(15000, () => request.destroy(new Error('请求超时')));
      request.on('error', reject);
    });
  }

  private async runUpload(
    signal: AbortSignal,
    onProgress: (bytes: number, mbps: number) => void,
  ): Promise<{ bytes: number; mbps: number }> {
    const phaseController = new AbortController();
    const onAbort = () => phaseController.abort();
    signal.addEventListener('abort', onAbort);
    const started = Date.now();
    const deadline = started + UPLOAD_MS;
    const payload = Buffer.alloc(UPLOAD_CHUNK, 0x61);
    let bytes = 0;
    let lastEmit = 0;

    const ticker = setInterval(() => {
      const elapsed = Math.max(0.35, (Date.now() - started) / 1000);
      if (Date.now() - lastEmit >= 240) {
        lastEmit = Date.now();
        onProgress(bytes, this.mbps(bytes, elapsed));
      }
      if (Date.now() >= deadline || bytes >= MAX_UP_BYTES) phaseController.abort();
    }, 100);

    const worker = async () => {
      while (!phaseController.signal.aborted && !signal.aborted && Date.now() < deadline && bytes < MAX_UP_BYTES) {
        try {
          await this.uploadOnce(payload, phaseController.signal);
          bytes += payload.length;
        } catch {
          if (phaseController.signal.aborted || signal.aborted) break;
          await sleep(120);
        }
      }
    };

    try {
      await Promise.allSettled([worker(), worker(), worker()]);
    } finally {
      clearInterval(ticker);
      signal.removeEventListener('abort', onAbort);
      phaseController.abort();
    }
    const seconds = Math.max(1, (Date.now() - started) / 1000);
    const mbps = this.mbps(bytes, seconds);
    onProgress(bytes, mbps);
    return { bytes, mbps };
  }

  private uploadOnce(payload: Buffer, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = https.request(SPEED_UP_URL, {
        method: 'POST',
        agent: keepAliveAgent,
        signal,
        headers: {
          'user-agent': USER_AGENT,
          'content-type': 'application/octet-stream',
          'content-length': String(payload.length),
          accept: '*/*',
        },
      }, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        res.on('end', () => resolve());
        res.on('error', reject);
      });
      request.setTimeout(15000, () => request.destroy(new Error('请求超时')));
      request.on('error', reject);
      request.end(payload);
    });
  }
}
