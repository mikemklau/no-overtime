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
 *  - Tab 1: Receipts Register (HMRC Summary Banner + Full Receipts Table with VAT formulas) [DEFAULT ACTIVE TAB]
 *  - Tab 2: Line Items (Detailed item-by-item breakdown)
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
  const sumTotal = receipts.reduce((acc, r) => acc + (r.totalAmount || 0), 0);
  const sumVat = receipts.reduce((acc, r) => acc + (r.vatAmount || 0), 0);
  const sumNet = receipts.reduce((acc, r) => acc + (r.subtotal || 0), 0);
  const sumService = receipts.reduce((acc, r) => acc + (r.serviceCharge || 0), 0);

  // ─────────────────────────────────────────────────────────────
  // TAB 1: RECEIPTS REGISTER & VAT RECLAIM (Default Active Tab)
  // ─────────────────────────────────────────────────────────────
  const registerSheet = workbook.addWorksheet('Receipts Register', {
    views: [{ state: 'frozen', ySplit: 5, showGridLines: true }],
  });

  registerSheet.columns = [
    { key: 'ref', width: 14 },
    { key: 'date', width: 16 },
    { key: 'merchant', width: 32 },
    { key: 'subtotal', width: 18 },
    { key: 'vat', width: 18 },
    { key: 'service', width: 18 },
    { key: 'total', width: 18 },
    { key: 'confidence', width: 15 },
    { key: 'status', width: 16 },
  ];

  // Title Row (Row 1)
  registerSheet.mergeCells('A1:I1');
  const titleCell = registerSheet.getCell('A1');
  titleCell.value = 'HMRC RECEIPT & VAT RECLAIM REGISTER';
  titleCell.font = { name: 'Calibri', size: 15, bold: true, color: { argb: 'FF0F766E' } };
  titleCell.alignment = { vertical: 'middle' };
  registerSheet.getRow(1).height = 24;

  // Subtitle Row (Row 2)
  registerSheet.mergeCells('A2:I2');
  const subCell = registerSheet.getCell('A2');
  subCell.value = `Generated on ${new Date().toLocaleDateString('en-GB')} via No Overtime • Making Tax Digital (MTD) Compliant`;
  subCell.font = { name: 'Calibri', size: 10, italic: true, color: { argb: 'FF6B7280' } };
  registerSheet.getRow(2).height = 18;

  // KPI Summary Row (Row 4)
  const kpiRow = registerSheet.getRow(4);
  kpiRow.height = 22;
  registerSheet.getCell('A4').value = `Total Receipts: ${totalCount}`;
  registerSheet.getCell('A4').font = { name: 'Calibri', size: 11, bold: true };
  
  registerSheet.getCell('C4').value = `Net Subtotal: £${sumNet.toFixed(2)}`;
  registerSheet.getCell('C4').font = { name: 'Calibri', size: 11, bold: true };

  registerSheet.getCell('E4').value = `VAT Reclaim (20%): £${sumVat.toFixed(2)}`;
  registerSheet.getCell('E4').font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF0F766E' } };

  registerSheet.getCell('G4').value = `Gross Total: £${sumTotal.toFixed(2)}`;
  registerSheet.getCell('G4').font = { name: 'Calibri', size: 11, bold: true };

  // Table Headers (Row 5)
  const headerRow = registerSheet.getRow(5);
  headerRow.height = 26;
  const headers = [
    'Ref #',
    'Receipt Date',
    'Merchant / Supplier',
    'Net Subtotal (£)',
    'UK VAT 20% (£)',
    'Service Charge (£)',
    'Gross Total (£)',
    'HMRC Score',
    'Status'
  ];
  headers.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.fill = headerFill;
    cell.font = headerFont;
    cell.alignment = {
      vertical: 'middle',
      horizontal: i === 0 || i >= 7 ? 'center' : (i >= 3 && i <= 6 ? 'right' : 'left'),
    };
  });

  // Table Data (Row 6+)
  receipts.forEach((r, idx) => {
    const rowNum = 6 + idx;
    const row = registerSheet.getRow(rowNum);
    row.height = 20;

    row.getCell(1).value = `REC-${String(idx + 1).padStart(4, '0')}`;
    row.getCell(1).alignment = { horizontal: 'center' };

    row.getCell(2).value = r.receiptDate || 'DD/MM/YYYY';

    row.getCell(3).value = r.merchantName || 'Unknown Merchant';
    row.getCell(3).font = { bold: true };

    const netVal = r.subtotal ?? (r.totalAmount ? Math.round(((r.totalAmount - (r.vatAmount ?? 0)) + Number.EPSILON) * 100) / 100 : 0);
    row.getCell(4).value = netVal;
    row.getCell(4).numFmt = currencyFormat;

    row.getCell(5).value = r.vatAmount ?? 0;
    row.getCell(5).numFmt = currencyFormat;
    row.getCell(5).font = { bold: true, color: { argb: 'FF0F766E' } };

    row.getCell(6).value = r.serviceCharge ?? 0;
    row.getCell(6).numFmt = currencyFormat;

    row.getCell(7).value = r.totalAmount ?? 0;
    row.getCell(7).numFmt = currencyFormat;
    row.getCell(7).font = { bold: true };

    row.getCell(8).value = `${r.essentialsConfidence ?? r.confidence}%`;
    row.getCell(8).alignment = { horizontal: 'center' };

    row.getCell(9).value = r.status === 'user_verified' ? 'User Verified' : 'Verified Read';
    row.getCell(9).alignment = { horizontal: 'center' };
  });

  // Totals Row at the bottom
  if (receipts.length > 0) {
    const lastDataRow = 5 + receipts.length;
    const totalRowNum = lastDataRow + 1;
    const totalRow = registerSheet.getRow(totalRowNum);
    totalRow.height = 24;

    totalRow.getCell(3).value = 'TOTALS (HMRC Reclaim Sum):';
    totalRow.getCell(3).font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF0F766E' } };

    totalRow.getCell(4).value = { formula: `SUM(D6:D${lastDataRow})`, result: sumNet };
    totalRow.getCell(4).numFmt = currencyFormat;
    totalRow.getCell(4).font = { bold: true };

    totalRow.getCell(5).value = { formula: `SUM(E6:E${lastDataRow})`, result: sumVat };
    totalRow.getCell(5).numFmt = currencyFormat;
    totalRow.getCell(5).font = { bold: true, color: { argb: 'FF0F766E' } };

    totalRow.getCell(6).value = { formula: `SUM(F6:F${lastDataRow})`, result: sumService };
    totalRow.getCell(6).numFmt = currencyFormat;
    totalRow.getCell(6).font = { bold: true };

    totalRow.getCell(7).value = { formula: `SUM(G6:G${lastDataRow})`, result: sumTotal };
    totalRow.getCell(7).numFmt = currencyFormat;
    totalRow.getCell(7).font = { bold: true };
  }

  // ─────────────────────────────────────────────────────────────
  // TAB 2: LINE ITEMS BREAKDOWN
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

  // Generate buffer and trigger browser download via file-saver
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  saveAs(blob, filename);
}
