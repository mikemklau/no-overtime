import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { ExportReceiptData } from './excel-export';

/**
 * Generate an HMRC-ready PDF Expense Register & Reclaim Summary Report
 */
export function exportReceiptsToPdf(
  receipts: ExportReceiptData[],
  filename = 'HMRC_Receipt_Register.pdf'
) {
  const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });

  // Header Banner (Teal #0f766e)
  doc.setFillColor(15, 118, 110);
  doc.rect(0, 0, 210, 28, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(15);
  doc.setFont('helvetica', 'bold');
  doc.text('HMRC RECEIPT & VAT RECLAIM REGISTER', 14, 14);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(
    `Generated on ${new Date().toLocaleDateString('en-GB')} via No Overtime • MTD Compliant`,
    14,
    21
  );

  // Metric calculation
  const totalCount = receipts.length;
  const sumTotal = receipts.reduce((acc, r) => acc + (r.totalAmount || 0), 0);
  const sumVat = receipts.reduce((acc, r) => acc + (r.vatAmount || 0), 0);
  const sumNet = receipts.reduce((acc, r) => acc + (r.subtotal || 0), 0);

  // Summary Metrics Banner Box
  doc.setFillColor(245, 247, 248);
  doc.setDrawColor(220, 225, 230);
  doc.roundedRect(14, 34, 182, 18, 2, 2, 'FD');

  doc.setTextColor(60, 60, 60);
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'bold');
  doc.text(`Total Receipts: ${totalCount}`, 18, 45);
  doc.text(`Net Subtotal: £${sumNet.toFixed(2)}`, 62, 45);
  doc.setTextColor(15, 118, 110);
  doc.text(`VAT Reclaim (20%): £${sumVat.toFixed(2)}`, 112, 45);
  doc.setTextColor(20, 20, 20);
  doc.text(`Gross Total: £${sumTotal.toFixed(2)}`, 160, 45);

  // Table rows
  const tableRows = receipts.map((r, idx) => [
    `REC-${String(idx + 1).padStart(4, '0')}`,
    r.receiptDate ? r.receiptDate.split('-').reverse().join('/') : 'DD/MM/YYYY',
    r.merchantName || 'Unknown Merchant',
    `£${(r.subtotal ?? 0).toFixed(2)}`,
    `£${(r.vatAmount ?? 0).toFixed(2)}`,
    `£${(r.totalAmount ?? 0).toFixed(2)}`,
    `${r.essentialsConfidence ?? r.confidence}%`,
    r.status === 'user_verified' ? 'User Verified' : 'Verified Read',
  ]);

  autoTable(doc, {
    startY: 58,
    head: [['Ref #', 'Date', 'Merchant', 'Net (£)', 'VAT (£)', 'Gross (£)', 'HMRC Score', 'Status']],
    body: tableRows,
    headStyles: {
      fillColor: [15, 118, 110],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8.5,
    },
    bodyStyles: {
      fontSize: 8,
      textColor: [40, 40, 40],
    },
    columnStyles: {
      0: { cellWidth: 22 },
      1: { cellWidth: 24 },
      2: { cellWidth: 46 },
      3: { cellWidth: 22, halign: 'right' },
      4: { cellWidth: 22, halign: 'right' },
      5: { cellWidth: 24, halign: 'right' },
      6: { cellWidth: 20, halign: 'center' },
      7: { cellWidth: 24, halign: 'center' },
    },
    foot: [
      [
        'TOTALS',
        '',
        '',
        `£${sumNet.toFixed(2)}`,
        `£${sumVat.toFixed(2)}`,
        `£${sumTotal.toFixed(2)}`,
        '',
        '',
      ],
    ],
    footStyles: {
      fillColor: [240, 240, 240],
      textColor: [15, 118, 110],
      fontStyle: 'bold',
      fontSize: 8.5,
    },
  });

  doc.save(filename);
}
