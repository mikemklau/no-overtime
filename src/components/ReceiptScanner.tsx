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
import { ReceiptCard } from './ReceiptCard';
import { createClient } from '@/lib/supabase/client';

// ─────────────────────────────────────────────────────────────
// Sample UK receipts – kept for instant no-image demo testing
// ─────────────────────────────────────────────────────────────
const SAMPLE_RECEIPTS = [
  {
    name: 'Pret A Manger (Lunch + VAT)',
    text: `PRET A MANGER
124 TOTTENHAM COURT ROAD
LONDON W1T 5AS
VAT REG NO: GB 927 1374 20
--------------------------------
1 x Ham & Cheese Baguette    £4.95
1 x Flat White (Eat In)      £3.60
1 x Sparkling Water          £1.95
--------------------------------
SUB-TOTAL                    £8.75
VAT 20%                      £1.75
TOTAL                        £10.50
--------------------------------
DATE: 28/09/2026 13:14
AUTH CODE: 938210
AID: A0000000041010
CARD: ************4819
CARDHOLDER COPY`,
  },
  {
    name: 'Shell Fuel (Diesel + 20% VAT)',
    text: `SHELL UK OIL PRODUCTS LTD
COBHAM SERVICES M25
VAT NO: GB 235 7632 55
26/09/2026 08:45
--------------------------------
1 x V-Power Diesel (38.5L)  £61.60
1 x Screenwash Concentrate   £5.40
--------------------------------
SUBTOTAL                    £55.83
VAT 20%                     £11.17
TOTAL                       £67.00
--------------------------------
CHIP & PIN APPROVED
PLEASE RETAIN FOR YOUR RECORDS`,
  },
  {
    name: 'The Ivy Grill (Dinner + 12.5% Service)',
    text: `THE IVY COVENT GARDEN
1 HENRIETTA STREET, LONDON
DATE: 25/09/2026
--------------------------------
2 x Shepherd's Pie          £39.00
1 x Bottle Malbec           £36.00
2 x Espresso                 £7.00
--------------------------------
FOOD & BEV SUBTOTAL         £82.00
SERVICE CHARGE 12.5%        £10.25
VAT 20%                     £16.40
TOTAL                      £108.65
--------------------------------
TERMINAL 08412
THANK YOU FOR DINING WITH US`,
  },
];


// ─────────────────────────────────────────────────────────────
// Build a full API FormData payload for Cloud AI requests
// ─────────────────────────────────────────────────────────────
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
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);

  // Modal controls
  const [isOtpOpen, setIsOtpOpen] = useState(false);
  const [otpReason, setOtpReason] = useState<'cloud_ai' | 'export'>('cloud_ai');
  const [isUpgradeOpen, setIsUpgradeOpen] = useState(false);
  const [quotaInfo, setQuotaInfo] = useState({ used: 5, limit: 5 });

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ─── Initialise session & device info on mount ──────────
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
    }
    init();
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
      status: parsed.confidence >= 90 ? 'verified' : 'needs_review',
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
                lineItems: data.lineItems?.length ? data.lineItems : r.lineItems,
              }
            : r
        )
      );
    },
    []
  );

  // ─── Offline OCR: Tesseract.js → UK parser with 2D geometry ────────
  const handleFileUpload = useCallback(
    async (file: File) => {
      setIsProcessing(true);
      setOcrProgress(0);
      triggerHaptic('light');

      try {
        // Run Tesseract in the browser — extract positioned lines with bounding boxes
        const ocr = await extractOcrFromImage(file, (pct) =>
          setOcrProgress(pct)
        );
        const parsed = parseReceiptWithOcrLines(ocr.lines, ocr.text);
        const entry: ExportReceiptData = {
          merchantName: parsed.merchantName,
          receiptDate: parsed.receiptDate,
          currency: parsed.currency,
          subtotal: parsed.subtotal,
          vatAmount: parsed.vatAmount,
          serviceCharge: parsed.serviceCharge,
          totalAmount: parsed.totalAmount,
          confidence: parsed.confidence,
          status: parsed.confidence >= 90 ? 'verified' : 'needs_review',
          sourceFile: file,
          lineItems: parsed.lineItems,
        };
        setReceipts((prev) => [entry, ...prev]);
        triggerHaptic(parsed.confidence >= 90 ? 'success' : 'warning');
      } catch (err) {
        console.error('Offline OCR error:', err);
        triggerHaptic('error');
      } finally {
        setIsProcessing(false);
        setOcrProgress(null);
        // Reset the file input so the same file can be re-uploaded if needed
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    },
    []
  );

  // ─── Drag & drop ─────────────────────────────────────────
  const handleDragOver = (e: React.DragEvent) => e.preventDefault();

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    triggerHaptic('light');
    const file = e.dataTransfer.files?.[0];
    if (file) await handleFileUpload(file);
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
        const image = imageFile ?? new Blob([''], { type: 'image/jpeg' });
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
          throw new Error(`API error ${response.status}`);
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

  // ─── Excel Export ─────────────────────────────────────────
  const handleExport = async () => {
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
      await exportReceiptsToExcel(receipts);
      triggerHaptic('success');
    } catch (err) {
      console.error('Export error:', err);
      triggerHaptic('error');
    }
  };

  // ─── Render ───────────────────────────────────────────────
  return (
    <div className="flex flex-col flex-1 w-full max-w-4xl mx-auto px-4 py-6 pb-32">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-black text-foreground tracking-tight">
            Receipt Verification
          </h1>
          <p className="text-sm md:text-base text-zinc-600 dark:text-zinc-400">
            HMRC Making Tax Digital (MTD) Compliant Register
          </p>
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
              <span>Reading document...</span>
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
              if (e.target.files?.[0]) handleFileUpload(e.target.files[0]);
            }}
            accept="image/*"
            className="hidden"
          />
        </div>

        {/* Sample receipts for demo testing */}
        <div className="mt-6 flex flex-col items-center">
          <span className="text-xs font-bold uppercase tracking-wider text-zinc-500 mb-2">
            Or try instant UK test receipts:
          </span>
          <div className="flex flex-wrap gap-2 justify-center">
            {SAMPLE_RECEIPTS.map((sample, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => { triggerHaptic('light'); processText(sample.text); }}
                className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3.5 py-2 text-xs font-bold text-zinc-700 dark:text-zinc-300 hover:border-emerald-500 hover:text-emerald-600 dark:hover:text-emerald-400 transition"
              >
                + {sample.name}
              </button>
            ))}
          </div>
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
              onUpdate={handleUpdateReceipt}
              onDelete={handleDeleteReceipt}
              onEnhanceWithAI={handleEnhanceWithAI}
            />
          ))
        )}
      </div>

      {/* Sticky Bottom Excel Export Bar */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 dark:bg-zinc-950/95 backdrop-blur-md border-t border-zinc-200 dark:border-zinc-800 p-4 shadow-2xl">
        <div className="max-w-4xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="hidden md:block">
            <p className="text-sm font-bold text-foreground">Ready for HMRC Filing</p>
            <p className="text-xs text-zinc-500">
              {receipts.length} receipt{receipts.length === 1 ? '' : 's'} staged with VAT breakdown formulas
            </p>
          </div>
          <button
            type="button"
            onClick={handleExport}
            disabled={receipts.length === 0}
            className="h-14 w-full md:w-auto md:min-w-[320px] rounded-2xl bg-emerald-600 px-8 text-lg font-black text-white shadow-xl shadow-emerald-600/25 hover:bg-emerald-700 active:scale-[0.98] transition disabled:opacity-40 disabled:pointer-events-none flex items-center justify-center gap-3"
          >
            <span>📥 Download Excel Spreadsheet</span>
          </button>
        </div>
      </div>

      {/* Modals */}
      <OtpModal
        isOpen={isOtpOpen}
        onClose={() => setIsOtpOpen(false)}
        reason={otpReason}
        onSuccess={(email) => {
          setUserEmail(email);
          if (otpReason === 'export') exportReceiptsToExcel(receipts);
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
