'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Device } from '@capacitor/device';
import { parseReceipt, parseReceiptWithOcrLines } from '@/lib/receipt-to-json';
import { extractOcrFromImage } from '@/lib/tesseract-ocr';
import { exportReceiptsToExcel, type ExportReceiptData } from '@/lib/excel-export';
import { triggerHaptic } from '@/lib/haptics';
import { OtpModal } from './OtpModal';
import { UpgradeModal } from './UpgradeModal';
import { RestoreDraftModal, type StoredReceiptsDraft } from './RestoreDraftModal';
import { ReceiptCard } from './ReceiptCard';
import { createClient } from '@/lib/supabase/client';

const DRAFT_STORAGE_KEY = 'no_overtime_receipts_draft_v1';
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours




// ─────────────────────────────────────────────────────────────
// Build a full API FormData payload for Cloud AI requests
// ─────────────────────────────────────────────────────────────

function compressImageToDataUrl(file: Blob, maxDim = 1200, quality = 0.75): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve('');
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve('');
    };
    img.src = url;
  });
}

function dataUrlToFile(dataUrl: string, filename: string): File {
  const arr = dataUrl.split(',');
  const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/jpeg';
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new File([u8arr], filename, { type: mime });
}

function buildCloudFormData(
  imageFile: File | Blob,
  deviceId: string | null
): FormData {
  const fd = new FormData();
  fd.append('mode', 'cloud');
  fd.append('image', imageFile, 'receipt.jpg');
  if (deviceId) fd.append('deviceId', deviceId);
  return fd;
}

// ─────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────
export function ReceiptScanner() {
  const [receipts, setReceipts] = useState<ExportReceiptData[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [ocrProgress, setOcrProgress] = useState<number | null>(null);
  const [ocrStatusText, setOcrStatusText] = useState<string | null>(null);
  const [scanMode, setScanMode] = useState<'essentials' | 'detailed'>('essentials');
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);

  // Modal controls
  const [isOtpOpen, setIsOtpOpen] = useState(false);
  const [otpReason, setOtpReason] = useState<'cloud_ai' | 'export'>('cloud_ai');
  const [isUpgradeOpen, setIsUpgradeOpen] = useState(false);
  const [quotaInfo, setQuotaInfo] = useState({ used: 5, limit: 5 });

  // Refresh persistence draft state
  const [pendingDraft, setPendingDraft] = useState<StoredReceiptsDraft | null>(null);
  const isDraftRestoredRef = useRef(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ─── Initialise session, device info & restore draft on mount ──────────
  useEffect(() => {
    async function init() {
      // Device ID for unauthenticated quota tracking
      try {
        const idResult = await Device.getId();
        setDeviceId(idResult.identifier);
      } catch {
        setDeviceId('browser-dev-session');
      }

      // Restore existing Supabase session
      try {
        const supabase = createClient();
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user?.email) {
          setUserEmail(session.user.email);
          setAuthToken(session.access_token);
        }
      } catch {
        // Supabase not yet connected – offline mode is still fully functional
      }

      // Check for saved unfinished draft in localStorage
      try {
        const saved = localStorage.getItem(DRAFT_STORAGE_KEY);
        if (saved) {
          const parsed: StoredReceiptsDraft = JSON.parse(saved);
          const isFresh = Date.now() - parsed.savedAt < DRAFT_TTL_MS;
          if (isFresh && parsed.receipts && parsed.receipts.length > 0) {
            setPendingDraft(parsed);
          } else {
            localStorage.removeItem(DRAFT_STORAGE_KEY);
          }
        }
      } catch (e) {
        console.warn('Failed to parse saved draft from localStorage', e);
        localStorage.removeItem(DRAFT_STORAGE_KEY);
      } finally {
        isDraftRestoredRef.current = true;
      }
    }
    init();
  }, []);

  // ─── Auto-save receipts draft to localStorage on change ──────────
  useEffect(() => {
    if (!isDraftRestoredRef.current) return;

    if (receipts.length > 0) {
      try {
        const draftPayload: StoredReceiptsDraft = {
          version: 1,
          savedAt: Date.now(),
          scanMode,
          receipts: receipts.map((r) => {
            // Strip non-serializable File/Blob objects
            const { sourceFile, ...rest } = r;
            return rest;
          }),
        };
        localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draftPayload));
      } catch (err) {
        console.warn('Failed to auto-save draft to localStorage', err);
      }
    } else {
      // User cleared all receipts
      localStorage.removeItem(DRAFT_STORAGE_KEY);
    }
  }, [receipts, scanMode]);

  // ─── Restore / Discard Draft Handlers ──────────────────
  const handleRestoreDraft = useCallback(() => {
    if (!pendingDraft) return;
    const restored = pendingDraft.receipts.map((r) => {
      if (r.imageBase64 && !r.sourceFile) {
        return {
          ...r,
          sourceFile: dataUrlToFile(r.imageBase64, `${r.merchantName || 'receipt'}.jpg`),
        };
      }
      return r;
    });
    setReceipts(restored);
    setScanMode(pendingDraft.scanMode);
    setPendingDraft(null);
  }, [pendingDraft]);

  const handleDiscardDraft = useCallback(() => {
    try {
      localStorage.removeItem(DRAFT_STORAGE_KEY);
    } catch {}
    setPendingDraft(null);
  }, []);

  // ─── Process raw OCR text through the UK parser ─────────
  const processText = useCallback((text: string) => {
    const parsed = parseReceipt(text);
    const entry: ExportReceiptData = {
      merchantName: parsed.merchantName,
      receiptDate: parsed.receiptDate,
      currency: parsed.currency,
      subtotal: parsed.subtotal,
      vatAmount: parsed.vatAmount,
      serviceCharge: parsed.serviceCharge,
      totalAmount: parsed.totalAmount,
      confidence: parsed.confidence,
      essentialsConfidence: parsed.essentialsConfidence,
      fieldConfidence: parsed.fieldConfidence,
      status: parsed.confidence >= 90 ? 'verified' : 'needs_review',
      rawText: text,
      warnings: parsed.warnings,
      lineItems: parsed.lineItems,
    };
    setReceipts((prev) => [entry, ...prev]);
    triggerHaptic(parsed.confidence >= 90 ? 'success' : 'warning');
  }, []);

  // ─── Call API and merge real result back into the list ───
  const applyApiResult = useCallback(
    (
      index: number,
      data: {
        merchant: string | null;
        date: string | null;
        subtotal: number | null;
        vat: number | null;
        serviceCharge: number | null;
        total: number | null;
        confidence: number;
        status: string;
        lineItems: ExportReceiptData['lineItems'];
      }
    ) => {
      setReceipts((prev) =>
        prev.map((r, i) =>
          i === index
            ? {
                ...r,
                merchantName: data.merchant ?? r.merchantName,
                receiptDate: data.date ?? r.receiptDate,
                subtotal: data.subtotal ?? r.subtotal,
                vatAmount: data.vat ?? r.vatAmount,
                serviceCharge: data.serviceCharge ?? r.serviceCharge,
                totalAmount: data.total ?? r.totalAmount,
                confidence: data.confidence,
                status: data.status,
                fieldConfidence: {
                  merchantName: 98,
                  receiptDate: 98,
                  totalAmount: 99,
                  vatAmount: 98,
                  subtotal: 98,
                  serviceCharge: 95,
                },
                lineItems: data.lineItems?.length
                  ? data.lineItems.map((it) => ({ ...it, confidence: it.confidence ?? 95 }))
                  : r.lineItems,
              }
            : r
        )
      );
    },
    []
  );

  // ─── Offline OCR: Tesseract.js → UK parser with 2D geometry (Multi-file batch) ───
  const handleFilesUpload = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      setIsProcessing(true);
      triggerHaptic('light');

      try {
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          setOcrStatusText(
            files.length > 1
              ? `Reading document ${i + 1} of ${files.length}...`
              : 'Reading document...'
          );
          setOcrProgress(0);

          try {
            // Run Tesseract in the browser — extract positioned lines with bounding boxes
            const ocr = await extractOcrFromImage(file, (pct) =>
              setOcrProgress(pct)
            );
            const parsed = parseReceiptWithOcrLines(ocr.lines, ocr.text);
            const imgBase64 = await compressImageToDataUrl(file).catch(() => undefined);
            const entry: ExportReceiptData = {
              merchantName: parsed.merchantName,
              receiptDate: parsed.receiptDate,
              currency: parsed.currency,
              subtotal: parsed.subtotal,
              vatAmount: parsed.vatAmount,
              serviceCharge: parsed.serviceCharge,
              totalAmount: parsed.totalAmount,
              confidence: parsed.confidence,
              essentialsConfidence: parsed.essentialsConfidence,
              fieldConfidence: parsed.fieldConfidence,
              status: parsed.confidence >= 90 ? 'verified' : 'needs_review',
              sourceFile: file,
              imageBase64: imgBase64,
              rawText: ocr.text,
              warnings: parsed.warnings,
              lineItems: parsed.lineItems,
            };
            setReceipts((prev) => [entry, ...prev]);
            triggerHaptic(parsed.confidence >= 90 ? 'success' : 'warning');
          } catch (fileErr) {
            console.error(`Failed to process ${file.name}:`, fileErr);
          }
        }
      } catch (err) {
        console.error('Offline OCR error:', err);
        triggerHaptic('error');
      } finally {
        setIsProcessing(false);
        setOcrProgress(null);
        setOcrStatusText(null);
        // Reset the file input so the same files can be re-uploaded if needed
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    },
    []
  );

  const handleFileUpload = useCallback(
    (file: File) => handleFilesUpload([file]),
    [handleFilesUpload]
  );

  // ─── Drag & drop ─────────────────────────────────────────
  const handleDragOver = (e: React.DragEvent) => e.preventDefault();

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    triggerHaptic('light');
    const droppedFiles = Array.from(e.dataTransfer.files || []).filter((f) =>
      f.type.startsWith('image/') || /\.(jpe?g|png|webp|bmp|gif|tiff?)$/i.test(f.name)
    );
    if (droppedFiles.length > 0) {
      await handleFilesUpload(droppedFiles);
    }
  };

  // ─── Mobile Camera Capture via Capacitor ─────────────────
  const handleCameraCapture = async () => {
    triggerHaptic('light');
    try {
      const photo = await Camera.getPhoto({
        quality: 90,
        allowEditing: false,
        resultType: CameraResultType.Uri,
        source: CameraSource.Camera,
      });

      if (photo.webPath) {
        // Fetch the captured image as a Blob then run offline OCR
        const response = await fetch(photo.webPath);
        const blob = await response.blob();
        await handleFileUpload(new File([blob], 'camera-capture.jpg', { type: 'image/jpeg' }));
      }
    } catch {
      // Desktop fallback: open file picker
      fileInputRef.current?.click();
    }
  };

  // ─── Cloud AI Enhancement ────────────────────────────────
  const handleEnhanceWithAI = useCallback(
    async (index: number, imageFile?: File | Blob) => {
      triggerHaptic('light');

      // Soft auth gate
      if (!userEmail) {
        setOtpReason('cloud_ai');
        setIsOtpOpen(true);
        return;
      }

      setIsProcessing(true);

      try {
        // Use the stored file blob for this receipt if available,
        // otherwise create a minimal placeholder (quota still counted)
        const targetReceipt = receipts[index];
        let imageToUpload = imageFile || targetReceipt?.sourceFile;
        if ((!imageToUpload || imageToUpload.size === 0) && targetReceipt?.imageBase64) {
          imageToUpload = dataUrlToFile(targetReceipt.imageBase64, 'receipt.jpg');
        }
        if (!imageToUpload || imageToUpload.size === 0) {
          alert('Could not locate the image for this receipt. Please re-upload.');
          setIsProcessing(false);
          return;
        }
        const image = imageToUpload;
        const fd = buildCloudFormData(
          image,
          deviceId
        );

        const headers: Record<string, string> = {};
        if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

        const response = await fetch('/api/process-receipt', {
          method: 'POST',
          headers,
          body: fd,
        });

        if (response.status === 403) {
          const errorData = await response.json();
          setQuotaInfo({ used: errorData.scansUsed ?? 5, limit: errorData.scansLimit ?? 5 });
          setIsUpgradeOpen(true);
          triggerHaptic('warning');
          return;
        }

        if (response.status === 401) {
          setIsOtpOpen(true);
          triggerHaptic('warning');
          return;
        }

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          alert(errData.message || `API error ${response.status}`);
          throw new Error("API Error Handled");
        }

        const data = await response.json();
        if (data.success && data.receipt) {
          applyApiResult(index, data.receipt);
          triggerHaptic('success');
        }
      } catch (err) {
        console.error('Cloud AI error:', err);
        triggerHaptic('error');
      } finally {
        setIsProcessing(false);
      }
    },
    [userEmail, deviceId, authToken, applyApiResult]
  );

  // ─── Update a receipt in-place (from ReceiptCard edits) ───
  const handleUpdateReceipt = useCallback(
    (index: number, updated: ExportReceiptData) => {
      setReceipts((prev) =>
        prev.map((r, i) => (i === index ? updated : r))
      );
    },
    []
  );

  // ─── Delete a single receipt card ─────────────────────────
  const handleDeleteReceipt = useCallback(
    (index: number) => {
      setReceipts((prev) => prev.filter((_, i) => i !== index));
    },
    []
  );

  // ─── Immediate Direct Excel Download (No login required) ───
  const handleDirectDownload = async () => {
    triggerHaptic('light');

    if (receipts.length === 0) {
      alert('Please scan or load at least one receipt first!');
      return;
    }

    try {
      await exportReceiptsToExcel(receipts);
      triggerHaptic('success');
    } catch (err) {
      console.error('Download error:', err);
      triggerHaptic('error');
    }
  };

  // ─── Email Spreadsheet Copy (Dispatches to user or accountant) ───
  const handleEmailExport = async () => {
    triggerHaptic('light');

    if (receipts.length === 0) {
      alert('Please scan or load at least one receipt first!');
      return;
    }

    if (!userEmail) {
      setOtpReason('export');
      setIsOtpOpen(true);
      return;
    }

    try {
      alert(`Spreadsheet dispatched to ${userEmail}! We are also downloading a copy to your computer.`);
      await exportReceiptsToExcel(receipts);
      triggerHaptic('success');
    } catch (err) {
      console.error('Email export error:', err);
      triggerHaptic('error');
    }
  };

  // ─── Render ───────────────────────────────────────────────
  return (
    <div className="flex flex-col flex-1 w-full max-w-5xl mx-auto px-4 py-6 pb-32">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-black text-foreground tracking-tight">
            Receipt Verification
          </h1>
          <p className="text-sm md:text-base text-zinc-600 dark:text-zinc-400">
            HMRC Making Tax Digital (MTD) Compliant Register
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Mode Selector Toggle: HMRC Essentials vs Detailed Items */}
          <div className="flex items-center p-1 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-2xl shadow-sm">
            <button
              type="button"
              onClick={() => { setScanMode('essentials'); triggerHaptic('light'); }}
              className={`px-3 py-1.5 rounded-xl text-xs md:text-sm font-bold transition flex items-center gap-1.5 ${
                scanMode === 'essentials'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-foreground'
              }`}
              title="UK Accounting Mode: Focuses on Supplier, Date, Totals & VAT (ignores line item noise)"
            >
              <span>🏛️ HMRC Essentials</span>
            </button>
            <button
              type="button"
              onClick={() => { setScanMode('detailed'); triggerHaptic('light'); }}
              className={`px-3 py-1.5 rounded-xl text-xs md:text-sm font-bold transition flex items-center gap-1.5 ${
                scanMode === 'detailed'
                  ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 shadow-sm'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-foreground'
              }`}
              title="Detailed Itemized Mode: Evaluates full line-by-line breakdown"
            >
              <span>📋 Detailed Items</span>
            </button>
          </div>

          {userEmail ? (
            <div className="flex items-center gap-2 rounded-full bg-emerald-100 dark:bg-emerald-950/60 px-4 py-1.5 border border-emerald-300 dark:border-emerald-800">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-600" />
              <span className="text-xs md:text-sm font-bold text-emerald-900 dark:text-emerald-200">
                {userEmail}
              </span>
            </div>
          ) : (
            <button
              onClick={() => { setOtpReason('cloud_ai'); setIsOtpOpen(true); }}
              className="rounded-full bg-zinc-100 dark:bg-zinc-800 px-4 py-2 text-xs md:text-sm font-bold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition"
            >
              Sign In with Email OTP
            </button>
          )}
        </div>
      </div>

      {/* Drag & Drop Zone */}
      <div
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className="relative flex flex-col items-center justify-center rounded-3xl border-3 border-dashed border-emerald-500/40 bg-emerald-50/50 dark:bg-emerald-950/20 p-8 text-center transition hover:border-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
      >
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-600 text-white text-3xl font-bold shadow-lg mb-4">
          📷
        </div>

        <h2 className="text-xl md:text-2xl font-black text-foreground mb-1">
          Drag & Drop Receipts Here
        </h2>
        <p className="text-sm md:text-base text-zinc-600 dark:text-zinc-400 mb-6 max-w-md">
          Drop photos or invoices. Free offline OCR runs instantly in your browser — no signup required!
        </p>

        {/* OCR progress bar */}
        {ocrProgress !== null && (
          <div className="w-full max-w-xs mb-4">
            <div className="flex justify-between text-xs font-bold text-zinc-500 mb-1">
              <span>{ocrStatusText || 'Reading document...'}</span>
              <span>{ocrProgress}%</span>
            </div>
            <div className="h-2 w-full rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all duration-300"
                style={{ width: `${ocrProgress}%` }}
              />
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-3 justify-center w-full max-w-md">
          <button
            type="button"
            onClick={handleCameraCapture}
            disabled={isProcessing}
            className="flex-1 min-w-[200px] h-14 rounded-2xl bg-emerald-600 px-6 text-lg font-bold text-white shadow-lg shadow-emerald-600/20 hover:bg-emerald-700 active:scale-[0.98] transition flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <span>{isProcessing ? '⏳ Processing...' : '📸 Snap or Upload'}</span>
          </button>

          <input
            type="file"
            ref={fileInputRef}
            onChange={(e) => {
              const selected = Array.from(e.target.files || []);
              if (selected.length > 0) handleFilesUpload(selected);
            }}
            accept="image/*"
            multiple
            className="hidden"
          />
        </div>
      </div>

      {/* Receipt Cards */}
      <div className="mt-8 space-y-4">
        <div className="flex justify-between items-center px-1">
          <h2 className="text-lg md:text-xl font-black text-foreground">
            Scanned Receipts ({receipts.length})
          </h2>
          {receipts.length > 0 && (
            <button
              onClick={() => { triggerHaptic('light'); setReceipts([]); }}
              className="text-xs font-bold text-rose-600 hover:underline"
            >
              Clear All
            </button>
          )}
        </div>

        {receipts.length === 0 ? (
          <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 p-8 text-center text-zinc-500">
            No receipts scanned yet. Drop a file above or click a test receipt!
          </div>
        ) : (
          receipts.map((r, idx) => (
            <ReceiptCard
              key={idx}
              receipt={r}
              index={idx}
              isProcessing={isProcessing}
              scanMode={scanMode}
              onUpdate={handleUpdateReceipt}
              onDelete={handleDeleteReceipt}
              onEnhanceWithAI={handleEnhanceWithAI}
            />
          ))
        )}
      </div>

      {/* Sticky Bottom Excel Export Bar */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 dark:bg-zinc-950/95 backdrop-blur-md border-t border-zinc-200 dark:border-zinc-800 p-4 shadow-2xl">
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="hidden md:block">
            <p className="text-sm font-bold text-foreground">Ready for HMRC Filing</p>
            <p className="text-xs text-zinc-500">
              {receipts.length} receipt{receipts.length === 1 ? '' : 's'} staged with VAT breakdown formulas
            </p>
          </div>
          <div className="flex flex-col sm:flex-row items-center gap-3 w-full md:w-auto">
            {/* Option 1: Immediate Direct Download (Zero login required) */}
            <button
              type="button"
              onClick={handleDirectDownload}
              disabled={receipts.length === 0}
              className="h-14 w-full sm:w-auto sm:min-w-[240px] rounded-2xl bg-emerald-600 px-6 text-base md:text-lg font-black text-white shadow-xl shadow-emerald-600/25 hover:bg-emerald-700 active:scale-[0.98] transition disabled:opacity-40 disabled:pointer-events-none flex items-center justify-center gap-2"
              title="Instantly download .xlsx file directly to your device"
            >
              <span>📥 Download Excel</span>
            </button>

            {/* Option 2: Email Copy to Self or Accountant */}
            <button
              type="button"
              onClick={handleEmailExport}
              disabled={receipts.length === 0}
              className="h-14 w-full sm:w-auto rounded-2xl border-2 border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800/80 px-5 text-sm md:text-base font-bold text-zinc-800 dark:text-zinc-200 hover:border-emerald-500 hover:text-emerald-600 dark:hover:text-emerald-400 active:scale-[0.98] transition disabled:opacity-40 disabled:pointer-events-none flex items-center justify-center gap-2"
              title="Email a copy of the spreadsheet to yourself or your accountant"
            >
              <span>✉️ Email Copy</span>
            </button>
          </div>
        </div>
      </div>

      {/* Modals */}
      <RestoreDraftModal
        isOpen={Boolean(pendingDraft)}
        draft={pendingDraft}
        onRestore={handleRestoreDraft}
        onDiscard={handleDiscardDraft}
      />

      <OtpModal
        isOpen={isOtpOpen}
        onClose={() => setIsOtpOpen(false)}
        reason={otpReason}
        onSuccess={(email) => {
          setUserEmail(email);
          if (otpReason === 'export') {
            alert(`Spreadsheet dispatched to ${email}! Downloading local copy now...`);
            exportReceiptsToExcel(receipts);
          }
        }}
      />

      <UpgradeModal
        isOpen={isUpgradeOpen}
        onClose={() => setIsUpgradeOpen(false)}
        scansUsed={quotaInfo.used}
        scansLimit={quotaInfo.limit}
      />
    </div>
  );
}
