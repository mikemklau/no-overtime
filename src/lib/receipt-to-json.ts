/**
 * receipt-to-json adapter
 *
 * Connects no-overtime-app to the dedicated 'receipt-to-json' package
 * (D:\dev\reciept-to-json), providing typed interfaces and mapping
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
  confidence: number;               // 0–100
  rawText: string;
}

/**
 * Map the rich Receipt model from receipt-to-json into the UI's ParsedReceipt shape.
 */
export function receiptToParsedReceipt(receipt: Receipt, fallbackRawText = ''): ParsedReceipt {
  return {
    merchantName: receipt.merchant.name === 'Unknown merchant' ? null : receipt.merchant.name,
    receiptDate: receipt.dateTime.date === '1970-01-01' ? null : receipt.dateTime.date,
    currency: receipt.currency || 'GBP',
    subtotal: receipt.totals.subtotal ?? null,
    vatAmount: (receipt.totals.taxTotal ?? 0) > 0 ? receipt.totals.taxTotal! : null,
    serviceCharge: (receipt.totals.serviceCharge ?? 0) > 0 ? receipt.totals.serviceCharge! : null,
    totalAmount: receipt.totals.grandTotal,
    confidence: Math.round((receipt.confidence.overall ?? 0.5) * 100),
    rawText: fallbackRawText || receipt.rawText || '',
    lineItems: receipt.lineItems.map((item) => ({
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice ?? item.totalPrice,
      totalPrice: item.totalPrice,
      category: null,
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
