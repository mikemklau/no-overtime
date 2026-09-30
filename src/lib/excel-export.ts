import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';

export interface ExportReceiptData {
  id?: string;
  merchantName: string | null;
  receiptDate: string | null;
  currency: string;
  subtotal: number | null;
  vatAmount: number | null;
  serviceCharge: number | null;
  totalAmount: number | null;
  confidence: number;
  essentialsConfidence?: number;
  status: string;
  sourceFile?: File | Blob;
  rawText?: string;
  lineItems: {
    description: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    category: string | null;
  }[];
}

/**
 * Generate an HMRC-ready multi-tab Excel workbook using ExcelJS
 * Features:
 *  - Tab 1: Receipts Register (UK 20% VAT Reclaim with native SUM formulas) [DEFAULT ACTIVE TAB]
 *  - Tab 2: Line Items (Detailed line item categorization)
 *  - Tab 3: Summary (HMRC statement, KPI metrics, VAT totals, date range)
 *  - Sticky/frozen top headers
 *  - UK currency formatting (£#,##0.00)
 */
export async function exportReceiptsToExcel(
  receipts: ExportReceiptData[],
  filename = 'HMRC_Receipt_Register.xlsx'
) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'No Overtime – UK Receipt Scanner';
  workbook.created = new Date();

  // Header styles
  const headerFill: ExcelJS.Fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF0F766E' }, // Teal-700
  };
  const headerFont: Partial<ExcelJS.Font> = {
    name: 'Calibri',
    size: 11,
    bold: true,
    color: { argb: 'FFFFFFFF' },
  };

  const currencyFormat = '£#,##0.00';

  // Calculate overall metrics
  const totalCount = receipts.length;
  const dates = receipts
    .map((r) => r.receiptDate)
    .filter((d): d is string => Boolean(d))
    .sort();
  const dateRangeStr =
    dates.length > 0 ? `${dates[0]} to ${dates[dates.length - 1]}` : 'N/A';

  const sumTotal = receipts.reduce((acc, r) => acc + (r.totalAmount || 0), 0);
  const sumVat = receipts.reduce((acc, r) => acc + (r.vatAmount || 0), 0);
  const sumNet = receipts.reduce((acc, r) => acc + (r.subtotal || 0), 0);
  const sumService = receipts.reduce((acc, r) => acc + (r.serviceCharge || 0), 0);

  // ─────────────────────────────────────────────────────────────
  // TAB 1: RECEIPTS REGISTER & VAT RECLAIM TAB (First tab = opened by default)
  // ─────────────────────────────────────────────────────────────
  const registerSheet = workbook.addWorksheet('Receipts Register', {
    views: [{ state: 'frozen', ySplit: 1, showGridLines: true }],
  });

  registerSheet.columns = [
    { header: 'Ref #', key: 'ref', width: 12 },
    { header: 'Receipt Date', key: 'date', width: 16 },
    { header: 'Merchant / Supplier', key: 'merchant', width: 30 },
    { header: 'Currency', key: 'currency', width: 10 },
    { header: 'Net Subtotal (£)', key: 'subtotal', width: 16 },
    { header: 'UK VAT 20% (£)', key: 'vat', width: 16 },
    { header: 'Service Charge (£)', key: 'service', width: 18 },
    { header: 'Gross Total (£)', key: 'total', width: 16 },
    { header: 'HMRC Score', key: 'confidence', width: 14 },
    { header: 'Status', key: 'status', width: 16 },
  ];

  // Style Header Row
  const regHeaderRow = registerSheet.getRow(1);
  regHeaderRow.font = headerFont;
  regHeaderRow.height = 26;
  regHeaderRow.eachCell((cell) => {
    cell.fill = headerFill;
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });

  // Populate Rows
  receipts.forEach((r, idx) => {
    const row = registerSheet.addRow({
      ref: `REC-${String(idx + 1).padStart(4, '0')}`,
      date: r.receiptDate || 'DD/MM/YYYY',
      merchant: r.merchantName || 'Unknown Merchant',
      currency: r.currency || 'GBP',
      subtotal: r.subtotal ?? (r.totalAmount ? Math.round(((r.totalAmount - (r.vatAmount ?? 0)) + Number.EPSILON) * 100) / 100 : 0),
      vat: r.vatAmount ?? 0,
      service: r.serviceCharge ?? 0,
      total: r.totalAmount ?? 0,
      confidence: `${r.essentialsConfidence ?? r.confidence}%`,
      status: r.status === 'user_verified' ? 'User Verified' : r.status,
    });

    row.getCell('subtotal').numFmt = currencyFormat;
    row.getCell('vat').numFmt = currencyFormat;
    row.getCell('service').numFmt = currencyFormat;
    row.getCell('total').numFmt = currencyFormat;
    row.alignment = { vertical: 'middle' };
  });

  // Dynamic Excel formulas at the bottom with cached result values
  if (receipts.length > 0) {
    const lastRowIndex = receipts.length + 1;
    const totalRowIndex = lastRowIndex + 1;
    const totalRow = registerSheet.getRow(totalRowIndex);

    totalRow.getCell('merchant').value = 'TOTALS (HMRC Reclaim Sum):';
    totalRow.getCell('subtotal').value = { formula: `SUM(E2:E${lastRowIndex})`, result: sumNet };
    totalRow.getCell('vat').value = { formula: `SUM(F2:F${lastRowIndex})`, result: sumVat };
    totalRow.getCell('service').value = { formula: `SUM(G2:G${lastRowIndex})`, result: sumService };
    totalRow.getCell('total').value = { formula: `SUM(H2:H${lastRowIndex})`, result: sumTotal };

    totalRow.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF0F766E' } };
    totalRow.getCell('subtotal').numFmt = currencyFormat;
    totalRow.getCell('vat').numFmt = currencyFormat;
    totalRow.getCell('service').numFmt = currencyFormat;
    totalRow.getCell('total').numFmt = currencyFormat;
  }

  // ─────────────────────────────────────────────────────────────
  // TAB 2: LINE ITEMS TAB
  // ─────────────────────────────────────────────────────────────
  const itemsSheet = workbook.addWorksheet('Line Items', {
    views: [{ state: 'frozen', ySplit: 1, showGridLines: true }],
  });

  itemsSheet.columns = [
    { header: 'Receipt Ref', key: 'ref', width: 14 },
    { header: 'Merchant', key: 'merchant', width: 28 },
    { header: 'Date', key: 'date', width: 14 },
    { header: 'Item Description', key: 'desc', width: 34 },
    { header: 'Qty', key: 'qty', width: 10 },
    { header: 'Unit Price (£)', key: 'unitPrice', width: 16 },
    { header: 'Total Price (£)', key: 'totalPrice', width: 16 },
    { header: 'Category', key: 'category', width: 20 },
  ];

  const itemHeaderRow = itemsSheet.getRow(1);
  itemHeaderRow.font = headerFont;
  itemHeaderRow.height = 26;
  itemHeaderRow.eachCell((cell) => {
    cell.fill = headerFill;
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });

  receipts.forEach((r, idx) => {
    const ref = `REC-${String(idx + 1).padStart(4, '0')}`;
    const merchant = r.merchantName || 'Unknown Merchant';
    const date = r.receiptDate || 'N/A';

    if (r.lineItems && r.lineItems.length > 0) {
      r.lineItems.forEach((item) => {
        const row = itemsSheet.addRow({
          ref,
          merchant,
          date,
          desc: item.description,
          qty: item.quantity,
          unitPrice: item.unitPrice,
          totalPrice: item.totalPrice,
          category: item.category || 'General Expense',
        });
        row.getCell('unitPrice').numFmt = currencyFormat;
        row.getCell('totalPrice').numFmt = currencyFormat;
      });
    } else {
      const row = itemsSheet.addRow({
        ref,
        merchant,
        date,
        desc: 'General Receipt Total',
        qty: 1,
        unitPrice: r.totalAmount ?? 0,
        totalPrice: r.totalAmount ?? 0,
        category: 'General Expense',
      });
      row.getCell('unitPrice').numFmt = currencyFormat;
      row.getCell('totalPrice').numFmt = currencyFormat;
    }
  });

  // ─────────────────────────────────────────────────────────────
  // TAB 3: HMRC SUMMARY TAB (Aligned starting at Cell A1)
  // ─────────────────────────────────────────────────────────────
  const summarySheet = workbook.addWorksheet('Summary', {
    views: [{ showGridLines: true }],
  });

  summarySheet.columns = [
    { width: 36 },
    { width: 28 },
    { width: 22 },
  ];

  // Title Block (Starting cleanly at A1)
  summarySheet.mergeCells('A1:C1');
  const titleCell = summarySheet.getCell('A1');
  titleCell.value = 'HMRC RECEIPT & VAT RECLAIM SUMMARY';
  titleCell.font = { name: 'Calibri', size: 15, bold: true, color: { argb: 'FF0F766E' } };

  summarySheet.mergeCells('A2:C2');
  const subtitleCell = summarySheet.getCell('A2');
  subtitleCell.value = `Generated on ${new Date().toLocaleDateString('en-GB')} via No Overtime`;
  subtitleCell.font = { name: 'Calibri', size: 10, italic: true, color: { argb: 'FF6B7280' } };

  // Table Data
  const summaryMetrics: [string, string | number, string?][] = [
    ['Total Receipts Processed', totalCount],
    ['Accounting Date Range', dateRangeStr],
    ['Gross Total Expenditure (Inc. VAT)', sumTotal, currencyFormat],
    ['Total UK 20% VAT Reclaimable', sumVat, currencyFormat],
    ['Net Business Expenditure', sumNet, currencyFormat],
  ];

  const startRow = 4;
  summarySheet.getCell(`A${startRow}`).value = 'Metric';
  summarySheet.getCell(`B${startRow}`).value = 'Value';
  summarySheet.getCell(`A${startRow}`).font = headerFont;
  summarySheet.getCell(`B${startRow}`).font = headerFont;
  summarySheet.getCell(`A${startRow}`).fill = headerFill;
  summarySheet.getCell(`B${startRow}`).fill = headerFill;

  summaryMetrics.forEach(([metric, val, format], idx) => {
    const rowNum = startRow + 1 + idx;
    const mCell = summarySheet.getCell(`A${rowNum}`);
    const vCell = summarySheet.getCell(`B${rowNum}`);
    mCell.value = metric;
    mCell.font = { name: 'Calibri', size: 11, bold: idx >= 2 };
    vCell.value = val;
    vCell.font = { name: 'Calibri', size: 11, bold: idx >= 2 };
    if (format) {
      vCell.numFmt = format;
    }
  });

  // Note for HMRC Compliance
  const noteRow = startRow + summaryMetrics.length + 3;
  summarySheet.mergeCells(`A${noteRow}:C${noteRow + 1}`);
  const noteCell = summarySheet.getCell(`A${noteRow}`);
  noteCell.value =
    'Note: Digital records and VAT breakdowns compiled in compliance with HMRC Making Tax Digital (MTD) rules. Original receipt images stored in secure cloud vault.';
  noteCell.font = { name: 'Calibri', size: 9, italic: true, color: { argb: 'FF4B5563' } };

  // Generate buffer and trigger browser download via file-saver
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  saveAs(blob, filename);
}
