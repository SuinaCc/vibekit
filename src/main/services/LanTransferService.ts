import { app, dialog, Notification } from 'electron';
import * as crypto from 'crypto';
import * as dgram from 'dgram';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import type { ConfigService } from './ConfigService';
import type { EventRouter } from './EventRouter';
import type { LanConfig, LanDevice, LanPath, LanProgress } from '@shared';

const APP_MAGIC = 'local-vibe-box-lan';
const PROTOCOL_VERSION = 1;
const MAX_FILES = 10_000;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024 * 1024;
const MAX_FILE_BYTES = 20 * 1024 * 1024 * 1024;
const MAX_PATH_DEPTH = 32;
const BEACON_INTERVAL_MS = 3_000;
const DEVICE_TTL_MS = 15_000;
const CHUNK_SIZE = 256 * 1024;

interface ManifestFile {
  sourcePath: string;
  relPath: string;
  size: number;
}

interface Beacon {
  magic: string;
  v: number;
  id: string;
  name: string;
  port: number;
}

interface SendContext {
  transferId: string;
  socket: net.Socket;
  device: LanDevice;
  reader: FrameReader;
  manifest: ManifestFile[];
  total: number;
  bytes: number;
  filesDone: number;
  resolveDecision: (value: 'accept' | 'reject') => void;
  rejectDecision: (error: Error) => void;
  ackWaiters: Map<number, { resolve: () => void; reject: (error: Error) => void }>;
  done: boolean;
  cancelled: boolean;
}

interface ReceiveContext {
  socket: net.Socket;
  reader: FrameReader;
  transferId: string;
  senderId: string;
  senderName: string;
  files: Array<{ relPath: string; size: number }>;
  total: number;
  bytes: number;
  filesDone: number;
  root: string;
  current?: {
    index: number;
    relPath: string;
    stream: fs.WriteStream;
    hash: crypto.Hash;
    tempPath: string;
    finalPath: string;
  };
  done: boolean;
  cancelled: boolean;
}

class FrameReader {
  private buffer = Buffer.alloc(0);

  constructor(private handler: (header: Record<string, any>, data: Buffer) => void) {}

  push(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (this.buffer.length >= 4) {
      const headerLength = this.buffer.readUInt32BE(0);
      if (headerLength <= 0 || headerLength > 8 * 1024 * 1024) {
        throw new Error('Invalid frame header');
      }
      if (this.buffer.length < 4 + headerLength) return;

      let header: Record<string, any>;
      try {
        header = JSON.parse(this.buffer.subarray(4, 4 + headerLength).toString('utf8'));
      } catch {
        throw new Error('Invalid frame JSON');
      }

      const dataLength = typeof header.dataLength === 'number' ? header.dataLength : 0;
      if (dataLength < 0 || dataLength > 4 * 1024 * 1024) {
        throw new Error('Invalid frame payload');
      }
      const frameLength = 4 + headerLength + dataLength;
      if (this.buffer.length < frameLength) return;

      const data = this.buffer.subarray(4 + headerLength, frameLength);
      this.buffer = this.buffer.subarray(frameLength);
      this.handler(header, data);
    }
  }
}

function encodeFrame(header: Record<string, unknown>, data?: Buffer): Buffer {
  const body = { ...header, dataLength: data?.length ?? 0 };
  const headerBuffer = Buffer.from(JSON.stringify(body), 'utf8');
  const lengthBuffer = Buffer.alloc(4);
  lengthBuffer.writeUInt32BE(headerBuffer.length, 0);
  return Buffer.concat([lengthBuffer, headerBuffer, data ?? Buffer.alloc(0)]);
}

async function writeFrame(
  socket: net.Socket,
  header: Record<string, unknown>,
  data?: Buffer,
): Promise<void> {
  const frame = encodeFrame(header, data);
  if (socket.write(frame)) return;
  await new Promise<void>((resolve, reject) => {
    const onDrain = () => { cleanup(); resolve(); };
    const onError = (error: Error) => { cleanup(); reject(error); };
    const cleanup = () => {
      socket.off('drain', onDrain);
      socket.off('error', onError);
    };
    socket.once('drain', onDrain);
    socket.once('error', onError);
  });
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index++;
  }
  return `${index === 0 ? value : value.toFixed(1)} ${units[index]}`;
}

export function sanitizeRelativePath(root: string, relPath: string): string {
  if (typeof relPath !== 'string' || !relPath || relPath.includes('\0')) {
    throw new Error('非法文件路径');
  }
  const normalized = relPath.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) {
    throw new Error('不允许绝对路径');
  }
  const segments = normalized.split('/').filter((segment) => segment.length > 0 && segment !== '.');
  if (segments.length === 0 || segments.length > MAX_PATH_DEPTH) {
    throw new Error('非法路径深度');
  }
  for (const segment of segments) {
    if (segment === '..' || /[<>:"|?*]/.test(segment) || /[. ]$/.test(segment)) {
      throw new Error('非法文件路径');
    }
    if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i.test(segment)) {
      throw new Error('Windows 保留文件名');
    }
  }
  const destination = path.resolve(root, ...segments);
  const relative = path.relative(root, destination);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('路径必须位于接收目录内');
  }
  return destination;
}

export class LanTransferService {
  private udp: dgram.Socket | null = null;
  private server: net.Server | null = null;
  private beaconTimer: ReturnType<typeof setInterval> | null = null;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private devices = new Map<string, LanDevice>();
  private activeSockets = new Map<string, net.Socket>();
  private lastProgressAt = new Map<string, number>();

  constructor(
    private configService: ConfigService,
    private eventRouter: EventRouter,
  ) {}

  async startIfEnabled(): Promise<void> {
    if (this.getConfig().enabled) {
      await this.start().catch((error) => {
        console.warn('LAN start failed:', error);
      });
    }
  }

  getConfig(): LanConfig {
    const config = this.configService.get().lan;
    let changed = false;
    if (!config.deviceId) {
      config.deviceId = crypto.randomUUID();
      changed = true;
    }
    if (!config.deviceName) {
      config.deviceName = os.hostname();
      changed = true;
    }
    if (changed) {
      this.configService.setValue('lan.deviceId', config.deviceId);
      this.configService.setValue('lan.deviceName', config.deviceName);
    }
    return { ...config };
  }

  setConfig(patch: Partial<Pick<LanConfig, 'deviceName' | 'downloadDir' | 'trustedDevices'>>): LanConfig {
    if (typeof patch.deviceName === 'string') {
      this.configService.setValue('lan.deviceName', patch.deviceName.trim().slice(0, 64));
    }
    if (patch.downloadDir !== undefined) {
      this.configService.setValue('lan.downloadDir', patch.downloadDir);
    }
    if (Array.isArray(patch.trustedDevices)) {
      this.configService.setValue('lan.trustedDevices', patch.trustedDevices);
    }
    return this.getConfig();
  }

  getDevices(): LanDevice[] {
    return Array.from(this.devices.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  async enable(): Promise<LanConfig> {
    this.configService.setValue('lan.enabled', true);
    await this.start();
    return this.getConfig();
  }

  disable(): void {
    this.configService.setValue('lan.enabled', false);
    this.stop();
  }

  async pickPaths(mode: 'files' | 'folders'): Promise<LanPath[]> {
    const result = await dialog.showOpenDialog({
      properties: mode === 'files'
        ? ['openFile', 'multiSelections']
        : ['openDirectory', 'multiSelections'],
    });
    if (result.canceled) return [];
    return result.filePaths.map((filePath) => {
      const stat = fs.statSync(filePath);
      return {
        path: filePath,
        name: path.basename(filePath),
        isDir: stat.isDirectory(),
        size: stat.isFile() ? stat.size : undefined,
      };
    });
  }

  send(deviceId: string, paths: string[]): { transferId: string } {
    const device = this.devices.get(deviceId);
    if (!device) throw new Error('设备不在线');
    if (!Array.isArray(paths) || paths.length === 0) throw new Error('请选择文件或文件夹');
    const manifest = this.buildManifest(paths);
    const transferId = crypto.randomUUID();
    void this.runSend(transferId, device, manifest).catch((error) => {
      this.emitProgress({
        transferId,
        deviceId: device.id,
        deviceName: device.name,
        direction: 'send',
        state: 'error',
        bytes: 0,
        total: manifest.total,
        filesDone: 0,
        filesTotal: manifest.files.length,
        error: error instanceof Error ? error.message : String(error),
      });
    });
    return { transferId };
  }

  cancel(transferId: string): void {
    const socket = this.activeSockets.get(transferId);
    if (!socket) return;
    void writeFrame(socket, { type: 'cancel', transferId }).catch(() => {});
    socket.destroy();
  }

  stop(): void {
    if (this.beaconTimer) { clearInterval(this.beaconTimer); this.beaconTimer = null; }
    if (this.cleanupTimer) { clearInterval(this.cleanupTimer); this.cleanupTimer = null; }
    for (const socket of this.activeSockets.values()) {
      try { socket.destroy(); } catch {}
    }
    this.activeSockets.clear();
    if (this.server) {
      try { this.server.close(); } catch {}
      this.server = null;
    }
    if (this.udp) {
      try { this.udp.close(); } catch {}
      this.udp = null;
    }
    if (this.devices.size > 0) {
      this.devices.clear();
      this.eventRouter.emit('aero:lanDevices', []);
    }
  }

  private async start(): Promise<void> {
    if (this.udp || this.server) return;
    const config = this.getConfig();

    const udp = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    await new Promise<void>((resolve, reject) => {
      udp.once('error', reject);
      udp.bind(config.discoveryPort, '0.0.0.0', () => {
        udp.off('error', reject);
        udp.setBroadcast(true);
        resolve();
      });
    });
    udp.on('error', (error) => console.warn('LAN discovery error:', error.message));
    udp.on('message', (message, remote) => this.handleBeacon(message, remote.address));
    this.udp = udp;

    const server = net.createServer((socket) => this.handleConnection(socket));
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(config.transferPort, '0.0.0.0', () => {
          server.off('error', reject);
          resolve();
        });
      });
    } catch (error) {
      try { udp.close(); } catch {}
      this.udp = null;
      throw error;
    }
    server.on('error', (error) => console.warn('LAN transfer server error:', error.message));
    this.server = server;

    this.broadcastBeacon();
    this.beaconTimer = setInterval(() => this.broadcastBeacon(), BEACON_INTERVAL_MS);
    this.cleanupTimer = setInterval(() => this.cleanupDevices(), 5_000);
    console.log(`LAN transfer listening on ${config.transferPort}`);
  }

  private broadcastBeacon(): void {
    if (!this.udp || !this.server) return;
    const config = this.getConfig();
    const address = this.server.address();
    if (!address || typeof address === 'string') return;
    const beacon: Beacon = {
      magic: APP_MAGIC,
      v: PROTOCOL_VERSION,
      id: config.deviceId,
      name: config.deviceName,
      port: address.port,
    };
    const payload = Buffer.from(JSON.stringify(beacon), 'utf8');
    const targets = new Set<string>(['255.255.255.255']);
    for (const entries of Object.values(os.networkInterfaces())) {
      for (const entry of entries ?? []) {
        if (entry.family !== 'IPv4' || entry.internal) continue;
        const ip = entry.address.split('.').map(Number);
        const mask = entry.netmask.split('.').map(Number);
        const broadcast = ip.map((value, index) => (value & mask[index]) | (~mask[index] & 255)).join('.');
        targets.add(broadcast);
      }
    }
    for (const target of targets) {
      try { this.udp.send(payload, 0, payload.length, config.discoveryPort, target); } catch {}
    }
  }

  private handleBeacon(message: Buffer, address: string): void {
    try {
      const beacon = JSON.parse(message.toString('utf8')) as Beacon;
      if (beacon.magic !== APP_MAGIC || beacon.v !== PROTOCOL_VERSION) return;
      const config = this.getConfig();
      if (!beacon.id || beacon.id === config.deviceId) return;
      const previous = this.devices.get(beacon.id);
      const device: LanDevice = {
        id: beacon.id,
        name: (beacon.name || '未知设备').slice(0, 64),
        address,
        port: beacon.port,
        lastSeen: Date.now(),
      };
      this.devices.set(beacon.id, device);
      if (!previous
        || previous.name !== device.name
        || previous.address !== device.address
        || previous.port !== device.port
        || device.lastSeen - previous.lastSeen > 6_000) {
        this.emitDevices();
      }
    } catch { /* ignore malformed beacons */ }
  }

  private cleanupDevices(): void {
    const cutoff = Date.now() - DEVICE_TTL_MS;
    let changed = false;
    for (const [id, device] of this.devices) {
      if (device.lastSeen < cutoff) {
        this.devices.delete(id);
        changed = true;
      }
    }
    if (changed) this.emitDevices();
  }

  private emitDevices(): void {
    this.eventRouter.emit('aero:lanDevices', this.getDevices());
  }

  private buildManifest(paths: string[]): { files: ManifestFile[]; total: number } {
    const files: ManifestFile[] = [];
    const used = new Set<string>();
    let total = 0;

    const addFile = (sourcePath: string, relPath: string) => {
      const stat = fs.statSync(sourcePath);
      if (!stat.isFile()) return;
      if (stat.size > MAX_FILE_BYTES) throw new Error(`文件过大: ${path.basename(sourcePath)}`);
      let candidate = relPath;
      let suffix = 1;
      while (used.has(candidate)) {
        const parsed = path.parse(relPath);
        candidate = path.join(parsed.dir, `${parsed.name} (${suffix})${parsed.ext}`);
        suffix++;
      }
      used.add(candidate);
      files.push({ sourcePath, relPath: candidate, size: stat.size });
      total += stat.size;
      if (files.length > MAX_FILES) throw new Error('文件数量超过限制');
      if (total > MAX_TOTAL_BYTES) throw new Error('传输总大小超过限制');
    };

    const walk = (dir: string, base: string, depth: number) => {
      if (depth > MAX_PATH_DEPTH) throw new Error('目录层级过深');
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) continue;
        const fullPath = path.join(dir, entry.name);
        const relPath = path.join(base, entry.name);
        if (entry.isDirectory()) walk(fullPath, relPath, depth + 1);
        else if (entry.isFile()) addFile(fullPath, relPath);
      }
    };

    for (const selected of paths) {
      const stat = fs.statSync(selected);
      if (stat.isDirectory()) walk(selected, path.basename(selected), 0);
      else addFile(selected, path.basename(selected));
    }

    if (files.length === 0) throw new Error('没有可发送的文件');
    return { files, total };
  }

  private async runSend(
    transferId: string,
    device: LanDevice,
    manifest: { files: ManifestFile[]; total: number },
  ): Promise<void> {
    const config = this.getConfig();
    let resolveDecision!: (value: 'accept' | 'reject') => void;
    let rejectDecision!: (error: Error) => void;
    const decision = new Promise<'accept' | 'reject'>((resolve, reject) => {
      resolveDecision = resolve;
      rejectDecision = reject;
    });

    const socket = net.createConnection({ host: device.address, port: device.port });
    const context: SendContext = {
      transferId,
      socket,
      device,
      reader: new FrameReader((header) => {
        if (header.type === 'accept') resolveDecision('accept');
        else if (header.type === 'reject') resolveDecision('reject');
        else if (header.type === 'file-ack') {
          const waiter = context.ackWaiters.get(Number(header.index));
          if (waiter) {
            context.ackWaiters.delete(Number(header.index));
            waiter.resolve();
          }
        } else if (header.type === 'error') {
          this.failSend(context, new Error(String(header.message || '接收方错误')));
        }
      }),
      manifest: manifest.files,
      total: manifest.total,
      bytes: 0,
      filesDone: 0,
      resolveDecision,
      rejectDecision,
      ackWaiters: new Map(),
      done: false,
      cancelled: false,
    };

    this.activeSockets.set(transferId, socket);
    socket.on('data', (chunk) => {
      try { context.reader.push(chunk); } catch (error) { this.failSend(context, error instanceof Error ? error : new Error(String(error))); }
    });
    socket.on('error', (error) => this.failSend(context, error));
    socket.on('close', () => {
      if (!context.done && !context.cancelled) this.failSend(context, new Error('连接已关闭'));
    });

    try {
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('error', reject);
      });
      await writeFrame(socket, {
        type: 'hello',
        v: PROTOCOL_VERSION,
        deviceId: config.deviceId,
        deviceName: config.deviceName,
      });
      await writeFrame(socket, {
        type: 'offer',
        transferId,
        deviceId: config.deviceId,
        deviceName: config.deviceName,
        totalBytes: context.total,
        files: context.manifest.map((file) => ({ relPath: file.relPath, size: file.size })),
      });

      this.emitProgress({
        transferId,
        deviceId: device.id,
        deviceName: device.name,
        direction: 'send',
        state: 'offering',
        bytes: 0,
        total: context.total,
        filesDone: 0,
        filesTotal: context.manifest.length,
      });

      const accepted = await decision;
      if (accepted !== 'accept') {
        this.emitProgress({
          transferId,
          deviceId: device.id,
          deviceName: device.name,
          direction: 'send',
          state: 'cancelled',
          bytes: 0,
          total: context.total,
          filesDone: 0,
          filesTotal: context.manifest.length,
        });
        context.done = true;
        socket.end();
        return;
      }

      for (let index = 0; index < context.manifest.length; index++) {
        const file = context.manifest[index];
        const hash = crypto.createHash('sha256');
        await writeFrame(socket, {
          type: 'file-start',
          transferId,
          index,
          relPath: file.relPath,
          size: file.size,
        });

        const stream = fs.createReadStream(file.sourcePath, { highWaterMark: CHUNK_SIZE });
        for await (const chunk of stream) {
          const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          hash.update(data);
          await writeFrame(socket, { type: 'chunk', transferId, index, length: data.length }, data);
          context.bytes += data.length;
          this.emitProgress({
            transferId,
            deviceId: device.id,
            deviceName: device.name,
            direction: 'send',
            state: 'transferring',
            bytes: context.bytes,
            total: context.total,
            filesDone: context.filesDone,
            filesTotal: context.manifest.length,
            currentFile: file.relPath,
          });
        }

        const ack = new Promise<void>((resolve, reject) => {
          context.ackWaiters.set(index, { resolve, reject });
        });
        await writeFrame(socket, {
          type: 'file-end',
          transferId,
          index,
          sha256: hash.digest('hex'),
        });
        await ack;
        context.filesDone++;
      }

      await writeFrame(socket, { type: 'done', transferId });
      context.done = true;
      this.emitProgress({
        transferId,
        deviceId: device.id,
        deviceName: device.name,
        direction: 'send',
        state: 'done',
        bytes: context.total,
        total: context.total,
        filesDone: context.manifest.length,
        filesTotal: context.manifest.length,
      });
      socket.end();
    } catch (error) {
      this.failSend(context, error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.activeSockets.delete(transferId);
    }
  }

  private failSend(context: SendContext, error: Error): void {
    if (context.done || context.cancelled) return;
    context.cancelled = true;
    context.rejectDecision(error);
    for (const waiter of context.ackWaiters.values()) waiter.reject(error);
    context.ackWaiters.clear();
    context.socket.destroy();
    this.activeSockets.delete(context.transferId);
    this.emitProgress({
      transferId: context.transferId,
      deviceId: context.device.id,
      deviceName: context.device.name,
      direction: 'send',
      state: 'error',
      bytes: context.bytes,
      total: context.total,
      filesDone: context.filesDone,
      filesTotal: context.manifest.length,
      error: error.message,
    });
  }

  private handleConnection(socket: net.Socket): void {
    const context: ReceiveContext = {
      socket,
      reader: new FrameReader((header, data) => this.handleReceiveFrame(context, header, data)),
      transferId: '',
      senderId: '',
      senderName: '',
      files: [],
      total: 0,
      bytes: 0,
      filesDone: 0,
      root: '',
      done: false,
      cancelled: false,
    };

    socket.on('data', (chunk) => {
      try { context.reader.push(chunk); } catch (error) { this.failReceive(context, error instanceof Error ? error : new Error(String(error))); }
    });
    socket.on('error', (error) => this.failReceive(context, error));
    socket.on('close', () => {
      if (!context.done && !context.cancelled) this.failReceive(context, new Error('连接已关闭'));
    });
  }

  private handleReceiveFrame(context: ReceiveContext, header: Record<string, any>, data: Buffer): void {
    switch (header.type) {
      case 'hello':
        context.senderId = String(header.deviceId || '');
        context.senderName = String(header.deviceName || '未知设备').slice(0, 64);
        void writeFrame(context.socket, {
          type: 'hello-ack',
          deviceId: this.getConfig().deviceId,
          deviceName: this.getConfig().deviceName,
        });
        break;
      case 'offer':
        void this.handleOffer(context, header);
        break;
      case 'file-start':
        this.handleFileStart(context, header);
        break;
      case 'chunk':
        this.handleChunk(context, data);
        break;
      case 'file-end':
        this.handleFileEnd(context, header);
        break;
      case 'done':
        this.handleDone(context);
        break;
      case 'cancel':
        context.cancelled = true;
        this.cleanupReceive(context);
        this.emitProgress({
          transferId: context.transferId,
          deviceId: context.senderId,
          deviceName: context.senderName,
          direction: 'receive',
          state: 'cancelled',
          bytes: context.bytes,
          total: context.total,
          filesDone: context.filesDone,
          filesTotal: context.files.length,
        });
        break;
      case 'error':
        this.failReceive(context, new Error(String(header.message || '发送方错误')));
        break;
      default:
        break;
    }
  }

  private async handleOffer(context: ReceiveContext, header: Record<string, any>): Promise<void> {
    try {
      context.transferId = String(header.transferId || '');
      context.senderId = String(header.deviceId || context.senderId);
      context.senderName = String(header.deviceName || context.senderName || '未知设备').slice(0, 64);
      const files = Array.isArray(header.files) ? header.files : [];
      if (!context.transferId || files.length === 0 || files.length > MAX_FILES) {
        throw new Error('无效的文件清单');
      }
      context.root = this.getDownloadRoot(context.senderName);
      let total = 0;
      context.files = files.map((file: any) => {
        if (typeof file.relPath !== 'string' || typeof file.size !== 'number' || file.size < 0 || file.size > MAX_FILE_BYTES) {
          throw new Error('无效的文件条目');
        }
        sanitizeRelativePath(context.root, file.relPath);
        total += file.size;
        if (total > MAX_TOTAL_BYTES) throw new Error('传输总大小超过限制');
        return { relPath: file.relPath, size: file.size };
      });
      context.total = total;
      this.activeSockets.set(context.transferId, context.socket);

      this.eventRouter.emit('aero:lanIncoming', {
        transferId: context.transferId,
        deviceId: context.senderId,
        deviceName: context.senderName,
        total,
        filesTotal: context.files.length,
      });

      const config = this.getConfig();
      const trusted = config.trustedDevices.includes(context.senderId);
      let accepted = trusted;
      if (!trusted) {
        const result = await dialog.showMessageBox({
          type: 'question',
          title: '局域网文件传输',
          message: `${context.senderName} 想发送 ${context.files.length} 个文件`,
          detail: `总大小：${formatBytes(total)}\n保存到：${context.root}\n\n${context.files.slice(0, 8).map((file) => file.relPath).join('\n')}${context.files.length > 8 ? `\n… 还有 ${context.files.length - 8} 个文件` : ''}`,
          buttons: ['接收', '拒绝'],
          defaultId: 0,
          cancelId: 1,
          checkboxLabel: '信任此设备，以后自动接收',
          checkboxChecked: false,
          noLink: true,
        });
        accepted = result.response === 0;
        if (accepted && result.checkboxChecked) {
          const next = Array.from(new Set([...config.trustedDevices, context.senderId]));
          this.configService.setValue('lan.trustedDevices', next);
        }
      }

      if (!accepted) {
        try { fs.rmSync(context.root, { recursive: true, force: true }); } catch {}
        this.activeSockets.delete(context.transferId);
        await writeFrame(context.socket, { type: 'reject', transferId: context.transferId });
        context.done = true;
        context.socket.end();
        return;
      }

      await writeFrame(context.socket, { type: 'accept', transferId: context.transferId });
      this.emitProgress({
        transferId: context.transferId,
        deviceId: context.senderId,
        deviceName: context.senderName,
        direction: 'receive',
        state: 'transferring',
        bytes: 0,
        total,
        filesDone: 0,
        filesTotal: context.files.length,
      });
    } catch (error) {
      this.failReceive(context, error instanceof Error ? error : new Error(String(error)));
    }
  }

  private handleFileStart(context: ReceiveContext, header: Record<string, any>): void {
    try {
      if (!context.root) throw new Error('未接受传输');
      const index = Number(header.index);
      const relPath = String(header.relPath || '');
      const destination = sanitizeRelativePath(context.root, relPath);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      let finalPath = destination;
      if (fs.existsSync(finalPath)) {
        const parsed = path.parse(destination);
        let suffix = 1;
        while (fs.existsSync(finalPath)) {
          finalPath = path.join(parsed.dir, `${parsed.name} (${suffix})${parsed.ext}`);
          suffix++;
        }
      }
      const tempPath = `${finalPath}.part`;
      const stream = fs.createWriteStream(tempPath);
      context.current = {
        index,
        relPath,
        stream,
        hash: crypto.createHash('sha256'),
        tempPath,
        finalPath,
      };
    } catch (error) {
      this.failReceive(context, error instanceof Error ? error : new Error(String(error)));
    }
  }

  private handleChunk(context: ReceiveContext, data: Buffer): void {
    if (!context.current) {
      this.failReceive(context, new Error('收到无归属的数据块'));
      return;
    }
    context.current.stream.write(data);
    context.current.hash.update(data);
    context.bytes += data.length;
    this.emitProgress({
      transferId: context.transferId,
      deviceId: context.senderId,
      deviceName: context.senderName,
      direction: 'receive',
      state: 'transferring',
      bytes: context.bytes,
      total: context.total,
      filesDone: context.filesDone,
      filesTotal: context.files.length,
      currentFile: context.current.relPath,
    });
  }

  private handleFileEnd(context: ReceiveContext, header: Record<string, any>): void {
    const current = context.current;
    if (!current) {
      this.failReceive(context, new Error('收到无归属的文件结束帧'));
      return;
    }
    context.current = undefined;
    current.stream.end(() => {
      try {
        const digest = current.hash.digest('hex');
        if (header.sha256 && digest !== String(header.sha256)) {
          throw new Error(`文件校验失败: ${current.relPath}`);
        }
        fs.renameSync(current.tempPath, current.finalPath);
        context.filesDone++;
        this.emitProgress({
          transferId: context.transferId,
          deviceId: context.senderId,
          deviceName: context.senderName,
          direction: 'receive',
          state: 'transferring',
          bytes: context.bytes,
          total: context.total,
          filesDone: context.filesDone,
          filesTotal: context.files.length,
        });
        void writeFrame(context.socket, {
          type: 'file-ack',
          transferId: context.transferId,
          index: current.index,
        });
      } catch (error) {
        try { fs.rmSync(current.tempPath, { force: true }); } catch {}
        this.failReceive(context, error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private handleDone(context: ReceiveContext): void {
    context.done = true;
    this.activeSockets.delete(context.transferId);
    this.emitProgress({
      transferId: context.transferId,
      deviceId: context.senderId,
      deviceName: context.senderName,
      direction: 'receive',
      state: 'done',
      bytes: context.bytes,
      total: context.total,
      filesDone: context.filesDone,
      filesTotal: context.files.length,
    });
    if (Notification.isSupported()) {
      new Notification({
        title: '局域网传输完成',
        body: `${context.senderName} 发送的 ${context.files.length} 个文件已保存`,
      }).show();
    }
    context.socket.end();
  }

  private failReceive(context: ReceiveContext, error: Error): void {
    if (context.done || context.cancelled) return;
    context.cancelled = true;
    this.cleanupReceive(context);
    void writeFrame(context.socket, { type: 'error', message: error.message }).catch(() => {});
    context.socket.destroy();
    this.activeSockets.delete(context.transferId);
    this.emitProgress({
      transferId: context.transferId,
      deviceId: context.senderId,
      deviceName: context.senderName,
      direction: 'receive',
      state: 'error',
      bytes: context.bytes,
      total: context.total,
      filesDone: context.filesDone,
      filesTotal: context.files.length,
      error: error.message,
    });
  }

  private cleanupReceive(context: ReceiveContext): void {
    if (context.current) {
      try { context.current.stream.destroy(); } catch {}
      try { fs.rmSync(context.current.tempPath, { force: true }); } catch {}
      context.current = undefined;
    }
  }

  private getDownloadRoot(senderName: string): string {
    const config = this.getConfig();
    const base = config.downloadDir || path.join(app.getPath('downloads'), 'Aero Transfer');
    fs.mkdirSync(base, { recursive: true });
    const safeName = senderName.replace(/[^\w.-]+/g, '_').slice(0, 40) || 'device';
    return fs.mkdtempSync(path.join(base, `${safeName}-`));
  }

  private emitProgress(progress: LanProgress): void {
    const now = Date.now();
    const last = this.lastProgressAt.get(progress.transferId) ?? 0;
    if (progress.state === 'transferring' && now - last < 100) return;
    this.lastProgressAt.set(progress.transferId, now);
    this.eventRouter.emit('aero:lanProgress', progress);
    if (progress.state === 'error') this.eventRouter.emit('aero:lanError', progress);
    if (progress.state === 'done' || progress.state === 'error' || progress.state === 'cancelled') {
      this.lastProgressAt.delete(progress.transferId);
      this.eventRouter.emit('aero:lanComplete', progress);
    }
  }
}
