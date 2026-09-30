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
 *  - Tab 1: Summary (KPI cards, VAT totals, date range, HMRC statement)
 *  - Tab 2: Receipts Register (UK 20% VAT Reclaim with native SUM formulas)
 *  - Tab 3: Line Items (Detailed line item categorization)
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

  // ─────────────────────────────────────────────────────────────
  // TAB 1: SUMMARY TAB
  // ─────────────────────────────────────────────────────────────
  const summarySheet = workbook.addWorksheet('Summary', {
    views: [{ showGridLines: true }],
  });

  summarySheet.columns = [
    { width: 5 },
    { width: 32 },
    { width: 25 },
    { width: 20 },
  ];

  // Title Block
  summarySheet.mergeCells('B2:D2');
  const titleCell = summarySheet.getCell('B2');
  titleCell.value = 'HMRC RECEIPT & VAT RECLAIM SUMMARY';
  titleCell.font = { name: 'Calibri', size: 16, bold: true, color: { argb: 'FF0F766E' } };

  summarySheet.mergeCells('B3:D3');
  const subtitleCell = summarySheet.getCell('B3');
  subtitleCell.value = `Generated on ${new Date().toLocaleDateString('en-GB')} via No Overtime`;
  subtitleCell.font = { name: 'Calibri', size: 10, italic: true, color: { argb: 'FF6B7280' } };

  // Calculate metrics
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

  // Table Data
  const summaryMetrics = [
    ['Total Receipts Processed', totalCount, ''],
    ['Accounting Date Range', dateRangeStr, ''],
    ['Gross Total Expenditure (Inc. VAT)', sumTotal, currencyFormat],
    ['Total UK 20% VAT Reclaimable', sumVat, currencyFormat],
    ['Net Business Expenditure', sumNet, currencyFormat],
  ];

  const startRow = 5;
  summarySheet.getCell(`B${startRow}`).value = 'Metric';
  summarySheet.getCell(`C${startRow}`).value = 'Value';
  summarySheet.getRow(startRow).font = headerFont;
  summarySheet.getCell(`B${startRow}`).fill = headerFill;
  summarySheet.getCell(`C${startRow}`).fill = headerFill;

  summaryMetrics.forEach(([metric, val, format], idx) => {
    const rowNum = startRow + 1 + idx;
    const mCell = summarySheet.getCell(`B${rowNum}`);
    const vCell = summarySheet.getCell(`C${rowNum}`);
    mCell.value = metric;
    mCell.font = { name: 'Calibri', size: 11, bold: idx >= 2 };
    vCell.value = val;
    vCell.font = { name: 'Calibri', size: 11, bold: idx >= 2 };
    if (format) {
      vCell.numFmt = format as string;
    }
  });

  // Note for HMRC Compliance
  const noteRow = startRow + summaryMetrics.length + 3;
  summarySheet.mergeCells(`B${noteRow}:D${noteRow + 1}`);
  const noteCell = summarySheet.getCell(`B${noteRow}`);
  noteCell.value =
    'Note: Digital records and VAT breakdowns compiled in compliance with HMRC Making Tax Digital (MTD) rules. Original receipt images stored in secure cloud vault.';
  noteCell.font = { name: 'Calibri', size: 9, italic: true, color: { argb: 'FF4B5563' } };

  // ─────────────────────────────────────────────────────────────
  // TAB 2: RECEIPTS REGISTER & VAT RECLAIM TAB
  // ─────────────────────────────────────────────────────────────
  const registerSheet = workbook.addWorksheet('Receipts Register', {
    views: [{ state: 'frozen', ySplit: 1, showGridLines: true }],
  });

  registerSheet.columns = [
    { header: 'Ref #', key: 'ref', width: 10 },
    { header: 'Receipt Date', key: 'date', width: 15 },
    { header: 'Merchant / Supplier', key: 'merchant', width: 28 },
    { header: 'Currency', key: 'currency', width: 10 },
    { header: 'Net Subtotal (£)', key: 'subtotal', width: 16 },
    { header: 'UK VAT 20% (£)', key: 'vat', width: 15 },
    { header: 'Service Charge (£)', key: 'service', width: 18 },
    { header: 'Gross Total (£)', key: 'total', width: 16 },
    { header: 'Confidence', key: 'confidence', width: 14 },
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
      subtotal: r.subtotal ?? 0,
      vat: r.vatAmount ?? 0,
      service: r.serviceCharge ?? 0,
      total: r.totalAmount ?? 0,
      confidence: `${r.confidence}%`,
      status: r.status,
    });

    row.getCell('subtotal').numFmt = currencyFormat;
    row.getCell('vat').numFmt = currencyFormat;
    row.getCell('service').numFmt = currencyFormat;
    row.getCell('total').numFmt = currencyFormat;
    row.alignment = { vertical: 'middle' };
  });

  // Dynamic Excel formulas at the bottom (as required by MASTER_SPEC)
  if (receipts.length > 0) {
    const lastRowIndex = receipts.length + 1;
    const totalRowIndex = lastRowIndex + 1;
    const totalRow = registerSheet.getRow(totalRowIndex);

    totalRow.getCell('merchant').value = 'TOTALS (Dynamic HMRC Sum):';
    totalRow.getCell('subtotal').value = { formula: `SUM(E2:E${lastRowIndex})` };
    totalRow.getCell('vat').value = { formula: `SUM(F2:F${lastRowIndex})` };
    totalRow.getCell('service').value = { formula: `SUM(G2:G${lastRowIndex})` };
    totalRow.getCell('total').value = { formula: `SUM(H2:H${lastRowIndex})` };

    totalRow.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF0F766E' } };
    totalRow.getCell('subtotal').numFmt = currencyFormat;
    totalRow.getCell('vat').numFmt = currencyFormat;
    totalRow.getCell('service').numFmt = currencyFormat;
    totalRow.getCell('total').numFmt = currencyFormat;
  }

  // ─────────────────────────────────────────────────────────────
  // TAB 3: LINE ITEMS TAB
  // ─────────────────────────────────────────────────────────────
  const itemsSheet = workbook.addWorksheet('Line Items', {
    views: [{ state: 'frozen', ySplit: 1, showGridLines: true }],
  });

  itemsSheet.columns = [
    { header: 'Receipt Ref', key: 'ref', width: 14 },
    { header: 'Merchant', key: 'merchant', width: 25 },
    { header: 'Date', key: 'date', width: 14 },
    { header: 'Item Description', key: 'desc', width: 32 },
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
      // If no specific line items parsed, add a general line
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

  // Generate buffer and trigger browser download via file-saver
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  saveAs(blob, filename);
}
