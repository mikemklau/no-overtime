import { createWorker } from 'tesseract.js';
import type { ReceiptOcrLine } from 'receipt-to-json';

export interface ExtractedOcrData {
  text: string;
  lines: ReceiptOcrLine[];
}

/**
 * Extract rich OCR data (text and positioned lines with bounding boxes)
 * from an image using Tesseract.js.
 */
export async function extractOcrFromImage(
  imageFile: File | Blob,
  onProgress?: (pct: number) => void
): Promise<ExtractedOcrData> {
  const worker = await createWorker('eng', 1, {
    logger: (m) => {
      if (m.status === 'recognizing text' && onProgress) {
        onProgress(Math.round(m.progress * 100));
      }
    },
  });

  try {
    const imageUrl = URL.createObjectURL(imageFile);
    const { data } = await worker.recognize(imageUrl);
    URL.revokeObjectURL(imageUrl);

    const lines: ReceiptOcrLine[] = [];

    if (data.blocks && data.blocks.length > 0) {
      for (const block of data.blocks) {
        for (const paragraph of block.paragraphs) {
          for (const line of paragraph.lines) {
            const trimmed = line.text.trim();
            if (!trimmed) continue;
            lines.push({
              text: trimmed,
              confidence: (line.confidence ?? 85) / 100,
              index: lines.length,
              boundingBox: line.bbox
                ? {
                    x: line.bbox.x0,
                    y: line.bbox.y0,
                    width: line.bbox.x1 - line.bbox.x0,
                    height: line.bbox.y1 - line.bbox.y0,
                  }
                : undefined,
            });
          }
        }
      }
    }

    // Fallback if no blocks were returned
    if (lines.length === 0 && data.text) {
      const textLines = data.text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      for (let i = 0; i < textLines.length; i++) {
        lines.push({
          text: textLines[i],
          confidence: (data.confidence ?? 85) / 100,
          index: i,
        });
      }
    }

    return {
      text: data.text,
      lines,
    };
  } finally {
    await worker.terminate();
  }
}

/**
 * Extract raw text from an image using Tesseract.js (offline OCR).
 */
export async function extractTextFromImage(
  imageFile: File | Blob,
  onProgress?: (pct: number) => void
): Promise<string> {
  const ocr = await extractOcrFromImage(imageFile, onProgress);
  return ocr.text;
}
