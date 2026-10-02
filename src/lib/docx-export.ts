import { saveAs } from 'file-saver';
import type { ExportReceiptData } from './excel-export';

/**
 * Generate a Word Document (.doc) report compatible with Microsoft Word & Google Docs
 */
export function exportReceiptsToDocx(
  receipts: ExportReceiptData[],
  filename = 'HMRC_Receipt_Register.doc'
) {
  const totalCount = receipts.length;
  const sumTotal = receipts.reduce((acc, r) => acc + (r.totalAmount || 0), 0);
  const sumVat = receipts.reduce((acc, r) => acc + (r.vatAmount || 0), 0);
  const sumNet = receipts.reduce((acc, r) => acc + (r.subtotal || 0), 0);

  const tableRowsHtml = receipts
    .map(
      (r, idx) => `
    <tr>
      <td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: bold; text-align: center;">REC-${String(idx + 1).padStart(4, '0')}</td>
      <td style="padding: 8px; border: 1px solid #e5e7eb;">${r.receiptDate ? r.receiptDate.split('-').reverse().join('/') : 'DD/MM/YYYY'}</td>
      <td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: bold;">${r.merchantName || 'Unknown Merchant'}</td>
      <td style="padding: 8px; border: 1px solid #e5e7eb; text-align: right;">£${(r.subtotal ?? 0).toFixed(2)}</td>
      <td style="padding: 8px; border: 1px solid #e5e7eb; text-align: right; color: #0f766e; font-weight: bold;">£${(r.vatAmount ?? 0).toFixed(2)}</td>
      <td style="padding: 8px; border: 1px solid #e5e7eb; text-align: right; font-weight: bold;">£${(r.totalAmount ?? 0).toFixed(2)}</td>
      <td style="padding: 8px; border: 1px solid #e5e7eb; text-align: center;">${r.essentialsConfidence ?? r.confidence}%</td>
      <td style="padding: 8px; border: 1px solid #e5e7eb; text-align: center;">${r.status === 'user_verified' ? 'User Verified' : 'Verified Read'}</td>
    </tr>
  `
    )
    .join('');

  const htmlDocument = `
    <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
    <head>
      <meta charset="utf-8">
      <title>HMRC Receipt Register</title>
      <style>
        body { font-family: 'Calibri', 'Segoe UI', Arial, sans-serif; color: #1f2937; margin: 20px; }
        .banner { background-color: #0f766e; color: #ffffff; padding: 18px 24px; border-radius: 8px; margin-bottom: 20px; }
        .banner h1 { margin: 0; font-size: 20px; font-weight: bold; }
        .banner p { margin: 4px 0 0 0; font-size: 11px; opacity: 0.9; }
        .metrics { background-color: #f3f4f6; border: 1px solid #e5e7eb; padding: 14px 20px; border-radius: 8px; margin-bottom: 24px; display: table; width: 100%; }
        .metric-item { display: table-cell; text-align: center; font-size: 13px; font-weight: bold; }
        table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 12px; }
        th { background-color: #0f766e; color: white; padding: 10px 8px; text-align: left; font-size: 12px; }
        .footer { margin-top: 30px; font-size: 11px; color: #6b7280; text-align: center; border-top: 1px solid #e5e7eb; padding-top: 12px; }
      </style>
    </head>
    <body>
      <div class="banner">
        <h1>HMRC RECEIPT &amp; VAT RECLAIM REGISTER</h1>
        <p>Generated on ${new Date().toLocaleDateString('en-GB')} via No Overtime • Making Tax Digital (MTD) Compliant</p>
      </div>

      <div class="metrics">
        <div class="metric-item">Total Receipts: ${totalCount}</div>
        <div class="metric-item">Net Subtotal: £${sumNet.toFixed(2)}</div>
        <div class="metric-item" style="color: #0f766e;">VAT Reclaim (20%): £${sumVat.toFixed(2)}</div>
        <div class="metric-item">Gross Total: £${sumTotal.toFixed(2)}</div>
      </div>

      <table>
        <thead>
          <tr>
            <th>Ref #</th>
            <th>Date</th>
            <th>Merchant / Supplier</th>
            <th style="text-align: right;">Net Subtotal</th>
            <th style="text-align: right;">UK VAT (20%)</th>
            <th style="text-align: right;">Gross Total</th>
            <th style="text-align: center;">HMRC Score</th>
            <th style="text-align: center;">Status</th>
          </tr>
        </thead>
        <tbody>
          ${tableRowsHtml}
        </tbody>
        <tfoot>
          <tr style="background-color: #f9fafb; font-weight: bold;">
            <td colspan="3" style="padding: 10px 8px; border: 1px solid #e5e7eb; color: #0f766e;">TOTALS (HMRC Reclaim Sum):</td>
            <td style="padding: 10px 8px; border: 1px solid #e5e7eb; text-align: right;">£${sumNet.toFixed(2)}</td>
            <td style="padding: 10px 8px; border: 1px solid #e5e7eb; text-align: right; color: #0f766e;">£${sumVat.toFixed(2)}</td>
            <td style="padding: 10px 8px; border: 1px solid #e5e7eb; text-align: right;">£${sumTotal.toFixed(2)}</td>
            <td colspan="2" style="border: 1px solid #e5e7eb;"></td>
          </tr>
        </tfoot>
      </table>

      <div class="footer">
        No Overtime • HMRC Making Tax Digital Expense Register
      </div>
    </body>
    </html>
  `;

  const blob = new Blob(['\ufeff', htmlDocument], {
    type: 'application/msword;charset=utf-8;',
  });
  saveAs(blob, filename);
}
