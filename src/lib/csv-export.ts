import { saveAs } from 'file-saver';
import type { ExportReceiptData } from './excel-export';

/**
 * Generate a CSV register for accounting software (Xero, QuickBooks, Sage)
 */
export function exportReceiptsToCsv(
  receipts: ExportReceiptData[],
  filename = 'HMRC_Receipt_Register.csv'
) {
  const headers = ['Ref #', 'Receipt Date', 'Merchant', 'Net Subtotal (GBP)', 'UK VAT 20% (GBP)', 'Service Charge (GBP)', 'Gross Total (GBP)', 'HMRC Confidence Score', 'Status'];

  const rows = receipts.map((r, idx) => [
    `REC-${String(idx + 1).padStart(4, '0')}`,
    r.receiptDate ? r.receiptDate.split('-').reverse().join('/') : 'DD/MM/YYYY',
    `"${(r.merchantName || 'Unknown Merchant').replace(/"/g, '""')}"`,
    (r.subtotal ?? 0).toFixed(2),
    (r.vatAmount ?? 0).toFixed(2),
    (r.serviceCharge ?? 0).toFixed(2),
    (r.totalAmount ?? 0).toFixed(2),
    `${r.essentialsConfidence ?? r.confidence}%`,
    r.status === 'user_verified' ? 'User Verified' : 'Verified Read',
  ]);

  const csvContent = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  saveAs(blob, filename);
}
