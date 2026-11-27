import * as fs from 'fs';
import * as path from 'path';
import type {
  InvoiceConfig,
  InvoicePreview,
  InvoicePreviewRow,
  InvoicePreviewVerify,
  InvoiceRenameGroup,
  InvoiceResult,
  InvoiceProgress,
  InvoiceTreeScanResult,
} from '@shared';
import type { DataService } from './DataService';
import {
  assignNumbers,
  buildRows,
  fmtDate,
  formatExcelDate,
  guessDest,
  guessName,
  makeOutName,
  normalizeConfig,
  pair,
  renamePlan,
  round2,
  tripSpan,
} from './invoice/parse';
import {
  collectPdfFiles,
  copyDirSync,
  mapLimit,
  normalizePath,
  probePdf,
  scan,
  type PdfProbe,
} from './invoice/io';
import { writeWorkbook } from './invoice/excel';
import {
  clearIndexStore,
  detectDuplicates,
  indexStatus,
  loadIndex,
  loadMeta,
  saveIndex,
  saveMeta,
  upsertIndex,
  type InvoiceIndexEntry,
} from './invoice/indexStore';

const TREE_MAX_FILES = 2000;

export type InvoiceProgressCallback = (progress: InvoiceProgress) => void;

export class InvoiceService {
  constructor(private dataService?: DataService) {}

  indexStatus(): ReturnType<typeof indexStatus> {
    return indexStatus(this.dataService);
  }

  clearIndex(): void {
    clearIndexStore(this.dataService);
  }

  async scanTree(parentFolderInput: string, opts?: { maxFiles?: number; onProgress?: InvoiceProgressCallback }): Promise<InvoiceTreeScanResult> {
    const parentFolder = path.resolve(parentFolderInput);
    const config = normalizeConfig(undefined);
    const maxFiles = Math.min(Math.max(opts?.maxFiles ?? TREE_MAX_FILES, 1), 20000);
    const onProgress = opts?.onProgress;
    const { files, truncated } = collectPdfFiles(parentFolder, maxFiles);
    const indexByPath = new Map<string, InvoiceIndexEntry>();
    for (const entry of loadIndex(this.dataService)) indexByPath.set(normalizePath(entry.path), entry);

    const errors: Array<{ path: string; message: string }> = [];
    const probes: PdfProbe[] = [];
    let invoices = 0;
    let missingInvoiceNo = 0;
    let done = 0;

    await mapLimit(files, 4, async (filePath) => {
      let stat: fs.Stats;
      try {
        stat = fs.statSync(filePath);
      } catch (error) {
        done += 1;
        errors.push({ path: filePath, message: error instanceof Error ? error.message : String(error) });
        onProgress?.({ stage: 'scan', done, total: files.length, file: path.basename(filePath) });
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
        done += 1;
        onProgress?.({ stage: 'scan', done, total: files.length, file: path.basename(filePath) });
        return;
      }

      try {
        const probe = await probePdf(filePath, config, stat);
        if (probe) {
          invoices += 1;
          if (!probe.no) missingInvoiceNo += 1;
          probes.push(probe);
        }
      } catch (error) {
        errors.push({ path: filePath, message: error instanceof Error ? error.message : String(error) });
      }
      done += 1;
      onProgress?.({ stage: 'scan', done, total: files.length, file: path.basename(filePath) });
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
    const entries = loadIndex(this.dataService);
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
    saveIndex(this.dataService, Array.from(byPath.values()));
    saveMeta(this.dataService, { lastScanAt: now, lastScanRoot: parentFolder });

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

  async preview(folder: string, config: InvoiceConfig, onProgress?: InvoiceProgressCallback): Promise<InvoicePreview> {
    const result = await this.runPipeline(folder, config, false, false, onProgress);
    if (!result.preview) throw new Error('预览数据生成失败');
    return result.preview;
  }

  async generate(folder: string, config: InvoiceConfig, onProgress?: InvoiceProgressCallback): Promise<InvoiceResult> {
    return this.runPipeline(folder, config, true, false, onProgress);
  }

  async rename(folder: string, config: InvoiceConfig, onProgress?: InvoiceProgressCallback): Promise<InvoiceResult> {
    return this.runPipeline(folder, config, true, true, onProgress);
  }

  private async runPipeline(
    folderInput: string,
    rawConfig: InvoiceConfig,
    writeExcel: boolean,
    doRename: boolean,
    onProgress?: InvoiceProgressCallback,
  ): Promise<InvoiceResult> {
    const config = normalizeConfig(rawConfig);
    const folder = path.resolve(folderInput);
    onProgress?.({ stage: 'scan', done: 0, total: 0 });
    const { invoices, trips } = await scan(folder, config, mapScanProgress(onProgress));
    onProgress?.({ stage: 'analyze', done: 1, total: 1 });
    const warnings = pair(invoices, trips);
    const duplicateInfo = detectDuplicates(this.dataService, invoices);
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
    upsertIndex(this.dataService, indexInvoices, removePaths.map((key) => {
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
    onProgress?.({ stage: 'write', done: 1, total: 1 });
    const outputPath = path.join(folder, outName ?? `${title}.xlsx`);
    await writeWorkbook(outputPath, title, rows, invoices, config.ename, config.project);
    add('');
    add(`汇总表已生成: ${outputPath}`);
    const report = lines.join('\n');
    return { report, outputPath, backupPath, preview: makePreview(report) };
  }
}

function mapScanProgress(onProgress?: InvoiceProgressCallback): ((info: { done: number; total: number; file: string }) => void) | undefined {
  if (!onProgress) return undefined;
  return (info) => onProgress({ stage: 'scan', ...info });
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}
