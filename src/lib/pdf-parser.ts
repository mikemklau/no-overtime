import * as pdfjsLib from 'pdfjs-dist';

// Configure pdfjs worker dynamically from CDN to avoid bundler configuration issues
if (typeof window !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version || '4.10.38'}/pdf.worker.min.mjs`;
}

/**
 * Render page 1 of a PDF File/Blob into a JPEG Data URL for Tesseract OCR & Cloud AI parsing
 */
export async function convertPdfToImageDataUrl(pdfFile: File | Blob): Promise<string> {
  try {
    const arrayBuffer = await pdfFile.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) });
    const pdfDoc = await loadingTask.promise;
    
    // Render first page (receipts/invoices are usually 1 page)
    const page = await pdfDoc.getPage(1);
    const viewport = page.getViewport({ scale: 2.0 }); // High DPI for optimal OCR readability
    
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D context unavailable');

    await page.render({
      canvasContext: context,
      viewport: viewport,
      canvas: canvas,
    } as any).promise;

    return canvas.toDataURL('image/jpeg', 0.85);
  } catch (err) {
    console.error('Failed to render PDF to image:', err);
    throw new Error('Failed to process PDF document. Please ensure it is a valid PDF file.');
  }
}
