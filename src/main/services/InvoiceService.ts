import ExcelJS from 'exceljs';
import { PDFParse } from 'pdf-parse';
import * as fs from 'fs';
import * as path from 'path';
import type {
  InvoiceConfig,
  InvoiceDuplicate,
  InvoiceDuplicateConflict,
  InvoiceIndexStatus,
  InvoicePreview,
  InvoicePreviewRow,
  InvoicePreviewVerify,
  InvoiceRenameGroup,
  InvoiceResult,
  InvoiceTreeScanResult,
} from '@shared';
import type { DataService } from './DataService';

type DateParts = { y: number; m: number; d: number };
type Kind = 'didi' | 'train' | 'flight' | 'hotel' | 'other';

interface PlaceAlias {
  keys: string[];
  alias: string;
}

interface ParseConfig {
  eid: string;
  name: string;
  dest: string;
  ename: string;
  project: string;
  selfKeywords: string[];
  places: PlaceAlias[];
  cities: string[];
}

interface Trip {
  date: string;
  from: string;
  to: string;
  amount: number;
  city: string;
}

interface TripRecord {
  file: string;
  total: number | null;
  trips: Trip[];
  raw: string;
}

interface InvoiceRecord {
  file: string;
  path: string;
  folder: string;
  mtimeMs: number;
  size: number;
  kind: Kind;
  amount: number | null;
  date: DateParts | null;
  no: string;
  seller: string;
  raw: string;
  trip: TripRecord | null;
  flight?: [string, string, string, string, string] | null;
  train?: [DateParts | null, string, string, string, string] | null;
  no_?: number;
  earliest?: DateParts | null;
  _year?: number | null;
}

interface InvoiceIndexEntry {
  no: string;
  path: string;
  folder: string;
  mtimeMs: number;
  size: number;
  date: string;
  seller: string;
  amount: number | null;
  file: string;
  indexedAt: number;
}

interface InvoiceIndexMeta {
  lastScanAt: number | null;
  lastScanRoot: string | null;
}

interface PdfProbe {
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

const INDEX_NAMESPACE = 'local.invoice-organizer';
const INDEX_KEY = 'invoiceIndex:v1';
const INDEX_META_KEY = 'invoiceIndex:meta';
const PARSE_CACHE_LIMIT = 300;
const SCAN_CONCURRENCY = 4;
const TREE_MAX_FILES = 2000;
const TREE_MAX_DEPTH = 12;

interface ParseCacheEntry {
  mtimeMs: number;
  size: number;
  text: string;
}

const parseCache = new Map<string, ParseCacheEntry>();

function normalizePath(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

async function mapLimit<T, R>(
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

interface Row {
  no: number;
  start: DateParts | null;
  end: DateParts | null;
  days: string;
  desc: string;
  amount: number | null;
  note: string;
  invoice: InvoiceRecord;
}

const HEADERS = ['开始日期', '结束日期', '天数', '单位简称', '项目名称', '说明', '金额', '备注', '发票类型'];
const COL_WIDTH: Record<string, number> = {
  A: 11.125, B: 12.875, C: 12, D: 8, E: 12.2, F: 12.3, G: 43.5, H: 10, I: 42, J: 8,
};
const DATE_FMT = 'yyyy-mm-dd';
const CAT_RANK: Record<Kind, number> = { didi: 0, train: 1, flight: 1, hotel: 2, other: 3 };
const HOTEL_KEYS = ['酒店', '宾馆', '旅馆', '民宿', '公寓'];
const HUB_RE = /([一-龥]{2,6}(?:站|机场))/;
const CITY_PREFIXES = ['武汉', '杭州', '上海', '北京', '南京', '宁波', '广州', '深圳', '成都', '西安', '哈尔滨', '舟山', '苏州', '合肥', '长沙', '郑州'];
const CITY_HINT = ['杭州', '武汉', '舟山', '哈尔滨', '上海', '北京', '宁波', '南京', '广州', '深圳', '成都', '西安'];

const FONT = { name: '等线', size: 12 } as const;
const THIN = { style: 'thin' as const, color: { argb: 'FF000000' } };
const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function dp(y: number, m: number, d: number): DateParts {
  return { y, m, d };
}

function dpFromDate(date: Date): DateParts {
  return dp(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function toDate(parts: DateParts): Date {
  return new Date(Date.UTC(parts.y, parts.m - 1, parts.d));
}

function dateKey(parts: DateParts | null | undefined): number {
  return parts ? parts.y * 10000 + parts.m * 100 + parts.d : Number.MAX_SAFE_INTEGER;
}

function fmtDate(parts: DateParts | null): string {
  return parts ? `${parts.y}-${pad2(parts.m)}-${pad2(parts.d)}` : '?';
}

function fmtFileDate(parts: DateParts | null): string {
  return parts ? `${parts.y}-${pad2(parts.m)}-${pad2(parts.d)}` : '';
}

function formatExcelDate(parts: DateParts | null): string {
  return parts ? `${parts.y}-${pad2(parts.m)}-${pad2(parts.d)}` : '';
}

function flat(text: string): string {
  return text.normalize('NFKC').replace(/\s+/g, ' ').replace(/ /g, ' ').trim();
}

function stripPageMarkers(text: string): string {
  return text.replace(/^-- \d+ of \d+ --$/gm, '').trim();
}

function normalizeConfig(raw: InvoiceConfig | undefined): ParseConfig {
  const value = (raw ?? {}) as Record<string, any>;
  const selfKeywords = Array.isArray(value.selfKeywords ?? value.self_keywords)
    ? (value.selfKeywords ?? value.self_keywords).filter((item: unknown) => typeof item === 'string')
    : [];
  const places: PlaceAlias[] = [];
  for (const item of Array.isArray(value.places) ? value.places : []) {
    if (!Array.isArray(item) || item.length < 2) continue;
    const keys = Array.isArray(item[0]) ? item[0] : [item[0]];
    const alias = String(item[1] ?? '').trim();
    const cleanKeys = keys.map((key: unknown) => String(key).trim()).filter(Boolean);
    if (cleanKeys.length && alias) places.push({ keys: cleanKeys, alias });
  }
  return {
    eid: String(value.eid ?? '').trim(),
    name: String(value.name ?? '').trim(),
    dest: String(value.dest ?? '').trim(),
    ename: String(value.ename ?? '').trim(),
    project: String(value.project ?? '').trim(),
    selfKeywords,
    places,
    cities: Array.isArray(value.cities) && value.cities.length ? value.cities.map(String) : CITY_HINT,
  };
}

function normHub(name: string): string {
  if (name.endsWith('站')) {
    for (const city of CITY_PREFIXES) {
      if (name.startsWith(city) && name.length > city.length + 1) {
        const rest = name.slice(city.length);
        if (!/^[东南西北]/.test(rest)) return rest;
        break;
      }
    }
  }
  return name;
}

function stripAdmin(value: string): string {
  let result = value.split('|').pop()?.trim() ?? '';
  result = result.replace(/^[一-龥]{2,3}(?:区|市|县)\s*/, '');
  result = result.replace(/^[一-龥]{2,3}街道\s*/, '');
  return result.trim();
}

function stripParen(value: string): string {
  let previous: string | null = null;
  while (previous !== value) {
    previous = value;
    value = value.replace(/[（(][^（()）]*[）)]/g, '').trim();
  }
  return value.replace(/[（()）]/g, '').trim() || value.trim();
}

function originalPlace(raw: string): string {
  const stripped = stripAdmin(raw);
  return (stripped || raw).replace(/\s+/g, ' ').trim();
}

function placeShort(raw: string, config: ParseConfig): string {
  const stripped = stripAdmin(raw);
  for (const place of config.places) {
    if (place.keys.some((key) => stripped.includes(key))) return place.alias;
  }
  const withoutParen = stripParen(stripped);
  const hub = HUB_RE.exec(withoutParen);
  const hotelIndexes = HOTEL_KEYS.map((key) => withoutParen.indexOf(key)).filter((index) => index >= 0);
  const hotelAt = hotelIndexes.length ? Math.min(...hotelIndexes) : -1;
  if (hub && (hotelAt < 0 || (hub.index ?? 0) < hotelAt)) return normHub(hub[1]);
  if (hotelAt >= 0) return '酒店';
  const clean = withoutParen.replace(/\s+/g, '').trim();
  // 解析不出“研究所/酒店”等语义时，降级到行程单原文，不写“未知”。
  return clean || originalPlace(raw);
}

function money(cell: string): number | null {
  const currency = '[¥￥]';
  const values: number[] = [];
  for (const match of cell.matchAll(new RegExp(`${currency}\\s*(-?[\\d,]+\\.\\d{2})`, 'g'))) {
    values.push(parseFloat(match[1].replace(/,/g, '')));
  }
  for (const match of cell.matchAll(/(-?[\d,]+\.\d{2})\s*[¥￥]/g)) {
    values.push(parseFloat(match[1].replace(/,/g, '')));
  }
  if (values.length) return round2(Math.max(...values));
  let match = cell.match(new RegExp(`票价[:：]?\\s*${currency}?\\s*([\\d,]+\\.\\d{2})`));
  if (match) return round2(parseFloat(match[1].replace(/,/g, '')));
  match = cell.match(/（小写）\s*[¥￥]\s*([\d,]+\.\d{2})/);
  return match ? round2(parseFloat(match[1].replace(/,/g, ''))) : null;
}

function invoiceNo(cell: string): string {
  let match = cell.match(/发\s*票\s*号\s*码\s*[:：]?\s*(\d{16,25})/);
  if (!match) match = cell.match(/(?<!\d)(\d{20})(?!\d)/);
  return match ? match[1] : '';
}

function issueDate(cell: string): DateParts | null {
  let match = cell.match(/开\s*票\s*日\s*期\s*[:：]?\s*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (!match) match = cell.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  return match ? dp(parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10)) : null;
}

function seller(cell: string, config: ParseConfig): string {
  let names = Array.from(cell.matchAll(/[一-龥A-Za-z0-9()（）]{4,40}(?:有限公司|分公司|研究院)/g)).map((match) => match[0]);
  names = names.filter((name) => !name.includes('银行') && !name.includes('支行') && !name.includes('信用社'));
  if (config.selfKeywords.length) {
    names = names.filter((name) => !config.selfKeywords.some((keyword) => name.includes(keyword)));
  } else if (names.length > 1) {
    names = names.slice(1);
  }
  return names.length ? names[names.length - 1] : '';
}

function sellerCity(name: string, config: ParseConfig): string {
  return config.cities.find((city) => (name || '').includes(city)) ?? '';
}

function splitFromTo(bodyValue: string): [string, string] {
  const body = bodyValue.replace(/\s+/g, ' ').trim();
  const pipes: number[] = [];
  for (let index = 0; index < body.length; index++) if (body[index] === '|') pipes.push(index);

  if (pipes.length >= 2) {
    let split = body.lastIndexOf(' ', pipes[1]);
    if (split < 0) split = pipes[1];
    return [body.slice(0, split).trim(), body.slice(split + 1).trim()];
  }
  if (pipes.length === 1) {
    const pipe = pipes[0];
    const left = body.slice(0, pipe).trim();
    const right = body.slice(pipe + 1).trim();
    const leftChunk = left.includes(' ') ? left.split(' ').pop()! : left;
    const rightChunk = right.includes(' ') ? right.split(' ')[0] : right;
    const leftRest = left.slice(0, left.length - leftChunk.length).trim();
    const rightRest = right.slice(rightChunk.length).trim();
    const block = `${leftChunk}|${rightChunk}`;
    if (leftRest && rightRest) return [`${leftRest} ${leftChunk}`, `${rightChunk} ${rightRest}`];
    if (leftRest) return [leftRest, block];
    if (rightRest) return [block, rightRest];
    return [leftChunk, rightChunk];
  }
  const parts = body.split(' ').filter(Boolean);
  if (parts.length >= 2) return [parts[0], parts[parts.length - 1]];
  return [body, ''];
}

function parseTrips(tripText: string): Trip[] {
  let text = flat(tripText).replace(/页码:/g, '页码：');
  const hits = Array.from(text.matchAll(/(\d{2})-(\d{2}) (\d{2}:\s?\d{2}) (周\s?[一二三四五六日])/g));
  const trips: Trip[] = [];
  for (let index = 0; index < hits.length; index++) {
    const match = hits[index];
    const start = (match.index ?? 0) + match[0].length;
    const end = index + 1 < hits.length ? hits[index + 1].index ?? text.length : text.length;
    const segment = text.slice(start, end).split('页码')[0];
    const numbers = Array.from(segment.matchAll(/([\d.]+)\s+([\d.]+\.\d{2})/g));
    if (!numbers.length) continue;
    const last = numbers[numbers.length - 1];
    const distance = last[1];
    const amount = last[2];
    const cut = segment.lastIndexOf(`${distance} ${amount}`);
    if (cut < 0) continue;
    let body = segment.slice(0, cut).trim();
    body = body.replace(/\s+\d+\s*$/, '').trim();
    const cityMatch = body.match(/^([一-龥]{2,4})\s?市/);
    const city = cityMatch ? cityMatch[1] : '';
    body = body.replace(/^[一-龥]{2,4}\s?市\s*/, '').trim();
    body = body.replace(/^\d+\s*/, '').trim();
    let [from, to] = splitFromTo(body);
    from = from.replace(/\s+/g, '');
    to = to.replace(/\s+/g, '');
    if (from && to && (from.endsWith(to) || to.endsWith(from))) {
      if (to.length < from.length) [from, to] = [to, from];
    }
    if (!from || !to) continue;
    trips.push({ date: `${match[1]}-${match[2]}`, from, to, amount: parseFloat(amount), city });
  }
  if (!trips.length) return parseAmap(text);
  return trips;
}

function parseAmap(text: string): Trip[] {
  const trips: Trip[] = [];
  const regex = /(\d{4})-(\d{2})-(\d{2})\s+(\d{2}:\d{2})([一-龥]{2,4}市)?([^0-9:：]{2,120}?)\s*([\d,]+\.\d{2})元/g;
  for (const match of text.matchAll(regex)) {
    let middle = (match[6] || '').trim();
    middle = middle.replace(/^\s*(风韵出行|特选|经济型|经济|特惠|快车|专车|优享|舒适|豪华)\s*/, '');
    middle = middle.replace(/^\s*([一-龥]{2,4})\s*市\s*/, '');
    middle = middle.replace(/\s+/g, ' ').trim();
    if (!middle) continue;
    let cut = Math.max(middle.lastIndexOf('·'), middle.lastIndexOf(' '));
    if (cut <= 0) continue;
    let to = middle.slice(cut + 1).trim();
    let from = middle.slice(0, cut).trim();
    if (to.length < 3) {
      const space = middle.lastIndexOf(' ');
      from = middle.slice(0, space).trim();
      to = middle.slice(space + 1).trim();
    }
    from = from.replace(/\s+/g, '');
    to = to.replace(/\s+/g, '');
    if (!from || !to) continue;
    trips.push({
      date: `${match[2]}-${match[3]}`,
      from,
      to,
      amount: parseFloat(match[7].replace(/,/g, '')),
      city: (match[5] || '').replace(/市$/, ''),
    });
  }
  return trips;
}

function tripTotal(cell: string): number | null {
  const match = flat(cell).match(/合计\s*([\d,]+\.?\d*)\s*元/);
  return match ? round2(parseFloat(match[1].replace(/,/g, ''))) : null;
}

function isTrip(cell: string): boolean {
  if (cell.includes('DIDI TRAVEL') || cell.includes('AMAP ITINERARY') || cell.includes('行程单')) return true;
  return cell.includes('行程人手机号') && cell.includes('序号');
}

function isTripFile(cell: string, fileName: string): boolean {
  return isTrip(cell) || (fileName || '').includes('行程单');
}

function classify(cell: string, fileName = ''): Kind {
  const name = (fileName || '').normalize('NFKC');
  if (name.includes('铁路') || name.includes('客票') || name.includes('火车')) return 'train';
  const text = flat(cell).replace(/\s+/g, '');
  if (text.includes('铁路') || text.includes('12306') || text.includes('电子客票') || text.includes('火车票') || text.includes('车次')) {
    return 'train';
  }
  if (text.toLowerCase().includes('didi') || text.includes('滴滴出行') || text.includes('风韵出行')) return 'didi';
  if (text.includes('万合') || text.includes('顺励') || text.includes('网约车') || text.includes('汽车租赁')) return 'didi';
  if (text.includes('代订机票') || text.includes('经纪代理服务')) return 'flight';
  if (text.includes('酒店') || text.includes('住宿服务')) return 'hotel';
  return 'other';
}

function parseTrain(cell: string): [DateParts | null, string, string, string, string] {
  const text = flat(cell);
  const dateMatch = text.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*(\d{1,2}:\d{2})\s*开/);
  const date = dateMatch ? dp(parseInt(dateMatch[1], 10), parseInt(dateMatch[2], 10), parseInt(dateMatch[3], 10)) : null;
  let from = '';
  let to = '';
  let trainNo = '';
  // 铁路电子客票常见版式: "杭州西站 汉口站 G594"（车次在两端站之后）
  const routeAfter = text.match(/([一-龥]{2,8}站)\s+([一-龥]{2,8}站)\s*([GDCZTKY]\d{1,4})/);
  if (routeAfter) {
    from = routeAfter[1];
    to = routeAfter[2];
    trainNo = routeAfter[3];
  } else {
    const routeBetween = text.match(/([一-龥]{2,8})\s*站?\s*([GDCZTKY]\d{1,4})\s*([一-龥]{2,8})\s*站?/);
    if (routeBetween) {
      from = routeBetween[1];
      trainNo = routeBetween[2];
      to = routeBetween[3];
    }
  }
  const seatMatch = text.match(/(二等座|一等座|商务座|无座|硬座|软卧|硬卧|动卧|高级软卧)/);
  return [date, from, to, trainNo, seatMatch ? seatMatch[1] : ''];
}

function pdfjsAssetUrl(name: string): string | undefined {
  try {
    const root = path.dirname(path.dirname(require.resolve('pdfjs-dist')));
    return path.join(root, name).replace(/\\/g, '/') + '/';
  } catch {
    return undefined;
  }
}

async function pdfText(filePath: string): Promise<string> {
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

async function pdfTextCached(filePath: string): Promise<string> {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return await pdfText(filePath);
  }
  const key = normalizePath(filePath);
  const cached = parseCache.get(key);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    // Refresh LRU position.
    parseCache.delete(key);
    parseCache.set(key, cached);
    return cached.text;
  }
  const text = await pdfText(filePath);
  if (!text.startsWith('[UNREADABLE')) {
    parseCache.set(key, { mtimeMs: stat.mtimeMs, size: stat.size, text });
    while (parseCache.size > PARSE_CACHE_LIMIT) {
      const oldest = parseCache.keys().next().value;
      if (oldest === undefined) break;
      parseCache.delete(oldest);
    }
  }
  return text;
}

async function scan(folder: string, config: ParseConfig): Promise<{ invoices: InvoiceRecord[]; trips: TripRecord[] }> {
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
  for (const item of records) {
    const { file, path: fullPath, mtimeMs, size, cell } = item;
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

function pair(invoices: InvoiceRecord[], trips: TripRecord[]): string[] {
  const warnings: string[] = [];
  const pool = [...trips];
  for (const invoice of invoices) {
    if (invoice.kind !== 'didi') continue;
    const candidates = pool.filter((trip) => trip.total !== null && invoice.amount !== null && Math.abs(trip.total - invoice.amount) < 0.01);
    if (candidates.length === 1) {
      invoice.trip = candidates[0];
      pool.splice(pool.indexOf(candidates[0]), 1);
    } else if (candidates.length > 1) {
      invoice.trip = candidates[0];
      pool.splice(pool.indexOf(candidates[0]), 1);
      warnings.push(`${invoice.file} 有 ${candidates.length} 张金额相同的行程单, 已按文件顺序取第 1 张`);
    } else {
      warnings.push(`${invoice.file} 未找到金额匹配的行程单 (票面 ${(invoice.amount ?? 0).toFixed(2)}), 该发票的出行日期需手工确认`);
    }
  }
  for (const trip of pool) warnings.push(`行程单 ${trip.file} (合计 ${trip.total ?? '?'}) 没有配对到发票, 已忽略`);
  return warnings;
}

function tripDate(md: string, refYear?: number | null): DateParts {
  const month = parseInt(md.slice(0, 2), 10);
  const day = parseInt(md.slice(3, 5), 10);
  const year = refYear ?? new Date().getFullYear();
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1) return dp(year, month, 1);
  return dp(year, month, day);
}

function refYearOf(invoices: InvoiceRecord[]): number | null {
  const years = new Map<number, number>();
  for (const invoice of invoices) {
    if (invoice.date) years.set(invoice.date.y, (years.get(invoice.date.y) ?? 0) + 1);
  }
  let best: number | null = null;
  let bestCount = -1;
  for (const [year, count] of years) {
    if (count > bestCount) { best = year; bestCount = count; }
  }
  return best;
}

function earliest(invoice: InvoiceRecord, hotelStart: Map<string, DateParts | null>): DateParts | null {
  if (invoice.kind === 'didi' && invoice.trip?.trips.length) {
    return invoice.trip.trips
      .map((trip) => tripDate(trip.date, invoice._year))
      .sort((a, b) => dateKey(a) - dateKey(b))[0] ?? null;
  }
  if (invoice.kind === 'flight' && invoice.flight) {
    return dp(parseInt(invoice.flight[0], 10), parseInt(invoice.flight[1], 10), parseInt(invoice.flight[2], 10));
  }
  if (invoice.kind === 'train' && invoice.train?.[0]) return invoice.train[0];
  if (invoice.kind === 'hotel') return hotelStart.get(invoice.file) ?? invoice.date;
  return null;
}

function hotelPeriod(hotels: InvoiceRecord[], firstDay: DateParts | null): Map<string, [DateParts | null, DateParts | null]> {
  const periods = new Map<string, [DateParts | null, DateParts | null]>();
  let previous: DateParts | null = null;
  for (const hotel of hotels) {
    const date = hotel.date;
    let start: DateParts | null = null;
    let end: DateParts | null = null;
    if (firstDay && date) {
      start = previous ?? firstDay;
      end = date;
    }
    periods.set(hotel.file, [start, end]);
    previous = date ?? previous;
  }
  return periods;
}

function assignNumbers(invoices: InvoiceRecord[]): { periods: Map<string, [DateParts | null, DateParts | null]> } {
  const refYear = refYearOf(invoices);
  for (const invoice of invoices) invoice._year = refYear;

  const allDays: DateParts[] = [];
  for (const invoice of invoices) {
    if (invoice.kind === 'didi' && invoice.trip) {
      for (const trip of invoice.trip.trips) allDays.push(tripDate(trip.date, refYear));
    }
    if (invoice.kind === 'train' && invoice.train?.[0]) allDays.push(invoice.train[0]);
    if (invoice.kind === 'flight' && invoice.flight) {
      allDays.push(dp(parseInt(invoice.flight[0], 10), parseInt(invoice.flight[1], 10), parseInt(invoice.flight[2], 10)));
    }
  }
  const firstDay = allDays.length ? allDays.reduce((a, b) => (dateKey(a) <= dateKey(b) ? a : b)) : null;
  const hotels = invoices.filter((invoice) => invoice.kind === 'hotel').sort((a, b) => {
    const ak = a.date ? dateKey(a.date) : Number.MAX_SAFE_INTEGER;
    const bk = b.date ? dateKey(b.date) : Number.MAX_SAFE_INTEGER;
    return ak - bk;
  });
  const periods = hotelPeriod(hotels, firstDay);
  const hotelStart = new Map<string, DateParts | null>();
  for (const hotel of hotels) hotelStart.set(hotel.file, periods.get(hotel.file)?.[0] ?? null);

  for (const invoice of invoices) invoice.earliest = earliest(invoice, hotelStart);
  invoices.sort((a, b) => {
    const hotelA = a.kind === 'hotel' ? 1 : 0;
    const hotelB = b.kind === 'hotel' ? 1 : 0;
    if (hotelA !== hotelB) return hotelA - hotelB;
    const dateA = dateKey(a.earliest);
    const dateB = dateKey(b.earliest);
    if (dateA !== dateB) return dateA - dateB;
    const rankA = CAT_RANK[a.kind];
    const rankB = CAT_RANK[b.kind];
    if (rankA !== rankB) return rankA - rankB;
    return (a.amount ?? 0) - (b.amount ?? 0);
  });
  invoices.forEach((invoice, index) => { invoice.no_ = index + 1; });
  return { periods };
}

function renamePlan(invoices: InvoiceRecord[]): Array<[string, string]> {
  const plan: Array<[string, string]> = [];
  for (const invoice of invoices) {
    const no = invoice.no_ ?? 0;
    plan.push([invoice.file, `${no}.pdf`]);
    if (invoice.trip) plan.push([invoice.trip.file, `${no}报销单.pdf`]);
  }
  return plan;
}

function describePlace(raw: string, config: ParseConfig): string {
  const value = placeShort(raw, config);
  if (!value || value === '未知' || value === '未识别') return originalPlace(raw);
  return value;
}

function describeTrip(from: string, to: string, config: ParseConfig): string {
  let x = describePlace(from, config);
  let y = describePlace(to, config);
  if (x === y) y = originalPlace(to);
  return `${x}打车到${y}`;
}

function diffDays(start: DateParts, end: DateParts): number {
  return Math.round((toDate(end).getTime() - toDate(start).getTime()) / 86400000);
}

function buildRows(invoices: InvoiceRecord[], periods: Map<string, [DateParts | null, DateParts | null]>, config: ParseConfig): Row[] {
  const rows: Row[] = [];
  for (const invoice of invoices) {
    const no = invoice.no_ ?? 0;
    const push = (start: DateParts | null, end: DateParts | null, days: string, desc: string, amount: number | null, note = '') => {
      rows.push({ no, start, end, days, desc, amount, note, invoice });
    };
    if (invoice.kind === 'didi') {
      if (invoice.trip?.trips.length) {
        for (const trip of invoice.trip.trips) {
          const date = tripDate(trip.date, invoice._year);
          push(date, date, '1天', describeTrip(trip.from, trip.to, config), trip.amount);
        }
      } else {
        push(invoice.date, invoice.date, '1天', '打车', invoice.amount);
      }
    } else if (invoice.kind === 'flight') {
      if (invoice.flight) {
        const date = dp(parseInt(invoice.flight[0], 10), parseInt(invoice.flight[1], 10), parseInt(invoice.flight[2], 10));
        push(date, date, '1天', `${invoice.flight[3]}到${invoice.flight[4]}机票`, invoice.amount);
      } else {
        push(invoice.date, invoice.date, '1天', '机票', invoice.amount);
      }
    } else if (invoice.kind === 'train') {
      const [date, from, to] = invoice.train ?? [null, '', '', '', ''];
      const departure = date ?? invoice.date;
      const desc = from && to ? `${from}到${to}高铁` : '高铁';
      push(departure, departure, '1天', desc, invoice.amount);
    } else if (invoice.kind === 'hotel') {
      const period = periods.get(invoice.file) ?? [null, null];
      const start = period[0];
      const end = period[1] ?? invoice.date;
      const days = start && end ? `${Math.max(diffDays(start, end), 1)}天` : '';
      const city = sellerCity(invoice.seller, config);
      push(start, end, days, city ? `${city}酒店` : '酒店', invoice.amount);
    } else {
      push(invoice.date, invoice.date, '1天', '其他费用', invoice.amount);
    }
  }
  return rows;
}

function tripSpan(invoices: InvoiceRecord[]): [DateParts | null, DateParts | null] {
  const days: DateParts[] = [];
  for (const invoice of invoices) {
    if (invoice.kind === 'didi' && invoice.trip) {
      for (const trip of invoice.trip.trips) days.push(tripDate(trip.date, invoice._year));
    } else if (invoice.kind === 'train' && invoice.train?.[0]) {
      days.push(invoice.train[0]);
    } else if (invoice.kind === 'flight' && invoice.flight) {
      days.push(dp(parseInt(invoice.flight[0], 10), parseInt(invoice.flight[1], 10), parseInt(invoice.flight[2], 10)));
    }
  }
  if (!days.length) return [null, null];
  const first = days.reduce((a, b) => (dateKey(a) <= dateKey(b) ? a : b));
  const last = days.reduce((a, b) => (dateKey(a) >= dateKey(b) ? a : b));
  return [first, last];
}

function guessName(texts: string[]): string {
  for (const text of texts) {
    const match = text.match(/\*{4}\d{4}\s+([一-龥]{2,4})/);
    if (match) return match[1];
  }
  for (const text of texts) {
    const match = text.match(/(?:出行人|旅客姓名|姓名)[:：]?\s*(?!有效|证件|工号|部门|姓名|手机号|电话)([一-龥]{2,4})/);
    if (match) return match[1];
  }
  return '';
}

function guessDest(invoices: InvoiceRecord[], config: ParseConfig): string {
  const counts = new Map<string, number>();
  let firstCity = '';
  for (const invoice of invoices) {
    if (invoice.kind === 'didi' && invoice.trip) {
      for (const trip of invoice.trip.trips) {
        if (!trip.city) continue;
        if (!firstCity) firstCity = trip.city;
        counts.set(trip.city, (counts.get(trip.city) ?? 0) + 1);
      }
    }
    if (invoice.kind === 'train' && invoice.train) {
      for (const point of [invoice.train[1], invoice.train[2]]) {
        for (const city of config.cities) {
          if ((point || '').includes(city)) counts.set(city, (counts.get(city) ?? 0) + 1);
        }
      }
    }
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  for (const [city] of sorted) if (city !== firstCity) return city;
  return sorted[0]?.[0] ?? '';
}

function makeOutName(eid: string, span: [DateParts | null, DateParts | null], name: string, dest: string): string | null {
  const [start, end] = span;
  if (!start || !end) return null;
  const head = eid ? `${eid} ` : '';
  return `${head}${start.y}-${pad2(start.m)}-${pad2(start.d)}-~${end.y}-${pad2(end.m)}-${pad2(end.d)}${name}${dest}出差报销单.xlsx`;
}

function copyDirSync(source: string, destination: string): void {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const src = path.join(source, entry.name);
    const dst = path.join(destination, entry.name);
    if (entry.isDirectory()) copyDirSync(src, dst);
    else fs.copyFileSync(src, dst);
  }
}

function styleSheet(ws: ExcelJS.Worksheet, title: string): void {
  ws.mergeCells('A1:A2');
  ws.mergeCells('B1:J1');
  const a1 = ws.getCell('A1');
  a1.value = '发票编号';
  const b1 = ws.getCell('B1');
  b1.value = ` ${title}`;
  for (const cell of [a1, b1]) {
    cell.font = FONT;
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = BORDER;
  }
  HEADERS.forEach((header, index) => {
    const cell = ws.getCell(2, index + 2);
    cell.value = header;
    cell.font = FONT;
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = BORDER;
  });
  ws.getCell(2, 1).border = BORDER;
  for (const [column, width] of Object.entries(COL_WIDTH)) ws.getColumn(column).width = width;
  ws.getRow(1).height = 22;
  ws.getRow(2).height = 22;
}

async function writeWorkbook(outPath: string, title: string, rows: Row[], invoices: InvoiceRecord[], ename: string, project: string): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const summary = workbook.addWorksheet('汇总表');
  styleSheet(summary, title);

  let rowNumber = 3;
  for (const row of rows) {
    const values = [row.no, row.start ? toDate(row.start) : null, row.end ? toDate(row.end) : null, row.days, ename, project, row.desc, row.amount, row.note, '电子'];
    values.forEach((value, index) => {
      const cell = summary.getCell(rowNumber, index + 1);
      cell.value = value as ExcelJS.CellValue;
      cell.font = FONT;
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: index === 8 };
      cell.border = BORDER;
      if (index === 1 || index === 2) cell.numFmt = DATE_FMT;
    });
    summary.getRow(rowNumber).height = 22;
    rowNumber++;
  }

  const totalRow = rowNumber;
  summary.mergeCells(totalRow, 1, totalRow, 7);
  const totalCell = summary.getCell(totalRow, 1);
  totalCell.value = '总金额';
  totalCell.font = FONT;
  totalCell.alignment = { horizontal: 'center', vertical: 'middle' };
  for (let column = 1; column <= 10; column++) summary.getCell(totalRow, column).border = BORDER;
  const formulaCell = summary.getCell(totalRow, 8);
  formulaCell.value = { formula: `SUM(H3:H${totalRow - 1})` };
  formulaCell.font = FONT;
  formulaCell.alignment = { horizontal: 'center', vertical: 'middle' };

  const verify = workbook.addWorksheet('发票核对');
  const headers = ['发票编号', '票据文件', '发票号码', '开票日期', '销售方', '票面金额', '表内金额合计', '差异'];
  headers.forEach((header, index) => {
    const cell = verify.getCell(1, index + 1);
    cell.value = header;
    cell.font = FONT;
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = BORDER;
  });
  let verifyRow = 2;
  for (const invoice of invoices) {
    const inner = round2(rows.filter((row) => row.no === invoice.no_).reduce((sum, row) => sum + (row.amount ?? 0), 0));
    const files = invoice.file + (invoice.trip ? ` + ${invoice.trip.file}` : '');
    const values = [invoice.no_, files, invoice.no, invoice.date ? toDate(invoice.date) : null, invoice.seller, invoice.amount, inner, round2((invoice.amount ?? 0) - inner)];
    values.forEach((value, index) => {
      const cell = verify.getCell(verifyRow, index + 1);
      cell.value = value as ExcelJS.CellValue;
      cell.font = FONT;
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: index === 1 };
      cell.border = BORDER;
      if (index === 3) cell.numFmt = DATE_FMT;
    });
    verifyRow++;
  }
  const totalInvoice = round2(invoices.reduce((sum, invoice) => sum + (invoice.amount ?? 0), 0));
  const totalInner = round2(rows.reduce((sum, row) => sum + (row.amount ?? 0), 0));
  const totals = ['合计', null, null, null, null, totalInvoice, totalInner, null];
  totals.forEach((value, index) => {
    const cell = verify.getCell(verifyRow, index + 1);
    cell.value = value as ExcelJS.CellValue;
    cell.font = FONT;
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = BORDER;
  });
  for (const [column, width] of Object.entries({ A: 11, B: 34, C: 26, D: 12, E: 34, F: 12, G: 14, H: 10 })) verify.getColumn(column).width = width;

  await workbook.xlsx.writeFile(outPath);
}

function collectPdfFiles(root: string, maxFiles: number): { files: string[]; truncated: boolean } {
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

export class InvoiceService {
  constructor(private dataService?: DataService) {}

  // --- Persistent invoice-number index ---

  private loadIndex(): InvoiceIndexEntry[] {
    if (!this.dataService) return [];
    try {
      const raw = this.dataService.get(INDEX_NAMESPACE, INDEX_KEY) as { version?: number; entries?: unknown } | null;
      if (!raw || !Array.isArray(raw.entries)) return [];
      return raw.entries.filter((entry): entry is InvoiceIndexEntry => (
        !!entry
        && typeof entry === 'object'
        && typeof (entry as InvoiceIndexEntry).no === 'string'
        && typeof (entry as InvoiceIndexEntry).path === 'string'
      ));
    } catch {
      return [];
    }
  }

  private saveIndex(entries: InvoiceIndexEntry[]): void {
    try {
      this.dataService?.set(INDEX_NAMESPACE, INDEX_KEY, { version: 1, entries });
    } catch {
      // index persistence is best-effort
    }
  }

  private loadMeta(): InvoiceIndexMeta {
    if (!this.dataService) return { lastScanAt: null, lastScanRoot: null };
    try {
      const raw = this.dataService.get(INDEX_NAMESPACE, INDEX_META_KEY) as Partial<InvoiceIndexMeta> | null;
      return {
        lastScanAt: typeof raw?.lastScanAt === 'number' ? raw.lastScanAt : null,
        lastScanRoot: typeof raw?.lastScanRoot === 'string' ? raw.lastScanRoot : null,
      };
    } catch {
      return { lastScanAt: null, lastScanRoot: null };
    }
  }

  private saveMeta(meta: InvoiceIndexMeta): void {
    try {
      this.dataService?.set(INDEX_NAMESPACE, INDEX_META_KEY, meta);
    } catch {
      // ignore
    }
  }

  private detectDuplicates(invoices: InvoiceRecord[]): { duplicates: InvoiceDuplicate[]; missingInvoiceNo: number } {
    const missingInvoiceNo = invoices.filter((invoice) => !invoice.no).length;
    const withNumbers = invoices.filter((invoice) => !!invoice.no);
    if (!withNumbers.length) return { duplicates: [], missingInvoiceNo };

    const currentByNo = new Map<string, InvoiceRecord[]>();
    for (const invoice of withNumbers) {
      const list = currentByNo.get(invoice.no) ?? [];
      list.push(invoice);
      currentByNo.set(invoice.no, list);
    }

    const indexByNo = new Map<string, InvoiceIndexEntry[]>();
    for (const entry of this.loadIndex()) {
      if (!entry.no) continue;
      const list = indexByNo.get(entry.no) ?? [];
      list.push(entry);
      indexByNo.set(entry.no, list);
    }

    const currentPaths = new Set(invoices.map((invoice) => normalizePath(invoice.path)));
    const duplicates: InvoiceDuplicate[] = [];

    // One entry per invoice number, regardless of how many copies exist.
    for (const [invoiceNo, group] of currentByNo) {
      const primary = group[0];
      const conflicts = new Map<string, InvoiceDuplicateConflict>();
      let sameFolder = false;
      let otherFolder = false;

      for (const other of group.slice(1)) {
        sameFolder = true;
        conflicts.set(normalizePath(other.path), {
          file: other.file,
          path: other.path,
          folder: other.folder,
          date: formatExcelDate(other.date),
        });
      }

      for (const entry of indexByNo.get(invoiceNo) ?? []) {
        const entryPath = normalizePath(entry.path);
        if (currentPaths.has(entryPath) || conflicts.has(entryPath)) continue;
        let exists = false;
        try {
          exists = fs.existsSync(entry.path);
        } catch {
          exists = false;
        }
        if (!exists) continue;
        if (normalizePath(entry.folder) === normalizePath(primary.folder)) sameFolder = true;
        else otherFolder = true;
        conflicts.set(entryPath, {
          file: entry.file,
          path: entry.path,
          folder: entry.folder,
          date: entry.date,
        });
      }

      if (conflicts.size) {
        duplicates.push({
          invoiceNo,
          file: primary.file,
          path: primary.path,
          folder: primary.folder,
          date: formatExcelDate(primary.date),
          seller: primary.seller,
          amount: primary.amount,
          reason: sameFolder || !otherFolder ? 'same-folder' : 'other-folder',
          conflicts: Array.from(conflicts.values()),
        });
      }
    }

    return { duplicates, missingInvoiceNo };
  }

  private upsertIndex(invoices: InvoiceRecord[], removePaths: string[] = []): void {
    if (!this.dataService) return;
    const entries = this.loadIndex();
    const byPath = new Map<string, InvoiceIndexEntry>();
    for (const entry of entries) byPath.set(normalizePath(entry.path), entry);
    for (const remove of removePaths) byPath.delete(normalizePath(remove));

    // Drop entries in the folders we just scanned when their files vanished.
    const folders = new Set(invoices.map((invoice) => normalizePath(invoice.folder)));
    for (const [key, entry] of byPath) {
      if (!folders.has(normalizePath(entry.folder))) continue;
      try {
        if (!fs.existsSync(entry.path)) byPath.delete(key);
      } catch {
        byPath.delete(key);
      }
    }

    const now = Date.now();
    for (const invoice of invoices) {
      if (!invoice.no) continue;
      byPath.set(normalizePath(invoice.path), {
        no: invoice.no,
        path: invoice.path,
        folder: invoice.folder,
        mtimeMs: invoice.mtimeMs,
        size: invoice.size,
        date: formatExcelDate(invoice.date),
        seller: invoice.seller,
        amount: invoice.amount,
        file: invoice.file,
        indexedAt: now,
      });
    }
    this.saveIndex(Array.from(byPath.values()));
  }

  indexStatus(): InvoiceIndexStatus {
    const entries = this.loadIndex();
    const meta = this.loadMeta();
    return {
      entries: entries.length,
      invoices: new Set(entries.map((entry) => entry.no)).size,
      lastScanAt: meta.lastScanAt,
      lastScanRoot: meta.lastScanRoot,
    };
  }

  clearIndex(): void {
    if (!this.dataService) return;
    try {
      this.dataService.delete(INDEX_NAMESPACE, INDEX_KEY);
      this.dataService.delete(INDEX_NAMESPACE, INDEX_META_KEY);
    } catch {
      // ignore
    }
  }

  async scanTree(parentFolderInput: string, opts?: { maxFiles?: number }): Promise<InvoiceTreeScanResult> {
    const parentFolder = path.resolve(parentFolderInput);
    const config = normalizeConfig(undefined);
    const maxFiles = Math.min(Math.max(opts?.maxFiles ?? TREE_MAX_FILES, 1), 20000);
    const { files, truncated } = collectPdfFiles(parentFolder, maxFiles);
    const indexByPath = new Map<string, InvoiceIndexEntry>();
    for (const entry of this.loadIndex()) indexByPath.set(normalizePath(entry.path), entry);

    const errors: Array<{ path: string; message: string }> = [];
    const probes: PdfProbe[] = [];
    let invoices = 0;
    let missingInvoiceNo = 0;

    await mapLimit(files, SCAN_CONCURRENCY, async (filePath) => {
      const file = path.basename(filePath);
      const folder = path.dirname(filePath);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(filePath);
      } catch (error) {
        errors.push({ path: filePath, message: error instanceof Error ? error.message : String(error) });
        return;
      }

      const cached = indexByPath.get(normalizePath(filePath));
      if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
        invoices += 1;
        if (!cached.no) {
          missingInvoiceNo += 1;
        } else {
          probes.push({
            file: cached.file,
            path: cached.path,
            folder: cached.folder,
            mtimeMs: cached.mtimeMs,
            size: cached.size,
            no: cached.no,
            date: cached.date,
            seller: cached.seller,
            amount: cached.amount,
          });
        }
        return;
      }

      const text = await pdfTextCached(filePath);
      if (text.startsWith('[UNREADABLE')) {
        errors.push({ path: filePath, message: text });
        return;
      }
      if (isTripFile(text, file)) return;

      invoices += 1;
      const no = invoiceNo(text);
      const date = formatExcelDate(issueDate(text));
      const sellerName = seller(text, config);
      const amount = money(text);
      if (!no) missingInvoiceNo += 1;
      probes.push({
        file,
        path: filePath,
        folder,
        mtimeMs: stat.mtimeMs,
        size: stat.size,
        no,
        date,
        seller: sellerName,
        amount,
      });
    });

    const byNo = new Map<string, PdfProbe[]>();
    for (const probe of probes) {
      if (!probe.no) continue;
      const list = byNo.get(probe.no) ?? [];
      list.push(probe);
      byNo.set(probe.no, list);
    }
    const groups = Array.from(byNo.entries())
      .filter(([, list]) => list.length >= 2)
      .map(([invoiceNo, list]) => ({
        invoiceNo,
        files: list
          .map((probe) => ({
            path: probe.path,
            folder: probe.folder,
            date: probe.date,
            seller: probe.seller,
            amount: probe.amount,
          }))
          .sort((a, b) => a.path.localeCompare(b.path)),
      }))
      .sort((a, b) => a.invoiceNo.localeCompare(b.invoiceNo));

    // Persist this scan (including earlier indexed paths that still exist).
    const entries = this.loadIndex();
    const byPath = new Map<string, InvoiceIndexEntry>();
    for (const entry of entries) byPath.set(normalizePath(entry.path), entry);
    const parentNorm = normalizePath(parentFolder);
    for (const [key, entry] of byPath) {
      const entryNorm = normalizePath(entry.path);
      const inside = entryNorm === parentNorm || entryNorm.startsWith(parentNorm + path.sep);
      if (!inside) continue;
      try {
        if (!fs.existsSync(entry.path)) byPath.delete(key);
      } catch {
        byPath.delete(key);
      }
    }
    const now = Date.now();
    for (const probe of probes) {
      if (!probe.no) continue;
      byPath.set(normalizePath(probe.path), {
        no: probe.no,
        path: probe.path,
        folder: probe.folder,
        mtimeMs: probe.mtimeMs,
        size: probe.size,
        date: probe.date,
        seller: probe.seller,
        amount: probe.amount,
        file: probe.file,
        indexedAt: now,
      });
    }
    this.saveIndex(Array.from(byPath.values()));
    this.saveMeta({ lastScanAt: now, lastScanRoot: parentFolder });

    return {
      parentFolder,
      scannedFiles: files.length,
      truncated,
      invoices,
      missingInvoiceNo,
      groups,
      errors,
    };
  }

  async preview(folder: string, config: InvoiceConfig): Promise<InvoicePreview> {
    const result = await this.runPipeline(folder, config, false, false);
    if (!result.preview) throw new Error('预览数据生成失败');
    return result.preview;
  }

  async generate(folder: string, config: InvoiceConfig): Promise<InvoiceResult> {
    return this.runPipeline(folder, config, true, false);
  }

  async rename(folder: string, config: InvoiceConfig): Promise<InvoiceResult> {
    return this.runPipeline(folder, config, true, true);
  }

  private async runPipeline(folderInput: string, rawConfig: InvoiceConfig, writeExcel: boolean, doRename: boolean): Promise<InvoiceResult> {
    const config = normalizeConfig(rawConfig);
    const folder = path.resolve(folderInput);
    const { invoices, trips } = await scan(folder, config);
    const warnings = pair(invoices, trips);
    const duplicateInfo = this.detectDuplicates(invoices);
    for (const duplicate of duplicateInfo.duplicates) {
      const where = duplicate.conflicts.slice(0, 3).map((conflict) => conflict.path).join(' / ');
      warnings.push(
        `发票号 ${duplicate.invoiceNo} 重复（${duplicate.reason === 'same-folder' ? '当前文件夹' : '其他文件夹'}）: ${where}${duplicate.conflicts.length > 3 ? ' …' : ''}`,
      );
    }
    const { periods } = assignNumbers(invoices);
    const plan = renamePlan(invoices);
    const rows = buildRows(invoices, periods, config);
    const texts = [...invoices.map((invoice) => invoice.raw), ...trips.map((trip) => trip.raw)];
    const span = tripSpan(invoices);
    const who = config.name || guessName(texts);
    const dest = config.dest || guessDest(invoices, config);
    const outName = makeOutName(config.eid, span, who, dest);
    const title = span[0] && span[1]
      ? `${span[0].y}-${pad2(span[0].m)}-${pad2(span[0].d)}-~${span[1].y}-${pad2(span[1].m)}-${pad2(span[1].d)}${who}${dest}出差报销单`
      : path.basename(folder.replace(/[\\/]+$/, ''));

    const lines: string[] = [];
    const add = (line = '') => lines.push(line);
    add('='.repeat(68));
    add(`文件夹: ${folder}`);
    add(`识别到 发票 ${invoices.length} 张, 行程单 ${trips.length} 张`);
    if (span[0] && span[1]) add(`行程区间: ${fmtDate(span[0])} ~ ${fmtDate(span[1])}`);
    add(`姓名识别: ${who || '(未识别)'}`);
    add(`目的地识别: ${dest || '(未识别)'}`);
    if (!config.selfKeywords.length) add('提示: 未配置自己公司名(self_keywords), 销售方可能识别不准。');
    if (!config.eid) add('提示: 未设置工号, 文件名将不含工号前缀。');
    add('='.repeat(68));
    add('');
    add('【编号方案】(按最早出行日期)');
    for (const invoice of invoices) {
      const tripInfo = invoice.trip?.trips.length ? `行程单 ${invoice.trip.trips.length} 笔` : '';
      add(`  ${invoice.no_}  ${invoice.kind.padEnd(7)} ${fmtDate(invoice.earliest ?? null)}  ${(invoice.seller || '').slice(0, 12).padEnd(12)} ¥${(invoice.amount ?? 0).toFixed(2).padEnd(9)} ${tripInfo}`);
    }
    add('');
    add('【重命名方案】');
    for (const [source, target] of plan) add(`  ${source.padEnd(34)} -> ${target}${source === target ? '  (不变)' : ''}`);
    if (warnings.length) {
      add('');
      add('【需要留意】');
      for (const warning of warnings) add(`  ! ${warning}`);
    }
    add('');
    add('【重复校验】');
    if (!duplicateInfo.duplicates.length) {
      add('  未发现重复发票');
    } else {
      for (const duplicate of duplicateInfo.duplicates) {
        add(`  ! 发票号 ${duplicate.invoiceNo} (${duplicate.reason === 'same-folder' ? '当前文件夹' : '其他文件夹'})`);
        for (const conflict of duplicate.conflicts) add(`      ${conflict.path}`);
      }
    }
    if (duplicateInfo.missingInvoiceNo) {
      add(`  ${duplicateInfo.missingInvoiceNo} 张票据未识别到发票号码，未参与查重`);
    }
    const total = round2(rows.reduce((sum, row) => sum + (row.amount ?? 0), 0));
    const previewRows: InvoicePreviewRow[] = rows.map((row) => ({
      no: row.no,
      start: formatExcelDate(row.start),
      end: formatExcelDate(row.end),
      days: row.days,
      ename: config.ename,
      project: config.project,
      desc: row.desc,
      amount: row.amount,
      note: row.note,
      type: '电子',
    }));
    const verifyRows: InvoicePreviewVerify[] = invoices.map((invoice) => {
      const inner = round2(rows.filter((row) => row.no === invoice.no_).reduce((sum, row) => sum + (row.amount ?? 0), 0));
      return {
        no: invoice.no_ ?? 0,
        files: invoice.file + (invoice.trip ? ` + ${invoice.trip.file}` : ''),
        invoiceNo: invoice.no,
        date: formatExcelDate(invoice.date),
        seller: invoice.seller,
        amount: invoice.amount,
        inner,
        diff: round2((invoice.amount ?? 0) - inner),
      };
    });
    const renameGroups: InvoiceRenameGroup[] = invoices.map((invoice) => {
      const group: InvoiceRenameGroup = {
        no: invoice.no_ ?? 0,
        kind: invoice.kind,
        amount: invoice.amount,
        invoice: { from: invoice.file, to: `${invoice.no_}.pdf`, role: 'invoice' },
      };
      if (invoice.trip) {
        group.trip = { from: invoice.trip.file, to: `${invoice.no_}报销单.pdf`, role: 'trip' };
      }
      return group;
    });
    const makePreview = (report: string): InvoicePreview => ({
      report,
      title,
      outName,
      folderName: path.basename(folder.replace(/[\\/]+$/, '')),
      rows: previewRows,
      verify: verifyRows,
      renameGroups,
      total,
      warnings,
      duplicates: duplicateInfo.duplicates,
      missingInvoiceNo: duplicateInfo.missingInvoiceNo,
    });
    const missing = rows.filter((row) => row.amount === null);
    add('');
    add(`明细 ${rows.length} 行, 总金额 ¥${total.toFixed(2)}`);
    if (missing.length) {
      add(`!! 有 ${missing.length} 行金额未识别, 已在表中留空:`);
      for (const row of missing) add(`     编号${row.no} ${fmtDate(row.start)} ${row.desc}`);
    }
    add(config.ename && config.project
      ? `单位简称/项目名称 = ${config.ename} / ${config.project} (已预填, 可在表里改)`
      : '单位简称/项目名称 = 有未填项, 需你在表里补');

    let backupPath: string | undefined;
    const renamedPaths = new Map<string, string>();
    if (doRename) {
      const todo = plan.filter(([source, target]) => source !== target);
      if (!todo.length) {
        add('');
        add('[重命名] 所有文件名已符合规范, 无需改动');
      } else {
        const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
        backupPath = `${folder.replace(/[\\/]+$/, '')}_backup_${stamp}`;
        copyDirSync(folder, backupPath);
        add('');
        add(`[备份] 原文件已整体备份到: ${backupPath}`);
        for (const [source, target] of todo) {
          const src = path.join(folder, source);
          const dst = path.join(folder, target);
          if (fs.existsSync(dst)) { add(`[跳过] 目标已存在: ${target}`); continue; }
          fs.renameSync(src, dst);
          renamedPaths.set(normalizePath(src), dst);
          add(`[改名] ${source} -> ${target}`);
        }
      }
    }

    // Keep the invoice-number index in sync with the files on disk.
    const indexInvoices = invoices.map((invoice) => {
      const renamedPath = renamedPaths.get(normalizePath(invoice.path));
      return renamedPath
        ? { ...invoice, path: renamedPath, file: path.basename(renamedPath) }
        : invoice;
    });
    const removePaths = Array.from(renamedPaths.keys());
    this.upsertIndex(indexInvoices, removePaths.map((key) => {
      const original = invoices.find((invoice) => normalizePath(invoice.path) === key);
      return original?.path ?? key;
    }));

    add('');
    add('【输出文件】');
    add(`  ${outName ?? `${title}.xlsx`}`);
    if (!writeExcel) {
      add('  (预览模式, 未实际生成文件)');
      const report = lines.join('\n');
      return { report, backupPath, preview: makePreview(report) };
    }
    const outputPath = path.join(folder, outName ?? `${title}.xlsx`);
    await writeWorkbook(outputPath, title, rows, invoices, config.ename, config.project);
    add('');
    add(`汇总表已生成: ${outputPath}`);
    const report = lines.join('\n');
    return { report, outputPath, backupPath, preview: makePreview(report) };
  }
}
