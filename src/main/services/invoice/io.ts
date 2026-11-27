// File IO for the invoice organizer: PDF text extraction with a two-layer
// cache (in-memory LRU + on-disk snapshot keyed by path/mtime/size), folder
// scans, and directory copy helpers.
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { PDFParse } from 'pdf-parse';
import { app } from 'electron';
import {
  classify,
  flat,
  invoiceNo,
  isTripFile,
  issueDate,
  money,
  parseTrain,
  seller,
  sellerPhone,
  type InvoiceRecord,
  type ParseConfig,
  type TripRecord,
} from './parse';
import { formatExcelDate } from './parse';
import { tripTotal, parseTrips } from './parse';

const MEMORY_CACHE_LIMIT = 300;
const DISK_CACHE_LIMIT = 500;
const SCAN_CONCURRENCY = 4;
const TREE_MAX_DEPTH = 12;

export interface PdfTextCacheEntry {
  mtimeMs: number;
  size: number;
  text: string;
}

const parseCache = new Map<string, PdfTextCacheEntry>();

export function normalizePath(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

// On-disk cache root: ~/.vibekit/cache/invoice-text/<sha1(path)>.json
function diskCacheDir(): string {
  return path.join(app.getPath('home'), '.vibekit', 'cache', 'invoice-text');
}

function diskCachePath(filePath: string): string {
  const hash = crypto.createHash('sha1').update(normalizePath(filePath)).digest('hex');
  return path.join(diskCacheDir(), `${hash}.json`);
}

function readDiskCache(filePath: string): PdfTextCacheEntry | null {
  try {
    const raw = fs.readFileSync(diskCachePath(filePath), 'utf8');
    const parsed = JSON.parse(raw) as Partial<PdfTextCacheEntry>;
    if (typeof parsed?.mtimeMs !== 'number' || typeof parsed?.size !== 'number' || typeof parsed?.text !== 'string') return null;
    return { mtimeMs: parsed.mtimeMs, size: parsed.size, text: parsed.text };
  } catch {
    return null;
  }
}

function writeDiskCache(filePath: string, stat: fs.Stats, text: string): void {
  try {
    const dir = diskCacheDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(diskCachePath(filePath), JSON.stringify({ mtimeMs: stat.mtimeMs, size: stat.size, text } satisfies PdfTextCacheEntry));
    pruneDiskCache(dir);
  } catch {
    // disk cache is best-effort
  }
}

// Keep the newest DISK_CACHE_LIMIT entries; prune is best-effort.
function pruneDiskCache(dir: string): void {
  try {
    const names = fs.readdirSync(dir).filter((name) => name.endsWith('.json'));
    if (names.length <= DISK_CACHE_LIMIT) return;
    const stats = names.map((name) => {
      const full = path.join(dir, name);
      let mtimeMs = 0;
      try { mtimeMs = fs.statSync(full).mtimeMs; } catch { /* gone */ }
      return { full, mtimeMs };
    });
    stats.sort((a, b) => a.mtimeMs - b.mtimeMs);
    for (const item of stats.slice(0, stats.length - DISK_CACHE_LIMIT)) {
      try { fs.unlinkSync(item.full); } catch { /* ignore */ }
    }
  } catch {
    // ignore
  }
}

export function clearParseCache(): void {
  parseCache.clear();
  try {
    const dir = diskCacheDir();
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

function pdfjsAssetUrl(name: string): string | undefined {
  try {
    const root = path.dirname(path.dirname(require.resolve('pdfjs-dist')));
    return path.join(root, name).replace(/\\/g, '/') + '/';
  } catch {
    return undefined;
  }
}

export async function pdfText(filePath: string): Promise<string> {
  try {
    const loadOptions: Record<string, unknown> = { data: fs.readFileSync(filePath) };
    const cMapUrl = pdfjsAssetUrl('cmaps');
    const standardFontDataUrl = pdfjsAssetUrl('standard_fonts');
    if (cMapUrl) {
      loadOptions.cMapUrl = cMapUrl;
      loadOptions.cMapPacked = true;
    }
    if (standardFontDataUrl) loadOptions.standardFontDataUrl = standardFontDataUrl;
    const parser = new PDFParse(loadOptions as never);
    const result = await parser.getText();
    await parser.destroy();
    return stripPageMarkers(result.text);
  } catch (error) {
    return `[UNREADABLE ${error instanceof Error ? error.message : String(error)}]`;
  }
}

function stripPageMarkers(text: string): string {
  return text.replace(/^-- \d+ of \d+ --$/gm, '').trim();
}

export async function pdfTextCached(filePath: string): Promise<string> {
  let stat: fs.Stats | null = null;
  try {
    stat = fs.statSync(filePath);
  } catch {
    stat = null;
  }
  if (!stat) return await pdfText(filePath);
  const key = normalizePath(filePath);
  const cached = parseCache.get(key);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    // Refresh LRU position.
    parseCache.delete(key);
    parseCache.set(key, cached);
    return cached.text;
  }
  const diskHit = readDiskCache(filePath);
  if (diskHit && diskHit.mtimeMs === stat.mtimeMs && diskHit.size === stat.size) {
    parseCache.set(key, diskHit);
    while (parseCache.size > MEMORY_CACHE_LIMIT) {
      const oldest = parseCache.keys().next().value;
      if (oldest === undefined) break;
      parseCache.delete(oldest);
    }
    return diskHit.text;
  }
  const text = await pdfText(filePath);
  if (!text.startsWith('[UNREADABLE')) {
    const entry = { mtimeMs: stat.mtimeMs, size: stat.size, text };
    parseCache.set(key, entry);
    while (parseCache.size > MEMORY_CACHE_LIMIT) {
      const oldest = parseCache.keys().next().value;
      if (oldest === undefined) break;
      parseCache.delete(oldest);
    }
    writeDiskCache(filePath, stat, text);
  }
  return text;
}

export type ScanProgress = (info: { done: number; total: number; file: string }) => void;

export async function scan(
  folder: string,
  config: ParseConfig,
  onProgress?: ScanProgress,
): Promise<{ invoices: InvoiceRecord[]; trips: TripRecord[] }> {
  const files = fs.readdirSync(folder).filter((file) => file.toLowerCase().endsWith('.pdf')).sort();
  const records = await mapLimit(files, SCAN_CONCURRENCY, async (file) => {
    const fullPath = path.join(folder, file);
    let stat: fs.Stats | null = null;
    try {
      stat = fs.statSync(fullPath);
    } catch {
      stat = null;
    }
    const cell = await pdfTextCached(fullPath);
    return {
      file,
      path: fullPath,
      folder,
      mtimeMs: stat?.mtimeMs ?? 0,
      size: stat?.size ?? 0,
      cell,
    };
  });
  const invoices: InvoiceRecord[] = [];
  const trips: TripRecord[] = [];
  for (let index = 0; index < records.length; index++) {
    const { file, path: fullPath, mtimeMs, size, cell } = records[index];
    onProgress?.({ done: index + 1, total: records.length, file });
    if (isTripFile(cell, file)) {
      trips.push({ file, total: tripTotal(cell), trips: parseTrips(cell), raw: cell });
      continue;
    }
    const kind = classify(cell, file);
    const record: InvoiceRecord = {
      file,
      path: fullPath,
      folder,
      mtimeMs,
      size,
      kind,
      amount: money(cell),
      date: issueDate(cell),
      no: invoiceNo(cell),
      seller: seller(cell, config),
      tel: sellerPhone(cell),
      raw: cell,
      trip: null,
    };
    if (kind === 'flight') {
      const flight = flat(cell).match(/行程信息[:：]\s*(\d{4})-(\d{2})-(\d{2})\s*([一-龥]{2,6})-([一-龥]{2,6})/);
      record.flight = flight ? [flight[1], flight[2], flight[3], flight[4], flight[5]] : null;
    }
    if (kind === 'train') record.train = parseTrain(cell);
    invoices.push(record);
  }
  return { invoices, trips };
}

export interface PdfProbe {
  file: string;
  path: string;
  folder: string;
  mtimeMs: number;
  size: number;
  no: string;
  date: string;
  seller: string;
  amount: number | null;
}

export function collectPdfFiles(root: string, maxFiles: number): { files: string[]; truncated: boolean } {
  const files: string[] = [];
  const stack: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  let truncated = false;
  while (stack.length) {
    if (files.length >= maxFiles) {
      truncated = true;
      break;
    }
    const current = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (files.length >= maxFiles) {
        truncated = true;
        break;
      }
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || /_backup_/i.test(entry.name)) continue;
      if (entry.isSymbolicLink()) continue;
      const fullPath = path.join(current.dir, entry.name);
      if (entry.isDirectory()) {
        if (current.depth < TREE_MAX_DEPTH) stack.push({ dir: fullPath, depth: current.depth + 1 });
        continue;
      }
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdf')) files.push(fullPath);
    }
  }
  return { files, truncated };
}

// Probe a single PDF for index-scan purposes (invoice number / date / seller /
// amount only). Returns null for trip sheets; throws nothing.
export async function probePdf(filePath: string, config: ParseConfig, stat: fs.Stats): Promise<PdfProbe | null> {
  const file = path.basename(filePath);
  const folder = path.dirname(filePath);
  const text = await pdfTextCached(filePath);
  if (text.startsWith('[UNREADABLE')) {
    throw new Error(text);
  }
  if (isTripFile(text, file)) return null;
  const sellerName = seller(text, config);
  return {
    file,
    path: filePath,
    folder,
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    no: invoiceNo(text),
    date: formatExcelDate(issueDate(text)),
    seller: sellerName,
    amount: money(text),
  };
}

export function copyDirSync(source: string, destination: string): void {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const src = path.join(source, entry.name);
    const dst = path.join(destination, entry.name);
    if (entry.isDirectory()) copyDirSync(src, dst);
    else fs.copyFileSync(src, dst);
  }
}
