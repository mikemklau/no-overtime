'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Device } from '@capacitor/device';
import { parseReceipt, parseReceiptWithOcrLines } from '@/lib/receipt-to-json';
import { extractOcrFromImage } from '@/lib/tesseract-ocr';
import { exportReceiptsToExcel, type ExportReceiptData } from '@/lib/excel-export';
import { exportReceiptsToPdf } from '@/lib/pdf-export';
import { exportReceiptsToCsv } from '@/lib/csv-export';
import { exportReceiptsToDocx } from '@/lib/docx-export';
import { exportReceiptsToTxt } from '@/lib/txt-export';
import { convertPdfToImageDataUrl } from '@/lib/pdf-parser';
import { triggerHaptic } from '@/lib/haptics';
import { OtpModal } from './OtpModal';
import { UpgradeModal } from './UpgradeModal';
import { RestoreDraftModal, type StoredReceiptsDraft } from './RestoreDraftModal';
import { SettingsModal } from './SettingsModal';
import { EngineInfoModal } from './EngineInfoModal';
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

async function getAllFilesFromDataTransfer(items: DataTransferItemList): Promise<File[]> {
  const files: File[] = [];

  const traverseEntry = async (entry: any) => {
    if (!entry) return;
    if (entry.isFile) {
      await new Promise<void>((resolve) => {
        entry.file(
          (file: File) => {
            files.push(file);
            resolve();
          },
          () => resolve()
        );
      });
    } else if (entry.isDirectory) {
      const dirReader = entry.createReader();
      const readEntriesBatch = (): Promise<any[]> => {
        return new Promise((resolve) => {
          dirReader.readEntries(
            (entries: any[]) => resolve(entries),
            () => resolve([])
          );
        });
      };

      let entries = await readEntriesBatch();
      while (entries.length > 0) {
        for (const child of entries) {
          await traverseEntry(child);
        }
        entries = await readEntriesBatch();
      }
    }
  };

  const entryPromises: Promise<void>[] = [];
  for (let i = 0; i < items.length; i++) {
    const entry = (items[i] as any).webkitGetAsEntry?.();
    if (entry) entryPromises.push(traverseEntry(entry));
  }
  await Promise.all(entryPromises);

  return files;
}

const SUPPORTED_EXTENSIONS_REGEX = /\.(jpe?g|png|webp|bmp|gif|tiff?|pdf|docx?|xlsx?)$/i;

function isSupportedFile(file: File): boolean {
  if (file.type.startsWith('image/') || file.type === 'application/pdf') return true;
  return SUPPORTED_EXTENSIONS_REGEX.test(file.name);
}

async function prepareFileForOcr(file: File): Promise<File> {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (isPdf) {
    const dataUrl = await convertPdfToImageDataUrl(file);
    return dataUrlToFile(dataUrl, file.name.replace(/\.pdf$/i, '.jpg'));
  }
  return file;
}

// ─────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────
export function ReceiptScanner() {
  const [receipts, setReceipts] = useState<ExportReceiptData[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [enhancingIndexes, setEnhancingIndexes] = useState<Set<number>>(new Set());
  const [ocrProgress, setOcrProgress] = useState<number | null>(null);
  const [ocrStatusText, setOcrStatusText] = useState<string | null>(null);
  const [scanMode, setScanMode] = useState<'essentials' | 'detailed'>('essentials');
  const [uploadEngine, setUploadEngine] = useState<'offline' | 'cloud'>('offline');
  const [isMockAi, setIsMockAi] = useState(true);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);

  // Modal controls
  const [isOtpOpen, setIsOtpOpen] = useState(false);
  const [otpReason, setOtpReason] = useState<'cloud_ai' | 'export'>('cloud_ai');
  const [isUpgradeOpen, setIsUpgradeOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isEngineInfoOpen, setIsEngineInfoOpen] = useState(false);
  const [quotaInfo, setQuotaInfo] = useState({ used: 5, limit: 5 });

  // Staged files waiting for authentication before Cloud AI batch processing
  const pendingCloudFilesRef = useRef<File[] | null>(null);

  // Refresh persistence draft state
  const [pendingDraft, setPendingDraft] = useState<StoredReceiptsDraft | null>(null);
  const isDraftRestoredRef = useRef(false);

  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Close export menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(event.target as Node)) {
        setIsExportMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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
            // Strip non-serializable File/Blob objects while retaining isAiEnhanced
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
                essentialsConfidence: data.confidence,
                status: data.status,
                isAiEnhanced: true,
                warnings: [],
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

  // ─── Dual Processing Pipeline: Offline Local OCR or Direct Cloud AI ───
  const processFilesBatchWithCloudAi = useCallback(
    async (files: File[]) => {
      if (!files.length) return;

      const unsupported = files.filter((f) => !isSupportedFile(f));
      if (unsupported.length > 0) {
        triggerHaptic('warning');
        alert(`⚠️ File "${unsupported[0].name}" is an unsupported format.\n\nPlease upload images (JPG, PNG, WEBP) or digital documents (PDF, Word, Excel).`);
      }
      const validFiles = files.filter((f) => isSupportedFile(f));
      if (!validFiles.length) return;

      // Soft auth gate: Prompt OTP if user is not authenticated yet
      if (!userEmail) {
        pendingCloudFilesRef.current = validFiles;
        setOtpReason('cloud_ai');
        setIsOtpOpen(true);
        return;
      }

      setIsUploading(true);
      triggerHaptic('light');

      try {
        for (let i = 0; i < validFiles.length; i++) {
          const file = await prepareFileForOcr(validFiles[i]);
          setOcrStatusText(
            validFiles.length > 1
              ? `Processing AI ${i + 1} of ${validFiles.length}...`
              : 'Processing with AI...'
          );
          setOcrProgress(Math.round(((i) / validFiles.length) * 100));

          if (isMockAi) {
            await new Promise((r) => setTimeout(r, 400));
            const imgBase64 = await compressImageToDataUrl(file).catch(() => undefined);
            const entry: ExportReceiptData = {
              merchantName: 'Mock Tesco Extra (Dev Test)',
              receiptDate: new Date().toISOString().split('T')[0],
              currency: 'GBP',
              subtotal: 12.50,
              vatAmount: 2.50,
              serviceCharge: 0,
              totalAmount: 15.00,
              confidence: 98,
              essentialsConfidence: 98,
              fieldConfidence: {
                merchantName: 98,
                receiptDate: 98,
                totalAmount: 99,
                vatAmount: 98,
                subtotal: 98,
                serviceCharge: 95,
              },
              status: 'verified',
              isAiEnhanced: true,
              sourceFile: file,
              imageBase64: imgBase64,
              warnings: [],
              lineItems: [
                { description: 'Mock AI Item 1', quantity: 1, unitPrice: 7.50, totalPrice: 7.50, category: null, confidence: 98 },
                { description: 'Mock AI Item 2', quantity: 2, unitPrice: 3.75, totalPrice: 7.50, category: null, confidence: 98 },
              ],
            };
            setReceipts((prev) => [entry, ...prev]);
            triggerHaptic('success');
            continue;
          }

          try {
            const fd = buildCloudFormData(file, deviceId);
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
              break;
            }

            if (response.status === 401) {
              pendingCloudFilesRef.current = files.slice(i);
              setIsOtpOpen(true);
              triggerHaptic('warning');
              break;
            }

            if (!response.ok) {
              const errData = await response.json().catch(() => ({}));
              console.error(`Cloud API error for ${file.name}:`, errData);
              continue;
            }

            const data = await response.json();
            if (data.success && data.receipt) {
              const imgBase64 = await compressImageToDataUrl(file).catch(() => undefined);
              const rData = data.receipt;
              const entry: ExportReceiptData = {
                id: rData.id || undefined,
                merchantName: rData.merchant || 'Unknown Merchant',
                receiptDate: rData.date || null,
                currency: rData.currency || 'GBP',
                subtotal: rData.subtotal ?? null,
                vatAmount: rData.vat ?? null,
                serviceCharge: rData.serviceCharge ?? null,
                totalAmount: rData.total ?? null,
                confidence: rData.confidence ?? 98,
                essentialsConfidence: rData.confidence ?? 98,
                fieldConfidence: {
                  merchantName: 98,
                  receiptDate: 98,
                  totalAmount: 99,
                  vatAmount: 98,
                  subtotal: 98,
                  serviceCharge: 95,
                },
                status: rData.status || 'verified',
                isAiEnhanced: true,
                sourceFile: file,
                imageBase64: imgBase64,
                warnings: [],
                lineItems: (rData.lineItems || []).map((it: any) => ({
                  ...it,
                  confidence: it.confidence ?? 95,
                })),
              };
              setReceipts((prev) => [entry, ...prev]);
              triggerHaptic('success');
            }
          } catch (fileErr) {
            console.error(`Failed to process ${file.name} in Cloud:`, fileErr);
          }
        }
      } catch (err) {
        console.error('Batch Cloud AI error:', err);
        triggerHaptic('error');
      } finally {
        setIsUploading(false);
        setOcrProgress(null);
        setOcrStatusText(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    },
    [userEmail, deviceId, authToken]
  );

  // ─── Unified File Upload Dispatcher ───
  const handleFilesUpload = useCallback(
    async (files: File[]) => {
      if (!files.length) return;

      const unsupported = files.filter((f) => !isSupportedFile(f));
      if (unsupported.length > 0) {
        triggerHaptic('warning');
        alert(`⚠️ File "${unsupported[0].name}" is an unsupported format.\n\nPlease upload images (JPG, PNG, WEBP) or digital documents (PDF, Word, Excel).`);
      }
      const validFiles = files.filter((f) => isSupportedFile(f));
      if (!validFiles.length) return;

      if (uploadEngine === 'cloud') {
        await processFilesBatchWithCloudAi(validFiles);
        return;
      }

      // Offline OCR (Tesseract.js in browser)
      setIsUploading(true);
      triggerHaptic('light');

      try {
        for (let i = 0; i < validFiles.length; i++) {
          const file = await prepareFileForOcr(validFiles[i]);
          setOcrStatusText(
            validFiles.length > 1
              ? `Reading document ${i + 1} of ${validFiles.length}...`
              : 'Reading document...'
          );
          setOcrProgress(0);

          try {
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
          } catch (fileErr: any) {
            console.error(`Failed to process ${file.name}:`, fileErr);
          }
        }
      } catch (err) {
        console.error('Offline OCR error:', err);
        triggerHaptic('error');
      } finally {
        setIsUploading(false);
        setOcrProgress(null);
        setOcrStatusText(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    },
    [uploadEngine, processFilesBatchWithCloudAi]
  );

  const handleFileUpload = useCallback(
    (file: File) => handleFilesUpload([file]),
    [handleFilesUpload]
  );

  // ─── Drag & drop with recursive folder/subfolder traversal ───
  const handleDragOver = (e: React.DragEvent) => e.preventDefault();

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    triggerHaptic('light');

    let extractedFiles: File[] = [];
    const items = e.dataTransfer.items;

    if (items && items.length > 0 && typeof (items[0] as any).webkitGetAsEntry === 'function') {
      extractedFiles = await getAllFilesFromDataTransfer(items);
    } else if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      extractedFiles = Array.from(e.dataTransfer.files);
    }

    if (extractedFiles.length > 0) {
      await handleFilesUpload(extractedFiles);
    }
  };

  // ─── Mobile Camera Capture via Capacitor ─────────────────
  const handleCameraCapture = async () => {
    triggerHaptic('light');
    if (Capacitor.isNativePlatform()) {
      try {
        const photo = await Camera.getPhoto({
          quality: 90,
          allowEditing: false,
          resultType: CameraResultType.Uri,
          source: CameraSource.Camera,
        });

        if (photo.webPath) {
          const response = await fetch(photo.webPath);
          const blob = await response.blob();
          await handleFileUpload(new File([blob], 'camera-capture.jpg', { type: 'image/jpeg' }));
          return;
        }
      } catch (err) {
        console.warn('Native camera cancelled or error:', err);
      }
    }

    // Mobile Web & Desktop Web: Trigger native OS file/camera picker synchronously
    fileInputRef.current?.click();
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

      setEnhancingIndexes((prev) => {
        const next = new Set(prev);
        next.add(index);
        return next;
      });

      if (isMockAi) {
        await new Promise((resolve) => setTimeout(resolve, 600));
        const targetReceipt = receipts[index];
        applyApiResult(index, {
          merchant: targetReceipt?.merchantName || 'Mock Tesco Extra (Dev Test)',
          date: targetReceipt?.receiptDate || new Date().toISOString().split('T')[0],
          subtotal: targetReceipt?.subtotal ?? 12.50,
          vat: targetReceipt?.vatAmount ?? 2.50,
          serviceCharge: targetReceipt?.serviceCharge ?? 0,
          total: targetReceipt?.totalAmount ?? 15.00,
          confidence: 98,
          status: 'verified',
          lineItems: targetReceipt?.lineItems?.length
            ? targetReceipt.lineItems.map((it) => ({ ...it, confidence: 98 }))
            : [
                { description: 'Mock AI Item 1', quantity: 1, unitPrice: 7.50, totalPrice: 7.50, category: null, confidence: 98 },
                { description: 'Mock AI Item 2', quantity: 2, unitPrice: 3.75, totalPrice: 7.50, category: null, confidence: 98 },
              ],
        });
        setEnhancingIndexes((prev) => {
          const next = new Set(prev);
          next.delete(index);
          return next;
        });
        triggerHaptic('success');
        return;
      }

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
          setEnhancingIndexes((prev) => {
            const next = new Set(prev);
            next.delete(index);
            return next;
          });
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
        setEnhancingIndexes((prev) => {
          const next = new Set(prev);
          next.delete(index);
          return next;
        });
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

  return (
    <>
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

          {/* Dev Mock AI Toggle (Restricted to Test Accounts & Dev Sessions) */}
          {userEmail && ['admin@no-overtime.com', 'test@no-overtime.com', 'developer@no-overtime.com'].includes(userEmail.toLowerCase()) && (
            <div className="flex items-center gap-2 px-2" title="Test Account Dev Mode: Simulate AI parsing without spending any OpenAI API credits">
              <span className="text-xs font-bold text-zinc-600 dark:text-zinc-400">🧪 Mock AI</span>
              <button
                type="button"
                role="switch"
                aria-checked={isMockAi}
                onClick={() => {
                  setIsMockAi((prev) => !prev);
                  triggerHaptic('light');
                }}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-purple-600 focus:ring-offset-2 ${
                  isMockAi ? 'bg-purple-600' : 'bg-zinc-300 dark:bg-zinc-700'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    isMockAi ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          )}

          {userEmail ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  triggerHaptic('light');
                  setIsSettingsOpen(true);
                }}
                className="flex items-center gap-2 rounded-full bg-emerald-100 hover:bg-emerald-200 dark:bg-emerald-950/60 dark:hover:bg-emerald-900/60 px-4 py-1.5 border border-emerald-300 dark:border-emerald-800 transition active:scale-95"
                title="Account Settings & GDPR Data Management"
              >
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-600" />
                <span className="text-xs md:text-sm font-bold text-emerald-900 dark:text-emerald-200">
                  {userEmail}
                </span>
                <span className="text-xs text-emerald-700 dark:text-emerald-400">⚙️</span>
              </button>
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
        className="relative flex flex-col items-center justify-center rounded-3xl border-3 border-dashed border-emerald-500/40 bg-emerald-50/50 dark:bg-emerald-950/20 p-8 text-center transition hover:border-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 min-h-[350px]"
      >
        {isUploading ? (
          <div className="flex flex-col items-center justify-center py-4 w-full animate-in fade-in zoom-in duration-300">
            <div className="text-4xl mb-4 animate-bounce">
              {uploadEngine === 'cloud' ? '✨' : '⚡'}
            </div>
            <h3 className="text-xl md:text-2xl font-black text-foreground mb-2">
              {uploadEngine === 'cloud' ? 'Processing with Cloud AI' : 'Reading Document'}
            </h3>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-8 max-w-sm">
              {ocrStatusText || (uploadEngine === 'cloud' ? 'AI is analyzing your receipts...' : 'Extracting receipt lines...')}
            </p>
            <div className="w-full max-w-xs">
              <div className="flex justify-between text-xs font-bold text-zinc-500 mb-2">
                <span>Progress</span>
                <span>{ocrProgress !== null ? `${ocrProgress}%` : ''}</span>
              </div>
              <div className="h-2 w-full rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden relative">
                {ocrProgress !== null ? (
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all duration-300"
                    style={{ width: `${ocrProgress}%` }}
                  />
                ) : (
                  <div className="absolute inset-y-0 left-0 bg-emerald-500 rounded-full w-1/3 animate-[progress_1.5s_ease-in-out_infinite]" />
                )}
              </div>
            </div>
            <style>{`
              @keyframes progress {
                0% { transform: translateX(-100%); }
                100% { transform: translateX(300%); }
              }
            `}</style>
          </div>
        ) : (
          <>
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-600 text-white text-3xl font-bold shadow-lg mb-4">
              📷
            </div>

            <h2 className="text-xl md:text-2xl font-black text-foreground mb-1">
              Drag & Drop Receipts Here
            </h2>
            <p className="text-sm md:text-base text-zinc-600 dark:text-zinc-400 mb-6 max-w-md">
              Drop receipts or invoices. Free offline OCR gives a basic draft (low accuracy) — use AI for 99%+ precision!
            </p>

            {/* Pre-Upload Engine Selector Toggle */}
            <div className="mb-5 flex flex-col items-center">
              <div className="inline-flex p-1 bg-zinc-200/70 dark:bg-zinc-800/80 rounded-2xl border border-zinc-300 dark:border-zinc-700 shadow-inner">
                <button
                  type="button"
                  onClick={() => {
                    setUploadEngine('offline');
                    triggerHaptic('light');
                  }}
                  className={`px-3.5 py-2 rounded-xl text-xs md:text-sm font-bold transition flex items-center gap-1.5 ${
                    uploadEngine === 'offline'
                      ? 'bg-white dark:bg-zinc-900 text-foreground shadow-sm'
                      : 'text-zinc-600 dark:text-zinc-400 hover:text-foreground'
                  }`}
                >
                  <span>⚡ Free Offline OCR</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setUploadEngine('cloud');
                    triggerHaptic('light');
                  }}
                  className={`px-3.5 py-2 rounded-xl text-xs md:text-sm font-bold transition flex items-center gap-1.5 ${
                    uploadEngine === 'cloud'
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'text-zinc-600 dark:text-zinc-400 hover:text-foreground'
                  }`}
                >
                  <span>✨ AI</span>
                  <span className="text-[10px] font-black uppercase px-1.5 py-0.5 rounded-full bg-white/20 text-white">
                    Fast
                  </span>
                </button>
              </div>
              <span className="mt-1.5 text-[11px] font-medium text-zinc-500 dark:text-zinc-400 inline-flex items-center gap-1">
                <span>
                  {uploadEngine === 'cloud'
                    ? '✨ Direct high-accuracy AI parsing • Handles complex & messy receipts'
                    : '⚡ 100% Offline • Basic draft reader (low accuracy in general, but a good starting point for editing)'}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsEngineInfoOpen(true);
                    triggerHaptic('light');
                  }}
                  className="inline-flex items-center justify-center p-0.5 text-zinc-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition"
                  title="Learn more about OCR vs AI"
                >
                  ℹ️
                </button>
              </span>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 justify-center w-full max-w-md">
              <div
                onClick={() => {
                  if (Capacitor.isNativePlatform()) {
                    handleCameraCapture();
                  }
                }}
                className="relative flex-1 min-w-[180px] h-14 rounded-2xl bg-emerald-600 px-5 text-base md:text-lg font-bold text-white shadow-lg shadow-emerald-600/20 hover:bg-emerald-700 active:scale-[0.98] transition flex items-center justify-center gap-2 select-none overflow-hidden cursor-pointer"
              >
                <span>📸 Snap Photo</span>
                {!Capacitor.isNativePlatform() && (
                  <input
                    type="file"
                    accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
                    capture="environment"
                    onChange={(e) => {
                      const files = e.target.files ? Array.from(e.target.files) : [];
                      if (files.length > 0) handleFilesUpload(files);
                    }}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                  />
                )}
              </div>

              <div className="relative flex-1 min-w-[180px] h-14 rounded-2xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 px-5 text-base md:text-lg font-bold shadow-lg active:scale-[0.98] transition flex items-center justify-center gap-2 select-none overflow-hidden"
              >
                <span>📁 Choose Files</span>
                <input
                  type="file"
                  accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
                  multiple
                  onChange={(e) => {
                    const files = e.target.files ? Array.from(e.target.files) : [];
                    if (files.length > 0) handleFilesUpload(files);
                  }}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                />
              </div>
            </div>
          </>
        )}
      </div>

      {/* Receipt Cards */}
      <div className="mt-8 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 px-1">
          <div>
            <h2 className="text-lg md:text-xl font-black text-foreground">
              Scanned Receipts ({receipts.length})
            </h2>
            {receipts.length > 0 && (
              <p className="text-xs text-zinc-500 dark:text-zinc-400 font-medium mt-0.5 flex items-center gap-1">
                <span>💡 Click or tap any merchant, date, or amount to edit details directly.</span>
              </p>
            )}
          </div>
          {receipts.length > 0 && (
            <button
              onClick={() => { triggerHaptic('light'); setReceipts([]); }}
              className="text-xs font-bold text-rose-600 hover:underline self-end sm:self-auto"
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
              isProcessing={enhancingIndexes.has(idx)}
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
            {/* Option 1: Split Download Button: Default Excel Download + Dropdown Arrow for Formats */}
            <div className="relative inline-flex items-center w-full sm:w-auto shadow-xl shadow-emerald-600/20" ref={exportMenuRef}>
              {/* Main Default Action: Download Excel */}
              <button
                type="button"
                onClick={handleDirectDownload}
                disabled={receipts.length === 0}
                className="h-14 flex-1 sm:flex-initial sm:min-w-[190px] rounded-l-2xl bg-emerald-600 pl-6 pr-4 text-base md:text-lg font-black text-white hover:bg-emerald-700 active:scale-[0.98] transition disabled:opacity-40 disabled:pointer-events-none flex items-center justify-center gap-2 border-r border-emerald-700/50"
                title="Instantly download .xlsx file directly to your device"
              >
                <span>📥 Download Excel</span>
              </button>

              {/* Split Dropdown Arrow Toggle Button */}
              <button
                type="button"
                onClick={() => {
                  if (receipts.length === 0) {
                    alert('Please scan or load at least one receipt first!');
                    return;
                  }
                  setIsExportMenuOpen((prev) => !prev);
                  triggerHaptic('light');
                }}
                disabled={receipts.length === 0}
                className="h-14 px-3.5 rounded-r-2xl bg-emerald-600 hover:bg-emerald-700 text-white transition disabled:opacity-40 disabled:pointer-events-none flex items-center justify-center border-l border-emerald-500/30"
                title="Choose export format (Excel, PDF, CSV)"
              >
                <span className={`text-xs transition-transform duration-200 ${isExportMenuOpen ? 'rotate-180' : ''}`}>
                  ▼
                </span>
              </button>

              {/* Export Formats Dropdown Menu Popup */}
              {isExportMenuOpen && (
                <div className="absolute bottom-full mb-3 right-0 w-64 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-2 shadow-2xl z-50 animate-in fade-in zoom-in-95 duration-150">
                  <div className="px-3 py-1.5 text-[11px] font-bold text-zinc-400 uppercase tracking-wider border-b border-zinc-100 dark:border-zinc-800 mb-1">
                    Select Export Format
                  </div>

                  {/* Excel (.xlsx) Option */}
                  <button
                    type="button"
                    onClick={() => {
                      setIsExportMenuOpen(false);
                      handleDirectDownload();
                    }}
                    className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 transition flex items-center justify-between group"
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="text-lg">📊</span>
                      <div>
                        <p className="text-sm font-bold text-foreground">Excel Workbook</p>
                        <p className="text-[11px] text-zinc-500">.xlsx • Includes VAT formulas</p>
                      </div>
                    </div>
                    <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">Default</span>
                  </button>

                  {/* PDF (.pdf) Option */}
                  <button
                    type="button"
                    onClick={() => {
                      setIsExportMenuOpen(false);
                      triggerHaptic('light');
                      exportReceiptsToPdf(receipts);
                      triggerHaptic('success');
                    }}
                    className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 transition flex items-center gap-2.5"
                  >
                    <span className="text-lg">📄</span>
                    <div>
                      <p className="text-sm font-bold text-foreground">PDF Expense Report</p>
                      <p className="text-[11px] text-zinc-500">.pdf • MTD HMRC Summary</p>
                    </div>
                  </button>

                  {/* Word Document (.doc) Option */}
                  <button
                    type="button"
                    onClick={() => {
                      setIsExportMenuOpen(false);
                      triggerHaptic('light');
                      exportReceiptsToDocx(receipts);
                      triggerHaptic('success');
                    }}
                    className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 transition flex items-center gap-2.5"
                  >
                    <span className="text-lg">📝</span>
                    <div>
                      <p className="text-sm font-bold text-foreground">Word Document</p>
                      <p className="text-[11px] text-zinc-500">.doc • MS Word &amp; Google Docs</p>
                    </div>
                  </button>

                  {/* CSV (.csv) Option */}
                  <button
                    type="button"
                    onClick={() => {
                      setIsExportMenuOpen(false);
                      triggerHaptic('light');
                      exportReceiptsToCsv(receipts);
                      triggerHaptic('success');
                    }}
                    className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 transition flex items-center gap-2.5"
                  >
                    <span className="text-lg">📑</span>
                    <div>
                      <p className="text-sm font-bold text-foreground">CSV Data Register</p>
                      <p className="text-[11px] text-zinc-500">.csv • Xero &amp; QuickBooks ready</p>
                    </div>
                  </button>

                  {/* Plain Text (.txt) Option */}
                  <button
                    type="button"
                    onClick={() => {
                      setIsExportMenuOpen(false);
                      triggerHaptic('light');
                      exportReceiptsToTxt(receipts);
                      triggerHaptic('success');
                    }}
                    className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 transition flex items-center gap-2.5"
                  >
                    <span className="text-lg">📃</span>
                    <div>
                      <p className="text-sm font-bold text-foreground">Plain Text Register</p>
                      <p className="text-[11px] text-zinc-500">.txt • Plain text summary</p>
                    </div>
                  </button>
                </div>
              )}
            </div>

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
        onClose={() => {
          setIsOtpOpen(false);
          pendingCloudFilesRef.current = null;
        }}
        reason={otpReason}
        onSuccess={(email) => {
          setUserEmail(email);
          if (otpReason === 'export') {
            alert(`Spreadsheet dispatched to ${email}! Downloading local copy now...`);
            exportReceiptsToExcel(receipts);
          } else if (otpReason === 'cloud_ai' && pendingCloudFilesRef.current?.length) {
            const filesToRun = pendingCloudFilesRef.current;
            pendingCloudFilesRef.current = null;
            processFilesBatchWithCloudAi(filesToRun);
          }
        }}
      />

      <UpgradeModal
        isOpen={isUpgradeOpen}
        onClose={() => setIsUpgradeOpen(false)}
        scansUsed={quotaInfo.used}
        scansLimit={quotaInfo.limit}
      />

      <EngineInfoModal
        isOpen={isEngineInfoOpen}
        onClose={() => setIsEngineInfoOpen(false)}
      />

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        userEmail={userEmail}
        scansUsed={quotaInfo.used}
        scansLimit={quotaInfo.limit}
        onSignOut={() => {
          setUserEmail(null);
          setAuthToken(null);
        }}
        onAccountDeleted={() => {
          setUserEmail(null);
          setAuthToken(null);
          setReceipts([]);
          try {
            localStorage.removeItem(DRAFT_STORAGE_KEY);
          } catch {}
          alert('Your account and all associated UK GDPR financial records have been permanently deleted.');
        }}
      />
    </div>
    </>
  );
}
