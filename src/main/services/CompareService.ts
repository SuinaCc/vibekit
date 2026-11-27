import { nativeImage } from 'electron';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type {
  CompareDirEntry,
  CompareDirMode,
  CompareDirOptions,
  CompareDirResult,
  CompareDirSide,
  CompareDirStats,
  CompareDirStatus,
  CompareFileInfo,
  CompareFileKind,
  CompareImageFile,
  CompareInspectResult,
  CompareTextFile,
} from '@shared';

const TEXT_LIMIT = 2 * 1024 * 1024;
const IMAGE_LIMIT = 25 * 1024 * 1024;
const SAMPLE_SIZE = 8192;
const DIR_MAX_ENTRIES = 20000;
const DIR_MAX_DEPTH = 32;
const DIR_HASH_CONCURRENCY = 6;
const DIR_QUICK_MTIME_TOLERANCE = 2000;
const DIR_WARNING_LIMIT = 20;

const IMAGE_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  avif: 'image/avif',
  tif: 'image/tiff',
  tiff: 'image/tiff',
};

const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'json', 'json5', 'jsonc', 'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs',
  'html', 'htm', 'css', 'scss', 'less', 'xml', 'svg', 'yml', 'yaml', 'toml', 'ini', 'cfg',
  'conf', 'env', 'log', 'csv', 'tsv', 'sql', 'py', 'go', 'rs', 'java', 'kt', 'kts', 'c', 'cpp',
  'cc', 'h', 'hpp', 'cs', 'php', 'rb', 'sh', 'bash', 'ps1', 'bat', 'cmd', 'vue', 'svelte',
  'gitignore', 'dockerfile', 'lock', 'gradle', 'properties', 'tex', 'rst', 'srt', 'vtt',
]);

function validatePath(value: unknown): string {
  const filePath = typeof value === 'string' ? value.trim() : '';
  if (!filePath || filePath.length > 4096) throw new Error('文件路径无效');
  return filePath;
}

function toIso(date: Date): string {
  try {
    return date.toISOString();
  } catch {
    return '';
  }
}

function decodeText(buffer: Buffer): { text: string; binary: boolean } {
  let work = buffer;
  if (work.length >= 3 && work[0] === 0xef && work[1] === 0xbb && work[2] === 0xbf) {
    work = work.subarray(3);
  } else if (work.length >= 2 && work[0] === 0xff && work[1] === 0xfe) {
    return { text: work.subarray(2).toString('utf16le'), binary: false };
  } else if (work.length >= 2 && work[0] === 0xfe && work[1] === 0xff) {
    const swapped = Buffer.from(work.subarray(2));
    for (let i = 0; i + 1 < swapped.length; i += 2) {
      const temp = swapped[i];
      swapped[i] = swapped[i + 1];
      swapped[i + 1] = temp;
    }
    return { text: swapped.toString('utf16le'), binary: false };
  }
  const sample = work.subarray(0, Math.min(work.length, SAMPLE_SIZE));
  if (sample.includes(0)) return { text: '', binary: true };
  return { text: work.toString('utf8'), binary: false };
}

function readSample(filePath: string): Buffer {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(SAMPLE_SIZE);
    const read = fs.readSync(fd, buffer, 0, SAMPLE_SIZE, 0);
    return buffer.subarray(0, read);
  } finally {
    fs.closeSync(fd);
  }
}

function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

function detectKind(extension: string, size: number, sample: Buffer): CompareFileKind {
  if (IMAGE_MIME[extension]) return 'image';
  if (sample.includes(0)) return 'binary';
  if (TEXT_EXTENSIONS.has(extension)) return 'text';
  return size <= TEXT_LIMIT ? 'text' : 'binary';
}

interface DirScanContext {
  ignoreHidden: boolean;
  ignoreNames: Set<string>;
  maxEntries: number;
  count: number;
  truncated: boolean;
  warnings: string[];
}

interface ScannedDirEntry {
  relPath: string;
  name: string;
  kind: 'file' | 'dir';
  size: number;
  modified: string;
  path: string;
}

interface NormalizedDirOptions {
  mode: CompareDirMode;
  ignoreHidden: boolean;
  ignoreNames: string[];
  maxEntries: number;
}

interface HashTask {
  leftPath: string;
  rightPath: string;
  apply(leftHash: string, rightHash: string): void;
  fail(): void;
}

function dirPathKey(relPath: string): string {
  return process.platform === 'linux' ? relPath : relPath.toLowerCase();
}

function pushDirWarning(ctx: DirScanContext, message: string): void {
  if (ctx.warnings.length < DIR_WARNING_LIMIT) ctx.warnings.push(message);
}

function detectKindByExtension(name: string): CompareFileKind {
  const dot = name.lastIndexOf('.');
  const extension = dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
  if (IMAGE_MIME[extension]) return 'image';
  if (TEXT_EXTENSIONS.has(extension)) return 'text';
  return 'binary';
}

function normalizeDirOptions(value: unknown): NormalizedDirOptions {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const mode: CompareDirMode = raw.mode === 'quick' ? 'quick' : 'content';
  const ignoreHidden = raw.ignoreHidden !== false;
  const names: string[] = [];
  if (Array.isArray(raw.ignoreNames)) {
    for (const item of raw.ignoreNames) {
      if (typeof item !== 'string') continue;
      const name = item.trim().toLowerCase();
      if (!name || name.length > 80 || names.includes(name)) continue;
      names.push(name);
      if (names.length >= 24) break;
    }
  }
  const requestedMax = typeof raw.maxEntries === 'number' && Number.isFinite(raw.maxEntries)
    ? Math.floor(raw.maxEntries)
    : DIR_MAX_ENTRIES;
  return {
    mode,
    ignoreHidden,
    ignoreNames: names,
    maxEntries: Math.max(100, Math.min(50000, requestedMax)),
  };
}

async function scanDirTree(root: string, ctx: DirScanContext): Promise<Map<string, ScannedDirEntry>> {
  const map = new Map<string, ScannedDirEntry>();
  async function walk(absDir: string, relBase: string, depth: number): Promise<void> {
    if (ctx.count >= ctx.maxEntries) {
      ctx.truncated = true;
      return;
    }
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(absDir, { withFileTypes: true });
    } catch {
      pushDirWarning(ctx, `无法读取目录：${path.basename(absDir) || absDir}`);
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name, 'en'));
    for (const dirent of entries) {
      if (ctx.count >= ctx.maxEntries) {
        ctx.truncated = true;
        return;
      }
      const name = dirent.name;
      if (ctx.ignoreHidden && name.startsWith('.')) continue;
      if (ctx.ignoreNames.has(name.toLowerCase())) continue;
      const absPath = path.join(absDir, name);
      let stats: fs.Stats;
      try {
        stats = await fs.promises.lstat(absPath);
      } catch {
        pushDirWarning(ctx, `无法读取：${name}`);
        continue;
      }
      if (stats.isSymbolicLink()) continue;
      const relPath = relBase ? `${relBase}/${name}` : name;
      if (stats.isDirectory()) {
        ctx.count += 1;
        map.set(dirPathKey(relPath), {
          relPath,
          name,
          kind: 'dir',
          size: 0,
          modified: toIso(stats.mtime),
          path: absPath,
        });
        if (depth >= DIR_MAX_DEPTH) {
          ctx.truncated = true;
          pushDirWarning(ctx, `目录层级过深，已跳过：${name}`);
          continue;
        }
        await walk(absPath, relPath, depth + 1);
      } else if (stats.isFile()) {
        ctx.count += 1;
        map.set(dirPathKey(relPath), {
          relPath,
          name,
          kind: 'file',
          size: stats.size,
          modified: toIso(stats.mtime),
          path: absPath,
        });
      }
    }
  }
  await walk(root, '', 0);
  return map;
}

async function runHashTasks(tasks: HashTask[]): Promise<void> {
  if (!tasks.length) return;
  let cursor = 0;
  const workerCount = Math.min(DIR_HASH_CONCURRENCY, tasks.length);
  async function worker(): Promise<void> {
    while (cursor < tasks.length) {
      const task = tasks[cursor];
      cursor += 1;
      try {
        const [leftHash, rightHash] = await Promise.all([
          hashFile(task.leftPath),
          hashFile(task.rightPath),
        ]);
        task.apply(leftHash, rightHash);
      } catch {
        task.fail();
      }
    }
  }
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
}

function makeDirSide(entry: ScannedDirEntry, kind: CompareFileKind): CompareDirSide {
  return {
    name: entry.name,
    path: entry.path,
    size: entry.size,
    modified: entry.modified,
    kind,
  };
}

export class CompareService {
  async readText(pathValue: unknown): Promise<CompareTextFile> {
    const filePath = validatePath(pathValue);
    const stats = await fs.promises.stat(filePath);
    if (stats.isDirectory()) throw new Error('请选择文件，而不是文件夹');
    const sample = readSample(filePath);
    const decodedSample = decodeText(sample);
    if (decodedSample.binary) throw new Error('该文件不是文本文件，无法进行文本对比');

    const readLength = Math.min(stats.size, TEXT_LIMIT);
    const fd = fs.openSync(filePath, 'r');
    let buffer: Buffer;
    try {
      buffer = Buffer.alloc(readLength);
      let offset = 0;
      while (offset < readLength) {
        const read = fs.readSync(fd, buffer, offset, readLength - offset, offset);
        if (read <= 0) break;
        offset += read;
      }
      buffer = buffer.subarray(0, offset);
    } finally {
      fs.closeSync(fd);
    }
    const decoded = decodeText(buffer);
    if (decoded.binary) throw new Error('该文件不是文本文件，无法进行文本对比');
    return {
      name: path.basename(filePath),
      path: filePath,
      size: stats.size,
      modified: toIso(stats.mtime),
      text: decoded.text,
      truncated: stats.size > buffer.length,
    };
  }

  async readImage(pathValue: unknown): Promise<CompareImageFile> {
    const filePath = validatePath(pathValue);
    const stats = await fs.promises.stat(filePath);
    if (stats.isDirectory()) throw new Error('请选择图片文件，而不是文件夹');
    const extension = path.extname(filePath).slice(1).toLowerCase();
    let mime = IMAGE_MIME[extension];
    if (!mime) {
      const probe = nativeImage.createFromPath(filePath);
      if (probe.isEmpty()) throw new Error('不是支持的图片格式');
      mime = 'image/png';
    }
    if (stats.size > IMAGE_LIMIT) throw new Error('图片超过 25 MB，暂不支持对比');
    const data = await fs.promises.readFile(filePath);
    const native = nativeImage.createFromPath(filePath);
    const dimensions = native.isEmpty() ? { width: 0, height: 0 } : native.getSize();
    return {
      name: path.basename(filePath),
      path: filePath,
      size: stats.size,
      modified: toIso(stats.mtime),
      mime,
      dataUrl: `data:${mime};base64,${data.toString('base64')}`,
      width: dimensions.width || null,
      height: dimensions.height || null,
    };
  }

  async inspect(leftValue: unknown, rightValue: unknown): Promise<CompareInspectResult> {
    const leftPath = validatePath(leftValue);
    const rightPath = validatePath(rightValue);
    const [leftStats, rightStats] = await Promise.all([
      fs.promises.stat(leftPath),
      fs.promises.stat(rightPath),
    ]);
    if (leftStats.isDirectory() || rightStats.isDirectory()) throw new Error('请选择文件，而不是文件夹');
    const [leftSample, rightSample] = [readSample(leftPath), readSample(rightPath)];
    const [leftHash, rightHash] = await Promise.all([hashFile(leftPath), hashFile(rightPath)]);
    const makeInfo = (
      filePath: string,
      stats: fs.Stats,
      sample: Buffer,
      hash: string,
    ): CompareFileInfo => {
      const extension = path.extname(filePath).slice(1).toLowerCase();
      return {
        name: path.basename(filePath),
        path: filePath,
        size: stats.size,
        modified: toIso(stats.mtime),
        created: toIso(stats.birthtime),
        extension,
        kind: detectKind(extension, stats.size, sample),
        hash,
      };
    };
    const left = makeInfo(leftPath, leftStats, leftSample, leftHash);
    const right = makeInfo(rightPath, rightStats, rightSample, rightHash);
    return {
      left,
      right,
      identical: leftStats.size === rightStats.size && leftHash === rightHash,
    };
  }

  async compareDirs(leftValue: unknown, rightValue: unknown, options?: unknown): Promise<CompareDirResult> {
    const leftRoot = validatePath(leftValue);
    const rightRoot = validatePath(rightValue);
    const [leftStats, rightStats] = await Promise.all([
      fs.promises.stat(leftRoot),
      fs.promises.stat(rightRoot),
    ]);
    if (!leftStats.isDirectory() || !rightStats.isDirectory()) throw new Error('请选择两个文件夹');

    const opts = normalizeDirOptions(options);
    const leftCtx: DirScanContext = {
      ignoreHidden: opts.ignoreHidden,
      ignoreNames: new Set(opts.ignoreNames),
      maxEntries: opts.maxEntries,
      count: 0,
      truncated: false,
      warnings: [],
    };
    const rightCtx: DirScanContext = {
      ignoreHidden: opts.ignoreHidden,
      ignoreNames: new Set(opts.ignoreNames),
      maxEntries: opts.maxEntries,
      count: 0,
      truncated: false,
      warnings: [],
    };
    const [leftMap, rightMap] = await Promise.all([
      scanDirTree(leftRoot, leftCtx),
      scanDirTree(rightRoot, rightCtx),
    ]);

    const warnings = [...leftCtx.warnings, ...rightCtx.warnings].slice(0, DIR_WARNING_LIMIT);
    const entries: CompareDirEntry[] = [];
    const entryByKey = new Map<string, CompareDirEntry>();
    const hashTasks: HashTask[] = [];
    const keys = new Set<string>([...leftMap.keys(), ...rightMap.keys()]);

    for (const key of keys) {
      const leftScan = leftMap.get(key);
      const rightScan = rightMap.get(key);
      const leftIsDir = leftScan?.kind === 'dir';
      const rightIsDir = rightScan?.kind === 'dir';
      const kind: 'file' | 'dir' = leftIsDir && rightIsDir
        ? 'dir'
        : ((leftIsDir && !rightScan) || (rightIsDir && !leftScan))
          ? 'dir'
          : 'file';
      const leftKind = leftScan ? (leftIsDir ? 'other' : detectKindByExtension(leftScan.name)) : null;
      const rightKind = rightScan ? (rightIsDir ? 'other' : detectKindByExtension(rightScan.name)) : null;
      const left = leftScan && leftKind ? makeDirSide(leftScan, leftKind) : null;
      const right = rightScan && rightKind ? makeDirSide(rightScan, rightKind) : null;

      let status: CompareDirStatus;
      if (!leftScan) {
        status = 'right-only';
      } else if (!rightScan) {
        status = 'left-only';
      } else if (leftIsDir !== rightIsDir) {
        status = 'different';
      } else if (leftIsDir && rightIsDir) {
        status = 'same';
      } else if (leftScan.size !== rightScan.size) {
        status = 'different';
      } else if (leftScan.size === 0) {
        status = 'same';
      } else if (opts.mode === 'quick') {
        const delta = Math.abs(new Date(leftScan.modified).getTime() - new Date(rightScan.modified).getTime());
        status = Number.isFinite(delta) && delta <= DIR_QUICK_MTIME_TOLERANCE ? 'same' : 'different';
      } else {
        // Same-size files need content hashes before we can call them equal.
        status = 'different';
      }

      const entry: CompareDirEntry = {
        relPath: leftScan?.relPath || rightScan!.relPath,
        name: leftScan?.name || rightScan!.name,
        kind,
        status,
        left,
        right,
      };

      if (
        left && right &&
        leftScan && rightScan &&
        !leftIsDir && !rightIsDir &&
        leftScan.size === rightScan.size &&
        leftScan.size > 0 &&
        opts.mode === 'content'
      ) {
        hashTasks.push({
          leftPath: leftScan.path,
          rightPath: rightScan.path,
          apply(leftHash, rightHash) {
            left.hash = leftHash;
            right.hash = rightHash;
            entry.status = leftHash === rightHash ? 'same' : 'different';
          },
          fail() {
            if (warnings.length < DIR_WARNING_LIMIT) warnings.push(`无法校验内容：${entry.name}`);
          },
        });
      }

      entries.push(entry);
      entryByKey.set(key, entry);
    }

    await runHashTasks(hashTasks);

    // A directory is different when any descendant differs. Directories that
    // exist on only one side keep their one-sided status.
    for (const entry of entries) {
      if (entry.status === 'same') continue;
      let rel = entry.relPath;
      while (rel.includes('/')) {
        rel = rel.slice(0, rel.lastIndexOf('/'));
        const parent = entryByKey.get(dirPathKey(rel));
        if (!parent) break;
        if (parent.kind === 'dir' && parent.left && parent.right && parent.status === 'same') {
          parent.status = 'different';
        }
      }
    }

    const stats: CompareDirStats = {
      files: 0,
      dirs: 0,
      same: 0,
      different: 0,
      leftOnly: 0,
      rightOnly: 0,
      bytesLeft: 0,
      bytesRight: 0,
    };
    for (const entry of entries) {
      if (entry.kind === 'dir') {
        stats.dirs += 1;
        continue;
      }
      stats.files += 1;
      if (entry.status === 'same') stats.same += 1;
      else if (entry.status === 'different') stats.different += 1;
      else if (entry.status === 'left-only') stats.leftOnly += 1;
      else stats.rightOnly += 1;
      if (entry.left) stats.bytesLeft += entry.left.size;
      if (entry.right) stats.bytesRight += entry.right.size;
    }

    entries.sort((a, b) => {
      const ak = dirPathKey(a.relPath);
      const bk = dirPathKey(b.relPath);
      return ak < bk ? -1 : ak > bk ? 1 : 0;
    });

    return {
      leftRoot,
      rightRoot,
      mode: opts.mode,
      entries,
      stats,
      truncated: leftCtx.truncated || rightCtx.truncated,
      warnings,
    };
  }
}
