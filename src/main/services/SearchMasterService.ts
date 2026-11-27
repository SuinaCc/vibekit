import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type {
  FilePreview,
  PreviewKind,
  SearchDateFilter,
  SearchFileType,
  SearchKind,
  SearchMasterStatus,
  SearchQueryParams,
  SearchResponse,
  SearchResultItem,
  SearchSizeFilter,
  SearchSort,
} from '@shared';
import { getBuiltinPluginsDir, getPluginsDir } from '../utils/paths';

const PLUGIN_ID = 'local.search-master';
const TEXT_PREVIEW_LIMIT = 256 * 1024;
const IMAGE_PREVIEW_LIMIT = 12 * 1024 * 1024;

const EXT_GROUPS: Record<Exclude<SearchFileType, 'all'>, string> = {
  image: 'ext:jpg;jpeg;png;gif;webp;bmp;svg;ico;tif;tiff;avif;heic',
  document: 'ext:pdf;doc;docx;xls;xlsx;ppt;pptx;txt;md;rtf;csv;epub;one',
  video: 'ext:mp4;mkv;avi;mov;wmv;flv;webm;m4v;ts',
  audio: 'ext:mp3;flac;wav;aac;ogg;m4a;wma;ape',
  archive: 'ext:zip;rar;7z;tar;gz;bz2;xz;iso;cab',
  code: 'ext:js;jsx;ts;tsx;json;html;htm;css;scss;less;py;go;rs;java;c;cpp;h;hpp;cs;php;rb;sh;ps1;bat;yml;yaml;toml;xml;sql;vue;svelte',
};

const SIZE_TERMS: Record<Exclude<SearchSizeFilter, 'any'>, string> = {
  gt10mb: 'size:>10mb',
  gt100mb: 'size:>100mb',
  gt1gb: 'size:>1gb',
};

const DATE_TERMS: Record<Exclude<SearchDateFilter, 'any'>, string> = {
  today: 'dm:today',
  week: 'dm:thisweek',
  month: 'dm:thismonth',
};

const SORTS: readonly SearchSort[] = [
  'name-ascending',
  'name-descending',
  'date-modified-descending',
  'size-descending',
];

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

const VIDEO_MIME: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  mov: 'video/quicktime',
  webm: 'video/webm',
  wmv: 'video/x-ms-wmv',
  flv: 'video/x-flv',
  ts: 'video/mp2t',
};

const AUDIO_MIME: Record<string, string> = {
  mp3: 'audio/mpeg',
  flac: 'audio/flac',
  wav: 'audio/wav',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  wma: 'audio/x-ms-wma',
  ape: 'audio/ape',
};

const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'json', 'json5', 'jsonc', 'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs',
  'html', 'htm', 'css', 'scss', 'less', 'xml', 'svg', 'yml', 'yaml', 'toml', 'ini', 'cfg',
  'conf', 'env', 'log', 'csv', 'tsv', 'sql', 'py', 'go', 'rs', 'java', 'kt', 'kts', 'c', 'cpp',
  'cc', 'h', 'hpp', 'cs', 'php', 'rb', 'sh', 'bash', 'ps1', 'bat', 'cmd', 'vue', 'svelte',
  'gitignore', 'dockerfile', 'lock', 'gradle', 'properties',
]);

interface RawEsResult {
  name?: string;
  filename?: string;
  size?: number;
  date_modified?: string;
  date_created?: string;
  extension?: string;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function decodeEsOutput(buffer: Buffer): string {
  // ES writes JSON in the Windows ANSI code page. Try strict UTF-8 first
  // (ASCII/UTF-8 systems), then fall back to GB18030 for Chinese Windows.
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    try {
      return new TextDecoder('gb18030').decode(buffer);
    } catch {
      return buffer.toString('utf8');
    }
  }
}

function execEs(esPath: string, args: string[], timeoutMs = 5000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      esPath,
      args,
      { windowsHide: true, timeout: timeoutMs, maxBuffer: 12 * 1024 * 1024, encoding: 'buffer' },
      (error, stdout, stderr) => {
        const out = decodeEsOutput(stdout as Buffer);
        const errOut = decodeEsOutput(stderr as Buffer);
        if (!error) {
          resolve(out);
          return;
        }
        const detail = `${errOut}\n${out}\n${error.message || ''}`
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)[0];
        reject(new Error(detail || 'ES 调用失败'));
      },
    );
  });
}

function toIso(value: Date): string {
  try {
    return value.toISOString();
  } catch {
    return '';
  }
}

function locateEs(): string | null {
  const candidates = [
    path.join(getPluginsDir(), PLUGIN_ID, 'bin', 'es.exe'),
    path.join(getBuiltinPluginsDir(), PLUGIN_ID, 'bin', 'es.exe'),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

function decodeText(buffer: Buffer): { text: string; binary: boolean } {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return { text: buffer.subarray(3).toString('utf8'), binary: false };
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return { text: buffer.subarray(2).toString('utf16le'), binary: false };
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.from(buffer.subarray(2));
    for (let i = 0; i + 1 < swapped.length; i += 2) {
      const tmp = swapped[i];
      swapped[i] = swapped[i + 1];
      swapped[i + 1] = tmp;
    }
    return { text: swapped.toString('utf16le'), binary: false };
  }
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  if (sample.includes(0)) return { text: '', binary: true };
  return { text: buffer.toString('utf8'), binary: false };
}

function readTextPreview(filePath: string, size: number): { text: string; truncated: boolean; binary: boolean } {
  const readLength = Math.min(size, TEXT_PREVIEW_LIMIT);
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.alloc(readLength);
  try {
    let offset = 0;
    while (offset < readLength) {
      const read = fs.readSync(fd, buffer, offset, readLength - offset, offset);
      if (read <= 0) break;
      offset += read;
    }
    const decoded = decodeText(buffer.subarray(0, offset));
    return {
      text: decoded.text,
      truncated: size > offset,
      binary: decoded.binary,
    };
  } finally {
    fs.closeSync(fd);
  }
}

export class SearchMasterService {
  private esPath: string | null = locateEs();

  async status(): Promise<SearchMasterStatus> {
    if (process.platform !== 'win32') {
      return {
        available: false,
        esVersion: null,
        everythingVersion: null,
        esPath: this.esPath,
        error: '搜索大师仅支持 Windows',
      };
    }
    if (!this.esPath) {
      return {
        available: false,
        esVersion: null,
        everythingVersion: null,
        esPath: null,
        error: '未找到 ES 搜索组件（es.exe），请重新安装/同步插件',
      };
    }
    try {
      const [esVersionOut, everythingVersionOut] = await Promise.all([
        execEs(this.esPath, ['-version'], 4000),
        execEs(this.esPath, ['-get-everything-version'], 4000),
      ]);
      const esVersion = esVersionOut.trim().split(/\r?\n/)[0] || null;
      const everythingVersion = everythingVersionOut.trim().split(/\r?\n/)[0] || null;
      return {
        available: !!everythingVersion && /^\d/.test(everythingVersion),
        esVersion,
        everythingVersion,
        esPath: this.esPath,
        error: everythingVersion ? undefined : 'Everything 未运行',
      };
    } catch (err) {
      return {
        available: false,
        esVersion: null,
        everythingVersion: null,
        esPath: this.esPath,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async query(input: unknown): Promise<SearchResponse> {
    if (!this.esPath) throw new Error('未找到 ES 搜索组件（es.exe）');
    const started = Date.now();
    const params = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    const query = typeof params.query === 'string' ? params.query.slice(0, 500) : '';
    const kind = oneOf<SearchKind>(params.kind, ['all', 'files', 'folders'], 'all');
    const fileType = oneOf<SearchFileType>(
      params.fileType,
      ['all', 'image', 'document', 'video', 'audio', 'archive', 'code'],
      'all',
    );
    const size = oneOf<SearchSizeFilter>(params.size, ['any', 'gt10mb', 'gt100mb', 'gt1gb'], 'any');
    const date = oneOf<SearchDateFilter>(params.date, ['any', 'today', 'week', 'month'], 'any');
    const sort = oneOf<SearchSort>(params.sort, SORTS, 'name-ascending');
    const offset = clampInt(params.offset, 0, 1_000_000, 0);
    const limit = clampInt(params.limit, 1, 200, 100);
    const folderPath =
      typeof params.path === 'string' && params.path.trim() && params.path.length <= 2048
        ? params.path.trim()
        : null;

    const terms: string[] = [];
    if (query.trim()) terms.push(query.trim());
    if (kind !== 'folders' && fileType !== 'all') terms.push(EXT_GROUPS[fileType]);
    if (size !== 'any') terms.push(SIZE_TERMS[size]);
    if (date !== 'any') terms.push(DATE_TERMS[date]);
    const searchText = terms.join(' ').trim() || '*';

    const filterArgs: string[] = [];
    if (kind === 'files') filterArgs.push('-a-d');
    else if (kind === 'folders') filterArgs.push('-ad');
    if (folderPath) filterArgs.push('-path', folderPath);

    const queryArgs = [
      '-json',
      '-name',
      '-full-path-and-name',
      '-size',
      '-date-modified',
      '-date-created',
      '-extension',
      '-date-format',
      '1',
      '-size-format',
      '1',
      ...filterArgs,
      '-sort',
      sort,
      '-viewport-offset',
      String(offset),
      '-viewport-count',
      String(limit),
      searchText,
    ];

    try {
      const [rawOut, countOut] = await Promise.all([
        execEs(this.esPath, queryArgs, 6000),
        execEs(this.esPath, ['-get-result-count', ...filterArgs, searchText], 4000).catch(() => ''),
      ]);
      const cleaned = rawOut.replace(/^﻿/, '').trim();
      let raw: RawEsResult[] = [];
      if (cleaned) {
        try {
          const parsed = JSON.parse(cleaned);
          raw = Array.isArray(parsed) ? parsed : [];
        } catch {
          throw new Error('无法解析 Everything 返回结果');
        }
      }
      const results: SearchResultItem[] = raw.map((item) => {
        const fullPath = String(item.filename || '');
        const isFolder = /[\\/]$/.test(fullPath);
        const trimmedPath = fullPath.replace(/[\\/]+$/, '');
        const name = String(item.name || path.basename(trimmedPath) || trimmedPath);
        const parent = isFolder
          ? (/^[A-Za-z]:$/.test(trimmedPath) ? `${trimmedPath}\\` : path.dirname(trimmedPath))
          : path.dirname(fullPath);
        const extension =
          (typeof item.extension === 'string' && item.extension) ||
          path.extname(name).slice(1).toLowerCase();
        return {
          name,
          fullPath,
          path: parent,
          size: typeof item.size === 'number' && Number.isFinite(item.size) ? item.size : 0,
          modified: typeof item.date_modified === 'string' ? item.date_modified : null,
          created: typeof item.date_created === 'string' ? item.date_created : null,
          extension,
          isFolder,
        };
      });
      const totalValue = Number.parseInt(countOut.trim(), 10);
      return {
        results,
        total: Number.isFinite(totalValue) ? totalValue : null,
        offset,
        limit,
        elapsedMs: Date.now() - started,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/everything|ipc|not running|failed/i.test(message)) {
        throw new Error('Everything 未运行或未安装，请启动 Everything 后重试');
      }
      throw err;
    }
  }

  async preview(pathValue: unknown): Promise<FilePreview> {
    const filePath = typeof pathValue === 'string' ? pathValue.trim() : '';
    if (!filePath || filePath.length > 4096) throw new Error('文件路径无效');
    const name = path.basename(filePath.replace(/[\\/]+$/, ''));
    const extension = path.extname(name).slice(1).toLowerCase();
    const base: FilePreview = {
      kind: 'error',
      name,
      fullPath: filePath,
      extension,
      size: 0,
      modified: null,
      created: null,
      accessed: null,
      isFolder: false,
      mime: null,
    };

    let stats: fs.Stats;
    try {
      stats = await fs.promises.stat(filePath);
    } catch (err) {
      return { ...base, error: err instanceof Error ? err.message : String(err) };
    }
    const metadata = {
      ...base,
      size: stats.size,
      modified: toIso(stats.mtime),
      created: toIso(stats.birthtime),
      accessed: toIso(stats.atime),
      isFolder: stats.isDirectory(),
    };
    if (stats.isDirectory()) return { ...metadata, kind: 'folder' };

    const imageMime = IMAGE_MIME[extension];
    if (imageMime) {
      if (stats.size > IMAGE_PREVIEW_LIMIT) {
        return { ...metadata, kind: 'image', mime: imageMime, error: '图片过大，无法直接预览' };
      }
      try {
        const data = await fs.promises.readFile(filePath);
        return {
          ...metadata,
          kind: 'image',
          mime: imageMime,
          dataUrl: `data:${imageMime};base64,${data.toString('base64')}`,
        };
      } catch (err) {
        return { ...metadata, kind: 'image', mime: imageMime, error: err instanceof Error ? err.message : String(err) };
      }
    }

    if (extension === 'pdf') return { ...metadata, kind: 'pdf', mime: 'application/pdf' };
    const videoMime = VIDEO_MIME[extension];
    if (videoMime) return { ...metadata, kind: 'video', mime: videoMime };
    const audioMime = AUDIO_MIME[extension];
    if (audioMime) return { ...metadata, kind: 'audio', mime: audioMime };

    if (TEXT_EXTENSIONS.has(extension) || extension === '') {
      try {
        const preview = readTextPreview(filePath, stats.size);
        if (preview.binary) return { ...metadata, kind: 'binary' };
        return {
          ...metadata,
          kind: 'text' as PreviewKind,
          text: preview.text,
          truncated: preview.truncated,
        };
      } catch (err) {
        return { ...metadata, kind: 'error', error: err instanceof Error ? err.message : String(err) };
      }
    }

    return { ...metadata, kind: 'unsupported' };
  }
}
