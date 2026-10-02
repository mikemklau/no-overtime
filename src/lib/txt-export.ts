import { saveAs } from 'file-saver';
import type { ExportReceiptData } from './excel-export';

/**
 * Generate a formatted Plain Text (.txt) summary register
 */
export function exportReceiptsToTxt(
  receipts: ExportReceiptData[],
  filename = 'HMRC_Receipt_Register.txt'
) {
  const totalCount = receipts.length;
  const sumTotal = receipts.reduce((acc, r) => acc + (r.totalAmount || 0), 0);
  const sumVat = receipts.reduce((acc, r) => acc + (r.vatAmount || 0), 0);
  const sumNet = receipts.reduce((acc, r) => acc + (r.subtotal || 0), 0);

  const lines: string[] = [];
  lines.push('================================================================');
  lines.push('               HMRC RECEIPT & VAT RECLAIM REGISTER              ');
  lines.push('================================================================');
  lines.push(`Generated: ${new Date().toLocaleDateString('en-GB')} ${new Date().toLocaleTimeString('en-GB')}`);
  lines.push(`Status: HMRC Making Tax Digital (MTD) Compliant Summary`);
  lines.push('----------------------------------------------------------------');
  lines.push(`TOTAL RECEIPTS   : ${totalCount}`);
  lines.push(`NET SUBTOTAL     : £${sumNet.toFixed(2)}`);
  lines.push(`UK VAT (20%)     : £${sumVat.toFixed(2)}`);
  lines.push(`GROSS TOTAL      : £${sumTotal.toFixed(2)}`);
  lines.push('================================================================\n');

  lines.push('DETAILED RECEIPT ENTRIES:');
  lines.push('----------------------------------------------------------------');

  receipts.forEach((r, idx) => {
    const ref = `REC-${String(idx + 1).padStart(4, '0')}`;
    lines.push(`[${ref}] ${r.merchantName || 'Unknown Merchant'}`);
    lines.push(`  Date       : ${r.receiptDate || 'DD/MM/YYYY'}`);
    lines.push(`  Net Subtotal: £${(r.subtotal ?? 0).toFixed(2)}`);
    lines.push(`  UK VAT (20%): £${(r.vatAmount ?? 0).toFixed(2)}`);
    lines.push(`  Total Gross : £${(r.totalAmount ?? 0).toFixed(2)}`);
    lines.push(`  HMRC Score  : ${r.essentialsConfidence ?? r.confidence}% (${r.status === 'user_verified' ? 'User Verified' : 'Verified Read'})`);

    if (r.lineItems && r.lineItems.length > 0) {
      lines.push('  Line Items :');
      r.lineItems.forEach((it) => {
        lines.push(`    - ${it.quantity}x ${it.description} @ £${it.totalPrice.toFixed(2)}`);
      });
    }
    lines.push('----------------------------------------------------------------');
  });

  const content = lines.join('\n');
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8;' });
  saveAs(blob, filename);
}
