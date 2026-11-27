// Excel workbook rendering for the invoice organizer (exceljs).
import ExcelJS from 'exceljs';
import { toDate, type DateParts, type InvoiceRecord, type Row } from './parse';

const FONT = { name: '等线', size: 12 } as const;
const THIN = { style: 'thin' as const, color: { argb: 'FF000000' } };
const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };
const DATE_FMT = 'yyyy-mm-dd';

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
  const HEADERS = ['开始日期', '结束日期', '天数', '单位简称', '项目名称', '说明', '金额', '备注', '发票类型'];
  HEADERS.forEach((header, index) => {
    const cell = ws.getCell(2, index + 2);
    cell.value = header;
    cell.font = FONT;
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = BORDER;
  });
  ws.getCell(2, 1).border = BORDER;
  const COL_WIDTH: Record<string, number> = {
    A: 11.125, B: 12.875, C: 12, D: 8, E: 12.2, F: 12.3, G: 43.5, H: 10, I: 42, J: 8,
  };
  for (const [column, width] of Object.entries(COL_WIDTH)) ws.getColumn(column).width = width;
  ws.getRow(1).height = 22;
  ws.getRow(2).height = 22;
}

export async function writeWorkbook(
  outPath: string,
  title: string,
  rows: Row[],
  invoices: InvoiceRecord[],
  ename: string,
  project: string,
): Promise<void> {
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
    const inner = Math.round(rows.filter((row) => row.no === invoice.no_).reduce((sum, row) => sum + (row.amount ?? 0), 0) * 100) / 100;
    const files = invoice.file + (invoice.trip ? ` + ${invoice.trip.file}` : '');
    const values = [invoice.no_, files, invoice.no, invoice.date ? toDate(invoice.date) : null, invoice.seller, invoice.amount, inner, Math.round(((invoice.amount ?? 0) - inner) * 100) / 100];
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
  const totalInvoice = Math.round(invoices.reduce((sum, invoice) => sum + (invoice.amount ?? 0), 0) * 100) / 100;
  const totalInner = Math.round(rows.reduce((sum, row) => sum + (row.amount ?? 0), 0) * 100) / 100;
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

export type { DateParts };
