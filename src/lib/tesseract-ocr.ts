import { createWorker } from 'tesseract.js';
import type { ReceiptOcrLine } from 'receipt-to-json';

export interface ExtractedOcrData {
  text: string;
  lines: ReceiptOcrLine[];
}

/**
 * Preprocess an image on a hidden canvas before running OCR:
 * 1. Upscales low-resolution screen captures so text characters are at least 25-35px tall.
 * 2. Applies grayscale luminance and contrast stretching to eliminate anti-aliasing artifacts on digital screenshots.
 */
async function preprocessImageForOcr(
  imageFile: File | Blob
): Promise<{ source: HTMLCanvasElement | string; scale: number; cleanup?: () => void }> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    const url = URL.createObjectURL(imageFile);
    return { source: url, scale: 1, cleanup: () => URL.revokeObjectURL(url) };
  }

  return new Promise((resolve) => {
    const url = URL.createObjectURL(imageFile);
    const img = new Image();

    img.onload = () => {
      try {
        const originalWidth = img.naturalWidth || img.width;
        const originalHeight = img.naturalHeight || img.height;

        // Target: optimal OCR resolution is ~1600px max dimension.
        // Downscale huge mobile photos (4000px -> 1600px) for 4x faster mobile processing.
        // Upscale small screenshots (<1400px) so text characters are sharp.
        const maxDim = Math.max(originalWidth, originalHeight);
        let scale = 1;
        if (maxDim > 1800) {
          scale = 1600 / maxDim;
        } else if (maxDim < 1400) {
          scale = Math.min(2.0, 1600 / maxDim);
        }

        const canvas = document.createElement('canvas');
        const targetWidth = Math.round(originalWidth * scale);
        const targetHeight = Math.round(originalHeight * scale);
        canvas.width = targetWidth;
        canvas.height = targetHeight;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve({ source: url, scale: 1, cleanup: () => URL.revokeObjectURL(url) });
          return;
        }

        // Draw upscaled with high quality image smoothing
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

        // Preprocessing: Grayscale & Contrast Stretching
        const imgData = ctx.getImageData(0, 0, targetWidth, targetHeight);
        const d = imgData.data;

        for (let i = 0; i < d.length; i += 4) {
          // Grayscale luminance
          const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

          // Contrast stretch: push light backgrounds (>195) to pure white (255)
          // and darken faint anti-aliased text (<145)
          let enhanced: number;
          if (gray >= 195) {
            enhanced = 255;
          } else if (gray <= 145) {
            enhanced = Math.max(0, gray * 0.7);
          } else {
            // Linear ramp in the transition zone
            enhanced = ((gray - 145) / 50) * 255;
          }

          d[i] = enhanced;
          d[i + 1] = enhanced;
          d[i + 2] = enhanced;
        }

        ctx.putImageData(imgData, 0, 0);
        URL.revokeObjectURL(url);
        resolve({ source: canvas, scale });
      } catch (err) {
        console.warn('Canvas preprocessing fallback:', err);
        resolve({ source: url, scale: 1, cleanup: () => URL.revokeObjectURL(url) });
      }
    };

    img.onerror = () => {
      resolve({ source: url, scale: 1, cleanup: () => URL.revokeObjectURL(url) });
    };

    img.src = url;
  });
}

/**
 * Extract rich OCR data (text and positioned lines with bounding boxes)
 * from an image using Tesseract.js.
 */
export async function extractOcrFromImage(
  imageFile: File | Blob,
  onProgress?: (pct: number) => void
): Promise<ExtractedOcrData> {
  let worker;
  try {
    worker = await createWorker('eng', 1, {
      logger: (m) => {
        if (m.status === 'recognizing text' && onProgress) {
          onProgress(Math.round(m.progress * 100));
        }
      },
    });
  } catch (workerErr: any) {
    throw new Error(`OCR Engine init failed: ${workerErr?.message || workerErr}`);
  }

  const { source, scale, cleanup } = await preprocessImageForOcr(imageFile);

  try {
    const { data } = await worker.recognize(source);

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
                    x: line.bbox.x0 / scale,
                    y: line.bbox.y0 / scale,
                    width: (line.bbox.x1 - line.bbox.x0) / scale,
                    height: (line.bbox.y1 - line.bbox.y0) / scale,
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
    if (cleanup) cleanup();
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
