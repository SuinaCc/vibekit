// Pure parsing / planning logic for the invoice organizer.
// No fs, no Electron — everything here is unit-testable in isolation.
import type {
  InvoiceConfig,
  InvoicePreviewRow,
  InvoicePreviewVerify,
  InvoiceRenameGroup,
} from '@shared';

export type DateParts = { y: number; m: number; d: number };
export type Kind = 'didi' | 'train' | 'flight' | 'hotel' | 'other';

export interface PlaceAlias {
  keys: string[];
  alias: string;
}

export interface ParseConfig {
  eid: string;
  name: string;
  dest: string;
  ename: string;
  project: string;
  selfKeywords: string[];
  places: PlaceAlias[];
  cities: string[];
  noteOverrides: Record<string, string>;
}

export interface Trip {
  date: string;
  from: string;
  to: string;
  amount: number;
  city: string;
}

export interface TripRecord {
  file: string;
  total: number | null;
  trips: Trip[];
  raw: string;
}

export interface InvoiceRecord {
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
  tel?: string;
  raw: string;
  trip: TripRecord | null;
  flight?: [string, string, string, string, string] | null;
  train?: [DateParts | null, string, string, string, string] | null;
  no_?: number;
  earliest?: DateParts | null;
  _year?: number | null;
}

export interface Row {
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
const CAT_RANK: Record<Kind, number> = { didi: 0, train: 1, flight: 1, hotel: 2, other: 3 };
const HOTEL_KEYS = ['酒店', '宾馆', '旅馆', '民宿', '公寓'];
const HUB_RE = /([一-龥]{2,6}(?:站|机场))/;
const CITY_PREFIXES = ['武汉', '杭州', '上海', '北京', '南京', '宁波', '广州', '深圳', '成都', '西安', '哈尔滨', '舟山', '苏州', '合肥', '长沙', '郑州'];
const CITY_HINT = ['杭州', '武汉', '舟山', '哈尔滨', '上海', '北京', '宁波', '南京', '广州', '深圳', '成都', '西安'];

export const INVOICE_HEADERS = HEADERS;

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

export function dp(y: number, m: number, d: number): DateParts {
  return { y, m, d };
}

export function toDate(parts: DateParts): Date {
  return new Date(Date.UTC(parts.y, parts.m - 1, parts.d));
}

export function dateKey(parts: DateParts | null | undefined): number {
  return parts ? parts.y * 10000 + parts.m * 100 + parts.d : Number.MAX_SAFE_INTEGER;
}

export function fmtDate(parts: DateParts | null): string {
  return parts ? `${parts.y}-${pad2(parts.m)}-${pad2(parts.d)}` : '?';
}

export function formatExcelDate(parts: DateParts | null): string {
  return parts ? `${parts.y}-${pad2(parts.m)}-${pad2(parts.d)}` : '';
}

export function flat(text: string): string {
  return text.normalize('NFKC').replace(/\s+/g, ' ').replace(/ /g, ' ').trim();
}

export function stripPageMarkers(text: string): string {
  return text.replace(/^-- \d+ of \d+ --$/gm, '').trim();
}

export function normalizeConfig(raw: InvoiceConfig | undefined): ParseConfig {
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
  const noteOverrides: Record<string, string> = {};
  if (value.noteOverrides && typeof value.noteOverrides === 'object') {
    for (const [key, note] of Object.entries(value.noteOverrides)) {
      if (typeof note === 'string') noteOverrides[key] = note;
    }
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
    noteOverrides,
  };
}

export function normHub(name: string): string {
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

export function placeShort(raw: string, config: ParseConfig): string {
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

export function money(cell: string): number | null {
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

export function invoiceNo(cell: string): string {
  let match = cell.match(/发\s*票\s*号\s*码\s*[:：]?\s*(\d{16,25})/);
  if (!match) match = cell.match(/(?<!\d)(\d{20})(?!\d)/);
  return match ? match[1] : '';
}

export function issueDate(cell: string): DateParts | null {
  let match = cell.match(/开\s*票\s*日\s*期\s*[:：]?\s*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (!match) match = cell.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  return match ? dp(parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10)) : null;
}

export function seller(cell: string, config: ParseConfig): string {
  let names = Array.from(cell.matchAll(/[一-龥A-Za-z0-9()（）]{4,40}(?:有限公司|分公司|研究院)/g)).map((match) => match[0]);
  names = names.filter((name) => !name.includes('银行') && !name.includes('支行') && !name.includes('信用社'));
  if (config.selfKeywords.length) {
    names = names.filter((name) => !config.selfKeywords.some((keyword) => name.includes(keyword)));
  } else if (names.length > 1) {
    names = names.slice(1);
  }
  return names.length ? names[names.length - 1] : '';
}

export function sellerCity(name: string, config: ParseConfig): string {
  return config.cities.find((city) => (name || '').includes(city)) ?? '';
}

// VAT invoices print an '地址、电话' field for both the purchaser (first) and
// the seller (last); the hotel phone we want is the seller's, i.e. the last
// one. Falls back to a boundary-guarded scan of the whole text (PDF text
// extraction sometimes drops the field labels but keeps the digits).
export function sellerPhone(cell: string): string {
  // 400 热线必须先于座机尝试，否则 4001234567 会被 0\d{2,3} 座机模式
  // 抢走并错误重排成 40-1234567。
  const PHONE_PATTERNS = [
    /400[-－—]?\d{3}[-－—]?\d{3,4}/,
    /0\d{2,3}[-－—]?\d{7,8}/,
    /1[3-9]\d{9}/,
  ];
  const format = (value: string): string => {
    if (/^0\d{10,11}$/.test(value)) return `${value.slice(0, value.length - 8)}-${value.slice(-8)}`;
    return value;
  };
  const pick = (flatText: string, guarded: boolean): string => {
    for (const pattern of PHONE_PATTERNS) {
      const regex = guarded
        ? new RegExp(`(?<![0-9])(?:${pattern.source})(?![0-9])`)
        : new RegExp(pattern.source);
      const match = flatText.match(regex);
      if (match) return match[0].replace(/[－—]/g, '-');
    }
    return '';
  };
  const sections = Array.from(
    cell.matchAll(/地\s*址\s*[、，,]?\s*电\s*话\s*[:：]?([^\n]{4,90})/g),
  ).map((match) => match[1]);
  if (sections.length) {
    const compact = sections[sections.length - 1].replace(/\s+/g, '');
    const phone = pick(compact, false);
    if (phone) return format(phone);
  }
  const phone = pick(cell.replace(/\s+/g, ''), true);
  return phone ? format(phone) : '';
}

// Hotel display name for the 备注 column: the seller company minus the legal
// suffix tail, e.g. '汉庭酒店浙江杭州上城区有限公司' -> '汉庭酒店浙江杭州上城区'.
// When the seller line is missing, look for a store-style name in the raw text.
export function hotelDisplayName(invoice: Pick<InvoiceRecord, 'seller' | 'raw'>): string {
  const base = (invoice.seller || '').replace(/（[^）]*）/g, '').replace(/\([^)]*\)/g, '');
  const trimmed = base.replace(/(股份)?有限(责任)?公司.*$/, '').replace(/分公司$/, '');
  if (trimmed) return trimmed;
  const withStore = invoice.raw.match(
    /[一-龥A-Za-z0-9]{2,20}(?:酒店|饭店|宾馆|客栈)[一-龥A-Za-z0-9]{0,12}?(?:分?店)/,
  );
  if (withStore) return withStore[0];
  const fallback = invoice.raw.match(/[一-龥A-Za-z0-9]{2,20}(?:酒店|饭店|宾馆|客栈)/);
  return fallback ? fallback[0] : base;
}

export function splitFromTo(bodyValue: string): [string, string] {
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

export function parseTrips(tripText: string): Trip[] {
  const text = flat(tripText).replace(/页码:/g, '页码：');
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

export function parseAmap(text: string): Trip[] {
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

export function tripTotal(cell: string): number | null {
  const match = flat(cell).match(/合计\s*([\d,]+\.?\d*)\s*元/);
  return match ? round2(parseFloat(match[1].replace(/,/g, ''))) : null;
}

export function isTrip(cell: string): boolean {
  if (cell.includes('DIDI TRAVEL') || cell.includes('AMAP ITINERARY') || cell.includes('行程单')) return true;
  return cell.includes('行程人手机号') && cell.includes('序号');
}

export function isTripFile(cell: string, fileName: string): boolean {
  return isTrip(cell) || (fileName || '').includes('行程单');
}

export function classify(cell: string, fileName = ''): Kind {
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

export function parseTrain(cell: string): [DateParts | null, string, string, string, string] {
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

export function pair(invoices: InvoiceRecord[], trips: TripRecord[]): string[] {
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

export function assignNumbers(invoices: InvoiceRecord[]): { periods: Map<string, [DateParts | null, DateParts | null]> } {
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

export function renamePlan(invoices: InvoiceRecord[]): Array<[string, string]> {
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

export function buildRows(
  invoices: InvoiceRecord[],
  periods: Map<string, [DateParts | null, DateParts | null]>,
  config: ParseConfig,
): Row[] {
  const rows: Row[] = [];
  for (const invoice of invoices) {
    const no = invoice.no_ ?? 0;
    const override = config.noteOverrides[String(no)];
    const push = (start: DateParts | null, end: DateParts | null, days: string, desc: string, amount: number | null, note = '') => {
      rows.push({ no, start, end, days, desc, amount, note: override !== undefined ? override : note, invoice });
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
      const note = [hotelDisplayName(invoice), invoice.tel].filter(Boolean).join(' ');
      push(start, end, days, city ? `${city}酒店` : '酒店', invoice.amount, note);
    } else {
      push(invoice.date, invoice.date, '1天', '其他费用', invoice.amount);
    }
  }
  return rows;
}

export function tripSpan(invoices: InvoiceRecord[]): [DateParts | null, DateParts | null] {
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

export function guessName(texts: string[]): string {
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

export function guessDest(invoices: InvoiceRecord[], config: ParseConfig): string {
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

export function makeOutName(eid: string, span: [DateParts | null, DateParts | null], name: string, dest: string): string | null {
  const [start, end] = span;
  if (!start || !end) return null;
  const head = eid ? `${eid} ` : '';
  return `${head}${start.y}-${pad2(start.m)}-${pad2(start.d)}-~${end.y}-${pad2(end.m)}-${pad2(end.d)}${name}${dest}出差报销单.xlsx`;
}
