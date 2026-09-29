/**
 * tesseract-ocr.ts
 *
 * Client-side (browser / Capacitor WebView) offline OCR using Tesseract.js.
 * Converts an image File or Blob into raw extracted text without any
 * server round-trip or API key. Free and unlimited.
 *
 * Usage:
 *   const text = await extractTextFromImage(file);
 *   const parsed = parseReceipt(text);
 */

import { createWorker } from 'tesseract.js';

/**
 * Extract raw text from an image using Tesseract.js (offline OCR).
 *
 * @param imageFile - A File or Blob (image/jpeg, image/png, image/webp)
 * @param onProgress - Optional callback receiving a 0–100 progress value
 * @returns Raw extracted text string
 */
export async function extractTextFromImage(
  imageFile: File | Blob,
  onProgress?: (pct: number) => void
): Promise<string> {
  const worker = await createWorker('eng', 1, {
    logger: (m) => {
      if (m.status === 'recognizing text' && onProgress) {
        onProgress(Math.round(m.progress * 100));
      }
    },
  });

  try {
    // Convert File / Blob to a URL the worker can read
    const imageUrl = URL.createObjectURL(imageFile);
    const { data } = await worker.recognize(imageUrl);
    URL.revokeObjectURL(imageUrl);
    return data.text;
  } finally {
    await worker.terminate();
  }
}
