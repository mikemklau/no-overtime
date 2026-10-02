'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { ExportReceiptData } from '@/lib/excel-export';
import { triggerHaptic } from '@/lib/haptics';
import { checkReceiptMath } from '@/lib/receipt-to-json';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
interface ReceiptCardProps {
  receipt: ExportReceiptData;
  index: number;
  isProcessing: boolean;
  scanMode?: 'essentials' | 'detailed';
  confidenceMode?: 'percentage' | 'border';
  onUpdate: (index: number, updated: ExportReceiptData) => void;
  onDelete: (index: number) => void;
  onEnhanceWithAI: (index: number, imageFile?: File | Blob) => void;
}

type EditingField = null | 'merchantName' | 'receiptDate' | 'totalAmount' | 'vatAmount' | 'subtotal' | 'serviceCharge';

// ─────────────────────────────────────────────────────────────
// Confidence badge helper
// ─────────────────────────────────────────────────────────────
function getConfidenceBadge(
  confidence: number,
  userVerified: boolean,
  hasMathWarning: boolean,
  essentialsConfidence?: number
) {
  if (userVerified) {
    return {
      text: '✓ User Verified',
      score: 100,
      style:
        'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800',
      ringClass: 'ring-2 ring-emerald-500/60 dark:ring-emerald-500/50 shadow-lg shadow-emerald-500/10',
    };
  }

  const score = essentialsConfidence ?? confidence;

  if (score >= 90) {
    return {
      text: '✓ HMRC Ready',
      score,
      style:
        'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800',
      ringClass: 'ring-2 ring-emerald-500/60 dark:ring-emerald-500/50 shadow-lg shadow-emerald-500/10',
    };
  }
  if (score >= 70) {
    return {
      text: hasMathWarning ? '⚠️ Check Totals' : '⚠️ Review Details',
      score,
      style:
        'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800',
      ringClass: 'ring-2 ring-amber-500/70 dark:ring-amber-500/60 shadow-lg shadow-amber-500/10',
    };
  }
  return {
    text: '❌ Needs Attention',
    score,
    style:
      'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950 dark:text-rose-300 dark:border-rose-800',
    ringClass: 'ring-2 ring-rose-400/80 dark:ring-rose-500/60 shadow-lg shadow-rose-500/10',
  };
}

// ─────────────────────────────────────────────────────────────
// Discreet Confidence Color Helper (0% red -> 80% pale green -> 100% leaf green)
// ─────────────────────────────────────────────────────────────
function getConfidenceColorInfo(score: number, userVerified = false) {
  const effectiveScore = userVerified ? 100 : Math.min(100, Math.max(0, score));
  let hue: number;

  if (effectiveScore <= 80) {
    // 0 is red (0°), 80 is pale green (100°)
    hue = (effectiveScore / 80) * 100;
  } else {
    // 80 is 100°, 100 is leaf green (138°)
    hue = 100 + ((effectiveScore - 80) / 20) * 38;
  }

  const roundedHue = Math.round(hue);
  return {
    score: effectiveScore,
    vars: { '--c-conf': roundedHue } as React.CSSProperties,
    className: 'text-[hsl(var(--c-conf),82%,36%)] dark:text-[hsl(var(--c-conf),82%,54%)]',
  };
}

// ─────────────────────────────────────────────────────────────
// Editable Field Component (click-to-edit)
// ─────────────────────────────────────────────────────────────
function EditableField({
  value,
  displayValue,
  fieldName,
  editingField,
  onStartEdit,
  onCommit,
  inputType = 'text',
  className = '',
  inputClassName = '',
  prefix = '',
}: {
  value: string;
  displayValue?: string;
  fieldName: EditingField;
  editingField: EditingField;
  onStartEdit: (field: EditingField) => void;
  onCommit: (field: NonNullable<EditingField>, value: string) => void;
  inputType?: string;
  className?: string;
  inputClassName?: string;
  prefix?: string;
}) {
  const [draft, setDraft] = useState(value);
  const isEditing = editingField === fieldName;

  const handleStartEdit = () => {
    setDraft(value);
    onStartEdit(fieldName);
  };

  const handleCommit = () => {
    if (fieldName) onCommit(fieldName, draft);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleCommit();
    if (e.key === 'Escape') onStartEdit(null);
  };

  if (isEditing) {
    return (
      <input
        type={inputType}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={handleCommit}
        onKeyDown={handleKeyDown}
        autoFocus
        className={`bg-white dark:bg-zinc-800 border-2 border-emerald-500 rounded-lg px-2 py-1 outline-none font-bold ${inputClassName}`}
      />
    );
  }

  return (
    <span
      onClick={handleStartEdit}
      className={`cursor-pointer hover:bg-emerald-50 dark:hover:bg-emerald-950/30 rounded-lg px-1 -mx-1 transition group inline-block max-w-full truncate align-bottom ${className}`}
      title="Click to edit"
    >
      {prefix}{displayValue ?? value}
      <span className="opacity-0 group-hover:opacity-60 ml-1 text-xs">✏️</span>
    </span>
  );
}

// ─────────────────────────────────────────────────────────────
// Main Receipt Card Component
// ─────────────────────────────────────────────────────────────
export function ReceiptCard({
  receipt,
  index,
  isProcessing,
  scanMode = 'essentials',
  confidenceMode = 'percentage',
  onUpdate,
  onDelete,
  onEnhanceWithAI,
}: ReceiptCardProps) {
  const [localMode, setLocalMode] = useState<'essentials' | 'detailed' | null>(null);
  const activeMode = localMode ?? scanMode;
  const [userExpandedItems, setUserExpandedItems] = useState<boolean | null>(null);
  const isItemsVisible = userExpandedItems ?? (activeMode === 'detailed');

  // When global mode switches, reset overrides so items automatically hide/show accordingly
  useEffect(() => {
    setUserExpandedItems(null);
    setLocalMode(null);
  }, [scanMode]);

  const [editingField, setEditingField] = useState<EditingField>(null);
  const [editingLineItem, setEditingLineItem] = useState<{
    lineIdx: number;
    field: 'description' | 'quantity' | 'totalPrice';
  } | null>(null);
  const [lineItemDraft, setLineItemDraft] = useState('');

  // Original Document Viewer & Navigation state (Interactive Pan & Zoom)
  const [showOriginal, setShowOriginal] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);

  const dragStartRef = useRef<{ x: number; y: number; panX: number; panY: number }>({
    x: 0,
    y: 0,
    panX: 0,
    panY: 0,
  });
  const viewerContainerRef = useRef<HTMLDivElement>(null);

  // Reset zoom & pan to default centered view
  const resetView = useCallback(() => {
    setZoomLevel(1);
    setPan({ x: 0, y: 0 });
  }, []);

  // Mouse pan/drag handlers (supports left-click drag and middle-wheel click drag)
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0 && e.button !== 1) return;
    e.preventDefault();
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      panX: pan.x,
      panY: pan.y,
    };
  };

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging) return;
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      setPan({
        x: dragStartRef.current.panX + dx,
        y: dragStartRef.current.panY + dy,
      });
    },
    [isDragging]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  // Scroll wheel to zoom in/out smoothly without scrolling the webpage
  useEffect(() => {
    const container = viewerContainerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.15 : -0.15;
      setZoomLevel((prev) => {
        const next = Math.max(0.5, Math.min(4, Math.round((prev + delta) * 100) / 100));
        return next;
      });
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      container.removeEventListener('wheel', handleWheel);
    };
  }, [showOriginal, imageUrl]);

  const panRef = useRef(pan);
  panRef.current = pan;
  const zoomLevelRef = useRef(zoomLevel);
  zoomLevelRef.current = zoomLevel;

  const touchStateRef = useRef<{
    mode: 'none' | 'pan' | 'pinch';
    startX: number;
    startY: number;
    startPanX: number;
    startPanY: number;
    startDistance: number;
    startZoom: number;
    lastTapTime: number;
  }>({
    mode: 'none',
    startX: 0,
    startY: 0,
    startPanX: 0,
    startPanY: 0,
    startDistance: 0,
    startZoom: 1,
    lastTapTime: 0,
  });

  // Touch gesture handlers for mobile (Pinch-to-zoom & 1-finger pan & double-tap reset)
  useEffect(() => {
    const container = viewerContainerRef.current;
    if (!container) return;

    const getDistance = (t1: Touch, t2: Touch) =>
      Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        const now = Date.now();
        if (now - touchStateRef.current.lastTapTime < 300) {
          resetView();
          touchStateRef.current.lastTapTime = 0;
          return;
        }
        touchStateRef.current.lastTapTime = now;
        touchStateRef.current.mode = 'pan';
        touchStateRef.current.startX = e.touches[0].clientX;
        touchStateRef.current.startY = e.touches[0].clientY;
        touchStateRef.current.startPanX = panRef.current.x;
        touchStateRef.current.startPanY = panRef.current.y;
        setIsDragging(true);
      } else if (e.touches.length === 2) {
        touchStateRef.current.mode = 'pinch';
        touchStateRef.current.startDistance = getDistance(e.touches[0], e.touches[1]);
        touchStateRef.current.startZoom = zoomLevelRef.current;
        touchStateRef.current.startX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        touchStateRef.current.startY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        touchStateRef.current.startPanX = panRef.current.x;
        touchStateRef.current.startPanY = panRef.current.y;
        setIsDragging(true);
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (touchStateRef.current.mode === 'none') return;
      if (e.cancelable) {
        e.preventDefault();
      }

      if (touchStateRef.current.mode === 'pan' && e.touches.length === 1) {
        const dx = e.touches[0].clientX - touchStateRef.current.startX;
        const dy = e.touches[0].clientY - touchStateRef.current.startY;
        setPan({
          x: touchStateRef.current.startPanX + dx,
          y: touchStateRef.current.startPanY + dy,
        });
      } else if (touchStateRef.current.mode === 'pinch' && e.touches.length === 2) {
        const dist = getDistance(e.touches[0], e.touches[1]);
        if (touchStateRef.current.startDistance > 0) {
          const factor = dist / touchStateRef.current.startDistance;
          const nextZoom = Math.max(
            0.5,
            Math.min(4, Math.round(touchStateRef.current.startZoom * factor * 100) / 100)
          );
          setZoomLevel(nextZoom);

          const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
          const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
          const dx = midX - touchStateRef.current.startX;
          const dy = midY - touchStateRef.current.startY;
          setPan({
            x: touchStateRef.current.startPanX + dx,
            y: touchStateRef.current.startPanY + dy,
          });
        }
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (e.touches.length === 0) {
        touchStateRef.current.mode = 'none';
        setIsDragging(false);
      } else if (e.touches.length === 1) {
        touchStateRef.current.mode = 'pan';
        touchStateRef.current.startX = e.touches[0].clientX;
        touchStateRef.current.startY = e.touches[0].clientY;
        touchStateRef.current.startPanX = panRef.current.x;
        touchStateRef.current.startPanY = panRef.current.y;
      }
    };

    container.addEventListener('touchstart', handleTouchStart, { passive: false });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd, { passive: false });
    container.addEventListener('touchcancel', handleTouchEnd, { passive: false });

    return () => {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
      container.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, [showOriginal, imageUrl, resetView]);

  const r = receipt;
  const userVerified = r.status === 'user_verified';
  const mathValidation = checkReceiptMath(r);
  const mathWarning = mathValidation.hasMismatch ? mathValidation.message : r.warnings?.find((w) => w.code === 'totals_math_mismatch' || w.code === 'vat_exceeds_total')?.message;
  const badge = getConfidenceBadge(r.confidence, userVerified, !!mathWarning, r.essentialsConfidence);

  // ─── Field-Level Confidence Scores ──────────────────────────
  const merchantConf = userVerified
    ? 100
    : (r.fieldConfidence?.merchantName ?? (r.merchantName ? (r.essentialsConfidence ?? r.confidence) : 20));

  const dateConf = userVerified
    ? 100
    : (r.fieldConfidence?.receiptDate ?? (r.receiptDate ? (r.essentialsConfidence ?? r.confidence) : 15));

  const totalConf = userVerified
    ? 100
    : (r.fieldConfidence?.totalAmount ?? (r.totalAmount !== null ? (r.essentialsConfidence ?? r.confidence) : 30));

  const vatConf = userVerified
    ? 100
    : (r.fieldConfidence?.vatAmount ?? (r.vatAmount !== null ? (r.essentialsConfidence ?? r.confidence) : 50));

  const subtotalConf = userVerified
    ? 100
    : (r.fieldConfidence?.subtotal ?? (r.subtotal !== null ? r.confidence : 50));

  const serviceChargeConf = userVerified
    ? 100
    : (r.fieldConfidence?.serviceCharge ?? (r.serviceCharge !== null ? r.confidence : 80));

  const merchantConfStyle = getConfidenceColorInfo(merchantConf, userVerified);
  const dateConfStyle = getConfidenceColorInfo(dateConf, userVerified);
  const totalConfStyle = getConfidenceColorInfo(totalConf, userVerified);
  const vatConfStyle = getConfidenceColorInfo(vatConf, userVerified);
  const subtotalConfStyle = getConfidenceColorInfo(subtotalConf, userVerified);
  const serviceChargeConfStyle = getConfidenceColorInfo(serviceChargeConf, userVerified);

  // ─── Object URL for Original Image ─────────────────────────
  useEffect(() => {
    if (r.sourceFile && r.sourceFile instanceof Blob) {
      const url = URL.createObjectURL(r.sourceFile);
      setImageUrl(url);
      return () => {
        URL.revokeObjectURL(url);
      };
    } else if (r.imageBase64) {
      setImageUrl(r.imageBase64);
    } else {
      setImageUrl(null);
    }
  }, [r.sourceFile, r.imageBase64]);

  // ─── Field Commit Handler ─────────────────────────────────
  const handleFieldCommit = useCallback(
    (field: NonNullable<EditingField>, value: string) => {
      setEditingField(null);
      const updated = {
        ...r,
        fieldConfidence: {
          ...r.fieldConfidence,
          [field]: 100,
        },
      };

      switch (field) {
        case 'merchantName':
          updated.merchantName = value || r.merchantName;
          break;
        case 'receiptDate':
          updated.receiptDate = value || r.receiptDate;
          break;
        case 'totalAmount': {
          const parsed = parseFloat(value);
          if (!isNaN(parsed)) updated.totalAmount = parsed;
          break;
        }
        case 'vatAmount': {
          const parsed = parseFloat(value);
          if (!isNaN(parsed)) updated.vatAmount = parsed;
          break;
        }
        case 'subtotal': {
          const parsed = parseFloat(value);
          if (!isNaN(parsed)) updated.subtotal = parsed;
          break;
        }
        case 'serviceCharge': {
          const parsed = parseFloat(value);
          if (!isNaN(parsed)) updated.serviceCharge = parsed;
          break;
        }
      }

      onUpdate(index, updated);
      triggerHaptic('light');
    },
    [r, index, onUpdate]
  );

  // ─── Line Item Edit Handlers ──────────────────────────────
  const startLineItemEdit = (
    lineIdx: number,
    field: 'description' | 'quantity' | 'totalPrice'
  ) => {
    const item = r.lineItems[lineIdx];
    if (!item) return;
    const val =
      field === 'description'
        ? item.description
        : field === 'quantity'
          ? String(item.quantity)
          : item.totalPrice.toFixed(2);
    setLineItemDraft(val);
    setEditingLineItem({ lineIdx, field });
  };

  const commitLineItemEdit = () => {
    if (!editingLineItem) return;
    const { lineIdx, field } = editingLineItem;
    const newItems = [...(r.lineItems || [])];
    const item = { ...newItems[lineIdx], confidence: 100 };

    if (field === 'description') {
      item.description = lineItemDraft || item.description;
    } else if (field === 'quantity') {
      const parsed = parseInt(lineItemDraft, 10);
      if (!isNaN(parsed) && parsed > 0) item.quantity = parsed;
    } else if (field === 'totalPrice') {
      const parsed = parseFloat(lineItemDraft);
      if (!isNaN(parsed)) {
        item.totalPrice = parsed;
        item.unitPrice = item.quantity > 0 ? parsed / item.quantity : parsed;
      }
    }

    newItems[lineIdx] = item;
    onUpdate(index, { ...r, lineItems: newItems });
    setEditingLineItem(null);
    triggerHaptic('light');
  };

  // ─── Add / Delete Line Item ───────────────────────────────
  const handleAddLineItem = () => {
    const newItems = [
      ...(r.lineItems || []),
      {
        description: 'New Item',
        quantity: 1,
        unitPrice: 0,
        totalPrice: 0,
        category: 'General Expense' as string | null,
        confidence: 100,
      },
    ];
    onUpdate(index, { ...r, lineItems: newItems });
    triggerHaptic('light');
  };

  const handleDeleteLineItem = (lineIdx: number) => {
    const newItems = (r.lineItems || []).filter((_, i) => i !== lineIdx);
    onUpdate(index, { ...r, lineItems: newItems });
    triggerHaptic('light');
  };

  // ─── Confirm & Verify ─────────────────────────────────────
  const handleConfirmVerify = () => {
    onUpdate(index, {
      ...r,
      confidence: 100,
      essentialsConfidence: 100,
      fieldConfidence: {
        merchantName: 100,
        receiptDate: 100,
        totalAmount: 100,
        vatAmount: 100,
        subtotal: 100,
        serviceCharge: 100,
      },
      originalConfidence: r.confidence,
      originalEssentialsConfidence: r.essentialsConfidence,
      originalFieldConfidence: r.fieldConfidence,
      originalStatus: r.status,
      lineItems: (r.lineItems || []).map((item) => ({ ...item, originalConfidence: item.confidence, confidence: 100 })),
      status: 'user_verified',
    });
    triggerHaptic('success');
  };

  // ─── Revert / Undo Verification ───────────────────────────
  const handleUnconfirm = () => {
    const restoredConfidence = r.originalConfidence ?? (r.essentialsConfidence && r.essentialsConfidence < 100 ? r.essentialsConfidence : 80);
    onUpdate(index, {
      ...r,
      confidence: restoredConfidence,
      essentialsConfidence: r.originalEssentialsConfidence ?? restoredConfidence,
      fieldConfidence: r.originalFieldConfidence,
      status: r.originalStatus && r.originalStatus !== 'user_verified' ? r.originalStatus : (restoredConfidence >= 90 ? 'verified' : 'needs_review'),
      lineItems: (r.lineItems || []).map((item) => ({
        ...item,
        confidence: item.originalConfidence ?? item.confidence ?? 80,
      })),
    });
    triggerHaptic('light');
  };

  // ─── Delete Card ──────────────────────────────────────────
  const handleDeleteCard = () => {
    onDelete(index);
    triggerHaptic('warning');
  };

  // ─── Original Document Viewer Sub-component ───────────────
  const originalViewer = (
    <div className="rounded-2xl border-2 border-emerald-500/30 bg-zinc-50 dark:bg-zinc-950 p-3 flex flex-col h-full overflow-hidden mb-4 lg:mb-0">
      {/* Viewer Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 mb-2 border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          <span className="text-xs font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
            <span>📄</span> Original Document
          </span>
          {imageUrl && (
            <div className="flex items-center rounded-lg bg-zinc-200 dark:bg-zinc-800 px-1 py-0.5 text-xs font-bold text-zinc-600 dark:text-zinc-300">
              <button
                type="button"
                onClick={() => setZoomLevel((z) => Math.max(0.5, Math.round((z - 0.25) * 100) / 100))}
                className="px-1.5 py-0.5 hover:text-foreground transition"
                title="Zoom out"
              >
                −
              </button>
              <span className="px-1 text-[11px] font-mono">{Math.round(zoomLevel * 100)}%</span>
              <button
                type="button"
                onClick={() => setZoomLevel((z) => Math.min(4, Math.round((z + 0.25) * 100) / 100))}
                className="px-1.5 py-0.5 hover:text-foreground transition"
                title="Zoom in"
              >
                +
              </button>
              {(zoomLevel !== 1 || pan.x !== 0 || pan.y !== 0) && (
                <button
                  type="button"
                  onClick={resetView}
                  className="ml-1 px-1 text-[10px] text-zinc-400 hover:text-foreground underline transition"
                  title="Reset zoom & position"
                >
                  Reset
                </button>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {imageUrl && (
            <a
              href={imageUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-0.5"
              title="Open full image in new tab"
            >
              <span>↗ Full Tab</span>
            </a>
          )}
          <button
            type="button"
            onClick={() => {
              setShowOriginal(false);
              triggerHaptic('light');
            }}
            className="text-xs font-bold text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 px-2 py-1 rounded-md hover:bg-zinc-200 dark:hover:bg-zinc-800 transition"
            title="Close original preview"
          >
            ✕ Close
          </button>
        </div>
      </div>

      {/* Document Body with Interactive Drag & Pan + Scroll Zoom */}
      {imageUrl ? (
        <div
          ref={viewerContainerRef}
          onMouseDown={handleMouseDown}
          onDoubleClick={resetView}
          className={`relative overflow-hidden h-[540px] rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-200/50 dark:bg-black/60 flex items-center justify-center select-none touch-none ${
            isDragging ? 'cursor-grabbing' : 'cursor-grab'
          }`}
          title="Click & drag to pan • Scroll wheel to zoom • Double-click to reset"
        >
          <div
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoomLevel})`,
              transformOrigin: 'center center',
              transition: isDragging ? 'none' : 'transform 0.08s ease-out',
            }}
            className="max-w-none flex items-center justify-center pointer-events-none"
          >
            <img
              src={imageUrl}
              alt="Original scanned document"
              draggable={false}
              className="max-h-[500px] w-auto max-w-none object-contain rounded shadow-md pointer-events-none"
            />
          </div>

          {/* Floating Navigation Hint Pill */}
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 pointer-events-none rounded-full bg-black/65 backdrop-blur-sm px-3 py-1 text-[11px] font-medium text-white/90 shadow">
            👆 Drag to pan • Pinch to zoom • Double-tap to reset
          </div>
        </div>
      ) : r.rawText ? (
        <div className="overflow-auto max-h-[450px] p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 font-mono text-xs leading-relaxed text-zinc-700 dark:text-zinc-300 whitespace-pre">
          {r.rawText}
        </div>
      ) : (
        <div className="p-8 text-center text-sm text-zinc-400 italic">
          No image file was attached to this receipt.
        </div>
      )}
    </div>
  );

  // ─── Render ───────────────────────────────────────────────
  return (
    <div className={`relative overflow-hidden rounded-3xl border-2 border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 md:p-6 shadow-sm transition hover:shadow-md select-text ${confidenceMode === 'border' ? badge.ringClass : ''}`}>
      {/* Individual Card Processing Overlay */}
      {isProcessing && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-white/80 dark:bg-zinc-950/80 backdrop-blur-sm">
          <div className="text-4xl mb-4 animate-bounce">✨</div>
          <h3 className="text-lg font-black text-foreground">Enhancing with AI</h3>
          <p className="text-xs text-zinc-500 font-medium mt-1">Analyzing receipt data...</p>
        </div>
      )}
      {/* Top Row: Merchant + Badges + Toggle Original + Delete */}
      <div className="flex flex-col sm:flex-row items-start justify-between gap-4 mb-4">
        <div className="w-full sm:flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <EditableField
              value={r.receiptDate || ''}
              displayValue={r.receiptDate ? r.receiptDate.split('-').reverse().join('/') : 'DD/MM/YYYY'}
              fieldName="receiptDate"
              editingField={editingField}
              onStartEdit={setEditingField}
              onCommit={handleFieldCommit}
              inputType="date"
              className="text-xs font-bold text-zinc-500 uppercase tracking-wider block"
              inputClassName="text-xs w-40"
            />
            <span
              style={dateConfStyle.vars}
              className={`text-[9px] font-medium opacity-60 tabular-nums ${dateConfStyle.className} ${confidenceMode === 'border' ? 'hidden' : ''}`}
              title={`Date confidence: ${dateConf}%`}
            >
              {dateConf}%
            </span>
          </div>
          <div className="flex items-center gap-2.5">
            <EditableField
              value={r.merchantName || ''}
              displayValue={r.merchantName || 'Unknown Merchant'}
              fieldName="merchantName"
              editingField={editingField}
              onStartEdit={setEditingField}
              onCommit={handleFieldCommit}
              className="text-2xl md:text-3xl font-black text-foreground tracking-tight block truncate"
              inputClassName="text-2xl md:text-3xl w-full max-w-sm"
            />
            <span
              style={merchantConfStyle.vars}
              className={`text-[10px] font-medium opacity-60 tabular-nums self-center ${merchantConfStyle.className} ${confidenceMode === 'border' ? 'hidden' : ''}`}
              title={`Merchant confidence: ${merchantConf}%`}
            >
              {merchantConf}%
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center sm:justify-end gap-2 w-full sm:w-auto shrink-0 mt-2 sm:mt-0">
          

          <div className="flex flex-col items-end text-left">
            <span
              className={`inline-flex items-center rounded-xl border px-3 py-1 text-xs md:text-sm font-black tracking-wide transition group-hover:shadow-sm ${badge.style}`}
            >
              {badge.text} {confidenceMode === 'percentage' && `(${badge.score}%)`}
            </span>
            
          </div>

          <button
            type="button"
            onClick={handleDeleteCard}
            className="h-10 w-10 min-h-[40px] min-w-[40px] rounded-lg flex items-center justify-center text-zinc-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition active:scale-95"
            title="Delete receipt"
          >
            🗑️
          </button>
        </div>
      </div>

      {/* Main Content Area: Side-by-side comparison on lg screens when showOriginal is active */}
      <div className={showOriginal ? 'grid grid-cols-1 lg:grid-cols-2 gap-6 items-start' : ''}>
        {showOriginal && (
          <div className="w-full lg:sticky lg:top-4">
            {originalViewer}
          </div>
        )}

        <div className="flex flex-col flex-1 min-w-0">
          {/* Editable Financial Summary Grid */}
          <div
            className={
              showOriginal
                ? 'grid grid-cols-2 gap-3 p-3.5 rounded-2xl bg-zinc-50 dark:bg-zinc-800/50 mb-4'
                : 'grid grid-cols-2 md:grid-cols-4 gap-4 p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-800/50 mb-4'
            }
          >
            {/* Total GBP */}
            <div className="min-w-0">
              <div className="flex items-center justify-between gap-1 mb-1">
                <span className="text-[11px] font-bold text-zinc-500 uppercase tracking-wide truncate">
                  Total (GBP)
                </span>
                <span
                  style={totalConfStyle.vars}
                  className={`text-[9px] font-medium opacity-60 tabular-nums ${totalConfStyle.className} ${confidenceMode === 'border' ? 'hidden' : ''}`}
                  title={`Total confidence: ${totalConf}%`}
                >
                  {totalConf}%
                </span>
              </div>
              <div
                className={
                  showOriginal
                    ? 'text-2xl md:text-3xl font-black text-foreground'
                    : 'text-3xl md:text-4xl font-black text-foreground'
                }
              >
                <EditableField
                  value={(r.totalAmount ?? 0).toFixed(2)}
                  fieldName="totalAmount"
                  editingField={editingField}
                  onStartEdit={setEditingField}
                  onCommit={handleFieldCommit}
                  inputType="number"
                  prefix="£"
                  inputClassName={showOriginal ? 'text-xl md:text-2xl w-28' : 'text-2xl md:text-3xl w-32'}
                />
              </div>
            </div>

            {/* UK 20% VAT */}
            <div className="min-w-0">
              <div className="flex items-center justify-between gap-1 mb-1">
                <span className="text-[11px] font-bold text-zinc-500 uppercase tracking-wide truncate">
                  UK 20% VAT
                </span>
                <span
                  style={vatConfStyle.vars}
                  className={`text-[9px] font-medium opacity-60 tabular-nums ${vatConfStyle.className} ${confidenceMode === 'border' ? 'hidden' : ''}`}
                  title={`VAT confidence: ${vatConf}%`}
                >
                  {vatConf}%
                </span>
              </div>
              <div
                className={
                  showOriginal
                    ? 'text-xl md:text-2xl font-black text-emerald-600 dark:text-emerald-400'
                    : 'text-2xl md:text-3xl font-black text-emerald-600 dark:text-emerald-400'
                }
              >
                <EditableField
                  value={(r.vatAmount ?? 0).toFixed(2)}
                  fieldName="vatAmount"
                  editingField={editingField}
                  onStartEdit={setEditingField}
                  onCommit={handleFieldCommit}
                  inputType="number"
                  prefix="£"
                  inputClassName={showOriginal ? 'text-lg md:text-xl w-24' : 'text-xl md:text-2xl w-28'}
                />
              </div>
            </div>

            {/* Net Subtotal */}
            <div className="min-w-0">
              <div className="flex items-center justify-between gap-1 mb-1">
                <span className="text-[11px] font-bold text-zinc-500 uppercase tracking-wide truncate">
                  Net Subtotal
                </span>
                <span
                  style={subtotalConfStyle.vars}
                  className={`text-[9px] font-medium opacity-60 tabular-nums ${subtotalConfStyle.className} ${confidenceMode === 'border' ? 'hidden' : ''}`}
                  title={`Subtotal confidence: ${subtotalConf}%`}
                >
                  {subtotalConf}%
                </span>
              </div>
              <div
                className={
                  showOriginal
                    ? 'text-lg md:text-xl font-bold text-zinc-700 dark:text-zinc-300'
                    : 'text-xl md:text-2xl font-bold text-zinc-700 dark:text-zinc-300'
                }
              >
                <EditableField
                  value={(r.subtotal ?? 0).toFixed(2)}
                  fieldName="subtotal"
                  editingField={editingField}
                  onStartEdit={setEditingField}
                  onCommit={handleFieldCommit}
                  inputType="number"
                  prefix="£"
                  inputClassName={showOriginal ? 'text-base md:text-lg w-24' : 'text-lg md:text-xl w-28'}
                />
              </div>
            </div>

            {/* Service Charge */}
            <div className="min-w-0">
              <div className="flex items-center justify-between gap-1 mb-1">
                <span className="text-[11px] font-bold text-zinc-500 uppercase tracking-wide truncate">
                  Service Charge
                </span>
                <span
                  style={serviceChargeConfStyle.vars}
                  className={`text-[9px] font-medium opacity-60 tabular-nums ${serviceChargeConfStyle.className} ${confidenceMode === 'border' ? 'hidden' : ''}`}
                  title={`Service charge confidence: ${serviceChargeConf}%`}
                >
                  {serviceChargeConf}%
                </span>
              </div>
              <div
                className={
                  showOriginal
                    ? 'text-lg md:text-xl font-bold text-zinc-700 dark:text-zinc-300'
                    : 'text-xl md:text-2xl font-bold text-zinc-700 dark:text-zinc-300'
                }
              >
                <EditableField
                  value={(r.serviceCharge ?? 0).toFixed(2)}
                  fieldName="serviceCharge"
                  editingField={editingField}
                  onStartEdit={setEditingField}
                  onCommit={handleFieldCommit}
                  inputType="number"
                  prefix="£"
                  inputClassName={showOriginal ? 'text-base md:text-lg w-24' : 'text-lg md:text-xl w-28'}
                />
              </div>
            </div>
          </div>

          {/* Discreet Mathematical Inconsistency Notice */}
          {mathWarning && (
            <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 font-medium px-1 -mt-2 mb-3">
              <span className="shrink-0 text-xs">⚠️</span>
              <span className="truncate">{mathWarning}</span>
            </div>
          )}

          {/* Line Items with Line-by-Line Color Coding */}
          <div className="mb-4 space-y-2 text-sm border-t border-zinc-100 dark:border-zinc-800 pt-3">
            <div className="flex justify-between items-center mb-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase text-zinc-400">
                  Line Items{' '}
                  <span className="text-[10px] font-normal lowercase tracking-normal text-zinc-400 dark:text-zinc-500">
                    ({activeMode === 'essentials' ? 'optional for HMRC' : `${r.lineItems?.length || 0} items`})
                  </span>
                  :
                </span>
                {(r.lineItems?.length || 0) > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setUserExpandedItems(!isItemsVisible);
                      triggerHaptic('light');
                    }}
                    className="text-[11px] font-bold text-zinc-500 hover:text-emerald-600 dark:hover:text-emerald-400 transition underline"
                  >
                    {isItemsVisible ? 'Hide Items' : `Show (${r.lineItems.length})`}
                  </button>
                )}
              </div>
              {isItemsVisible && (
                <button
                  type="button"
                  onClick={handleAddLineItem}
                  className="text-xs font-bold text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300 transition"
                >
                  + Add Item
                </button>
              )}
            </div>

            {!isItemsVisible && (
              <div className="py-2.5 px-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200/50 dark:border-zinc-700/50 text-xs text-zinc-500 flex items-center justify-between">
                <span>Line items are hidden in Essentials mode (optional for HMRC tax filing).</span>
                {(r.lineItems?.length || 0) > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setUserExpandedItems(true);
                      triggerHaptic('light');
                    }}
                    className="font-bold text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300 underline ml-2 shrink-0"
                  >
                    View {r.lineItems.length} item{r.lineItems.length === 1 ? '' : 's'}
                  </button>
                )}
              </div>
            )}

            {isItemsVisible && (
              r.lineItems && r.lineItems.length > 0 ? (
                <div className="space-y-1.5">
                  {/* Subtle Confidence Hint */}
                  <div className="flex items-center justify-between text-[11px] font-medium text-zinc-400 pb-1 border-b border-zinc-100 dark:border-zinc-800/60">
                    <span className="text-[10px] uppercase tracking-wider">Item OCR Accuracy</span>
                    <div className="flex items-center gap-1.5 text-[10px]">
                      <span className="text-[hsl(0,82%,45%)] font-bold">0%</span>
                      <span>→</span>
                      <span className="text-[hsl(100,82%,36%)] dark:text-[hsl(100,82%,54%)] font-bold">80%</span>
                      <span>→</span>
                      <span className="text-[hsl(138,82%,34%)] dark:text-[hsl(138,82%,54%)] font-bold">100%</span>
                    </div>
                  </div>

                  {r.lineItems.map((item, iIdx) => {
                    const itemScore = userVerified ? 100 : (item.confidence ?? r.confidence);
                    const itemConfStyle = getConfidenceColorInfo(itemScore, userVerified);

                    return (
                      <div
                        key={iIdx}
                        className="flex items-center justify-between gap-2 p-1.5 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition font-medium group"
                      >
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          {/* Editable Quantity */}
                          {editingLineItem?.lineIdx === iIdx &&
                          editingLineItem?.field === 'quantity' ? (
                            <input
                              type="number"
                              value={lineItemDraft}
                              onChange={(e) => setLineItemDraft(e.target.value)}
                              onBlur={commitLineItemEdit}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') commitLineItemEdit();
                                if (e.key === 'Escape') setEditingLineItem(null);
                              }}
                              autoFocus
                              className="w-10 bg-white dark:bg-zinc-800 border-2 border-emerald-500 rounded px-1 text-center outline-none"
                            />
                          ) : (
                            <span
                              onClick={() => startLineItemEdit(iIdx, 'quantity')}
                              className="cursor-pointer hover:bg-emerald-50 dark:hover:bg-emerald-950/30 rounded px-1 transition text-xs font-bold"
                              title="Click to edit quantity"
                            >
                              {item.quantity}x
                            </span>
                          )}

                          {/* Editable Description */}
                          {editingLineItem?.lineIdx === iIdx &&
                          editingLineItem?.field === 'description' ? (
                            <input
                              type="text"
                              value={lineItemDraft}
                              onChange={(e) => setLineItemDraft(e.target.value)}
                              onBlur={commitLineItemEdit}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') commitLineItemEdit();
                                if (e.key === 'Escape') setEditingLineItem(null);
                              }}
                              autoFocus
                              className="flex-1 min-w-0 w-full bg-white dark:bg-zinc-800 border-2 border-emerald-500 rounded px-2 outline-none"
                            />
                          ) : (
                            <span
                              onClick={() => startLineItemEdit(iIdx, 'description')}
                              className="cursor-pointer hover:bg-emerald-50 dark:hover:bg-emerald-950/30 rounded px-1 truncate transition"
                              title="Click to edit description"
                            >
                              {item.description}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {/* Editable Price */}
                          {editingLineItem?.lineIdx === iIdx &&
                          editingLineItem?.field === 'totalPrice' ? (
                            <input
                              type="number"
                              value={lineItemDraft}
                              onChange={(e) => setLineItemDraft(e.target.value)}
                              onBlur={commitLineItemEdit}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') commitLineItemEdit();
                                if (e.key === 'Escape') setEditingLineItem(null);
                              }}
                              autoFocus
                              className="w-24 bg-white dark:bg-zinc-800 border-2 border-emerald-500 rounded px-2 text-right outline-none"
                            />
                          ) : (
                            <span
                              onClick={() => startLineItemEdit(iIdx, 'totalPrice')}
                              className="font-bold cursor-pointer hover:bg-emerald-50 dark:hover:bg-emerald-950/30 rounded px-1 transition"
                              title="Click to edit price"
                            >
                              £{item.totalPrice.toFixed(2)}
                            </span>
                          )}

                          {/* Discreet Color-Coded Confidence Percentage */}
                          <span
                            style={itemConfStyle.vars}
                            className={`text-[9px] font-medium opacity-60 tabular-nums shrink-0 ml-1 ${itemConfStyle.className} ${confidenceMode === 'border' ? 'hidden' : ''}`}
                            title={`Item confidence: ${itemScore}%`}
                          >
                            {itemScore}%
                          </span>

                          {/* Delete Line Item */}
                          <button
                            type="button"
                            onClick={() => handleDeleteLineItem(iIdx)}
                            className="opacity-0 group-hover:opacity-100 h-6 w-6 rounded flex items-center justify-center text-zinc-400 hover:text-rose-500 transition text-xs"
                            title="Remove item"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-zinc-400 italic">
                  No line items detected. Click &quot;+ Add Item&quot; to add manually.
                </p>
              )
            )}
          </div>

          {/* Action Buttons Row */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-4 border-t border-zinc-100 dark:border-zinc-800/60 mt-4">
            <div className="flex flex-wrap items-center gap-2">
              {/* Confirm & Verify */}
              {!userVerified ? (
                <button
                  type="button"
                  onClick={handleConfirmVerify}
                  className="h-12 rounded-xl border-2 border-emerald-600 bg-emerald-600 px-5 text-sm font-bold text-white hover:bg-emerald-700 transition flex items-center justify-center gap-2 shadow-sm"
                >
                  <span>✓ Confirm &amp; Verify</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleUnconfirm}
                  className="h-12 rounded-xl border-2 border-amber-600/40 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/50 px-5 text-sm font-bold transition flex items-center justify-center gap-2 shadow-sm"
                  title="Accidentally confirmed? Revert status and scores back to original scan confidence"
                >
                  <span>↩️ Undo Verification (Revert Scores)</span>
                </button>
              )}

              {/* Cloud AI Enhancement */}
              {!userVerified && (
                <button
                  type="button"
                  disabled={isProcessing || r.isAiEnhanced}
                  onClick={() => onEnhanceWithAI(index, r.sourceFile)}
                  className={`h-12 rounded-xl border-2 px-5 text-sm font-bold transition flex items-center justify-center gap-2 ${r.isAiEnhanced ? "border-emerald-200 bg-emerald-50 text-emerald-600/80 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-500/80 cursor-default" : "border-emerald-600/30 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 disabled:opacity-50"}`}
                >
                  <span>{r.isAiEnhanced ? "✨ AI Applied" : "✨ Enhance with AI"}</span>
                </button>
              )}
            </div>

            {/* Standalone Bottom Right View / Hide Original Document Button */}
            <button
              type="button"
              onClick={() => {
                setShowOriginal((prev) => !prev);
                triggerHaptic('light');
              }}
              className={`h-12 rounded-xl border-2 px-5 text-sm font-bold transition flex items-center justify-center gap-2 shrink-0 sm:ml-auto ${
                showOriginal
                  ? 'border-emerald-600/40 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200'
                  : 'border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:border-emerald-500 hover:text-emerald-600'
              }`}
            >
              <span>{showOriginal ? '✕ Hide Original Document' : '📄 Compare Original Document'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


