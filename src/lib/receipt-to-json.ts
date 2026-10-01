/**
 * receipt-to-json adapter
 *
 * Connects no-overtime-app to the dedicated 'receipt-to-json' package
 * (D:\dev\receipt-to-json), providing typed interfaces and mapping
 * OCR lines / raw text into the application's ParsedReceipt model.
 */

import {
  parseOfflineOcrReceipt,
  type Receipt,
  type ReceiptOcrLine,
  type ReceiptOcrLinesInput,
} from 'receipt-to-json';

export interface ParsedLineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  category: string | null;
  confidence?: number;              // 0–100 item confidence score
}

export interface ParsedReceipt {
  merchantName: string | null;
  receiptDate: string | null;       // ISO-8601 (YYYY-MM-DD)
  currency: string;                 // Always GBP
  subtotal: number | null;
  vatAmount: number | null;         // UK 20% standard rate
  serviceCharge: number | null;     // UK 12.5% optional
  totalAmount: number | null;
  lineItems: ParsedLineItem[];
  confidence: number;               // 0–100 (full, includes line items)
  essentialsConfidence?: number;     // 0–100 (UK accounting: merchant + date + total + VAT only)
  fieldConfidence?: {
    merchantName?: number;
    receiptDate?: number;
    totalAmount?: number;
    vatAmount?: number;
    subtotal?: number;
    serviceCharge?: number;
  };
  warnings?: Array<{ code: string; message: string; severity?: string }>;
  rawText: string;
}

export interface MathCheckResult {
  hasMismatch: boolean;
  message?: string;
}

export function checkReceiptMath(r: {
  totalAmount: number | null;
  subtotal: number | null;
  vatAmount: number | null;
  serviceCharge: number | null;
}): MathCheckResult {
  const total = r.totalAmount ?? 0;
  const subtotal = r.subtotal;
  const vat = r.vatAmount ?? 0;
  const service = r.serviceCharge ?? 0;

  if (total <= 0) return { hasMismatch: false };

  // 1. VAT cannot exceed total
  if (vat > total) {
    return {
      hasMismatch: true,
      message: `VAT (£${vat.toFixed(2)}) exceeds Total (£${total.toFixed(2)})`,
    };
  }

  // 2. Net Subtotal + VAT (+ Service) vs Total
  if (subtotal != null && subtotal > 0 && vat > 0) {
    const netPlusVat = Math.round((subtotal + vat + service) * 100) / 100;
    const isGross = Math.abs(subtotal - total) <= 0.02;

    if (Math.abs(netPlusVat - total) <= 0.02 || isGross) {
      return { hasMismatch: false };
    }

    return {
      hasMismatch: true,
      message: `Net (£${subtotal.toFixed(2)}) + VAT (£${vat.toFixed(2)})${service > 0 ? ` + Service (£${service.toFixed(2)})` : ''} ≠ Total (£${total.toFixed(2)})`,
    };
  }

  return { hasMismatch: false };
}

/**
 * Map the rich Receipt model from receipt-to-json into the UI's ParsedReceipt shape.
 */
export function receiptToParsedReceipt(receipt: Receipt, fallbackRawText = ''): ParsedReceipt {
  const merchantConf = receipt.merchant.name === 'Unknown merchant' || !receipt.merchant.name
    ? 20
    : Math.round((receipt.merchant.confidence ?? receipt.confidence.merchant ?? 0.8) * 100);

  const dateConf = receipt.dateTime.date === '1970-01-01' || !receipt.dateTime.date
    ? 15
    : Math.round((receipt.dateTime.confidence ?? receipt.confidence.dateTime ?? 0.8) * 100);

  const totalsConf = Math.round((receipt.confidence.totals ?? 0.8) * 100);
  const taxConf = Math.round((receipt.confidence.tax ?? receipt.confidence.totals ?? 0.8) * 100);
  const serviceChargeConf = Math.round((receipt.confidence.serviceCharge ?? 0.8) * 100);

  // Compute essentials-only confidence directly from the actual field confidence scores!
  const essentialScores = [
    { score: merchantConf, weight: 1 },
    { score: dateConf, weight: 1 },
    { score: totalsConf, weight: 2 },
    { score: taxConf, weight: 2 },
  ];
  const totalWeight = essentialScores.reduce((s, e) => s + e.weight, 0);
  const essentialsConfidence = Math.round(essentialScores.reduce((s, e) => s + e.score * e.weight, 0) / totalWeight);

  return {
    merchantName: receipt.merchant.name === 'Unknown merchant' ? null : receipt.merchant.name,
    receiptDate: receipt.dateTime.date === '1970-01-01' ? null : receipt.dateTime.date,
    currency: receipt.currency || 'GBP',
    subtotal: receipt.totals.subtotal ?? null,
    vatAmount: (receipt.totals.taxTotal ?? 0) > 0 ? receipt.totals.taxTotal! : null,
    serviceCharge: (receipt.totals.serviceCharge ?? 0) > 0 ? receipt.totals.serviceCharge! : null,
    totalAmount: receipt.totals.grandTotal,
    confidence: Math.round((receipt.confidence.overall ?? 0.5) * 100),
    essentialsConfidence,
    fieldConfidence: {
      merchantName: merchantConf,
      receiptDate: dateConf,
      totalAmount: totalsConf,
      vatAmount: taxConf,
      subtotal: totalsConf,
      serviceCharge: serviceChargeConf,
    },
    warnings: receipt.warnings.map((w) => ({
      code: w.code,
      message: w.message,
      severity: w.severity,
    })),
    rawText: fallbackRawText || receipt.rawText || '',
    lineItems: receipt.lineItems.map((item) => ({
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice ?? item.totalPrice,
      totalPrice: item.totalPrice,
      category: null,
      confidence: Math.round((item.confidence ?? 0.8) * 100),
    })),
  };
}

/**
 * Parse rich OCR lines with geometric 2D bounding boxes using receipt-to-json.
 */
export function parseReceiptWithOcrLines(
  lines: ReceiptOcrLine[],
  rawText = ''
): ParsedReceipt {
  const input: ReceiptOcrLinesInput = {
    kind: 'ocr-lines',
    lines,
  };

  const receipt = parseOfflineOcrReceipt(input);
  return receiptToParsedReceipt(receipt, rawText);
}

/**
 * Parse plain text by converting text lines into OCR lines and passing to receipt-to-json.
 */
export function parseReceipt(rawText: string): ParsedReceipt {
  const lines: ReceiptOcrLine[] = rawText
    .split(/\r?\n/)
    .map((text, index) => ({ text: text.trim(), index }))
    .filter((l) => l.text.length > 0);

  return parseReceiptWithOcrLines(lines, rawText);
}
