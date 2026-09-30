'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { ExportReceiptData } from '@/lib/excel-export';
import { triggerHaptic } from '@/lib/haptics';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
interface ReceiptCardProps {
  receipt: ExportReceiptData;
  index: number;
  isProcessing: boolean;
  scanMode?: 'essentials' | 'detailed';
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
  essentialsConfidence?: number,
  scanMode: 'essentials' | 'detailed' = 'essentials'
) {
  if (userVerified) {
    return {
      text: '✓ User Verified',
      score: 100,
      style:
        'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800',
    };
  }

  // When in HMRC Essentials mode: evaluate strictly on Supplier, Date, Totals and VAT
  if (scanMode === 'essentials') {
    const score = essentialsConfidence ?? confidence;
    if (score >= 90) {
      return {
        text: '✓ HMRC Ready',
        score,
        subText: `Items: ${confidence}%`,
        style:
          'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800',
      };
    }
    if (score >= 70) {
      return {
        text: '⚠ Check Total',
        score,
        subText: `Items: ${confidence}%`,
        style:
          'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800',
      };
    }
    return {
      text: '✕ Needs Attention',
      score,
      style:
        'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950 dark:text-rose-300 dark:border-rose-800',
    };
  }

  // Detailed mode: evaluate all lines including individual items
  if (confidence >= 90) {
    return {
      text: '✓ Verified Read',
      score: confidence,
      subText: essentialsConfidence ? `HMRC: ${essentialsConfidence}%` : undefined,
      style:
        'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800',
    };
  }
  if (confidence >= 70) {
    return {
      text: '⚠ Check Total',
      score: confidence,
      subText: essentialsConfidence ? `HMRC: ${essentialsConfidence}%` : undefined,
      style:
        'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800',
    };
  }
  return {
    text: '✕ Needs Attention',
    score: confidence,
    style:
      'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950 dark:text-rose-300 dark:border-rose-800',
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
  onUpdate,
  onDelete,
  onEnhanceWithAI,
}: ReceiptCardProps) {
  const [localMode, setLocalMode] = useState<'essentials' | 'detailed' | null>(null);
  const activeMode = localMode ?? scanMode;
  const [showLineItems, setShowLineItems] = useState(true);
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

  const r = receipt;
  const userVerified = r.status === 'user_verified';
  const badge = getConfidenceBadge(r.confidence, userVerified, r.essentialsConfidence, activeMode);

  // ─── Object URL for Original Image ─────────────────────────
  useEffect(() => {
    if (r.sourceFile && r.sourceFile instanceof Blob) {
      const url = URL.createObjectURL(r.sourceFile);
      setImageUrl(url);
      return () => {
        URL.revokeObjectURL(url);
      };
    } else {
      setImageUrl(null);
    }
  }, [r.sourceFile]);

  // ─── Field Commit Handler ─────────────────────────────────
  const handleFieldCommit = useCallback(
    (field: NonNullable<EditingField>, value: string) => {
      setEditingField(null);
      const updated = { ...r };

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
    const item = { ...newItems[lineIdx] };

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
      status: 'user_verified',
    });
    triggerHaptic('success');
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
          className={`relative overflow-hidden h-[540px] rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-200/50 dark:bg-black/60 flex items-center justify-center select-none ${
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
            🖱️ Drag to pan • Scroll to zoom • Double-click to reset
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
    <div className="rounded-3xl border-2 border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 md:p-6 shadow-sm transition hover:shadow-md select-text">
      {/* Top Row: Merchant + Badges + Toggle Original + Delete */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div className="flex-1 min-w-0">
          <EditableField
            value={r.receiptDate || ''}
            displayValue={r.receiptDate || 'DD/MM/YYYY'}
            fieldName="receiptDate"
            editingField={editingField}
            onStartEdit={setEditingField}
            onCommit={handleFieldCommit}
            inputType="date"
            className="text-xs font-bold text-zinc-500 uppercase tracking-wider block mb-1"
            inputClassName="text-xs w-40"
          />
          <EditableField
            value={r.merchantName || ''}
            displayValue={r.merchantName || 'Unknown Merchant'}
            fieldName="merchantName"
            editingField={editingField}
            onStartEdit={setEditingField}
            onCommit={handleFieldCommit}
            className="text-2xl md:text-3xl font-black text-foreground tracking-tight block"
            inputClassName="text-2xl md:text-3xl w-full max-w-sm"
          />
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Toggle View Original Button */}
          <button
            type="button"
            onClick={() => {
              setShowOriginal((prev) => !prev);
              triggerHaptic('light');
            }}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs md:text-sm font-black transition ${
              showOriginal
                ? 'border-emerald-500 bg-emerald-500 text-white shadow-sm'
                : 'border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:border-emerald-500 hover:text-emerald-600'
            }`}
            title="Toggle original document scan comparison"
          >
            <span>{showOriginal ? '✕ Hide Scan' : '📄 View Original'}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setLocalMode(activeMode === 'essentials' ? 'detailed' : 'essentials');
              triggerHaptic('light');
            }}
            className="flex flex-col items-end cursor-pointer group text-left transition active:scale-95"
            title={`Current view: ${activeMode === 'essentials' ? 'HMRC Essentials' : 'Detailed Items'}. Click to toggle.`}
          >
            <span
              className={`inline-flex items-center rounded-xl border px-3 py-1 text-xs md:text-sm font-black tracking-wide transition group-hover:shadow-sm ${badge.style}`}
            >
              {badge.text} ({badge.score}%)
            </span>
            {badge.subText && (
              <span className="text-[10px] font-semibold text-zinc-400 dark:text-zinc-500 mt-0.5 mr-1 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition">
                {badge.subText} (Click to switch)
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={handleDeleteCard}
            className="h-8 w-8 rounded-lg flex items-center justify-center text-zinc-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition"
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
            <div className="min-w-0">
              <span className="text-[11px] font-bold text-zinc-500 uppercase tracking-wide block truncate">
                Total (GBP)
              </span>
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
            <div className="min-w-0">
              <span className="text-[11px] font-bold text-zinc-500 uppercase tracking-wide block truncate">
                UK 20% VAT
              </span>
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
            <div className="min-w-0">
              <span className="text-[11px] font-bold text-zinc-500 uppercase tracking-wide block truncate">
                Net Subtotal
              </span>
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
            <div className="min-w-0">
              <span className="text-[11px] font-bold text-zinc-500 uppercase tracking-wide block truncate">
                Service Charge
              </span>
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

          {/* Line Items (Editable) */}
          <div className="mb-4 space-y-1 text-sm border-t border-zinc-100 dark:border-zinc-800 pt-3">
            <div className="flex justify-between items-center mb-2">
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
                      setShowLineItems((prev) => !prev);
                      triggerHaptic('light');
                    }}
                    className="text-[11px] font-bold text-zinc-500 hover:text-emerald-600 dark:hover:text-emerald-400 transition underline"
                  >
                    {showLineItems ? 'Hide Items' : `Show (${r.lineItems.length})`}
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={handleAddLineItem}
                className="text-xs font-bold text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300 transition"
              >
                + Add Item
              </button>
            </div>
            {showLineItems && (
              r.lineItems && r.lineItems.length > 0 ? (
                r.lineItems.map((item, iIdx) => (
                  <div
                    key={iIdx}
                    className="flex items-center justify-between gap-2 text-zinc-700 dark:text-zinc-300 font-medium group"
                  >
                    <div className="flex items-center gap-1 flex-1 min-w-0">
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
                          className="cursor-pointer hover:bg-emerald-50 dark:hover:bg-emerald-950/30 rounded px-1 transition"
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
                          className="flex-1 bg-white dark:bg-zinc-800 border-2 border-emerald-500 rounded px-2 outline-none"
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

                    <div className="flex items-center gap-1 shrink-0">
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
                ))
              ) : (
                <p className="text-xs text-zinc-400 italic">
                  No line items detected. Click &quot;+ Add Item&quot; to add manually.
                </p>
              )
            )}
          </div>

          {/* Action Buttons Row */}
          <div className="flex flex-wrap gap-2">
            {/* Confirm & Verify */}
            {!userVerified && (
              <button
                type="button"
                onClick={handleConfirmVerify}
                className="h-12 rounded-xl border-2 border-emerald-600 bg-emerald-600 px-5 text-sm font-bold text-white hover:bg-emerald-700 transition flex items-center justify-center gap-2 shadow-sm"
              >
                <span>✓ Confirm &amp; Verify</span>
              </button>
            )}

            {/* Cloud AI Enhancement */}
            {r.confidence < 95 && !userVerified && (
              <button
                type="button"
                disabled={isProcessing}
                onClick={() => onEnhanceWithAI(index, r.sourceFile)}
                className="h-12 rounded-xl border-2 border-emerald-600/30 bg-emerald-50 dark:bg-emerald-950/40 px-5 text-sm font-bold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 transition flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <span>✨ Enhance with Cloud AI</span>
              </button>
            )}

            {/* Bottom View / Hide Original Document Button */}
            <button
              type="button"
              onClick={() => {
                setShowOriginal((prev) => !prev);
                triggerHaptic('light');
              }}
              className={`h-12 rounded-xl border-2 px-5 text-sm font-bold transition flex items-center justify-center gap-2 ${
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
