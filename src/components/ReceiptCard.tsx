'use client';

import React, { useState, useCallback } from 'react';
import type { ExportReceiptData } from '@/lib/excel-export';
import { triggerHaptic } from '@/lib/haptics';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
interface ReceiptCardProps {
  receipt: ExportReceiptData;
  index: number;
  isProcessing: boolean;
  onUpdate: (index: number, updated: ExportReceiptData) => void;
  onDelete: (index: number) => void;
  onEnhanceWithAI: (index: number, imageFile?: File | Blob) => void;
}

type EditingField = null | 'merchantName' | 'receiptDate' | 'totalAmount' | 'vatAmount' | 'subtotal' | 'serviceCharge';

// ─────────────────────────────────────────────────────────────
// Confidence badge helper
// ─────────────────────────────────────────────────────────────
function getConfidenceBadge(confidence: number, userVerified: boolean) {
  if (userVerified) {
    return {
      text: '✓ User Verified',
      style:
        'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800',
    };
  }
  if (confidence >= 90) {
    return {
      text: '✓ Verified Read',
      style:
        'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800',
    };
  }
  if (confidence >= 70) {
    return {
      text: '⚠ Check Total',
      style:
        'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800',
    };
  }
  return {
    text: '✕ Needs Attention',
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
      className={`cursor-pointer hover:bg-emerald-50 dark:hover:bg-emerald-950/30 rounded-lg px-1 -mx-1 transition group ${className}`}
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
  onUpdate,
  onDelete,
  onEnhanceWithAI,
}: ReceiptCardProps) {
  const [editingField, setEditingField] = useState<EditingField>(null);
  const [editingLineItem, setEditingLineItem] = useState<{
    lineIdx: number;
    field: 'description' | 'quantity' | 'totalPrice';
  } | null>(null);
  const [lineItemDraft, setLineItemDraft] = useState('');

  const r = receipt;
  const userVerified = r.status === 'user_verified';
  const badge = getConfidenceBadge(r.confidence, userVerified);

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

  // ─── Render ───────────────────────────────────────────────
  return (
    <div className="rounded-3xl border-2 border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 md:p-6 shadow-sm transition hover:shadow-md select-text">
      {/* Top Row: Merchant + Badge + Delete */}
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
          <span
            className={`inline-flex items-center rounded-xl border px-3.5 py-1.5 text-xs md:text-sm font-black tracking-wide ${badge.style}`}
          >
            {badge.text} ({userVerified ? 100 : r.confidence}%)
          </span>
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

      {/* Editable Financial Summary Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-800/50 mb-4">
        <div>
          <span className="text-xs font-bold text-zinc-500 uppercase">Total (GBP)</span>
          <div className="text-3xl md:text-4xl font-black text-foreground">
            <EditableField
              value={(r.totalAmount ?? 0).toFixed(2)}
              fieldName="totalAmount"
              editingField={editingField}
              onStartEdit={setEditingField}
              onCommit={handleFieldCommit}
              inputType="number"
              prefix="£"
              inputClassName="text-2xl md:text-3xl w-32"
            />
          </div>
        </div>
        <div>
          <span className="text-xs font-bold text-zinc-500 uppercase">UK 20% VAT</span>
          <div className="text-2xl md:text-3xl font-black text-emerald-600 dark:text-emerald-400">
            <EditableField
              value={(r.vatAmount ?? 0).toFixed(2)}
              fieldName="vatAmount"
              editingField={editingField}
              onStartEdit={setEditingField}
              onCommit={handleFieldCommit}
              inputType="number"
              prefix="£"
              inputClassName="text-xl md:text-2xl w-28"
            />
          </div>
        </div>
        <div>
          <span className="text-xs font-bold text-zinc-500 uppercase">Net Subtotal</span>
          <div className="text-xl md:text-2xl font-bold text-zinc-700 dark:text-zinc-300">
            <EditableField
              value={(r.subtotal ?? 0).toFixed(2)}
              fieldName="subtotal"
              editingField={editingField}
              onStartEdit={setEditingField}
              onCommit={handleFieldCommit}
              inputType="number"
              prefix="£"
              inputClassName="text-lg md:text-xl w-28"
            />
          </div>
        </div>
        <div>
          <span className="text-xs font-bold text-zinc-500 uppercase">Service Charge</span>
          <div className="text-xl md:text-2xl font-bold text-zinc-700 dark:text-zinc-300">
            <EditableField
              value={(r.serviceCharge ?? 0).toFixed(2)}
              fieldName="serviceCharge"
              editingField={editingField}
              onStartEdit={setEditingField}
              onCommit={handleFieldCommit}
              inputType="number"
              prefix="£"
              inputClassName="text-lg md:text-xl w-28"
            />
          </div>
        </div>
      </div>

      {/* Line Items (Editable) */}
      <div className="mb-4 space-y-1 text-sm border-t border-zinc-100 dark:border-zinc-800 pt-3">
        <div className="flex justify-between items-center mb-2">
          <span className="text-xs font-bold uppercase text-zinc-400">Line Items:</span>
          <button
            type="button"
            onClick={handleAddLineItem}
            className="text-xs font-bold text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300 transition"
          >
            + Add Item
          </button>
        </div>
        {r.lineItems && r.lineItems.length > 0 ? (
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
        )}
      </div>

      {/* Action Buttons Row */}
      <div className="flex flex-wrap gap-2">
        {/* Confirm & Verify */}
        {!userVerified && (
          <button
            type="button"
            onClick={handleConfirmVerify}
            className="h-12 rounded-xl border-2 border-emerald-600 bg-emerald-600 px-5 text-sm font-bold text-white hover:bg-emerald-700 transition flex items-center justify-center gap-2"
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
      </div>
    </div>
  );
}
