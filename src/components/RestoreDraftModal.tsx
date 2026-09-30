'use client';

import React from 'react';
import type { ExportReceiptData } from '@/lib/excel-export';
import { triggerHaptic } from '@/lib/haptics';

export interface StoredReceiptsDraft {
  version: 1;
  savedAt: number;
  scanMode: 'essentials' | 'detailed';
  receipts: ExportReceiptData[];
}

interface RestoreDraftModalProps {
  isOpen: boolean;
  draft: StoredReceiptsDraft | null;
  onRestore: () => void;
  onDiscard: () => void;
}

function formatTimeAgo(timestamp: number): string {
  const elapsedMs = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(elapsedMs / (1000 * 60));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  return `${Math.floor(hours / 24)} day${Math.floor(hours / 24) === 1 ? '' : 's'} ago`;
}

export function RestoreDraftModal({
  isOpen,
  draft,
  onRestore,
  onDiscard,
}: RestoreDraftModalProps) {
  if (!isOpen || !draft || !draft.receipts?.length) return null;

  const count = draft.receipts.length;
  const totalSum = draft.receipts.reduce((acc, r) => acc + (r.totalAmount ?? 0), 0);
  const merchants = draft.receipts
    .map((r) => r.merchantName || 'Unknown')
    .slice(0, 3)
    .join(', ');
  const moreCount = count > 3 ? count - 3 : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className="w-full max-w-md rounded-3xl bg-white p-6 md:p-8 shadow-2xl dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800"
        role="dialog"
        aria-modal="true"
      >
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-600 text-white font-bold text-2xl shadow-md">
              🔄
            </div>
            <div>
              <h2 className="text-xl font-black text-foreground tracking-tight">
                Restore Unfinished Work?
              </h2>
              <p className="text-xs text-zinc-500 font-semibold">
                Saved {formatTimeAgo(draft.savedAt)}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              triggerHaptic('light');
              onDiscard();
            }}
            className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
            aria-label="Dismiss and discard"
          >
            ✕
          </button>
        </div>

        <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-5 leading-relaxed">
          We noticed you refreshed or closed the page with unsaved receipts in progress. Would you like to restore them?
        </p>

        {/* Draft Summary Card */}
        <div className="rounded-2xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200/80 dark:border-zinc-700/60 p-4 mb-6 space-y-2">
          <div className="flex items-center justify-between text-xs font-bold text-zinc-500 uppercase tracking-wider">
            <span>Staged Receipts</span>
            <span>Estimated Total</span>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-bold text-foreground">
              {count} receipt{count === 1 ? '' : 's'}{' '}
              <span className="text-xs font-normal text-zinc-400">
                ({merchants}{moreCount > 0 ? ` +${moreCount} more` : ''})
              </span>
            </span>
            <span className="text-lg font-black text-emerald-600 dark:text-emerald-400">
              £{totalSum.toFixed(2)}
            </span>
          </div>
          <div className="text-[11px] text-zinc-400 pt-1 border-t border-zinc-200/60 dark:border-zinc-700/60 flex items-center justify-between">
            <span>Scan mode: {draft.scanMode === 'essentials' ? '🏛️ HMRC Essentials' : '📋 Detailed Items'}</span>
            <span>Auto-expires in 24h</span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            type="button"
            onClick={() => {
              triggerHaptic('success');
              onRestore();
            }}
            className="flex-1 h-12 rounded-xl bg-emerald-600 px-5 text-sm font-bold text-white shadow-md hover:bg-emerald-700 active:scale-[0.98] transition flex items-center justify-center gap-2"
          >
            <span>✓ Restore Work</span>
          </button>
          <button
            type="button"
            onClick={() => {
              triggerHaptic('light');
              onDiscard();
            }}
            className="h-12 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-4 text-sm font-bold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition"
          >
            <span>Discard &amp; Start Fresh</span>
          </button>
        </div>
      </div>
    </div>
  );
}
