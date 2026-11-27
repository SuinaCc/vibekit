export interface InvoiceConfig {
  eid?: string;
  name?: string;
  dest?: string;
  ename?: string;
  project?: string;
  selfKeywords?: string[];
  places?: Array<[string | string[], string]>;
  cities?: string[];
}

export interface InvoicePreviewRow {
  no: number;
  start: string;
  end: string;
  days: string;
  ename: string;
  project: string;
  desc: string;
  amount: number | null;
  note: string;
  type: string;
}

export interface InvoicePreviewVerify {
  no: number;
  files: string;
  invoiceNo: string;
  date: string;
  seller: string;
  amount: number | null;
  inner: number;
  diff: number;
}

export interface InvoiceRenameFile {
  from: string;
  to: string;
  role: 'invoice' | 'trip';
}

export interface InvoiceRenameGroup {
  no: number;
  kind: string;
  amount: number | null;
  invoice: InvoiceRenameFile;
  trip?: InvoiceRenameFile;
}

export type InvoiceDuplicateReason = 'same-folder' | 'other-folder';

export interface InvoiceDuplicateConflict {
  file: string;
  path: string;
  folder: string;
  date: string;
}

export interface InvoiceDuplicate {
  invoiceNo: string;
  file: string;
  path: string;
  folder: string;
  date: string;
  seller: string;
  amount: number | null;
  reason: InvoiceDuplicateReason;
  conflicts: InvoiceDuplicateConflict[];
}

export interface InvoiceTreeFile {
  path: string;
  folder: string;
  date: string;
  seller: string;
  amount: number | null;
}

export interface InvoiceTreeScanResult {
  parentFolder: string;
  scannedFiles: number;
  truncated: boolean;
  invoices: number;
  missingInvoiceNo: number;
  groups: Array<{ invoiceNo: string; files: InvoiceTreeFile[] }>;
  errors: Array<{ path: string; message: string }>;
}

export interface InvoiceIndexStatus {
  entries: number;
  invoices: number;
  lastScanAt: number | null;
  lastScanRoot: string | null;
}

export interface InvoicePreview {
  report: string;
  title: string;
  outName: string | null;
  folderName: string;
  rows: InvoicePreviewRow[];
  verify: InvoicePreviewVerify[];
  renameGroups: InvoiceRenameGroup[];
  total: number;
  warnings: string[];
  duplicates: InvoiceDuplicate[];
  missingInvoiceNo: number;
}

export interface InvoiceResult {
  report: string;
  outputPath?: string;
  backupPath?: string;
  preview?: InvoicePreview;
}
