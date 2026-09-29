/**
 * receipt-to-json: UK-tuned receipt/invoice parser
 *
 * Parses raw OCR text into structured receipt data.
 * Handles DD/MM/YYYY → ISO-8601, UK 20% VAT, 12.5% service charges,
 * and strips card-terminal noise (AUTH CODES, AID lines, etc.).
 */

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

// ─────────────────────────────────────────────────────────
// Card-terminal noise patterns to strip before parsing
// ─────────────────────────────────────────────────────────
const NOISE_PATTERNS = [
  /\b(AUTH|AUTHORIS(ED|ATION))\s*(CODE)?[\s:]*[A-Z0-9]+/gi,
  /\bAID[\s:]*[A-F0-9]+/gi,
  /\bMERCHANT\s*(ID|NO|NUMBER)[\s:]*\d+/gi,
  /\bTERMINAL\s*(ID|NO|NUMBER)[\s:]*[A-Z0-9]+/gi,
  /\bCARDHOLDER\s*(COPY|RECEIPT)/gi,
  /\bPLEASE\s*RETAIN/gi,
  /\bCHIP\s*(&|AND)\s*PIN/gi,
  /\bCONTACTLESS/gi,
  /\bVERIFIED\s*BY\s*PIN/gi,
  /\bAPPROVED/gi,
  /\bVISA|MASTERCARD|AMEX|DEBIT|CREDIT/gi,
  /\*{4,}\s*\d{4}/g,               // Masked card numbers ****1234
  /\bPAN[\s:]*\S+/gi,
];

// ─────────────────────────────────────────────────────────
// Date patterns (UK DD/MM/YYYY and variations)
// ─────────────────────────────────────────────────────────
const DATE_PATTERNS = [
  // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
  /(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/,
  // DD/MM/YY
  /(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2})(?!\d)/,
  // Written: 29 Sep 2026, 29 September 2026
  /(\d{1,2})\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{4})/i,
];

const MONTH_MAP: Record<string, string> = {
  jan: '01', january: '01',
  feb: '02', february: '02',
  mar: '03', march: '03',
  apr: '04', april: '04',
  may: '05',
  jun: '06', june: '06',
  jul: '07', july: '07',
  aug: '08', august: '08',
  sep: '09', september: '09',
  oct: '10', october: '10',
  nov: '11', november: '11',
  dec: '12', december: '12',
};

// ─────────────────────────────────────────────────────────
// Money extraction patterns
// ─────────────────────────────────────────────────────────
const TOTAL_PATTERNS = [
  /\bTOTAL[\s:£]*(\d+[.,]\d{2})/i,
  /\bGRAND\s*TOTAL[\s:£]*(\d+[.,]\d{2})/i,
  /\bAMOUNT\s*(DUE|PAYABLE|PAID)[\s:£]*(\d+[.,]\d{2})/i,
  /\bBALANCE\s*(DUE)?[\s:£]*(\d+[.,]\d{2})/i,
];

const VAT_PATTERNS = [
  /\bVAT[\s:£@]*(\d+[.,]\d{2})/i,
  /\bTAX[\s:£]*(\d+[.,]\d{2})/i,
  /\b20%[\s:£]*(\d+[.,]\d{2})/i,
];

const SUBTOTAL_PATTERNS = [
  /\bSUB\s*-?\s*TOTAL[\s:£]*(\d+[.,]\d{2})/i,
  /\bNET[\s:£]*(\d+[.,]\d{2})/i,
  /\bEX\s*\.?\s*VAT[\s:£]*(\d+[.,]\d{2})/i,
];

const SERVICE_CHARGE_PATTERNS = [
  /\bSERVICE\s*(CHARGE)?[\s:£]*(\d+[.,]\d{2})/i,
  /\b12\.?5\s*%[\s:£]*(\d+[.,]\d{2})/i,
  /\bGRATUITY[\s:£]*(\d+[.,]\d{2})/i,
  /\bTIP[\s:£]*(\d+[.,]\d{2})/i,
];

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────
function stripNoise(text: string): string {
  let clean = text;
  for (const pattern of NOISE_PATTERNS) {
    clean = clean.replace(pattern, '');
  }
  return clean;
}

function parseMoney(value: string): number {
  return parseFloat(value.replace(',', '.'));
}

function extractFirstMatch(text: string, patterns: RegExp[]): number | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      // Find the last capture group that looks like a number
      for (let i = match.length - 1; i >= 1; i--) {
        if (match[i] && /\d+[.,]\d{2}/.test(match[i])) {
          return parseMoney(match[i]);
        }
      }
    }
  }
  return null;
}

function extractDate(text: string): string | null {
  // DD/MM/YYYY
  const dmy4 = text.match(DATE_PATTERNS[0]);
  if (dmy4) {
    const [, d, m, y] = dmy4;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // DD/MM/YY
  const dmy2 = text.match(DATE_PATTERNS[1]);
  if (dmy2) {
    const [, d, m, yy] = dmy2;
    const year = parseInt(yy) > 50 ? `19${yy}` : `20${yy}`;
    return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // Written date: 29 Sep 2026
  const written = text.match(DATE_PATTERNS[2]);
  if (written) {
    const [, d, monthStr, y] = written;
    const month = MONTH_MAP[monthStr.toLowerCase()] || '01';
    return `${y}-${month}-${d.padStart(2, '0')}`;
  }

  return null;
}

function extractMerchant(text: string): string | null {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  for (const line of lines.slice(0, 5)) {
    // Skip lines that are purely numeric, date-like, or very short
    if (/^\d+$/.test(line)) continue;
    if (/^\d{1,2}[\/\-.]/.test(line)) continue;
    if (line.length < 3) continue;
    // Skip lines that look like addresses (contain postcode-like patterns)
    if (/\b[A-Z]{1,2}\d{1,2}\s*\d[A-Z]{2}\b/i.test(line)) continue;
    // Skip phone numbers
    if (/^[\d\s\-+()]{7,}$/.test(line)) continue;

    return line;
  }
  return null;
}

function extractLineItems(text: string): ParsedLineItem[] {
  const items: ParsedLineItem[] = [];
  const lines = text.split('\n');

  // Pattern: quantity x description ... price  OR  description ... price
  const itemPattern = /^(?:(\d+)\s*x\s+)?(.+?)\s+£?(\d+[.,]\d{2})\s*$/i;

  for (const line of lines) {
    const trimmed = line.trim();
    const match = trimmed.match(itemPattern);
    if (match) {
      const quantity = match[1] ? parseInt(match[1]) : 1;
      const description = match[2].trim();
      const totalPrice = parseMoney(match[3]);

      // Skip if description looks like a total/subtotal/vat line
      if (/\b(total|sub.?total|vat|tax|service|balance|change|cash|card|visa|paid)\b/i.test(description)) {
        continue;
      }

      items.push({
        description,
        quantity,
        unitPrice: Math.round((totalPrice / quantity) * 100) / 100,
        totalPrice,
        category: null,
      });
    }
  }

  return items;
}

/**
 * Calculate a confidence score (0–100) based on how many fields
 * were successfully extracted.
 */
function calculateConfidence(receipt: Partial<ParsedReceipt>): number {
  let score = 0;
  const weights = {
    merchantName: 20,
    receiptDate: 20,
    totalAmount: 25,
    subtotal: 10,
    vatAmount: 15,
    lineItems: 10,
  };

  if (receipt.merchantName) score += weights.merchantName;
  if (receipt.receiptDate) score += weights.receiptDate;
  if (receipt.totalAmount) score += weights.totalAmount;
  if (receipt.subtotal) score += weights.subtotal;
  if (receipt.vatAmount) score += weights.vatAmount;
  if (receipt.lineItems && receipt.lineItems.length > 0) score += weights.lineItems;

  return score;
}

// ─────────────────────────────────────────────────────────
// Main parser
// ─────────────────────────────────────────────────────────

/**
 * Parse raw OCR text into a structured UK receipt.
 * Strips card-terminal noise, extracts dates in DD/MM/YYYY format,
 * identifies UK 20% VAT, 12.5% service charges, and line items.
 */
export function parseReceipt(rawText: string): ParsedReceipt {
  const cleanText = stripNoise(rawText);

  const merchantName = extractMerchant(cleanText);
  const receiptDate = extractDate(cleanText);
  const totalAmount = extractFirstMatch(cleanText, TOTAL_PATTERNS);
  const vatAmount = extractFirstMatch(cleanText, VAT_PATTERNS);
  const subtotal = extractFirstMatch(cleanText, SUBTOTAL_PATTERNS);
  const lineItems = extractLineItems(cleanText);

  // Service charge extraction
  let serviceCharge: number | null = null;
  for (const pattern of SERVICE_CHARGE_PATTERNS) {
    const match = cleanText.match(pattern);
    if (match) {
      for (let i = match.length - 1; i >= 1; i--) {
        if (match[i] && /\d+[.,]\d{2}/.test(match[i])) {
          serviceCharge = parseMoney(match[i]);
          break;
        }
      }
      if (serviceCharge !== null) break;
    }
  }

  // If we have total but no subtotal/VAT, try to compute them
  const computedSubtotal =
    subtotal ?? (totalAmount && vatAmount
      ? Math.round((totalAmount - vatAmount - (serviceCharge ?? 0)) * 100) / 100
      : null);

  const computedVat =
    vatAmount ?? (computedSubtotal
      ? Math.round(computedSubtotal * 0.2 * 100) / 100
      : null);

  const result: ParsedReceipt = {
    merchantName,
    receiptDate,
    currency: 'GBP',
    subtotal: computedSubtotal,
    vatAmount: computedVat,
    serviceCharge,
    totalAmount,
    lineItems,
    confidence: 0,
    rawText,
  };

  result.confidence = calculateConfidence(result);

  return result;
}
