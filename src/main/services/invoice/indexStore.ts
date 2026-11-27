// Persistent invoice-number index (used for cross-folder duplicate detection).
// Storage goes through DataService, namespaced under 'local.invoice-organizer'.
import * as fs from 'fs';
import type { InvoiceDuplicate, InvoiceDuplicateConflict, InvoiceIndexStatus } from '@shared';
import type { DataService } from '../DataService';
import { normalizePath } from './io';
import { formatExcelDate, type InvoiceRecord } from './parse';

const INDEX_NAMESPACE = 'local.invoice-organizer';
const INDEX_KEY = 'invoiceIndex:v1';
const INDEX_META_KEY = 'invoiceIndex:meta';

export interface InvoiceIndexEntry {
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

export interface InvoiceIndexMeta {
  lastScanAt: number | null;
  lastScanRoot: string | null;
}

export function loadIndex(dataService?: DataService): InvoiceIndexEntry[] {
  if (!dataService) return [];
  try {
    const raw = dataService.get(INDEX_NAMESPACE, INDEX_KEY) as { version?: number; entries?: unknown } | null;
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

export function saveIndex(dataService: DataService | undefined, entries: InvoiceIndexEntry[]): void {
  try {
    dataService?.set(INDEX_NAMESPACE, INDEX_KEY, { version: 1, entries });
  } catch {
    // index persistence is best-effort
  }
}

export function loadMeta(dataService?: DataService): InvoiceIndexMeta {
  if (!dataService) return { lastScanAt: null, lastScanRoot: null };
  try {
    const raw = dataService.get(INDEX_NAMESPACE, INDEX_META_KEY) as Partial<InvoiceIndexMeta> | null;
    return {
      lastScanAt: typeof raw?.lastScanAt === 'number' ? raw.lastScanAt : null,
      lastScanRoot: typeof raw?.lastScanRoot === 'string' ? raw.lastScanRoot : null,
    };
  } catch {
    return { lastScanAt: null, lastScanRoot: null };
  }
}

export function saveMeta(dataService: DataService | undefined, meta: InvoiceIndexMeta): void {
  try {
    dataService?.set(INDEX_NAMESPACE, INDEX_META_KEY, meta);
  } catch {
    // ignore
  }
}

export function clearIndexStore(dataService?: DataService): void {
  if (!dataService) return;
  try {
    dataService.delete(INDEX_NAMESPACE, INDEX_KEY);
    dataService.delete(INDEX_NAMESPACE, INDEX_META_KEY);
  } catch {
    // ignore
  }
}

export function detectDuplicates(
  dataService: DataService | undefined,
  invoices: InvoiceRecord[],
): { duplicates: InvoiceDuplicate[]; missingInvoiceNo: number } {
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
  for (const entry of loadIndex(dataService)) {
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

export function upsertIndex(
  dataService: DataService | undefined,
  invoices: InvoiceRecord[],
  removePaths: string[] = [],
): void {
  if (!dataService) return;
  const entries = loadIndex(dataService);
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
  saveIndex(dataService, Array.from(byPath.values()));
}

export function indexStatus(dataService?: DataService): InvoiceIndexStatus {
  const entries = loadIndex(dataService);
  const meta = loadMeta(dataService);
  return {
    entries: entries.length,
    invoices: new Set(entries.map((entry) => entry.no)).size,
    lastScanAt: meta.lastScanAt,
    lastScanRoot: meta.lastScanRoot,
  };
}
